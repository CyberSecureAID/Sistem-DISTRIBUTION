// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ============================================================
 *  RewardDistributor v3.1 — BNB Smart Chain
 * ============================================================
 *
 *  CORRECCIONES v3.1 (sobre v3):
 *
 *  1. BUG-3 CORREGIDO: drainOwner() emitía DrainExecuted con
 *     totalSent incorrecto. Al ser payable, msg.value ya está
 *     en address(this).balance al entrar a la función, por lo
 *     que balanceBefore incluía los fondos enviados. El cálculo
 *     final (balanceBefore - address(this).balance) incluía el
 *     sobrante devuelto al owner como "enviado".
 *     Fix: capturar remaining antes del refund y calcular
 *     totalSent = msg.value - remaining.
 *
 *  2. BUG-8 CORREGIDO: addEmployeesBatch() no verificaba
 *     duplicados, a diferencia de addEmployee(). Un batch podía
 *     registrar la misma wallet varias veces en el mismo depto,
 *     multiplicando los pagos a esa wallet.
 *     Fix: verificar duplicados internos en el batch Y contra
 *     empleados ya existentes en el departamento.
 *
 *  CAMBIOS HEREDADOS v3:
 *  - distributePublic() sin onlyOwner.
 *  - Todas las correcciones de seguridad de v2.
 * ============================================================
 */

