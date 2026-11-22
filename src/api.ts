// Calls to the Letterplate server. The browser never talks to the chain's REST API directly (no CORS there).

export type Status = "own" | "bound" | "one-sided" | "no-key" | "none";

export interface RecordRef {
  kind: "bind" | "sealer";
  sealer?: string;
  owner?: string;
  tx: string;
  height: number;
  time: string | null;
}

export interface Refused extends RecordRef {
  from: string | null;
  reason: string;
}

export interface Resolution {
  address: string;
  network: string;
  status: Status;
  sealTo: string | null;
  publicKeySha3?: string;
  reason?: string;
  bind?: RecordRef | null;
  sealer?: { address: string; claim: RecordRef | null; refused: Refused[]; historyFrom: number | null };
  refused: Refused[];
  /** The node pruned blocks before this height: older records could not be read. */
  historyFrom: number | null;
  readAt: string;
}

export interface ValidatorRow {
  name: string;
  address: string;
  votingPowerBps: number;
  status: Status;
  sealTo: string | null;
  historyFrom: number | null;
}

export interface Validators {
  network: "testnet" | "mainnet";
  chainId: string;
  rows: ValidatorRow[];
  canReceive: number;
  readAt: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}`);
  return body as T;
}

export const resolveAddress = (address: string) => get<Resolution>(`/api/resolve?address=${encodeURIComponent(address)}`);
export const listValidators = (network: "testnet" | "mainnet") => get<Validators>(`/api/validators?network=${network}`);

export const QOR_ADDRESS = /^qor1[02-9ac-hj-np-z]{38}$/;
