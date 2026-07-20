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
import { type BBoardPrivateState, witnesses, withSpanCount } from "../witnesses.js";

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

export class BBoardSimulator {
  readonly contract: Contract<BBoardPrivateState>;
  circuitContext: CircuitContext<BBoardPrivateState>;

  constructor(secretKey: Uint8Array) {
    this.contract = new Contract<BBoardPrivateState>(witnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext({ secretKey, spanCounts: {} }, "0".repeat(64)),
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

  /**
   * Commit a pre-hashed sensitive record under recordId. The raw text
   * never appears here, and spanCount never touches the ledger -- it's
   * only remembered in local private state, for later threshold proofs.
   */
  public commitRecord(recordId: Uint8Array, secretDataHash: Uint8Array, spanCount: number): Ledger {
    this.circuitContext = this.contract.impureCircuits.commitRecord(
      this.circuitContext,
      recordId,
      secretDataHash,
    ).context;
    this.circuitContext = {
      ...this.circuitContext,
      currentPrivateState: withSpanCount(this.circuitContext.currentPrivateState, toHex(recordId), spanCount),
    };
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  /** Returns true iff candidateHash matches the on-chain commitment for recordId. */
  public verifyMatchesCommitment(recordId: Uint8Array, candidateHash: Uint8Array): boolean {
    return this.contract.impureCircuits.verifyMatchesCommitment(
      this.circuitContext,
      recordId,
      candidateHash,
    ).result;
  }

  /**
   * Proves the record's redacted span count is at least threshold,
   * without revealing the exact count. Only works for records whose
   * span count is known in this simulator's local private state
   * (i.e. ones committed through this same instance).
   */
  public proveRedactionThreshold(recordId: Uint8Array, threshold: number): boolean {
    return this.contract.impureCircuits.proveRedactionThreshold(
      this.circuitContext,
      recordId,
      BigInt(threshold),
    ).result;
  }
}
