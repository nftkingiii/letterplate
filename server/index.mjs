// Letterplate server. It holds no keys and signs nothing. QoreChain's public
// REST endpoints send no CORS headers, so the browser cannot read them
// directly; this server reads the chain, applies lib/resolve.mjs and serves
// the built app.
//
//   GET /api/resolve?address=qor1...        where to seal for this address, and why
//   GET /api/validators?network=testnet|mainnet   the same for every bonded validator's account
//   GET /api/health
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
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "read-only" });
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
