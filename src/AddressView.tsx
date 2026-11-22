// "Your address": give the connected QoreX account an address it can receive sealed mail at.
// One valid next action at a time:
//   connect → read the chain → (already can receive: done)
//   → sealing key (create, or load a backup) → fund it from QoreX → it registers its signing key
//   → it publishes its encryption key and its half of the binding → QoreX sends your half → done.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { resolveAddress, type Resolution } from "./api";
import { useWallet } from "./WalletContext";
import { CHAIN_ID, bindSealer, explain, fundSealer } from "./wallet";
import { MIN_PASSPHRASE, createSecret, downloadJson, exportBackup, importBackup, keyFingerprint } from "./sealkey";
import { SEALER_FEES_UQOR, SEALER_FUNDING_UQOR, buildKeyAndRecord, buildKeyRegistration, deriveSealer, relay, type Sealer } from "./sealer";
import { CopyButton, short } from "./ui";

type Account = {
  address: string;
  signingKey: { type: string | null; possessionProven: boolean } | null;
  encryptionKey: { found: boolean; publicKeySha3: string | null };
  balanceUqor: string;
  accountNumber: number | null;
  sequence: number | null;
};
type Done = { what: string; txHash: string; height?: number; via: string };

async function readAccount(a: string): Promise<Account> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`/api/account?address=${a}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.status);
      return body;
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw new Error(`Could not read ${short(a)} from the chain (${(last as Error)?.message}). Try again shortly.`);
}

export function AddressView() {
  const { hasWallet, mock, address, connect, connectedAt, sealer, setSealer } = useWallet();
  const [res, setRes] = useState<Resolution | null>(null);
  const [acct, setAcct] = useState<Account | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [replacing, setReplacing] = useState(false); // the owner lost the bound key and makes a new one
  const [bindSent, setBindSent] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!address) return;
    try { setRes(await resolveAddress(address)); } catch (e) { setError(explain(e)); }
  }, [address]);
  const refreshAcct = useCallback(async (s: Sealer) => setAcct(await readAccount(s.address)), []);

  useEffect(() => { setRes(null); setDone([]); setReplacing(false); setBindSent(null); void reload(); }, [address, reload]);
  useEffect(() => { setAcct(null); if (sealer) refreshAcct(sealer).catch((e) => setError((e as Error).message)); }, [sealer, refreshAcct]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (e) { setError(explain(e)); } finally { setBusy(null); }
  };
  const after = async (what: string, r: { txHash: string; height?: number }, via: string) => {
    setDone((d) => [...d, { what, txHash: r.txHash, height: r.height, via }]);
    if (sealer) await refreshAcct(sealer);
    await reload();
  };

  const fresh = !!res && Date.parse(res.readAt) >= connectedAt - 60_000 && res.address === address;
  const kemPublished = !!(sealer && acct?.encryptionKey.found && acct.encryptionKey.publicKeySha3 === keyFingerprint(sealer.sealKeys));
  const hasSigningKey = !!acct?.signingKey;
  const balance = Number(acct?.balanceUqor ?? 0);
  const boundToThis = !!(sealer && res?.status === "bound" && res.sealTo === sealer.address);
  const namedSealer = res?.bind?.sealer ?? null; // the sealing account this owner's latest bind record names

  const step =
    !hasWallet ? "install" : !address ? "connect" : !fresh ? "loading"
    : res!.status === "own" ? "own"
    : boundToThis ? "done"
    : res!.status === "bound" && !sealer && !replacing ? "bound"
    : !sealer ? (namedSealer && !replacing ? "import" : "create")
    : namedSealer && namedSealer !== sealer.address && res!.status === "bound" && !replacing ? "mismatch"
    : !acct ? "loading"
    : !hasSigningKey && balance < SEALER_FEES_UQOR ? "fund"
    : !hasSigningKey ? "register"
    : !kemPublished ? "publish"
    : namedSealer !== sealer.address ? (bindSent === sealer.address ? "confirming" : "bind")
    : "confirming";

  const STEPS: { n: string; label: ReactNode; done: boolean; on: string[] }[] = [
    { n: "1", label: <>Connect QoreX{address && <span className="mono muted"> · {short(address)}</span>}</>, done: !!address, on: ["install", "connect"] },
    { n: "2", label: <>Sealing key in this browser{sealer && <span className="mono muted"> · {short(sealer.address, 8, 4)}</span>}</>, done: !!sealer || step === "own" || step === "bound", on: ["create", "import", "mismatch"] },
    { n: "3", label: "Sealing account funded, its signing key registered", done: hasSigningKey || step === "own" || step === "bound", on: ["fund", "register"] },
    { n: "4", label: "Encryption key published", done: kemPublished || step === "own" || step === "bound", on: ["publish"] },
    { n: "5", label: "Bound to your QoreX account, both ways", done: boundToThis || step === "own" || step === "bound", on: ["bind", "confirming"] },
  ];

  return (
    <section className="address">
      <h1>Get an address for sealed mail</h1>
      <p className="lede">QoreX cannot register an encryption key for you, from a website or from its own settings. Letterplate gives your QoreX account one: a small sealing account that holds an ML-KEM-1024 key, bound to you on chain in both directions.</p>
      {mock && <p className="note"><strong>Test wallet.</strong> This page is being driven by the official QoreX wallet mock, a test double that signs for real on testnet.</p>}

      <div className="flow">
        <ol className="steps">
          {STEPS.map((s) => (
            <li key={s.n} className={s.done ? "done" : s.on.includes(step) ? "current" : ""}>
              <span className="num">{s.done ? "✓" : s.n}</span><span>{s.label}</span>
            </li>
          ))}
        </ol>

        <div className="panel" aria-live="polite">
          {error && <p className="error" role="alert">{error}</p>}

          {step === "install" && <Panel title="QoreX was not found"><p>Install the QoreX browser extension and switch it to Testnet. This page notices it as soon as it appears.</p></Panel>}

          {step === "connect" && (
            <Panel title="Connect your QoreX account">
              <p>The page learns your qor1 address and nothing else. If QoreX is locked, unlock it from your browser's toolbar first.</p>
              <button className="btn brass" disabled={!!busy} onClick={() => run("connect", async () => { await connect(); })}>{busy ? "Waiting for QoreX…" : "Connect QoreX"}</button>
            </Panel>
          )}

          {step === "loading" && <Panel title="Reading the chain"><p>Checking whether this account can already receive sealed mail.</p><Retry onTick={reload} every={4000} /></Panel>}

          {step === "own" && res && (
            <Panel title="You can already receive sealed mail">
              <p>This account has its own encryption key in QoreChain's registry. Anyone can seal to it directly; nothing to set up.</p>
              <SealTo r={res} />
            </Panel>
          )}

          {step === "bound" && res && (
            <Panel title="You can receive sealed mail">
              <p>Your QoreX account is bound to a sealing account with a published key. Keep your backup file and passphrase: they are the only way to open what is sealed to you.</p>
              <SealTo r={res} />
              <button className="btn ghost" onClick={() => { setReplacing(true); setError(null); }}>I lost my backup: make a new key</button>
            </Panel>
          )}

          {step === "create" && address && (
            <>
              {replacing && <p className="note">Mail already sealed to your old key cannot be recovered. Once the new binding lands, anything sealed from then on goes to the new key.</p>}
              <CreateKey owner={address} onReady={(s) => { setSealer(s); setError(null); }} onError={setError} />
              <details className="alt"><summary>I already have a Letterplate backup</summary><ImportKey owner={address} expect={null} onReady={(s) => { setSealer(s); setError(null); }} onError={setError} /></details>
            </>
          )}

          {step === "import" && address && namedSealer && (
            <>
              <ImportKey owner={address} expect={namedSealer} onReady={(s) => { setSealer(s); setError(null); }} onError={setError} />
              <div className="alt">
                <p className="muted small">Lost it? Mail sealed to that key cannot be recovered, but you can make a new key and bind it instead.</p>
                <button className="btn ghost" onClick={() => { setReplacing(true); setError(null); }}>Make a new key</button>
              </div>
            </>
          )}

          {step === "mismatch" && sealer && namedSealer && (
            <Panel title="This is not your bound key">
              <p>Your account is bound to {short(namedSealer)}, but this key belongs to {short(sealer.address)}. Load the backup of the bound key, or make a new key on purpose.</p>
              <div className="row"><button className="btn ghost" onClick={() => setSealer(null)}>Load a different backup</button><button className="btn ghost" onClick={() => setReplacing(true)}>Replace it with this key</button></div>
            </Panel>
          )}

          {step === "fund" && address && sealer && (
            <Panel title="Fund your sealing account">
              <p>It pays for its own two transactions. QoreX sends it {(SEALER_FUNDING_UQOR / 1e6).toFixed(1)} test QOR from your account; you approve it in QoreX.</p>
              <button className="btn brass" disabled={!!busy} onClick={() => run("fund", async () => {
                await after("Sealing account funded", await fundSealer(address, sealer.address, SEALER_FUNDING_UQOR), "QoreX");
              })}>{busy ? "Waiting for QoreX…" : `Send ${(SEALER_FUNDING_UQOR / 1e6).toFixed(1)} QOR with QoreX`}</button>
            </Panel>
          )}

          {step === "register" && sealer && acct && (
            <Panel title="Register its signing key">
              <p>The sealing account's ML-DSA-87 key, with a proof of possession. Signed in this browser and sent through Letterplate's relay, which forwards only these two sealing-account transactions. No QoreX prompt.</p>
              <div className="row">
                <button className="btn brass" disabled={!!busy || acct.accountNumber == null} onClick={() => run("register", async () => {
                  await after("Signing key registered", await relay(await buildKeyRegistration(sealer, acct.accountNumber!, acct.sequence ?? 0)), "relay");
                })}>{busy ? "Sending…" : acct.accountNumber == null ? "Waiting for the funds to land…" : "Register signing key"}</button>
                {acct.accountNumber == null && <button className="btn ghost" onClick={() => refreshAcct(sealer).catch((e) => setError(e.message))}>Check again</button>}
              </div>
            </Panel>
          )}

          {step === "publish" && address && sealer && acct && (
            <Panel title="Publish your encryption key">
              <p>One hybrid-signed transaction from the sealing account: its ML-KEM-1024 key, and its half of the binding ("I hold the key for {short(address)}"). Sent through the relay.</p>
              <button className="btn brass" disabled={!!busy} onClick={() => run("publish", async () => {
                await after("Encryption key published", await relay(await buildKeyAndRecord(sealer, acct.accountNumber!, acct.sequence ?? 0, address)), "relay");
              })}>{busy ? "Sending…" : "Publish encryption key"}</button>
            </Panel>
          )}

          {step === "bind" && address && sealer && (
            <Panel title="Bind it to your QoreX account">
              <p>Your half: QoreX sends 1 uqor to your own address with the record "bind {short(sealer.address)}", signed with secp256k1 and ML-DSA-87 together. You approve it in QoreX.</p>
              <button className="btn brass" disabled={!!busy} onClick={() => run("bind", async () => {
                const r = await bindSealer(address, sealer.address);
                setBindSent(sealer.address);
                await after("Binding sent", r, "QoreX");
              })}>{busy ? "Waiting for QoreX…" : "Bind with QoreX"}</button>
            </Panel>
          )}

          {step === "confirming" && (
            <Panel title="Confirming on chain">
              <p>Both halves are sent. The page reads the chain again every few seconds until it sees them.</p>
              <Retry onTick={reload} every={5000} />
              <button className="btn ghost" onClick={reload}>Check now</button>
            </Panel>
          )}

          {step === "done" && res && (
            <Panel title="You can receive sealed mail">
              <p>Anyone, and any app that reads Letterplate's records, can now seal to your QoreX address. Keep your backup file and passphrase: they are the only way to open it.</p>
              <SealTo r={res} />
            </Panel>
          )}

          {done.length > 0 && (
            <ul className="receipts">
              {done.map((d) => <li key={d.txHash}><strong>{d.what}</strong> · {d.via} · <span className="mono">{short(d.txHash, 8, 6)}</span>{d.height ? ` · block ${d.height.toLocaleString()}` : ""}</li>)}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function SealTo({ r }: { r: Resolution }) {
  return (
    <dl className="facts">
      <dt>Your address</dt><dd className="mono">{r.address}</dd>
      <dt>Mail is sealed to</dt><dd className="mono strong">{r.sealTo}</dd>
      {r.publicKeySha3 && (<><dt>Key fingerprint</dt><dd className="mono">SHA3-256 {r.publicKeySha3.slice(0, 16)}…</dd></>)}
      <dt /><dd className="row"><CopyButton text={r.address} label="Copy your address" /><a className="btn ghost small" href={`#check?address=${r.address}`}>Check it</a></dd>
    </dl>
  );
}

