// The server's guard rails over real HTTP. Only routes that answer without the chain, so it runs offline.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 19000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
let proc;

before(async () => {
  proc = spawn(process.execPath, [fileURLToPath(new URL("../server/index.mjs", import.meta.url))], {
    env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${BASE}/api/health`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("server did not start");
});
after(() => proc?.kill());

test("read-only: only GET and HEAD", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) assert.equal((await fetch(`${BASE}/api/resolve`, { method })).status, 405, method);
});

test("bad parameters are refused before touching the chain", async () => {
  for (const a of ["", "qor1x", "QOR1GXXAQ0VZNPHF4JMHGKYHG8AF0NZKQWFRL6A6QD", "qorvaloper1gyvjym2qmf4fckpn68ehkwj9yr30eelpqr8vj2", "../etc/passwd"]) {
    assert.equal((await fetch(`${BASE}/api/resolve?address=${encodeURIComponent(a)}`)).status, 400, a);
  }
  assert.equal((await fetch(`${BASE}/api/validators?network=devnet`)).status, 400);
  assert.equal((await fetch(`${BASE}/api/nope`)).status, 404);
});

test("project files are never served, and errors carry no internal detail", async () => {
  for (const p of ["/package.json", "/.env", "/.env.example", "/server/index.mjs", "/lib/resolve.mjs", "/PROJECT_STATE.md", "/..%2fpackage.json", "/assets/", "/does/not/exist"]) {
    const res = await fetch(`${BASE}${p}`);
    assert.ok(res.status === 200 || res.status === 503, `${p} -> ${res.status}`); // the app shell, or 503 when not built
    const body = await res.text();
    assert.ok(!/"dependencies"|createServer|QORE_REST_PROXY_TARGET|Project State|EISDIR|ENOENT|node:internal/.test(body), `${p} leaked a project file`);
  }
});

test("security headers are set", async () => {
  const res = await fetch(`${BASE}/api/health`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.match(res.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});
