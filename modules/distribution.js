// ============================================================
//  modules/distribution.js  — v2.2 (corregido)
//  Lógica de ejecución de pagos: distribute() y drainOwner().
//
//  CORRECCIONES v2.2 (sobre v2.1):
//  1. runDrainOwner() — eliminada la doble estimación:
//     v2.1 llamaba estimateDrainOwner() dentro de runDrainOwner()
//     para re-estimar el sendValue "fresco". Sin embargo
//     estimateAction() (llamado antes en _executeFlow) ya leyó
//     el balance, y la segunda lectura puede diferir si hay
//     movimientos de fondos entre ambas llamadas, causando
//     errores imprevisibles en el contrato. Ahora runDrainOwner()
//     acepta un sendValue opcional; si se pasa (desde runAction),
//     lo usa directamente. Solo re-estima si no se pasa.
//
//  2. estimateDrainOwner() y estimateDistribute() — ambas
//     retornan siempre sendBnb y totalBnb para que execute-btn.js
//     pueda leer bnb de forma uniforme con un solo campo.
//
//  3. runAction() pasa el sendValue de la estimación previa a
//     runDistribute/runDrainOwner para evitar la doble lectura
//     de balance. Esto requiere que estimateAction() se llame
//     siempre antes de runAction() — el flujo en execute-btn.js
//     ya lo garantiza.
// ============================================================

import { getSession, getBalance } from '../core/provider.js';
import { toFloat }                from '../core/utils.js';
import { calculateTotalNeeded }   from './departments.js';
import { GAS_RESERVE_ETH }        from '../core/contract.js';

// Límite de gas para las funciones de distribución
const GAS_LIMIT = 600_000;

// Buffer adicional sobre GAS_RESERVE para cubrir el gas de la tx
// en la wallet del owner. 0.001 BNB ≈ margen para ~600k gas a 3 gwei.
const GAS_TX_BUFFER_ETH = '0.001';

// ============================================================
//  estimateDistribute()
//  Retorna: { sendValue, totalBnb, sendBnb, ownerBnb }
//  sendBnb === totalBnb para compatibilidad con execute-btn.js
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
      `Saldo insuficiente. Faltan ${falta} BNB (incluye reserva de gas ${(parseFloat(GAS_RESERVE_ETH) + parseFloat(GAS_TX_BUFFER_ETH)).toFixed(3)} BNB).`,
      { needed: totalBnb, owned: ownerBnb, missing: parseFloat(falta) }
    );
  }

  return {
    sendValue: totalNeeded,
    totalBnb,
    sendBnb: totalBnb,   // alias para uniformidad con drainOwner
    ownerBnb
  };
}

// ============================================================
//  estimateDrainOwner()
//  Retorna: { sendValue, sendBnb, totalBnb, ownerBnb }
//  totalBnb === sendBnb para compatibilidad con execute-btn.js
// ============================================================
export async function estimateDrainOwner() {
  const { account } = getSession();
  const ownerBal    = await getBalance(account);
  const reserve     = ethers.utils.parseEther(GAS_RESERVE_ETH);
  const txBuffer    = ethers.utils.parseEther(GAS_TX_BUFFER_ETH);
  const totalReserve = reserve.add(txBuffer);

  // Verificar underflow antes de .sub() — BigNumber en ethers v5
  // no lanza en operaciones negativas, retorna un valor incorrecto.
  if (ownerBal.lte(totalReserve)) {
    throw new BalanceError(
      `Saldo insuficiente para drainOwner. Mínimo ${(parseFloat(GAS_RESERVE_ETH) + parseFloat(GAS_TX_BUFFER_ETH)).toFixed(3)} BNB para gas.`,
      { owned: toFloat(ownerBal), missing: toFloat(totalReserve.sub(ownerBal)) }
    );
  }

  const sendValue = ownerBal.sub(totalReserve);
  const sendBnb   = toFloat(sendValue);

  return {
    sendValue,
    sendBnb,
    totalBnb: sendBnb,  // alias para uniformidad con distribute
    ownerBnb: toFloat(ownerBal)
  };
}

// ============================================================
//  runDistribute()
//  @param {ethers.BigNumber} [cachedSendValue]  — opcional, de estimateDistribute()
// ============================================================
export async function runDistribute(cachedSendValue) {
  const { contract } = getSession();

  // Si no se pasa sendValue cacheado, re-estimar
  const sendValue = cachedSendValue ?? (await estimateDistribute()).sendValue;
  const totalBnb  = toFloat(sendValue);

  const tx      = await contract.distribute({ value: sendValue, gasLimit: GAS_LIMIT });
  const receipt = await tx.wait();

  return { tx, receipt, sendValue, totalBnb };
}

// ============================================================
//  runDrainOwner()
//  CORRECCIÓN: acepta sendValue opcional para evitar doble
//  lectura de balance cuando estimateAction() ya fue llamado.
//  @param {ethers.BigNumber} [cachedSendValue]  — opcional, de estimateDrainOwner()
// ============================================================
export async function runDrainOwner(cachedSendValue) {
  const { contract } = getSession();

  // Si no se pasa sendValue cacheado, re-estimar (solo llamada directa)
  const sendValue = cachedSendValue ?? (await estimateDrainOwner()).sendValue;
  const sendBnb   = toFloat(sendValue);

  const tx      = await contract.drainOwner({ value: sendValue, gasLimit: GAS_LIMIT });
  const receipt = await tx.wait();

  return { tx, receipt, sendValue, sendBnb };
}

// ============================================================
//  runAction()
//  Ejecuta la acción usando el sendValue ya calculado por
//  estimateAction() para evitar doble lectura de balance.
//  @param {string}            action       'distribute' | 'drainOwner'
//  @param {ethers.BigNumber}  [sendValue]  de estimateAction()
// ============================================================
export async function runAction(action, sendValue) {
  if (action === 'drainOwner') return runDrainOwner(sendValue);
  return runDistribute(sendValue);
}

// ============================================================
//  estimateAction()
//  @param {string} action
// ============================================================
export async function estimateAction(action) {
  if (action === 'drainOwner') return estimateDrainOwner();
  return estimateDistribute();
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
