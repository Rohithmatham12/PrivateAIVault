// SPDX-License-Identifier: Apache-2.0
// Adapted from midnightntwrk/example-bboard (bboard-cli/src/wallet-utils.ts),
// stripped of TypeScript types for use as a plain ESM module here.

import * as Rx from "rxjs";
import { FaucetClient } from "@midnight-ntwrk/testkit-js";
import { UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";

export const getInitialShieldedState = async (logger, wallet) => {
  logger.info("Getting initial state of wallet (shielded)...");
  return Rx.firstValueFrom(wallet.state);
};

export const getInitialUnshieldedState = async (logger, wallet) => {
  logger.info("Getting initial state of wallet (unshielded)...");
  return Rx.firstValueFrom(wallet.state);
};

const isProgressStrictlyComplete = (progress) => {
  if (!progress || typeof progress !== "object") return false;
  if (typeof progress.isStrictlyComplete !== "function") return false;
  return progress.isStrictlyComplete();
};

const isFacadeStateSynced = (state) =>
  isProgressStrictlyComplete(state.shielded.state.progress) &&
  isProgressStrictlyComplete(state.dust.state.progress) &&
  isProgressStrictlyComplete(state.unshielded.progress);

export const syncWallet = (logger, wallet, throttleTime = 2000) => {
  logger.info("Syncing wallet...");
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(throttleTime),
      Rx.filter((state) => isFacadeStateSynced(state)),
      Rx.tap(() => logger.info("Sync complete")),
    ),
  );
};

export const waitForUnshieldedFunds = async (
  logger,
  wallet,
  env,
  tokenType,
  fundFromFaucet = false,
  throttleTime = 2000,
) => {
  const initialState = await getInitialUnshieldedState(logger, wallet.unshielded);
  const unshieldedAddress = UnshieldedAddress.codec.encode(getNetworkId(), initialState.address);
  logger.info(`Using unshielded address: ${unshieldedAddress.toString()}`);

  if (fundFromFaucet && env.faucet) {
    logger.info("Requesting tokens from faucet...");
    await new FaucetClient(env.faucet, logger).requestTokens(unshieldedAddress.toString());
  }

  const initialBalance = initialState.balances[tokenType.raw];
  if (initialBalance === undefined || initialBalance === 0n) {
    logger.info("Wallet balance is 0, waiting to receive tokens (this can take a few minutes)...");
    return Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(throttleTime),
        Rx.filter(
          (state) => isFacadeStateSynced(state) && (state.unshielded.balances[tokenType.raw] ?? 0n) > 0n,
        ),
        Rx.tap(() => logger.info("Funds received.")),
        Rx.map((state) => state.unshielded),
      ),
    );
  }
  return initialState;
};
