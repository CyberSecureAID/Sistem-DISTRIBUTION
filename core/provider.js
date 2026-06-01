// ============================================================
//  core/provider.js  — v2.1 (corregido)
//  Gestión del proveedor Web3: conexión, red, signer, contrato.
//  Exporta funciones y el estado de sesión activa.
//
//  CORRECCIONES v2.1:
//  - tryReconnect() ya NO lanza NetworkError; retorna null si la
//    red es incorrecta. El flujo automático de execute-btn.js
//    detecta la red incorrecta y muestra el banner, en lugar de
//    caer en el catch genérico que activa el botón de reintento
//    apuntando a _executeFlow (sin sesión activa).
//  - _initSession() exporta el chainId detectado en la sesión
//    para que los módulos de UI puedan inspeccionarlo.
// ============================================================

import { CONTRACT_ADDRESS, ABI } from './contract.js';

// ── Constantes de red ────────────────────────────────────────
const BSC_CHAIN_ID = 56;

// ── Estado de sesión (módulo-singleton) ──────────────────────
let _provider = null;
let _signer   = null;
let _contract = null;
let _account  = null;
let _chainId  = null;

// ============================================================
//  getSession()
// ============================================================
export function getSession() {
  return {
    provider: _provider,
    signer:   _signer,
    contract: _contract,
    account:  _account,
    chainId:  _chainId,
    ready:    !!_contract
  };
}

// ============================================================
//  connectWallet()
//  Abre el popup de la wallet. Lanza NetworkError si la red
//  es incorrecta — comportamiento esperado en el flujo manual.
// ============================================================
export async function connectWallet() {
  if (!window.ethereum) throw new Error('No se detectó proveedor Web3.');
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  return _initSession(accounts, /* throwOnWrongNetwork */ true);
}

// ============================================================
//  tryReconnect()
//  Reconexión silenciosa. Retorna null si:
//    - No hay cuentas activas
//    - La red es incorrecta (en lugar de lanzar NetworkError)
//  Así execute-btn.js puede mostrar el banner de red y habilitar
//  el botón "CONNECT WALLET" sin entrar en estados de error.
// ============================================================
export async function tryReconnect() {
  if (!window.ethereum) return null;

  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (!accounts || accounts.length === 0) return null;

    // Verificar red ANTES de intentar inicializar sesión completa
    const tempProvider = new ethers.providers.Web3Provider(window.ethereum);
    const network      = await tempProvider.getNetwork();
    if (network.chainId !== BSC_CHAIN_ID) {
      // Red incorrecta: retornamos un objeto especial (no null) para
      // que execute-btn.js pueda distinguir "no conectado" de "red incorrecta"
      return { wrongNetwork: true, chainId: network.chainId, account: accounts[0].toLowerCase() };
    }

    return _initSession(accounts, /* throwOnWrongNetwork */ false);
  } catch (_) {
    return null;
  }
}

// ============================================================
//  _initSession()
// ============================================================
async function _initSession(accounts, throwOnWrongNetwork = true) {
  _provider = new ethers.providers.Web3Provider(window.ethereum);
  _signer   = _provider.getSigner();
  _account  = accounts[0].toLowerCase();

  const network = await _provider.getNetwork();
  _chainId = network.chainId;

  if (network.chainId !== BSC_CHAIN_ID) {
    if (throwOnWrongNetwork) {
      throw new NetworkError(
        `Red incorrecta (chainId ${network.chainId}). Requiere BSC Mainnet (56).`,
        network.chainId
      );
    }
    // Sin throw: limpiar contrato para que ready=false
    _contract = null;
    return getSession();
  }

  if (!ethers.utils.isAddress(CONTRACT_ADDRESS) || CONTRACT_ADDRESS === 'AQUÍ_TU_CONTRATO') {
    throw new Error('CONTRACT_ADDRESS no configurado en core/contract.js.');
  }

  _contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, _signer);
  return getSession();
}

// ============================================================
//  verifyOwner()
// ============================================================
export async function verifyOwner() {
  const { contract, account } = getSession();
  if (!contract) throw new Error('No hay sesión activa.');
  const contractOwner = await contract.owner();
  const isOwner = contractOwner.toLowerCase() === account;
  return { isOwner, contractOwner };
}

// ============================================================
//  getBalance()
// ============================================================
export async function getBalance(address) {
  const { provider, account } = getSession();
  if (!provider) throw new Error('No hay sesión activa.');
  return provider.getBalance(address ?? account);
}

// ============================================================
//  watchWalletEvents()
// ============================================================
export function watchWalletEvents(onChange) {
  if (!window.ethereum) return;
  window.ethereum.on('accountsChanged', onChange);
  window.ethereum.on('chainChanged',    onChange);
}

// ============================================================
//  NetworkError
// ============================================================
export class NetworkError extends Error {
  constructor(message, chainId) {
    super(message);
    this.name    = 'NetworkError';
    this.chainId = chainId;
  }
}
