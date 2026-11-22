// Letterplate server. It holds no keys and signs nothing. QoreChain's public
// REST endpoints send no CORS headers, so the browser cannot read them
// directly; this server reads the chain, applies lib/resolve.mjs and serves
// the built app.
//
//   GET  /api/resolve?address=qor1...        where to seal for this address, and why
//   GET  /api/validators?network=testnet|mainnet   the same for every bonded validator's account
//   GET  /api/account?address=qor1...        a sealing account's keys, balance and sequence
//   GET  /api/tx?hash=...                    whether a transaction landed
//   POST /api/relay                          a sealing account's signed transaction (lib/relay.mjs)
//   GET  /api/health
//   everything else                          dist/ (single-page app)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { resolve } from "../lib/resolve.mjs";
import { NETWORKS, getJson, kemKey, txsTo } from "../lib/chain.mjs";
import { isQorAddress, toAccount } from "../lib/bech32.mjs";
import { readAccount } from "../lib/accounts.mjs";
import { MAX_TX_BYTES, checkRelayTx, rateLimiter } from "../lib/relay.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 8787);

// Small TTL cache; failures are never cached.
const cache = new Map();
async function cached(key, ttlMs, fn) {
  if (cache.size > 1000) for (const k of [...cache.keys()].slice(0, 200)) cache.delete(k);
  const hit = cache.get(key);
  if (hit?.value !== undefined && Date.now() - hit.at < ttlMs) return hit.value;
  if (hit?.pending) return hit.pending;
  const pending = fn().then(
    (value) => { cache.set(key, { at: Date.now(), value }); return value; },
    (err) => { cache.delete(key); throw err; },
  );
  cache.set(key, { ...(hit ?? {}), pending });
  return pending;
}

const io = (rest) => ({ txsTo: (a) => txsTo(a, rest), kemKey: (a) => kemKey(a, rest) });

async function validators(network) {
  const net = NETWORKS[network];
  const d = await getJson(`${net.rest}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=200`);
  const total = d.validators.reduce((s, v) => s + BigInt(v.tokens), 0n) || 1n;
  const rows = await Promise.all(d.validators.map(async (v) => {
    const address = toAccount(v.operator_address);
    const r = await resolve(address, io(net.rest));
    return { name: v.description?.moniker || v.operator_address.slice(0, 16), address, votingPowerBps: Number((BigInt(v.tokens) * 10000n) / total), status: r.status, sealTo: r.sealTo, historyFrom: r.historyFrom };
  }));
  rows.sort((a, b) => b.votingPowerBps - a.votingPowerBps);
  return { network, chainId: net.chainId, rows, canReceive: rows.filter((r) => r.sealTo).length, readAt: new Date().toISOString() };
}

// ---- The relay: the one write path ----------------------------------------
const allowRelay = rateLimiter({ perKey: 10, globalMax: 200, windowMs: 10 * 60 * 1000 });
// Behind a proxy that sets X-Real-IP (Railway does), set TRUST_PROXY=1 so the limit is per visitor.
const visitor = (req) => (process.env.TRUST_PROXY === "1" && req.headers["x-real-ip"]) || req.socket.remoteAddress || "unknown";

function readBody(req, limit) {
  return new Promise((ok, fail) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > limit) { fail(Object.assign(new Error("too large"), { tooLarge: true })); req.pause(); } else chunks.push(c); });
    req.on("end", () => ok(Buffer.concat(chunks)));
    req.on("error", fail);
  });
}

async function relayRoute(req, res) {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { error: "send JSON" });
  if (!allowRelay(String(visitor(req)))) return send(res, 429, { error: "Too many transactions from here; wait a few minutes" });
  let raw, txBytes;
  try { raw = await readBody(req, MAX_TX_BYTES * 2); }
  catch (err) {
    res.on("finish", () => req.destroy()); // answer first, then stop an oversized upload
    return send(res, err.tooLarge ? 413 : 400, { error: err.tooLarge ? "Transaction too large" : "Could not read the request" });
  }
  try {
    const body = JSON.parse(raw.toString("utf8"));
    if (typeof body.txBytes !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.txBytes)) throw new Error("bad");
    txBytes = new Uint8Array(Buffer.from(body.txBytes, "base64"));
  } catch { return send(res, 400, { error: "Expected {\"txBytes\": base64}" }); }
  const verdict = checkRelayTx(txBytes);
  if (!verdict.ok) return send(res, 400, { error: `Refused: ${verdict.reason}` });
  try {
    const r = await fetch(`${NETWORKS.testnet.rest}/cosmos/tx/v1beta1/txs`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ tx_bytes: Buffer.from(txBytes).toString("base64"), mode: "BROADCAST_MODE_SYNC" }),
    });
    const out = await r.json().catch(() => ({}));
    const tr = out.tx_response;
    if (!tr) return send(res, 502, { error: "The chain did not accept the broadcast. Try again shortly." });
    if (tr.code !== 0) return send(res, 400, { error: `The chain refused it (code ${tr.code}): ${String(tr.raw_log ?? "").slice(0, 300)}` });
    console.log(`relayed ${verdict.kind} ${tr.txhash}`);
    cache.delete(`account:${verdict.account}`);
    return send(res, 200, { txHash: tr.txhash, kind: verdict.kind });
  } catch (err) {
    console.error("relay", err.message);
    return send(res, 502, { error: "Could not reach the chain. Try again shortly." });
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2" };
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, ...SECURITY_HEADERS, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body));
}

