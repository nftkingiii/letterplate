import { useEffect, useState, type FormEvent } from "react";
import "./styles.css";
import { listValidators, QOR_ADDRESS, resolveAddress, type Resolution, type Status, type Validators } from "./api";

type Tab = "check" | "validators";
const TABS: { id: Tab; label: string }[] = [
  { id: "check", label: "Check" },
  { id: "validators", label: "Validators" },
];
const tabFromHash = (): Tab => (location.hash.replace("#", "").split("?")[0] === "validators" ? "validators" : "check");

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => { setTab(tabFromHash()); setHash(location.hash); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#check" aria-label="Letterplate home">
          <img src="/mark.svg" alt="" width={28} height={28} />
          <span>Letterplate</span>
        </a>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} aria-current={tab === t.id ? "page" : undefined}>{t.label}</a>
          ))}
        </nav>
      </header>
      <main>{tab === "check" ? <Check key={hash} /> : <ValidatorList />}</main>
      <footer className="foot">
        <span>Reads the public chain only. The server holds no keys.</span>
        <a href="https://github.com/nftkingiii/letterplate">Source</a>
      </footer>
    </div>
  );
}

const VERDICT: Record<Status, { title: string; tone: "yes" | "warn" | "no" }> = {
  own: { title: "Can receive sealed mail", tone: "yes" },
  bound: { title: "Can receive sealed mail, through its sealing account", tone: "yes" },
  "one-sided": { title: "Cannot receive yet: the binding is one-sided", tone: "warn" },
  "no-key": { title: "Cannot receive yet: the sealing account has no key", tone: "warn" },
  none: { title: "Cannot receive sealed mail", tone: "no" },
};

function explain(r: Resolution): string {
  switch (r.status) {
    case "own": return "This account has its own ML-KEM-1024 key in QoreChain's registry. Seal to it directly.";
    case "bound": return "This account has no key of its own. It and a sealing account have each named the other on chain, in hybrid-signed transactions, and the sealing account's key is in the registry. Seal to that key.";
    case "one-sided": return `This account named a sealing account, but ${r.reason ?? "the other side does not match"}. Until both sides agree, nothing should be sealed to it.`;
    case "no-key": return "Both sides of the binding are on chain, but the sealing account has not published an encryption key yet.";
    case "none": return "No encryption key in the registry and no binding to a sealing account. Anything sealed to this address today would have no key to open it.";
  }
}

