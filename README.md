# PrivateAIVault

Built for the [Midnight Hackathon](https://midnight-hackathon.devpost.com) (MLH) -- AI Track.

**AI applications that process sensitive user data without ever exposing the underlying information.**

![state](https://img.shields.io/badge/status-working%20end--to--end-6ee7b7)
![compact](https://img.shields.io/badge/Compact-0.31.1-1abc9c)
![tests](https://img.shields.io/badge/tests-6%2F6%20passing-brightgreen)

## What it does

1. **AI redaction step**: an LLM (Groq, `llama-3.3-70b-versatile`) scans a raw sensitive record --
   names, SSNs, emails, phone numbers, dates of birth, medical/financial identifiers -- and produces
   a redacted version safe to display. A regex-based fallback keeps the whole system runnable
   without an API key.
2. **On-chain commitment**: a SHA-256 commitment of the **raw, unredacted** record is computed
   locally and passed to a [Compact](https://docs.midnight.network/compact) smart contract on
   Midnight (`contract/src/bboard.compact`). The `commitRecord` circuit discloses only that
   32-byte hash to the public ledger. The raw record itself never leaves the machine that computed
   it, is never transmitted to Midnight, and is not recoverable from anything on the ledger.
3. **On-chain verification**: anyone independently holding a candidate original record can
   recompute its hash locally and call `verifyMatchesCommitment` to prove -- without exposing the
   candidate to any third party -- whether it matches the committed record.

This is proven end-to-end against a **real compiled Compact contract**, not a mock:
`commitRecord` and `verifyMatchesCommitment` are compiled to real zero-knowledge circuits
(proving/verifying keys, zkIR) by the Compact compiler, and both the automated test suite and the
web UI drive those real compiled circuits, not a simulated stand-in for them.

## Architecture

```
                    Browser (public/)
                          │  raw text, typed locally
                          ▼
        ┌──────────────────────────────────┐
        │  server.mjs (Node, no framework)  │
        │                                    │
        │  /api/redact  ─▶ lib/redact-core   │──▶ Groq LLM (or regex fallback)
        │                    .mjs            │      redacted text + SHA-256 commitment
        │                                    │      (raw text discarded after this call,
        │                                    │       never stored, never forwarded)
        │  /api/commit  ─▶ ContractSession   │──▶ compiled Compact circuit
        │                  (real contract    │      commitRecord(hash, spanCount)
        │                   instance, same   │      discloses ONLY the hash to the ledger
        │                   code path as the │
        │                   test suite)      │
        │  /api/verify  ─▶ ContractSession   │──▶ verifyMatchesCommitment(hash)
        │                                    │      boolean result, no data exposed
        │  /api/state   ─▶ current ledger    │
        └──────────────────────────────────┘
```

Nothing in this diagram is a mock. `server.mjs` imports the exact same compiled contract module
(`contract/dist/managed/bboard/contract/index.js`) that `contract/src/test/bboard.test.ts` runs
against, wrapped in the same simulator pattern -- one long-lived instance per server process, so
the UI has persistent ledger state across requests, same as a real chain would.

## Project layout

```
public/                           # browser UI (no framework, no build step)
server.mjs                        # HTTP API + persistent contract session
lib/redact-core.mjs               # shared AI redaction + commitment logic
redact.mjs                        # CLI entrypoint (same logic as the UI)
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
cd contract && npm run compact && npm run build && cd ..

# Web UI (recommended) -- redact, commit, and verify live in the browser
echo "GROQ_API_KEY=your-key-here" > .env   # optional; regex fallback works without it
npm run ui
# open http://localhost:5173

# Or the CLI
node --env-file=.env redact.mjs "Patient: Jane Doe, SSN 219-09-9999, contact jane.doe@example.com"

# Run the automated tests against the compiled circuit
cd contract && npx vitest run
```

The test suite proves the core claim directly: it serializes the full public ledger state after
a commit and asserts the raw sensitive strings ("Jane Doe", the SSN) are **not present anywhere
in it** -- only the hash is. The same guarantee is what the `/api/redact` endpoint enforces at
the HTTP boundary: the raw text is used to compute the response and then discarded, never
persisted, never forwarded past that request.

## Built with

- [Compact](https://docs.midnight.network/compact) -- Midnight's ZK smart contract language
- Midnight compact-runtime / midnight-js SDK (from the official
  [example-bboard](https://github.com/midnightntwrk/example-bboard) scaffold)
- Node.js (native `node:http`, no framework), Vitest
- Groq (`llama-3.3-70b-versatile`) for AI-based redaction

## Testnet deployment attempt

`deploy-testnet.mjs` is a real, non-interactive deployment script targeting Midnight's live
Preprod testnet: it builds a fresh wallet, requests funds from the public faucet, registers dust
generation, deploys `PrivateAIVault`, calls `commitRecord` with a real commitment, and reads the
result back from the public indexer. It got as far as a real testnet address
(`mn_addr_preprod1glqhphpxuhyt7f240xukgw7s870rl5e7lqgxke07accgqylfkjgqzmms8p`) and a confirmed
faucet request (`Faucet response: OK`), but wallet sync against Preprod's live chain state didn't
complete within the hackathon window -- this looks like a performance characteristic (or possible
bug) in the still-young `wallet-sdk-facade` sync path against a chain with real history, not
something wrong with the contract or the redaction logic. The contract itself is proven correct
independently of network access: `contract/src/test/bboard.test.ts` runs the exact same compiled
circuit through 6 passing tests.

## What's next

- Finish wiring `deploy-testnet.mjs` to a completed testnet deployment -- the blocker was wallet
  sync time/reliability, not contract logic, so this is the natural next step.
- Batch commitments for multi-record datasets with a single Merkle-root-style commitment.
- Configurable redaction policies (HIPAA-specific, PCI-specific) as selectable system prompts.
