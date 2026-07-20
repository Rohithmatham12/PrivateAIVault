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
import { Contract, ledger } from "./contract/dist/managed/bboard/contract/index.js";
import { witnesses, withSpanCount } from "./contract/dist/witnesses.js";
import { processRecord, sha256Hex } from "./lib/redact-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5173;

// ---------------------------------------------------------------------
// A thin wrapper around the compiled contract, structurally identical
// to contract/src/test/bboard-simulator.ts, kept as a single
// long-lived instance so the demo UI has persistent ledger state
// across requests -- and, since the ledger is now a map, an unbounded
// number of independently committed records.
// ---------------------------------------------------------------------
class ContractSession {
  constructor(secretKey) {
    this.contract = new Contract(witnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(createConstructorContext({ secretKey, spanCounts: {} }, "0".repeat(64)));
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
  }

  getRecordCount() {
    return ledger(this.circuitContext.currentQueryContext.state).recordCount;
  }

  getRecord(recordId) {
    const l = ledger(this.circuitContext.currentQueryContext.state);
    if (!l.commitmentOf.member(recordId)) return null;
    return {
      commitment: `0x${bytesToHex(l.commitmentOf.lookup(recordId))}`,
      owner: `0x${bytesToHex(l.ownerOf.lookup(recordId))}`,
    };
  }

  commitRecord(recordId, secretDataHash, spanCount) {
    this.circuitContext = this.contract.impureCircuits.commitRecord(
      this.circuitContext,
      recordId,
      secretDataHash,
    ).context;
    this.circuitContext = {
      ...this.circuitContext,
      currentPrivateState: withSpanCount(this.circuitContext.currentPrivateState, bytesToHex(recordId), spanCount),
    };
    return this.getRecord(recordId);
  }

  verifyMatchesCommitment(recordId, candidateHash) {
    return this.contract.impureCircuits.verifyMatchesCommitment(
      this.circuitContext,
      recordId,
      candidateHash,
    ).result;
  }

  proveRedactionThreshold(recordId, threshold) {
    return this.contract.impureCircuits.proveRedactionThreshold(
      this.circuitContext,
      recordId,
      BigInt(threshold),
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
      return sendJson(res, 200, { recordCount: session.getRecordCount().toString() });
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
        // The commitment hash doubles as the record id: each distinct
        // redacted document gets its own entry in the contract's
        // (unbounded) record map, rather than overwriting a single slot.
        const recordId = hexToBytes(commitment);
        const record = session.commitRecord(recordId, recordId, spanCount);
        return sendJson(res, 200, { recordId: commitment, record, recordCount: session.getRecordCount().toString() });
      } catch (err) {
        return sendJson(res, 409, { error: String(err.message || err) });
      }
    }

    if (req.method === "POST" && req.url === "/api/verify") {
      const { recordId, candidateText } = await readJsonBody(req);
      if (!recordId || !candidateText || typeof candidateText !== "string") {
        return sendJson(res, 400, { error: "recordId and candidateText are required" });
      }
      const candidateHash = hexToBytes(sha256Hex(candidateText));
      try {
        const matches = session.verifyMatchesCommitment(hexToBytes(recordId), candidateHash);
        return sendJson(res, 200, { matches });
      } catch (err) {
        return sendJson(res, 409, { error: String(err.message || err) });
      }
    }

    if (req.method === "POST" && req.url === "/api/prove-threshold") {
      const { recordId, threshold } = await readJsonBody(req);
      if (!recordId || typeof threshold !== "number") {
        return sendJson(res, 400, { error: "recordId and threshold are required" });
      }
      try {
        const meetsThreshold = session.proveRedactionThreshold(hexToBytes(recordId), threshold);
        return sendJson(res, 200, { meetsThreshold });
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