function Retry({ every, onTick }: { every: number; onTick: () => void }) {
  useEffect(() => { const t = setInterval(onTick, every); return () => clearInterval(t); }, [every, onTick]);
  return null;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <div className="stack"><h2>{title}</h2>{children}</div>;
}

function CreateKey({ owner, onReady, onError }: { owner: string; onReady: (s: Sealer) => void; onError: (m: string) => void }) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [working, setWorking] = useState(false);
  const problem = p1.length < MIN_PASSPHRASE ? `At least ${MIN_PASSPHRASE} characters` : p1 !== p2 ? "The passphrases do not match" : null;
  return (
    <Panel title="Create your sealing key">
      <p>The page makes one secret in this browser and keeps it in memory. From it come your sealing account and its ML-KEM-1024 key. You download a backup encrypted with your passphrase; without the file and the passphrase, nobody can open your mail, including you.</p>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (problem) return;
        setWorking(true);
        try {
          const secret = createSecret();
          const s = await deriveSealer(secret);
          const backup = await exportBackup(secret, { owner, chainId: CHAIN_ID, keyId: `${s.address}:${keyFingerprint(s.sealKeys)}` }, p1);
          secret.fill(0);
          downloadJson(`letterplate-key-${owner.slice(-6)}.json`, backup);
          onReady(s);
        } catch (err) { onError((err as Error).message); } finally { setWorking(false); }
      }}>
        <div className="row2">
          <label className="field">Backup passphrase<input type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} /></label>
          <label className="field">Repeat it<input type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></label>
        </div>
        {p1 && problem && <p className="muted small">{problem}</p>}
        <div><button className="btn brass" type="submit" disabled={!!problem || working}>{working ? "Encrypting the backup…" : "Create key and download backup"}</button></div>
      </form>
    </Panel>
  );
}

function ImportKey({ owner, expect, onReady, onError }: { owner: string; expect: string | null; onReady: (s: Sealer) => void; onError: (m: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [pass, setPass] = useState("");
  const [working, setWorking] = useState(false);
  return (
    <Panel title="Load your sealing key">
      {expect && <p>Your account already names the sealing account {short(expect)}. Load the backup file you saved when you created it, to finish setting it up.</p>}
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return;
        setWorking(true);
        try {
          const { secret, keyId } = await importBackup(await file.text(), pass, { owner, chainId: CHAIN_ID });
          const s = await deriveSealer(secret);
          secret.fill(0);
          if (keyId !== `${s.address}:${keyFingerprint(s.sealKeys)}`) throw new Error("The backup does not match its own key");
          if (expect && s.address !== expect) throw new Error(`This backup is for the sealing account ${short(s.address)}, not the one your account names`);
          onReady(s);
        } catch (err) { onError((err as Error).message); } finally { setWorking(false); }
      }}>
        <label className="field">Backup file<input type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <label className="field">Passphrase<input type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
        <div><button className="btn brass" type="submit" disabled={!file || !pass || working}>{working ? "Decrypting…" : "Load key"}</button></div>
      </form>
    </Panel>
  );
}
