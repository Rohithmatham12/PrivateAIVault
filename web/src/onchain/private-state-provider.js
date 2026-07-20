// SPDX-License-Identifier: Apache-2.0
// Browser port of the official example-bboard in-memory-private-state-provider.ts,
// types stripped. Holds the local secret key used to derive the owner public key,
// scoped per contract address, entirely in this tab's memory.
export const inMemoryPrivateStateProvider = () => {
  const privateStates = new Map();
  const signingKeys = new Map();
  let contractAddress = null;

  const requireContractAddress = () => {
    if (contractAddress === null) {
      throw new Error("Contract address not set. Call setContractAddress() before accessing private state.");
    }
    return contractAddress;
  };

  const getScopedStates = (address) => {
    let scoped = privateStates.get(address);
    if (!scoped) {
      scoped = new Map();
      privateStates.set(address, scoped);
    }
    return scoped;
  };

  const encode = (value) => JSON.stringify(value);
  const decode = (value) => JSON.parse(value);

  return {
    setContractAddress(address) {
      contractAddress = address;
    },
    set(key, state) {
      getScopedStates(requireContractAddress()).set(key, state);
      return Promise.resolve();
    },
    get(key) {
      const value = getScopedStates(requireContractAddress()).get(key) ?? null;
      return Promise.resolve(value);
    },
    remove(key) {
      getScopedStates(requireContractAddress()).delete(key);
      return Promise.resolve();
    },
    clear() {
      privateStates.delete(requireContractAddress());
      return Promise.resolve();
    },
    setSigningKey(address, signingKey) {
      signingKeys.set(address, signingKey);
      return Promise.resolve();
    },
    getSigningKey(address) {
      return Promise.resolve(signingKeys.get(address) ?? null);
    },
    removeSigningKey(address) {
      signingKeys.delete(address);
      return Promise.resolve();
    },
    clearSigningKeys() {
      signingKeys.clear();
      return Promise.resolve();
    },
    exportPrivateStates() {
      const address = requireContractAddress();
      const states = Object.fromEntries(
        Array.from(getScopedStates(address).entries()).map(([id, value]) => [id, encode(value)]),
      );
      return Promise.resolve({
        format: "midnight-private-state-export",
        encryptedPayload: encode({ contractAddress: address, states }),
        salt: "in-memory-private-state-provider",
      });
    },
    importPrivateStates(exportData, options) {
      const address = requireContractAddress();
      const conflictStrategy = options?.conflictStrategy ?? "error";
      const payload = decode(exportData.encryptedPayload);
      const states = payload.states ?? {};
      const scoped = getScopedStates(address);
      let imported = 0, skipped = 0, overwritten = 0;
      for (const [stateId, serialized] of Object.entries(states)) {
        const hasExisting = scoped.has(stateId);
        if (hasExisting) {
          if (conflictStrategy === "skip") { skipped += 1; continue; }
          if (conflictStrategy === "error") return Promise.reject(new Error(`Private state conflict for '${stateId}'`));
          overwritten += 1;
        } else {
          imported += 1;
        }
        scoped.set(stateId, decode(serialized));
      }
      return Promise.resolve({ imported, skipped, overwritten });
    },
    exportSigningKeys() {
      return Promise.resolve({
        format: "midnight-signing-key-export",
        encryptedPayload: encode({ keys: Object.fromEntries(signingKeys.entries()) }),
        salt: "in-memory-signing-key-provider",
      });
    },
    importSigningKeys(exportData, options) {
      const conflictStrategy = options?.conflictStrategy ?? "error";
      const payload = decode(exportData.encryptedPayload);
      const keys = payload.keys ?? {};
      let imported = 0, skipped = 0, overwritten = 0;
      for (const [address, signingKey] of Object.entries(keys)) {
        const hasExisting = signingKeys.has(address);
        if (hasExisting) {
          if (conflictStrategy === "skip") { skipped += 1; continue; }
          if (conflictStrategy === "error") return Promise.reject(new Error(`Signing key conflict for '${address}'`));
          overwritten += 1;
        } else {
          imported += 1;
        }
        signingKeys.set(address, signingKey);
      }
      return Promise.resolve({ imported, skipped, overwritten });
    },
  };
};
