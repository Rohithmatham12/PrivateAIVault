// Headless self-test: exercises the real browser bundle (WASM circuit +
// regex redaction + SubtleCrypto hashing) with no user interaction, and
// writes PASS/FAIL to document.title so a headless-Chrome `--dump-dom`
// run can verify it without a UI driver. Not shipped in index.html.
import { processRecord, sha256Hex } from "./redact-core.js";
import { ContractSession, randomBytes32, hexToBytes, serializeLedger } from "./contract-session.js";

async function run() {
  const results = [];
  const check = (name, cond) => results.push(`${cond ? "PASS" : "FAIL"}:${name}`);

  const raw = "Patient: Jane Doe, SSN 219-09-9999, contact jane.doe@example.com";
  const { redacted, commitment, spanCount, method } = await processRecord(raw, null);
  check("redaction-removed-name", !redacted.includes("Jane Doe"));
  check("redaction-removed-ssn", !redacted.includes("219-09-9999"));
  check("method-is-regex-fallback", method === "regex-fallback");
  check("span-count-positive", spanCount > 0);

  const session = new ContractSession(randomBytes32());
  const emptyLedger = serializeLedger(session.getLedger());
  check("starts-empty", emptyLedger.state === "EMPTY");

  const ledgerJson = JSON.stringify(emptyLedger);
  check("no-name-in-empty-ledger", !ledgerJson.includes("Jane"));

  const afterCommit = serializeLedger(session.commitRecord(hexToBytes(commitment), BigInt(spanCount)));
  check("state-committed", afterCommit.state === "COMMITTED");
  check("commitment-matches", afterCommit.commitment === `0x${commitment}`);

  const committedJson = JSON.stringify(afterCommit);
  check("no-raw-data-in-committed-ledger", !committedJson.includes("Jane") && !committedJson.includes("219-09-9999"));

  const matchHash = hexToBytes(await sha256Hex(raw));
  check("verify-true-on-original", session.verifyMatchesCommitment(matchHash));

  const noMatchHash = hexToBytes(await sha256Hex("something else entirely"));
  check("verify-false-on-tampered", session.verifyMatchesCommitment(noMatchHash) === false);

  const allPass = results.every((r) => r.startsWith("PASS"));
  document.title = (allPass ? "SELFTEST_PASS " : "SELFTEST_FAIL ") + results.join(",");
}

run().catch((err) => {
  document.title = "SELFTEST_FAIL error:" + err.message;
});
