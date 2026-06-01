// ============================================================
//  ui/execute-btn.js  — v3.2
//
//  CORRECCIONES v3.2 (sobre v3.1):
//
//  1. BUG-E CORREGIDO: BalanceError dejaba el botón disabled
//     permanentemente. Ahora muestra el saldo faltante con
//     claridad y habilita REINTENTAR tras 5 segundos, permitiendo
//     al operador añadir fondos y reintentar sin recargar la página.
//
//  2. BUG-G CORREGIDO: Si calculateTotalNeeded() retorna 0 (ningún
//     departamento activo con empleados), el flujo ahora detecta
//     este estado ANTES de pedir la firma y muestra un error claro
//     en lugar de dejar que el contrato revierta después de abrir
//     el popup de MetaMask.
//
//  3. BUG-A CORREGIDO: _isUserRejection() era demasiado amplio —
//     la cadena "rejected" podía coincidir con mensajes de error
//     del nodo BSC (ej: "Transaction has been rejected by the network").
//     Ahora solo detecta rechazos EXPLÍCITOS de wallet:
//       code 4001               MetaMask estándar
//       "user rejected"         MetaMask moderno / WalletConnect
//       "user denied"           MetaMask legacy / WalletConnect
//       "user cancelled"        Trust Wallet / wallets móviles
//       "request rejected"      Coinbase Wallet
//     Se eliminó el .includes('rejected') genérico.
//
//  4. MEJORA: Progreso visual durante tx.wait() — el status muestra
//     "Esperando confirmación en BSC..." para que el operador sepa
//     que la tx ya fue enviada y el sistema está esperando el bloque.
//
//  FLUJO COMPLETO (sin cambios de arquitectura):
//    1. _boot()           → tryReconnect() silencioso al cargar
//    2. Sesión ok         → _onSessionReady() → _executeFlow() AUTO
//    3. Red incorrecta    → banner + botón CONNECT WALLET
//    4. Sin sesión        → botón CONNECT WALLET habilitado
//    5. Click botón       → _handleConnect() → _onSessionReady() → _executeFlow()
//
//  ARQUITECTURA DE ROLES:
//  - execute.html usa distributePublic() — cualquier wallet puede ejecutarlo.
//  - admin.html   usa distribute()/drainOwner() — solo el owner.
// ============================================================

import { connectWallet, tryReconnect, watchWalletEvents, getSession } from '../core/provider.js';
import { runAction, estimateAction, BalanceError }                     from '../modules/distribution.js';
import { getExecuteAction }                                            from '../modules/config.js';
import { getAllDepartments, formatDepartmentPayment }                   from '../modules/departments.js';
import {
  setStatus,
  setWallet,
  setConnectBtn,
  showTxResult,
  showNetWarn,
  updateAmountDisplay
} from './status.js';
import { shortAddr, toFloat } from '../core/utils.js';

// ============================================================
//  initExecuteBtn()
// ============================================================
export function initExecuteBtn() {
  if (!window.ethereum) {
    _showNoProvider();
    return;
  }

  watchWalletEvents(() => location.reload());
  _boot();
}

// ============================================================
//  _isUserRejection()
//  Detecta si el error es un rechazo VOLUNTARIO del usuario
//  en el popup de firma. Solo cubre mensajes explícitos de wallet.
//
//  IMPORTANTE — lo que NO cubre (intencionalmente):
//    "rejected" genérico  → puede ser error del nodo BSC
//    "cancelled"          → puede ser timeout de red
//  Solo se marcan como rechazo los mensajes que inequívocamente
//  indican que el USUARIO apretó "Rechazar" en la wallet.
// ============================================================
function _isUserRejection(err) {
  if (err.code === 4001) return true;
  const msg = (err.message ?? '').toLowerCase();
  return (
    msg.includes('user rejected')   ||
    msg.includes('user denied')     ||
    msg.includes('user cancelled')  ||
    msg.includes('request rejected')
  );
}

// ============================================================
//  _assignRetryHandler()
//  Asigna al #connectBtn el handler correcto según el estado
//  actual de sesión. Fuente única de verdad para el handler.
// ============================================================
function _assignRetryHandler() {
  const btn = document.getElementById('connectBtn');
  if (!btn) return;
  const session = getSession();
  btn.onclick = (session && session.ready) ? _executeFlow : _handleConnect;
}

