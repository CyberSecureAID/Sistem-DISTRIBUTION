// ============================================================
//  ui/execute-btn.js  — v4.3 (corregido)
//
//  CORRECCIONES v4.3 (sobre v4.2):
//
//  1. BUG-TX-TIMING CORREGIDO: El hash de la tx ahora se muestra
//     INMEDIATAMENTE tras el submit (pre-confirmación) mediante el
//     callback onSubmit que se pasa a runAction(). El usuario puede
//     ver el link a BscScan mientras espera que se mine el bloque.
//     Durante la espera el botón muestra "CONFIRMING..." con el
//     hash visible.
//
//  2. NoEmployeesError MANEJADO: Si el contrato no tiene empleados
//     activos, se muestra el mensaje correcto en lugar de un error
//     genérico que confundiría al operador.
//
//  3. UX DEVMODE MEJORADA: El statusLine en devMode ahora indica
//     explícitamente que el acceso al panel admin se hace con
//     5 clics en la esquina inferior izquierda.
//
//  CORRECCIONES HEREDADAS v4.2:
//  - BUG-1: goAdmin() apunta a './admin.html' (no './admin/').
//  - BUG-4: timing correcto del mensaje "SIGN IN WALLET...".
//
//  CORRECCIONES HEREDADAS v4.1:
//  - Botón siempre habilitado tras boot (no disabled en HTML).
//  - Handler asignado ANTES de llamar a _boot().
//  - Manejo correcto de devMode.
// ============================================================

import { connectWallet, tryReconnect, watchWalletEvents, getSession, getBalance } from '../core/provider.js';
import { runAction, estimateAction, BalanceError, NoEmployeesError } from '../modules/distribution.js';
import { getExecuteAction }                           from '../modules/config.js';
import { getAllDepartments, formatDepartmentPayment } from '../modules/departments.js';
import { isAuthorized }                              from '../modules/auth.js';
import {
  setStatus,
  setWallet,
  setConnectBtn,
  showTxResult,
  showNetWarn,
  updateAmountDisplay
} from './status.js';
import { shortAddr, toFloat } from '../core/utils.js';

// ── Estado del trigger de 5 clics ──────────────────────────
let _clickCount   = 0;
let _clickTimer   = null;
const CLICK_MAX   = 5;
const CLICK_RESET = 2000;

// ============================================================
//  initExecuteBtn()
// ============================================================
export function initExecuteBtn() {
  if (!window.ethereum) {
    _showNoProvider();
    _initAdminTrigger();
    return;
  }

  // ── REGLA CRÍTICA: Handler asignado ANTES del boot ──────
  // Si el boot falla por cualquier razón, el usuario siempre
  // puede hacer clic en el botón para intentar conectar.
  const btn = document.getElementById('connectBtn');
  if (btn) {
    btn.disabled = false;
    btn.onclick  = _handleConnect;
  }

  watchWalletEvents(() => location.reload());
  _initAdminTrigger();
  _boot();
}

// ============================================================
//  _initAdminTrigger()
//  Zona de 5 clics en la esquina inferior izquierda
//  para abrir el panel de admin.
// ============================================================
function _initAdminTrigger() {
  const trigger   = document.getElementById('adminTrigger');
  const indicator = document.getElementById('clickIndicator');
  if (!trigger) return;

  trigger.addEventListener('click', () => {
    if (_clickTimer) clearTimeout(_clickTimer);
    _clickTimer = setTimeout(_resetClickCount, CLICK_RESET);

    _clickCount++;

    for (let i = 0; i < CLICK_MAX; i++) {
      const dot = document.getElementById('cd' + i);
      if (dot) dot.classList.toggle('lit', i < _clickCount);
    }
    if (indicator) indicator.classList.add('visible');

    if (_clickCount >= CLICK_MAX) {
      _resetClickCount();
      _triggerAdminAccess();
    }
  });
}

function _resetClickCount() {
  _clickCount = 0;
  if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
  const indicator = document.getElementById('clickIndicator');
  if (indicator) indicator.classList.remove('visible');
  for (let i = 0; i < CLICK_MAX; i++) {
    const dot = document.getElementById('cd' + i);
    if (dot) dot.classList.remove('lit');
  }
}

