// What the "Your address" flow needs to know about the sealing account.
// `getJson` is passed in so tests can simulate a chain that answers or fails.
// Adapted from Quorate (github.com/nftkingiii/quorate, lib/accounts.mjs).
import { createHash } from "node:crypto";

const sha3 = (bytes) => createHash("sha3-256").update(bytes).digest("hex");

/**
 * A failed read throws: it must never look like "no key registered", or the page
 * would offer to register a new key on top of one that exists.
 */
export async function readAccount(getJson, rest, address) {
  const [pqc, kem, bank, auth] = await Promise.all([
    getJson(`${rest}/qorechain/pqc/v1/account/${address}`).catch(() => null),
    getJson(`${rest}/qorechain/pqc/v1/kem/${address}`).catch(() => null),
    getJson(`${rest}/cosmos/bank/v1beta1/balances/${address}`).catch(() => null),
    getJson(`${rest}/cosmos/auth/v1beta1/accounts/${address}`).catch(() => null), // absent until the account first receives funds
  ]);
  if (!pqc || !kem || !bank) throw new Error("Could not read this account from the chain");
  const base = auth?.account?.base_account ?? auth?.account;
  const pk = kem.key?.public_key ?? null;
  return {
    address,
    signingKey: pqc.found ? { type: pqc.account?.key_type ?? null, possessionProven: pqc.account?.possession_proven === true } : null,
    encryptionKey: { found: kem.found === true, publicKeySha3: pk ? sha3(Buffer.from(pk, "base64")) : null },
    balanceUqor: bank.balances?.find((b) => b.denom === "uqor")?.amount ?? "0",
    accountNumber: base?.account_number != null ? Number(base.account_number) : null,
    sequence: base?.sequence != null ? Number(base.sequence) : null,
    readAt: new Date().toISOString(),
  };
}
