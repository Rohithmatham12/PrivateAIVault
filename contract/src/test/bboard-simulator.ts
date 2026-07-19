// SPDX-License-Identifier: Apache-2.0
// Local circuit simulator for PrivateAIVault -- lets the demo exercise
// real Compact circuit execution (real ZK witness/disclose semantics)
// without needing a live Midnight node, proof server, or wallet.

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger,
} from "../managed/bboard/contract/index.js";
import { type BBoardPrivateState, witnesses } from "../witnesses.js";

export class BBoardSimulator {
  readonly contract: Contract<BBoardPrivateState>;
  circuitContext: CircuitContext<BBoardPrivateState>;

  constructor(secretKey: Uint8Array) {
    this.contract = new Contract<BBoardPrivateState>(witnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext({ secretKey }, "0".repeat(64)),
      );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  /** Commit a pre-hashed sensitive record. The raw text never appears here. */
  public commitRecord(secretDataHash: Uint8Array, spanCount: bigint): Ledger {
    this.circuitContext = this.contract.impureCircuits.commitRecord(
      this.circuitContext,
      secretDataHash,
      spanCount,
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  /** Returns true iff candidateHash matches the on-chain commitment. */
  public verifyMatchesCommitment(candidateHash: Uint8Array): boolean {
    return this.contract.impureCircuits.verifyMatchesCommitment(
      this.circuitContext,
      candidateHash,
    ).result;
  }
}
