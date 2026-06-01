// ============================================================
//  modules/departments.js
//  CRUD de departamentos: leer, crear, actualizar, activar.
//  Depende de core/provider.js y core/utils.js.
// ============================================================

import { getSession }          from '../core/provider.js';
import { fEth, toBN }          from '../core/utils.js';

// ============================================================
//  getDepartment()
//  Retorna el snapshot de un departamento individual.
// ============================================================
export async function getDepartment(deptId) {
  const { contract } = getSession();
  const info = await contract.getDepartmentInfo(deptId);
  const [name, amountFixed, amountMin, amountMax, useRandom, active, employeeCount] = info;
  return { id: deptId, name, amountFixed, amountMin, amountMax, useRandom, active, employeeCount: employeeCount.toNumber() };
}

// ============================================================
//  getAllDepartments()
//  Retorna array con todos los departamentos del contrato.
// ============================================================
export async function getAllDepartments() {
  const { contract } = getSession();
  const count = (await contract.departmentCount()).toNumber();
  const depts = [];
  for (let i = 0; i < count; i++) {
    depts.push(await getDepartment(i));
  }
  return depts;
}

// ============================================================
//  getActiveDepartments()
//  Solo los departamentos activos con al menos un empleado.
// ============================================================
export async function getActiveDepartments() {
  const all = await getAllDepartments();
  return all.filter(d => d.active && d.employeeCount > 0);
}

// ============================================================
//  addDepartment()
//  Crea un nuevo departamento on-chain.
//  @param {object} params
//    name        string
//    amountFixed string  BNB (ej: '0.100')
//    amountMin   string  BNB
//    amountMax   string  BNB
//    useRandom   bool
//  Retorna el receipt de la tx.
// ============================================================
export async function addDepartment({ name, amountFixed, amountMin, amountMax, useRandom }) {
  const { contract } = getSession();
  const tx = await contract.addDepartment(
    name,
    toBN(amountFixed),
    toBN(amountMin),
    toBN(amountMax),
    useRandom
  );
  return tx.wait();
}

// ============================================================
//  updateDepartmentPayment()
//  Actualiza la configuración de pago de un departamento.
// ============================================================
export async function updateDepartmentPayment(deptId, { amountFixed, amountMin, amountMax, useRandom }) {
  const { contract } = getSession();
  const tx = await contract.updateDepartmentPayment(
    deptId,
    toBN(amountFixed),
    toBN(amountMin),
    toBN(amountMax),
    useRandom
  );
  return tx.wait();
}

// ============================================================
//  setDepartmentActive()
//  Activa o desactiva un departamento.
// ============================================================
export async function setDepartmentActive(deptId, active) {
  const { contract } = getSession();
  const tx = await contract.setDepartmentActive(deptId, active);
  return tx.wait();
}

// ============================================================
//  getSendAllMode()
//  Lee el estado actual del modo Send All.
// ============================================================
export async function getSendAllMode() {
  const { contract } = getSession();
  return contract.sendAllMode();
}

// ============================================================
//  toggleSendAllMode()
//  Activa o desactiva el modo Send All on-chain.
// ============================================================
export async function toggleSendAllMode(enabled) {
  const { contract } = getSession();
  const tx = await contract.toggleSendAllMode(enabled);
  return tx.wait();
}

// ============================================================
//  calculateTotalNeeded()
//  Retorna el BigNumber con el total de BNB necesario.
// ============================================================
export async function calculateTotalNeeded() {
  const { contract } = getSession();
  return contract.calculateTotalNeeded();
}

// ============================================================
//  formatDepartmentPayment()
//  Helper de presentación: devuelve string legible del pago.
//  Ej: "0.1000 BNB (fijo)"  /  "0.0500–0.1000 BNB (rango)"
// ============================================================
export function formatDepartmentPayment(dept) {
  if (dept.useRandom) {
    return `${fEth(dept.amountMin)}–${fEth(dept.amountMax)} BNB (rango)`;
  }
  return `${fEth(dept.amountFixed)} BNB (fijo)`;
}
