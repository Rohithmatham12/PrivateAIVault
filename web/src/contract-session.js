// SPDX-License-Identifier: Apache-2.0
// Browser port of ../../server.mjs's ContractSession / ../../contract/src/test/bboard-simulator.ts.
// Runs the REAL compiled Compact circuit (commitRecord / verifyMatchesCommitment)
// entirely client-side via @midnight-ntwrk/compact-runtime's WASM build.
// No network, no proof server, no Docker -- this is local circuit execution,
// the same simulator pattern the contract's own test suite runs against.

import {
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, RecordState } from "./managed/bboard/contract/index.js";
import { witnesses } from "./managed/witnesses.js";

export { RecordState };

export class ContractSession {
  constructor(secretKey) {
    this.contract = new Contract(witnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(createConstructorContext({ secretKey }, "0".repeat(64)));
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
  }

  getLedger() {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  commitRecord(secretDataHash, spanCount) {
    this.circuitContext = this.contract.impureCircuits.commitRecord(
      this.circuitContext,
      secretDataHash,
      spanCount,
    ).context;
    return this.getLedger();
  }

  verifyMatchesCommitment(candidateHash) {
    return this.contract.impureCircuits.verifyMatchesCommitment(
      this.circuitContext,
      candidateHash,
    ).result;
  }
}

export function randomBytes32() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function hexToBytes(hex) {
  const clean = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  return bytes;
}

export function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function serializeLedger(l) {
  return {
    state: l.state === RecordState.EMPTY ? "EMPTY" : "COMMITTED",
    commitment: l.commitment.is_some ? `0x${bytesToHex(l.commitment.value)}` : null,
    redactedSpanCount: l.redactedSpanCount.toString(),
    owner: `0x${bytesToHex(l.owner)}`,
  };
}
