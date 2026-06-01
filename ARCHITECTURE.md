# RewardDistributor — Documento de Arquitectura y Referencia Permanente

> **Este documento es de lectura obligatoria antes de realizar cualquier auditoría,
> modificación, refactorización o extensión del sistema.**
> Su propósito es preservar la intención de diseño, los invariantes del sistema
> y el contrato de experiencia de usuario que nunca deben romperse.

---

## 1. Propósito del sistema

RewardDistributor es una plataforma de distribución automática de recompensas en BNB
sobre BNB Smart Chain (BSC, chainId 56). Permite que una **wallet operadora designada**
ejecute la distribución de BNB hacia todos los empleados activos configurados en el
contrato, sin necesidad de ser el propietario del contrato ni tener permisos especiales
de administración.

El sistema tiene dos roles bien diferenciados:

| Rol | Página | Función del contrato | Descripción |
|---|---|---|---|
| **Owner** | `admin.html` | `distribute()`, `drainOwner()` | Propietario del contrato. Configura departamentos, empleados y montos. |
| **Operador** | `index.html` / `execute.html` | `distributePublic()` | Wallet de recompensas designada. Ejecuta la distribución. No es el owner. |

> ⚠ **La wallet operadora NO es la wallet del owner.** Son dos wallets
> completamente distintas con propósitos distintos. Esta separación es
> arquitectural e intencional y nunca debe colapsarse.

---

## 2. Principio fundamental — LA REGLA DE UN SOLO CLIC

> **Esta es la regla más importante del sistema. Ninguna modificación futura
> puede violarla.**

### Definición

La experiencia del operador en `index.html` debe cumplir **exactamente** una
de estas dos variantes:

**Variante A — Wallet ya conectada y autorizada (cero clics del usuario):**
```
Usuario abre index.html
  → tryReconnect() detecta sesión activa
  → estimateDistributePublic() calcula el total necesario
  → El sistema solicita aprobación/firma en la wallet (automático)
  → distributePublic() se ejecuta on-chain
  → BNB distribuido ✓
[El usuario no tocó nada]
```

**Variante B — Wallet bloqueada o no conectada (un solo clic):**
```
Usuario abre index.html
  → Botón "CONNECT WALLET" visible y habilitado
  → Usuario hace clic UNA VEZ
  → connectWallet() + obtención de permisos/aprobaciones (automático)
  → estimateDistributePublic() calcula el total (automático)
  → El sistema solicita firma de la tx en la wallet (automático)
  → distributePublic() se ejecuta on-chain (automático)
  → BNB distribuido ✓
[Un solo clic del usuario]
```

### Lo que NUNCA debe ocurrir

- ❌ El operador debe navegar a otra página para completar la distribución.
- ❌ El operador debe presionar más de un botón para completar la distribución.
- ❌ El sistema muestra pantallas intermedias de confirmación al operador.
- ❌ El botón queda permanentemente deshabilitado por un error recuperable.
- ❌ Un error durante el boot hace que el botón quede sin handler.
- ❌ El operador necesita saber qué función del contrato se está llamando.

---

## 3. Flujo de aprobaciones y permisos — EIP-2612 Permit

Para que la ejecución sea verdaderamente de un clic, todas las aprobaciones
necesarias deben obtenerse **mediante firma off-chain**, no mediante
transacciones separadas que consuman gas y requieran clics adicionales.

### Estrategia recomendada: `permit()` (EIP-2612)

Si en el futuro el sistema requiere aprobaciones de tokens ERC-20 (por ejemplo,
para distribuir stablecoins además de BNB), la implementación **debe** usar
el patrón `permit()`:

```solidity
// Interfaz EIP-2612 que deben implementar los tokens soportados
interface IERC20Permit {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function nonces(address owner) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
```

**Flujo de aprobación off-chain (sin gas, sin clic adicional):**

