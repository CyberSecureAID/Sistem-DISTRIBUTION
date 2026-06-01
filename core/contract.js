// ============================================================
//  core/contract.js
//  Fuente única de verdad: dirección del contrato y ABI completo.
//  Importar desde cualquier módulo que necesite hablar con la chain.
// ============================================================

export const CONTRACT_ADDRESS = 'AQUÍ_TU_CONTRATO'; // <-- reemplazar tras desplegar

// ABI completo — todas las funciones del contrato RewardDistributor v2
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

  // ── Escritura: distribución ─────────────────────────────────
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
// Estas coinciden con GAS_RESERVE y MIN_AMOUNT del contrato.
// Si el contrato cambia, actualizar aquí también.
export const GAS_RESERVE_ETH = '0.003'; // BNB que se retiene en drainOwner
export const MIN_AMOUNT_ETH  = '0.001'; // mínimo configurable por empleado
