// SPDX-License-Identifier: Apache-2.0
// Browser port of the official example-bboard's initializeProviders (from
// BrowserDeployedBoardManager.ts). Builds the provider set midnight-js-contracts
// needs to deploy/call a real contract on-chain, all backed by a connected
// browser wallet (e.g. Lace) instead of a locally-managed seed + Docker proof server.
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { toHex, fromHex } from "@midnight-ntwrk/midnight-js-utils";
import { Transaction } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { connectToWallet } from "./wallet.js";
import { inMemoryPrivateStateProvider } from "./private-state-provider.js";

// Directory this module's page lives in, so ZK assets resolve correctly
// whether the app is served at a domain root or under a subpath like /app/.
function zkConfigBaseUrl() {
  return new URL(".", window.location.href).href;
}

export async function initializeOnchainProviders(networkId) {
  const connectedAPI = await connectToWallet(networkId);
  const keyMaterialProvider = new FetchZkConfigProvider(zkConfigBaseUrl(), fetch.bind(window));
  const config = await connectedAPI.getConfiguration();

  if (!config.proverServerUri) {
    throw new Error(
      "Connected wallet did not provide a prover server URL. This wallet build may not support delegated proving yet.",
    );
  }

  const shieldedAddresses = await connectedAPI.getShieldedAddresses();
  const privateStateProvider = inMemoryPrivateStateProvider();

  return {
    connectedAPI,
    config,
    providers: {
      privateStateProvider,
      zkConfigProvider: keyMaterialProvider,
      proofProvider: httpClientProofProvider(config.proverServerUri, keyMaterialProvider),
      // Pass the browser's native WebSocket explicitly: the package defaults
      // to node's `ws`, which is undefined in a browser bundle.
      publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri, WebSocket),
      walletProvider: {
        getCoinPublicKey() {
          return shieldedAddresses.shieldedCoinPublicKey;
        },
        getEncryptionPublicKey() {
          return shieldedAddresses.shieldedEncryptionPublicKey;
        },
        async balanceTx(tx, ttl) {
          const serializedTx = toHex(tx.serialize());
          const received = await connectedAPI.balanceUnsealedTransaction(serializedTx);
          return Transaction.deserialize("signature", "proof", "binding", fromHex(received.tx));
        },
      },
      midnightProvider: {
        async submitTx(tx) {
          await connectedAPI.submitTransaction(toHex(tx.serialize()));
          return tx.identifiers()[0];
        },
      },
    },
  };
}
