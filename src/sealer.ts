// The owner's sealing account. Real QoreX will not let a website register an
// encryption key (and has no setting for one), so the page runs a small account
// that holds the owner's ML-KEM-1024 key on chain, bound both ways to the
// owner's QoreX account (lib/resolve.mjs). Everything comes from one 32-byte
// secret kept in the passphrase-encrypted backup:
//
//   secp256k1 account key = SHA3-256("letterplate/sealer/account/v1" || secret)
//   ML-DSA-87 key         = from the recovery code of SHA3-256("letterplate/sealer/pqc/v1" || secret)
//   ML-KEM-1024 key       = QoreSeal keys from SHA3-256("letterplate/sealer/seal/v1" || secret)
//
// Transactions are signed here and sent through the server's narrow relay,
// because QoreChain's broadcast endpoint accepts no browser requests (CORS).
// Adapted from Quorate (github.com/nftkingiii/quorate, web/src/sealer.ts).
import { sha3_256 } from "@noble/hashes/sha3.js";
import { buildRegisterKemKeyMessage, sealKeysFromSeed } from "@qorechain/qoreseal";
import type { SealKeyPair } from "@qorechain/qoreseal";
import {
  buildHybridTx,
  buildRegisterPqcKeyMsg,
  directSignerFromPrivateKey,
  pqcKeyFromRecoveryCode,
  pqcRecoveryCodeFromSecret,
  qorechainRegistry,
  signProofOfPossession,
} from "@qorechain/sdk";
import type { PqcKeypair } from "@qorechain/sdk";
import { encodePubkey, makeAuthInfoBytes, makeSignDoc } from "@cosmjs/proto-signing";
import type { OfflineDirectSigner } from "@cosmjs/proto-signing";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { CHAIN_ID, encodeMsgSend } from "./wallet";

const GAS_PRICE_UQOR_PER_1000 = 150n; // 0.15 uqor per gas, as QoreX uses
const enc = new TextEncoder();
const derive = (label: string, secret: Uint8Array) => sha3_256(new Uint8Array([...enc.encode(label), ...secret]));

export type Sealer = {
  address: string;
  sealKeys: SealKeyPair;
  signer: OfflineDirectSigner;
  pubkey: Uint8Array;
  pqc: PqcKeypair;
};

export async function deriveSealer(secret: Uint8Array): Promise<Sealer> {
  if (secret.length !== 32) throw new Error("The sealing secret must be 32 bytes");
  const accountKey = derive("letterplate/sealer/account/v1", secret);
  // The signer keeps a reference to the key it is given, so it gets its own copy; ours is wiped below.
  const signer = await directSignerFromPrivateKey(accountKey.slice(), "qor");
  const [acct] = await signer.getAccounts();
  const pqc = pqcKeyFromRecoveryCode(pqcRecoveryCodeFromSecret(derive("letterplate/sealer/pqc/v1", secret)), acct.address);
  const sealKeys = sealKeysFromSeed(derive("letterplate/sealer/seal/v1", secret));
  accountKey.fill(0);
  return { address: acct.address, sealKeys, signer, pubkey: acct.pubkey, pqc };
}

const fee = (gas: bigint) => ({ amount: [{ denom: "uqor", amount: ((gas * GAS_PRICE_UQOR_PER_1000 + 999n) / 1000n).toString() }], gas: gas.toString() });

/**
 * Transaction 1: register the sealing account's ML-DSA-87 key, with a proof of
 * possession. The chain accepts this one message with the classical signature
 * only, and requires it as a new account's first transaction.
 */
export async function buildKeyRegistration(s: Sealer, accountNumber: number, sequence: number): Promise<Uint8Array> {
  const proofOfPossession = signProofOfPossession({ chainId: CHAIN_ID, account: s.address, keypair: s.pqc });
  const msg = buildRegisterPqcKeyMsg(s.address, { pqcKeypair: s.pqc, proofOfPossession });
  const registry = qorechainRegistry();
  const gas = 600000n;
  const bodyBytes = registry.encodeTxBody({ messages: [msg], memo: "" });
  const pubkey = encodePubkey({ type: "tendermint/PubKeySecp256k1", value: toBase64(s.pubkey) });
  const f = fee(gas);
  const authInfoBytes = makeAuthInfoBytes([{ pubkey, sequence }], f.amount, Number(gas), undefined, undefined);
  const { signature, signed } = await s.signer.signDirect(s.address, makeSignDoc(bodyBytes, authInfoBytes, CHAIN_ID, accountNumber));
  return TxRaw.encode(TxRaw.fromPartial({
    bodyBytes: signed.bodyBytes, authInfoBytes: signed.authInfoBytes, signatures: [fromBase64(signature.signature)],
  })).finish();
}

/**
 * Transaction 2, hybrid-signed: publish the ML-KEM-1024 key and the sealing
 * account's half of the binding ("letterplate/1 sealer <owner>", 1 uqor to itself).
 */
export async function buildKeyAndRecord(s: Sealer, accountNumber: number, sequence: number, owner: string): Promise<Uint8Array> {
  const registry = qorechainRegistry();
  const kem = buildRegisterKemKeyMessage({ sender: s.address, mlkemPublicKey: s.sealKeys.mlkemPublicKey });
  const send = { typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: MsgSend.decode(encodeMsgSend(s.address, s.address, "uqor", "1")) };
  const built = await buildHybridTx({
    registry, signer: s.signer, pqcKeypair: s.pqc,
    messages: [{ typeUrl: kem.typeUrl, value: registry.decode({ typeUrl: kem.typeUrl, value: kem.value }) }, send],
    fee: fee(500000n), memo: `letterplate/1 sealer ${owner}`,
    chainId: CHAIN_ID, accountNumber, sequence,
    signBytesVersion: "v2", // qorechain-diana signs v2 since v3.1.98; "auto" would need a browser call the chain refuses (CORS)
  });
  return built.txRawBytes;
}

/** What the sealing account spends on its own two transactions (QoreX's fee for funding it is separate). */
export const SEALER_FEES_UQOR = Number(fee(600000n).amount[0].amount) + Number(fee(500000n).amount[0].amount) + 1;
export const SEALER_FUNDING_UQOR = 300000; // 0.3 test QOR covers both with room to spare

function toBase64(b: Uint8Array) { return btoa(Array.from(b, (x) => String.fromCharCode(x)).join("")); }
function fromBase64(s: string) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

/** Sends signed bytes through the server's relay; resolves once the chain includes them. */
export async function relay(txBytes: Uint8Array): Promise<{ txHash: string; height: number }> {
  const res = await fetch("/api/relay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txBytes: toBase64(txBytes) }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The relay refused the transaction (${res.status})`);
  const txHash: string = body.txHash;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const t = await fetch(`/api/tx?hash=${txHash}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (t?.found) {
      if (t.code !== 0) throw new Error(`The chain refused the transaction (code ${t.code}): ${t.rawLog ?? ""}`.trim());
      return { txHash, height: t.height };
    }
  }
  throw new Error(`Sent ${txHash}, but it was not seen in a block within a minute. Check again shortly.`);
}
