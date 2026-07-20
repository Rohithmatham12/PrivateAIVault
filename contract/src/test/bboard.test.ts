// SPDX-License-Identifier: Apache-2.0
// PrivateAIVault -- end-to-end tests: AI redaction (see redact.mjs at
// the repo root) hands this test a raw sensitive record and its
// SHA-256 commitment. This test proves the Compact circuit commits and
// verifies that commitment correctly, that one contract holds many
// independent records, that the raw record is never part of the ledger
// state, and that a redaction-threshold property can be proven without
// disclosing the exact redaction count.

import { BBoardSimulator } from "./bboard-simulator.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { describe, it, expect } from "vitest";
import { randomBytes } from "./utils.js";
import { createHash } from "node:crypto";

setNetworkId("undeployed");

const sha256 = (text: string): Uint8Array =>
  new Uint8Array(createHash("sha256").update(text, "utf8").digest());

describe("PrivateAIVault smart contract", () => {
  it("starts with no records committed", () => {
    const simulator = new BBoardSimulator(randomBytes(32));
    const ledgerState = simulator.getLedger();
    expect(ledgerState.recordCount).toEqual(0n);
  });

  it("commits a hash of a sensitive record without ever storing the record itself", () => {
    const simulator = new BBoardSimulator(randomBytes(32));

    // This is the RAW sensitive record. It is used ONLY to compute a
    // local SHA-256 commitment; it is never passed to the contract.
    const rawRecord =
      "Patient: Jane Doe, DOB 1990-04-12, SSN 219-09-9999, diagnosed with condition X on 2026-06-01.";
    const recordId = sha256("record:1");
    const commitment = sha256(rawRecord);

    const ledgerState = simulator.commitRecord(recordId, commitment, 4);

    expect(ledgerState.recordCount).toEqual(1n);
    expect(ledgerState.commitmentOf.member(recordId)).toEqual(true);
    expect(ledgerState.commitmentOf.lookup(recordId)).toEqual(commitment);

    // The raw record string, and the redaction count, appear nowhere in
    // the public ledger state.
    const serializedLedger = JSON.stringify(
      commitment,
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

  it("holds many independent records in one deployed contract", () => {
    const simulator = new BBoardSimulator(randomBytes(32));
    const idA = sha256("record:a");
    const idB = sha256("record:b");
    const commitmentA = sha256("first sensitive record");
    const commitmentB = sha256("second, entirely different sensitive record");

    simulator.commitRecord(idA, commitmentA, 2);
    const ledgerState = simulator.commitRecord(idB, commitmentB, 5);

    expect(ledgerState.recordCount).toEqual(2n);
    expect(ledgerState.commitmentOf.lookup(idA)).toEqual(commitmentA);
    expect(ledgerState.commitmentOf.lookup(idB)).toEqual(commitmentB);
  });

  it("verifies a matching candidate against the commitment for a given record", () => {
    const simulator = new BBoardSimulator(randomBytes(32));
    const recordId = sha256("record:1");
    const rawRecord = "Contact: john.smith@example.com, phone 555-0142.";
    simulator.commitRecord(recordId, sha256(rawRecord), 2);

    // Anyone who independently holds the true original can prove a
    // match without ever revealing it to a third party.
    const matches = simulator.verifyMatchesCommitment(recordId, sha256(rawRecord));
    expect(matches).toEqual(true);
  });

  it("rejects a candidate that does not match the commitment", () => {
    const simulator = new BBoardSimulator(randomBytes(32));
    const recordId = sha256("record:1");
    simulator.commitRecord(recordId, sha256("the real sensitive record"), 1);

    const matches = simulator.verifyMatchesCommitment(recordId, sha256("a forged or incorrect record"));
    expect(matches).toEqual(false);
  });

  it("doesn't let the same record id be committed twice", () => {
    const simulator = new BBoardSimulator(randomBytes(32));
    const recordId = sha256("record:1");
    simulator.commitRecord(recordId, sha256("first version"), 1);
    expect(() => simulator.commitRecord(recordId, sha256("second version"), 1)).toThrow(
      "failed assert: A record with this id is already committed",
    );
  });

  it("won't verify a record id that was never committed", () => {
    const simulator = new BBoardSimulator(randomBytes(32));
    expect(() => simulator.verifyMatchesCommitment(sha256("nonexistent"), sha256("anything"))).toThrow(
      "failed assert: No record committed with this id",
    );
  });

  it("proves a redaction-count threshold without disclosing the exact count", () => {
    const simulator = new BBoardSimulator(randomBytes(32));
    const recordId = sha256("record:1");
    simulator.commitRecord(recordId, sha256("a record with several redactions"), 5);

    expect(simulator.proveRedactionThreshold(recordId, 3)).toEqual(true);
    expect(simulator.proveRedactionThreshold(recordId, 5)).toEqual(true);
    expect(simulator.proveRedactionThreshold(recordId, 6)).toEqual(false);
  });

  it("can't prove a threshold for a record id that was never committed", () => {
    const simulator = new BBoardSimulator(randomBytes(32));
    expect(() => simulator.proveRedactionThreshold(sha256("nonexistent"), 1)).toThrow(
      "failed assert: No record committed with this id",
    );
  });
});