// ============================================================
//  _triggerAdminAccess()
// ============================================================
async function _triggerAdminAccess() {
  const modal    = document.getElementById('authModal');
  const sub      = document.getElementById('authModalSub');
  const checking = document.getElementById('authChecking');
  const errEl    = document.getElementById('authErr');
  const btnRow   = document.getElementById('authBtnRow');

  if (!modal) return;

  if (sub)      sub.textContent      = 'Verifying wallet permissions...';
  if (errEl)    errEl.textContent    = '';
  if (checking) checking.textContent = 'Checking...';
  if (btnRow)   btnRow.style.display = 'none';

  modal.classList.add('open');

  const session = getSession();
  if (!session || !session.account) {
    if (checking) checking.textContent = '';
    if (errEl)    errEl.textContent = 'Connect your wallet first to verify access.';
    if (btnRow)   btnRow.style.display = 'grid';
    const btnGo = document.getElementById('btnGoAdmin');
    if (btnGo)  btnGo.disabled = true;
    return;
  }

  if (session.devMode) {
    if (checking) checking.textContent = '';
    if (sub)  sub.textContent  = '⚙ Dev mode — contract not deployed.';
    if (errEl) errEl.textContent = 'Dev mode: contract not deployed. You can access the admin panel to review its design and configure parameters. Deploy the contract to enable full on-chain functionality.';
    if (btnRow) btnRow.style.display = 'grid';
    const btnGo = document.getElementById('btnGoAdmin');
    if (btnGo) btnGo.disabled = false;
    return;
  }

  try {
    const { authorized, isOwner, reason } = await isAuthorized(session.account, session.contract);
    if (checking) checking.textContent = '';

    if (authorized) {
      if (sub) sub.textContent = isOwner
        ? '✓ Owner wallet verified. Access granted.'
        : '✓ Authorized wallet. Access granted.';
      if (btnRow)  btnRow.style.display = 'grid';
      const btnGo = document.getElementById('btnGoAdmin');
      if (btnGo)  btnGo.disabled = false;
    } else {
      if (sub)  sub.textContent  = 'Access denied.';
      if (errEl) errEl.textContent = reason;
      if (btnRow) btnRow.style.display = 'grid';
      const btnGo = document.getElementById('btnGoAdmin');
      if (btnGo)  btnGo.disabled = true;
    }
  } catch (e) {
    if (checking) checking.textContent = '';
    if (errEl)    errEl.textContent = 'Error verifying wallet: ' + (e.message ?? 'Unknown error.');
    if (btnRow)   btnRow.style.display = 'grid';
    const btnGo = document.getElementById('btnGoAdmin');
    if (btnGo)  btnGo.disabled = true;
  }
}

// ── Exportadas para HTML inline ─────────────────────────────
export function openAuthModal()  { _triggerAdminAccess(); }
export function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.classList.remove('open');
}

// BUG-1 CORREGIDO: apunta a './admin.html' (no './admin/')
export function goAdmin() {
  window.location.href = './admin.html';
}

// ============================================================
//  _isUserRejection()
// ============================================================
function _isUserRejection(err) {
  if (err.code === 4001) return true;
  const msg = (err.message ?? '').toLowerCase();
  return (
    msg.includes('user rejected')  ||
    msg.includes('user denied')    ||
    msg.includes('user cancelled') ||
    msg.includes('request rejected')
  );
}

// ============================================================
//  _assignRetryHandler()
// ============================================================
function _assignRetryHandler() {
  const btn = document.getElementById('connectBtn');
  if (!btn) return;
  const session = getSession();
  btn.onclick = (session && session.ready) ? _executeFlow : _handleConnect;
}