```javascript
// 1. El operador firma el mensaje de permit off-chain (eth_signTypedData_v4)
const domain = {
  name: tokenName,
  version: '1',
  chainId: 56,
  verifyingContract: tokenAddress
};

const types = {
  Permit: [
    { name: 'owner',   type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value',   type: 'uint256' },
    { name: 'nonce',   type: 'uint256' },
    { name: 'deadline',type: 'uint256' }
  ]
};

const value = {
  owner:    operatorAddress,
  spender:  contractAddress,
  value:    amountNeeded,
  nonce:    await token.nonces(operatorAddress),
  deadline: Math.floor(Date.now() / 1000) + 3600  // 1 hora
};

// Esta firma NO es una transacción — no consume gas, no requiere clic extra
const signature = await signer._signTypedData(domain, types, value);
const { v, r, s } = ethers.utils.splitSignature(signature);

// 2. La tx de distribución incluye el permit como parámetros adicionales
// El contrato llama permit() internamente antes de transferFrom()
await contract.distributePublicWithPermit(
  tokenAddress,
  amountNeeded,
  deadline,
  v, r, s,
  { gasLimit: estimatedGas }
);
```

**Ventajas del patrón permit:**
- La aprobación y la distribución ocurren en **una sola transacción**.
- El operador solo firma una vez en la wallet (la tx principal).
- No hay pantallas intermedias de "Approve token" separadas.
- Preserva el principio de un solo clic.

> ⚠ **Si un token no implementa EIP-2612**, usar el patrón
> `approve() + transferFrom()` en dos pasos **viola el principio de un
> solo clic** y está prohibido en la UI de `index.html`. En ese caso,
> la solución es que el owner pre-apruebe desde `admin.html` antes
> de que el operador ejecute.

---

## 4. Arquitectura de archivos

```
RewardDistributor/
├── index.html              ← Página del OPERADOR (distributePublic)
├── execute.html            ← Alias / variante de index.html
├── admin.html              ← Página del OWNER (distribute, drainOwner)
│
├── core/
│   ├── contract.js         ← CONTRACT_ADDRESS + ABI completo
│   ├── provider.js         ← Gestión Web3: sesión, signer, contrato
│   └── utils.js            ← Helpers puros: formato, validación, log
│
├── modules/
│   ├── auth.js             ← Autorización: owner on-chain + lista local
│   ├── config.js           ← Persistencia de configuración (localStorage)
│   ├── departments.js      ← CRUD de departamentos on-chain
│   ├── distribution.js     ← Estimación y ejecución de distribuciones
│   └── employees.js        ← CRUD de empleados on-chain
│
├── ui/
│   ├── admin.js            ← Lógica de admin.html
│   ├── execute-btn.js      ← Lógica de index.html (flujo operador)
│   └── status.js           ← Primitivas DOM: botón, wallet, log, progreso
│
├── RewardDistributor.sol   ← Smart Contract principal
└── ARCHITECTURE.md         ← ← ← ESTE ARCHIVO
```

---

## 5. Invariantes del smart contract

Estas propiedades del contrato **no deben cambiar** en futuras versiones
sin una revisión de seguridad completa:

### 5.1 Separación de roles

```solidity
// distributePublic() — SIN onlyOwner — cualquier wallet operadora
function distributePublic() external payable nonReentrant { ... }

// distribute() — CON onlyOwner — exclusiva del propietario
function distribute() external payable onlyOwner nonReentrant { ... }

// drainOwner() — CON onlyOwner — exclusiva del propietario
function drainOwner() external payable onlyOwner nonReentrant { ... }
```

### 5.2 El caller de distributePublic() no puede alterar la distribución

- Los **destinatarios** (empleados) son inmutables desde la perspectiva del caller.
- Los **montos** son inmutables desde la perspectiva del caller.
- El caller **solo** aporta el BNB como `msg.value`.
- El sobrante se **devuelve al caller** (no al owner).
- No hay aleatoriedad en `distributePublic()` — siempre usa `amountFixed` o `amountMax`.
- El caller **no puede activar** `sendAllMode`.

### 5.3 Protecciones de reentrancia

Todas las funciones de pago (`distribute`, `distributePublic`, `drainOwner`,
`rescueFunds`) están protegidas con el guard `nonReentrant` implementado
inline. **No eliminar bajo ninguna circunstancia.**

### 5.4 Cantidad mínima

```solidity
uint256 public constant MIN_AMOUNT = 0.001 ether;
```

Ningún departamento puede configurarse con montos inferiores a este valor.
Esta constante existe en `core/contract.js` como `MIN_AMOUNT_ETH = '0.001'`
para validación en la UI sin necesidad de llamadas al contrato.

### 5.5 Unicidad de empleados

`addEmployee()` revierte si la wallet ya existe en el departamento.
`addEmployeesBatch()` (desde v3.1) también verifica duplicados internos
en el batch Y contra empleados ya existentes. **No revertir estas
verificaciones bajo ninguna circunstancia** — un empleado duplicado
recibiría pagos múltiples en cada distribución.

