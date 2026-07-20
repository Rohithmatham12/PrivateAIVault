// SPDX-License-Identifier: Apache-2.0
// Opt-in real-testnet UI. Loaded on demand from main.js (not on initial page
// load) since it pulls in the full midnight-js-contracts + ledger-wasm stack,
// which is unnecessary weight for anyone just using the local demo.
import { isWalletAvailable } from "./onchain/wallet.js";
import { initializeOnchainProviders } from "./onchain/providers.js";
import { OnchainVault } from "./onchain/vault-api.js";
import { sha256Hex } from "./redact-core.js";
import { hexToBytes } from "./onchain/hex.js";

const NETWORK_ID = "preprod";

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

export function mountOnchainUI(root, { getLastCommitment, getLastSpanCount }) {
  let vault = null;

  root.hidden = false;
  root.innerHTML = "";

  if (!isWalletAvailable()) {
    root.appendChild(
      el(`<p class="hint match-false">No compatible Midnight wallet detected. Install the Lace wallet extension, switch it to Preprod, and reload this page.</p>`),
    );
    return;
  }

  const statusEl = el(`<p class="hint" id="onchainStatus">Connecting to wallet...</p>`);
  const controlsEl = el(`<div id="onchainControls"></div>`);
  const ledgerEl = el(`<div class="ledger-grid" id="onchainLedgerGrid" style="margin-top:0.9rem;"></div>`);
  root.appendChild(statusEl);
  root.appendChild(controlsEl);
  root.appendChild(ledgerEl);

  function renderRecord(recordId, record) {
    ledgerEl.innerHTML = `
      <div class="ledger-item"><span class="k">Record id</span><span class="v">0x${recordId}</span></div>
      <div class="ledger-item"><span class="k">Total records on this contract</span><span class="v">${record.recordCount}</span></div>
      <div class="ledger-item"><span class="k">Commitment</span><span class="v">${record.commitment}</span></div>
      <div class="ledger-item"><span class="k">Owner (pubkey)</span><span class="v">${record.owner}</span></div>
    `;
  }

  function renderDeployControls() {
    controlsEl.innerHTML = "";
    const deployBtn = el(`<button>Deploy a new vault on Preprod →</button>`);
    const joinRow = el(`
      <div class="commitment-row" style="margin-top:0.75rem;">
        <input type="text" id="onchainJoinAddress" placeholder="or paste an existing contract address to join" style="flex:1; background:#0d0f16; color:var(--text); border:1px solid var(--border); border-radius:8px; padding:0.6rem 0.75rem; font-family:ui-monospace,monospace; font-size:0.8rem;" />
        <button id="onchainJoinBtn">Join</button>
      </div>
    `);
    controlsEl.appendChild(deployBtn);
    controlsEl.appendChild(joinRow);

    deployBtn.addEventListener("click", async () => {
      deployBtn.disabled = true;
      deployBtn.textContent = "Deploying (this submits a real transaction, may take up to a minute)...";
      try {
        const { providers } = await initializeOnchainProviders(NETWORK_ID);
        vault = await OnchainVault.deploy(providers);
        statusEl.textContent = `Deployed. Contract address: ${vault.deployedContractAddress}`;
        renderInteractControls();
      } catch (err) {
        statusEl.innerHTML = `<span class="match-false">${err.message}</span>`;
        deployBtn.disabled = false;
        deployBtn.textContent = "Deploy a new vault on Preprod →";
      }
    });

    joinRow.querySelector("#onchainJoinBtn").addEventListener("click", async () => {
      const address = joinRow.querySelector("#onchainJoinAddress").value.trim();
      if (!address) return;
      try {
        const { providers } = await initializeOnchainProviders(NETWORK_ID);
        vault = await OnchainVault.join(providers, address);
        statusEl.textContent = `Joined. Contract address: ${vault.deployedContractAddress}`;
        renderInteractControls();
      } catch (err) {
        statusEl.innerHTML = `<span class="match-false">${err.message}</span>`;
      }
    });
  }

  function renderInteractControls() {
    controlsEl.innerHTML = "";
    const hasLocalCommitment = !!getLastCommitment();
    const commitBtn = el(
      `<button ${hasLocalCommitment ? "" : "disabled"}>${
        hasLocalCommitment ? "Commit the redaction above, on-chain →" : "Redact a record above first"
      }</button>`,
    );
    const verifyRow = el(`
      <div style="margin-top:0.75rem;">
        <textarea id="onchainCandidate" rows="2" placeholder="Paste a candidate original record to verify against the on-chain commitment..."></textarea>
        <button id="onchainVerifyBtn">Verify against on-chain commitment</button>
        <div class="output" id="onchainVerifyResult"></div>
      </div>
    `);
    const thresholdRow = el(`
      <div style="margin-top:0.75rem;">
        <div class="commitment-row">
          <span class="mono-label">At least</span>
          <input type="number" id="onchainThreshold" value="1" min="0" style="width:5rem; background:#0d0f16; color:var(--text); border:1px solid var(--border); border-radius:8px; padding:0.5rem 0.6rem;" />
          <span class="mono-label">redacted spans</span>
        </div>
        <button id="onchainThresholdBtn">Prove threshold on-chain →</button>
        <div class="output" id="onchainThresholdResult"></div>
      </div>
    `);
    controlsEl.appendChild(commitBtn);
    controlsEl.appendChild(verifyRow);
    controlsEl.appendChild(thresholdRow);

    commitBtn.addEventListener("click", async () => {
      commitBtn.disabled = true;
      commitBtn.textContent = "Submitting (real transaction, may take up to a minute)...";
      try {
        const recordId = hexToBytes(getLastCommitment());
        const { txHash } = await vault.commitRecord(recordId, recordId, getLastSpanCount());
        statusEl.textContent = `Committed on-chain. Transaction: ${txHash}`;
        renderRecord(getLastCommitment(), await vault.getRecord(recordId));
      } catch (err) {
        statusEl.innerHTML = `<span class="match-false">${err.message}</span>`;
      } finally {
        commitBtn.disabled = false;
        commitBtn.textContent = "Commit the redaction above, on-chain →";
      }
    });

    verifyRow.querySelector("#onchainVerifyBtn").addEventListener("click", async () => {
      const candidateText = verifyRow.querySelector("#onchainCandidate").value.trim();
      const resultEl = verifyRow.querySelector("#onchainVerifyResult");
      if (!candidateText || !getLastCommitment()) return;
      try {
        const recordId = hexToBytes(getLastCommitment());
        const candidateHash = hexToBytes(await sha256Hex(candidateText));
        const matches = await vault.verifyMatchesCommitment(recordId, candidateHash);
        resultEl.innerHTML = matches
          ? '<span class="match-true">✓ Matches the on-chain commitment</span>'
          : '<span class="match-false">✗ Does not match the on-chain commitment</span>';
      } catch (err) {
        resultEl.innerHTML = `<span class="match-false">${err.message}</span>`;
      }
    });

    thresholdRow.querySelector("#onchainThresholdBtn").addEventListener("click", async () => {
      const threshold = parseInt(thresholdRow.querySelector("#onchainThreshold").value, 10);
      const resultEl = thresholdRow.querySelector("#onchainThresholdResult");
      if (!getLastCommitment() || Number.isNaN(threshold)) return;
      try {
        const recordId = hexToBytes(getLastCommitment());
        const meetsThreshold = await vault.proveRedactionThreshold(recordId, threshold);
        resultEl.innerHTML = meetsThreshold
          ? `<span class="match-true">✓ Proven on-chain: at least ${threshold} spans redacted (exact count stays private)</span>`
          : `<span class="match-false">✗ Cannot prove: fewer than ${threshold} spans were redacted</span>`;
      } catch (err) {
        resultEl.innerHTML = `<span class="match-false">${err.message}</span>`;
      }
    });
  }

  renderDeployControls();
  statusEl.textContent = "Wallet detected. Deploy a new vault or join an existing one.";
}
