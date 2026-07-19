# PrivateAIVault

Built for the [Midnight Hackathon](https://midnight-hackathon.devpost.com) (MLH) -- AI Track.

**AI applications that process sensitive user data without ever exposing the underlying information.**

## What it does

1. **Off-chain AI redaction** (`redact.mjs`): an LLM (Groq, `llama-3.3-70b-versatile`) scans
   a raw sensitive record -- names, SSNs, emails, phone numbers, dates of birth, medical/financial
   identifiers -- and produces a redacted version safe to display. A regex-based fallback keeps
   the script runnable without an API key.
2. **On-chain commitment** (`contract/src/bboard.compact`, a [Compact](https://docs.midnight.network/compact)
   smart contract on Midnight): the script computes a SHA-256 commitment of the **raw, unredacted**
   record and passes only that 32-byte hash to the contract. The raw record itself never leaves
   the local machine, is never transmitted to Midnight, and is never recoverable from what's on
   the ledger.
3. **On-chain verification**: anyone independently holding a candidate original record can
   recompute its hash locally and call `verifyMatchesCommitment` to prove -- without exposing
   the candidate to any third party -- whether it matches the committed record.

This is proven end-to-end against a **real compiled Compact contract** (see Test plan below),
not a mock: `commitRecord` and `verifyMatchesCommitment` are compiled to real zero-knowledge
circuits (proving/verifying keys, zkIR) by the Compact compiler.

## Why this matters

AI systems that process sensitive data (medical records, financial data, PII) usually have to
choose between capability and privacy: either the raw data touches a server/chain somewhere, or
the system can't prove anything about it. `PrivateAIVault` demonstrates the alternative --
a commitment that lets you prove and verify facts about sensitive AI-processed data without the
data ever being exposed, using Midnight's witness/disclose model as the enforcement mechanism,
not just a policy promise.

## Project layout

```
redact.mjs                        # off-chain AI redaction + commitment step
contract/src/bboard.compact       # the Midnight smart contract (Compact)
contract/src/witnesses.ts         # private-state witness (local secret key)
contract/src/test/
  bboard-simulator.ts             # local circuit simulator (no live network needed)
  bboard.test.ts                  # end-to-end tests proving the privacy property
```

## Try it

Requires Node.js >= 24.11.1 and the [Compact compiler](https://docs.midnight.network/compact):

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
```

```bash
npm install

# Off-chain AI redaction step (works without an API key via regex fallback;
# set GROQ_API_KEY for real LLM-based redaction)
node redact.mjs "Patient: Jane Doe, SSN 219-09-9999, contact jane.doe@example.com"

# Compile the contract to real ZK circuits
cd contract && npm run compact

# Run the end-to-end tests against the compiled circuit
npx vitest run
```

The test suite proves the core claim directly: it serializes the full public ledger state after
a commit and asserts the raw sensitive strings ("Jane Doe", the SSN) are **not present anywhere
in it** -- only the hash is.

## Built with

- [Compact](https://docs.midnight.network/compact) -- Midnight's ZK smart contract language
- Midnight compact-runtime / midnight-js SDK (from the official
  [example-bboard](https://github.com/midnightntwrk/example-bboard) scaffold)
- Node.js, Vitest
- Groq (`llama-3.3-70b-versatile`) for AI-based redaction

## What's next

- Wire `redact.mjs` directly into a live Midnight testnet deployment via the existing
  `midnight-js-*` providers (indexer, proof server, wallet) instead of the local simulator.
- A minimal UI for uploading a record and watching the redact -> commit -> verify flow live.
- Batch commitments for multi-record datasets with a single Merkle-root-style commitment.
