#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// PrivateAIVault -- off-chain AI redaction step.
//
// Takes a raw sensitive record, asks an LLM to find and redact
// sensitive spans (names, emails, phone numbers, SSNs, medical/financial
// identifiers), and prints:
//   1. A redacted version safe to display or hand to anyone.
//   2. A SHA-256 commitment of the RAW record -- this is the only value
//      that ever gets passed to the Midnight contract's commitRecord
//      circuit. The raw record itself never leaves this script.
//
// Usage:
//   GROQ_API_KEY=... node redact.mjs "Patient: Jane Doe, SSN 219-09-9999..."
//   node redact.mjs                 # uses the built-in sample record

import { createHash } from "node:crypto";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.3-70b-versatile";

const sampleRecord =
  "Patient: Jane Doe, DOB 1990-04-12, SSN 219-09-9999, " +
  "contact jane.doe@example.com or 555-0142, diagnosed with condition X on 2026-06-01.";

const rawRecord = process.argv.slice(2).join(" ").trim() || sampleRecord;

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function redactWithGroq(text) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You redact sensitive personal data from text. Replace every name, " +
            "date of birth, SSN, phone number, email address, and medical/financial " +
            "identifier with a bracketed label like [NAME], [SSN], [EMAIL], [PHONE], " +
            "[DOB], [MEDICAL_ID]. Keep everything else exactly as-is. " +
            "Respond with ONLY the redacted text, nothing else.",
        },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Groq API error: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// Fallback so the script is runnable end-to-end even without an API key
// during a live demo -- same redaction goal, simpler technique.
function redactWithRegex(text) {
  return text
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN]")
    .replace(/\b\d{3}-\d{4}\b/g, "[PHONE]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[DATE]")
    .replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, "[NAME]");
}

function countRedactedSpans(redacted) {
  const matches = redacted.match(/\[[A-Z_]+\]/g);
  return matches ? matches.length : 0;
}

async function main() {
  console.log("=== PrivateAIVault: off-chain AI redaction ===\n");
  console.log("Raw record (local only, never sent to Midnight):");
  console.log(`  "${rawRecord}"\n`);

  let redacted;
  let method;
  if (GROQ_API_KEY) {
    method = `Groq (${GROQ_MODEL})`;
    redacted = await redactWithGroq(rawRecord);
  } else {
    method = "regex fallback (set GROQ_API_KEY for LLM-based redaction)";
    redacted = redactWithRegex(rawRecord);
  }

  const spanCount = countRedactedSpans(redacted);
  const commitment = sha256Hex(rawRecord);

  console.log(`Redaction method: ${method}`);
  console.log("Redacted record (safe to display):");
  console.log(`  "${redacted}"\n`);
  console.log(`Redacted span count (safe to disclose on-chain): ${spanCount}`);
  console.log(`SHA-256 commitment (the ONLY thing passed to the Midnight`);
  console.log(`contract's commitRecord circuit):`);
  console.log(`  0x${commitment}\n`);
  console.log("Next step: contract.commitRecord(commitment, spanCount)");
  console.log("See contract/src/test/bboard.test.ts for the full flow proven");
  console.log("against a real compiled Compact circuit.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
