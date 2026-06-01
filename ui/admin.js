// ============================================================
//  ui/admin.js  — v3.1 (corregido)
//
//  CORRECCIONES v3.1:
//  - Soporta modo desarrollo (sin contrato desplegado).
//    Si getSession().devMode === true, el panel carga y muestra
//    un banner informativo en lugar de bloquear el acceso.
//    Todas las acciones que requieren contrato muestran un
//    aviso claro en lugar de colapsar con errores crípticos.
//  - _onSessionReady() ya no aborta cuando CONTRACT_ADDRESS
//    no está configurado — muestra banner de dev mode.
//  - _refreshBalances() y _loadDepartments() son tolerantes
//    a sesiones sin contrato (devMode).
//  - connectWalletAdmin() actualiza el botón topbar correctamente
//    en todos los estados: conectado, dev mode, red incorrecta.
// ============================================================

import { connectWallet, tryReconnect, verifyOwner, getBalance, watchWalletEvents, getSession, isDevMode } from '../core/provider.js';
import { CONTRACT_ADDRESS }        from '../core/contract.js';
import { shortAddr, shortHash, fEth, toFloat, toBN, isValidAddress, parseAddressList } from '../core/utils.js';
import { getAllDepartments, addDepartment, updateDepartmentPayment, setDepartmentActive, getSendAllMode, toggleSendAllMode, calculateTotalNeeded, formatDepartmentPayment } from '../modules/departments.js';
import { getEmployees, addEmployee, addEmployeesBatch, removeEmployee } from '../modules/employees.js';
import { rescueFunds }             from '../modules/distribution.js';
import { setWallet, addLog, showNetWarn, showContractBnbAlert, updateProgressBar } from './status.js';

let _logEl = null;

// ============================================================
//  initAdmin()
// ============================================================
export function initAdmin() {
  _logEl = document.getElementById('log');

  if (!window.ethereum) {
    _log('No se detectó proveedor Web3. Instala MetaMask u otra wallet compatible.', 'err');
    _setWalletBtn('Sin Web3', 'err');
    return;
  }

  watchWalletEvents(() => location.reload());

  tryReconnect().then(session => {
    if (!session) {
      _log('Conecta tu wallet para comenzar.', 'warn');
      _setWalletBtn('Conectar Wallet', '');
      return;
    }

    if (session.wrongNetwork) {
      showNetWarn(true);
      setWallet('Red incorrecta (' + session.chainId + ')', 'warn');
      _log(`⚠ chainId ${session.chainId} — necesita BSC Mainnet (56).`, 'warn');
      return;
    }

    if (session.account) _onSessionReady(session);
  }).catch(e => {
    _log('Error al reconectar: ' + e.message, 'err');
  });
}

// ============================================================
//  connectWalletAdmin()
// ============================================================
export async function connectWalletAdmin() {
  _setWalletBtn('Conectando...', 'warn');
  try {
    const session = await connectWallet();
    await _onSessionReady(session);
  } catch (e) {
    if (e.name === 'NetworkError') {
      showNetWarn(true);
      setWallet('Red incorrecta', 'warn');
      _setWalletBtn('Red incorrecta', 'warn');
      _log('⚠ ' + e.message, 'warn');
    } else if (e.code === 4001 || (e.message ?? '').toLowerCase().includes('user rejected')) {
      _log('Conexión cancelada por el usuario.', 'warn');
      _setWalletBtn('Conectar Wallet', '');
    } else {
      _log('Error al conectar: ' + e.message, 'err');
      _setWalletBtn('Conectar Wallet', '');
    }
  }
}

