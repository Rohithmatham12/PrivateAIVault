// This file is part of midnightntwrk/example-bboard.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/*
 * This file defines the shape of PrivateAIVault's private state: the
 * user's secret key, and a local map of per-record redaction span
 * counts (recordId -> count) that backs the proveRedactionThreshold
 * circuit. That count is never written to the ledger by any circuit;
 * it only ever exists in this private state, supplied fresh by whoever
 * locally knows it as a witness value at proof time.
 */

import { Ledger } from "./managed/bboard/contract/index.js";
import { WitnessContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";

export type BBoardPrivateState = {
  readonly secretKey: Uint8Array;
  // Hex-encoded recordId -> redaction span count, known only to whoever
  // locally committed (or was told) that record's span count.
  readonly spanCounts: Readonly<Record<string, number>>;
};

export const createBBoardPrivateState = (
  secretKey: Uint8Array,
  spanCounts: Readonly<Record<string, number>> = {},
): BBoardPrivateState => ({
  secretKey,
  spanCounts,
});

/**
 * Returns a new private state with an additional (or updated)
 * recordId -> spanCount entry. Callers should persist the result via
 * their private state provider after a successful commit, so a later
 * proveRedactionThreshold call for the same record can find it.
 */
export const withSpanCount = (
  state: BBoardPrivateState,
  recordIdHex: string,
  spanCount: number,
): BBoardPrivateState => ({
  ...state,
  spanCounts: { ...state.spanCounts, [recordIdHex]: spanCount },
});

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

export const witnesses = {
  localSecretKey: ({
    privateState,
  }: WitnessContext<Ledger, BBoardPrivateState>): [BBoardPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],
  redactionSpanCountOf: (
    { privateState }: WitnessContext<Ledger, BBoardPrivateState>,
    recordId: Uint8Array,
  ): [BBoardPrivateState, bigint] => {
    const key = toHex(recordId);
    const count = privateState.spanCounts[key];
    if (count === undefined) {
      throw new Error(
        `No locally known redaction span count for record ${key}. Only whoever originally committed a record (or was given its count) can prove threshold properties about it.`,
      );
    }
    return [privateState, BigInt(count)];
  },
};
