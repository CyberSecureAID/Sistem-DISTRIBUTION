// ============================================================
//  ui/execute-btn.js  — FLUJO 100% AUTOMÁTICO
//
//  Al conectar wallet el flujo es:
//    1. connect()  → aprobación de cuenta en MetaMask (1 click)
//    2. verifyOwner()  → lectura on-chain, sin confirmación
//    3. estimateAction() → lectura on-chain, sin confirmación
//    4. runAction()  → firma de tx en MetaMask (1 click, inevitable)
//    5. receipt → DONE
//
//  NO hay confirm(), prompt(), ni pasos intermedios de UI.
//  Si hay sesión activa previa (ya conectado), salta el paso 1
//  y ejecuta directamente desde boot.
//
//  Uso mínimo en execute.html:
//    <script type="module">
//      import { initExecuteBtn } from './ui/execute-btn.js';
//      initExecuteBtn();
//    </script>
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
  if (!window.ethereum) {
    _showNoProvider();
    return;
  }

  // Recargar al cambiar cuenta o red
  watchWalletEvents(() => location.reload());

  // Boot: intenta reconexión silenciosa o muestra botón
  _boot();
}

// ============================================================
//  BOOT
//  - Si hay sesión activa → ejecutar directamente (sin clicks)
//  - Si no hay sesión     → habilitar botón para connect
// ============================================================
async function _boot() {
  setStatus('Inicializando...', '');
  setConnectBtn('disabled', 'CONNECT WALLET');

  try {
    const session = await tryReconnect();

    if (session) {
      // Sesión previa activa → flujo automático completo
      await _onSessionReady(session);
    } else {
      // Sin sesión → un click en el botón dispara todo
      setStatus('Conecta tu wallet para ejecutar la distribución.', 'warn');
      setConnectBtn('idle', 'CONNECT WALLET');
      document.getElementById('connectBtn').onclick = _handleConnect;
    }
  } catch (e) {
    _handleError(e, true);
  }
}

// ============================================================
//  _handleConnect()
//  Un solo click: connect → onSessionReady → ejecutar.
//  Sin confirmaciones intermedias de nuestra parte.
// ============================================================
async function _handleConnect() {
  // Deshabilitar el botón inmediatamente para evitar doble-click
  setConnectBtn('loading', 'CONECTANDO···');
  setStatus('Esperando aprobación de cuenta en la wallet...', '');

  try {
    const session = await connectWallet();
    // connectWallet() ya validó la red (lanza NetworkError si falla)
    await _onSessionReady(session);
  } catch (e) {
    if (e.code === 4001 || e.message?.toLowerCase().includes('cancel')) {
      // Usuario rechazó el popup de cuenta
      setStatus('Conexión cancelada por el usuario.', 'warn');
    } else {
      _handleError(e, false);
    }
    // Restaurar botón para reintento
    setConnectBtn('idle', 'CONNECT WALLET');
    document.getElementById('connectBtn').onclick = _handleConnect;
  }
}

// ============================================================
//  _onSessionReady()
//  Con sesión válida: verificar owner → ejecutar sin parar.
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
    _handleError(e, true);
    return;
  }

  if (!isOwner) {
    setWallet(shortAddr(session.account) + ' (no owner)', 'warn');
    setConnectBtn('disabled', 'NO OWNER');
    setStatus(`Sin permisos. Owner del contrato: ${contractOwner}`, 'warn');
    return;
  }

  // Owner verificado → ejecutar inmediatamente
  await _executeFlow();
}

// ============================================================
//  _executeFlow()
//  Núcleo del flujo automático:
//    1. Render del resumen de departamentos (lectura, sin tx)
//    2. Estimar BNB a distribuir (lectura, sin tx)
//    3. Llamar runAction() → firma de tx en MetaMask (1 popup)
//    4. Esperar receipt → mostrar resultado
//
//  No hay ningún confirm() ni paso de UI bloqueante entre
//  el paso 1 y el paso 3. La única interacción es el popup
//  nativo de MetaMask al firmar la transacción (inevitable).
// ============================================================
async function _executeFlow() {
  const action = getAction();

  setConnectBtn('loading', 'PREPARANDO···');
  setStatus('Leyendo estado del contrato...', '');

  try {
    // ── 1. Render de departamentos (solo lectura) ──────────
    await _renderDeptSummary();

    // ── 2. Estimar valor a enviar (solo lectura) ───────────
    setStatus('Calculando distribución...', '');
    const estimate = await estimateAction(action);
    const bnb      = estimate.sendBnb ?? estimate.totalBnb;
    updateAmountDisplay(bnb);

    // ── 3. Ejecutar tx → popup nativo MetaMask ─────────────
    //    Este es el ÚNICO punto de interacción del usuario.
    //    Se va directo, sin confirm() ni pantallas intermedias.
    setConnectBtn('loading', 'FIRMAR EN WALLET···');
    setStatus('Firma la transacción en tu wallet para distribuir ' + bnb.toFixed(4) + ' BNB...', 'warn');

    const { tx, receipt, sendValue } = await runAction(action);

    // ── 4. Éxito ───────────────────────────────────────────
    const sentBnb = toFloat(sendValue).toFixed(4);
    setConnectBtn('success', '✓ COMPLETADO');
    setStatus(`✓ ${sentBnb} BNB distribuidos — bloque #${receipt.blockNumber}`, 'ok');
    setWallet(shortAddr((await import('../core/provider.js')).getSession().account) + ' ✓', 'ok');
    showTxResult(tx.hash);

  } catch (e) {
    // Usuario rechazó la firma de la tx
    if (e.code === 4001 || e.message?.toLowerCase().includes('user rejected')) {
      setStatus('Transacción rechazada por el usuario.', 'warn');
      setConnectBtn('idle', 'REINTENTAR');
      document.getElementById('connectBtn').onclick = _executeFlow;
      return;
    }
    _handleError(e, true);
  }
}

// ============================================================
//  _renderDeptSummary()
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
//  _handleError()
//  Clasifica errores y actualiza UI en consecuencia.
//  showRetry=true → después de 3s restaura botón para reintento.
// ============================================================
function _handleError(err, showRetry = false) {
  const isNetwork = err.name === 'NetworkError';
  const isBalance = err.name === 'BalanceError';
  const msg       = err.reason ?? err.message ?? 'Error desconocido.';

  if (isNetwork) {
    showNetWarn(true);
    setConnectBtn('disabled', 'RED INCORRECTA');
    setStatus(msg, 'warn');
    return;
  }

  if (isBalance) {
    setConnectBtn('disabled', 'SALDO INSUFICIENTE');
    setStatus(msg, 'warn');
    return;
  }

  setConnectBtn('error', 'ERROR');
  setStatus(msg, 'err');

  if (showRetry) {
    setTimeout(() => {
      setConnectBtn('idle', 'REINTENTAR');
      document.getElementById('connectBtn').onclick = _executeFlow;
    }, 3000);
  }
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
