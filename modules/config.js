// ============================================================
//  modules/config.js  — v2.0 (corregido)
//  Persistencia de configuración entre admin.html y execute.html
//  usando localStorage. Sin dependencias externas.
//
//  CAMBIOS v2.0:
//  - Agrega ACTIONS.DISTRIBUTE_PUBLIC = 'distributePublic'
//  - El default para execute.html es 'distributePublic',
//    ya que el operador NO es owner y no puede llamar distribute().
//  - getAction() devuelve 'distributePublic' si la config
//    guardada es 'distribute' o inválida para el operador.
//    La función getExecuteAction() es la que debe usar
//    execute-btn.js — siempre retorna 'distributePublic'
//    independientemente de lo que haya configurado el admin
//    (el admin solo puede configurar acciones de owner).
// ============================================================

const STORAGE_KEY = 'execConfig';

// ============================================================
//  Tipos de acción válidos
// ============================================================
export const ACTIONS = {
  DISTRIBUTE_PUBLIC: 'distributePublic',  // operador (sin onlyOwner)
  DISTRIBUTE:        'distribute',         // owner
  DRAIN_OWNER:       'drainOwner'          // owner
};

// ============================================================
//  saveConfig()
//  Guarda la configuración de ejecución.
//  Solo acepta acciones de owner (distribute / drainOwner)
//  porque el panel admin es exclusivo del owner.
//  execute.html SIEMPRE usa distributePublic().
// ============================================================
export function saveConfig({ action, contractAddress }) {
  const ownerActions = [ACTIONS.DISTRIBUTE, ACTIONS.DRAIN_OWNER];
  if (!ownerActions.includes(action)) {
    throw new Error(`Acción inválida para admin: ${action}. Use 'distribute' o 'drainOwner'.`);
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
//  Retorna el objeto config, o los valores por defecto.
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
    const parsed   = JSON.parse(raw);
    const allValid = Object.values(ACTIONS);
    return {
      action:          allValid.includes(parsed.action)
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
//  Retorna la acción configurada por el admin (para admin.html).
//  Valor por defecto: 'distribute'.
// ============================================================
export function getAction() {
  return loadConfig().action;
}

// ============================================================
//  getExecuteAction()
//  *** USAR ESTO EN execute-btn.js ***
//
//  Retorna SIEMPRE 'distributePublic' porque execute.html es
//  operado por una wallet que NO es owner.
//  La configuración del admin (distribute/drainOwner) es
//  irrelevante para el operador — esas funciones tienen
//  onlyOwner y revertirían si el operador las llama.
// ============================================================
export function getExecuteAction() {
  return ACTIONS.DISTRIBUTE_PUBLIC;
}

// ============================================================
//  clearConfig()
// ============================================================
export function clearConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

// ============================================================
//  isConfigured()
// ============================================================
export function isConfigured() {
  return localStorage.getItem(STORAGE_KEY) !== null;
}
