#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// PrivateAIVault -- off-chain AI redaction step (CLI).
//
// Takes a raw sensitive record, asks an LLM to find and redact
// sensitive spans, and prints a redacted version plus the SHA-256
// commitment of the RAW record -- the only value ever passed to the
// Midnight contract's commitRecord circuit. See lib/redact-core.mjs
// for the shared implementation (also used by the web UI in server.mjs).
//
// Usage:
//   node --env-file=.env redact.mjs "Patient: Jane Doe, SSN 219-09-9999..."
//   node redact.mjs                 # uses the built-in sample record, regex fallback

import { processRecord } from "./lib/redact-core.mjs";

const sampleRecord =
  "Patient: Jane Doe, DOB 1990-04-12, SSN 219-09-9999, " +
  "contact jane.doe@example.com or 555-0142, diagnosed with condition X on 2026-06-01.";

const rawRecord = process.argv.slice(2).join(" ").trim() || sampleRecord;

async function main() {
  console.log("=== PrivateAIVault: off-chain AI redaction ===\n");
  console.log("Raw record (local only, never sent to Midnight):");
  console.log(`  "${rawRecord}"\n`);

  const { redacted, method, spanCount, commitment } = await processRecord(
    rawRecord,
    process.env.GROQ_API_KEY,
  );

  console.log(`Redaction method: ${method}`);
  console.log("Redacted record (safe to display):");
  console.log(`  "${redacted}"\n`);
  console.log(`Redacted span count (safe to disclose on-chain): ${spanCount}`);
  console.log(`SHA-256 commitment (the ONLY thing passed to the Midnight`);
  console.log(`contract's commitRecord circuit):`);
  console.log(`  0x${commitment}\n`);
  console.log("Next step: contract.commitRecord(commitment, spanCount)");
  console.log("Try the live UI instead: npm run ui");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
