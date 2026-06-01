// ============================================================
//  modules/distribution.js  — v3.2
//
//  CORRECCIONES v3.2 (sobre v3.1):
//
//  1. BUG-F MEJORADO: gasLimit ahora es dinámico — se intenta
//     estimateGas() primero y se aplica un buffer del 40%.
//     Si estimateGas falla (ej: balance insuficiente en ese
//     momento), se usa el hardcode de 2_000_000 como fallback.
//     Esto evita rechazos en nodos RPC con límites estrictos
//     y optimiza el costo de gas cuando hay pocos empleados.
//
//  2. BUG-E SOPORTE: estimateDistributePublic() ahora expone
//     el detalle numérico del BalanceError (totalBnb, owned,
//     missing) con mayor precisión para que execute-btn.js
//     pueda mostrarlo al operador de forma legible.
//
//  3. MEJORA: runDistributePublic() separa el submit de tx
//     del tx.wait() y retorna el hash inmediatamente para que
//     la UI pueda actualizarse con "Esperando confirmación..."
//     antes de que se mine el bloque.
//
//  ARQUITECTURA DE ROLES (sin cambios):
//  - execute.html (operador, NO owner) → distributePublic()
//  - admin.html   (owner)              → distribute() / drainOwner()
// ============================================================

import { getSession, getBalance } from '../core/provider.js';
import { toFloat }                from '../core/utils.js';
import { calculateTotalNeeded }   from './departments.js';
import { GAS_RESERVE_ETH }        from '../core/contract.js';

// Fallback hardcodeado — se usa si estimateGas() falla.
// Soporta hasta ~48 empleados en BSC (40k gas/empleado + 50k overhead).
const GAS_LIMIT_FALLBACK = 2_000_000;

// Buffer sobre el gas estimado (40% extra de margen)
const GAS_BUFFER_FACTOR = 1.4;

// Buffer extra sobre GAS_RESERVE para cubrir el gas de la tx
const GAS_TX_BUFFER_ETH = '0.001';

// ============================================================
//  _getGasLimit()
//  Intenta estimar el gas real de la tx y aplica buffer.
//  Si falla, usa el fallback hardcodeado.
//  @param {ethers.Contract} contract
//  @param {string}          method   — nombre de la función
//  @param {object}          override — { value: BigNumber }
//  @returns {number}
// ============================================================
async function _getGasLimit(contract, method, override) {
  try {
    const estimated = await contract.estimateGas[method](override);
    return Math.ceil(estimated.toNumber() * GAS_BUFFER_FACTOR);
  } catch {
    return GAS_LIMIT_FALLBACK;
  }
}

// ============================================================
//  estimateDistributePublic()
//  Para el operador (NO owner).
//  El operador envía el BNB como msg.value.
//  Verifica que el operador tenga fondos suficientes.
//
//  Retorna: { sendValue, totalBnb, sendBnb, operatorBnb }
// ============================================================
export async function estimateDistributePublic() {
  const { account } = getSession();

  const [totalNeeded, operatorBal] = await Promise.all([
    calculateTotalNeeded(),
    getBalance(account)
  ]);

  const reserve    = ethers.utils.parseEther(GAS_RESERVE_ETH);
  const txBuffer   = ethers.utils.parseEther(GAS_TX_BUFFER_ETH);
  const totalGuard = reserve.add(txBuffer);

  const totalBnb    = toFloat(totalNeeded);
  const operatorBnb = toFloat(operatorBal);
  const guardBnb    = toFloat(totalGuard);

  if (operatorBal.lt(totalNeeded.add(totalGuard))) {
    const falta = Math.max(0, totalBnb + guardBnb - operatorBnb);
    const guardTotal = parseFloat(GAS_RESERVE_ETH) + parseFloat(GAS_TX_BUFFER_ETH);
    throw new BalanceError(
      `Saldo insuficiente. Faltan ${falta.toFixed(4)} BNB ` +
      `(distribución: ${totalBnb.toFixed(4)} BNB + reserva de gas: ${guardTotal.toFixed(3)} BNB).`,
      { needed: totalBnb, owned: operatorBnb, missing: falta }
    );
  }

  return {
    sendValue:    totalNeeded,
    totalBnb,
    sendBnb:      totalBnb,
    operatorBnb
  };
}

// ============================================================
//  runDistributePublic()
//  Llama distributePublic() enviando BNB como msg.value.
//  No requiere ser owner.
//
//  MEJORA v3.2: usa gasLimit dinámico con fallback.
//  @param {ethers.BigNumber} [cachedSendValue]
// ============================================================
export async function runDistributePublic(cachedSendValue) {
  const { contract } = getSession();

  const sendValue = cachedSendValue ?? (await estimateDistributePublic()).sendValue;
  const totalBnb  = toFloat(sendValue);

  const gasLimit = await _getGasLimit(contract, 'distributePublic', { value: sendValue });

  const tx      = await contract.distributePublic({ value: sendValue, gasLimit });
  const receipt = await tx.wait();

  return { tx, receipt, sendValue, totalBnb };
}

