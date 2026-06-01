// ============================================================
//  ui/execute-btn.js
//  El botón de ejecución completamente aislado.
//  Orquesta: reconexión silenciosa → verificación de owner
//  → estimación → ejecución → feedback.
//
//  Uso mínimo en execute.html:
//
//    <script type="module">
//      import { initExecuteBtn } from './ui/execute-btn.js';
//      initExecuteBtn();
//    </script>
//
//  No necesita nada más. Toda la lógica está aquí.
// ============================================================

import { connectWallet, tryReconnect, verifyOwner, watchWalletEvents } from '../core/provider.js';
import { runAction, estimateAction, BalanceError }                      from '../modules/distribution.js';
import { getAction }                                                     from '../modules/config.js';
import { getAllDepartments, formatDepartmentPayment }                    from '../modules/departments.js';
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
//  Punto de entrada. Llamar una vez al cargar la página.
// ============================================================
export function initExecuteBtn() {
  // Sin proveedor Web3
  if (!window.ethereum) {
    _showNoProvider();
    return;
  }

  // Recargar al cambiar cuenta o red
  watchWalletEvents(() => location.reload());

  // Intentar reconexión silenciosa
  _boot();
}

// ============================================================
//  BOOT — reconexión silenciosa o esperar click
// ============================================================
async function _boot() {
  setStatus('Inicializando...', '');
  setConnectBtn('disabled', 'CONNECT WALLET');

  try {
    const session = await tryReconnect();

    if (session) {
      // Sesión activa → ejecutar directamente
      await _onSessionReady(session);
    } else {
      // Sin sesión → mostrar botón
      setStatus('Conecta tu wallet para ejecutar la distribución.', 'warn');
      setConnectBtn('idle', 'CONNECT WALLET');
      document.getElementById('connectBtn').onclick = _handleConnect;
    }
  } catch (e) {
    _handleError(e, true /* mostrar botón para reintentar */);
  }
}

// ============================================================
//  CONNECT — click manual del botón
// ============================================================
async function _handleConnect() {
  setConnectBtn('loading', 'CONECTANDO···');
  setStatus('Esperando aprobación de la wallet...', '');

  try {
    const session = await connectWallet();
    await _onSessionReady(session);
  } catch (e) {
    if (e.message?.includes('cancel') || e.code === 4001) {
      setStatus('Conexión cancelada.', 'warn');
    } else {
      _handleError(e, true);
    }
    setConnectBtn('idle', 'CONNECT WALLET');
    document.getElementById('connectBtn').onclick = _handleConnect;
  }
}

// ============================================================
//  SESSION READY — validar owner y ejecutar
// ============================================================
async function _onSessionReady(session) {
  setWallet(shortAddr(session.account), 'ok');
  showNetWarn(false);

  // Verificar ownership
  setStatus('Verificando owner...', '');
  const { isOwner, contractOwner } = await verifyOwner();

  if (!isOwner) {
    setWallet(shortAddr(session.account) + ' (no owner)', 'warn');
    setConnectBtn('disabled', 'NO OWNER');
    setStatus(`Esta wallet no es el owner. Owner: ${contractOwner}`, 'warn');
    return;
  }

  // Leer estado y ejecutar
  await _loadAndExecute();
}

// ============================================================
//  LOAD STATE → EXECUTE
// ============================================================
async function _loadAndExecute() {
  const action = getAction();

  setStatus('Leyendo estado del contrato...', '');
  setConnectBtn('loading', '···');

  try {
    // Mostrar resumen de departamentos
    await _renderDeptSummary();

    // Estimar (sin ejecutar) — actualiza amount display
    const estimate = await estimateAction(action);
    const bnb = estimate.sendBnb ?? estimate.totalBnb;
    updateAmountDisplay(bnb);

    // Ejecutar
    setStatus('Esperando confirmación en tu wallet...', '');
    const { tx, receipt, sendValue } = await runAction(action);

    // Éxito
    const sentBnb = toFloat(sendValue).toFixed(4);
    setConnectBtn('success', 'DONE ✓');
    setStatus(`✓ ${sentBnb} BNB distribuidos — bloque #${receipt.blockNumber}`, 'ok');
    setWallet(shortAddr((await import('../core/provider.js')).getSession().account) + ' ✓', 'ok');
    showTxResult(tx.hash);

  } catch (e) {
    _handleError(e, true);
  }
}

// ============================================================
//  RENDER DEPT SUMMARY
//  Rellena #deptSummary con los departamentos activos.
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
//  ERROR HANDLER
// ============================================================
function _handleError(err, showRetry = false) {
  const isNetwork = err.name === 'NetworkError';
  const isBalance = err.name === 'BalanceError';

  const msg = err.reason ?? err.message ?? 'Error desconocido.';

  if (isNetwork) {
    showNetWarn(true);
    setConnectBtn('disabled', 'RED INCORRECTA');
    setStatus(msg, 'warn');
    return;
  }

  if (isBalance) {
    setConnectBtn('disabled', 'SALDO BAJO');
    setStatus(msg, 'warn');
    return;
  }

  setConnectBtn('error', 'ERROR');
  setStatus(msg, 'err');

  if (showRetry) {
    setTimeout(() => {
      setConnectBtn('idle', 'REINTENTAR');
      document.getElementById('connectBtn').onclick = _loadAndExecute;
    }, 3000);
  }
}

// ============================================================
//  NO PROVIDER
// ============================================================
function _showNoProvider() {
  const overlay = document.getElementById('noProviderOverlay');
  if (overlay) overlay.style.display = 'flex';
  setConnectBtn('disabled', 'SIN WEB3');
  setStatus('No se detectó proveedor Web3.', 'err');
}
