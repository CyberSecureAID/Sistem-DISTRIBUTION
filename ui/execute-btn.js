// ============================================================
//  ui/execute-btn.js  — v2.2 (corregido)
//
//  FLUJO AUTOMATIZADO:
//    1. _boot()        — tryReconnect() silencioso al cargar la página
//    2. Si sesión + red ok  → _onSessionReady() → _executeFlow() automático
//    3. Si red incorrecta   → banner + botón "CONNECT WALLET"
//    4. Si sin sesión       → botón "CONNECT WALLET" habilitado
//    5. Click botón         → _handleConnect() → _onSessionReady() → _executeFlow()
//
//  CORRECCIONES v2.2:
//  1. _assignRetryHandler(): función centralizada que asigna el handler
//     correcto al botón según si hay sesión activa o no. Elimina la
//     duplicación y evita que el botón quede sin handler en cualquier
//     rama del flujo (boot auto, reintento, error de red, etc.).
//
//  2. _onSessionReady(): asigna _handleConnect al #connectBtn al inicio
//     por si verifyOwner() falla — el botón siempre tiene un handler
//     válido antes de cualquier await.
//
//  3. _executeFlow(): `bnb` calculado con fallback explícito para evitar
//     NaN cuando una acción devuelve solo sendBnb o solo totalBnb.
//
//  4. _executeFlow(): tras rechazo de firma, verifica getSession().ready
//     para decidir si el reintento va a _executeFlow o _handleConnect.
//
//  5. _boot(): tras sesión automática válida, asigna el handler de
//     reintento antes de entrar al flujo, de modo que cualquier error
//     en _onSessionReady deja el botón operativo.
//
//  6. _handleError(): usa _assignRetryHandler() en lugar de lógica
//     inline duplicada.
// ============================================================

import { connectWallet, tryReconnect, verifyOwner, watchWalletEvents, getSession } from '../core/provider.js';
import { runAction, estimateAction, BalanceError }                                  from '../modules/distribution.js';
import { getAction }                                                                 from '../modules/config.js';
import { getAllDepartments, formatDepartmentPayment }                                from '../modules/departments.js';
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
//  actual de sesión. Centraliza la lógica para evitar que el
//  botón quede sin handler en cualquier rama del flujo.
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
//    null              → sin sesión  → botón CONNECT WALLET
//    { wrongNetwork }  → red mala    → banner + botón CONNECT
//    sesión válida     → flujo auto  → _onSessionReady()
// ============================================================
async function _boot() {
  setStatus('Inicializando...', '');
  setConnectBtn('disabled', 'CARGANDO···');

  try {
    const result = await tryReconnect();

    // CASO 1: red incorrecta detectada en reconexión silenciosa
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
      // Asignar handler de reintento ANTES del await para que cualquier
      // error posterior deje el botón operativo
      document.getElementById('connectBtn').onclick = _executeFlow;
      await _onSessionReady(result);
      return;
    }

    // CASO 3: sin sesión previa
    setStatus('Conecta tu wallet para ejecutar la distribución.', 'warn');
    setConnectBtn('idle', 'CONNECT WALLET');
    document.getElementById('connectBtn').onclick = _handleConnect;

  } catch (e) {
    _handleError(e, /* isSessionActive */ false);
  }
}

// ============================================================
//  _handleConnect()
//  Click manual en el botón → connect → verificar → ejecutar.
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
      _handleError(e, /* isSessionActive */ false);
    }
    setConnectBtn('idle', 'CONNECT WALLET');
    document.getElementById('connectBtn').onclick = _handleConnect;
  }
}

// ============================================================
//  _onSessionReady()
//  Verifica que la wallet sea el owner y lanza el flujo de ejecución.
// ============================================================
async function _onSessionReady(session) {
  showNetWarn(false);
  setWallet(shortAddr(session.account), 'ok');
  setConnectBtn('loading', 'VERIFICANDO···');
  setStatus('Verificando permisos de owner...', '');

  // Asignar handler de conexión por defecto antes del await
  // para que si verifyOwner() falla, el botón sea operable
  document.getElementById('connectBtn').onclick = _handleConnect;

  let isOwner, contractOwner;
  try {
    ({ isOwner, contractOwner } = await verifyOwner());
  } catch (e) {
    _handleError(e, /* isSessionActive */ true);
    return;
  }

  if (!isOwner) {
    setWallet(shortAddr(session.account) + ' (no owner)', 'warn');
    setConnectBtn('disabled', 'NO OWNER');
    setStatus(`Sin permisos. Owner del contrato: ${contractOwner}`, 'warn');
    return;
  }

  // Owner verificado — lanzar flujo automático
  await _executeFlow();
}

// ============================================================
//  _executeFlow()
//  Asume sesión activa y owner verificado.
//  1. Render departamentos (solo lectura)
//  2. Estimar BNB (solo lectura)
//  3. runAction() → popup MetaMask (único click del usuario)
//  4. Receipt → DONE
// ============================================================
async function _executeFlow() {
  const action = getAction();

  setConnectBtn('loading', 'PREPARANDO···');
  setStatus('Leyendo estado del contrato...', '');

  try {
    await _renderDeptSummary();

    setStatus('Calculando distribución...', '');
    const estimate = await estimateAction(action);

    // CORRECCIÓN: calcular bnb con fallback explícito para evitar NaN
    // estimateDrainOwner devuelve { sendBnb }, estimateDistribute devuelve { totalBnb }
    const bnb = (typeof estimate.sendBnb === 'number')
      ? estimate.sendBnb
      : (typeof estimate.totalBnb === 'number')
        ? estimate.totalBnb
        : toFloat(estimate.sendValue ?? 0);

    updateAmountDisplay(bnb);

    setConnectBtn('loading', 'FIRMAR EN WALLET···');
    setStatus(`Firma la transacción en tu wallet para distribuir ${bnb.toFixed(4)} BNB...`, 'warn');

    // CORRECCIÓN: pasar el sendValue ya estimado para evitar doble lectura de balance
    const { tx, receipt, sendValue } = await runAction(action, estimate.sendValue);

    const sentBnb = toFloat(sendValue).toFixed(4);
    setConnectBtn('success', '✓ COMPLETADO');
    setStatus(`✓ ${sentBnb} BNB distribuidos — bloque #${receipt.blockNumber}`, 'ok');
    setWallet(shortAddr(getSession().account) + ' ✓', 'ok');
    showTxResult(tx.hash);

  } catch (e) {
    // Usuario rechazó la firma en MetaMask
    if (e.code === 4001 || e.message?.toLowerCase().includes('user rejected')) {
      setStatus('Transacción rechazada por el usuario.', 'warn');
      setConnectBtn('idle', 'REINTENTAR');
      // CORRECCIÓN: verificar si hay sesión activa para elegir el handler correcto
      _assignRetryHandler();
      return;
    }
    // Cualquier otro error
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
//  CORRECCIÓN: usa _assignRetryHandler() en lugar de lógica
//  inline duplicada — garantiza el handler correcto en todos
//  los casos.
//
//  @param {Error}   err
//  @param {boolean} isSessionActive
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

  // Restaurar botón de reintento con el handler correcto
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
