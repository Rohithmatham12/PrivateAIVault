// SPDX-License-Identifier: Apache-2.0
// Adapted from midnightntwrk/example-bboard (bboard-cli/src/generate-dust.ts).

import { createKeystore } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import * as rx from "rxjs";

export const getUnshieldedSeed = (seed) => {
  const seedBuffer = Buffer.from(seed, "hex");
  const { hdWallet } = HDWallet.fromSeed(seedBuffer);
  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);
  if (derivationResult.type === "keyOutOfBounds") {
    throw new Error("Key derivation out of bounds");
  }
  return derivationResult.key;
};

export const generateDust = async (logger, walletSeed, unshieldedState, walletFacade) => {
  const dustState = await walletFacade.dust.waitForSyncedState();
  const networkId = getNetworkId();
  const unshieldedKeystore = createKeystore(getUnshieldedSeed(walletSeed), networkId);
  const utxos = unshieldedState.availableCoins.filter((coin) => !coin.meta.registeredForDustGeneration);

  if (utxos.length === 0) {
    logger.info("No unregistered UTXOs found for dust generation.");
    return;
  }

  logger.info(`Generating dust with ${utxos.length} UTXOs...`);
  const recipe = await walletFacade.registerNightUtxosForDustGeneration(
    utxos,
    unshieldedKeystore.getPublicKey(),
    (payload) => unshieldedKeystore.signData(payload),
    dustState.address,
  );
  const transaction = await walletFacade.finalizeRecipe(recipe);
  const txId = await walletFacade.submitTransaction(transaction);

  const dustBalance = await rx.firstValueFrom(
    walletFacade.state().pipe(
      rx.filter((s) => s.dust.balance(new Date()) > 0n),
      rx.map((s) => s.dust.balance(new Date())),
    ),
  );
  logger.info(`Dust generation tx submitted: ${txId}, dust balance: ${dustBalance}`);
  return txId;
};
