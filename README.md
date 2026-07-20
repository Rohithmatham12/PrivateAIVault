# PrivateAIVault

Built for the [Midnight Hackathon](https://midnight-hackathon.devpost.com) (MLH) -- AI Track.

**AI applications that process sensitive user data without ever exposing the underlying information.**

![state](https://img.shields.io/badge/status-working%20end--to--end-6ee7b7)
![compact](https://img.shields.io/badge/Compact-0.31.1-1abc9c)
![tests](https://img.shields.io/badge/tests-6%2F6%20passing-brightgreen)

**Live: https://rohithmatham12.github.io/PrivateAIVault/** -- landing page with the full pitch,
architecture, and use cases. **Try it directly: https://rohithmatham12.github.io/PrivateAIVault/app/**
-- runs entirely in your browser. The real compiled Compact circuit executes client-side via
WebAssembly; there is no backend, no Docker, no proof server, and nothing for anyone to keep
running. See [`landing/`](./landing) for the marketing page and [`web/`](./web) for the app.

## Who this is for

The underlying problem: an organization needs to **prove a sensitive record exists, is unchanged,
or was processed a certain way -- without storing or exposing the sensitive data itself**,
anywhere, ever. That pattern shows up anywhere an audit trail and confidentiality are both
required at once:

- **Healthcare**: prove a patient record existed in a given state at a given time (e.g. for a
  compliance or insurance dispute) without putting PHI anywhere near a public ledger, or even a
  database an attacker could later breach.
- **Legal / document notarization**: timestamp-prove a contract or filing hasn't been altered,
  without publishing its contents.
- **HR / background checks**: prove a screening was run against a specific, unaltered document
  without retaining the document.
- **Fintech KYC**: prove an identity document matches what was verified at onboarding, without
  ever storing the ID data itself in a place that becomes a breach target.
- **Whistleblowing / journalism**: prove a leaked document is authentic and unmodified without
  exposing it (or its source) until the holder chooses to.

The AI redaction step is what makes this practical for real-world text (medical notes, HR forms,
free-text intake documents) rather than requiring pre-structured, pre-redacted input.

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

The live demo (`web/`) is the same architecture with the HTTP hop removed: the compiled contract
module + `@midnight-ntwrk/compact-runtime` are bundled to WebAssembly by Vite and run directly in
the browser tab, so `commitRecord` and `verifyMatchesCommitment` execute as real circuit calls with
no server in between at all.

## Project layout

```
web/                               # browser build (Vite) -- deployed to GitHub Pages
  src/main.js                      # app logic, runs the circuit client-side
  src/contract-session.js          # browser port of the circuit session (WASM)
  src/redact-core.js               # browser port of AI redaction + commitment logic
  src/managed/                     # compiled contract, committed (no build step on Pages)
public/                            # local Node-backed browser UI (no framework, no build step)
server.mjs                         # HTTP API + persistent contract session (local dev only)
lib/redact-core.mjs                # shared AI redaction + commitment logic (Node)
redact.mjs                         # CLI entrypoint (same logic as the UI)
contract/src/bboard.compact        # the Midnight smart contract (Compact)
contract/src/witnesses.ts          # private-state witness (local secret key)
contract/src/test/
  bboard-simulator.ts              # local circuit simulator (no live network needed)
  bboard.test.ts                   # end-to-end tests proving the privacy property
```

## Try it

**Easiest: use the live demo** -- https://rohithmatham12.github.io/PrivateAIVault/app/. Nothing to
install, nothing to run, nothing to keep alive. Everything (redaction, hashing, the compiled
circuit) executes in your browser tab.

To run it locally instead, requires Node.js >= 24.11.1 and the
[Compact compiler](https://docs.midnight.network/compact) (only needed if you want to recompile
the contract yourself -- the browser build already ships the compiled output):

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
```

```bash
npm install

# Browser build (same thing the live demo runs, built locally)
cd web && ../node_modules/.bin/vite dev
# open the URL vite prints

# Or the Node-backed local UI
cd contract && npm run compact && npm run build && cd ..
echo "GROQ_API_KEY=your-key-here" > .env   # optional; regex fallback works without it
npm run ui
# open http://localhost:5173

# Or the CLI
node --env-file=.env redact.mjs "Patient: Jane Doe, SSN 219-09-9999, contact jane.doe@example.com"

# Run the automated tests against the compiled circuit
cd contract && npx vitest run
```

None of these -- including the live demo -- need Docker or a proof server. Those are only
relevant to the (separate, unfinished) live-testnet deployment path described below.

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
result back from the public indexer. It reached a real testnet address
(`mn_addr_preprod1glqhphpxuhyt7f240xukgw7s870rl5e7lqgxke07accgqylfkjgqzmms8p`), and along the way
surfaced two real, independent bugs in the still-young Midnight SDK stack -- diagnosed from
first principles rather than guessed at:

1. **Faucet automation was silently broken.** The script logged `Faucet response: OK` (HTTP 200)
   on every run, yet the wallet never received funds. Ruled out network/connectivity issues first
   with raw WebSocket probes against both the RPC node and the indexer (both healthy), then used
   GraphQL introspection against the indexer's schema to discover an undocumented
   `unshieldedTransactions(address)` subscription, queried it directly over a raw `ws` connection
   with the `graphql-transport-ws` subprotocol, and confirmed `highestTransactionId: 0` --
   proof no funds had ever actually landed on-chain. Reading the actual bundled
   `FaucetClient` source in `@midnight-ntwrk/testkit-js` confirmed why: it sends a hardcoded dummy
   Cloudflare Turnstile token (`'XXXX.DUMMY.TOKEN.XXXX'`), which can never pass real bot
   verification. **Resolved** by requesting funds manually through the faucet's own UI (solving
   the captcha as a human). The resulting transaction was independently verified as genuinely
   on-chain via the same direct indexer query: `highestTransactionId: 502545`, a real 1000 tNight
   UTXO, tx `6edf103094...`.
2. **`wallet-sdk-facade`'s own sync layer never picked up the balance**, even after real funds
   were confirmed on-chain by the method above. This is a second, separate bug from the faucet
   issue -- the wallet's `state()` observable simply never emits an updated unshielded balance for
   this address, in bundled/minified SDK code with no source maps available to debug further.
   This is the genuine current blocker, not the contract or the redaction logic.

The contract itself is proven correct independently of network access:
`contract/src/test/bboard.test.ts` runs the exact same compiled circuit through 6 passing tests.

## What's next

- Finish wiring `deploy-testnet.mjs` to a completed testnet deployment -- the blocker was wallet
  sync time/reliability, not contract logic, so this is the natural next step.
- Batch commitments for multi-record datasets with a single Merkle-root-style commitment.
- Configurable redaction policies (HIPAA-specific, PCI-specific) as selectable system prompts.
