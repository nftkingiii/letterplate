// The QoreX control in the top bar: connect, or the connected account with a small menu.
import { useEffect, useRef, useState } from "react";
import { useWallet } from "./WalletContext";
import { explain } from "./wallet";
import { CopyButton, short } from "./ui";

export function WalletButton() {
  const { hasWallet, mock, address, connecting, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!address) {
    return (
      <div className="walletbox" ref={box}>
        <button className="btn brass small" disabled={connecting || !hasWallet}
          title={hasWallet ? "Connect your QoreX account on Testnet" : "QoreX was not found in this browser"}
          onClick={async () => { setError(null); try { await connect(); } catch (e) { setError(explain(e)); setOpen(true); } }}>
          {connecting ? "Waiting for QoreX…" : hasWallet ? "Connect QoreX" : "QoreX not found"}
        </button>
        {open && error && <div className="walletmenu" role="dialog" aria-label="QoreX"><p>{error}</p></div>}
      </div>
    );
  }
  return (
    <div className="walletbox" ref={box}>
      <button className="walletchip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title={address}>
        <span className="dot" aria-hidden="true" />
        <span className="mono">{short(address, 8, 4)}</span>
        {mock && <span className="tag">test wallet</span>}
      </button>
      {open && (
        <div className="walletmenu" role="menu" aria-label="QoreX account">
          <p>Connected with QoreX{mock ? " (official mock)" : ""} · Testnet</p>
          <code className="mono">{address}</code>
          <div className="row">
            <CopyButton text={address} label="Copy address" />
            <button className="btn ghost small" role="menuitem" onClick={() => { setOpen(false); disconnect(); }}>Disconnect</button>
          </div>
          <p className="muted small">Disconnecting forgets this account on this page and clears the sealing key from memory.</p>
        </div>
      )}
    </div>
  );
}
