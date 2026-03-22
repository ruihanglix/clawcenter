import React, { useState, useEffect } from "react";
import {
  listWechatAccounts, createWechatAccount, deleteWechatAccount,
  connectWechatAccount, disconnectWechatAccount, loginWechatAccount,
  type WechatAccount,
} from "../api.js";

const cardStyle: React.CSSProperties = {
  background: "var(--bg-card)", border: "1px solid var(--border)",
  borderRadius: "var(--radius)", padding: 20, marginBottom: 16,
};

export function WechatAccounts() {
  const [accounts, setAccounts] = useState<WechatAccount[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loginAccountId, setLoginAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => listWechatAccounts().then(setAccounts).catch(() => {});
  useEffect(() => { refresh(); const i = setInterval(refresh, 3000); return () => clearInterval(i); }, []);

  useEffect(() => {
    if (!loginAccountId) return;
    const acct = accounts.find((a) => a.id === loginAccountId);
    if (acct?.status === "connected") {
      setQrUrl(null);
      setLoginAccountId(null);
    }
  }, [accounts, loginAccountId]);

  const handleAdd = async () => {
    if (!newId || !newName) return;
    try {
      setError(null);
      await createWechatAccount({ id: newId, name: newName });
      setNewId(""); setNewName(""); setShowAdd(false);
      refresh();
    } catch (err) { setError((err as Error).message); }
  };

  const handleLogin = async (id: string) => {
    try {
      setError(null);
      setLoginAccountId(id);
      const result = await loginWechatAccount(id);
      setQrUrl(result.qrUrl);
    } catch (err) { setError((err as Error).message); setLoginAccountId(null); }
  };

  const handleConnect = async (id: string) => {
    try {
      setError(null);
      await connectWechatAccount(id);
      refresh();
    } catch (err) { setError((err as Error).message); }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await disconnectWechatAccount(id);
      refresh();
    } catch (err) { setError((err as Error).message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete account "${id}"?`)) return;
    try {
      await deleteWechatAccount(id);
      refresh();
    } catch (err) { setError((err as Error).message); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2>WeChat Accounts</h2>
        <button className="primary" onClick={() => setShowAdd(!showAdd)}>+ Add Account</button>
      </div>

      {error && <div style={{ ...cardStyle, borderColor: "var(--red)", color: "var(--red)" }}>⚠️ {error}</div>}

      {showAdd && (
        <div style={cardStyle}>
          <h3 style={{ marginBottom: 12 }}>Add WeChat Account</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 13, color: "var(--text-dim)" }}>ID (unique key)</label>
              <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="personal" />
            </div>
            <div>
              <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Display Name</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="My WeChat" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary" onClick={handleAdd}>Create</button>
            <button onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {qrUrl && loginAccountId && (
        <div style={{ ...cardStyle, textAlign: "center" as const }}>
          <h3>Scan QR Code for: {loginAccountId}</h3>
          <p style={{ color: "var(--text-dim)", margin: "8px 0" }}>Use WeChat to scan this QR code</p>
          <img src={qrUrl} alt="QR Code" style={{ maxWidth: 300, margin: "12px auto" }} />
          <div><button onClick={() => { setQrUrl(null); setLoginAccountId(null); }}>Close</button></div>
        </div>
      )}

      {accounts.map((account) => (
        <div key={account.id} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{
                display: "inline-block", width: 10, height: 10, borderRadius: "50%", marginRight: 8,
                background: account.status === "connected" ? "var(--green)" : "var(--text-dim)",
              }} />
              <span style={{ fontWeight: 600, fontSize: 16 }}>{account.name}</span>
              <span style={{ color: "var(--text-dim)", fontSize: 13, marginLeft: 12 }}>ID: {account.id}</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {account.token ? (
                account.status === "connected" ? (
                  <button onClick={() => handleDisconnect(account.id)}>Disconnect</button>
                ) : (
                  <button className="primary" onClick={() => handleConnect(account.id)}>Connect</button>
                )
              ) : (
                <button className="primary" onClick={() => handleLogin(account.id)}>Login (QR)</button>
              )}
              <button className="danger" onClick={() => handleDelete(account.id)}>Delete</button>
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-dim)" }}>
            Status: {account.status} | API: {account.base_url}
            {account.account_id && ` | Bot: ${account.account_id}`}
          </div>
        </div>
      ))}

      {accounts.length === 0 && !showAdd && (
        <div style={{ ...cardStyle, textAlign: "center" as const, color: "var(--text-dim)" }}>
          No WeChat accounts configured. Click "Add Account" to get started.
        </div>
      )}
    </div>
  );
}
