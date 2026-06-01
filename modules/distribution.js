// ============================================================
//  modules/distribution.js  — v3.1
//
//  CORRECCIONES v3.1 (sobre v3.0):
//
//  1. BUG-2 CORREGIDO: GAS_LIMIT aumentado de 600_000 a 2_000_000.
//
//     Calculo de gas real en distributePublic():
//       - Overhead base del contrato    :  ~50,000 gas
//       - Por cada empleado (call.value):  ~30,000 gas (destino EOA)
//       - Por cada empleado (contrato)  :  ~10,000 gas (storage + logic)
//       - Total por empleado            :  ~40,000 gas
//
//     Capacidad por limite:
//       600_000  gas ->  ~13 empleados maximo
//       2_000_000 gas ->  ~48 empleados  <- nuevo limite
//
//     Con 2_000_000 gas en BSC (3 gwei):
//       Costo de gas: 2_000_000 * 3 gwei = 0.006 BNB (~$3.6 USD)
//       Este costo lo paga el OPERADOR de su saldo (no del msg.value)
//
//     Si se necesitan mas de 48 empleados, se recomienda
//     dividir en multiples departamentos o llamadas.
//
//  ARQUITECTURA DE ROLES (sin cambios):
//  - execute.html (operador, NO owner) -> distributePublic()
//  - admin.html   (owner)              -> distribute() / drainOwner()
// ============================================================

import { getSession, getBalance } from '../core/provider.js';
import { toFloat }                from '../core/utils.js';
import { calculateTotalNeeded }   from './departments.js';
import { GAS_RESERVE_ETH }        from '../core/contract.js';

// CORRECCION BUG-2: aumentado de 600_000 a 2_000_000
// para soportar hasta ~48 empleados sin out-of-gas.
const GAS_LIMIT = 2_000_000;

// Buffer adicional sobre GAS_RESERVE para cubrir el gas de la tx
const GAS_TX_BUFFER_ETH = '0.001';

// ============================================================
//  estimateDistributePublic()
//  Para el operador (NO owner).
//  El operador envia el BNB como msg.value.
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
    const falta = (totalBnb + guardBnb - operatorBnb).toFixed(4);
    throw new BalanceError(
      'Saldo insuficiente. Faltan ' + falta + ' BNB (incluye reserva de gas ' +
      (parseFloat(GAS_RESERVE_ETH) + parseFloat(GAS_TX_BUFFER_ETH)).toFixed(3) + ' BNB).',
      { needed: totalBnb, owned: operatorBnb, missing: parseFloat(falta) }
    );
  }

  return {
    sendValue:    totalNeeded,
    totalBnb,
    sendBnb:      totalBnb,   // alias para uniformidad con otras funciones
    operatorBnb
  };
}

// ============================================================
//  runDistributePublic()
//  Llama distributePublic() enviando BNB como msg.value.
//  No requiere ser owner.
//  @param {ethers.BigNumber} [cachedSendValue]
// ============================================================
export async function runDistributePublic(cachedSendValue) {
  const { contract } = getSession();

  const sendValue = cachedSendValue ?? (await estimateDistributePublic()).sendValue;
  const totalBnb  = toFloat(sendValue);

  const tx      = await contract.distributePublic({ value: sendValue, gasLimit: GAS_LIMIT });
  const receipt = await tx.wait();

  return { tx, receipt, sendValue, totalBnb };
}

// ============================================================
//  estimateDistribute()
//  Para el owner. El owner envia BNB como msg.value.
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
    const falta = (totalBnb + guardBnb - ownerBnb).toFixed(4);
    throw new BalanceError(
      'Saldo insuficiente. Faltan ' + falta + ' BNB (incluye reserva de gas ' +
      (parseFloat(GAS_RESERVE_ETH) + parseFloat(GAS_TX_BUFFER_ETH)).toFixed(3) + ' BNB).',
      { needed: totalBnb, owned: ownerBnb, missing: parseFloat(falta) }
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
      'Saldo insuficiente para drainOwner. Minimo ' +
      (parseFloat(GAS_RESERVE_ETH) + parseFloat(GAS_TX_BUFFER_ETH)).toFixed(3) +
      ' BNB para gas.',
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

  const tx      = await contract.distribute({ value: sendValue, gasLimit: GAS_LIMIT });
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

  const tx      = await contract.drainOwner({ value: sendValue, gasLimit: GAS_LIMIT });
  const receipt = await tx.wait();

  return { tx, receipt, sendValue, sendBnb };
}

// ============================================================
//  runAction()
//  Ejecuta la accion usando el sendValue ya calculado.
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
