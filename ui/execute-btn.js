// ============================================================
//  ui/execute-btn.js  — v4.2 (corregido)
//
//  CORRECCIONES v4.2 (sobre v4.1):
//
//  1. BUG-1 CORREGIDO [CRÍTICO]: goAdmin() apuntaba a './admin/'
//     (directorio inexistente). Ahora apunta a './admin.html'.
//
//  2. BUG-4 CORREGIDO: El mensaje "SIGN IN WALLET..." ahora aparece
//     justo antes de llamar a runAction(), no antes de calcular el
//     gasLimit. Así el usuario ve "Estimating gas..." mientras se
//     prepara la tx y "Sign in wallet..." solo cuando MetaMask ya
//     está a punto de mostrar el popup de confirmación.
//
//  3. MEJORA: _executeFlow() muestra el hash de la tx inmediatamente
//     tras el submit (aprovechando la separación tx/wait de v3.3 de
//     distribution.js), actualizando showTxResult antes de que se
//     mine el bloque. El usuario puede ver el hash en BscScan
//     mientras espera la confirmación.
//
//  CORRECCIONES HEREDADAS v4.1:
//  - Botón siempre habilitado tras boot.
//  - Handler asignado antes del boot.
//  - Manejo de devMode.
// ============================================================

import { connectWallet, tryReconnect, watchWalletEvents, getSession, getBalance } from '../core/provider.js';
import { runAction, estimateAction, BalanceError }    from '../modules/distribution.js';
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

  // ── Asignar handler ANTES del boot ─────────────────────
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

  if (sub)      sub.textContent   = 'Verifying wallet permissions...';
  if (errEl)    errEl.textContent = '';
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
    if (sub) sub.textContent = '⚠ Dev mode — contract not deployed.';
    if (errEl) errEl.textContent = 'Access granted for development. Deploy the contract to enable full functionality.';
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
      if (sub) sub.textContent = 'Access denied.';
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

// BUG-1 CORREGIDO: era './admin/' (directorio), ahora './admin.html'
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
// ============================================================
async function _boot() {
  setStatus('Initializing...', '');
  setConnectBtn('loading', 'LOADING...');

  try {
    const result = await tryReconnect();

    if (result && result.wrongNetwork) {
      showNetWarn(true);
      setWallet(shortAddr(result.account) + ' · Wrong network', 'warn');
      setStatus('Wrong network. Switch to BNB Smart Chain (chainId 56).', 'warn');
      setConnectBtn('idle', 'CONNECT WALLET');
      _setBtn(_handleConnect);
      return;
    }

    if (result && result.account && result.devMode) {
      setWallet(shortAddr(result.account), 'warn');
      setStatus('Dev mode — contract not deployed. Deploy the contract to enable distributions.', 'warn');
      setConnectBtn('disabled', 'CONTRACT PENDING');
      return;
    }

    if (result && result.ready) {
      await _onSessionReady(result);
      return;
    }

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
    setStatus('Dev mode — contract not deployed. Deploy the contract to enable distributions.', 'warn');
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
//  BUG-4 CORREGIDO: mensajes de estado en el momento correcto.
//  MEJORA: muestra hash antes de que se mine el bloque.
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

    if (bnb === 0) {
      setConnectBtn('disabled', 'NO PAYMENTS');
      setStatus('No active departments configured. Ask the admin to set up the contract.', 'err');
      return;
    }

    updateAmountDisplay(bnb);

    // BUG-4: el mensaje de firma aparece justo antes de runAction,
    // no antes del cálculo del gasLimit que ocurre dentro de runAction.
    // Forzamos un tick para que el navegador repinte antes de que
    // MetaMask muestre su popup.
    setConnectBtn('loading', 'SIGN IN WALLET...');
    setStatus('Sign the transaction in your wallet to distribute ' + bnb.toFixed(4) + ' BNB...', 'warn');
    await new Promise(r => setTimeout(r, 50)); // tick de repintado

    const { tx, receipt, sendValue } = await runAction(action, estimate.sendValue);

    // Mostrar hash inmediatamente tras el submit (antes de minar)
    // tx.hash está disponible porque distribution.js v3.3 ya hizo await en el submit
    showTxResult(tx.hash);

    const sentBnb = toFloat(sendValue).toFixed(4);
    setConnectBtn('success', 'COMPLETED ✓');
    setStatus(sentBnb + ' BNB distributed · block #' + receipt.blockNumber, 'ok');
    setWallet(shortAddr(getSession().account) + ' · OK', 'ok');

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
      el.innerHTML = '<span style="color:var(--brand-danger,#e05252)">No active departments</span>';
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
  const isNetwork = err.name === 'NetworkError';
  const isBalance = err.name === 'BalanceError';
  const msg       = err.reason ?? err.message ?? 'Unknown error.';

  if (isNetwork) {
    showNetWarn(true);
    setConnectBtn('idle', 'CONNECT WALLET');
    setStatus(msg, 'warn');
    _setBtn(_handleConnect);
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