// ============================================================
//  _boot()
//  Arranque automático — tryReconnect NUNCA lanza excepciones.
// ============================================================
async function _boot() {
  setStatus('Initializing...', '');
  setConnectBtn('loading', 'LOADING...');

  try {
    const result = await tryReconnect();

    if (result && result.wrongNetwork) {
      showNetWarn(true);
      setWallet(shortAddr(result.account) + ' · Wrong network', 'warn');
      setStatus('Wrong network. Switch to BNB Smart Chain (chainId 56) in your wallet.', 'warn');
      setConnectBtn('idle', 'CONNECT WALLET');
      _setBtn(_handleConnect);
      return;
    }

    if (result && result.account && result.devMode) {
      setWallet(shortAddr(result.account), 'warn');
      // UX DEVMODE MEJORADA: indica cómo acceder al admin
      setStatus('Contract not deployed yet. To access the admin panel: click 5 times on the bottom-left corner.', 'warn');
      setConnectBtn('disabled', 'CONTRACT PENDING');
      return;
    }

    if (result && result.ready) {
      await _onSessionReady(result);
      return;
    }

    // Sin wallet conectada: mostrar botón habilitado
    setStatus('Connect your wallet to distribute rewards.', 'warn');
    setConnectBtn('idle', 'CONNECT WALLET');
    _setBtn(_handleConnect);

  } catch (e) {
    _handleError(e);
  }
}

// ============================================================
//  _handleConnect()
// ============================================================
async function _handleConnect() {
  setConnectBtn('loading', 'CONNECTING...');
  setStatus('Waiting for wallet approval...', '');

  try {
    const session = await connectWallet();
    await _onSessionReady(session);
  } catch (e) {
    if (_isUserRejection(e)) {
      setStatus('Connection cancelled. Click to try again.', 'warn');
      setConnectBtn('idle', 'CONNECT WALLET');
      _setBtn(_handleConnect);
    } else if (e.name === 'NetworkError') {
      showNetWarn(true);
      setStatus(e.message, 'warn');
      setConnectBtn('idle', 'CONNECT WALLET');
      _setBtn(_handleConnect);
    } else {
      _handleError(e);
    }
  }
}

// ============================================================
//  _onSessionReady()
// ============================================================
async function _onSessionReady(session) {
  showNetWarn(false);

  if (session.devMode) {
    setWallet(shortAddr(session.account), 'warn');
    setStatus('Contract not deployed yet. To access the admin panel: click 5 times on the bottom-left corner.', 'warn');
    setConnectBtn('disabled', 'CONTRACT PENDING');
    return;
  }

  setWallet(shortAddr(session.account), 'ok');
  setConnectBtn('loading', 'PREPARING...');
  setStatus('Wallet connected. Preparing distribution...', '');

  _updateWalletBalance(session.account);
  _setBtn(_executeFlow);
  await _executeFlow();
}

// ============================================================
//  _updateWalletBalance()
// ============================================================
async function _updateWalletBalance(account) {
  try {
    const balEl = document.getElementById('walletBal');
    if (!balEl) return;
    const bal = await getBalance(account);
    balEl.textContent = toFloat(bal).toFixed(4) + ' BNB';
  } catch { /* silencioso */ }
}

