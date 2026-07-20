#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// PrivateAIVault -- one-shot, non-interactive deployment to Midnight's
// live Preprod testnet. Adapted from the official example-bboard CLI
// (midnightntwrk/example-bboard, bboard-cli/), trimmed to a single
// scripted flow: build a fresh wallet, fund it from the public faucet,
// register dust generation, deploy PrivateAIVault, commit a real
// record, then read the committed state back from the public indexer
// to prove it is really on-chain.
//
// Requires: the local proof server running on :6300 (docker) and
// network access to Midnight's Preprod indexer/node/faucet.

import { WebSocket } from "ws";
globalThis.WebSocket = WebSocket;

import { createHash } from "node:crypto";
import pino from "pino";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { assertIsContractAddress, toHex } from "@midnight-ntwrk/midnight-js-utils";
import { unshieldedToken } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { FaucetClient } from "@midnight-ntwrk/testkit-js";
import * as Rx from "rxjs";

import { CompiledBBoardContractContract } from "./contract/dist/index.js";
import { ledger } from "./contract/dist/managed/bboard/contract/index.js";

const logger = pino({ level: "info", transport: { target: "pino-pretty" } });

const ENV = {
  walletNetworkId: "preprod",
  networkId: "preprod",
  indexer: "https://indexer.preprod.midnight.network/api/v4/graphql",
  indexerWS: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
  node: "https://rpc.preprod.midnight.network",
  nodeWS: "wss://rpc.preprod.midnight.network",
  faucet: "https://midnight-tmnight-preprod.nethermind.dev/",
  proofServer: "http://127.0.0.1:6300",
};

setNetworkId("preprod");

async function main() {
  logger.info("=== PrivateAIVault: deploying to Midnight Preprod testnet ===");

  const { MidnightWalletProvider } = await import("./lib/midnight-wallet-provider.mjs");
  const { waitForUnshieldedFunds, syncWallet } = await import("./lib/wallet-utils.mjs");
  const { generateDust } = await import("./lib/generate-dust.mjs");

  const seed = process.env.WALLET_SEED || toHex(crypto.getRandomValues(new Uint8Array(32)));
  logger.info(`Using wallet seed: ${seed}`);
  logger.info("(save WALLET_SEED to reuse this wallet + its funds on the next run)");

  const walletProvider = await MidnightWalletProvider.build(logger, ENV, seed);
  await walletProvider.start();

  logger.info("Requesting funds from the Preprod faucet and waiting for sync...");
  const unshieldedState = await waitForUnshieldedFunds(
    logger,
    walletProvider.wallet,
    ENV,
    unshieldedToken(),
    true,
  );
  const nightBalance = unshieldedState.balances[unshieldedToken().raw];
  logger.info(`NIGHT balance: ${nightBalance}`);
  if (!nightBalance || nightBalance === 0n) {
    throw new Error("No funds received from faucet -- cannot proceed.");
  }

  logger.info("Registering dust generation (needed to pay fees on Preprod)...");
  const dustTx = await generateDust(logger, seed, unshieldedState, walletProvider.wallet);
  if (dustTx) {
    logger.info(`Dust generation tx: ${dustTx}, waiting for wallet to resync...`);
    await syncWallet(logger, walletProvider.wallet);
  }

  const zkConfigProvider = new NodeZkConfigProvider(
    new URL("./contract/src/managed/bboard", import.meta.url).pathname,
  );
  const providers = {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: "privateaivault-private-state",
      signingKeyStoreName: "privateaivault-private-state-signing-keys",
      privateStoragePasswordProvider: () => "PrivateAIVault-Testnet-2026!",
      accountId: seed,
    }),
    publicDataProvider: indexerPublicDataProvider(ENV.indexer, ENV.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(ENV.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };

  logger.info("Deploying PrivateAIVault contract to Preprod...");
  const deployed = await deployContract(providers, {
    compiledContract: CompiledBBoardContractContract,
    privateStateId: "privateaivault-private-state",
    initialPrivateState: { secretKey: crypto.getRandomValues(new Uint8Array(32)), spanCounts: {} },
  });
  const contractAddress = deployed.deployTxData.public.contractAddress;
  logger.info(`Deployed! Contract address: ${contractAddress}`);
  logger.info(`Deploy tx hash: ${deployed.deployTxData.public.txHash}`);

  const rawRecord =
    "Patient: Jane Doe, DOB 1990-04-12, SSN 219-09-9999, contact jane.doe@example.com, diagnosed with condition X.";
  // The commitment doubles as this record's id, so one deployed contract
  // can hold an unbounded number of independent records.
  const recordId = new Uint8Array(createHash("sha256").update(rawRecord, "utf8").digest());
  logger.info(`Committing a real record's SHA-256 hash on-chain (raw text stays local)...`);
  const txData = await deployed.callTx.commitRecord(recordId, recordId);
  logger.info(`commitRecord tx hash: ${txData.public.txHash}, block: ${txData.public.blockHeight}`);

  logger.info("Reading committed state back from the public Preprod indexer...");
  assertIsContractAddress(contractAddress);
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  const ledgerState = ledger(contractState.data);
  logger.info({
    onChainLedgerState: {
      recordCount: ledgerState.recordCount.toString(),
      commitment: `0x${toHex(ledgerState.commitmentOf.lookup(recordId))}`,
      owner: `0x${toHex(ledgerState.ownerOf.lookup(recordId))}`,
    },
  });

  console.log("\n=== DEPLOYED ON MIDNIGHT PREPROD TESTNET ===");
  console.log(`Contract address: ${contractAddress}`);
  console.log(`Deploy tx:        ${deployed.deployTxData.public.txHash}`);
  console.log(`Commit tx:        ${txData.public.txHash}`);
  console.log(`Verify via indexer: ${ENV.indexer}`);

  await walletProvider.stop();
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