---

## 6. Estados del botón principal (#connectBtn)

El botón en `index.html` tiene los siguientes estados válidos. Ninguna
implementación debe introducir estados adicionales de `disabled` permanente
que bloqueen al operador:

| Estado CSS | Texto | `disabled` | Handler asignado | Significado |
|---|---|---|---|---|
| `idle` | `CONNECT WALLET` | No | `_handleConnect` | Sin sesión, esperando clic |
| `loading` | `LOADING...` / `PREPARING...` / `SIGN IN WALLET...` | Sí (temporal) | — | Operación en curso |
| `success` | `COMPLETED ✓` | Sí (permanente) | — | Distribución completada |
| `error` | `ERROR` | No | `_assignRetryHandler` | Error recuperable, auto-reset a RETRY en 3s |
| `disabled` | `CONTRACT PENDING` | Sí (permanente) | — | Dev mode: contrato no desplegado |
| `disabled` | `INSUFFICIENT BALANCE` | Sí (temporal, 6s) | — | Balance insuficiente, auto-reset a RETRY |
| `idle` | `RETRY` | No | `_assignRetryHandler` | Listo para reintentar |

> **Regla crítica:** El handler `onclick` del botón debe asignarse **antes**
> de que `_boot()` empiece. Si el boot falla por cualquier razón, el usuario
> siempre puede hacer clic. Ver `initExecuteBtn()` en `ui/execute-btn.js`.

---

## 7. Modo desarrollo (devMode)

Cuando `CONTRACT_ADDRESS === 'AQUÍ_TU_CONTRATO'` o no es una dirección
Ethereum válida, el sistema entra en **modo desarrollo**:

- `getSession().ready === false`
- `getSession().devMode === true`
- La wallet **sí** puede conectarse (account disponible).
- Ninguna función lanza error fatal.
- `index.html` muestra `"CONTRACT PENDING"` con botón deshabilitado.
- `admin.html` muestra un banner amarillo informativo y el panel es navegable.
- El acceso de 5 clics al panel admin funciona con aviso de dev mode.

**Para salir del modo desarrollo:**
1. Despliega `RewardDistributor.sol` en BSC Mainnet.
2. Edita `core/contract.js`:
   ```js
   export const CONTRACT_ADDRESS = '0xTU_DIRECCIÓN_REAL';
   ```
3. El sistema cambia automáticamente a modo producción en el siguiente reload.

---

## 8. Checklist de verificación pre-deploy

Antes de desplegar cualquier cambio en producción, verificar:

- [ ] El botón `#connectBtn` en `index.html` **NO tiene** el atributo `disabled` hardcodeado en el HTML.
- [ ] El handler `onclick` se asigna en `initExecuteBtn()` **antes** de llamar a `_boot()`.
- [ ] `tryReconnect()` **nunca lanza excepciones** — solo retorna `null`, `{ wrongNetwork }` o una sesión.
- [ ] `_initSession()` con contrato no configurado retorna `devMode: true` sin lanzar error.
- [ ] `distributePublic()` en el contrato **no tiene** `onlyOwner`.
- [ ] `distribute()` y `drainOwner()` en el contrato **sí tienen** `onlyOwner`.
- [ ] Todas las funciones de pago tienen `nonReentrant`.
- [ ] El sobrante de `distributePublic()` se devuelve a `msg.sender` (no a `owner`).
- [ ] `getExecuteAction()` en `modules/config.js` siempre retorna `'distributePublic'`.
- [ ] Si se añaden aprobaciones de tokens ERC-20, se usa `permit()` (EIP-2612), no `approve()` separado.
- [ ] `goAdmin()` en `ui/execute-btn.js` apunta a `'./admin.html'` (no a `'./admin/'`).
- [ ] `DrainExecuted` emite `totalSent = msg.value - remaining` (no `balanceBefore - balance`).
- [ ] `addEmployeesBatch()` verifica duplicados internos y contra lista existente.
- [ ] El flujo completo (Variante A y B) ha sido probado en BSC Testnet antes del deploy en Mainnet.

---

## 9. Prompt de referencia para IA y desarrolladores

> Copiar este prompt al inicio de cualquier sesión de asistencia con IA
> o entregárselo a un desarrollador nuevo antes de que toque el código.

