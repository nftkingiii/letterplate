// Where to seal for an address. Shared by the server, the CLI and the tests.
//
//   own       the address has its own ML-KEM-1024 key in the chain's registry: seal to it.
//   bound     no key of its own, but a two-way binding to a sealing account that has one: seal to that account's key.
//   one-sided the address names a sealing account that has not named it back (or has since named someone else).
//   no-key    a two-way binding exists, but the sealing account has no key in the registry (yet).
//   none      nothing: this address cannot receive sealed mail.
//
// Rules for a record to count: hybrid-signed (secp256k1 + ML-DSA-87), successful,
// a single MsgSend from the account to itself, memo in records.mjs. The
// latest valid record of each kind wins, so an owner can rebind after losing a
// sealing key, and a sealing account belongs to one owner at a time. A key of
// the address's own always wins over a binding: the registry is the chain's word.
import { createHash } from "node:crypto";
import { parseMemo, RECORD_UQOR } from "./records.mjs";
import { kemKey as chainKemKey, txsTo as chainTxsTo } from "./chain.mjs";

const sha3 = (b64) => createHash("sha3-256").update(Buffer.from(b64, "base64")).digest("hex");

/** Valid records an account sent to itself, plus the ones refused and why. */
export function recordsOf(address, txs) {
  const valid = [];
  const refused = [];
  for (const t of txs) {
    const rec = parseMemo(t.memo);
    if (!rec) continue;
    const why =
      !t.hybrid ? "not hybrid-signed" :
      t.from !== address ? "sent by another account" :
      t.to !== address ? "not sent to itself" :
      t.sends !== 1 ? "more than one transfer in the transaction" :
      (rec.kind === "bind" ? rec.sealer : rec.owner) === address ? "names its own address" :
      null;
    const entry = { ...rec, tx: t.hash, height: t.height, time: t.time };
    if (why) refused.push({ ...entry, from: t.from, reason: why });
    else valid.push(entry);
  }
  valid.sort((a, b) => a.height - b.height);
  return { valid, refused };
}

const latest = (records, kind) => records.filter((r) => r.kind === kind).at(-1) ?? null;

/**
 * @param {string} address  qor1 account address
 * @param {{ txsTo?: (a: string) => Promise<object[]>, kemKey?: (a: string) => Promise<{found: boolean, publicKey: string|null}> }} [io]
 */
export async function resolve(address, io = {}) {
  const txsTo = io.txsTo ?? ((a) => chainTxsTo(a));
  const kemKey = io.kemKey ?? ((a) => chainKemKey(a));

  const [own, ownTxs] = await Promise.all([kemKey(address), txsTo(address)]);
  const mine = recordsOf(address, ownTxs);
  const bind = latest(mine.valid, "bind");
  // When the node has pruned old blocks, records older than this could not be read.
  const base = { address, refused: mine.refused, historyFrom: ownTxs.prunedBefore ?? null };

  if (own.found) {
    return { ...base, status: "own", sealTo: address, publicKeySha3: sha3(own.publicKey), bind };
  }
  if (!bind) return { ...base, status: "none", sealTo: null };

  const [theirs, sealerKey] = await Promise.all([txsTo(bind.sealer), kemKey(bind.sealer)]);
  const other = recordsOf(bind.sealer, theirs);
  const claim = latest(other.valid, "sealer");
  const sealer = { address: bind.sealer, claim, refused: other.refused, historyFrom: theirs.prunedBefore ?? null };

  if (!claim) return { ...base, status: "one-sided", sealTo: null, bind, sealer, reason: "the sealing account has not named this address back" };
  if (claim.owner !== address) return { ...base, status: "one-sided", sealTo: null, bind, sealer, reason: `the sealing account now holds the key for ${claim.owner}` };
  if (!sealerKey.found) return { ...base, status: "no-key", sealTo: null, bind, sealer, reason: "the sealing account has no encryption key in the registry" };
  return { ...base, status: "bound", sealTo: bind.sealer, publicKeySha3: sha3(sealerKey.publicKey), bind, sealer };
}

export { RECORD_UQOR };
