// ============================================================
//  modules/employees.js  — v1.0
//  Gestión de empleados: leer, añadir, eliminar, reemplazar.
// ============================================================

import { getSession }           from '../core/provider.js';
import { isValidAddress, parseAddressList } from '../core/utils.js';

export async function getEmployees(deptId) {
  const { contract } = getSession();
  return contract.getEmployees(deptId);
}

export async function getEmployeeCount(deptId) {
  const { contract } = getSession();
  const count = await contract.getEmployeeCount(deptId);
  return count.toNumber();
}

export async function addEmployee(deptId, address) {
  if (!isValidAddress(address)) throw new Error(`Dirección inválida: ${address}`);
  const { contract } = getSession();
  const tx = await contract.addEmployee(deptId, address);
  return tx.wait();
}

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

export async function removeEmployee(deptId, index) {
  const { contract } = getSession();
  const tx = await contract.removeEmployee(deptId, index);
  return tx.wait();
}

export async function setEmployees(deptId, addresses) {
  const invalid = addresses.filter(a => !isValidAddress(a));
  if (invalid.length > 0) {
    throw new Error(`Direcciones inválidas: ${invalid.join(', ')}`);
  }
  const { contract } = getSession();
  const tx = await contract.setEmployees(deptId, addresses);
  return tx.wait();
}

export async function isEmployeeInDept(deptId, address) {
  const employees = await getEmployees(deptId);
  const addr = address.toLowerCase();
  return employees.some(e => e.toLowerCase() === addr);
}