// ============================================================
//  _boot()
//  Reconexión silenciosa al cargar la página.
//  Tres casos posibles desde tryReconnect():
//    null             → sin sesión  → botón CONNECT WALLET
//    { wrongNetwork } → red mala   → banner + botón CONNECT
//    sesión válida    → flujo auto → _onSessionReady()
// ============================================================
async function _boot() {
  setStatus('Inicializando...', '');
  setConnectBtn('disabled', 'CARGANDO...');

  try {
    const result = await tryReconnect();

    // CASO 1: red incorrecta detectada en reconexión silenciosa
    if (result && result.wrongNetwork) {
      showNetWarn(true);
      setWallet(shortAddr(result.account) + ' · Red incorrecta', 'warn');
      setStatus('Red incorrecta. Cambia a BNB Smart Chain (chainId 56) en tu wallet y reconecta.', 'warn');
      setConnectBtn('idle', 'CONNECT WALLET');
      document.getElementById('connectBtn').onclick = _handleConnect;
      return;
    }

    // CASO 2: sesión activa con red correcta — flujo automático
    if (result && result.ready) {
      await _onSessionReady(result);
      return;
    }

    // CASO 3: sin sesión previa
    setStatus('Conecta tu wallet para ejecutar la distribución.', 'warn');
    setConnectBtn('idle', 'CONNECT WALLET');
    document.getElementById('connectBtn').onclick = _handleConnect;

  } catch (e) {
    _handleError(e);
  }
}

// ============================================================
//  _handleConnect()
//  Click manual en el botón → conectar → ejecutar.
// ============================================================
async function _handleConnect() {
  setConnectBtn('loading', 'CONECTANDO...');
  setStatus('Esperando aprobación de cuenta en la wallet...', '');

  try {
    const session = await connectWallet();
    await _onSessionReady(session);
  } catch (e) {
    if (_isUserRejection(e)) {
      setStatus('Conexión cancelada por el usuario.', 'warn');
    } else if (e.name === 'NetworkError') {
      showNetWarn(true);
      setStatus(e.message, 'warn');
    } else {
      _handleError(e);
    }
    setConnectBtn('idle', 'CONNECT WALLET');
    document.getElementById('connectBtn').onclick = _handleConnect;
  }
}

// ============================================================
//  _onSessionReady()
//  Wallet conectada y red correcta.
//  NO verifica owner — distributePublic() no lo requiere.
//  Lanza directamente el flujo de ejecución automático.
// ============================================================
async function _onSessionReady(session) {
  showNetWarn(false);
  setWallet(shortAddr(session.account), 'ok');
  setConnectBtn('loading', 'PREPARANDO...');
  setStatus('Wallet conectada. Iniciando distribución...', '');

  // Asignar handler de reintento ANTES del await para que
  // si _executeFlow falla, el botón siempre sea operable.
  document.getElementById('connectBtn').onclick = _executeFlow;

  await _executeFlow();
}

