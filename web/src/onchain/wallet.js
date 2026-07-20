// SPDX-License-Identifier: Apache-2.0
// Browser port of the official example-bboard's wallet-connector logic
// (BrowserDeployedBoardManager.ts), for connecting to an injected Midnight
// wallet (e.g. Lace) via window.midnight and the dapp-connector-api.

const COMPATIBLE_CONNECTOR_API_VERSION_MAJOR = 4;

function isCompatible(wallet) {
  if (!wallet || typeof wallet !== "object" || !("apiVersion" in wallet)) return false;
  const major = parseInt(String(wallet.apiVersion).split(".")[0], 10);
  return major === COMPATIBLE_CONNECTOR_API_VERSION_MAJOR;
}

function getFirstCompatibleWallet() {
  if (!window.midnight) return undefined;
  return Object.values(window.midnight).find(isCompatible);
}

export function isWalletAvailable() {
  return !!getFirstCompatibleWallet();
}

export async function connectToWallet(networkId, { timeoutMs = 5000 } = {}) {
  const initialAPI = getFirstCompatibleWallet();
  if (!initialAPI) {
    throw new Error("No compatible Midnight wallet found. Install the Lace wallet extension and enable the Midnight network.");
  }
  const connectedAPI = await Promise.race([
    initialAPI.connect(networkId),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Midnight wallet did not respond. Is it unlocked?")), timeoutMs)),
  ]);
  const status = await connectedAPI.getConnectionStatus();
  if (status.status !== "connected") {
    throw new Error("Wallet connection was not authorized.");
  }
  return connectedAPI;
}
