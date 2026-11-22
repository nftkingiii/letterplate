// QoreChain testnet reads used by the resolver and the server. Public data only.
export const NETWORKS = {
  testnet: { rest: "https://api-testnet.qore.host", chainId: "qorechain-diana" },
  mainnet: { rest: "https://api.qore.host", chainId: "qorechain-vladi" },
};
export const REST = NETWORKS.testnet.rest;

/** GET JSON with a few retries; the public endpoint drops requests now and then. */
export async function getJson(url, { attempts = 3, timeoutMs = 20000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw Object.assign(new Error(`${res.status} from ${new URL(url).host}`), { status: res.status, body: body.slice(0, 300) });
      }
      return await res.json();
    } catch (err) {
      if (attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

/** A transfer as Letterplate needs it, with proof it was post-quantum signed. */
export function summarise(tx, resp) {
  const ext = [...(tx.body.extension_options ?? []), ...(tx.body.non_critical_extension_options ?? [])];
  const events = new Set((resp.events ?? []).map((e) => e.type));
  const sends = tx.body.messages.filter((m) => m["@type"] === "/cosmos.bank.v1beta1.MsgSend");
  const send = sends[0];
  return {
    hash: resp.txhash,
    height: Number(resp.height),
    time: resp.timestamp ?? null,
    code: resp.code,
    memo: tx.body.memo ?? "",
    from: send?.from_address ?? null,
    to: send?.to_address ?? null,
    sends: sends.length,
    hybrid: ext.some((e) => e["@type"] === "/qorechain.pqc.v1.PQCHybridSignature") && events.has("pqc_hybrid_verify"),
  };
}

/**
 * Every successful transfer received by `address` that the node still holds, oldest first.
 *
 * Public nodes prune old blocks: a search that reaches a pruned height fails
 * ("height N is not available, lowest height is M"). So read newest first and
 * stop there. The result then carries `prunedBefore: M`, and callers must say
 * that records older than block M could not be read.
 */
export async function txsTo(address, rest = REST, get = getJson) {
  const out = [];
  let prunedBefore = null;
  const q = encodeURIComponent(`transfer.recipient='${address}'`);
  for (let page = 1; page <= 20; page++) {
    let d;
    try {
      d = await get(`${rest}/cosmos/tx/v1beta1/txs?query=${q}&page=${page}&limit=100&order_by=ORDER_BY_DESC`, { attempts: 1 });
    } catch (err) {
      const m = /lowest height is (\d+)/.exec(String(err.body ?? err.message));
      if (m) { prunedBefore = Number(m[1]); break; }
      // Not a pruning answer: retry this page normally, so a flaky read still fails loudly.
      d = await get(`${rest}/cosmos/tx/v1beta1/txs?query=${q}&page=${page}&limit=100&order_by=ORDER_BY_DESC`);
    }
    (d.txs ?? []).forEach((tx, i) => out.push(summarise(tx, d.tx_responses[i])));
    if (out.length >= Number(d.total ?? 0) || !d.txs?.length) break;
  }
  const txs = out.filter((t) => t.code === 0).sort((a, b) => a.height - b.height);
  return Object.assign(txs, { prunedBefore });
}

/** The account's ML-KEM-1024 key from the registry: { found, publicKey (base64) | null }. Throws if unreadable. */
export async function kemKey(address, rest = REST, get = getJson) {
  const d = await get(`${rest}/qorechain/pqc/v1/kem/${address}`);
  return { found: d.found === true, publicKey: d.key?.public_key ?? null };
}
