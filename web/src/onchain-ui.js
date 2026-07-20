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

  function renderLedger(ledger) {
    ledgerEl.innerHTML = `
      <div class="ledger-item"><span class="k">State</span><span class="v">${ledger.state}</span></div>
      <div class="ledger-item"><span class="k">Redacted spans</span><span class="v">${ledger.redactedSpanCount}</span></div>
      <div class="ledger-item"><span class="k">Commitment</span><span class="v">${ledger.commitment || "none"}</span></div>
      <div class="ledger-item"><span class="k">Owner (pubkey)</span><span class="v">${ledger.owner}</span></div>
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
        renderLedger(await vault.getLedgerState());
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
        renderLedger(await vault.getLedgerState());
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
    controlsEl.appendChild(commitBtn);
    controlsEl.appendChild(verifyRow);

    commitBtn.addEventListener("click", async () => {
      commitBtn.disabled = true;
      commitBtn.textContent = "Submitting (real transaction, may take up to a minute)...";
      try {
        const { txHash } = await vault.commitRecord(hexToBytes(getLastCommitment()), BigInt(getLastSpanCount()));
        statusEl.textContent = `Committed on-chain. Transaction: ${txHash}`;
        renderLedger(await vault.getLedgerState());
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
      if (!candidateText) return;
      try {
        const candidateHash = hexToBytes(await sha256Hex(candidateText));
        const matches = await vault.verifyMatchesCommitment(candidateHash);
        resultEl.innerHTML = matches
          ? '<span class="match-true">✓ Matches the on-chain commitment</span>'
          : '<span class="match-false">✗ Does not match the on-chain commitment</span>';
      } catch (err) {
        resultEl.innerHTML = `<span class="match-false">${err.message}</span>`;
      }
    });
  }

  renderDeployControls();
  statusEl.textContent = "Wallet detected. Deploy a new vault or join an existing one.";
}
