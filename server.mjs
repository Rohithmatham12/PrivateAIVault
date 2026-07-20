#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// PrivateAIVault -- local demo server.
//
// Runs a real instance of the compiled Compact contract (the same one
// exercised by contract/src/test/bboard.test.ts) behind a tiny HTTP
// API, and serves a browser UI on top of it. No live Midnight network
// is required for the demo: this uses the same in-process circuit
// simulator pattern as the contract's own test suite, so every circuit
// call here is a real execution of the compiled Compact circuit, not a
// mock of one.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, RecordState } from "./contract/dist/managed/bboard/contract/index.js";
import { witnesses } from "./contract/dist/witnesses.js";
import { processRecord, sha256Hex } from "./lib/redact-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5173;

// ---------------------------------------------------------------------
// A thin wrapper around the compiled contract, structurally identical
// to contract/src/test/bboard-simulator.ts, kept as a single
// long-lived instance so the demo UI has persistent ledger state.
// ---------------------------------------------------------------------
class ContractSession {
  constructor(secretKey) {
    this.contract = new Contract(witnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(createConstructorContext({ secretKey }, "0".repeat(64)));
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
  }

  getLedger() {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  commitRecord(secretDataHash, spanCount) {
    this.circuitContext = this.contract.impureCircuits.commitRecord(
      this.circuitContext,
      secretDataHash,
      spanCount,
    ).context;
    return this.getLedger();
  }

  verifyMatchesCommitment(candidateHash) {
    return this.contract.impureCircuits.verifyMatchesCommitment(
      this.circuitContext,
      candidateHash,
    ).result;
  }
}

function randomBytes32() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

const session = new ContractSession(randomBytes32());

function hexToBytes(hex) {
  const clean = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function serializeLedger(l) {
  return {
    state: l.state === RecordState.EMPTY ? "EMPTY" : "COMMITTED",
    commitment: l.commitment.is_some ? `0x${bytesToHex(l.commitment.value)}` : null,
    redactedSpanCount: l.redactedSpanCount.toString(),
    owner: `0x${bytesToHex(l.owner)}`,
  };
}

// ---------------------------------------------------------------------
// Minimal HTTP layer -- no framework dependency, just node:http.
// ---------------------------------------------------------------------
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

async function serveStatic(req, res) {
  const filePath = req.url === "/" ? "/index.html" : req.url;
  const full = path.join(__dirname, "public", filePath);
  if (!full.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const body = await readFile(full);
    const ext = path.extname(full);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/state") {
      return sendJson(res, 200, serializeLedger(session.getLedger()));
    }

    if (req.method === "POST" && req.url === "/api/redact") {
      const { rawText } = await readJsonBody(req);
      if (!rawText || typeof rawText !== "string") {
        return sendJson(res, 400, { error: "rawText is required" });
      }
      const result = await processRecord(rawText, process.env.GROQ_API_KEY);
      // The raw text is used above, in this request only, to compute
      // the redaction and commitment, then discarded. It is never
      // written to any store and never sent to the contract below.
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/api/commit") {
      const { commitment, spanCount } = await readJsonBody(req);
      if (!commitment || typeof spanCount !== "number") {
        return sendJson(res, 400, { error: "commitment and spanCount are required" });
      }
      try {
        const ledgerState = session.commitRecord(hexToBytes(commitment), BigInt(spanCount));
        return sendJson(res, 200, { ledger: serializeLedger(ledgerState) });
      } catch (err) {
        return sendJson(res, 409, { error: String(err.message || err) });
      }
    }

    if (req.method === "POST" && req.url === "/api/verify") {
      const { candidateText } = await readJsonBody(req);
      if (!candidateText || typeof candidateText !== "string") {
        return sendJson(res, 400, { error: "candidateText is required" });
      }
      const candidateHash = hexToBytes(sha256Hex(candidateText));
      try {
        const matches = session.verifyMatchesCommitment(candidateHash);
        return sendJson(res, 200, { matches });
      } catch (err) {
        return sendJson(res, 409, { error: String(err.message || err) });
      }
    }

    if (req.method === "GET" && !req.url.startsWith("/api/")) {
      return serveStatic(req, res);
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`PrivateAIVault demo UI: http://localhost:${PORT}`);
  console.log(
    process.env.GROQ_API_KEY
      ? "AI redaction: Groq (llama-3.3-70b-versatile)"
      : "AI redaction: regex fallback (set GROQ_API_KEY in .env for LLM redaction)",
  );
});
