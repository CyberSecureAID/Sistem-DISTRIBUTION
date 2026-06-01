// ============================================================
//  ui/admin.js
//  Lógica completa del panel de administración.
//  Orquesta: conexión → carga de datos → CRUD → feedback.
//
//  Uso en admin.html:
//    <script type="module">
//      import { initAdmin } from './ui/admin.js';
//      initAdmin();
//    </script>
// ============================================================

import { connectWallet, tryReconnect, verifyOwner, getBalance, watchWalletEvents } from '../core/provider.js';
import { CONTRACT_ADDRESS }        from '../core/contract.js';
import { shortAddr, shortHash, fEth, toFloat, toBN, isValidAddress, parseAddressList } from '../core/utils.js';
import { getAllDepartments, addDepartment, updateDepartmentPayment, setDepartmentActive, getSendAllMode, toggleSendAllMode, calculateTotalNeeded, formatDepartmentPayment } from '../modules/departments.js';
import { getEmployees, addEmployee, addEmployeesBatch, removeEmployee } from '../modules/employees.js';
import { rescueFunds }             from '../modules/distribution.js';
import { saveConfig, loadConfig, getAction, ACTIONS } from '../modules/config.js';
import { setWallet, addLog, showNetWarn, showContractBnbAlert, updateProgressBar } from './status.js';

// ── Estado local ─────────────────────────────────────────────
let _logEl = null;

// ============================================================
//  initAdmin()
//  Punto de entrada único. Llamar al cargar la página.
// ============================================================
export function initAdmin() {
  _logEl = document.getElementById('log');

  _updateExecPreview();
  _loadSavedConfig();

  if (!window.ethereum) {
    _log('No se detectó proveedor Web3.', 'err');
    return;
  }

  watchWalletEvents(() => location.reload());

  // Reconexión silenciosa si hay sesión activa
  tryReconnect().then(session => {
    if (session) _onSessionReady(session);
  }).catch(() => {});

  // Eventos de UI
  document.getElementById('cfgAction')?.addEventListener('change', _updateExecPreview);
}

// ============================================================
//  connectWalletAdmin()  — llamado desde el botón topbar
// ============================================================
export async function connectWalletAdmin() {
  try {
    const session = await connectWallet();
    await _onSessionReady(session);
  } catch (e) {
    _log('Conexión cancelada: ' + e.message, 'err');
  }
}

// ============================================================
//  SESSION READY
// ============================================================
async function _onSessionReady(session) {
  const { account } = session;

  const network = await (new ethers.providers.Web3Provider(window.ethereum)).getNetwork();
  if (network.chainId !== 56) {
    showNetWarn(true);
    setWallet(`Red incorrecta (${network.chainId})`, 'warn');
    _log(`⚠ chainId ${network.chainId} — necesita BSC Mainnet (56)`, 'warn');
    return;
  }

  showNetWarn(false);
  setWallet(shortAddr(account), 'ok');
  _log(`Wallet: ${account}`, 'ok');

  if (!ethers.utils.isAddress(CONTRACT_ADDRESS) || CONTRACT_ADDRESS === 'AQUÍ_TU_CONTRATO') {
    _log('CONTRACT_ADDRESS no configurado en core/contract.js.', 'err');
    return;
  }

  // Verificar ownership
  try {
    const { isOwner, contractOwner } = await verifyOwner();
    const ownerDisplay = document.getElementById('currentOwnerDisplay');
    if (ownerDisplay) ownerDisplay.textContent = contractOwner;

    if (!isOwner) {
      _log(`⚠ Esta wallet no es el owner. Owner: ${contractOwner}`, 'warn');
      setWallet(shortAddr(account) + ' (no owner)', 'warn');
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
//  CARGAR DEPARTAMENTOS
// ============================================================
async function _loadDepartments() {
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

    const sam = await getSendAllMode();
    const sendAllStatus = document.getElementById('sendAllStatus');
    if (sendAllStatus) {
      sendAllStatus.textContent = sam
        ? 'ACTIVO (distribución proporcional)'
        : 'INACTIVO (montos fijos/configurados)';
      sendAllStatus.style.color = sam ? 'var(--accent2)' : 'var(--muted)';
    }

    _log(`${depts.length} departamentos cargados.`, 'ok');
  } catch (e) {
    _log('Error cargando departamentos: ' + e.message, 'err');
  }
}

// ============================================================
//  REFRESCAR SALDOS
// ============================================================
async function _refreshBalances() {
  try {
    const { account, contract } = (await import('../core/provider.js')).getSession();
    if (!account) return;

    const bal    = await getBalance(account);
    const balBnb = toFloat(bal);
    const ownerBalEl = document.getElementById('ownerBal');
    if (ownerBalEl) ownerBalEl.textContent = balBnb.toFixed(4) + ' BNB';

    if (contract) {
      const needed    = await calculateTotalNeeded();
      const neededBnb = toFloat(needed);
      const totalEl   = document.getElementById('totalNeeded');
      if (totalEl) totalEl.textContent = neededBnb.toFixed(4) + ' BNB';

      const cBal    = await contract.contractBalance();
      const cBalBnb = toFloat(cBal);
      const cBalEl  = document.getElementById('contractBal');
      if (cBalEl) cBalEl.textContent = cBalBnb.toFixed(4) + ' BNB';

      showContractBnbAlert(cBalBnb > 0 ? cBalBnb : null);
      updateProgressBar(balBnb, neededBnb);
    }
  } catch (_) { /* silencioso */ }
}

// ============================================================
//  DEPARTAMENTOS — acciones públicas (llamadas desde HTML)
// ============================================================
export async function addDepartmentAction() {
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
  const { contract } = (await import('../core/provider.js')).getSession();
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
    const { contract: c } = (await import('../core/provider.js')).getSession();
    _log(`Transfiriendo ownership a ${shortAddr(newOwner)}...`, '');
    const tx = await c.transferOwnership(newOwner);
    await tx.wait();
    _log(`✓ Ownership transferido. TX: ${shortHash(tx.hash)}`, 'ok');
    if (document.getElementById('newOwnerAddr')) document.getElementById('newOwnerAddr').value = '';
    _log('⚠ Tu wallet ya no es el owner. Recargando...', 'warn');
    setTimeout(() => location.reload(), 2500);
  } catch (e) { _log('Error: ' + (e.reason || e.message), 'err'); }
}

// ============================================================
//  CONFIG DEL BOTÓN DE EJECUCIÓN
// ============================================================
export function saveExecConfigAction() {
  const action = document.getElementById('cfgAction')?.value;
  try {
    saveConfig({ action, contractAddress: CONTRACT_ADDRESS });
    const notice = document.getElementById('savedNotice');
    if (notice) {
      notice.style.display = 'block';
      setTimeout(() => { notice.style.display = 'none'; }, 3000);
    }
    _log(`✓ Configuración guardada: acción → ${action}()`, 'ok');
  } catch (e) { _log('Error al guardar: ' + e.message, 'err'); }
}

// ============================================================
//  TOGGLE UI — campos random / fijo
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
//  PRIVADOS
// ============================================================
function _updateExecPreview() {
  const action  = document.getElementById('cfgAction')?.value ?? 'distribute';
  const preview = document.getElementById('previewAction');
  if (preview) preview.textContent = action + '()';
}

function _loadSavedConfig() {
  const cfg = loadConfig();
  const sel = document.getElementById('cfgAction');
  if (sel && cfg.action) sel.value = cfg.action;
  _updateExecPreview();
}

function _log(msg, type = '') {
  addLog(msg, type, _logEl);
}