// ============================================================
//  SESSION READY
// ============================================================
async function _onSessionReady(session) {
  const { account, devMode } = session;

  showNetWarn(false);
  setWallet(shortAddr(account), 'ok');
  _setWalletBtn(shortAddr(account), 'ok');
  _log(`Wallet conectada: ${account}`, 'ok');

  // ── Modo desarrollo: contrato no desplegado ───────────────
  if (devMode) {
    _showDevModeBanner();
    _log('⚠ Modo desarrollo activo. CONTRACT_ADDRESS no configurado.', 'warn');
    _log('Configura la dirección del contrato en core/contract.js tras el despliegue.', 'warn');

    // Mostrar panel vacío para navegación
    const listEl = document.getElementById('deptList');
    if (listEl) {
      listEl.innerHTML = `
        <div style="color:var(--muted);font-size:11px;padding:10px 0;font-family:var(--sans);line-height:1.7">
          Contrato no desplegado. Despliega el Smart Contract y actualiza
          <code style="color:var(--accent)">CONTRACT_ADDRESS</code> en
          <code style="color:var(--accent)">core/contract.js</code>.
        </div>`;
    }

    const sendAllStatus = document.getElementById('sendAllStatus');
    if (sendAllStatus) {
      sendAllStatus.textContent = 'N/A (sin contrato)';
      sendAllStatus.style.color = 'var(--muted)';
    }

    const execEl = document.getElementById('execTotalNeeded');
    if (execEl) execEl.textContent = '— BNB';

    return;
  }

  // ── Contrato disponible ───────────────────────────────────
  try {
    const { isOwner, contractOwner } = await verifyOwner();
    const ownerDisplay = document.getElementById('currentOwnerDisplay');
    if (ownerDisplay) ownerDisplay.textContent = contractOwner;

    if (!isOwner) {
      _log(`⚠ Esta wallet no es el owner. Owner del contrato: ${contractOwner}`, 'warn');
      setWallet(shortAddr(account) + ' (no owner)', 'warn');
      _setWalletBtn(shortAddr(account) + ' ⚠', 'warn');
    } else {
      _log('✓ Wallet verificada como owner del contrato.', 'ok');
    }
  } catch (e) {
    _log('Error verificando owner: ' + e.message, 'err');
  }

  await _loadDepartments();
  await _refreshBalances();
}

// ============================================================
//  BANNER DE MODO DESARROLLO
// ============================================================
function _showDevModeBanner() {
  // Insertar banner si no existe ya
  if (document.getElementById('devModeBanner')) return;

  const banner = document.createElement('div');
  banner.id = 'devModeBanner';
  banner.style.cssText = `
    background: rgba(232,184,75,.1);
    border: 1px solid var(--accent);
    border-radius: 5px;
    padding: 12px 16px;
    font-size: 11px;
    color: var(--accent);
    margin-bottom: 20px;
    line-height: 1.7;
    font-family: var(--sans);
  `;
  banner.innerHTML = `
    <strong style="display:block;margin-bottom:4px;font-family:var(--mono)">
      ⚙ MODO DESARROLLO — Contrato no desplegado
    </strong>
    El Smart Contract aún no ha sido desplegado. El panel está disponible para
    revisión y configuración visual. Despliega el contrato en BSC y reemplaza
    <code style="font-family:var(--mono);color:var(--text)">AQUÍ_TU_CONTRATO</code>
    en <code style="font-family:var(--mono);color:var(--text)">core/contract.js</code>
    para activar todas las funcionalidades.
  `;

  // Insertar después del page-header
  const header = document.querySelector('.page-header');
  if (header && header.parentNode) {
    header.parentNode.insertBefore(banner, header.nextSibling);
  } else {
    const main = document.querySelector('.main');
    if (main) main.prepend(banner);
  }
}

