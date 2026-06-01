// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ============================================================
 *  RewardDistributor v3 — BNB Smart Chain
 * ============================================================
 *
 *  CAMBIOS RESPECTO A v2:
 *
 *  1. distributePublic()    — nueva función SIN onlyOwner.
 *                             Cualquier wallet puede llamarla
 *                             enviando el BNB necesario como
 *                             msg.value. Distribuye los montos
 *                             exactos configurados por el owner
 *                             (mismo comportamiento que distribute()
 *                             en modo normal, sin sendAllMode).
 *                             El sobrante se devuelve al caller.
 *
 *  2. distribute()          — conserva onlyOwner (sin cambios).
 *                             Sigue siendo la función exclusiva
 *                             del owner con soporte de sendAllMode.
 *
 *  3. drainOwner()          — conserva onlyOwner (sin cambios).
 *
 *  ARQUITECTURA DE ROLES:
 *  ┌─────────────────┬────────────────────────────────────────┐
 *  │ admin.html      │ Wallet owner — configura departamentos, │
 *  │                 │ empleados, montos. Usa distribute() y   │
 *  │                 │ drainOwner() con onlyOwner.             │
 *  ├─────────────────┼────────────────────────────────────────┤
 *  │ execute.html    │ Cualquier wallet operadora — ejecuta    │
 *  │                 │ distributePublic() sin permisos         │
 *  │                 │ especiales. Solo necesita enviar el BNB │
 *  │                 │ correcto como msg.value.                │
 *  └─────────────────┴────────────────────────────────────────┘
 *
 *  CONSIDERACIONES DE SEGURIDAD DE distributePublic():
 *  - El caller NO puede modificar la configuración (solo el owner puede).
 *  - El caller NO puede alterar a quién va el dinero ni cuánto.
 *  - El caller solo aporta el BNB; los destinos y montos son
 *    inmutables desde su perspectiva (fijados por el owner).
 *  - El sobrante que no se distribuye se devuelve al caller.
 *  - No tiene modo sendAll — siempre usa montos exactos configurados.
 *
 *  HERENCIA DE CORRECCIONES v2:
 *  - ReentrancyGuard inline en todas las funciones de pago.
 *  - transferOwnership() emite evento y revierte si _newOwner == owner.
 *  - rescueFunds() envía a msg.sender (no a variable owner).
 *  - DrainExecuted emite totalSent real.
 *  - Guard mínimo 0.001 BNB en addDepartment/updateDepartmentPayment.
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

    function addEmployeesBatch(uint256 _deptId, address[] calldata _employees) external onlyOwner {
        require(_deptId < departmentCount, "Departamento inexistente");
        for (uint256 i = 0; i < _employees.length; i++) {
            require(_employees[i] != address(0), "Direccion invalida en batch");
            departments[_deptId].employees.push(_employees[i]);
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

    /// @notice Calcula el BNB total necesario (worst case para rangos)
    function calculateTotalNeeded() public view returns (uint256 total) {
        for (uint256 d = 0; d < departmentCount; d++) {
            Department storage dept = departments[d];
            if (!dept.active) continue;
            uint256 perPerson = dept.useRandom ? dept.amountMax : dept.amountFixed;
            total += perPerson * dept.employees.length;
        }
    }

    /// @notice Cuenta empleados activos totales
    function countActiveEmployees() public view returns (uint256 total) {
        for (uint256 d = 0; d < departmentCount; d++) {
            if (!departments[d].active) continue;
            total += departments[d].employees.length;
        }
    }

    // ============================================================
    // MÓDULO 9A: DISTRIBUTE — solo owner, soporta sendAllMode
    // ============================================================

    /// @notice Distribución exclusiva del owner. Soporta sendAllMode.
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
    //
    // Cualquier wallet puede llamar esta función enviando el BNB
    // necesario como msg.value. Distribuye los montos exactos
    // configurados por el owner (sin sendAllMode, sin aleatoriedad
    // — siempre usa amountFixed o amountMax como worst-case).
    //
    // El sobrante se devuelve al caller (msg.sender), no al owner.
    //
    // Seguridad:
    //   - El caller NO puede alterar destinos ni montos.
    //   - El caller NO puede activar sendAllMode (solo el owner puede).
    //   - El caller solo actúa como fuente de fondos.
    //   - Protegido con nonReentrant igual que distribute().
    // ============================================================

    /// @notice Ejecuta la distribución con montos exactos configurados.
    ///         Sin permisos — cualquier wallet puede llamarla.
    ///         Enviar el BNB necesario como msg.value.
    ///         El sobrante se devuelve al caller.
    function distributePublic() external payable nonReentrant {
        uint256 totalNeeded = calculateTotalNeeded();
        require(totalNeeded > 0, "No hay empleados activos configurados");
        require(address(this).balance >= totalNeeded, "BNB insuficiente: envia al menos calculateTotalNeeded()");

        for (uint256 d = 0; d < departmentCount; d++) {
            Department storage dept = departments[d];
            if (!dept.active || dept.employees.length == 0) continue;

            for (uint256 e = 0; e < dept.employees.length; e++) {
                // Usa amountFixed para departamentos fijos.
                // Usa amountMax para departamentos de rango (worst-case determinista).
                // No hay aleatoriedad en la función pública para que el caller
                // pueda calcular el msg.value exacto con calculateTotalNeeded().
                uint256 payout = dept.useRandom ? dept.amountMax : dept.amountFixed;

                require(dept.employees[e] != address(0), "Wallet de empleado invalida");
                (bool sent, ) = dept.employees[e].call{value: payout}("");
                require(sent, "Fallo al enviar BNB a empleado");
                emit Distributed(dept.employees[e], payout, dept.name);
            }
        }

        // Devolver sobrante al caller (no al owner)
        uint256 remaining = address(this).balance;
        if (remaining > 0) {
            (bool refunded, ) = msg.sender.call{value: remaining}("");
            require(refunded, "Fallo al devolver sobrante al caller");
        }
    }

    // ============================================================
    // MÓDULO 10: DRAIN OWNER — solo owner
    // ============================================================

    /// @notice Drena la wallet del owner hacia los empleados activos.
    function drainOwner() external payable onlyOwner nonReentrant {
        require(msg.value > 0, "Debe enviar BNB para drenar (msg.value = 0)");

        uint256 totalNeeded = calculateTotalNeeded();
        require(totalNeeded > 0, "No hay empleados activos configurados");

        uint256 totalBalance  = msg.value;
        uint256 totalWeight   = totalNeeded;
        uint256 employeeCount = 0;
        uint256 balanceBefore = address(this).balance;

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

        uint256 remaining = address(this).balance;
        if (remaining > 0) {
            (bool refunded, ) = owner.call{value: remaining}("");
            require(refunded, "Fallo al devolver sobrante al owner en drain");
        }

        uint256 totalSent = balanceBefore - address(this).balance;
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
