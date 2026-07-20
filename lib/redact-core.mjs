// SPDX-License-Identifier: Apache-2.0
// Shared AI redaction + commitment logic, used by both redact.mjs (CLI)
// and server.mjs (web UI), so there is exactly one implementation.

import { createHash } from "node:crypto";

const GROQ_MODEL = "llama-3.3-70b-versatile";

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function redactWithGroq(text, apiKey) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
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

export function redactWithRegex(text) {
  return text
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN]")
    .replace(/\b\d{3}-\d{4}\b/g, "[PHONE]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[DATE]")
    .replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, "[NAME]");
}

export function countRedactedSpans(redacted) {
  const matches = redacted.match(/\[[A-Z_]+\]/g);
  return matches ? matches.length : 0;
}

/**
 * Runs the full off-chain step: redact the raw text (Groq if an API key
 * is available, regex fallback otherwise) and compute the commitment
 * that is the ONLY thing ever passed on to the Midnight contract.
 */
export async function processRecord(rawText, apiKey) {
  let redacted;
  let method;
  if (apiKey) {
    method = `groq:${GROQ_MODEL}`;
    redacted = await redactWithGroq(rawText, apiKey);
  } else {
    method = "regex-fallback";
    redacted = redactWithRegex(rawText);
  }
  return {
    redacted,
    method,
    spanCount: countRedactedSpans(redacted),
    commitment: sha256Hex(rawText),
  };
}
