// SPDX-License-Identifier: Apache-2.0
// Browser port of ../../lib/redact-core.mjs. Same logic, SubtleCrypto
// instead of node:crypto (browsers have no node:crypto).

const GROQ_MODEL = "llama-3.3-70b-versatile";

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
 * Runs the full client-side step: redact the raw text (Groq if an API key
 * is supplied, regex fallback otherwise) and compute the commitment that
 * is the ONLY thing ever passed on to the Midnight contract.
 */
export async function processRecord(rawText, apiKey) {
  let redacted;
  let method;
  if (apiKey) {
    try {
      redacted = await redactWithGroq(rawText, apiKey);
      method = `groq:${GROQ_MODEL}`;
    } catch (err) {
      // Groq may reject direct browser calls (CORS) depending on account/
      // origin settings. Fall back rather than breaking the demo.
      redacted = redactWithRegex(rawText);
      method = `regex-fallback (groq call failed: ${err.message})`;
    }
  } else {
    method = "regex-fallback";
    redacted = redactWithRegex(rawText);
  }
  return {
    redacted,
    method,
    spanCount: countRedactedSpans(redacted),
    commitment: await sha256Hex(rawText),
  };
}
