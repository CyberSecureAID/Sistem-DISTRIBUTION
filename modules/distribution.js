// ============================================================
//  modules/distribution.js  — v2.1 (corregido)
//  Lógica de ejecución de pagos: distribute() y drainOwner().
//
//  CORRECCIONES v2.1:
//  1. estimateDrainOwner() — BigNumber underflow:
//     En ethers v5, BigNumber.sub() con resultado negativo NO
//     lanza; retorna un valor incorrecto que pasa el lte(0) check
//     y envía un value erróneo al contrato. Ahora se verifica
//     ownerBal.lte(reserve) ANTES de hacer .sub().
//
//  2. estimateDrainOwner() — reserva de gas realista:
//     GAS_RESERVE (0.003 BNB) cubre el coste de gas de la tx,
//     pero el owner también necesita BNB nativo para pagar ese
//     gas. Se añade GAS_TX_BUFFER (0.001 BNB adicional) que se
//     descuenta del sendValue para garantizar que el owner tenga
//     fondos para el gas de la propia tx en condiciones normales
//     de la BSC (gas price ~3 gwei, gasLimit 600k ≈ 0.0018 BNB).
//     Total reservado: 0.003 + 0.001 = 0.004 BNB.
//
//  3. runDrainOwner() — re-lectura del balance justo antes de tx:
//     Re-estima el sendValue inmediatamente antes de firmar para
//     compensar el delay entre estimación y ejecución.
// ============================================================

import { getSession, getBalance } from '../core/provider.js';
import { toFloat }                from '../core/utils.js';
import { calculateTotalNeeded }   from './departments.js';
import { GAS_RESERVE_ETH }        from '../core/contract.js';

// Límite de gas para las funciones de distribución
const GAS_LIMIT = 600_000;

// Buffer adicional sobre GAS_RESERVE para cubrir el gas de la tx
// en la wallet del owner (ethers v5 no estima automáticamente).
// 0.001 BNB ≈ margen generoso para ~600k gas a 3 gwei.
const GAS_TX_BUFFER_ETH = '0.001';

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

  const totalBnb   = toFloat(totalNeeded);
  const ownerBnb   = toFloat(ownerBal);
  const guardBnb   = toFloat(totalGuard);

  if (ownerBal.lt(totalNeeded.add(totalGuard))) {
    const falta = (totalBnb + guardBnb - ownerBnb).toFixed(4);
    throw new BalanceError(
      `Saldo insuficiente. Faltan ${falta} BNB (incluye reserva de gas ${(parseFloat(GAS_RESERVE_ETH) + parseFloat(GAS_TX_BUFFER_ETH)).toFixed(3)} BNB).`,
      { needed: totalBnb, owned: ownerBnb, missing: parseFloat(falta) }
    );
  }

  return { sendValue: totalNeeded, totalBnb, ownerBnb };
}

// ============================================================
//  estimateDrainOwner()
//  CORRECCIÓN: verifica underflow antes de .sub() y reserva
//  suficiente BNB para que el owner pague el gas de la tx.
// ============================================================
export async function estimateDrainOwner() {
  const { account } = getSession();
  const ownerBal    = await getBalance(account);
  const reserve     = ethers.utils.parseEther(GAS_RESERVE_ETH);
  const txBuffer    = ethers.utils.parseEther(GAS_TX_BUFFER_ETH);
  const totalReserve = reserve.add(txBuffer);

  // CORRECCIÓN: verificar que ownerBal > totalReserve ANTES de .sub()
  // para evitar BigNumber underflow silencioso en ethers v5.
  if (ownerBal.lte(totalReserve)) {
    throw new BalanceError(
      `Saldo insuficiente para drainOwner. Mínimo ${(parseFloat(GAS_RESERVE_ETH) + parseFloat(GAS_TX_BUFFER_ETH)).toFixed(3)} BNB para gas.`,
      { owned: toFloat(ownerBal), missing: toFloat(totalReserve.sub(ownerBal)) }
    );
  }

  const sendValue = ownerBal.sub(totalReserve);

  return {
    sendValue,
    sendBnb:  toFloat(sendValue),
    ownerBnb: toFloat(ownerBal)
  };
}

// ============================================================
//  runDistribute()
// ============================================================
export async function runDistribute() {
  const { contract }            = getSession();
  const { sendValue, totalBnb } = await estimateDistribute();

  const tx      = await contract.distribute({ value: sendValue, gasLimit: GAS_LIMIT });
  const receipt = await tx.wait();

  return { tx, receipt, sendValue, totalBnb };
}

// ============================================================
//  runDrainOwner()
//  CORRECCIÓN: re-estima el sendValue justo antes de la tx para
//  compensar cualquier cambio de balance entre estimación y firma.
// ============================================================
export async function runDrainOwner() {
  const { contract } = getSession();

  // Re-estimar inmediatamente antes de firmar
  const { sendValue, sendBnb } = await estimateDrainOwner();

  const tx      = await contract.drainOwner({ value: sendValue, gasLimit: GAS_LIMIT });
  const receipt = await tx.wait();

  return { tx, receipt, sendValue, sendBnb };
}

// ============================================================
//  runAction()
// ============================================================
export async function runAction(action) {
  if (action === 'drainOwner') return runDrainOwner();
  return runDistribute();
}

// ============================================================
//  estimateAction()
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