// ============================================================
//  CARGAR DEPARTAMENTOS
// ============================================================
async function _loadDepartments() {
  const { ready } = getSession();
  if (!ready) return;

  try {
    const depts  = await getAllDepartments();
    const listEl = document.getElementById('deptList');
    const selEmp = document.getElementById('empDeptSelect');
    const selAct = document.getElementById('deptActionSelect');

    if (listEl) listEl.innerHTML = '';
    if (selEmp) selEmp.innerHTML = '<option value="">— Seleccionar —</option>';
    if (selAct) selAct.innerHTML = '<option value="">— Seleccionar —</option>';

    for (const d of depts) {
      const payStr = formatDepartmentPayment(d);
      const stag   = d.active
        ? '<span class="tag tag-ok">ACTIVO</span>'
        : '<span class="tag tag-err">INACTIVO</span>';

      if (listEl) {
        listEl.innerHTML += `
          <div class="dept-item">
            <div class="dept-item-head">
              <span class="dept-name">#${d.id} — ${d.name}</span>${stag}
            </div>
            <div class="dept-meta">
              ${d.employeeCount} empleado${d.employeeCount !== 1 ? 's' : ''} &nbsp;·&nbsp; ${payStr}
            </div>
          </div>`;
      }

      const opt = new Option(`#${d.id} ${d.name} (${d.employeeCount})`, d.id);
      selEmp?.appendChild(opt.cloneNode(true));
      selAct?.appendChild(new Option(`#${d.id} ${d.name}`, d.id));
    }

    if (depts.length === 0 && listEl) {
      listEl.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px 0">No hay departamentos configurados.</div>';
    }

    const sam = await getSendAllMode();
    const sendAllStatus = document.getElementById('sendAllStatus');
    if (sendAllStatus) {
      sendAllStatus.textContent = sam
        ? 'ACTIVO (distribución proporcional)'
        : 'INACTIVO (montos fijos/configurados)';
      sendAllStatus.style.color = sam ? 'var(--accent2)' : 'var(--muted)';
    }

    _log(`${depts.length} departamento${depts.length !== 1 ? 's' : ''} cargado${depts.length !== 1 ? 's' : ''}.`, 'ok');
  } catch (e) {
    _log('Error cargando departamentos: ' + e.message, 'err');
  }
}

// ============================================================
//  REFRESCAR SALDOS
// ============================================================
async function _refreshBalances() {
  try {
    const { account, contract, ready } = getSession();
    if (!account) return;

    const bal    = await getBalance(account);
    const balBnb = toFloat(bal);
    const ownerBalEl = document.getElementById('ownerBal');
    if (ownerBalEl) ownerBalEl.textContent = balBnb.toFixed(4) + ' BNB';

    if (!ready) {
      // Sin contrato: mostrar N/A en los campos que dependen del contrato
      ['totalNeeded', 'contractBal', 'execTotalNeeded'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '—';
      });
      return;
    }

    const needed    = await calculateTotalNeeded();
    const neededBnb = toFloat(needed);

    const totalEl = document.getElementById('totalNeeded');
    if (totalEl) totalEl.textContent = neededBnb.toFixed(4) + ' BNB';

    const execEl = document.getElementById('execTotalNeeded');
    if (execEl) execEl.textContent = neededBnb.toFixed(4) + ' BNB';

    const cBal    = await contract.contractBalance();
    const cBalBnb = toFloat(cBal);
    const cBalEl  = document.getElementById('contractBal');
    if (cBalEl) cBalEl.textContent = cBalBnb.toFixed(4) + ' BNB';

    showContractBnbAlert(cBalBnb > 0 ? cBalBnb : null);
    updateProgressBar(balBnb, neededBnb);
  } catch (_) { /* silencioso */ }
}

// ============================================================
//  GUARD — requiere contrato activo
// ============================================================
function _requireContract(action = 'esta acción') {
  const { ready, devMode } = getSession();
  if (!ready) {
    if (devMode) {
      _log(`⚠ Contrato no desplegado. "${action}" requiere un contrato activo.`, 'warn');
    } else {
      _log('Conecta tu wallet para realizar esta acción.', 'warn');
    }
    return false;
  }
  return true;
}

// ============================================================
//  DEPARTAMENTOS — acciones públicas
// ============================================================
export async function addDepartmentAction() {
  if (!_requireContract('Crear departamento')) return;

  const name    = document.getElementById('newDeptName')?.value.trim();
  const isRand  = document.getElementById('newDeptRandom')?.checked;
  const fixed   = document.getElementById('newDeptFixed')?.value || '0';
  const min     = document.getElementById('newDeptMin')?.value   || '0';
  const max     = document.getElementById('newDeptMax')?.value   || '0';

  if (!name) { _log('Escribe un nombre de departamento.', 'warn'); return; }

  try {
    _log(`Creando departamento "${name}"...`, '');
    await addDepartment({ name, amountFixed: fixed, amountMin: min, amountMax: max, useRandom: isRand });
    _log(`✓ Departamento "${name}" creado.`, 'ok');
    if (document.getElementById('newDeptName')) document.getElementById('newDeptName').value = '';
    await _loadDepartments();
    await _refreshBalances();
  } catch (e) { _log('Error: ' + (e.reason || e.message), 'err'); }
}

