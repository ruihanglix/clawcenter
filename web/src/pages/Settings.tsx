import React, { useState, useEffect } from "react";
import { getSettings, updateSetting, listWorkers, type WorkerNode } from "../api.js";

const cardStyle: React.CSSProperties = {
  background: "var(--bg-card)", border: "1px solid var(--border)",
  borderRadius: "var(--radius)", padding: 20, marginBottom: 16,
};

const fieldStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "200px 1fr", gap: 12, alignItems: "center",
  padding: "8px 0", borderBottom: "1px solid var(--border)",
};

const SETTING_LABELS: Record<string, { label: string; description: string }> = {
  reply_prefix_format: {
    label: "Reply Prefix Format",
    description: "Template for agent reply prefix. Use {displayName} as placeholder.",
  },
  web_port: { label: "Web UI Port", description: "Port for the web management panel." },
  web_host: { label: "Web UI Host", description: "Host binding for web UI." },
  worker_port: { label: "Worker Hub Port", description: "Port for Worker WebSocket connections." },
  worker_host: { label: "Worker Hub Host", description: "Host binding for Worker hub." },
  worker_web_port: { label: "Worker Web Port", description: "Port for Worker's local web panel." },
  worker_web_host: { label: "Worker Web Host", description: "Host binding for Worker web panel." },
};

export function Settings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [workers, setWorkers] = useState<WorkerNode[]>([]);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  const refresh = () => {
    getSettings().then(setSettings).catch(() => {});
    listWorkers().then(setWorkers).catch(() => {});
  };
  useEffect(() => { refresh(); const i = setInterval(refresh, 5000); return () => clearInterval(i); }, []);

  const handleSave = async (key: string) => {
    try {
      await updateSetting(key, editValue);
      setSettings((prev) => ({ ...prev, [key]: editValue }));
      setEditKey(null);
      setSaved(key);
      setTimeout(() => setSaved(null), 2000);
    } catch {}
  };

  return (
    <div>
      <h2 style={{ marginBottom: 20 }}>Settings</h2>

      <div style={cardStyle}>
        <h3 style={{ marginBottom: 16 }}>General Settings</h3>
        {Object.entries(settings).map(([key, value]) => {
          const meta = SETTING_LABELS[key] ?? { label: key, description: "" };
          const isEditing = editKey === key;

          return (
            <div key={key} style={fieldStyle}>
              <div>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{meta.label}</div>
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{meta.description}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {isEditing ? (
                  <>
                    <input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      style={{ flex: 1 }}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSave(key); if (e.key === "Escape") setEditKey(null); }}
                      autoFocus
                    />
                    <button className="primary" onClick={() => handleSave(key)} style={{ padding: "6px 12px" }}>Save</button>
                    <button onClick={() => setEditKey(null)} style={{ padding: "6px 12px" }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <code style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>{value}</code>
                    {saved === key && <span style={{ color: "var(--green)", fontSize: 13 }}>✓ Saved</span>}
                    <button onClick={() => { setEditKey(key); setEditValue(value); }} style={{ padding: "4px 10px", fontSize: 12 }}>
                      Edit
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={cardStyle}>
        <h3 style={{ marginBottom: 12 }}>Worker Nodes</h3>
        {workers.length === 0 ? (
          <div style={{ color: "var(--text-dim)" }}>
            No worker nodes connected. Start a worker with:
            <code style={{ display: "block", margin: "8px 0", padding: 8, background: "var(--bg)", borderRadius: 4 }}>
              clawcenter start --worker --center ws://this-server:9801
            </code>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "var(--text-dim)" }}>Node ID</th>
                <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "var(--text-dim)" }}>Address</th>
                <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "var(--text-dim)" }}>Status</th>
                <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "var(--text-dim)" }}>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((w) => (
                <tr key={w.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 0", fontWeight: 500 }}>{w.id}</td>
                  <td style={{ padding: "8px 0" }}>{w.address ?? "—"}</td>
                  <td style={{ padding: "8px 0" }}>
                    <span style={{
                      display: "inline-block", width: 8, height: 8, borderRadius: "50%", marginRight: 6,
                      background: w.status === "connected" ? "var(--green)" : "var(--text-dim)",
                    }} />
                    {w.status}
                  </td>
                  <td style={{ padding: "8px 0", color: "var(--text-dim)" }}>
                    {new Date(w.last_seen).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
