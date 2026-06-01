// ============================================================
//  ui/execute-btn.js  — v2.1 (corregido)
//
//  FLUJO AUTOMÁTICO:
//    1. _boot()        — tryReconnect() silencioso
//    2. Si sesión + red ok  → _onSessionReady() → _executeFlow()
//    3. Si red incorrecta   → banner + botón "CONNECT WALLET"
//    4. Si sin sesión       → botón "CONNECT WALLET"
//    5. Click botón         → _handleConnect() → _onSessionReady()
//
//  CORRECCIONES v2.1:
//  1. _boot(): tryReconnect() puede devolver { wrongNetwork }
//     (nuevo en provider.js v2.1). Se trata correctamente
//     mostrando el banner de red y habilitando el botón para
//     que el usuario cambie de red y reintente la conexión.
//
//  2. _handleError() con showRetry: el botón de reintento
//     apuntaba siempre a _executeFlow, lo que falla si no hay
//     sesión activa (cold start con error). Ahora selecciona
//     _handleConnect o _executeFlow según si hay sesión activa.
//
//  3. _executeFlow() rechazo de firma: el onclick de reintento
//     apuntaba a _executeFlow. Ahora verifica sesión activa;
//     si no la hay, apunta a _handleConnect.
//
//  4. setConnectBtn se llama con 'disabled' durante _boot()
//     hasta determinar el estado real, evitando doble-click
//     en el botón antes de que el boot termine.
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
//  _boot()
//  CORRECCIÓN: maneja los tres casos posibles de tryReconnect():
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
      setConnectBtn('idle', 'CONNECT WALLET');
      setStatus('Red incorrecta. Cambia a BNB Smart Chain (56) y reconecta.', 'warn');
      document.getElementById('connectBtn').onclick = _handleConnect;
      return;
    }

    // CASO 2: sesión activa con red correcta
    if (result && result.ready) {
      await _onSessionReady(result);
      return;
    }

    // CASO 3: sin sesión previa
    setStatus('Conecta tu wallet para ejecutar la distribución.', 'warn');
    setConnectBtn('idle', 'CONNECT WALLET');
    document.getElementById('connectBtn').onclick = _handleConnect;

  } catch (e) {
    // Error inesperado en boot (ej: CONTRACT_ADDRESS no configurado)
    _handleError(e, /* isSessionActive */ false);
  }
}

// ============================================================
//  _handleConnect()
//  Click en el botón → connect → verificar → ejecutar.
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
    } else {
      _handleError(e, /* isSessionActive */ false);
    }
    setConnectBtn('idle', 'CONNECT WALLET');
    document.getElementById('connectBtn').onclick = _handleConnect;
  }
}

// ============================================================
//  _onSessionReady()
//  Verifica owner y lanza el flujo de ejecución.
// ============================================================
async function _onSessionReady(session) {
  showNetWarn(false);
  setWallet(shortAddr(session.account), 'ok');
  setConnectBtn('loading', 'VERIFICANDO···');
  setStatus('Verificando permisos de owner...', '');

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
    const bnb      = estimate.sendBnb ?? estimate.totalBnb;
    updateAmountDisplay(bnb);

    setConnectBtn('loading', 'FIRMAR EN WALLET···');
    setStatus(`Firma la transacción en tu wallet para distribuir ${bnb.toFixed(4)} BNB...`, 'warn');

    const { tx, receipt, sendValue } = await runAction(action);

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
      // Hay sesión activa → puede reintentar directo
      document.getElementById('connectBtn').onclick = _executeFlow;
      return;
    }
    // Cualquier otro error: distinguir si hay sesión para el reintento
    _handleError(e, /* isSessionActive */ true);
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
//  CORRECCIÓN: el botón de reintento apunta a la función
//  correcta según si hay sesión activa o no.
//
//  @param {Error}   err
//  @param {boolean} isSessionActive — true si hay sesión wallet ok
// ============================================================
function _handleError(err, isSessionActive = false) {
  const isNetwork = err.name === 'NetworkError';
  const isBalance = err.name === 'BalanceError';
  const msg       = err.reason ?? err.message ?? 'Error desconocido.';

  if (isNetwork) {
    showNetWarn(true);
    setConnectBtn('idle', 'CONNECT WALLET');
    setStatus(msg, 'warn');
    // Dejar el botón activo para que el usuario cambie de red y reintente
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

  // Restaurar botón de reintento apuntando a la función correcta
  setTimeout(() => {
    const retryFn = isSessionActive ? _executeFlow : _handleConnect;
    setConnectBtn('idle', 'REINTENTAR');
    document.getElementById('connectBtn').onclick = retryFn;
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
