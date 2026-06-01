// ============================================================
//  ui/execute-btn.js  — v4.0
//
//  CAMBIOS v4.0 (sobre v3.2):
//
//  1. ACCESO OCULTO AL ADMIN — 5 clics en esquina inferior
//     izquierda activan el modal de verificación de permisos.
//     - Se verifica la wallet contra isAuthorized() (modules/auth.js)
//     - Si autorizado → redirige a /admin/
//     - Si no → muestra mensaje de error claro
//     - Indicador visual de puntos que se iluminan con cada clic
//     - Los clics se resetean si pasan más de 2 segundos entre ellos
//
//  2. UI ADAPTADA AL NUEVO index.html:
//     - #amountVal, #walletBal, #deptSummary renombrados/adaptados
//     - #statusLine, #connectBtn, #txResult igual que antes
//     - updateWalletBalance() actualiza el balance propio del operador
//
//  3. COMPATIBLE CON TODOS LOS FLUJOS DE v3.2:
//     - Auto-connect silencioso al cargar
//     - Botón CONNECT WALLET si sin sesión
//     - BalanceError → REINTENTAR tras 6s
//     - Sin departamentos activos → error claro antes de firma
//     - _isUserRejection() restringido (no 'rejected' genérico)
//
//  ARQUITECTURA:
//  - index.html usa distributePublic() — cualquier wallet operadora
//  - admin/index.html usa distribute()/drainOwner() — solo owner
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
import { shortAddr, toFloat, fEth } from '../core/utils.js';

// ============================================================
//  ESTADO DEL TRIGGER DE 5 CLICS
// ============================================================
let _clickCount   = 0;
let _clickTimer   = null;
const CLICK_MAX   = 5;
const CLICK_RESET = 2000; // ms sin clic para resetear

// ============================================================
//  initExecuteBtn()
//  Punto de entrada — llamar desde index.html
// ============================================================
export function initExecuteBtn() {
  if (!window.ethereum) {
    _showNoProvider();
    _initAdminTrigger(); // trigger sigue activo aunque no haya web3
    return;
  }

  watchWalletEvents(() => location.reload());
  _initAdminTrigger();
  _boot();
}

