// ============================================================
//  core/utils.js  — v1.1
//  Helpers puros reutilizables en admin.html, execute.html
//  y cualquier módulo futuro.
//
//  CAMBIOS v1.1:
//  - Acceso a ethers via función defensiva _ethers() para
//    compatibilidad total con módulos ES en GitHub Pages y
//    cualquier entorno de hosting estático.
// ============================================================

/* global ethers */

// Acceso seguro a ethers
function _ethers() {
  const e = (typeof window !== 'undefined' && window.ethers) || (typeof ethers !== 'undefined' && ethers);
  if (!e) throw new Error('ethers.js no está cargado.');
  return e;
}

// ============================================================
//  FORMATO DE DIRECCIONES Y HASHES
// ============================================================

/** 0x1234…abcd  (primeros 6 + últimos 4 caracteres) */
export function shortAddr(address) {
  if (!address || address.length < 10) return address;
  return address.slice(0, 6) + '…' + address.slice(-4);
}

/** 0x1a2b3c4d5e…  (primeros 10 caracteres) */
export function shortHash(hash) {
  if (!hash || hash.length < 10) return hash;
  return hash.slice(0, 10) + '…';
}

// ============================================================
//  FORMATO DE WEI → BNB
// ============================================================

/**
 * Convierte un BigNumber (wei) a string BNB con `decimals` cifras.
 */
export function fEth(wei, decimals = 4) {
  return parseFloat(_ethers().utils.formatEther(wei)).toFixed(decimals);
}

/**
 * Convierte un BigNumber (wei) a número flotante BNB.
 */
export function toFloat(wei) {
  return parseFloat(_ethers().utils.formatEther(wei));
}

/**
 * Convierte string BNB a BigNumber wei.
 */
export function toBN(bnbString) {
  try {
    return _ethers().utils.parseEther(String(bnbString || '0'));
  } catch {
    return _ethers().BigNumber.from(0);
  }
}

// ============================================================
//  LOG
// ============================================================

/**
 * Añade una línea al elemento log pasado como referencia.
 * FIRMA: addLog(logEl, msg, type)
 * (Nota: ui/status.js tiene firma invertida addLog(msg, type, logEl))
 */
export function addLog(logEl, msg, type = '') {
  if (!logEl) return;
  const cls = type === 'ok'
    ? 'log-ok'
    : type === 'err'
    ? 'log-err'
    : type === 'warn'
    ? 'log-warn'
    : '';
  const t = new Date().toLocaleTimeString('es', { hour12: false });
  logEl.innerHTML += `<div class="${cls}">[${t}] ${msg}</div>`;
  logEl.scrollTop  = logEl.scrollHeight;
}

// ============================================================
//  TIEMPO
// ============================================================

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
//  VALIDACIÓN
// ============================================================

export function isValidAddress(addr) {
  try { return _ethers().utils.isAddress(addr); }
  catch { return false; }
}

/**
 * Parsea un textarea de direcciones (una por línea).
 */
export function parseAddressList(raw) {
  const seen = new Set();
  return raw
    .split('\n')
    .map(a => a.trim())
    .filter(a => {
      if (!isValidAddress(a) || seen.has(a.toLowerCase())) return false;
      seen.add(a.toLowerCase());
      return true;
    });
}

// ============================================================
//  BSCSCAN
// ============================================================

export function bscscanTx(hash) {
  return `https://bscscan.com/tx/${hash}`;
}

export function bscscanAddr(address) {
  return `https://bscscan.com/address/${address}`;
}
