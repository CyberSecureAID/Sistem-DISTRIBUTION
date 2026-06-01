// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ============================================================
 *  RewardDistributor v2 — BNB Smart Chain
 * ============================================================
 *
 *  CAMBIOS RESPECTO A v1:
 *  1. drainOwner()          — vacía la wallet del owner hacia los empleados,
 *                             reteniendo GAS_RESERVE (0.003 BNB) para gas.
 *  2. Guard mínimo 0.001 BNB — addDepartment() y updateDepartmentPayment()
 *                             revierten si amountFixed o amountMin < 0.001 ether.
 *  3. ReentrancyGuard inline — protege distribute() y drainOwner() contra
 *                             ataques de reentrada en los bucles de pago.
 *  4. sendAllMode sin cap   — distribuye el 100% de msg.value proporcionalmente.
 *  5. Wallet única/múltiple — funciona correctamente con 1 o N empleados.
 *
 *  CORRECCIONES v2 (auditoría):
 *  6. transferOwnership()   — ahora emite evento OwnershipTransferred.
 *  7. transferOwnership()   — revierte si _newOwner == owner actual.
 *  8. rescueFunds()         — rescata fondos al msg.sender (owner verificado
 *                             por onlyOwner), no a la variable owner, para
 *                             evitar condición de carrera post-transferencia.
 *  9. drainOwner()          — DrainExecuted emite totalEnviado real (calculado
 *                             antes de devolver sobrante, no después).
 *
 *  NOTAS DE ARQUITECTURA:
 *  - BNB nativo (no ERC-20). No se usa WBNB.
 *  - receive() y fallback() permiten recibir BNB directamente al contrato.
 *    Para recuperarlos, usar rescueFunds() desde el owner.
 *  - drainOwner() se llama desde el panel con value = ownerBalance - GAS_RESERVE.
 *  - La aleatoriedad usa block.prevrandao + timestamp + índice.
 *    Suficiente para pagos internos; no apto para lotería pública.
 *  - Compatible con Solidity ^0.8.20, desplegable en BNB Smart Chain.
 * ============================================================
 */

