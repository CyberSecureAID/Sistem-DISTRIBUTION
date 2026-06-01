// ============================================================
//  modules/departments.js  — v1.1
//  CRUD de departamentos: leer, crear, actualizar, activar.
//
//  CAMBIOS v1.1:
//  - Sin cambios funcionales. Comentarios actualizados.
//  - Depende de core/provider.js y core/utils.js.
// ============================================================

import { getSession }          from '../core/provider.js';
import { fEth, toBN }          from '../core/utils.js';

// ============================================================
//  getDepartment()
// ============================================================
export async function getDepartment(deptId) {
  const { contract } = getSession();
  const info = await contract.getDepartmentInfo(deptId);
  const [name, amountFixed, amountMin, amountMax, useRandom, active, employeeCount] = info;
  return { id: deptId, name, amountFixed, amountMin, amountMax, useRandom, active, employeeCount: employeeCount.toNumber() };
}

// ============================================================
//  getAllDepartments()
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
// ============================================================
export async function getActiveDepartments() {
  const all = await getAllDepartments();
  return all.filter(d => d.active && d.employeeCount > 0);
}

// ============================================================
//  addDepartment()
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
// ============================================================
export async function setDepartmentActive(deptId, active) {
  const { contract } = getSession();
  const tx = await contract.setDepartmentActive(deptId, active);
  return tx.wait();
}

// ============================================================
//  getSendAllMode()
// ============================================================
export async function getSendAllMode() {
  const { contract } = getSession();
  return contract.sendAllMode();
}

// ============================================================
//  toggleSendAllMode()
// ============================================================
export async function toggleSendAllMode(enabled) {
  const { contract } = getSession();
  const tx = await contract.toggleSendAllMode(enabled);
  return tx.wait();
}

// ============================================================
//  calculateTotalNeeded()
// ============================================================
export async function calculateTotalNeeded() {
  const { contract } = getSession();
  return contract.calculateTotalNeeded();
}

// ============================================================
//  formatDepartmentPayment()
// ============================================================
export function formatDepartmentPayment(dept) {
  if (dept.useRandom) {
    return `${fEth(dept.amountMin)}–${fEth(dept.amountMax)} BNB (rango)`;
  }
  return `${fEth(dept.amountFixed)} BNB (fijo)`;
}
