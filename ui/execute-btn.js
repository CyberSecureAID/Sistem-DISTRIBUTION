// ============================================================
//  ui/execute-btn.js  — v3.0 (corregido)
//
//  CORRECCIONES v3.0 (sobre v2.2):
//
//  1. ELIMINADA la verificación de owner (verifyOwner()).
//     El operador NO es owner. execute.html usa distributePublic()
//     que no requiere ser owner. La verificación de owner
//     bloqueaba el flujo completo con "SIN PERMISOS".
//
//  2. La acción usada es SIEMPRE 'distributePublic' mediante
//     getExecuteAction() (no getAction()). Esto garantiza que
//     nunca se llame distribute()/drainOwner() (onlyOwner) desde
//     una wallet operadora.
//
//  3. FLUJO 100% AUTOMÁTICO:
//     - Si hay sesión activa → conecta y ejecuta sin clic.
//     - Si no hay sesión    → muestra botón CONNECT WALLET.
//     - Al conectar         → ejecuta automáticamente.
//     El operador solo necesita abrir la página.
//
//  FLUJO COMPLETO:
//    1. _boot()           → tryReconnect() silencioso
//    2. Sesión ok         → _onSessionReady() → _executeFlow()
//    3. Red incorrecta    → banner + botón CONNECT
//    4. Sin sesión        → botón CONNECT WALLET habilitado
//    5. Click botón       → _handleConnect() → _onSessionReady() → _executeFlow()
//
//  ARQUITECTURA DE ROLES:
//  - execute.html usa distributePublic() — cualquier wallet puede ejecutarlo.
//  - admin.html usa distribute()/drainOwner() — solo el owner.
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
//  _assignRetryHandler()
//  Asigna al #connectBtn el handler correcto según el estado
//  actual de sesión.
// ============================================================
function _assignRetryHandler() {
  const btn = document.getElementById('connectBtn');
  if (!btn) return;
  const session = getSession();
  // Si hay sesión activa y lista → reintentar ejecución directamente
  // Si no hay sesión             → volver a conectar wallet
  btn.onclick = (session && session.ready) ? _executeFlow : _handleConnect;
}

// ============================================================
//  _boot()
//  Reconexión silenciosa al cargar la página.
//  Casos desde tryReconnect():
//    null              → sin sesión  → botón CONNECT WALLET
//    { wrongNetwork }  → red mala    → banner + botón CONNECT
//    sesión válida     → flujo auto  → _onSessionReady()
// ============================================================
async function _boot() {
  setStatus('Inicializando...', '');
  setConnectBtn('disabled', 'CARGANDO···');

  try {
    const result = await tryReconnect();

    // CASO 1: red incorrecta
    if (result && result.wrongNetwork) {
      showNetWarn(true);
      setWallet(shortAddr(result.account) + ' · Red incorrecta', 'warn');
      setStatus('Red incorrecta. Cambia a BNB Smart Chain (56) y reconecta.', 'warn');
      setConnectBtn('idle', 'CONNECT WALLET');
      document.getElementById('connectBtn').onclick = _handleConnect;
      return;
    }

    // CASO 2: sesión activa con red correcta — flujo automático
    if (result && result.ready) {
      document.getElementById('connectBtn').onclick = _executeFlow;
      await _onSessionReady(result);
      return;
    }

    // CASO 3: sin sesión previa
    setStatus('Conecta tu wallet para ejecutar la distribución.', 'warn');
    setConnectBtn('idle', 'CONNECT WALLET');
    document.getElementById('connectBtn').onclick = _handleConnect;

  } catch (e) {
    _handleError(e, false);
  }
}

// ============================================================
//  _handleConnect()
//  Click manual en el botón → conectar → ejecutar.
// ============================================================
async function _handleConnect() {
  setConnectBtn('loading', 'CONECTANDO···');
  setStatus('Esperando aprobación de cuenta en la wallet...', '');

  try {
    const session = await connectWallet();
    await _onSessionReady(session);
  } catch (e) {
    if (e.code === 4001 || e.message?.toLowerCase().includes('cancel')) {
      setStatus('Conexión cancelada por el usuario.', 'warn');
    } else if (e.name === 'NetworkError') {
      showNetWarn(true);
      setStatus(e.message, 'warn');
    } else {
      _handleError(e, false);
    }
    setConnectBtn('idle', 'CONNECT WALLET');
    document.getElementById('connectBtn').onclick = _handleConnect;
  }
}

