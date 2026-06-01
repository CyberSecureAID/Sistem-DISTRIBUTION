// ============================================================
//  modules/distribution.js  — v3.4 (corregido)
//
//  CORRECCIONES v3.4 (sobre v3.3):
//
//  1. BUG-TX-TIMING CORREGIDO: Las funciones run*() ahora aceptan
//     un callback opcional `onSubmit(txHash)` que se invoca JUSTO
//     DESPUÉS del submit de la tx y ANTES de tx.wait(). Esto
//     permite que la UI muestre el hash y el link a BscScan
//     mientras el bloque se está minando (UX de un clic mejorada).
//
//  2. BUG-ZERO-EMPLOYEES CORREGIDO: estimateDistributePublic()
//     ahora verifica que totalNeeded > 0 antes de continuar.
//     Si no hay empleados activos, lanza NoEmployeesError en vez
//     de retornar sendValue=0 (que causaría un revert on-chain).
//
//  3. Acceso defensivo a ethers via window.ethers para
//     compatibilidad con módulos ES en GitHub Pages.
//
//  CORRECCIONES HEREDADAS v3.3:
//  - BUG-2: separación conceptual tx.submit / tx.wait (ahora real).
//  - BUG-3: drainOwner emite totalSent correcto (fix en contrato).
//
//  CORRECCIONES HEREDADAS v3.2:
//  - gasLimit dinámico con estimateGas() + buffer 40%.
//  - BalanceError expone detalles numéricos.
// ============================================================

import { getSession, getBalance } from '../core/provider.js';
import { toFloat }                from '../core/utils.js';
import { calculateTotalNeeded }   from './departments.js';
import { GAS_RESERVE_ETH }        from '../core/contract.js';

/* global ethers */

// Acceso seguro a ethers
function _ethers() {
  const e = (typeof window !== 'undefined' && window.ethers) || (typeof ethers !== 'undefined' && ethers);
  if (!e) throw new Error('ethers.js no está cargado.');
  return e;
}

const GAS_LIMIT_FALLBACK = 2_000_000;
const GAS_BUFFER_FACTOR  = 1.4;
const GAS_TX_BUFFER_ETH  = '0.001';

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
//  v3.4: verifica totalNeeded > 0 antes de continuar.
// ============================================================
export async function estimateDistributePublic() {
  const { account } = getSession();
  const eth = _ethers();

  const [totalNeeded, operatorBal] = await Promise.all([
    calculateTotalNeeded(),
    getBalance(account)
  ]);

  // BUG-ZERO-EMPLOYEES FIX: verificar que hay empleados activos
  if (totalNeeded.isZero()) {
    throw new NoEmployeesError(
      'No hay empleados activos configurados en el contrato. ' +
      'El administrador debe configurar departamentos y empleados antes de ejecutar.'
    );
  }

  const reserve    = eth.utils.parseEther(GAS_RESERVE_ETH);
  const txBuffer   = eth.utils.parseEther(GAS_TX_BUFFER_ETH);
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
//  v3.4: acepta onSubmit(hash) callback para mostrar hash
//  inmediatamente tras el submit, antes de minar el bloque.
//
//  @param {ethers.BigNumber} [cachedSendValue]
//  @param {function}         [onSubmit]  — callback(txHash: string)
// ============================================================
export async function runDistributePublic(cachedSendValue, onSubmit) {
  const { contract } = getSession();

  const sendValue = cachedSendValue ?? (await estimateDistributePublic()).sendValue;
  const totalBnb  = toFloat(sendValue);

  const gasLimit = await _getGasLimit(contract, 'distributePublic', { value: sendValue });

  // Submit — el hash está disponible AQUÍ, antes de minar
  const tx = await contract.distributePublic({ value: sendValue, gasLimit });

  // Invocar callback con el hash ANTES de esperar confirmación
  if (typeof onSubmit === 'function') {
    try { onSubmit(tx.hash); } catch (_) { /* callback no debe romper el flujo */ }
  }

  // Esperar confirmación en bloque
  const receipt = await tx.wait();

  return { tx, receipt, sendValue, totalBnb, hash: tx.hash };
}

// ============================================================
//  estimateDistribute()
// ============================================================
export async function estimateDistribute() {
  const { account } = getSession();
  const eth = _ethers();

  const [totalNeeded, ownerBal] = await Promise.all([
    calculateTotalNeeded(),
    getBalance(account)
  ]);

  if (totalNeeded.isZero()) {
    throw new NoEmployeesError(
      'No hay empleados activos configurados en el contrato.'
    );
  }

  const reserve    = eth.utils.parseEther(GAS_RESERVE_ETH);
  const txBuffer   = eth.utils.parseEther(GAS_TX_BUFFER_ETH);
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

  return { sendValue: totalNeeded, totalBnb, sendBnb: totalBnb, ownerBnb };
}

// ============================================================
//  estimateDrainOwner()
// ============================================================
export async function estimateDrainOwner() {
  const { account } = getSession();
  const eth = _ethers();

  const ownerBal     = await getBalance(account);
  const reserve      = eth.utils.parseEther(GAS_RESERVE_ETH);
  const txBuffer     = eth.utils.parseEther(GAS_TX_BUFFER_ETH);
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

  return { sendValue, sendBnb, totalBnb: sendBnb, ownerBnb: toFloat(ownerBal) };
}

// ============================================================
//  runDistribute()
//  v3.4: acepta onSubmit(hash) callback.
// ============================================================
export async function runDistribute(cachedSendValue, onSubmit) {
  const { contract } = getSession();

  const sendValue = cachedSendValue ?? (await estimateDistribute()).sendValue;
  const totalBnb  = toFloat(sendValue);

  const gasLimit = await _getGasLimit(contract, 'distribute', { value: sendValue });

  const tx = await contract.distribute({ value: sendValue, gasLimit });

  if (typeof onSubmit === 'function') {
    try { onSubmit(tx.hash); } catch (_) {}
  }

  const receipt = await tx.wait();
  return { tx, receipt, sendValue, totalBnb, hash: tx.hash };
}

// ============================================================
//  runDrainOwner()
//  v3.4: acepta onSubmit(hash) callback.
// ============================================================
export async function runDrainOwner(cachedSendValue, onSubmit) {
  const { contract } = getSession();

  const sendValue = cachedSendValue ?? (await estimateDrainOwner()).sendValue;
  const sendBnb   = toFloat(sendValue);

  const gasLimit = await _getGasLimit(contract, 'drainOwner', { value: sendValue });

  const tx = await contract.drainOwner({ value: sendValue, gasLimit });

  if (typeof onSubmit === 'function') {
    try { onSubmit(tx.hash); } catch (_) {}
  }

  const receipt = await tx.wait();
  return { tx, receipt, sendValue, sendBnb, hash: tx.hash };
}

// ============================================================
//  runAction()
//  v3.4: propaga el callback onSubmit a la función específica.
// ============================================================
export async function runAction(action, sendValue, onSubmit) {
  if (action === 'drainOwner') return runDrainOwner(sendValue, onSubmit);
  if (action === 'distribute') return runDistribute(sendValue, onSubmit);
  return runDistributePublic(sendValue, onSubmit);
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

// ============================================================
//  NoEmployeesError
// ============================================================
export class NoEmployeesError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NoEmployeesError';
  }
}
