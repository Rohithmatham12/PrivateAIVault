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

function renderLedger(ledger) {
  $("ledgerGrid").innerHTML = `
    <div class="ledger-item"><span class="k">State</span><span class="v">${ledger.state}</span></div>
    <div class="ledger-item"><span class="k">Redacted spans</span><span class="v">${ledger.redactedSpanCount}</span></div>
    <div class="ledger-item"><span class="k">Commitment</span><span class="v">${ledger.commitment || "none"}</span></div>
    <div class="ledger-item"><span class="k">Owner (pubkey)</span><span class="v">${ledger.owner}</span></div>
  `;
}

async function refreshState() {
  const res = await fetch("/api/state");
  const ledger = await res.json();
  $("step3").hidden = false;
  renderLedger(ledger);
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
    const { ledger } = await post("/api/commit", {
      commitment: lastCommitment,
      spanCount: lastSpanCount,
    });
    $("step3").hidden = false;
    renderLedger(ledger);
    $("commitSuccess").textContent =
      "Committed. This is a real execution of the compiled Compact circuit. The raw record above was never sent.";
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
    const { matches } = await post("/api/verify", { candidateText });
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
