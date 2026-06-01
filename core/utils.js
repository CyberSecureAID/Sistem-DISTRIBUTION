// ============================================================
//  core/utils.js
//  Helpers puros reutilizables en admin.html, execute.html
//  y cualquier módulo futuro. Sin dependencias externas salvo ethers.
// ============================================================

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
 * @param {ethers.BigNumber} wei
 * @param {number} decimals  — por defecto 4
 */
export function fEth(wei, decimals = 4) {
  return parseFloat(ethers.utils.formatEther(wei)).toFixed(decimals);
}

/**
 * Convierte un BigNumber (wei) a número flotante BNB.
 * Útil para comparaciones aritméticas.
 */
export function toFloat(wei) {
  return parseFloat(ethers.utils.formatEther(wei));
}

/**
 * Convierte string BNB a BigNumber wei.
 * Wrapper de parseEther con fallback a '0'.
 */
export function toBN(bnbString) {
  try {
    return ethers.utils.parseEther(String(bnbString || '0'));
  } catch {
    return ethers.BigNumber.from(0);
  }
}

// ============================================================
//  LOG — escritura en el elemento #log del DOM
//  Uso: addLog(el, 'mensaje', 'ok' | 'err' | 'warn' | '')
// ============================================================

/**
 * Añade una línea al elemento log pasado como referencia.
 * @param {HTMLElement} logEl  — el elemento #log
 * @param {string}      msg
 * @param {'ok'|'err'|'warn'|''} type
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

/** Promesa que espera `ms` milisegundos. */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
//  VALIDACIÓN
// ============================================================

/** Retorna true si `addr` es una dirección Ethereum válida. */
export function isValidAddress(addr) {
  try { return ethers.utils.isAddress(addr); }
  catch { return false; }
}

/**
 * Parsea un textarea de direcciones (una por línea).
 * Retorna solo las que son válidas; descarta duplicados.
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

/** URL de una transacción en BscScan mainnet. */
export function bscscanTx(hash) {
  return `https://bscscan.com/tx/${hash}`;
}

/** URL de una dirección en BscScan mainnet. */
export function bscscanAddr(address) {
  return `https://bscscan.com/address/${address}`;
}