// ============================================================
//  _executeFlow()
//
//  CORRECCIÓN BUG-TX-TIMING v4.3:
//  Se pasa un callback onSubmit a runAction(). Este callback
//  se invoca JUSTO DESPUÉS del submit de la tx (cuando el hash
//  ya está disponible) y ANTES de tx.wait(). Así el usuario
//  ve el link a BscScan mientras espera la confirmación.
//
//  BUG-4 CORREGIDO (v4.2): "SIGN IN WALLET..." aparece justo
//  antes de llamar a runAction(), con un tick de repintado
//  para que el navegador actualice la UI antes de que MetaMask
//  muestre su popup.
// ============================================================
async function _executeFlow() {
  const session = getSession();
  if (!session || !session.ready) {
    setStatus('Session lost. Please reconnect.', 'warn');
    setConnectBtn('idle', 'CONNECT WALLET');
    _setBtn(_handleConnect);
    return;
  }

  const action = getExecuteAction(); // siempre 'distributePublic'

  setConnectBtn('loading', 'PREPARING...');
  setStatus('Reading contract state...', '');

  try {
    await _renderDeptSummary();

    setStatus('Calculating distribution...', '');
    const estimate = await estimateAction(action);

    const bnb = (typeof estimate.sendBnb === 'number')
      ? estimate.sendBnb
      : (typeof estimate.totalBnb === 'number')
        ? estimate.totalBnb
        : toFloat(estimate.sendValue ?? 0);

    updateAmountDisplay(bnb);

    // BUG-4 FIX: "SIGN IN WALLET..." justo antes de runAction,
    // con tick de repintado para que MetaMask aparezca después.
    setConnectBtn('loading', 'SIGN IN WALLET...');
    setStatus(`Sign the transaction in your wallet to distribute ${bnb.toFixed(4)} BNB...`, 'warn');
    await new Promise(r => setTimeout(r, 50));

    // BUG-TX-TIMING FIX: callback onSubmit muestra el hash
    // inmediatamente tras el submit, antes de la confirmación.
    const onSubmit = (txHash) => {
      showTxResult(txHash);
      setConnectBtn('loading', 'CONFIRMING...');
      setStatus('Transaction submitted. Waiting for block confirmation...', '');
    };

    const { tx, receipt, sendValue } = await runAction(action, estimate.sendValue, onSubmit);

    const sentBnb = toFloat(sendValue).toFixed(4);
    setConnectBtn('success', 'COMPLETED ✓');
    setStatus(`${sentBnb} BNB distributed · block #${receipt.blockNumber}`, 'ok');
    setWallet(shortAddr(getSession().account) + ' · OK', 'ok');

    // Actualizar saldo tras la distribución
    _updateWalletBalance(getSession().account);

  } catch (e) {
    if (_isUserRejection(e)) {
      setStatus('Transaction rejected. Click RETRY to try again.', 'warn');
      setConnectBtn('idle', 'RETRY');
      _assignRetryHandler();
      return;
    }
    _handleError(e);
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
      el.innerHTML = '<span style="color:var(--brand-danger,#e05252)">No active departments configured</span>';
      return;
    }

    el.innerHTML = active.map(d => {
      const pay = formatDepartmentPayment(d);
      return `<div class="dept-row">
        <span>${d.name} <span style="color:var(--text-lo,#404b61)">×${d.employeeCount}</span></span>
        <span class="dept-amount">${pay}</span>
      </div>`;
    }).join('');
  } catch {
    el.textContent = '—';
  }
}

// ============================================================
//  _handleError()
// ============================================================
function _handleError(err) {
  const isNetwork    = err.name === 'NetworkError';
  const isBalance    = err.name === 'BalanceError';
  const isNoEmployee = err.name === 'NoEmployeesError';
  const msg          = err.reason ?? err.message ?? 'Unknown error.';

  if (isNetwork) {
    showNetWarn(true);
    setConnectBtn('idle', 'CONNECT WALLET');
    setStatus(msg, 'warn');
    _setBtn(_handleConnect);
    return;
  }

  if (isNoEmployee) {
    setConnectBtn('disabled', 'NO EMPLOYEES');
    setStatus(msg, 'warn');
    // Auto-reset para que el operador pueda reintentar cuando el admin configure el contrato
    setTimeout(() => {
      setConnectBtn('idle', 'RETRY');
      _assignRetryHandler();
    }, 8000);
    return;
  }

  if (isBalance) {
    setConnectBtn('disabled', 'INSUFFICIENT BALANCE');
    setStatus(msg + ' Add funds and retry.', 'warn');
    setTimeout(() => {
      setConnectBtn('idle', 'RETRY');
      _assignRetryHandler();
    }, 6000);
    return;
  }

  setConnectBtn('error', 'ERROR');
  setStatus(msg, 'err');
  setTimeout(() => {
    setConnectBtn('idle', 'RETRY');
    _assignRetryHandler();
  }, 3000);
}

// ============================================================
//  _showNoProvider()
// ============================================================
function _showNoProvider() {
  const overlay = document.getElementById('noProviderOverlay');
  if (overlay) overlay.style.display = 'flex';
  setConnectBtn('disabled', 'NO WEB3');
  setStatus('No Web3 provider detected. Install MetaMask or a compatible wallet.', 'err');
}

// ============================================================
//  _setBtn()
// ============================================================
function _setBtn(handler) {
  const btn = document.getElementById('connectBtn');
  if (btn) btn.onclick = handler;
}
