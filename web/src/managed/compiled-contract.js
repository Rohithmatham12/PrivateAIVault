// SPDX-License-Identifier: Apache-2.0
// Browser port of contract/src/index.ts's CompiledBBoardContractContract export.
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import * as CompiledBBoardContract from "./bboard/contract/index.js";
import { witnesses } from "./witnesses.js";

export const CompiledVaultContract = CompiledContract.make(
  "PrivateAIVault",
  CompiledBBoardContract.Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets("./bboard"),
);