function Check() {
  const initial = new URLSearchParams(location.hash.split("?")[1] ?? "").get("address") ?? "";
  const [address, setAddress] = useState(initial);
  const [result, setResult] = useState<Resolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(a: string) {
    setError(null);
    setResult(null);
    if (!QOR_ADDRESS.test(a)) { setError("Enter a qor1 account address (lower case, 43 characters)."); return; }
    setBusy(true);
    history.replaceState(null, "", `#check?address=${a}`);
    try { setResult(await resolveAddress(a)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (initial) void run(initial); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: FormEvent) => { e.preventDefault(); void run(address.trim()); };

  return (
    <section className="check">
      <h1>Can this address receive sealed mail?</h1>
      <p className="lede">Messages sealed with ML-KEM-1024 can only be opened with the recipient's key. Letterplate reads QoreChain testnet to tell you whether an address has one, and exactly where to seal.</p>
      <form className="lookup" onSubmit={submit}>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="qor1…" spellCheck={false} autoComplete="off" aria-label="QoreChain address" />
        <button type="submit" disabled={busy}>{busy ? "Reading the chain…" : "Check"}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {result && <Verdict r={result} />}
    </section>
  );
}

function Verdict({ r }: { r: Resolution }) {
  const v = VERDICT[r.status];
  return (
    <article className={`verdict tone-${v.tone}`} aria-live="polite">
      <h2>{v.title}</h2>
      <p>{explain(r)}</p>
      <dl className="facts">
        <dt>Address</dt><dd className="mono">{r.address}</dd>
        {r.sealTo && (<><dt>Seal to</dt><dd className="mono strong">{r.sealTo}</dd></>)}
        {r.publicKeySha3 && (<><dt>Key fingerprint</dt><dd className="mono">SHA3-256 {r.publicKeySha3.slice(0, 16)}…</dd></>)}
        {r.bind && (<><dt>Binding</dt><dd><span className="mono">bind {short(r.bind.sealer)}</span> · block {r.bind.height.toLocaleString()} · <span className="mono">{short(r.bind.tx)}</span></dd></>)}
        {r.sealer?.claim && (<><dt>Sealing account says</dt><dd><span className="mono">sealer {short(r.sealer.claim.owner)}</span> · block {r.sealer.claim.height.toLocaleString()} · <span className="mono">{short(r.sealer.claim.tx)}</span></dd></>)}
      </dl>
      {[...r.refused, ...(r.sealer?.refused ?? [])].length > 0 && (
        <div className="refused">
          <h3>Records that do not count</h3>
          <ul>
            {[...r.refused, ...(r.sealer?.refused ?? [])].map((x) => (
              <li key={x.tx}><span className="mono">{short(x.tx)}</span> · block {x.height.toLocaleString()} · {x.reason}</li>
            ))}
          </ul>
        </div>
      )}
      {(r.historyFrom || r.sealer?.historyFrom) && (
        <p className="note">The public node keeps blocks from {(r.historyFrom ?? r.sealer?.historyFrom ?? 0).toLocaleString()} onwards, so records older than that could not be read. A binding made before then would not show here.</p>
      )}
      <p className="stamp">Read from qorechain-diana at {new Date(r.readAt).toLocaleTimeString()}</p>
    </article>
  );
}

function ValidatorList() {
  const [network, setNetwork] = useState<"testnet" | "mainnet">("mainnet");
  const [data, setData] = useState<Validators | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    listValidators(network).then((d) => live && setData(d), (e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [network]);

  return (
    <section className="validators">
      <h1>Can the validators receive sealed mail?</h1>
      <p className="lede">Every bonded validator's account, checked the same way. A security notice sealed to a validator today needs one of these to say yes.</p>
      <div className="seg" role="group" aria-label="Network">
        {(["mainnet", "testnet"] as const).map((n) => (
          <button key={n} aria-pressed={network === n} onClick={() => setNetwork(n)}>{n === "mainnet" ? "Mainnet" : "Testnet"}</button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <p className="muted">Reading every validator from the chain…</p>}
      {data && (
        <>
          <p className="tally"><strong>{data.canReceive} of {data.rows.length}</strong> can receive sealed mail on {data.chainId}.</p>
          <table className="table">
            <thead><tr><th>Validator</th><th>Voting power</th><th>Account</th><th>Can receive</th></tr></thead>
            <tbody>
              {data.rows.map((v) => (
                <tr key={v.address}>
                  <td>{v.name}</td>
                  <td>{(v.votingPowerBps / 100).toFixed(1)}%</td>
                  <td className="mono">{network === "testnet" ? <a href={`#check?address=${v.address}`}>{short(v.address)}</a> : short(v.address)}</td>
                  <td className={`pill tone-${VERDICT[v.status].tone}`}>{v.sealTo ? "Yes" : v.status === "none" ? "No" : "Not yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.some((v) => v.historyFrom) && <p className="note">Some accounts have transfers older than the public node keeps; for those, only records from block {Math.max(...data.rows.map((v) => v.historyFrom ?? 0)).toLocaleString()} onwards were read. Encryption keys come from the live registry and are always complete.</p>}
          <p className="stamp">Read at {new Date(data.readAt).toLocaleTimeString()}</p>
        </>
      )}
    </section>
  );
}

const short = (s?: string | null) => (s ? `${s.slice(0, 10)}…${s.slice(-6)}` : "");
