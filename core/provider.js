// ============================================================
//  core/provider.js  — v2.2 (corregido)
//  Gestión del proveedor Web3: conexión, red, signer, contrato.
//
//  CORRECCIONES v2.2:
//  - CONTRACT_ADDRESS no configurado ya NO lanza error fatal.
//    En modo desarrollo (sin contrato desplegado) el sistema
//    funciona en modo "sin contrato": getSession().ready = false
//    pero getSession().account sí está disponible, lo que
//    permite acceder al panel admin para configurar y desarrollar.
//  - tryReconnect() conserva comportamiento de v2.1 (retorna
//    null o { wrongNetwork } sin lanzar excepciones).
//  - Nueva exportación: isDevMode() para que las UI puedan
//    mostrar advertencias sin bloquear el acceso.
// ============================================================

import { CONTRACT_ADDRESS, ABI } from './contract.js';

const BSC_CHAIN_ID = 56;

let _provider = null;
let _signer   = null;
let _contract = null;
let _account  = null;
let _chainId  = null;
let _devMode  = false; // true cuando no hay contrato configurado

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
    ready:    !!_contract,
    devMode:  _devMode
  };
}

// ============================================================
//  isDevMode()
//  true si la wallet está conectada pero no hay contrato.
// ============================================================
export function isDevMode() {
  return _devMode;
}

// ============================================================
//  connectWallet()
// ============================================================
export async function connectWallet() {
  if (!window.ethereum) throw new Error('No se detectó proveedor Web3.');
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  return _initSession(accounts, true);
}

// ============================================================
//  tryReconnect()
//  Reconexión silenciosa. Retorna null si no hay cuentas.
//  Retorna { wrongNetwork } si la red es incorrecta.
//  Nunca lanza excepciones.
// ============================================================
export async function tryReconnect() {
  if (!window.ethereum) return null;

  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (!accounts || accounts.length === 0) return null;

    const tempProvider = new ethers.providers.Web3Provider(window.ethereum);
    const network      = await tempProvider.getNetwork();

    if (network.chainId !== BSC_CHAIN_ID) {
      return {
        wrongNetwork: true,
        chainId: network.chainId,
        account: accounts[0].toLowerCase()
      };
    }

    return _initSession(accounts, false);
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
    _contract = null;
    _devMode  = false;
    return getSession();
  }

  // ── Contrato no configurado: modo desarrollo ──────────────
  const noContract =
    !CONTRACT_ADDRESS ||
    CONTRACT_ADDRESS === 'AQUÍ_TU_CONTRATO' ||
    !ethers.utils.isAddress(CONTRACT_ADDRESS);

  if (noContract) {
    _contract = null;
    _devMode  = true;
    // NO lanzar error — retornar sesión parcial para que el
    // panel admin pueda cargarse en modo desarrollo.
    return getSession();
  }

  _devMode  = false;
  _contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, _signer);
  return getSession();
}

// ============================================================
//  verifyOwner()
// ============================================================
export async function verifyOwner() {
  const { contract, account } = getSession();
  if (!contract) throw new Error('No hay contrato activo. Revisa CONTRACT_ADDRESS en core/contract.js.');
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
