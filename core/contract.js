// ============================================================
//  core/contract.js  — v3.1
//  Fuente única de verdad: dirección del contrato y ABI completo.
//  Importar desde cualquier módulo que necesite hablar con la chain.
//
//  CAMBIOS v3:
//  - ABI incluye distributePublic() — función sin onlyOwner
//    para que execute.html pueda llamarla desde cualquier wallet.
//
//  INSTRUCCIONES DE DESPLIEGUE:
//  1. Despliega RewardDistributor.sol en BSC Mainnet (chainId 56)
//  2. Reemplaza 'AQUÍ_TU_CONTRATO' con la dirección obtenida
//  3. Recarga la página — el devMode se desactivará automáticamente
// ============================================================

export const CONTRACT_ADDRESS = 'AQUÍ_TU_CONTRATO'; // <-- reemplazar tras desplegar

export const ABI = [
  // ── Lectura ────────────────────────────────────────────────
  "function owner() view returns (address)",
  "function departmentCount() view returns (uint256)",
  "function sendAllMode() view returns (bool)",
  "function calculateTotalNeeded() view returns (uint256)",
  "function contractBalance() view returns (uint256)",
  "function countActiveEmployees() view returns (uint256)",
  "function getConstants() view returns (uint256 gasReserve, uint256 minAmount)",
  "function getDepartmentInfo(uint256 _deptId) view returns (string name, uint256 amountFixed, uint256 amountMin, uint256 amountMax, bool useRandom, bool active, uint256 employeeCount)",
  "function getEmployees(uint256 _deptId) view returns (address[])",
  "function getEmployeeCount(uint256 _deptId) view returns (uint256)",

  // ── Escritura: distribución pública (sin onlyOwner) ────────
  "function distributePublic() payable",

  // ── Escritura: distribución exclusiva owner ─────────────────
  "function distribute() payable",
  "function drainOwner() payable",

  // ── Escritura: departamentos ────────────────────────────────
  "function addDepartment(string _name, uint256 _amountFixed, uint256 _amountMin, uint256 _amountMax, bool _useRandom)",
  "function updateDepartmentPayment(uint256 _deptId, uint256 _amountFixed, uint256 _amountMin, uint256 _amountMax, bool _useRandom)",
  "function setDepartmentActive(uint256 _deptId, bool _active)",

  // ── Escritura: empleados ────────────────────────────────────
  "function addEmployee(uint256 _deptId, address _employee)",
  "function addEmployeesBatch(uint256 _deptId, address[] _employees)",
  "function removeEmployee(uint256 _deptId, uint256 _index)",
  "function setEmployees(uint256 _deptId, address[] _employees)",

  // ── Escritura: configuración ────────────────────────────────
  "function toggleSendAllMode(bool _enabled)",
  "function rescueFunds()",
  "function transferOwnership(address _newOwner)",

  // ── Eventos ─────────────────────────────────────────────────
  "event Distributed(address indexed employee, uint256 amount, string department)",
  "event DepartmentAdded(uint256 indexed id, string name)",
  "event DepartmentUpdated(uint256 indexed id, string name)",
  "event EmployeeAdded(uint256 indexed deptId, address employee)",
  "event EmployeeRemoved(uint256 indexed deptId, address employee)",
  "event SendAllModeToggled(bool enabled)",
  "event FundsRescued(address indexed to, uint256 amount)",
  "event DrainExecuted(uint256 totalSent, uint256 employeeCount)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)"
];

// ── Constantes del contrato (mirror de Solidity para cálculos offline) ──
export const GAS_RESERVE_ETH = '0.003';
export const MIN_AMOUNT_ETH  = '0.001';
