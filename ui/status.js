// ============================================================
//  ui/status.js
//  Primitivas de UI para feedback de estado.
//  Usadas tanto por admin.html como por execute.html.
//  Sin dependencias de negocio — solo DOM.
// ============================================================

// ============================================================
//  setStatus()
//  Actualiza el elemento #statusLine con un mensaje tipado.
//
//  @param {string}                   msg
//  @param {'ok'|'err'|'warn'|''}     type
//  @param {HTMLElement|null}         el   — por defecto #statusLine
// ============================================================
export function setStatus(msg, type = '', el = null) {
  const target = el ?? document.getElementById('statusLine');
  if (!target) return;
  target.textContent = msg;
  target.className   = _typeClass(type);
}

// ============================================================
//  setWallet()
//  Actualiza el indicador de wallet en la topbar.
//  Compatible con ambas páginas: busca #walletLabel + #dot
//  (admin) o #wLabel + #wDot (execute).
//
//  @param {string}                   label
//  @param {'ok'|'warn'|'err'|''}     type
// ============================================================
export function setWallet(label, type = '') {
  // admin.html
  const labelA = document.getElementById('walletLabel');
  const dotA   = document.getElementById('dot');
  // execute.html
  const labelE = document.getElementById('wLabel');
  const dotE   = document.getElementById('wDot');

  if (labelA) labelA.textContent = label;
  if (labelE) labelE.textContent = label;

  _applyDotClass(dotA, type, 'dot');
  _applyDotClass(dotE, type, 'wallet-dot');
}

// ============================================================
//  addLog()
//  Appends una línea al elemento log del DOM.
//
//  FIRMA UNIFICADA: addLog(msg, type, logEl)
//  — msg    : texto a mostrar
//  — type   : 'ok' | 'err' | 'warn' | ''
//  — logEl  : HTMLElement opcional (default: #log)
//
//  NOTA: core/utils.js exporta su propia addLog(logEl, msg, type)
//  con firma distinta (legado). ui/admin.js debe importar ESTA
//  función desde ui/status.js, no desde core/utils.js.
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
//  Controla el estado visual del botón de conexión/ejecución
//  (#connectBtn en execute.html).
//
//  @param {'idle'|'loading'|'success'|'error'|'disabled'} state
//  @param {string} label   — texto del botón
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
//  Muestra el hash y link a BscScan tras una tx exitosa
//  en execute.html (#txResult, #txHash, #txLink).
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
//  Muestra/oculta el banner de red incorrecta (#netWarn).
// ============================================================
export function showNetWarn(visible) {
  const el = document.getElementById('netWarn');
  if (el) el.style.display = visible ? 'block' : 'none';
}

// ============================================================
//  showContractBnbAlert()
//  Muestra/oculta la alerta de BNB acumulado en el contrato.
//  @param {number|null} bnbAmount — null para ocultar
// ============================================================
export function showContractBnbAlert(bnbAmount) {
  const alert  = document.getElementById('contractBnbAlert');
  const span   = document.getElementById('alertBnbAmount');
  const btn    = document.getElementById('btnRescue');

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
//  Actualiza el display central de BNB en execute.html.
//  @param {number|string} bnb
// ============================================================
export function updateAmountDisplay(bnb) {
  const el = document.getElementById('amountVal');
  if (!el) return;
  el.textContent = typeof bnb === 'number' ? bnb.toFixed(4) : bnb;
}

// ============================================================
//  updateProgressBar()
//  Actualiza la barra de progreso de saldo vs. necesario.
//  @param {number} ownerBnb
//  @param {number} neededBnb
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