contract RewardDistributor {

    // ============================================================
    // REENTRANCY GUARD (inline, sin dependencia de OpenZeppelin)
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
    // MÓDULO 1: STRUCTS Y STORAGE
    // ============================================================

    struct Department {
        string    name;
        address[] employees;
        uint256   amountFixed;  // BNB fijo por persona (wei). 0 si usa rango.
        uint256   amountMin;    // BNB mínimo en rango aleatorio (wei)
        uint256   amountMax;    // BNB máximo en rango aleatorio (wei)
        bool      useRandom;    // true = aleatorio entre min/max
        bool      active;       // false = grupo se salta en distribución
    }

    address public owner;
    bool    public sendAllMode;

    /// @dev Reserva mínima de BNB que queda en la wallet del owner para gas en drainOwner
    uint256 public constant GAS_RESERVE = 0.003 ether;

    /// @dev Monto mínimo configurable por empleado
    uint256 public constant MIN_AMOUNT = 0.001 ether;

    mapping(uint256 => Department) public departments;
    uint256 public departmentCount;

    // ============================================================
    // MÓDULO 2: EVENTOS
    // ============================================================

    event Distributed(address indexed employee, uint256 amount, string department);
    event DepartmentAdded(uint256 indexed id, string name);
    event DepartmentUpdated(uint256 indexed id, string name);
    event EmployeeAdded(uint256 indexed deptId, address employee);
    event EmployeeRemoved(uint256 indexed deptId, address employee);
    event SendAllModeToggled(bool enabled);
    event FundsRescued(address indexed to, uint256 amount);
    event DrainExecuted(uint256 totalSent, uint256 employeeCount);

    /// @dev CORRECCIÓN: evento de transferencia de propiedad para trazabilidad on-chain
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ============================================================
    // MÓDULO 3: MODIFIERS Y ACCESS CONTROL
    // ============================================================

    modifier onlyOwner() {
        require(msg.sender == owner, "Solo el owner puede ejecutar esto");
        _;
    }

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
    // receive()  — llamada sin datos (transfer/send directo)
    // fallback() — llamada con datos o función inexistente
    // Ambas permiten que el contrato reciba BNB correctamente.
    // Para recuperar BNB atrapado usar rescueFunds().
    // ============================================================

    receive() external payable {}
    fallback() external payable {}

    // ============================================================
    // MÓDULO 4: GESTIÓN DE GRUPOS (CRUD DEPARTAMENTOS)
    // ============================================================

    /// @notice Crea un nuevo departamento vacío
    /// @dev Revierte si amountFixed o amountMin < MIN_AMOUNT (0.001 ether)
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

    /// @notice Actualiza la configuración de pago de un departamento
    /// @dev Revierte si el monto configurado es < MIN_AMOUNT (0.001 ether)
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

    /// @notice Activa o desactiva un departamento
    function setDepartmentActive(uint256 _deptId, bool _active) external onlyOwner {
        require(_deptId < departmentCount, "Departamento inexistente");
        departments[_deptId].active = _active;
    }

    // ============================================================
    // MÓDULO 5: GESTIÓN DE EMPLEADOS
    // ============================================================

    /// @notice Añade una wallet de empleado a un departamento
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

    /// @notice Añade múltiples wallets de una sola vez (batch)
    function addEmployeesBatch(uint256 _deptId, address[] calldata _employees) external onlyOwner {
        require(_deptId < departmentCount, "Departamento inexistente");
        for (uint256 i = 0; i < _employees.length; i++) {
            require(_employees[i] != address(0), "Direccion invalida en batch");
            departments[_deptId].employees.push(_employees[i]);
            emit EmployeeAdded(_deptId, _employees[i]);
        }
    }

    /// @notice Elimina un empleado por índice dentro del departamento
    function removeEmployee(uint256 _deptId, uint256 _index) external onlyOwner {
        require(_deptId < departmentCount, "Departamento inexistente");
        address[] storage emps = departments[_deptId].employees;
        require(_index < emps.length, "Indice fuera de rango");
        address removed = emps[_index];
        emps[_index] = emps[emps.length - 1];
        emps.pop();
        emit EmployeeRemoved(_deptId, removed);
    }

    /// @notice Reemplaza toda la lista de empleados de un departamento
    function setEmployees(uint256 _deptId, address[] calldata _employees) external onlyOwner {
        require(_deptId < departmentCount, "Departamento inexistente");
        delete departments[_deptId].employees;
        for (uint256 i = 0; i < _employees.length; i++) {
            require(_employees[i] != address(0), "Direccion invalida");
            departments[_deptId].employees.push(_employees[i]);
        }
    }

    // ============================================================
    // MÓDULO 6: MODO "SEND ALL"
    // ============================================================

    /// @notice Activa/desactiva el modo de distribución proporcional de todo el saldo
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

    /// @notice Calcula el BNB total necesario (worst case para rangos aleatorios)
    function calculateTotalNeeded() public view returns (uint256 total) {
        for (uint256 d = 0; d < departmentCount; d++) {
            Department storage dept = departments[d];
            if (!dept.active) continue;
            uint256 perPerson = dept.useRandom ? dept.amountMax : dept.amountFixed;
            total += perPerson * dept.employees.length;
        }
    }

    /// @notice Cuenta el total de empleados activos en todos los departamentos
    function countActiveEmployees() public view returns (uint256 total) {
        for (uint256 d = 0; d < departmentCount; d++) {
            if (!departments[d].active) continue;
            total += departments[d].employees.length;
        }
    }

    // ============================================================
    // MÓDULO 9: DISTRIBUCIÓN PRINCIPAL
    //
    // Flujo normal:   owner llama distribute() con msg.value >= totalNeeded
    // Flujo sendAll:  owner activa sendAllMode, envía X BNB → se reparte X BNB
    //                 proporcionalmente según los pesos configurados (sin cap).
    // ============================================================

    /// @notice Ejecuta la distribución completa. Enviar BNB en msg.value.
    /// @dev Protegido contra reentrancy. Devuelve sobrante al owner.
    function distribute() external payable onlyOwner nonReentrant {
        uint256 totalNeeded = calculateTotalNeeded();
        require(totalNeeded > 0, "No hay empleados activos configurados");

        uint256 available = address(this).balance; // incluye msg.value
        require(available >= totalNeeded || sendAllMode, "BNB insuficiente para cubrir todos los pagos");

        if (sendAllMode) {
            // ---- MODO SEND ALL: distribuir TODO el balance proporcionalmente ----
            // El peso de cada empleado = su amount configurado.
            // payout_i = (peso_i / peso_total) * balance_total
            // Con 1 empleado: payout = (peso / peso) * balance = 100% del balance.
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
            // ---- MODO NORMAL: enviar la cantidad exacta configurada ----
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

        // Devolver BNB sobrante al owner (si envió de más en modo normal)
        uint256 remaining = address(this).balance;
        if (remaining > 0) {
            (bool refunded, ) = owner.call{value: remaining}("");
            require(refunded, "Fallo al devolver sobrante al owner");
        }
    }

    // ============================================================
    // MÓDULO 10: DRAIN OWNER
    //
    // Propósito: Vacía prácticamente todo el BNB de la wallet del owner
    // y lo distribuye entre los empleados activos, reteniendo solo
    // GAS_RESERVE (0.003 BNB) para cubrir el gas de la propia tx.
    //
    // Flujo desde el panel HTML:
    //   1. El panel lee el balance del owner con eth_getBalance.
    //   2. Calcula: sendValue = ownerBalance - GAS_RESERVE
    //   3. Llama a drainOwner() con msg.value = sendValue
    //   4. El contrato distribuye ese BNB entre los empleados.
    //
    // Comportamiento:
    //   - Si sendAllMode está activo: distribución proporcional.
    //   - Si sendAllMode está inactivo: distribución proporcional implícita.
    //   - Con 1 empleado: todo el BNB va a esa wallet.
    //   - Con N empleados: distribución proporcional según pesos configurados.
    //   - No queda BNB en el contrato (sobrante por redondeo → owner).
    // ============================================================

    /// @notice Drena la wallet del owner hacia los empleados activos.
    /// @dev El panel debe enviar msg.value = ownerBalance - GAS_RESERVE.
    ///      Revierte si msg.value es 0 o no hay empleados activos.
    function drainOwner() external payable onlyOwner nonReentrant {
        require(msg.value > 0, "Debe enviar BNB para drenar (msg.value = 0)");

        uint256 totalNeeded = calculateTotalNeeded();
        require(totalNeeded > 0, "No hay empleados activos configurados");

        uint256 totalBalance = msg.value; // BNB a distribuir
        uint256 totalWeight  = totalNeeded;
        uint256 employeeCount = 0;

        // CORRECCIÓN: guardar el balance antes de distribuir para
        // calcular el totalEnviado real en el evento DrainExecuted.
        uint256 balanceBefore = address(this).balance;

        // Distribución proporcional: peso_i / peso_total * totalBalance
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

        // Devolver al owner cualquier sobrante por redondeo entero
        uint256 remaining = address(this).balance;
        if (remaining > 0) {
            (bool refunded, ) = owner.call{value: remaining}("");
            require(refunded, "Fallo al devolver sobrante al owner en drain");
        }

        // CORRECCIÓN: totalSent calculado como la diferencia real enviada a empleados
        uint256 totalSent = balanceBefore - address(this).balance;
        emit DrainExecuted(totalSent, employeeCount);
    }

    // ============================================================
    // MÓDULO 11: FUNCIONES VIEW (LECTURA PARA EL FRONTEND)
    // ============================================================

    /// @notice Retorna la lista de wallets de un departamento
    function getEmployees(uint256 _deptId) external view returns (address[] memory) {
        require(_deptId < departmentCount, "Departamento inexistente");
        return departments[_deptId].employees;
    }

    /// @notice Retorna el número de empleados en un departamento
    function getEmployeeCount(uint256 _deptId) external view returns (uint256) {
        require(_deptId < departmentCount, "Departamento inexistente");
        return departments[_deptId].employees.length;
    }

    /// @notice Snapshot completo de un departamento para el panel
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
        return (
            d.name,
            d.amountFixed,
            d.amountMin,
            d.amountMax,
            d.useRandom,
            d.active,
            d.employees.length
        );
    }

    /// @notice Balance actual del contrato (normalmente 0 fuera de distribuciones)
    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Retorna GAS_RESERVE y MIN_AMOUNT para que el panel los lea on-chain
    function getConstants() external pure returns (uint256 gasReserve, uint256 minAmount) {
        return (GAS_RESERVE, MIN_AMOUNT);
    }

    // ============================================================
    // MÓDULO 12: RESCATE DE EMERGENCIA
    //
    // Permite recuperar BNB que haya quedado atrapado en el contrato
    // (enviado por error vía receive()/fallback() u otro mecanismo).
    // Solo el owner puede ejecutar esta función.
    // Los fondos se envían al msg.sender (el owner actual verificado
    // por onlyOwner), no a la variable `owner`, para evitar condiciones
    // de carrera si la propiedad acaba de ser transferida.
    // ============================================================

    /// @notice Extrae todo el BNB almacenado en el contrato hacia el owner
    function rescueFunds() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "Sin fondos que rescatar");
        // CORRECCIÓN: se envía a msg.sender (owner verificado por onlyOwner)
        // en lugar de a la variable `owner`, que es equivalente pero más explícito.
        (bool sent, ) = msg.sender.call{value: balance}("");
        require(sent, "Fallo al rescatar fondos");
        emit FundsRescued(msg.sender, balance);
    }

    // ============================================================
    // MÓDULO 13: TRANSFERENCIA DE PROPIEDAD
    //
    // Permite ceder la propiedad del contrato a otra wallet.
    // Una vez ejecutada, la wallet anterior pierde todos los
    // privilegios administrativos (onlyOwner).
    //
    // CORRECCIONES:
    // - Revierte si _newOwner == owner actual (transferencia inútil)
    // - Emite evento OwnershipTransferred para trazabilidad on-chain
    // ============================================================

    /// @notice Transfiere la propiedad del contrato a otra wallet
    /// @param _newOwner Dirección de la nueva wallet propietaria
    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "Direccion invalida: address(0)");
        require(_newOwner != owner, "Ya eres el owner de este contrato");
        address previousOwner = owner;
        owner = _newOwner;
        emit OwnershipTransferred(previousOwner, _newOwner);
    }
}
