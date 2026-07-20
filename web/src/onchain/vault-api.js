// SPDX-License-Identifier: Apache-2.0
// Browser port of the official example-bboard's BBoardAPI, adapted for
// PrivateAIVault's commitRecord/verifyMatchesCommitment/proveRedactionThreshold
// circuits. Deploys or joins the real on-chain contract and submits real
// transactions through the connected wallet (proof generation delegated
// to the wallet).
import { deployContract, findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { ledger } from "../managed/bboard/contract/index.js";
import { CompiledVaultContract } from "../managed/compiled-contract.js";
import { createBBoardPrivateState, withSpanCount } from "../managed/witnesses.js";

const PRIVATE_STATE_KEY = "privateAIVaultPrivateState";

function randomBytes32() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class OnchainVault {
  constructor(deployedContract, providers) {
    this.deployedContract = deployedContract;
    this.providers = providers;
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
  }

  async getRecord(recordIdBytes) {
    const contractState = await this.providers.publicDataProvider.queryContractState(this.deployedContractAddress);
    if (!contractState) throw new Error("Contract state not found on-chain yet.");
    const l = ledger(contractState.data);
    if (!l.commitmentOf.member(recordIdBytes)) return null;
    return {
      state: "COMMITTED",
      recordCount: l.recordCount.toString(),
      commitment: `0x${bytesToHex(l.commitmentOf.lookup(recordIdBytes))}`,
      owner: `0x${bytesToHex(l.ownerOf.lookup(recordIdBytes))}`,
    };
  }

  async commitRecord(recordIdBytes, secretDataHashBytes, spanCount) {
    const txData = await this.deployedContract.callTx.commitRecord(recordIdBytes, secretDataHashBytes);
    // Remember this record's span count locally so a later threshold
    // proof (by this same wallet) can find it -- it is never written
    // to the ledger by any circuit.
    const current = await this.providers.privateStateProvider.get(PRIVATE_STATE_KEY);
    if (current) {
      const updated = withSpanCount(current, bytesToHex(recordIdBytes), spanCount);
      await this.providers.privateStateProvider.set(PRIVATE_STATE_KEY, updated);
    }
    return { txHash: txData.public.txHash, blockHeight: txData.public.blockHeight };
  }

  async verifyMatchesCommitment(recordIdBytes, candidateHashBytes) {
    const txData = await this.deployedContract.callTx.verifyMatchesCommitment(recordIdBytes, candidateHashBytes);
    return txData.public.result ?? txData.private.result;
  }

  async proveRedactionThreshold(recordIdBytes, threshold) {
    const txData = await this.deployedContract.callTx.proveRedactionThreshold(recordIdBytes, BigInt(threshold));
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
