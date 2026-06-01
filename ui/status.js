// ============================================================
//  ui/status.js  — v1.1
//  Primitivas de UI para feedback de estado.
//  Usadas tanto por admin.html como por execute.html.
//  Sin dependencias de negocio — solo DOM.
//
//  IMPORTANTE — FIRMA DE addLog():
//    Esta función usa firma (msg, type, logEl) — msg PRIMERO.
//    La función addLog en core/utils.js usa (logEl, msg, type) — logEl PRIMERO.
//    Son distintas. Importar siempre desde el módulo correcto.
// ============================================================

// ============================================================
//  setStatus()
// ============================================================
export function setStatus(msg, type = '', el = null) {
  const target = el ?? document.getElementById('statusLine');
  if (!target) return;
  target.textContent = msg;
  target.className   = _typeClass(type);
}

// ============================================================
//  setWallet()
//  Compatible con ambas páginas:
//  admin.html: #walletLabel + #dot
//  execute.html: #wLabel + #wDot
// ============================================================
export function setWallet(label, type = '') {
  const labelA = document.getElementById('walletLabel');
  const dotA   = document.getElementById('dot');
  const labelE = document.getElementById('wLabel');
  const dotE   = document.getElementById('wDot');

  if (labelA) labelA.textContent = label;
  if (labelE) labelE.textContent = label;

  _applyDotClass(dotA, type, 'dot');
  _applyDotClass(dotE, type, 'wallet-dot');
}

// ============================================================
//  addLog()
//  FIRMA: addLog(msg, type, logEl)
//  Nota: core/utils.js tiene firma invertida addLog(logEl, msg, type)
// ============================================================
export function addLog(msg, type = '', logEl = null) {
  const el = logEl ?? document.getElementById('log');
  if (!el) return;

  const cls = type === 'ok'   ? 'log-ok'
            : type === 'err'  ? 'log-err'
            : type === 'warn' ? 'log-warn'
            : '';

  const t = new Date().toLocaleTimeString('es', { hour12: false });
  el.innerHTML += `<div class="${cls}">[${t}] ${msg}</div>`;
  el.scrollTop  = el.scrollHeight;
}

// ============================================================
//  setConnectBtn()
// ============================================================
export function setConnectBtn(state, label = null) {
  const btn = document.getElementById('connectBtn');
  if (!btn) return;

  btn.classList.remove('loading', 'success', 'error');
  btn.disabled = false;

  switch (state) {
    case 'loading':
      btn.classList.add('loading');
      btn.disabled = true;
      btn.textContent = label ?? '···';
      break;
    case 'success':
      btn.classList.add('success');
      btn.disabled = true;
      btn.textContent = label ?? 'DONE ✓';
      break;
    case 'error':
      btn.classList.add('error');
      btn.disabled = false;
      btn.textContent = label ?? 'ERROR';
      break;
    case 'disabled':
      btn.disabled = true;
      if (label) btn.textContent = label;
      break;
    case 'idle':
    default:
      btn.textContent = label ?? 'CONNECT WALLET';
      break;
  }
}

// ============================================================
//  showTxResult()
//  Muestra el hash y link a BscScan. Se llama en cuanto
//  el hash está disponible (post-submit, pre-confirmación).
// ============================================================
export function showTxResult(txHash) {
  const wrap = document.getElementById('txResult');
  const hash = document.getElementById('txHash');
  const link = document.getElementById('txLink');
  if (!wrap) return;

  wrap.style.display = 'block';
  if (hash) hash.textContent = txHash.slice(0, 10) + '…';
  if (link) {
    link.href = `https://bscscan.com/tx/${txHash}`;
    link.textContent = 'Ver en BscScan →';
  }
}

// ============================================================
//  showNetWarn()
// ============================================================
export function showNetWarn(visible) {
  const el = document.getElementById('netWarn');
  if (el) el.style.display = visible ? 'block' : 'none';
}

// ============================================================
//  showContractBnbAlert()
// ============================================================
export function showContractBnbAlert(bnbAmount) {
  const alert = document.getElementById('contractBnbAlert');
  const span  = document.getElementById('alertBnbAmount');
  const btn   = document.getElementById('btnRescue');

  if (!alert) return;

  if (bnbAmount && bnbAmount > 0) {
    alert.style.display = 'block';
    if (span) span.textContent = bnbAmount.toFixed(6);
    if (btn)  btn.disabled = false;
  } else {
    alert.style.display = 'none';
    if (btn)  btn.disabled = true;
  }
}

// ============================================================
//  updateAmountDisplay()
// ============================================================
export function updateAmountDisplay(bnb) {
  const el = document.getElementById('amountVal');
  if (!el) return;
  el.textContent = typeof bnb === 'number' ? bnb.toFixed(4) : bnb;
}

// ============================================================
//  updateProgressBar()
// ============================================================
export function updateProgressBar(ownerBnb, neededBnb) {
  const wrap = document.getElementById('progressWrap');
  const bar  = document.getElementById('progressBar');
  if (!wrap || !bar || neededBnb <= 0) return;

  wrap.style.display = 'block';
  const pct = Math.min((ownerBnb / neededBnb) * 100, 100);
  bar.style.width      = pct + '%';
  bar.style.background = pct >= 100 ? 'var(--accent2)' : 'var(--danger)';
}

// ============================================================
//  PRIVADOS
// ============================================================
function _typeClass(type) {
  return type === 'ok'   ? 'ok'
       : type === 'err'  ? 'err'
       : type === 'warn' ? 'warn'
       : '';
}

function _applyDotClass(el, type, base) {
  if (!el) return;
  el.className = base
    + (type === 'ok'   ? ' ok'
     : type === 'warn' ? ' warn'
     : '');
}
