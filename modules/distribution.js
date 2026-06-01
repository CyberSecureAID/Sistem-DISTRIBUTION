// ============================================================
//  modules/distribution.js
//  Lógica de ejecución de pagos: distribute() y drainOwner().
//  Calcula el value a enviar, valida saldo, ejecuta la tx.
//  Depende de core/provider.js y core/utils.js.
// ============================================================

import { getSession, getBalance } from '../core/provider.js';
import { toFloat }                from '../core/utils.js';
import { calculateTotalNeeded }   from './departments.js';
import { GAS_RESERVE_ETH }        from '../core/contract.js';

// Límite de gas para las funciones de distribución
const GAS_LIMIT = 600_000;

// ============================================================
//  estimateDistribute()
//  Calcula cuánto BNB se enviará en modo distribute().
//  Retorna { sendValue: BigNumber, totalBnb: number, ownerBnb: number }.
//  Lanza BalanceError si el saldo no alcanza.
// ============================================================
export async function estimateDistribute() {
  const { account } = getSession();

  const [totalNeeded, ownerBal] = await Promise.all([
    calculateTotalNeeded(),
    getBalance(account)
  ]);

  const reserve   = ethers.utils.parseEther(GAS_RESERVE_ETH);
  const totalBnb  = toFloat(totalNeeded);
  const ownerBnb  = toFloat(ownerBal);
  const reserveBnb = toFloat(reserve);

  if (ownerBnb < totalBnb + reserveBnb) {
    const falta = (totalBnb + reserveBnb - ownerBnb).toFixed(4);
    throw new BalanceError(
      `Saldo insuficiente. Faltan ${falta} BNB (incluye reserva de gas ${GAS_RESERVE_ETH} BNB).`,
      { needed: totalBnb, owned: ownerBnb, missing: parseFloat(falta) }
    );
  }

  return { sendValue: totalNeeded, totalBnb, ownerBnb };
}

// ============================================================
//  estimateDrainOwner()
//  Calcula cuánto BNB se enviará en modo drainOwner().
//  sendValue = ownerBalance - GAS_RESERVE
//  Retorna { sendValue: BigNumber, sendBnb: number, ownerBnb: number }.
//  Lanza BalanceError si el saldo neto es <= 0.
// ============================================================
export async function estimateDrainOwner() {
  const { account } = getSession();
  const ownerBal    = await getBalance(account);
  const reserve     = ethers.utils.parseEther(GAS_RESERVE_ETH);
  const sendValue   = ownerBal.sub(reserve);

  if (sendValue.lte(0)) {
    throw new BalanceError(
      `Saldo insuficiente para drainOwner. Mínimo ${GAS_RESERVE_ETH} BNB para gas.`,
      { owned: toFloat(ownerBal), missing: toFloat(reserve.sub(ownerBal)) }
    );
  }

  return {
    sendValue,
    sendBnb:  toFloat(sendValue),
    ownerBnb: toFloat(ownerBal)
  };
}

// ============================================================
//  runDistribute()
//  Ejecuta distribute() con el value calculado por estimateDistribute().
//  Retorna { tx, receipt, sendValue, totalBnb }.
// ============================================================
export async function runDistribute() {
  const { contract }             = getSession();
  const { sendValue, totalBnb }  = await estimateDistribute();

  const tx      = await contract.distribute({ value: sendValue, gasLimit: GAS_LIMIT });
  const receipt = await tx.wait();

  return { tx, receipt, sendValue, totalBnb };
}

// ============================================================
//  runDrainOwner()
//  Ejecuta drainOwner() con value = ownerBalance - GAS_RESERVE.
//  Retorna { tx, receipt, sendValue, sendBnb }.
// ============================================================
export async function runDrainOwner() {
  const { contract }            = getSession();
  const { sendValue, sendBnb }  = await estimateDrainOwner();

  const tx      = await contract.drainOwner({ value: sendValue, gasLimit: GAS_LIMIT });
  const receipt = await tx.wait();

  return { tx, receipt, sendValue, sendBnb };
}

// ============================================================
//  runAction()
//  Punto de entrada unificado. Ejecuta la acción configurada.
//  @param {'distribute'|'drainOwner'} action
//  Retorna el resultado de runDistribute() o runDrainOwner().
// ============================================================
export async function runAction(action) {
  if (action === 'drainOwner') return runDrainOwner();
  return runDistribute();
}

// ============================================================
//  estimateAction()
//  Estima sin ejecutar. Útil para mostrar el amount antes de
//  pedir confirmación en la wallet.
//  @param {'distribute'|'drainOwner'} action
// ============================================================
export async function estimateAction(action) {
  if (action === 'drainOwner') return estimateDrainOwner();
  return estimateDistribute();
}

// ============================================================
//  rescueFunds()
//  Extrae BNB atrapado en el contrato hacia el owner.
// ============================================================
export async function rescueFunds() {
  const { contract } = getSession();
  const tx = await contract.rescueFunds();
  return tx.wait();
}

// ============================================================
//  BalanceError — error tipado para distinguir falta de fondos
//  de otros errores de ejecución.
// ============================================================
export class BalanceError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name    = 'BalanceError';
    this.details = details;
  }
}
