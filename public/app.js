const $ = (id) => document.getElementById(id);

let lastCommitment = null;
let lastSpanCount = null;

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "request failed");
  return json;
}

function renderLedger(recordId, record, recordCount) {
  $("ledgerGrid").innerHTML = `
    <div class="ledger-item"><span class="k">Record id</span><span class="v">0x${recordId}</span></div>
    <div class="ledger-item"><span class="k">Total records on this contract</span><span class="v">${recordCount}</span></div>
    <div class="ledger-item"><span class="k">Commitment</span><span class="v">${record.commitment}</span></div>
    <div class="ledger-item"><span class="k">Owner (pubkey)</span><span class="v">${record.owner}</span></div>
  `;
}

async function refreshState() {
  await fetch("/api/state");
}

$("redactBtn").addEventListener("click", async () => {
  const rawText = $("rawText").value.trim();
  if (!rawText) return;
  $("redactBtn").disabled = true;
  $("redactBtn").textContent = "Redacting...";
  try {
    const { redacted, method, spanCount, commitment } = await post("/api/redact", { rawText });
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

$("commitBtn").addEventListener("click", async () => {
  if (!lastCommitment) return;
  $("commitBtn").disabled = true;
  $("commitBtn").textContent = "Committing...";
  try {
    const { recordId, record, recordCount } = await post("/api/commit", {
      commitment: lastCommitment,
      spanCount: lastSpanCount,
    });
    $("step3").hidden = false;
    renderLedger(recordId, record, recordCount);
    $("commitSuccess").textContent =
      "Committed as a new record. This is a real execution of the compiled Compact circuit. The raw record above was never sent.";
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
    const { matches } = await post("/api/verify", { recordId: lastCommitment, candidateText });
    $("verifyResult").innerHTML = matches
      ? '<span class="match-true">✓ Matches the on-chain commitment</span>'
      : '<span class="match-false">✗ Does not match the on-chain commitment</span>';
  } catch (err) {
    $("verifyResult").innerHTML = `<span class="match-false">${err.message}</span>`;
  } finally {
    $("verifyBtn").disabled = false;
  }
});

$("thresholdBtn").addEventListener("click", async () => {
  const threshold = parseInt($("thresholdInput").value, 10);
  if (!lastCommitment || Number.isNaN(threshold)) {
    $("thresholdResult").innerHTML = '<span class="match-false">Redact and commit a record above first.</span>';
    return;
  }
  $("thresholdBtn").disabled = true;
  try {
    const { meetsThreshold } = await post("/api/prove-threshold", { recordId: lastCommitment, threshold });
    $("thresholdResult").innerHTML = meetsThreshold
      ? `<span class="match-true">✓ Proven: at least ${threshold} spans were redacted (exact count stays private)</span>`
      : `<span class="match-false">✗ Cannot prove: fewer than ${threshold} spans were redacted</span>`;
  } catch (err) {
    $("thresholdResult").innerHTML = `<span class="match-false">${err.message}</span>`;
  } finally {
    $("thresholdBtn").disabled = false;
  }
});

refreshState();