export async function updateDeptPaymentAction() {
  if (!_requireContract('Actualizar pago')) return;

  const deptId = document.getElementById('deptActionSelect')?.value;
  const isRand = document.getElementById('updRandom')?.checked;
  const fixed  = document.getElementById('updFixed')?.value || '0';
  const min    = document.getElementById('updMin')?.value   || '0';
  const max    = document.getElementById('updMax')?.value   || '0';

  if (!deptId) { _log('Selecciona un departamento.', 'warn'); return; }

  try {
    await updateDepartmentPayment(deptId, { amountFixed: fixed, amountMin: min, amountMax: max, useRandom: isRand });
    _log(`✓ Pago del departamento #${deptId} actualizado.`, 'ok');
    await _loadDepartments();
    await _refreshBalances();
  } catch (e) { _log('Error: ' + (e.reason || e.message), 'err'); }
}

export async function setDeptActiveAction(active) {
  if (!_requireContract('Cambiar estado')) return;

  const deptId = document.getElementById('deptActionSelect')?.value;
  if (!deptId) { _log('Selecciona un departamento.', 'warn'); return; }

  try {
    await setDepartmentActive(deptId, active);
    _log(`✓ Departamento #${deptId} ${active ? 'activado' : 'desactivado'}.`, 'ok');
    await _loadDepartments();
  } catch (e) { _log('Error: ' + (e.reason || e.message), 'err'); }
}

// ============================================================
//  EMPLEADOS — acciones públicas
// ============================================================
export async function loadEmployeeListAction() {
  const deptId    = document.getElementById('empDeptSelect')?.value;
  const container = document.getElementById('empListContainer');
  if (!deptId) { if (container) container.style.display = 'none'; return; }
  if (!_requireContract('Cargar empleados')) { if (container) container.style.display = 'none'; return; }
  if (container) container.style.display = 'block';

  try {
    const emps = await getEmployees(deptId);
    const el   = document.getElementById('empList');
    if (!el) return;

    if (emps.length === 0) {
      el.innerHTML = '<div style="color:var(--muted);font-size:10px;padding:4px 0">Sin empleados en este departamento.</div>';
      return;
    }
    el.innerHTML = emps.map((addr, i) =>
      `<div class="emp-item">
        <span class="emp-addr">${addr}</span>
        <button class="emp-rm" onclick="window._admin.removeEmployeeAction(${deptId},${i})" title="Eliminar">✕</button>
      </div>`
    ).join('');
  } catch (e) { _log('Error cargando empleados: ' + e.message, 'err'); }
}

export async function addEmployeeAction() {
  if (!_requireContract('Añadir empleado')) return;

  const deptId = document.getElementById('empDeptSelect')?.value;
  const addr   = document.getElementById('newEmpAddr')?.value.trim();

  if (!isValidAddress(addr)) { _log('Dirección inválida.', 'warn'); return; }

  try {
    await addEmployee(deptId, addr);
    _log(`✓ Empleado ${shortAddr(addr)} añadido al departamento #${deptId}.`, 'ok');
    if (document.getElementById('newEmpAddr')) document.getElementById('newEmpAddr').value = '';
    await loadEmployeeListAction();
    await _refreshBalances();
  } catch (e) { _log('Error: ' + (e.reason || e.message), 'err'); }
}

export async function addEmployeesBatchAction() {
  if (!_requireContract('Añadir empleados batch')) return;

  const deptId = document.getElementById('empDeptSelect')?.value;
  const raw    = document.getElementById('batchEmpAddrs')?.value.trim();

  try {
    const { added } = await addEmployeesBatch(deptId, raw);
    _log(`✓ ${added} empleados añadidos al departamento #${deptId}.`, 'ok');
    if (document.getElementById('batchEmpAddrs')) document.getElementById('batchEmpAddrs').value = '';
    await loadEmployeeListAction();
    await _refreshBalances();
  } catch (e) { _log('Error: ' + (e.reason || e.message), 'err'); }
}

