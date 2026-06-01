// ============================================================
//  ui/execute-btn.js  — v3.1
//
//  CORRECCIONES v3.1 (sobre v3.0):
//
//  1. BUG-1 CORREGIDO: Detección de rechazo de firma ampliada.
//     MetaMask y otras wallets usan distintos mensajes:
//       - code 4001  (MetaMask estándar)
//       - "user rejected" (MetaMask moderno)
//       - "user denied"   (MetaMask legacy / WalletConnect)
//       - "rejected"      (Coinbase Wallet, Trust Wallet)
//       - "cancelled"     (algunas wallets móviles)
//     Antes solo se detectaban los dos primeros; ahora se
//     detectan todos. Sin esta corrección, el rechazo mostraba
//     el botón como "ERROR" en rojo en lugar de "REINTENTAR".
//
//  2. BUG-3 CORREGIDO: Parámetro isSessionActive eliminado de
//     _handleError(). No era usado internamente — era dead code
//     heredado de v2.2 donde sí se usaba. Eliminarlo evita
//     confusión y simplifica las llamadas.
//
//  3. BUG-4 CORREGIDO: Asignación redundante de onclick en
//     _boot() CASO 2. Se asignaba connectBtn.onclick = _executeFlow
//     y luego _onSessionReady() lo volvía a asignar. Eliminada
//     la primera asignación — _onSessionReady() es la fuente
//     única de verdad para ese handler.
//
//  FLUJO COMPLETO (sin cambios de arquitectura):
//    1. _boot()           -> tryReconnect() silencioso al cargar
//    2. Sesion ok         -> _onSessionReady() -> _executeFlow() AUTO
//    3. Red incorrecta    -> banner + boton CONNECT WALLET
//    4. Sin sesion        -> boton CONNECT WALLET habilitado
//    5. Click boton       -> _handleConnect() -> _onSessionReady() -> _executeFlow()
//
//  ARQUITECTURA DE ROLES:
//  - execute.html usa distributePublic() - cualquier wallet puede ejecutarlo.
//  - admin.html   usa distribute()/drainOwner() - solo el owner.
// ============================================================

import { connectWallet, tryReconnect, watchWalletEvents, getSession } from '../core/provider.js';
import { runAction, estimateAction, BalanceError }                     from '../modules/distribution.js';
import { getExecuteAction }                                            from '../modules/config.js';
import { getAllDepartments, formatDepartmentPayment }                   from '../modules/departments.js';
import {
  setStatus,
  setWallet,
  setConnectBtn,
  showTxResult,
  showNetWarn,
  updateAmountDisplay
} from './status.js';
import { shortAddr, toFloat } from '../core/utils.js';

// ============================================================
//  initExecuteBtn()
// ============================================================
export function initExecuteBtn() {
  if (!window.ethereum) {
    _showNoProvider();
    return;
  }

  watchWalletEvents(() => location.reload());
  _boot();
}

// ============================================================
//  _isUserRejection()
//  Detecta si el error es un rechazo voluntario del usuario
//  en el popup de firma de la wallet.
//
//  Cubre todas las wallets conocidas:
//    MetaMask moderno : code 4001 / "user rejected"
//    MetaMask legacy  : "user denied"
//    WalletConnect    : "user rejected" / "user denied"
//    Coinbase Wallet  : "rejected"
//    Trust Wallet     : "cancelled" / "user rejected"
//    Brave Wallet     : code 4001 / "user rejected"
// ============================================================
function _isUserRejection(err) {
  if (err.code === 4001) return true;
  const msg = (err.message ?? '').toLowerCase();
  return (
    msg.includes('user rejected') ||
    msg.includes('user denied')   ||
    msg.includes('rejected')      ||
    msg.includes('cancelled')
  );
}

