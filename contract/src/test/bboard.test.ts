// SPDX-License-Identifier: Apache-2.0
// PrivateAIVault -- end-to-end tests: AI redaction (see redact.mjs at
// the repo root) hands this test a raw sensitive record and its
// SHA-256 commitment. This test proves the Compact circuit commits and
// verifies that commitment correctly, and that the raw record is never
// part of the ledger state.

import { BBoardSimulator } from "./bboard-simulator.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { describe, it, expect } from "vitest";
import { randomBytes } from "./utils.js";
import { RecordState } from "../managed/bboard/contract/index.js";
import { createHash } from "node:crypto";

setNetworkId("undeployed");

const sha256 = (text: string): Uint8Array =>
  new Uint8Array(createHash("sha256").update(text, "utf8").digest());

describe("PrivateAIVault smart contract", () => {
  it("starts empty with no commitment", () => {
    const simulator = new BBoardSimulator(randomBytes(32));
    const ledgerState = simulator.getLedger();
    expect(ledgerState.state).toEqual(RecordState.EMPTY);
    expect(ledgerState.commitment.is_some).toEqual(false);
    expect(ledgerState.redactedSpanCount).toEqual(0n);
  });

  it("commits a hash of a sensitive record without ever storing the record itself", () => {
    const simulator = new BBoardSimulator(randomBytes(32));

    // This is the RAW sensitive record. It is used ONLY to compute a
    // local SHA-256 commitment; it is never passed to the contract.
    const rawRecord =
      "Patient: Jane Doe, DOB 1990-04-12, SSN 219-09-9999, diagnosed with condition X on 2026-06-01.";
    const commitment = sha256(rawRecord);

    const ledgerState = simulator.commitRecord(commitment, 4n);

    expect(ledgerState.state).toEqual(RecordState.COMMITTED);
    expect(ledgerState.commitment.is_some).toEqual(true);
    expect(ledgerState.commitment.value).toEqual(commitment);
    expect(ledgerState.redactedSpanCount).toEqual(4n);

    // The raw record string appears nowhere in the public ledger state.
    const serializedLedger = JSON.stringify(
      ledgerState,
      (_key, value) =>
        value instanceof Uint8Array
          ? Buffer.from(value).toString("hex")
          : typeof value === "bigint"
            ? value.toString()
            : value,
    );
    expect(serializedLedger).not.toContain("Jane Doe");
    expect(serializedLedger).not.toContain("219-09-9999");
  });

  it("verifies a matching candidate against the commitment", () => {
    const simulator = new BBoardSimulator(randomBytes(32));
    const rawRecord = "Contact: john.smith@example.com, phone 555-0142.";
    simulator.commitRecord(sha256(rawRecord), 2n);

    // Anyone who independently holds the true original can prove a
    // match without ever revealing it to a third party.
    const matches = simulator.verifyMatchesCommitment(sha256(rawRecord));
    expect(matches).toEqual(true);
  });

  it("rejects a candidate that does not match the commitment", () => {
    const simulator = new BBoardSimulator(randomBytes(32));
    simulator.commitRecord(sha256("the real sensitive record"), 1n);

    const matches = simulator.verifyMatchesCommitment(
      sha256("a forged or incorrect record"),
    );
    expect(matches).toEqual(false);
  });

  it("doesn't let a second record be committed once one exists", () => {
    const simulator = new BBoardSimulator(randomBytes(32));
    simulator.commitRecord(sha256("first record"), 1n);
    expect(() => simulator.commitRecord(sha256("second record"), 1n)).toThrow(
      "failed assert: A record is already committed",
    );
  });

  it("won't verify before any record has been committed", () => {
    const simulator = new BBoardSimulator(randomBytes(32));
    expect(() =>
      simulator.verifyMatchesCommitment(sha256("anything")),
    ).toThrow("failed assert: No record committed yet");
  });
});