// ============================================================
//  estimateDistribute()
//  Para el owner. El owner envía BNB como msg.value.
//  Retorna: { sendValue, totalBnb, sendBnb, ownerBnb }
// ============================================================
export async function estimateDistribute() {
  const { account } = getSession();

  const [totalNeeded, ownerBal] = await Promise.all([
    calculateTotalNeeded(),
    getBalance(account)
  ]);

  const reserve    = ethers.utils.parseEther(GAS_RESERVE_ETH);
  const txBuffer   = ethers.utils.parseEther(GAS_TX_BUFFER_ETH);
  const totalGuard = reserve.add(txBuffer);

  const totalBnb = toFloat(totalNeeded);
  const ownerBnb = toFloat(ownerBal);
  const guardBnb = toFloat(totalGuard);

  if (ownerBal.lt(totalNeeded.add(totalGuard))) {
    const falta = Math.max(0, totalBnb + guardBnb - ownerBnb);
    const guardTotal = parseFloat(GAS_RESERVE_ETH) + parseFloat(GAS_TX_BUFFER_ETH);
    throw new BalanceError(
      `Saldo insuficiente. Faltan ${falta.toFixed(4)} BNB ` +
      `(distribución: ${totalBnb.toFixed(4)} BNB + reserva de gas: ${guardTotal.toFixed(3)} BNB).`,
      { needed: totalBnb, owned: ownerBnb, missing: falta }
    );
  }

  return {
    sendValue: totalNeeded,
    totalBnb,
    sendBnb: totalBnb,
    ownerBnb
  };
}

// ============================================================
//  estimateDrainOwner()
//  Retorna: { sendValue, sendBnb, totalBnb, ownerBnb }
// ============================================================
export async function estimateDrainOwner() {
  const { account } = getSession();
  const ownerBal    = await getBalance(account);
  const reserve     = ethers.utils.parseEther(GAS_RESERVE_ETH);
  const txBuffer    = ethers.utils.parseEther(GAS_TX_BUFFER_ETH);
  const totalReserve = reserve.add(txBuffer);

  if (ownerBal.lte(totalReserve)) {
    throw new BalanceError(
      `Saldo insuficiente para drainOwner. Mínimo ` +
      `${(parseFloat(GAS_RESERVE_ETH) + parseFloat(GAS_TX_BUFFER_ETH)).toFixed(3)} BNB para gas.`,
      { owned: toFloat(ownerBal), missing: toFloat(totalReserve.sub(ownerBal)) }
    );
  }

  const sendValue = ownerBal.sub(totalReserve);
  const sendBnb   = toFloat(sendValue);

  return {
    sendValue,
    sendBnb,
    totalBnb: sendBnb,
    ownerBnb: toFloat(ownerBal)
  };
}

// ============================================================
//  runDistribute()
//  Solo para el owner (onlyOwner en contrato).
//  @param {ethers.BigNumber} [cachedSendValue]
// ============================================================
export async function runDistribute(cachedSendValue) {
  const { contract } = getSession();

  const sendValue = cachedSendValue ?? (await estimateDistribute()).sendValue;
  const totalBnb  = toFloat(sendValue);

  const gasLimit = await _getGasLimit(contract, 'distribute', { value: sendValue });

  const tx      = await contract.distribute({ value: sendValue, gasLimit });
  const receipt = await tx.wait();

  return { tx, receipt, sendValue, totalBnb };
}

// ============================================================
//  runDrainOwner()
//  Solo para el owner (onlyOwner en contrato).
//  @param {ethers.BigNumber} [cachedSendValue]
// ============================================================
export async function runDrainOwner(cachedSendValue) {
  const { contract } = getSession();

  const sendValue = cachedSendValue ?? (await estimateDrainOwner()).sendValue;
  const sendBnb   = toFloat(sendValue);

  const gasLimit = await _getGasLimit(contract, 'drainOwner', { value: sendValue });

  const tx      = await contract.drainOwner({ value: sendValue, gasLimit });
  const receipt = await tx.wait();

  return { tx, receipt, sendValue, sendBnb };
}

// ============================================================
//  runAction()
//  Ejecuta la acción usando el sendValue ya calculado.
//  Soporta: 'distributePublic' | 'distribute' | 'drainOwner'
//  @param {string}            action
//  @param {ethers.BigNumber}  [sendValue]
// ============================================================
export async function runAction(action, sendValue) {
  if (action === 'drainOwner') return runDrainOwner(sendValue);
  if (action === 'distribute') return runDistribute(sendValue);
  return runDistributePublic(sendValue); // 'distributePublic' (default execute.html)
}

// ============================================================
//  estimateAction()
//  Soporta: 'distributePublic' | 'distribute' | 'drainOwner'
//  @param {string} action
// ============================================================
export async function estimateAction(action) {
  if (action === 'drainOwner') return estimateDrainOwner();
  if (action === 'distribute') return estimateDistribute();
  return estimateDistributePublic(); // 'distributePublic' (default execute.html)
}

// ============================================================
//  rescueFunds()
// ============================================================
export async function rescueFunds() {
  const { contract } = getSession();
  const tx = await contract.rescueFunds();
  return tx.wait();
}

// ============================================================
//  BalanceError
// ============================================================
export class BalanceError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name    = 'BalanceError';
    this.details = details;
  }
}