// ============================================================
//  _assignRetryHandler()
//  Asigna al #connectBtn el handler correcto segun el estado
//  actual de sesion. Fuente unica de verdad para el handler.
// ============================================================
function _assignRetryHandler() {
  const btn = document.getElementById('connectBtn');
  if (!btn) return;
  const session = getSession();
  btn.onclick = (session && session.ready) ? _executeFlow : _handleConnect;
}

// ============================================================
//  _boot()
//  Reconexion silenciosa al cargar la pagina.
//  Tres casos posibles desde tryReconnect():
//    null             -> sin sesion  -> boton CONNECT WALLET
//    { wrongNetwork } -> red mala   -> banner + boton CONNECT
//    sesion valida    -> flujo auto -> _onSessionReady()
// ============================================================
async function _boot() {
  setStatus('Inicializando...', '');
  setConnectBtn('disabled', 'CARGANDO...');

  try {
    const result = await tryReconnect();

    // CASO 1: red incorrecta detectada en reconexion silenciosa
    if (result && result.wrongNetwork) {
      showNetWarn(true);
      setWallet(shortAddr(result.account) + ' - Red incorrecta', 'warn');
      setStatus('Red incorrecta. Cambia a BNB Smart Chain (56) y reconecta.', 'warn');
      setConnectBtn('idle', 'CONNECT WALLET');
      document.getElementById('connectBtn').onclick = _handleConnect;
      return;
    }

    // CASO 2: sesion activa con red correcta — flujo automatico
    // CORRECCION BUG-4: eliminada asignacion redundante de onclick
    // aqui. _onSessionReady() es la fuente unica que asigna el handler.
    if (result && result.ready) {
      await _onSessionReady(result);
      return;
    }

    // CASO 3: sin sesion previa
    setStatus('Conecta tu wallet para ejecutar la distribucion.', 'warn');
    setConnectBtn('idle', 'CONNECT WALLET');
    document.getElementById('connectBtn').onclick = _handleConnect;

  } catch (e) {
    _handleError(e);
  }
}

