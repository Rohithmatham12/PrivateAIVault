// SPDX-License-Identifier: Apache-2.0
// Browser port of contract/src/witnesses.ts (types stripped, same logic).
export const createBBoardPrivateState = (secretKey) => ({ secretKey });

export const witnesses = {
  localSecretKey: ({ privateState }) => [privateState, privateState.secretKey],
};