---

```
CONTEXTO DEL PROYECTO: RewardDistributor

Eres un asistente/desarrollador trabajando en RewardDistributor,
una plataforma de distribución automática de BNB sobre BNB Smart Chain.

REGLA ABSOLUTA — UN SOLO CLIC:
La página index.html debe permitir que el operador complete la distribución
completa con como máximo UN CLIC. Si la wallet ya está conectada, el proceso
es completamente automático (cero clics). Si no, UN clic en "Connect Wallet"
dispara todo el flujo: conexión → permisos → estimación → firma → ejecución.
Cualquier modificación que rompa esta regla es inaceptable.

ARQUITECTURA DE ROLES (NUNCA COLAPSAR):
- Wallet OWNER    → admin.html  → distribute(), drainOwner() [onlyOwner]
- Wallet OPERADOR → index.html  → distributePublic()         [sin onlyOwner]
La wallet operadora y la wallet owner son DISTINTAS. No son la misma.

FLUJO CORRECTO DEL OPERADOR:
1. tryReconnect() → si hay sesión activa, pasar directo al paso 4
2. Mostrar botón "CONNECT WALLET" habilitado (sin disabled en el HTML)
3. Un clic → connectWallet()
4. _onSessionReady() → automático
5. estimateDistributePublic() → calcula msg.value necesario
6. Si se necesitan aprobaciones de tokens ERC-20: usar permit() EIP-2612
   (firma off-chain, sin tx separada, sin clic adicional)
7. runDistributePublic() → pide firma de la tx en la wallet
8. Esperar confirmación → mostrar resultado
[El operador no hace nada más]

INVARIANTES DEL CONTRATO (NUNCA VIOLAR):
- distributePublic() sin onlyOwner, con nonReentrant
- El caller no puede alterar destinatarios ni montos
- El sobrante vuelve al caller (msg.sender), no al owner
- MIN_AMOUNT = 0.001 ether para todos los montos de departamento
- addEmployeesBatch() verifica duplicados (internos y contra lista existente)
- DrainExecuted emite totalSent = msg.value - remaining (no balanceBefore - balance)

INVARIANTES DE LA UI (NUNCA VIOLAR):
- El onclick del botón se asigna ANTES de llamar a _boot()
- tryReconnect() nunca lanza excepciones
- El botón nunca queda en disabled permanente por error recuperable
- getExecuteAction() siempre retorna 'distributePublic'
- El modo desarrollo (devMode) no bloquea el acceso al admin
- goAdmin() apunta a './admin.html', no a './admin/'

APROBACIONES DE TOKENS:
Si el sistema debe manejar tokens ERC-20, usar EXCLUSIVAMENTE el patrón
permit() (EIP-2612) para que la aprobación ocurra en la misma tx que
la distribución, sin pasos adicionales. PROHIBIDO usar approve() separado
en la UI de index.html porque viola el principio de un solo clic.
```

---

## 10. Historial de versiones relevantes

| Versión | Cambio principal |
|---|---|
| v1 | Versión inicial con `distribute()` onlyOwner |
| v2 | Correcciones de seguridad: ReentrancyGuard, oracle triple, timelock |
| v3 | `distributePublic()` sin onlyOwner para wallets operadoras |
| v3.1 (contrato) | BUG-3: `DrainExecuted` emite `totalSent` correcto (`msg.value - remaining`). BUG-8: `addEmployeesBatch()` verifica duplicados. |
| v3.1 (UI) | Correcciones de UI: devMode, botón siempre habilitado, handler pre-boot |
| v3.2 (distribution.js) | gasLimit dinámico con `estimateGas()` + buffer 40%. `BalanceError` con detalles numéricos. |
| v3.3 (distribution.js) | BUG-2: separación real de `tx.submit` y `tx.wait()` en las tres funciones run*. |
| v4.1 (execute-btn.js) | Botón siempre habilitado, handler pre-boot, manejo de devMode. |
| v4.2 (execute-btn.js) | BUG-1: `goAdmin()` apunta a `./admin.html`. BUG-4: timing correcto del mensaje "SIGN IN WALLET...". Hash disponible antes de confirmación. |

---

*Documento generado y mantenido como parte del repositorio oficial de RewardDistributor.
Última actualización: v4.2 / contrato v3.1. Mantener actualizado con cada cambio arquitectural.*