// ============================================================
//  _handleConnect()
//  Click manual en el boton -> conectar -> ejecutar.
// ============================================================
async function _handleConnect() {
  setConnectBtn('loading', 'CONECTANDO...');
  setStatus('Esperando aprobacion de cuenta en la wallet...', '');

  try {
    const session = await connectWallet();
    await _onSessionReady(session);
  } catch (e) {
    if (_isUserRejection(e)) {
      setStatus('Conexion cancelada por el usuario.', 'warn');
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
//  Wallet conectada y red correcta.
//  NO verifica owner — distributePublic() no lo requiere.
//  Lanza directamente el flujo de ejecucion automatico.
// ============================================================
async function _onSessionReady(session) {
  showNetWarn(false);
  setWallet(shortAddr(session.account), 'ok');
  setConnectBtn('loading', 'PREPARANDO...');
  setStatus('Wallet conectada. Iniciando distribucion...', '');

  // Asignar handler de reintento ANTES del await para que
  // si _executeFlow falla, el boton siempre sea operable.
  document.getElementById('connectBtn').onclick = _executeFlow;

  // Ejecutar directamente — no se necesita verificar owner
  await _executeFlow();
}

// ============================================================
//  _executeFlow()
//  Asume sesion activa. NO requiere ser owner.
//  1. Render departamentos (lectura on-chain)
//  2. Estimar BNB necesario (calculateTotalNeeded)
//  3. distributePublic() -> popup MetaMask (unica interaccion)
//  4. Receipt -> DONE
// ============================================================
async function _executeFlow() {
  // Accion siempre 'distributePublic' para el operador
  const action = getExecuteAction();

  setConnectBtn('loading', 'PREPARANDO...');
  setStatus('Leyendo estado del contrato...', '');

  try {
    await _renderDeptSummary();

    setStatus('Calculando distribucion...', '');
    const estimate = await estimateAction(action);

    // Calcular BNB con fallback explicito para evitar NaN.
    // estimateDistributePublic devuelve sendBnb y totalBnb como alias.
    const bnb = (typeof estimate.sendBnb === 'number')
      ? estimate.sendBnb
      : (typeof estimate.totalBnb === 'number')
        ? estimate.totalBnb
        : toFloat(estimate.sendValue ?? 0);

    updateAmountDisplay(bnb);

    setConnectBtn('loading', 'FIRMAR EN WALLET...');
    setStatus('Firma la transaccion en tu wallet para distribuir ' + bnb.toFixed(4) + ' BNB...', 'warn');

    // Pasar sendValue cacheado para evitar doble lectura de balance
    const { tx, receipt, sendValue } = await runAction(action, estimate.sendValue);

    const sentBnb = toFloat(sendValue).toFixed(4);
    setConnectBtn('success', 'COMPLETADO');
    setStatus(sentBnb + ' BNB distribuidos - bloque #' + receipt.blockNumber, 'ok');
    setWallet(shortAddr(getSession().account) + ' OK', 'ok');
    showTxResult(tx.hash);

  } catch (e) {
    // CORRECCION BUG-1: deteccion ampliada de rechazo del usuario.
    // Antes: solo 'user rejected'. Ahora: 'user denied', 'rejected', 'cancelled'.
    if (_isUserRejection(e)) {
      setStatus('Transaccion rechazada por el usuario. Haz clic para reintentar.', 'warn');
      setConnectBtn('idle', 'REINTENTAR');
      _assignRetryHandler();
      return;
    }
    // Cualquier otro error (red, saldo, contrato, etc.)
    _handleError(e);
  }
}

// ============================================================
//  _renderDeptSummary()
//  Renderiza el resumen de departamentos activos en la UI.
//  Si falla, muestra '—' y continua el flujo.
// ============================================================
async function _renderDeptSummary() {
  const el = document.getElementById('deptSummary');
  if (!el) return;

  try {
    const depts  = await getAllDepartments();
    const active = depts.filter(d => d.active && d.employeeCount > 0);

    if (active.length === 0) {
      el.innerHTML = '<span style="color:var(--danger)">Sin departamentos activos</span>';
      return;
    }

    el.innerHTML = active
      .map(d => '<span>' + d.name + '</span> ' + formatDepartmentPayment(d) + ' x ' + d.employeeCount)
      .join('<br>');
  } catch {
    el.textContent = '-';
  }
}

// ============================================================
//  _handleError()
//  CORRECCION BUG-3: eliminado parametro isSessionActive que
//  nunca era usado dentro de la funcion (dead code de v2.2).
//  _assignRetryHandler() decide el handler correcto
//  leyendo getSession() directamente.
// ============================================================
function _handleError(err) {
  const isNetwork = err.name === 'NetworkError';
  const isBalance = err.name === 'BalanceError';
  const msg       = err.reason ?? err.message ?? 'Error desconocido.';

  if (isNetwork) {
    showNetWarn(true);
    setConnectBtn('idle', 'CONNECT WALLET');
    setStatus(msg, 'warn');
    document.getElementById('connectBtn').onclick = _handleConnect;
    return;
  }

  if (isBalance) {
    setConnectBtn('disabled', 'SALDO INSUFICIENTE');
    setStatus(msg, 'warn');
    return;
  }

  // Error generico — mostrar en rojo 3 segundos, luego REINTENTAR
  setConnectBtn('error', 'ERROR');
  setStatus(msg, 'err');

  setTimeout(() => {
    setConnectBtn('idle', 'REINTENTAR');
    _assignRetryHandler();
  }, 3000);
}

// ============================================================
//  _showNoProvider()
//  Sin MetaMask ni wallet compatible detectada.
// ============================================================
function _showNoProvider() {
  const overlay = document.getElementById('noProviderOverlay');
  if (overlay) overlay.style.display = 'flex';
  setConnectBtn('disabled', 'SIN WEB3');
  setStatus('No se detecto proveedor Web3. Instala MetaMask.', 'err');
}
