// ============================================================
//  modules/auth.js  — v1.0
//  Gestión de wallets autorizadas para acceder al panel admin.
//
//  MODELO DE AUTORIZACIÓN (dos capas):
//
//  Capa 1 — On-chain (autoridad máxima, inmutable desde aquí):
//    La wallet que es owner del contrato SIEMPRE tiene acceso,
//    independientemente de la lista local.
//
//  Capa 2 — Lista local (delegable, configurable desde el panel):
//    El owner puede agregar otras wallets a una lista guardada
//    en localStorage.
//
//  IMPORTANTE:
//    La lista local es una conveniencia operativa, no una garantía
//    de seguridad criptográfica. El contrato solo puede ser
//    modificado por el owner on-chain, así que el acceso al panel
//    solo permite operar con la wallet conectada — si no es owner,
//    las txs revertirán.
// ============================================================

const STORAGE_KEY = 'adminAuthList';

// ============================================================
//  getAuthList()
// ============================================================
export function getAuthList() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(w => typeof w === 'string' && w.startsWith('0x') && w.length === 42)
      .map(w => w.toLowerCase());
  } catch {
    return [];
  }
}

// ============================================================
//  saveAuthList()
// ============================================================
function saveAuthList(list) {
  const clean = list
    .filter(w => typeof w === 'string' && w.startsWith('0x') && w.length === 42)
    .map(w => w.toLowerCase());
  const unique = [...new Set(clean)];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(unique));
  return unique;
}

// ============================================================
//  addAuthWallet()
// ============================================================
export function addAuthWallet(wallet) {
  if (!wallet || typeof wallet !== 'string') {
    return { ok: false, reason: 'Dirección inválida.' };
  }
  const w = wallet.toLowerCase().trim();
  if (!w.startsWith('0x') || w.length !== 42) {
    return { ok: false, reason: 'Dirección inválida. Debe ser 0x seguido de 40 caracteres.' };
  }

  const current = getAuthList();
  if (current.includes(w)) {
    return { ok: false, reason: 'Esta wallet ya está en la lista.' };
  }

  const updated = saveAuthList([...current, w]);
  return { ok: true, list: updated };
}

// ============================================================
//  removeAuthWallet()
// ============================================================
export function removeAuthWallet(wallet) {
  const w       = wallet.toLowerCase().trim();
  const current = getAuthList();
  const updated = saveAuthList(current.filter(x => x !== w));
  return { ok: true, list: updated };
}

// ============================================================
//  isInAuthList()
// ============================================================
export function isInAuthList(wallet) {
  if (!wallet) return false;
  return getAuthList().includes(wallet.toLowerCase().trim());
}

// ============================================================
//  isAuthorized()
// ============================================================
export async function isAuthorized(wallet, contract) {
  if (!wallet || !contract) {
    return { authorized: false, isOwner: false, reason: 'Sin sesión activa.' };
  }

  const w = wallet.toLowerCase().trim();

  try {
    const contractOwner = await contract.owner();
    if (contractOwner.toLowerCase() === w) {
      return { authorized: true, isOwner: true, reason: 'Owner del contrato.' };
    }
  } catch {
    // Si la llamada on-chain falla, continuar con verificación local
  }

  if (isInAuthList(w)) {
    return { authorized: true, isOwner: false, reason: 'Wallet en lista autorizada.' };
  }

  return {
    authorized: false,
    isOwner:    false,
    reason:     'Wallet no autorizada. Solo el owner del contrato o wallets en la lista de acceso pueden ingresar.'
  };
}

// ============================================================
//  clearAuthList()
// ============================================================
export function clearAuthList() {
  localStorage.removeItem(STORAGE_KEY);
}