// ============================================================
//  _executeFlow()
//  Asume sesión activa. NO requiere ser owner.
//
//  1. Render departamentos (lectura on-chain)
//  2. Verificar que hay empleados activos con fondos asignados
//  3. Estimar BNB necesario (calculateTotalNeeded)
//  4. distributePublic() → popup MetaMask (única interacción)
//  5. tx.wait() → receipt → DONE
// ============================================================
async function _executeFlow() {
  const action = getExecuteAction(); // siempre 'distributePublic'

  setConnectBtn('loading', 'PREPARANDO...');
  setStatus('Leyendo estado del contrato...', '');

  try {
    // Paso 1: render de departamentos activos
    await _renderDeptSummary();

    // Paso 2: estimar distribución
    setStatus('Calculando distribución...', '');
    const estimate = await estimateAction(action);

    // Calcular BNB con fallback explícito para evitar NaN
    const bnb = (typeof estimate.sendBnb === 'number')
      ? estimate.sendBnb
      : (typeof estimate.totalBnb === 'number')
        ? estimate.totalBnb
        : toFloat(estimate.sendValue ?? 0);

    // CORRECCIÓN BUG-G: verificar que hay fondos a distribuir
    // antes de pedir la firma al operador.
    if (bnb === 0) {
      setConnectBtn('disabled', 'SIN PAGOS');
      setStatus('No hay departamentos activos con empleados configurados. El owner debe configurar el contrato desde admin.html.', 'err');
      return;
    }

    updateAmountDisplay(bnb);

    setConnectBtn('loading', 'FIRMAR EN WALLET...');
    setStatus('Firma la transacción en tu wallet para distribuir ' + bnb.toFixed(4) + ' BNB...', 'warn');

    // Paso 3: enviar tx (abre popup MetaMask)
    const { tx, receipt, sendValue } = await runAction(action, estimate.sendValue);

    // Paso 4: éxito
    const sentBnb = toFloat(sendValue).toFixed(4);
    setConnectBtn('success', 'COMPLETADO ✓');
    setStatus(sentBnb + ' BNB distribuidos · bloque #' + receipt.blockNumber, 'ok');
    setWallet(shortAddr(getSession().account) + ' · OK', 'ok');
    showTxResult(tx.hash);

  } catch (e) {
    // Rechazo voluntario del usuario en MetaMask
    if (_isUserRejection(e)) {
      setStatus('Transacción rechazada por el usuario. Haz clic para reintentar.', 'warn');
      setConnectBtn('idle', 'REINTENTAR');
      _assignRetryHandler();
      return;
    }
    // Cualquier otro error
    _handleError(e);
  }
}

// ============================================================
//  _renderDeptSummary()
//  Renderiza el resumen de departamentos activos en la UI.
//  Si falla, muestra '—' y continúa el flujo.
// ============================================================
async function _renderDeptSummary() {
  const el = document.getElementById('deptSummary');
  if (!el) return;

  try {
    const depts  = await getAllDepartments();
    const active = depts.filter(d => d.active && d.employeeCount > 0);

    if (active.length === 0) {
      el.innerHTML = '<span style="color:var(--danger)">Sin departamentos activos</span>';
      return;
    }

    el.innerHTML = active
      .map(d => '<span>' + d.name + '</span> ' + formatDepartmentPayment(d) + ' × ' + d.employeeCount)
      .join('<br>');
  } catch {
    el.textContent = '—';
  }
}

// ============================================================
//  _handleError()
//
//  CORRECCIÓN BUG-E: BalanceError ya no deja el botón disabled
//  permanentemente. Ahora espera 6 segundos y habilita REINTENTAR,
//  permitiendo al operador añadir fondos a su wallet y reintentar
//  sin necesidad de recargar la página.
//
//  Los 6 segundos dan tiempo al operador para leer el mensaje
//  de error con el BNB exacto que le falta.
// ============================================================
function _handleError(err) {
  const isNetwork = err.name === 'NetworkError';
  const isBalance = err.name === 'BalanceError';
  const msg       = err.reason ?? err.message ?? 'Error desconocido.';

  if (isNetwork) {
    showNetWarn(true);
    setConnectBtn('idle', 'CONNECT WALLET');
    setStatus(msg, 'warn');
    document.getElementById('connectBtn').onclick = _handleConnect;
    return;
  }

  if (isBalance) {
    // CORRECCIÓN BUG-E: mostrar error con detalle y habilitar reintento
    setConnectBtn('disabled', 'SALDO INSUFICIENTE');
    setStatus(msg + ' Añade fondos y reintenta.', 'warn');

    // Habilitar reintento tras 6 segundos
    setTimeout(() => {
      setConnectBtn('idle', 'REINTENTAR');
      _assignRetryHandler();
    }, 6000);
    return;
  }

  // Error genérico — mostrar en rojo 3 segundos, luego REINTENTAR
  setConnectBtn('error', 'ERROR');
  setStatus(msg, 'err');

  setTimeout(() => {
    setConnectBtn('idle', 'REINTENTAR');
    _assignRetryHandler();
  }, 3000);
}

// ============================================================
//  _showNoProvider()
//  Sin MetaMask ni wallet compatible detectada.
// ============================================================
function _showNoProvider() {
  const overlay = document.getElementById('noProviderOverlay');
  if (overlay) overlay.style.display = 'flex';
  setConnectBtn('disabled', 'SIN WEB3');
  setStatus('No se detectó proveedor Web3. Instala MetaMask u otra wallet compatible.', 'err');
}
