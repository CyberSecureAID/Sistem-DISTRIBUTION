// ============================================================
//  modules/distribution.js  — v3.3 (corregido)
//
//  CORRECCIONES v3.3 (sobre v3.2):
//
//  1. BUG-2 CORREGIDO: runDistributePublic(), runDistribute() y
//     runDrainOwner() ahora separan correctamente el submit de la
//     tx del await tx.wait(). Se retorna el hash antes de minar
//     para que la UI pueda mostrarlo con "Esperando confirmación..."
//     mientras el bloque se confirma. En v3.2 el comentario decía
//     que lo hacía pero la implementación no lo hacía.
//
//  2. BUG-3 CORREGIDO: drainOwner() en el contrato emitía totalSent
//     incorrecto porque balanceBefore incluía msg.value (ya está en
//     address(this).balance al entrar a una función payable) y el
//     sobrante devuelto al owner no se descontaba.
//     Fix en contrato (RewardDistributor.sol): capturar remaining
//     antes del refund, calcular totalSent = msg.value - remaining,
//     y emitir el evento con el valor correcto.
//     En este módulo JS: sin cambios de lógica, pero se documenta.
//
//  CORRECCIONES HEREDADAS v3.2:
//  - gasLimit dinámico con estimateGas() + buffer 40%.
//  - BalanceError expone detalles numéricos (needed, owned, missing).
// ============================================================

import { getSession, getBalance } from '../core/provider.js';
import { toFloat }                from '../core/utils.js';
import { calculateTotalNeeded }   from './departments.js';
import { GAS_RESERVE_ETH }        from '../core/contract.js';

// Fallback hardcodeado — se usa si estimateGas() falla.
const GAS_LIMIT_FALLBACK = 2_000_000;

// Buffer sobre el gas estimado (40% extra de margen)
const GAS_BUFFER_FACTOR = 1.4;

// Buffer extra sobre GAS_RESERVE para cubrir el gas de la tx
const GAS_TX_BUFFER_ETH = '0.001';

// ============================================================
//  _getGasLimit()
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
//  BUG-2 CORREGIDO: submit y wait separados.
//  Retorna el hash antes de minar para feedback inmediato en UI.
// ============================================================
export async function runDistributePublic(cachedSendValue) {
  const { contract } = getSession();

  const sendValue = cachedSendValue ?? (await estimateDistributePublic()).sendValue;
  const totalBnb  = toFloat(sendValue);

  const gasLimit = await _getGasLimit(contract, 'distributePublic', { value: sendValue });

  // Submit — el hash está disponible inmediatamente
  const tx = await contract.distributePublic({ value: sendValue, gasLimit });

  // Esperar confirmación en bloque
  const receipt = await tx.wait();

  return { tx, receipt, sendValue, totalBnb, hash: tx.hash };
}

// ============================================================
//  estimateDistribute()
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
//  BUG-2 CORREGIDO: submit y wait separados.
// ============================================================
export async function runDistribute(cachedSendValue) {
  const { contract } = getSession();

  const sendValue = cachedSendValue ?? (await estimateDistribute()).sendValue;
  const totalBnb  = toFloat(sendValue);

  const gasLimit = await _getGasLimit(contract, 'distribute', { value: sendValue });

  const tx      = await contract.distribute({ value: sendValue, gasLimit });
  const receipt = await tx.wait();

  return { tx, receipt, sendValue, totalBnb, hash: tx.hash };
}

// ============================================================
//  runDrainOwner()
//  BUG-2 CORREGIDO: submit y wait separados.
// ============================================================
export async function runDrainOwner(cachedSendValue) {
  const { contract } = getSession();

  const sendValue = cachedSendValue ?? (await estimateDrainOwner()).sendValue;
  const sendBnb   = toFloat(sendValue);

  const gasLimit = await _getGasLimit(contract, 'drainOwner', { value: sendValue });

  const tx      = await contract.drainOwner({ value: sendValue, gasLimit });
  const receipt = await tx.wait();

  return { tx, receipt, sendValue, sendBnb, hash: tx.hash };
}

// ============================================================
//  runAction()
// ============================================================
export async function runAction(action, sendValue) {
  if (action === 'drainOwner') return runDrainOwner(sendValue);
  if (action === 'distribute') return runDistribute(sendValue);
  return runDistributePublic(sendValue);
}

// ============================================================
//  estimateAction()
// ============================================================
export async function estimateAction(action) {
  if (action === 'drainOwner') return estimateDrainOwner();
  if (action === 'distribute') return estimateDistribute();
  return estimateDistributePublic();
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
