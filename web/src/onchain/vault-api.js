// SPDX-License-Identifier: Apache-2.0
// Browser port of the official example-bboard's BBoardAPI, adapted for
// PrivateAIVault's commitRecord/verifyMatchesCommitment circuits. Deploys
// or joins the real on-chain contract and submits real transactions through
// the connected wallet (proof generation delegated to the wallet).
import { deployContract, findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { ledger, RecordState } from "../managed/bboard/contract/index.js";
import { CompiledVaultContract } from "../managed/compiled-contract.js";
import { createBBoardPrivateState } from "../managed/witnesses.js";

const PRIVATE_STATE_KEY = "privateAIVaultPrivateState";

function randomBytes32() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

function serializeLedger(l) {
  const bytesToHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return {
    state: l.state === RecordState.EMPTY ? "EMPTY" : "COMMITTED",
    commitment: l.commitment.is_some ? `0x${bytesToHex(l.commitment.value)}` : null,
    redactedSpanCount: l.redactedSpanCount.toString(),
    owner: `0x${bytesToHex(l.owner)}`,
  };
}

export class OnchainVault {
  constructor(deployedContract, providers) {
    this.deployedContract = deployedContract;
    this.providers = providers;
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
  }

  async getLedgerState() {
    const contractState = await this.providers.publicDataProvider.queryContractState(this.deployedContractAddress);
    if (!contractState) throw new Error("Contract state not found on-chain yet.");
    return serializeLedger(ledger(contractState.data));
  }

  async commitRecord(secretDataHashBytes, spanCount) {
    const txData = await this.deployedContract.callTx.commitRecord(secretDataHashBytes, spanCount);
    return { txHash: txData.public.txHash, blockHeight: txData.public.blockHeight };
  }

  async verifyMatchesCommitment(candidateHashBytes) {
    const txData = await this.deployedContract.callTx.verifyMatchesCommitment(candidateHashBytes);
    return txData.public.result ?? txData.private.result;
  }

  static async deploy(providers) {
    const deployedContract = await deployContract(providers, {
      compiledContract: CompiledVaultContract,
      privateStateId: PRIVATE_STATE_KEY,
      initialPrivateState: createBBoardPrivateState(randomBytes32()),
    });
    providers.privateStateProvider.setContractAddress(deployedContract.deployTxData.public.contractAddress);
    return new OnchainVault(deployedContract, providers);
  }

  static async join(providers, contractAddress) {
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existing = await providers.privateStateProvider.get(PRIVATE_STATE_KEY);
    const initialPrivateState = existing ?? createBBoardPrivateState(randomBytes32());
    const deployedContract = await findDeployedContract(providers, {
      contractAddress,
      compiledContract: CompiledVaultContract,
      privateStateId: PRIVATE_STATE_KEY,
      initialPrivateState,
    });
    return new OnchainVault(deployedContract, providers);
  }
}
