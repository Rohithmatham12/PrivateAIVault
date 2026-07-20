// SPDX-License-Identifier: Apache-2.0
// Browser port of ../../server.mjs's ContractSession / ../../contract/src/test/bboard-simulator.ts.
// Runs the REAL compiled Compact circuit (commitRecord / verifyMatchesCommitment /
// proveRedactionThreshold) entirely client-side via @midnight-ntwrk/compact-runtime's
// WASM build. No network, no proof server, no Docker -- this is local circuit
// execution, the same simulator pattern the contract's own test suite runs against.

import {
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger } from "./managed/bboard/contract/index.js";
import { witnesses, withSpanCount } from "./managed/witnesses.js";

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class ContractSession {
  constructor(secretKey) {
    this.contract = new Contract(witnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(createConstructorContext({ secretKey, spanCounts: {} }, "0".repeat(64)));
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
  }

  getRecordCount() {
    return ledger(this.circuitContext.currentQueryContext.state).recordCount;
  }

  getRecord(recordId) {
    const l = ledger(this.circuitContext.currentQueryContext.state);
    if (!l.commitmentOf.member(recordId)) return null;
    return {
      commitment: `0x${bytesToHex(l.commitmentOf.lookup(recordId))}`,
      owner: `0x${bytesToHex(l.ownerOf.lookup(recordId))}`,
    };
  }

  commitRecord(recordId, secretDataHash, spanCount) {
    this.circuitContext = this.contract.impureCircuits.commitRecord(
      this.circuitContext,
      recordId,
      secretDataHash,
    ).context;
    this.circuitContext = {
      ...this.circuitContext,
      currentPrivateState: withSpanCount(this.circuitContext.currentPrivateState, bytesToHex(recordId), spanCount),
    };
    return this.getRecord(recordId);
  }

  verifyMatchesCommitment(recordId, candidateHash) {
    return this.contract.impureCircuits.verifyMatchesCommitment(
      this.circuitContext,
      recordId,
      candidateHash,
    ).result;
  }

  proveRedactionThreshold(recordId, threshold) {
    return this.contract.impureCircuits.proveRedactionThreshold(
      this.circuitContext,
      recordId,
      BigInt(threshold),
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

export { bytesToHex };
