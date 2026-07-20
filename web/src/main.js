// SPDX-License-Identifier: Apache-2.0
// Browser entry point. Same UI flow as ../../public/app.js, but every
// step runs locally in this tab -- AI redaction call to Groq (optional),
// SHA-256 commitment via SubtleCrypto, and the actual compiled Compact
// circuit via WASM. No server, no Docker, no live network required.

import { processRecord, sha256Hex } from "./redact-core.js";
import { ContractSession, randomBytes32, hexToBytes } from "./contract-session.js";

const $ = (id) => document.getElementById(id);

const session = new ContractSession(randomBytes32());
let lastCommitment = null;
let lastSpanCount = null;

function renderLedger(recordId, record, recordCount) {
  $("ledgerGrid").innerHTML = `
    <div class="ledger-item"><span class="k">Record id</span><span class="v">0x${recordId}</span></div>
    <div class="ledger-item"><span class="k">Total records on this contract</span><span class="v">${recordCount}</span></div>
    <div class="ledger-item"><span class="k">Commitment</span><span class="v">${record.commitment}</span></div>
    <div class="ledger-item"><span class="k">Owner (pubkey)</span><span class="v">${record.owner}</span></div>
  `;
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
    const recordId = hexToBytes(lastCommitment);
    const record = session.commitRecord(recordId, recordId, lastSpanCount);
    $("step3").hidden = false;
    renderLedger(lastCommitment, record, session.getRecordCount().toString());
    $("commitSuccess").textContent =
      "Committed as a new record. This is a real execution of the compiled Compact circuit, running in this browser tab. The raw record above was never sent anywhere.";
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
  if (!lastCommitment) {
    $("verifyResult").innerHTML = '<span class="match-false">Redact and commit a record above first.</span>';
    return;
  }
  $("verifyBtn").disabled = true;
  try {
    const candidateHash = hexToBytes(await sha256Hex(candidateText));
    const matches = session.verifyMatchesCommitment(hexToBytes(lastCommitment), candidateHash);
    $("verifyResult").innerHTML = matches
      ? '<span class="match-true">✓ Matches the on-chain commitment</span>'
      : '<span class="match-false">✗ Does not match the on-chain commitment</span>';
  } catch (err) {
    $("verifyResult").innerHTML = `<span class="match-false">${err.message}</span>`;
  } finally {
    $("verifyBtn").disabled = false;
  }
});

$("thresholdBtn").addEventListener("click", () => {
  const threshold = parseInt($("thresholdInput").value, 10);
  if (!lastCommitment || Number.isNaN(threshold)) {
    $("thresholdResult").innerHTML = '<span class="match-false">Redact and commit a record above first.</span>';
    return;
  }
  $("thresholdBtn").disabled = true;
  try {
    const meetsThreshold = session.proveRedactionThreshold(hexToBytes(lastCommitment), threshold);
    $("thresholdResult").innerHTML = meetsThreshold
      ? `<span class="match-true">✓ Proven: at least ${threshold} spans were redacted (exact count stays private)</span>`
      : `<span class="match-false">✗ Cannot prove: fewer than ${threshold} spans were redacted</span>`;
  } catch (err) {
    $("thresholdResult").innerHTML = `<span class="match-false">${err.message}</span>`;
  } finally {
    $("thresholdBtn").disabled = false;
  }
});

$("onchainEnableBtn").addEventListener("click", async () => {
  $("onchainEnableBtn").disabled = true;
  $("onchainEnableBtn").textContent = "Loading...";
  try {
    const { mountOnchainUI } = await import("./onchain-ui.js");
    $("onchainEnableBtn").hidden = true;
    mountOnchainUI($("onchainBody"), {
      getLastCommitment: () => lastCommitment,
      getLastSpanCount: () => lastSpanCount,
    });
  } catch (err) {
    $("onchainEnableBtn").disabled = false;
    $("onchainEnableBtn").textContent = "Enable on-chain mode →";
    alert(err.message);
  }
});
