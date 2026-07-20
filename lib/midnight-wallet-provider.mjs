// SPDX-License-Identifier: Apache-2.0
// Adapted from midnightntwrk/example-bboard (bboard-cli/src/midnight-wallet-provider.ts).

import { DustSecretKey, LedgerParameters, ZswapSecretKeys } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { ttlOneHour } from "@midnight-ntwrk/midnight-js-utils";
import { FluentWalletBuilder } from "@midnight-ntwrk/testkit-js";
import { getInitialShieldedState } from "./wallet-utils.mjs";

export class MidnightWalletProvider {
  constructor(logger, env, wallet, zswapSecretKeys, dustSecretKey, unshieldedKeystore) {
    this.logger = logger;
    this.env = env;
    this.wallet = wallet;
    this.zswapSecretKeys = zswapSecretKeys;
    this.dustSecretKey = dustSecretKey;
    this.unshieldedKeystore = unshieldedKeystore;
  }

  getCoinPublicKey() {
    return this.zswapSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey() {
    return this.zswapSecretKeys.encryptionPublicKey;
  }

  async balanceTx(tx, ttl = ttlOneHour()) {
    const recipe = await this.wallet.balanceUnboundTransaction(
      tx,
      { shieldedSecretKeys: this.zswapSecretKeys, dustSecretKey: this.dustSecretKey },
      { ttl },
    );
    const signedRecipe = await this.wallet.signRecipe(recipe, (payload) =>
      this.unshieldedKeystore.signData(payload),
    );
    return this.wallet.finalizeRecipe(signedRecipe);
  }

  submitTx(tx) {
    return this.wallet.submitTransaction(tx);
  }

  async start() {
    this.logger.info("Starting wallet...");
    await this.wallet.start(this.zswapSecretKeys, this.dustSecretKey);
  }

  async stop() {
    return this.wallet.stop();
  }

  static async build(logger, env, seed) {
    const dustOptions = {
      ledgerParams: LedgerParameters.initialParameters(),
      additionalFeeOverhead: env.walletNetworkId === "undeployed" ? 500_000_000_000_000_000n : 1_000n,
      feeBlocksMargin: 5,
    };
    const builder = FluentWalletBuilder.forEnvironment(env).withDustOptions(dustOptions);
    const buildResult = seed
      ? await builder.withSeed(seed).buildWithoutStarting()
      : await builder.withRandomSeed().buildWithoutStarting();
    const { wallet, seeds, keystore } = buildResult;

    const initialState = await getInitialShieldedState(logger, wallet.shielded);
    logger.info(
      `Wallet seed: ${seeds.masterSeed}, address: ${initialState.address.coinPublicKeyString()}`,
    );

    return new MidnightWalletProvider(
      logger,
      env,
      wallet,
      ZswapSecretKeys.fromSeed(seeds.shielded),
      DustSecretKey.fromSeed(seeds.dust),
      keystore,
    );
  }
}
