// Every resolver state and refusal rule, with fixture chain data (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, recordsOf } from "../lib/resolve.mjs";
import { memo, parseMemo } from "../lib/records.mjs";
import { isQorAddress } from "../lib/bech32.mjs";

const OWNER = "qor1gxxaq0vznphf4jmhgkyhg8af0nzkqwfrl6a6qd";
const SEALER = "qor1nugsk7fcvcufx5ad4y82zfjwn3kyrn85e3d6cx";
const SEALER2 = "qor1aq8tx4y2jke8snqgu6ajdav23nyyw7cznt9c4q";
const OTHER = "qor17p9ekrjnwcd5qmwjhz4g5dc38w6f9dx9f2anxt";
const KEY = Buffer.alloc(1568, 7).toString("base64");

let n = 0;
const rec = (from, text, extra = {}) => ({ hash: `TX${++n}`, height: 100 + n, time: null, code: 0, memo: text, from, to: from, sends: 1, hybrid: true, ...extra });

/** A fake chain: transfers received per address, and which addresses have a registry key. */
function chain(txs, keys = []) {
  return {
    txsTo: async (a) => txs.filter((t) => t.to === a),
    kemKey: async (a) => (keys.includes(a) ? { found: true, publicKey: KEY } : { found: false, publicKey: null }),
  };
}

test("memos round-trip and nothing else parses", () => {
  assert.deepEqual(parseMemo(memo.bind(SEALER)), { kind: "bind", sealer: SEALER });
  assert.deepEqual(parseMemo(memo.sealer(OWNER)), { kind: "sealer", owner: OWNER });
  for (const bad of ["", "letterplate/1 bind", `letterplate/2 bind ${SEALER}`, `letterplate/1 bind ${SEALER} `, `letterplate/1 bind ${SEALER.toUpperCase()}`, `quorate/1 bind ${SEALER}`, `letterplate/1 bind qorvaloper1gyvjym2qmf4fckpn68ehkwj9yr30eelpqr8vj2`]) {
    assert.equal(parseMemo(bad), null, bad);
  }
  assert.ok(isQorAddress(OWNER));
  assert.ok(!isQorAddress(OWNER.toUpperCase()));
  assert.ok(!isQorAddress("qor1x"));
});

test("own key: seal to the address itself, and it wins over any binding", async () => {
  const r = await resolve(OWNER, chain([rec(OWNER, memo.bind(SEALER)), rec(SEALER, memo.sealer(OWNER))], [OWNER, SEALER]));
  assert.equal(r.status, "own");
  assert.equal(r.sealTo, OWNER);
  assert.match(r.publicKeySha3, /^[0-9a-f]{64}$/);
});

test("nothing on chain: cannot receive", async () => {
  const r = await resolve(OWNER, chain([]));
  assert.equal(r.status, "none");
  assert.equal(r.sealTo, null);
});

test("two-way binding to a sealing account with a key: seal to the sealing account", async () => {
  const r = await resolve(OWNER, chain([rec(OWNER, memo.bind(SEALER)), rec(SEALER, memo.sealer(OWNER))], [SEALER]));
  assert.equal(r.status, "bound");
  assert.equal(r.sealTo, SEALER);
});

test("one side only: the owner's claim alone is not enough", async () => {
  const r = await resolve(OWNER, chain([rec(OWNER, memo.bind(SEALER))], [SEALER]));
  assert.equal(r.status, "one-sided");
  assert.equal(r.sealTo, null);
  assert.match(r.reason, /not named this address back/);
});

test("a sealing account cannot be borrowed: it must name this owner", async () => {
  // OTHER claims SEALER's key, but SEALER says it holds the key for OWNER.
  const txs = [rec(OWNER, memo.bind(SEALER)), rec(SEALER, memo.sealer(OWNER)), rec(OTHER, memo.bind(SEALER))];
  const thief = await resolve(OTHER, chain(txs, [SEALER]));
  assert.equal(thief.status, "one-sided");
  assert.match(thief.reason, new RegExp(OWNER));
  assert.equal((await resolve(OWNER, chain(txs, [SEALER]))).status, "bound");
});

test("bound, but the sealing account has no key yet", async () => {
  const r = await resolve(OWNER, chain([rec(OWNER, memo.bind(SEALER)), rec(SEALER, memo.sealer(OWNER))], []));
  assert.equal(r.status, "no-key");
  assert.equal(r.sealTo, null);
});

