// The relay's gate (lib/relay.mjs): only the two sealing-account transaction
// shapes pass. Transactions here are real protobuf with dummy signatures; the
// relay never checks signatures (the chain does), only the shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { buildRegisterKemKeyMessage, generateSealKeys } from "@qorechain/qoreseal";
import { MAX_TX_BYTES, checkRelayTx, rateLimiter } from "../lib/relay.mjs";
import { memo } from "../lib/records.mjs";

const SEALER = "qor1nugsk7fcvcufx5ad4y82zfjwn3kyrn85e3d6cx";
const OWNER = "qor1gxxaq0vznphf4jmhgkyhg8af0nzkqwfrl6a6qd";
const OTHER = "qor17p9ekrjnwcd5qmwjhz4g5dc38w6f9dx9f2anxt";
const kemKey = generateSealKeys().mlkemPublicKey;

const tx = (messages, text = "", signatures = 1) => TxRaw.encode(TxRaw.fromPartial({
  bodyBytes: TxBody.encode(TxBody.fromPartial({ messages, memo: text })).finish(),
  authInfoBytes: new Uint8Array([1]),
  signatures: Array.from({ length: signatures }, () => new Uint8Array(64)),
})).finish();
// MsgRegisterPQCKeyV2 with field 1 (sender) = SEALER.
const pqcReg = { typeUrl: "/qorechain.pqc.v1.MsgRegisterPQCKeyV2", value: new Uint8Array([10, SEALER.length, ...new TextEncoder().encode(SEALER)]) };
const kem = (sender = SEALER) => buildRegisterKemKeyMessage({ sender, mlkemPublicKey: kemKey });
const send = ({ from = SEALER, to = SEALER, amount = "1", denom = "uqor" } = {}) => ({
  typeUrl: "/cosmos.bank.v1beta1.MsgSend",
  value: MsgSend.encode(MsgSend.fromPartial({ fromAddress: from, toAddress: to, amount: [{ denom, amount }] })).finish(),
});

test("the two sealing-account shapes pass", () => {
  assert.deepEqual(checkRelayTx(tx([pqcReg])), { ok: true, kind: "pqc-key", account: SEALER });
  assert.deepEqual(checkRelayTx(tx([kem(), send()], memo.sealer(OWNER))), { ok: true, kind: "kem-key-and-sealer-record", account: SEALER });
});

test("a key registration with a memo, or bundled with anything, is refused", () => {
  assert.equal(checkRelayTx(tx([pqcReg], "hello")).ok, false);
  assert.equal(checkRelayTx(tx([pqcReg, send()], memo.sealer(OWNER))).ok, false);
});

test("the key-and-record transaction must be exactly right", () => {
  const cases = {
    "plain memo": tx([kem(), send()], "hello"),
    "a bind record instead of a sealer record": tx([kem(), send()], memo.bind(OWNER)),
    "a Quorate record": tx([kem(), send()], `quorate/1 sealer ${OWNER}`),
    "sent to someone else": tx([kem(), send({ to: OTHER })], memo.sealer(OWNER)),
    "more than 1 uqor": tx([kem(), send({ amount: "2" })], memo.sealer(OWNER)),
    "another denom": tx([kem(), send({ denom: "ufoo" })], memo.sealer(OWNER)),
    "send from a different account": tx([kem(), send({ from: OTHER, to: OTHER })], memo.sealer(OWNER)),
    "vouching for itself": tx([kem(), send()], memo.sealer(SEALER)),
    "messages in the other order": tx([send(), kem()], memo.sealer(OWNER)),
    "send alone": tx([send()], memo.sealer(OWNER)),
    "key alone": tx([kem()], memo.sealer(OWNER)),
    "an extra message": tx([kem(), send(), send()], memo.sealer(OWNER)),
  };
  for (const [name, bytes] of Object.entries(cases)) assert.equal(checkRelayTx(bytes).ok, false, name);
});

test("anything else is refused before it reaches the chain", () => {
  const vote = { typeUrl: "/cosmos.gov.v1.MsgVote", value: new Uint8Array([8, 1]) };
  assert.equal(checkRelayTx(tx([vote])).ok, false);
  assert.equal(checkRelayTx(tx([])).ok, false);
  assert.equal(checkRelayTx(tx([pqcReg], "", 2)).ok, false, "two signers");
  assert.equal(checkRelayTx(new Uint8Array([1, 2, 3, 4])).ok, false, "garbage");
  assert.equal(checkRelayTx(new Uint8Array()).ok, false, "empty");
  assert.equal(checkRelayTx(new Uint8Array(MAX_TX_BYTES + 1)).ok, false, "too large");
});

test("the rate limiter caps each visitor and everyone together, then resets", () => {
  let now = 0;
  const allow = rateLimiter({ perKey: 2, globalMax: 3, windowMs: 1000, now: () => now });
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), false, "per visitor");
  assert.equal(allow("b"), true);
  assert.equal(allow("c"), false, "global cap");
  now = 1001;
  assert.equal(allow("a"), true, "new window");
});