// Built files never change while the server runs: read and gzip each once.
// Vite puts a content hash in every name under assets/, so those cache for a year.
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".svg", ".json"]);
const staticCache = new Map();
async function sendStatic(req, res, file) {
  let entry = staticCache.get(file);
  if (!entry) {
    const raw = await readFile(file);
    entry = { raw, gz: COMPRESSIBLE.has(extname(file)) && raw.length > 1024 ? gzipSync(raw, { level: 9 }) : null };
    staticCache.set(file, entry);
  }
  const hashed = file.startsWith(join(DIST, "assets") + sep);
  const gzip = entry.gz && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    ...SECURITY_HEADERS,
    "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    ...(entry.gz ? { Vary: "Accept-Encoding" } : {}),
    ...(gzip ? { "Content-Encoding": "gzip" } : {}),
    "Content-Length": (gzip ? entry.gz : entry.raw).length,
  });
  res.end(gzip ? entry.gz : entry.raw);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "POST" && url.pathname === "/api/relay") return relayRoute(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "read-only, except POST /api/relay" });
  try {
    if (url.pathname === "/api/health") return send(res, 200, { ok: true });
    if (url.pathname === "/api/resolve") {
      const address = url.searchParams.get("address") ?? "";
      if (!isQorAddress(address)) return send(res, 400, { error: "address must be a qor1 account address" });
      return send(res, 200, { network: "testnet", ...(await cached(`resolve:${address}`, 10000, () => resolve(address, io(NETWORKS.testnet.rest)))), readAt: new Date().toISOString() });
    }
    if (url.pathname === "/api/validators") {
      const network = url.searchParams.get("network") ?? "testnet";
      if (!(network in NETWORKS)) return send(res, 400, { error: "network must be testnet or mainnet" });
      return send(res, 200, await cached(`validators:${network}`, 60000, () => validators(network)));
    }
    if (url.pathname === "/api/account") {
      const address = url.searchParams.get("address") ?? "";
      if (!isQorAddress(address)) return send(res, 400, { error: "address must be a qor1 account address" });
      return send(res, 200, await cached(`account:${address}`, 2000, () => readAccount(getJson, NETWORKS.testnet.rest, address)));
    }
    if (url.pathname === "/api/tx") {
      const hash = (url.searchParams.get("hash") ?? "").toUpperCase();
      if (!/^[0-9A-F]{64}$/.test(hash)) return send(res, 400, { error: "hash must be 64 hex characters" });
      const t = await getJson(`${NETWORKS.testnet.rest}/cosmos/tx/v1beta1/txs/${hash}`, { attempts: 1 }).catch(() => null);
      const r = t?.tx_response;
      return send(res, 200, r ? { found: true, hash, code: r.code, height: Number(r.height), rawLog: r.code ? String(r.raw_log ?? "").slice(0, 300) : undefined } : { found: false, hash });
    }
    if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "not found" });

    // Static app with single-page fallback: anything that is not a real file in the build gets the app shell.
    const safe = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    let file = join(DIST, safe);
    const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };
    if (!file.startsWith(DIST + sep) || !isFile(file)) file = join(DIST, "index.html");
    if (!existsSync(file)) return send(res, 503, "The app is not built yet: run npm run build.", "text/plain; charset=utf-8");
    return sendStatic(req, res, file);
  } catch (err) {
    console.error(url.pathname, err.message);
    // Internal details stay in the log. A failed read is an error, never "cannot receive".
    return send(res, 502, { error: "Could not read the chain right now. Try again shortly." });
  }
});

server.listen(PORT, () => console.log(`Letterplate server on http://localhost:${PORT}`));
