// SPDX-License-Identifier: Apache-2.0
// Browser port of contract/src/witnesses.ts (types stripped, same logic).
export const createBBoardPrivateState = (secretKey, spanCounts = {}) => ({ secretKey, spanCounts });

export const withSpanCount = (state, recordIdHex, spanCount) => ({
  ...state,
  spanCounts: { ...state.spanCounts, [recordIdHex]: spanCount },
});

const toHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

export const witnesses = {
  localSecretKey: ({ privateState }) => [privateState, privateState.secretKey],
  redactionSpanCountOf: ({ privateState }, recordId) => {
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
