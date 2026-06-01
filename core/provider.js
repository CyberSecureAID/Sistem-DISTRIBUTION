// ============================================================
//  core/provider.js
//  Gestión del proveedor Web3: conexión, red, signer, contrato.
//  Exporta funciones y el estado de sesión activa.
// ============================================================

import { CONTRACT_ADDRESS, ABI } from './contract.js';

// ── Constantes de red ────────────────────────────────────────
const BSC_CHAIN_ID = 56;

// ── Estado de sesión (módulo-singleton) ──────────────────────
let _provider = null;
let _signer   = null;
let _contract = null;
let _account  = null; // dirección conectada (lowercase)

// ============================================================
//  getSession()
//  Devuelve el estado actual de la sesión.
//  Usar para leer provider/signer/contract desde otros módulos.
// ============================================================
export function getSession() {
  return {
    provider: _provider,
    signer:   _signer,
    contract: _contract,
    account:  _account,
    ready:    !!_contract
  };
}

// ============================================================
//  connectWallet()
//  Abre el popup de la wallet y devuelve la sesión inicializada.
//  Lanza error si el usuario cancela o la red es incorrecta.
// ============================================================
export async function connectWallet() {
  if (!window.ethereum) throw new Error('No se detectó proveedor Web3.');

  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  return _initSession(accounts);
}

// ============================================================
//  tryReconnect()
//  Intento silencioso de reconexión si hay sesión activa previa.
//  Retorna la sesión si hay cuentas activas, null si no.
// ============================================================
export async function tryReconnect() {
  if (!window.ethereum) return null;

  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts && accounts.length > 0) return _initSession(accounts);
  } catch (_) { /* sin sesión previa */ }

  return null;
}

// ============================================================
//  _initSession()  — privado
//  Inicializa provider, signer y contrato con las cuentas dadas.
//  Valida chainId y dirección del contrato.
// ============================================================
async function _initSession(accounts) {
  _provider = new ethers.providers.Web3Provider(window.ethereum);
  _signer   = _provider.getSigner();
  _account  = accounts[0].toLowerCase();

  const network = await _provider.getNetwork();
  if (network.chainId !== BSC_CHAIN_ID) {
    throw new NetworkError(
      `Red incorrecta (chainId ${network.chainId}). Requiere BSC Mainnet (56).`,
      network.chainId
    );
  }

  if (!ethers.utils.isAddress(CONTRACT_ADDRESS) || CONTRACT_ADDRESS === 'AQUÍ_TU_CONTRATO') {
    throw new Error('CONTRACT_ADDRESS no configurado en core/contract.js.');
  }

  _contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, _signer);

  return getSession();
}

// ============================================================
//  verifyOwner()
//  Comprueba que la cuenta conectada sea el owner del contrato.
//  Retorna { isOwner, contractOwner }.
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
//  Retorna el balance BNB de la cuenta conectada como BigNumber.
// ============================================================
export async function getBalance(address) {
  const { provider, account } = getSession();
  if (!provider) throw new Error('No hay sesión activa.');
  return provider.getBalance(address ?? account);
}

// ============================================================
//  onAccountsChanged / onChainChanged
//  Registrar listeners de cambio de cuenta/red.
//  Pasar callback; normalmente se usa location.reload().
// ============================================================
export function watchWalletEvents(onChange) {
  if (!window.ethereum) return;
  window.ethereum.on('accountsChanged', onChange);
  window.ethereum.on('chainChanged',    onChange);
}

// ============================================================
//  NetworkError — error tipado para distinguir errores de red
//  de otros errores de inicialización.
// ============================================================
export class NetworkError extends Error {
  constructor(message, chainId) {
    super(message);
    this.name    = 'NetworkError';
    this.chainId = chainId;
  }
}