export async function removeEmployeeAction(deptId, idx) {
  if (!_requireContract('Eliminar empleado')) return;
  if (!confirm('¿Eliminar este empleado del departamento?')) return;

  try {
    await removeEmployee(deptId, idx);
    _log(`✓ Empleado #${idx} eliminado del departamento #${deptId}.`, 'ok');
    await loadEmployeeListAction();
    await _refreshBalances();
  } catch (e) { _log('Error: ' + (e.reason || e.message), 'err'); }
}

// ============================================================
//  SEND ALL MODE
// ============================================================
export async function toggleSendAllAction(enabled) {
  if (!_requireContract('Toggle Send All Mode')) return;

  try {
    await toggleSendAllMode(enabled);
    _log(`✓ Send All Mode ${enabled ? 'activado' : 'desactivado'}.`, 'ok');
    await _loadDepartments();
  } catch (e) { _log('Error: ' + (e.reason || e.message), 'err'); }
}

// ============================================================
//  RESCUE FUNDS
// ============================================================
export async function rescueFundsAction() {
  if (!_requireContract('Rescatar fondos')) return;
  if (!confirm('¿Rescatar todos los fondos del contrato a tu wallet?')) return;

  try {
    _log('Iniciando rescate de fondos...', '');
    const receipt = await rescueFunds();
    _log('✓ Fondos rescatados. TX: ' + shortHash(receipt.transactionHash), 'ok');
    await _refreshBalances();
  } catch (e) { _log('Error al rescatar: ' + (e.reason || e.message), 'err'); }
}

// ============================================================
//  TRANSFER OWNERSHIP
// ============================================================
export async function transferOwnershipAction() {
  if (!_requireContract('Transferir ownership')) return;

  const { contract } = getSession();
  const newOwner = document.getElementById('newOwnerAddr')?.value.trim();
  if (!isValidAddress(newOwner)) { _log('Dirección inválida.', 'warn'); return; }

  try {
    const currentOwner = await contract.owner();
    if (newOwner.toLowerCase() === currentOwner.toLowerCase()) {
      _log('⚠ La nueva dirección ya es el owner actual.', 'warn');
      return;
    }
  } catch (e) { _log('Error verificando owner: ' + e.message, 'err'); return; }

  if (!confirm(
    `¿Transferir ownership a:\n${newOwner}\n\nEsta acción es IRREVERSIBLE.\nPerderás todos los permisos administrativos.`
  )) return;

  try {
    _log(`Transfiriendo ownership a ${shortAddr(newOwner)}...`, '');
    const tx = await contract.transferOwnership(newOwner);
    await tx.wait();
    _log(`✓ Ownership transferido. TX: ${shortHash(tx.hash)}`, 'ok');
    if (document.getElementById('newOwnerAddr')) document.getElementById('newOwnerAddr').value = '';
    _log('⚠ Tu wallet ya no es el owner. Recargando...', 'warn');
    setTimeout(() => location.reload(), 2500);
  } catch (e) { _log('Error: ' + (e.reason || e.message), 'err'); }
}

// ============================================================
//  TOGGLE UI
// ============================================================
export function toggleRandomFields() {
  const r = document.getElementById('newDeptRandom')?.checked;
  const fixed  = document.getElementById('fixedFields');
  const random = document.getElementById('randomFields');
  if (fixed)  fixed.style.display  = r ? 'none'  : 'block';
  if (random) random.style.display = r ? 'block' : 'none';
}

export function toggleUpdateRandom() {
  const r = document.getElementById('updRandom')?.checked;
  const fixed  = document.getElementById('updFixedArea');
  const random = document.getElementById('updRandomArea');
  if (fixed)  fixed.style.display  = r ? 'none'  : 'block';
  if (random) random.style.display = r ? 'block' : 'none';
}

// ============================================================
//  HELPERS PRIVADOS
// ============================================================
function _log(msg, type = '') {
  addLog(msg, type, _logEl);
}

function _setWalletBtn(label, type) {
  const btn = document.querySelector('.wallet-pill');
  const dot = document.getElementById('dot');
  const lbl = document.getElementById('walletLabel');
  if (lbl) lbl.textContent = label;
  if (dot) {
    dot.className = 'dot' + (type === 'ok' ? ' ok' : type === 'warn' ? ' warn' : '');
  }
}