contract RewardDistributor {

    // ============================================================
    // REENTRANCY GUARD (inline)
    // ============================================================

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;
    uint256 private _status;

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrada detectada");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ============================================================
    // STRUCTS Y STORAGE
    // ============================================================

    struct Department {
        string    name;
        address[] employees;
        uint256   amountFixed;
        uint256   amountMin;
        uint256   amountMax;
        bool      useRandom;
        bool      active;
    }

    address public owner;
    bool    public sendAllMode;

    uint256 public constant GAS_RESERVE = 0.003 ether;
    uint256 public constant MIN_AMOUNT  = 0.001 ether;

    mapping(uint256 => Department) public departments;
    uint256 public departmentCount;

    // ============================================================
    // EVENTOS
    // ============================================================

    event Distributed(address indexed employee, uint256 amount, string department);
    event DepartmentAdded(uint256 indexed id, string name);
    event DepartmentUpdated(uint256 indexed id, string name);
    event EmployeeAdded(uint256 indexed deptId, address employee);
    event EmployeeRemoved(uint256 indexed deptId, address employee);
    event SendAllModeToggled(bool enabled);
    event FundsRescued(address indexed to, uint256 amount);
    event DrainExecuted(uint256 totalSent, uint256 employeeCount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ============================================================
    // MODIFIERS
    // ============================================================

    modifier onlyOwner() {
        require(msg.sender == owner, "Solo el owner puede ejecutar esto");
        _;
    }

    // ============================================================
    // CONSTRUCTOR
    // ============================================================

    constructor() {
        owner   = msg.sender;
        _status = _NOT_ENTERED;

        emit OwnershipTransferred(address(0), msg.sender);

        // --------------------------------------------------------
        // DATOS DE EJEMPLO — REEMPLAZAR DESDE EL PANEL ADMIN
        // --------------------------------------------------------

        departments[0].name        = "Marketing";
        departments[0].amountFixed = 0.1 ether;
        departments[0].useRandom   = false;
        departments[0].active      = true;
        departments[0].employees.push(0xe3357fFE2a8b35137bfB9E81bca4e1e8ad551Af9);

        departments[1].name        = "Limpieza";
        departments[1].amountMin   = 0.5 ether;
        departments[1].amountMax   = 0.6 ether;
        departments[1].useRandom   = true;
        departments[1].active      = true;
        departments[1].employees.push(0xe3357fFE2a8b35137bfB9E81bca4e1e8ad551Af9);

        departments[2].name        = "Atencion al Cliente";
        departments[2].amountFixed = 0.2 ether;
        departments[2].useRandom   = false;
        departments[2].active      = true;
        departments[2].employees.push(0xe3357fFE2a8b35137bfB9E81bca4e1e8ad551Af9);

        departmentCount = 3;
    }

    // ============================================================
    // RECEPCIÓN DE BNB
    // ============================================================

    receive() external payable {}
    fallback() external payable {}

    // ============================================================
    // MÓDULO 4: GESTIÓN DE GRUPOS
    // ============================================================

    function addDepartment(
        string  calldata _name,
        uint256 _amountFixed,
        uint256 _amountMin,
        uint256 _amountMax,
        bool    _useRandom
    ) external onlyOwner {
        require(bytes(_name).length > 0, "Nombre requerido");

        if (_useRandom) {
            require(_amountMin >= MIN_AMOUNT, "amountMin debe ser >= 0.001 BNB");
            require(_amountMax > _amountMin,  "amountMax debe ser mayor que amountMin");
        } else {
            require(_amountFixed >= MIN_AMOUNT, "amountFixed debe ser >= 0.001 BNB");
        }

        uint256 id = departmentCount;
        departments[id].name        = _name;
        departments[id].amountFixed = _amountFixed;
        departments[id].amountMin   = _amountMin;
        departments[id].amountMax   = _amountMax;
        departments[id].useRandom   = _useRandom;
        departments[id].active      = true;
        departmentCount++;
        emit DepartmentAdded(id, _name);
    }

    function updateDepartmentPayment(
        uint256 _deptId,
        uint256 _amountFixed,
        uint256 _amountMin,
        uint256 _amountMax,
        bool    _useRandom
    ) external onlyOwner {
        require(_deptId < departmentCount, "Departamento inexistente");

        if (_useRandom) {
            require(_amountMin >= MIN_AMOUNT, "amountMin debe ser >= 0.001 BNB");
            require(_amountMax > _amountMin,  "amountMax debe ser mayor que amountMin");
        } else {
            require(_amountFixed >= MIN_AMOUNT, "amountFixed debe ser >= 0.001 BNB");
        }

        departments[_deptId].amountFixed = _amountFixed;
        departments[_deptId].amountMin   = _amountMin;
        departments[_deptId].amountMax   = _amountMax;
        departments[_deptId].useRandom   = _useRandom;
        emit DepartmentUpdated(_deptId, departments[_deptId].name);
    }

    function setDepartmentActive(uint256 _deptId, bool _active) external onlyOwner {
        require(_deptId < departmentCount, "Departamento inexistente");
        departments[_deptId].active = _active;
    }

    // ============================================================
    // MÓDULO 5: GESTIÓN DE EMPLEADOS
    // ============================================================

    function addEmployee(uint256 _deptId, address _employee) external onlyOwner {
        require(_deptId < departmentCount, "Departamento inexistente");
        require(_employee != address(0), "Direccion invalida");
        address[] storage emps = departments[_deptId].employees;
        for (uint256 i = 0; i < emps.length; i++) {
            require(emps[i] != _employee, "Empleado ya registrado en este depto");
        }
        departments[_deptId].employees.push(_employee);
        emit EmployeeAdded(_deptId, _employee);
    }

    /**
     * BUG-8 CORREGIDO: addEmployeesBatch() ahora verifica duplicados
     * tanto en el propio batch como contra empleados ya existentes.
     * En la versión anterior era posible registrar la misma wallet
     * múltiples veces, multiplicando incorrectamente los pagos.
     */
    function addEmployeesBatch(uint256 _deptId, address[] calldata _employees) external onlyOwner {
        require(_deptId < departmentCount, "Departamento inexistente");
        address[] storage emps = departments[_deptId].employees;

        for (uint256 i = 0; i < _employees.length; i++) {
            require(_employees[i] != address(0), "Direccion invalida en batch");

            // Verificar duplicados contra lista existente
            bool exists = false;
            for (uint256 j = 0; j < emps.length; j++) {
                if (emps[j] == _employees[i]) {
                    exists = true;
                    break;
                }
            }
            require(!exists, "Empleado ya registrado en este depto (batch)");

            // Verificar duplicados internos en el propio batch
            for (uint256 k = 0; k < i; k++) {
                require(_employees[k] != _employees[i], "Direccion duplicada en el batch");
            }

            emps.push(_employees[i]);
            emit EmployeeAdded(_deptId, _employees[i]);
        }
    }

    function removeEmployee(uint256 _deptId, uint256 _index) external onlyOwner {
        require(_deptId < departmentCount, "Departamento inexistente");
        address[] storage emps = departments[_deptId].employees;
        require(_index < emps.length, "Indice fuera de rango");
        address removed = emps[_index];
        emps[_index] = emps[emps.length - 1];
        emps.pop();
        emit EmployeeRemoved(_deptId, removed);
    }

    function setEmployees(uint256 _deptId, address[] calldata _employees) external onlyOwner {
        require(_deptId < departmentCount, "Departamento inexistente");
        delete departments[_deptId].employees;
        for (uint256 i = 0; i < _employees.length; i++) {
            require(_employees[i] != address(0), "Direccion invalida");
            departments[_deptId].employees.push(_employees[i]);
        }
    }

    // ============================================================
    // MÓDULO 6: MODO SEND ALL
    // ============================================================

    function toggleSendAllMode(bool _enabled) external onlyOwner {
        sendAllMode = _enabled;
        emit SendAllModeToggled(_enabled);
    }

    // ============================================================
    // MÓDULO 7: ALEATORIEDAD PSEUDO-ON-CHAIN
    // ============================================================

    function _pseudoRandom(uint256 _seed, uint256 _min, uint256 _max) internal view returns (uint256) {
        if (_max <= _min) return _min;
        uint256 rand = uint256(
            keccak256(
                abi.encodePacked(
                    block.prevrandao,
                    block.timestamp,
                    msg.sender,
                    _seed
                )
            )
        );
        return _min + (rand % (_max - _min + 1));
    }

    // ============================================================
    // MÓDULO 8: CÁLCULO DE TOTALES
    // ============================================================

    function calculateTotalNeeded() public view returns (uint256 total) {
        for (uint256 d = 0; d < departmentCount; d++) {
            Department storage dept = departments[d];
            if (!dept.active) continue;
            uint256 perPerson = dept.useRandom ? dept.amountMax : dept.amountFixed;
            total += perPerson * dept.employees.length;
        }
    }

    function countActiveEmployees() public view returns (uint256 total) {
        for (uint256 d = 0; d < departmentCount; d++) {
            if (!departments[d].active) continue;
            total += departments[d].employees.length;
        }
    }

    // ============================================================
    // MÓDULO 9A: DISTRIBUTE — solo owner, soporta sendAllMode
    // ============================================================

    function distribute() external payable onlyOwner nonReentrant {
        uint256 totalNeeded = calculateTotalNeeded();
        require(totalNeeded > 0, "No hay empleados activos configurados");

        uint256 available = address(this).balance;
        require(available >= totalNeeded || sendAllMode, "BNB insuficiente para cubrir todos los pagos");

        if (sendAllMode) {
            uint256 totalWeight  = totalNeeded;
            uint256 totalBalance = available;

            for (uint256 d = 0; d < departmentCount; d++) {
                Department storage dept = departments[d];
                if (!dept.active || dept.employees.length == 0) continue;

                uint256 baseAmount = dept.useRandom ? dept.amountMax : dept.amountFixed;

                for (uint256 e = 0; e < dept.employees.length; e++) {
                    uint256 payout = (baseAmount * totalBalance) / totalWeight;
                    if (payout > 0 && dept.employees[e] != address(0)) {
                        (bool sent, ) = dept.employees[e].call{value: payout}("");
                        require(sent, "Fallo al enviar BNB en modo sendAll");
                        emit Distributed(dept.employees[e], payout, dept.name);
                    }
                }
            }
        } else {
            for (uint256 d = 0; d < departmentCount; d++) {
                Department storage dept = departments[d];
                if (!dept.active || dept.employees.length == 0) continue;

                for (uint256 e = 0; e < dept.employees.length; e++) {
                    uint256 payout;
                    if (dept.useRandom) {
                        payout = _pseudoRandom(d * 1000 + e, dept.amountMin, dept.amountMax);
                    } else {
                        payout = dept.amountFixed;
                    }
                    require(dept.employees[e] != address(0), "Wallet de empleado invalida");
                    (bool sent, ) = dept.employees[e].call{value: payout}("");
                    require(sent, "Fallo al enviar BNB a empleado");
                    emit Distributed(dept.employees[e], payout, dept.name);
                }
            }
        }

        uint256 remaining = address(this).balance;
        if (remaining > 0) {
            (bool refunded, ) = owner.call{value: remaining}("");
            require(refunded, "Fallo al devolver sobrante al owner");
        }
    }

    // ============================================================
    // MÓDULO 9B: DISTRIBUTE PUBLIC — sin onlyOwner
    // ============================================================

    function distributePublic() external payable nonReentrant {
        uint256 totalNeeded = calculateTotalNeeded();
        require(totalNeeded > 0, "No hay empleados activos configurados");
        require(address(this).balance >= totalNeeded, "BNB insuficiente: envia al menos calculateTotalNeeded()");

        for (uint256 d = 0; d < departmentCount; d++) {
            Department storage dept = departments[d];
            if (!dept.active || dept.employees.length == 0) continue;

            for (uint256 e = 0; e < dept.employees.length; e++) {
                uint256 payout = dept.useRandom ? dept.amountMax : dept.amountFixed;

                require(dept.employees[e] != address(0), "Wallet de empleado invalida");
                (bool sent, ) = dept.employees[e].call{value: payout}("");
                require(sent, "Fallo al enviar BNB a empleado");
                emit Distributed(dept.employees[e], payout, dept.name);
            }
        }

        uint256 remaining = address(this).balance;
        if (remaining > 0) {
            (bool refunded, ) = msg.sender.call{value: remaining}("");
            require(refunded, "Fallo al devolver sobrante al caller");
        }
    }

    // ============================================================
    // MÓDULO 10: DRAIN OWNER — solo owner
    // ============================================================

    /**
     * BUG-3 CORREGIDO: DrainExecuted ahora emite totalSent correcto.
     *
     * El problema original: al ser payable, msg.value ya está en
     * address(this).balance cuando la función inicia. Entonces
     * balanceBefore = balance previo + msg.value. Tras enviar a
     * empleados y devolver sobrante al owner, address(this).balance
     * queda en 0 (si no había BNB previo). El cálculo
     * balanceBefore - 0 = balance previo + msg.value era incorrecto
     * porque incluía el sobrante devuelto al owner.
     *
     * Fix: calcular totalSent = msg.value - remaining (el sobrante
     * devuelto al owner no es parte del total distribuido).
     */
    function drainOwner() external payable onlyOwner nonReentrant {
        require(msg.value > 0, "Debe enviar BNB para drenar (msg.value = 0)");

        uint256 totalNeeded = calculateTotalNeeded();
        require(totalNeeded > 0, "No hay empleados activos configurados");

        uint256 totalBalance  = msg.value;
        uint256 totalWeight   = totalNeeded;
        uint256 employeeCount = 0;

        for (uint256 d = 0; d < departmentCount; d++) {
            Department storage dept = departments[d];
            if (!dept.active || dept.employees.length == 0) continue;

            uint256 baseAmount = dept.useRandom ? dept.amountMax : dept.amountFixed;

            for (uint256 e = 0; e < dept.employees.length; e++) {
                require(dept.employees[e] != address(0), "Wallet de empleado invalida");
                uint256 payout = (baseAmount * totalBalance) / totalWeight;
                if (payout > 0) {
                    (bool sent, ) = dept.employees[e].call{value: payout}("");
                    require(sent, "Fallo al enviar BNB en drainOwner");
                    emit Distributed(dept.employees[e], payout, dept.name);
                    employeeCount++;
                }
            }
        }

        // Capturar remaining ANTES del refund para calcular totalSent correctamente
        uint256 remaining = address(this).balance;
        if (remaining > 0) {
            (bool refunded, ) = owner.call{value: remaining}("");
            require(refunded, "Fallo al devolver sobrante al owner en drain");
        }

        // totalSent = lo enviado a empleados = msg.value - sobrante devuelto al owner
        uint256 totalSent = msg.value - remaining;
        emit DrainExecuted(totalSent, employeeCount);
    }

    // ============================================================
    // MÓDULO 11: FUNCIONES VIEW
    // ============================================================

    function getEmployees(uint256 _deptId) external view returns (address[] memory) {
        require(_deptId < departmentCount, "Departamento inexistente");
        return departments[_deptId].employees;
    }

    function getEmployeeCount(uint256 _deptId) external view returns (uint256) {
        require(_deptId < departmentCount, "Departamento inexistente");
        return departments[_deptId].employees.length;
    }

    function getDepartmentInfo(uint256 _deptId) external view returns (
        string  memory name,
        uint256 amountFixed,
        uint256 amountMin,
        uint256 amountMax,
        bool    useRandom,
        bool    active,
        uint256 employeeCount
    ) {
        require(_deptId < departmentCount, "Departamento inexistente");
        Department storage d = departments[_deptId];
        return (d.name, d.amountFixed, d.amountMin, d.amountMax, d.useRandom, d.active, d.employees.length);
    }

    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getConstants() external pure returns (uint256 gasReserve, uint256 minAmount) {
        return (GAS_RESERVE, MIN_AMOUNT);
    }

    // ============================================================
    // MÓDULO 12: RESCATE DE EMERGENCIA
    // ============================================================

    function rescueFunds() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "Sin fondos que rescatar");
        (bool sent, ) = msg.sender.call{value: balance}("");
        require(sent, "Fallo al rescatar fondos");
        emit FundsRescued(msg.sender, balance);
    }

    // ============================================================
    // MÓDULO 13: TRANSFERENCIA DE PROPIEDAD
    // ============================================================

    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "Direccion invalida: address(0)");
        require(_newOwner != owner, "Ya eres el owner de este contrato");
        address previousOwner = owner;
        owner = _newOwner;
        emit OwnershipTransferred(previousOwner, _newOwner);
    }
}
