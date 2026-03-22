import React, { useState, useEffect } from "react";
import { getStats, listWechatAccounts, listAgents, listMessages, type WechatAccount, type Agent, type Message } from "../api.js";

const cardStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: 20,
};

const statStyle: React.CSSProperties = {
  ...cardStyle,
  textAlign: "center" as const,
};

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={statStyle}>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 4 }}>{label}</div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === "connected" || status === "running" ? "var(--green)"
    : status === "error" ? "var(--red)"
    : "var(--text-dim)";
  return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, marginRight: 8 }} />;
}

export function Dashboard({ events }: { events: unknown[] }) {
  const [stats, setStats] = useState({ accounts: 0, agents: 0, sessions: 0, messages_today: 0 });
  const [accounts, setAccounts] = useState<WechatAccount[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  const refresh = () => {
    getStats().then(setStats).catch(() => {});
    listWechatAccounts().then(setAccounts).catch(() => {});
    listAgents().then(setAgents).catch(() => {});
    listMessages(20).then(setMessages).catch(() => {});
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { refresh(); }, [events.length]);

  return (
    <div>
      <h2 style={{ marginBottom: 20 }}>Dashboard</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <StatCard label="WeChat Accounts" value={stats.accounts} color="var(--blue)" />
        <StatCard label="Agents" value={stats.agents} color="var(--accent)" />
        <StatCard label="Sessions" value={stats.sessions} color="var(--green)" />
        <StatCard label="Messages Today" value={stats.messages_today} color="var(--yellow)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <div style={cardStyle}>
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>WeChat Accounts</h3>
          {accounts.length === 0 ? (
            <div style={{ color: "var(--text-dim)" }}>No accounts configured</div>
          ) : accounts.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", padding: "6px 0" }}>
              <StatusDot status={a.status} />
              <span style={{ fontWeight: 500 }}>{a.name}</span>
              <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 13 }}>{a.status}</span>
            </div>
          ))}
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>Agents</h3>
          {agents.length === 0 ? (
            <div style={{ color: "var(--text-dim)" }}>No agents configured</div>
          ) : agents.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", padding: "6px 0" }}>
              <StatusDot status={a.runtimeStatus ?? a.status} />
              <span style={{ fontWeight: 500 }}>{a.display_name}</span>
              <span style={{ color: "var(--text-dim)", fontSize: 13, marginLeft: 8 }}>#{a.id}</span>
              <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 13 }}>
                {a.type}{a.node_id !== "local" ? ` (${a.node_id})` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ marginBottom: 12, fontSize: 15 }}>Recent Messages</h3>
        {messages.length === 0 ? (
          <div style={{ color: "var(--text-dim)" }}>No messages yet</div>
        ) : (
          <div style={{ maxHeight: 300, overflow: "auto" }}>
            {messages.map((m) => (
              <div key={m.id} style={{ padding: "4px 0", fontSize: 13, borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--text-dim)" }}>{new Date(m.created_at).toLocaleTimeString()}</span>
                {" "}
                <span style={{ color: m.direction === "inbound" ? "var(--blue)" : "var(--green)" }}>
                  {m.direction === "inbound" ? "📩" : "✅"}
                </span>
                {" "}
                {m.agent_id && <span style={{ color: "var(--accent)" }}>[{m.agent_id}]</span>}
                {" "}
                <span>{(m.content ?? "").slice(0, 100)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
