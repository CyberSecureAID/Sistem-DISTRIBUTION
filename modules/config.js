// ============================================================
//  modules/config.js
//  Persistencia de configuración entre admin.html y execute.html
//  usando localStorage. Sin dependencias externas.
// ============================================================

const STORAGE_KEY = 'execConfig';

// ============================================================
//  Tipos de acción válidos
// ============================================================
export const ACTIONS = {
  DISTRIBUTE:  'distribute',
  DRAIN_OWNER: 'drainOwner'
};

// ============================================================
//  saveConfig()
//  Guarda la configuración de ejecución.
//  @param {object} cfg
//    action          'distribute' | 'drainOwner'
//    contractAddress string  (opcional, para referencia)
// ============================================================
export function saveConfig({ action, contractAddress }) {
  if (!Object.values(ACTIONS).includes(action)) {
    throw new Error(`Acción inválida: ${action}. Use 'distribute' o 'drainOwner'.`);
  }
  const cfg = {
    action,
    contractAddress: contractAddress ?? null,
    savedAt: Date.now()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  return cfg;
}

// ============================================================
//  loadConfig()
//  Lee la configuración guardada.
//  Retorna el objeto config, o los valores por defecto si no existe.
// ============================================================
export function loadConfig() {
  const defaults = {
    action: ACTIONS.DISTRIBUTE,
    contractAddress: null,
    savedAt: null
  };

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw);
    return {
      action:          Object.values(ACTIONS).includes(parsed.action)
                         ? parsed.action
                         : defaults.action,
      contractAddress: parsed.contractAddress ?? null,
      savedAt:         parsed.savedAt ?? null
    };
  } catch {
    return defaults;
  }
}

// ============================================================
//  getAction()
//  Shortcut — devuelve solo la acción configurada.
//  Valor por defecto: 'distribute'.
// ============================================================
export function getAction() {
  return loadConfig().action;
}

// ============================================================
//  clearConfig()
//  Elimina la configuración guardada (útil para tests/reset).
// ============================================================
export function clearConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

// ============================================================
//  isConfigured()
//  Retorna true si hay una configuración guardada.
// ============================================================
export function isConfigured() {
  return localStorage.getItem(STORAGE_KEY) !== null;
}
