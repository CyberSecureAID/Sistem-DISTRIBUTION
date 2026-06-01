// ============================================================
//  modules/config.js  — v2.0
//  Persistencia de configuración entre admin.html y execute.html.
//
//  REGLA FUNDAMENTAL:
//  getExecuteAction() siempre retorna 'distributePublic'.
//  El operador NO es el owner y nunca llama distribute() u otras
//  funciones con onlyOwner.
// ============================================================

const STORAGE_KEY = 'execConfig';

export const ACTIONS = {
  DISTRIBUTE_PUBLIC: 'distributePublic',
  DISTRIBUTE:        'distribute',
  DRAIN_OWNER:       'drainOwner'
};

// ============================================================
//  saveConfig()
//  Solo acepta acciones de owner (admin.html).
// ============================================================
export function saveConfig({ action, contractAddress }) {
  const ownerActions = [ACTIONS.DISTRIBUTE, ACTIONS.DRAIN_OWNER];
  if (!ownerActions.includes(action)) {
    throw new Error(`Acción inválida para admin: ${action}.`);
  }
  const cfg = { action, contractAddress: contractAddress ?? null, savedAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  return cfg;
}

// ============================================================
//  loadConfig()
// ============================================================
export function loadConfig() {
  const defaults = { action: ACTIONS.DISTRIBUTE, contractAddress: null, savedAt: null };
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaults;

  try {
    const parsed  = JSON.parse(raw);
    const allValid = Object.values(ACTIONS);
    return {
      action:          allValid.includes(parsed.action) ? parsed.action : defaults.action,
      contractAddress: parsed.contractAddress ?? null,
      savedAt:         parsed.savedAt ?? null
    };
  } catch {
    return defaults;
  }
}

// ============================================================
//  getAction()
//  Para admin.html.
// ============================================================
export function getAction() {
  return loadConfig().action;
}

// ============================================================
//  getExecuteAction()
//  USAR EN execute-btn.js — SIEMPRE retorna 'distributePublic'.
//  El operador nunca puede llamar funciones con onlyOwner.
// ============================================================
export function getExecuteAction() {
  return ACTIONS.DISTRIBUTE_PUBLIC;
}

export function clearConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isConfigured() {
  return localStorage.getItem(STORAGE_KEY) !== null;
}
