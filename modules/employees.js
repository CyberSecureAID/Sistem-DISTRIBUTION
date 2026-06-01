// ============================================================
//  modules/employees.js
//  Gestión de empleados: leer, añadir (individual y batch),
//  eliminar, reemplazar lista completa.
//  Depende de core/provider.js y core/utils.js.
// ============================================================

import { getSession }           from '../core/provider.js';
import { isValidAddress, parseAddressList } from '../core/utils.js';

// ============================================================
//  getEmployees()
//  Retorna el array de wallets de un departamento.
// ============================================================
export async function getEmployees(deptId) {
  const { contract } = getSession();
  return contract.getEmployees(deptId);
}

// ============================================================
//  getEmployeeCount()
//  Retorna el número de empleados en un departamento.
// ============================================================
export async function getEmployeeCount(deptId) {
  const { contract } = getSession();
  const count = await contract.getEmployeeCount(deptId);
  return count.toNumber();
}

// ============================================================
//  addEmployee()
//  Añade una sola wallet a un departamento.
//  Lanza error si la dirección no es válida.
// ============================================================
export async function addEmployee(deptId, address) {
  if (!isValidAddress(address)) throw new Error(`Dirección inválida: ${address}`);
  const { contract } = getSession();
  const tx = await contract.addEmployee(deptId, address);
  return tx.wait();
}

// ============================================================
//  addEmployeesBatch()
//  Añade múltiples wallets de una sola tx.
//  Acepta un array de strings ya validados, o un string raw
//  (una dirección por línea) que parsea internamente.
//
//  @param {number}          deptId
//  @param {string[]|string} input   array de wallets o texto raw
//  Retorna { receipt, added, skipped }.
// ============================================================
export async function addEmployeesBatch(deptId, input) {
  const addresses = Array.isArray(input)
    ? input.filter(isValidAddress)
    : parseAddressList(input);

  if (addresses.length === 0) {
    throw new Error('No se encontraron direcciones válidas.');
  }

  const { contract } = getSession();
  const tx = await contract.addEmployeesBatch(deptId, addresses);
  const receipt = await tx.wait();

  return { receipt, added: addresses.length };
}

// ============================================================
//  removeEmployee()
//  Elimina un empleado por índice dentro del departamento.
//  El índice es el de la posición en el array on-chain,
//  visible en getEmployees().
// ============================================================
export async function removeEmployee(deptId, index) {
  const { contract } = getSession();
  const tx = await contract.removeEmployee(deptId, index);
  return tx.wait();
}

// ============================================================
//  setEmployees()
//  Reemplaza toda la lista de empleados de un departamento.
//  Útil para hacer "sync" de una lista externa.
//
//  @param {number}   deptId
//  @param {string[]} addresses  array de wallets válidas
// ============================================================
export async function setEmployees(deptId, addresses) {
  const invalid = addresses.filter(a => !isValidAddress(a));
  if (invalid.length > 0) {
    throw new Error(`Direcciones inválidas: ${invalid.join(', ')}`);
  }
  const { contract } = getSession();
  const tx = await contract.setEmployees(deptId, addresses);
  return tx.wait();
}

// ============================================================
//  isEmployeeInDept()
//  Verifica si una wallet ya está en un departamento.
//  Útil para validación UI antes de intentar addEmployee().
// ============================================================
export async function isEmployeeInDept(deptId, address) {
  const employees = await getEmployees(deptId);
  const addr = address.toLowerCase();
  return employees.some(e => e.toLowerCase() === addr);
}