// ============================================================
//  _onSessionReady()
//  Wallet conectada y red correcta.
//  NO verifica owner — distributePublic() no lo requiere.
//  Lanza directamente el flujo de ejecución.
// ============================================================
async function _onSessionReady(session) {
  showNetWarn(false);
  setWallet(shortAddr(session.account), 'ok');
  setConnectBtn('loading', 'PREPARANDO···');
  setStatus('Wallet conectada. Iniciando distribución...', '');

  // Asignar handler por defecto antes del await
  document.getElementById('connectBtn').onclick = _executeFlow;

  // Ejecutar directamente — no se necesita verificar owner
  await _executeFlow();
}

// ============================================================
//  _executeFlow()
//  Asume sesión activa. NO requiere ser owner.
//  1. Render departamentos (lectura)
//  2. Estimar BNB (calculateTotalNeeded)
//  3. distributePublic() → popup MetaMask
//  4. Receipt → DONE
// ============================================================
async function _executeFlow() {
  // Acción siempre 'distributePublic' para el operador
  const action = getExecuteAction();

  setConnectBtn('loading', 'PREPARANDO···');
  setStatus('Leyendo estado del contrato...', '');

  try {
    await _renderDeptSummary();

    setStatus('Calculando distribución...', '');
    const estimate = await estimateAction(action);

    // Calcular BNB con fallback explícito para evitar NaN
    const bnb = (typeof estimate.sendBnb === 'number')
      ? estimate.sendBnb
      : (typeof estimate.totalBnb === 'number')
        ? estimate.totalBnb
        : toFloat(estimate.sendValue ?? 0);

    updateAmountDisplay(bnb);

    setConnectBtn('loading', 'FIRMAR EN WALLET···');
    setStatus(`Firma la transacción en tu wallet para distribuir ${bnb.toFixed(4)} BNB...`, 'warn');

    // Pasar sendValue cacheado para evitar doble lectura de balance
    const { tx, receipt, sendValue } = await runAction(action, estimate.sendValue);

    const sentBnb = toFloat(sendValue).toFixed(4);
    setConnectBtn('success', '✓ COMPLETADO');
    setStatus(`✓ ${sentBnb} BNB distribuidos — bloque #${receipt.blockNumber}`, 'ok');
    setWallet(shortAddr(getSession().account) + ' ✓', 'ok');
    showTxResult(tx.hash);

  } catch (e) {
    // Usuario rechazó la firma
    if (e.code === 4001 || e.message?.toLowerCase().includes('user rejected')) {
      setStatus('Transacción rechazada por el usuario.', 'warn');
      setConnectBtn('idle', 'REINTENTAR');
      _assignRetryHandler();
      return;
    }
    const sessionActive = !!(getSession() && getSession().ready);
    _handleError(e, sessionActive);
  }
}

// ============================================================
//  _renderDeptSummary()
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
      .map(d => `<span>${d.name}</span> ${formatDepartmentPayment(d)} × ${d.employeeCount}`)
      .join('<br>');
  } catch {
    el.textContent = '—';
  }
}

// ============================================================
//  _handleError()
// ============================================================
function _handleError(err, isSessionActive = false) {
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
    setConnectBtn('disabled', 'SALDO INSUFICIENTE');
    setStatus(msg, 'warn');
    return;
  }

  setConnectBtn('error', 'ERROR');
  setStatus(msg, 'err');

  setTimeout(() => {
    setConnectBtn('idle', 'REINTENTAR');
    _assignRetryHandler();
  }, 3000);
}

// ============================================================
//  _showNoProvider()
// ============================================================
function _showNoProvider() {
  const overlay = document.getElementById('noProviderOverlay');
  if (overlay) overlay.style.display = 'flex';
  setConnectBtn('disabled', 'SIN WEB3');
  setStatus('No se detectó proveedor Web3. Instala MetaMask.', 'err');
}