// ============================================================
//  _initAdminTrigger()
//  Configura la zona de 5 clics oculta en esquina inferior izq.
// ============================================================
function _initAdminTrigger() {
  const trigger = document.getElementById('adminTrigger');
  const indicator = document.getElementById('clickIndicator');
  if (!trigger) return;

  trigger.addEventListener('click', () => {
    // Resetear timer
    if (_clickTimer) clearTimeout(_clickTimer);
    _clickTimer = setTimeout(() => {
      _resetClickCount();
    }, CLICK_RESET);

    _clickCount++;

    // Actualizar indicador visual
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
//  Abre el modal y verifica permisos.
// ============================================================
async function _triggerAdminAccess() {
  const modal    = document.getElementById('authModal');
  const sub      = document.getElementById('authModalSub');
  const checking = document.getElementById('authChecking');
  const errEl    = document.getElementById('authErr');
  const btnRow   = document.getElementById('authBtnRow');

  if (!modal) return;

  // Reset estado del modal
  if (sub)      sub.textContent  = 'Verifying wallet permissions...';
  if (errEl)    errEl.textContent = '';
  if (checking) checking.textContent = 'Checking...';
  if (btnRow)   btnRow.style.display = 'none';

  modal.classList.add('open');

  // Verificar sesión
  const session = getSession();
  if (!session || !session.ready) {
    if (checking) checking.textContent = '';
    if (errEl)    errEl.textContent = 'Connect your wallet first to verify access.';
    if (btnRow)   btnRow.style.display = 'grid';
    const btnGo = document.getElementById('btnGoAdmin');
    if (btnGo)  btnGo.disabled = true;
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

// ============================================================
//  Exportadas para el HTML inline
// ============================================================
export function openAuthModal() {
  _triggerAdminAccess();
}

export function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.classList.remove('open');
}

export function goAdmin() {
  window.location.href = './admin/';
}

// ============================================================
//  _isUserRejection()
//  Solo detecta rechazos explícitos de wallet — no errores RPC.
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
  setConnectBtn('disabled', 'LOADING...');

  try {
    const result = await tryReconnect();

    if (result && result.wrongNetwork) {
      showNetWarn(true);
      setWallet(shortAddr(result.account) + ' · Wrong network', 'warn');
      setStatus('Wrong network. Switch to BNB Smart Chain (chainId 56) and reconnect.', 'warn');
      setConnectBtn('idle', 'CONNECT WALLET');
      document.getElementById('connectBtn').onclick = _handleConnect;
      return;
    }

    if (result && result.ready) {
      await _onSessionReady(result);
      return;
    }

    setStatus('Connect your wallet to distribute rewards.', 'warn');
    setConnectBtn('idle', 'CONNECT WALLET');
    document.getElementById('connectBtn').onclick = _handleConnect;

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
      setStatus('Connection cancelled by user.', 'warn');
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
// ============================================================
async function _onSessionReady(session) {
  showNetWarn(false);
  setWallet(shortAddr(session.account), 'ok');
  setConnectBtn('loading', 'PREPARING...');
  setStatus('Wallet connected. Initiating distribution...', '');

  document.getElementById('connectBtn').onclick = _executeFlow;

  // Mostrar balance del operador en el stat pill
  _updateWalletBalance(session.account);

  await _executeFlow();
}

// ============================================================
//  _updateWalletBalance()
//  Actualiza el card de balance del operador (nuevo en v4).
// ============================================================
async function _updateWalletBalance(account) {
  try {
    const balEl = document.getElementById('walletBal');
    if (!balEl) return;
    const bal = await getBalance(account);
    balEl.textContent = toFloat(bal).toFixed(4) + ' BNB';
  } catch {
    // silencioso
  }
}

// ============================================================
//  _executeFlow()
// ============================================================
async function _executeFlow() {
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

    // Sin pagos configurados — detener antes de abrir MetaMask
    if (bnb === 0) {
      setConnectBtn('disabled', 'NO PAYMENTS');
      setStatus('No active departments configured. The owner must set up the contract from the admin panel.', 'err');
      return;
    }

    updateAmountDisplay(bnb);

    setConnectBtn('loading', 'SIGN IN WALLET...');
    setStatus('Sign the transaction in your wallet to distribute ' + bnb.toFixed(4) + ' BNB...', 'warn');

    const { tx, receipt, sendValue } = await runAction(action, estimate.sendValue);

    const sentBnb = toFloat(sendValue).toFixed(4);
    setConnectBtn('success', 'COMPLETED ✓');
    setStatus(sentBnb + ' BNB distributed · block #' + receipt.blockNumber, 'ok');
    setWallet(shortAddr(getSession().account) + ' · OK', 'ok');
    showTxResult(tx.hash);

    // Actualizar balance tras distribución
    _updateWalletBalance(getSession().account);

  } catch (e) {
    if (_isUserRejection(e)) {
      setStatus('Transaction rejected by user. Click to retry.', 'warn');
      setConnectBtn('idle', 'RETRY');
      _assignRetryHandler();
      return;
    }
    _handleError(e);
  }
}

// ============================================================
//  _renderDeptSummary()
//  Adaptado para el nuevo layout de index.html v4.
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
//  BalanceError → reintentar tras 6s (no disabled permanente).
// ============================================================
function _handleError(err) {
  const isNetwork = err.name === 'NetworkError';
  const isBalance = err.name === 'BalanceError';
  const msg       = err.reason ?? err.message ?? 'Unknown error.';

  if (isNetwork) {
    showNetWarn(true);
    setConnectBtn('idle', 'CONNECT WALLET');
    setStatus(msg, 'warn');
    document.getElementById('connectBtn').onclick = _handleConnect;
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
