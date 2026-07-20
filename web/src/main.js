// SPDX-License-Identifier: Apache-2.0
// Browser entry point. Same UI flow as ../../public/app.js, but every
// step runs locally in this tab -- AI redaction call to Groq (optional),
// SHA-256 commitment via SubtleCrypto, and the actual compiled Compact
// circuit via WASM. No server, no Docker, no live network required.

import { processRecord, sha256Hex } from "./redact-core.js";
import { ContractSession, randomBytes32, hexToBytes, serializeLedger } from "./contract-session.js";

const $ = (id) => document.getElementById(id);

const session = new ContractSession(randomBytes32());
let lastCommitment = null;
let lastSpanCount = null;

function renderLedger(ledger) {
  $("ledgerGrid").innerHTML = `
    <div class="ledger-item"><span class="k">State</span><span class="v">${ledger.state}</span></div>
    <div class="ledger-item"><span class="k">Redacted spans</span><span class="v">${ledger.redactedSpanCount}</span></div>
    <div class="ledger-item"><span class="k">Commitment</span><span class="v">${ledger.commitment || "none"}</span></div>
    <div class="ledger-item"><span class="k">Owner (pubkey)</span><span class="v">${ledger.owner}</span></div>
  `;
}

function refreshState() {
  $("step3").hidden = false;
  renderLedger(serializeLedger(session.getLedger()));
}

$("redactBtn").addEventListener("click", async () => {
  const rawText = $("rawText").value.trim();
  if (!rawText) return;
  $("redactBtn").disabled = true;
  $("redactBtn").textContent = "Redacting...";
  try {
    const apiKey = $("groqKey").value.trim();
    const { redacted, method, spanCount, commitment } = await processRecord(rawText, apiKey || null);
    lastCommitment = commitment;
    lastSpanCount = spanCount;
    $("methodLabel").textContent = `Redaction method: ${method}`;
    $("redactedOutput").textContent = redacted;
    $("commitmentHex").textContent = `0x${commitment}`;
    $("step2").hidden = false;
    $("step2").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    alert(err.message);
  } finally {
    $("redactBtn").disabled = false;
    $("redactBtn").textContent = "Redact with AI →";
  }
});

$("commitBtn").addEventListener("click", () => {
  if (!lastCommitment) return;
  $("commitBtn").disabled = true;
  $("commitBtn").textContent = "Committing...";
  try {
    const ledger = session.commitRecord(hexToBytes(lastCommitment), BigInt(lastSpanCount));
    $("step3").hidden = false;
    renderLedger(serializeLedger(ledger));
    $("commitSuccess").textContent =
      "Committed. This is a real execution of the compiled Compact circuit, running in this browser tab. The raw record above was never sent anywhere.";
    $("step3").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    $("commitSuccess").textContent = "";
    alert(err.message);
  } finally {
    $("commitBtn").disabled = false;
    $("commitBtn").textContent = "Commit to Midnight contract →";
  }
});

$("verifyBtn").addEventListener("click", async () => {
  const candidateText = $("candidateText").value.trim();
  if (!candidateText) return;
  $("verifyBtn").disabled = true;
  try {
    const candidateHash = hexToBytes(await sha256Hex(candidateText));
    const matches = session.verifyMatchesCommitment(candidateHash);
    $("verifyResult").innerHTML = matches
      ? '<span class="match-true">✓ Matches the on-chain commitment</span>'
      : '<span class="match-false">✗ Does not match the on-chain commitment</span>';
  } catch (err) {
    $("verifyResult").innerHTML = `<span class="match-false">${err.message}</span>`;
  } finally {
    $("verifyBtn").disabled = false;
  }
});

refreshState();
