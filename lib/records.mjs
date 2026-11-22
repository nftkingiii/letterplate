// Letterplate records: how an account says where its sealed mail should go.
//
// An account that has its own ML-KEM-1024 key in QoreChain's registry needs no
// record: seal to it directly. An account that has none (real QoreX will not
// register one from a website) can point to a sealing account instead. The
// pointer counts only when both sides say so, each in a hybrid-signed
// transaction sent to itself (1 uqor, memo below):
//
//   letterplate/1 bind <sealing account>    from the owner:          "seal my mail to this account's key"
//   letterplate/1 sealer <owner>            from the sealing account: "I hold the key for this owner"
//
// Sending to itself keeps the records with the account: anyone can find them by
// listing the transfers an address received, with no registry account to trust.
export const PREFIX = "letterplate/1";
export const RECORD_UQOR = "1";

const ADDRESS = "qor1[02-9ac-hj-np-z]{38}";
const PATTERNS = {
  bind: new RegExp(`^letterplate/1 bind (${ADDRESS})$`),
  sealer: new RegExp(`^letterplate/1 sealer (${ADDRESS})$`),
};

export const memo = {
  bind: (sealer) => `${PREFIX} bind ${sealer}`,
  sealer: (owner) => `${PREFIX} sealer ${owner}`,
};

/** Parse a memo into a record, or null when it is not a Letterplate record. */
export function parseMemo(text) {
  if (typeof text !== "string") return null;
  let m;
  if ((m = PATTERNS.bind.exec(text))) return { kind: "bind", sealer: m[1] };
  if ((m = PATTERNS.sealer.exec(text))) return { kind: "sealer", owner: m[1] };
  return null;
}