test("rebinding after a lost key: the latest binding wins", async () => {
  const txs = [
    rec(OWNER, memo.bind(SEALER)), rec(SEALER, memo.sealer(OWNER)),
    rec(SEALER2, memo.sealer(OWNER)), rec(OWNER, memo.bind(SEALER2)),
  ];
  const r = await resolve(OWNER, chain(txs, [SEALER, SEALER2]));
  assert.equal(r.status, "bound");
  assert.equal(r.sealTo, SEALER2);
});

test("a sealing account that moves to another owner stops serving the first", async () => {
  const txs = [rec(OWNER, memo.bind(SEALER)), rec(SEALER, memo.sealer(OWNER)), rec(SEALER, memo.sealer(OTHER))];
  assert.equal((await resolve(OWNER, chain(txs, [SEALER]))).status, "one-sided");
});

test("refused records, each with its reason", () => {
  const txs = [
    rec(OWNER, memo.bind(SEALER), { hybrid: false }),
    rec(OWNER, memo.bind(SEALER), { to: SEALER }),
    rec(OTHER, memo.bind(SEALER), { to: OWNER }),
    rec(OWNER, memo.bind(SEALER), { sends: 2 }),
    rec(OWNER, memo.bind(OWNER)),
    rec(OWNER, "hello"),
  ];
  const { valid, refused } = recordsOf(OWNER, txs);
  assert.equal(valid.length, 0);
  assert.deepEqual(refused.map((r) => r.reason), [
    "not hybrid-signed",
    "not sent to itself",
    "sent by another account",
    "more than one transfer in the transaction",
    "names its own address",
  ]);
});

test("a classical-only binding never counts, even when both halves exist", async () => {
  const txs = [rec(OWNER, memo.bind(SEALER), { hybrid: false }), rec(SEALER, memo.sealer(OWNER))];
  const r = await resolve(OWNER, chain(txs, [SEALER]));
  assert.equal(r.status, "none");
  assert.equal(r.refused[0].reason, "not hybrid-signed");
});

test("a chain read that fails is an error, never 'cannot receive'", async () => {
  const broken = { txsTo: async () => { throw new Error("timeout"); }, kemKey: async () => ({ found: false, publicKey: null }) };
  await assert.rejects(resolve(OWNER, broken), /timeout/);
  const brokenKey = { txsTo: async () => [], kemKey: async () => { throw new Error("502"); } };
  await assert.rejects(resolve(OWNER, brokenKey), /502/);
});

test("a pruned node: newest records are still read, and the gap is reported", async () => {
  const { txsTo } = await import("../lib/chain.mjs");
  const tx = (h) => ({ body: { messages: [{ "@type": "/cosmos.bank.v1beta1.MsgSend", from_address: OWNER, to_address: OWNER }], memo: memo.bind(SEALER), extension_options: [{ "@type": "/qorechain.pqc.v1.PQCHybridSignature" }] } });
  const resp = (h) => ({ txhash: `H${h}`, height: String(h), code: 0, events: [{ type: "pqc_hybrid_verify" }] });
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    assert.match(url, /ORDER_BY_DESC/);
    if (/page=1&/.test(url)) return { txs: [tx(9000002), tx(9000001)], tx_responses: [resp(9000002), resp(9000001)], total: "300" };
    throw Object.assign(new Error("500 from api-testnet.qore.host"), { body: '{"code":13,"message":"height 5654014 is not available, lowest height is 8790799"}' });
  };
  const got = await txsTo(OWNER, "https://x", get);
  assert.equal(got.prunedBefore, 8790799);
  assert.deepEqual(got.map((t) => t.height), [9000001, 9000002]); // oldest first
  assert.ok(got.every((t) => t.hybrid));

  const r = await resolve(OWNER, { txsTo: async () => Object.assign([], { prunedBefore: 8790799 }), kemKey: async () => ({ found: false, publicKey: null }) });
  assert.equal(r.status, "none");
  assert.equal(r.historyFrom, 8790799);
});

test("a failure that is not pruning still fails loudly", async () => {
  const { txsTo } = await import("../lib/chain.mjs");
  const get = async () => { throw Object.assign(new Error("503 from api-testnet.qore.host"), { body: "upstream down" }); };
  await assert.rejects(txsTo(OWNER, "https://x", get), /503/);
});
