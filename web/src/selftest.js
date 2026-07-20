// Headless self-test: exercises the real browser bundle (WASM circuit +
// regex redaction + SubtleCrypto hashing) with no user interaction, and
// writes PASS/FAIL to document.title so a headless-Chrome `--dump-dom`
// run can verify it without a UI driver. Not shipped in index.html.
import { processRecord, sha256Hex } from "./redact-core.js";
import { ContractSession, randomBytes32, hexToBytes } from "./contract-session.js";

async function run() {
  const results = [];
  const check = (name, cond) => results.push(`${cond ? "PASS" : "FAIL"}:${name}`);

  const rawA = "Patient: Jane Doe, SSN 219-09-9999, contact jane.doe@example.com";
  const { redacted, commitment, spanCount, method } = await processRecord(rawA, null);
  check("redaction-removed-name", !redacted.includes("Jane Doe"));
  check("redaction-removed-ssn", !redacted.includes("219-09-9999"));
  check("method-is-regex-fallback", method === "regex-fallback");
  check("span-count-positive", spanCount > 0);

  const session = new ContractSession(randomBytes32());
  check("starts-with-zero-records", session.getRecordCount() === 0n);

  const recordIdA = hexToBytes(commitment);
  const recordA = session.commitRecord(recordIdA, recordIdA, spanCount);
  check("record-count-is-one", session.getRecordCount() === 1n);
  check("commitment-matches", recordA.commitment === `0x${commitment}`);

  const committedJson = JSON.stringify(recordA);
  check("no-raw-data-in-committed-record", !committedJson.includes("Jane") && !committedJson.includes("219-09-9999"));

  const matchHash = hexToBytes(await sha256Hex(rawA));
  check("verify-true-on-original", session.verifyMatchesCommitment(recordIdA, matchHash));

  const noMatchHash = hexToBytes(await sha256Hex("something else entirely"));
  check("verify-false-on-tampered", session.verifyMatchesCommitment(recordIdA, noMatchHash) === false);

  check("threshold-proof-passes-below-count", session.proveRedactionThreshold(recordIdA, spanCount) === true);
  check("threshold-proof-fails-above-count", session.proveRedactionThreshold(recordIdA, spanCount + 10) === false);

  // A second, independent record on the same deployed contract instance.
  const rawB = "Contact: bob@example.com, phone 555-1234";
  const { commitment: commitmentB, spanCount: spanCountB } = await processRecord(rawB, null);
  const recordIdB = hexToBytes(commitmentB);
  session.commitRecord(recordIdB, recordIdB, spanCountB);
  check("record-count-is-two", session.getRecordCount() === 2n);
  check("first-record-still-intact", session.getRecord(recordIdA).commitment === `0x${commitment}`);

  const allPass = results.every((r) => r.startsWith("PASS"));
  document.title = (allPass ? "SELFTEST_PASS " : "SELFTEST_FAIL ") + results.join(",");
}

run().catch((err) => {
  document.title = "SELFTEST_FAIL error:" + err.message;
});
