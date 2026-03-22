import React, { useState, useEffect, useCallback } from "react";
import {
  getAccessMatrix,
  toggleAccess,
  setDefaultAgent,
  type AccessMatrixData,
} from "../api.js";

const cardStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: 20,
  marginBottom: 16,
};

export function AccessControl() {
  const [data, setData] = useState<AccessMatrixData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const refresh = useCallback(() => {
    getAccessMatrix().then(setData).catch((err) => setError(err.message));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleToggle = async (wechatId: string, agentId: string, enabled: boolean) => {
    const key = `${wechatId}:${agentId}`;
    setLoading((prev) => ({ ...prev, [key]: true }));
    try {
      setError(null);
      await toggleAccess(wechatId, agentId, enabled);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleSetDefault = async (wechatId: string, agentId: string) => {
    const key = `default:${wechatId}`;
    setLoading((prev) => ({ ...prev, [key]: true }));
    try {
      setError(null);
      await setDefaultAgent(wechatId, agentId);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const getCell = (wechatId: string, agentId: string) =>
    data?.matrix.find((c) => c.wechat_id === wechatId && c.agent_id === agentId);

  if (!data) {
    return <div style={{ padding: 20, color: "var(--text-dim)" }}>Loading...</div>;
  }

  const { wechat_accounts: accounts, agents } = data;
  const hasAccounts = accounts.length > 0;
  const hasAgents = agents.length > 0;

  return (
    <div>
      <h2 style={{ marginBottom: 8 }}>Access Control</h2>
      <p style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 20 }}>
        Configure which agents are available on each WeChat account. Click the checkbox to toggle access, click the star to set the default agent.
      </p>

      {error && (
        <div style={{ ...cardStyle, borderColor: "var(--red)", color: "var(--red)" }}>
          ⚠️ {error}
        </div>
      )}

      {!hasAccounts || !hasAgents ? (
        <div style={cardStyle}>
          <div style={{ color: "var(--text-dim)", textAlign: "center", padding: 20 }}>
            {!hasAccounts && !hasAgents
              ? "Add a WeChat account and an agent to get started."
              : !hasAccounts
                ? "Add a WeChat account first."
                : "Add an agent first."}
          </div>
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: agents.length * 160 + 180 }}>
              <thead>
                <tr>
                  <th style={{
                    textAlign: "left", padding: "10px 12px", fontSize: 13,
                    color: "var(--text-dim)", borderBottom: "2px solid var(--border)",
                    position: "sticky", left: 0, background: "var(--bg-card)", zIndex: 1,
                  }}>
                    WeChat Account
                  </th>
                  {agents.map((agent) => (
                    <th key={agent.id} style={{
                      textAlign: "center", padding: "10px 12px", fontSize: 13,
                      color: "var(--text-dim)", borderBottom: "2px solid var(--border)",
                      minWidth: 140,
                    }}>
                      <div>{agent.display_name}</div>
                      <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 400, marginTop: 2 }}>
                        #{agent.id}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{
                      padding: "12px", fontSize: 14,
                      position: "sticky", left: 0, background: "var(--bg-card)", zIndex: 1,
                    }}>
                      <div style={{ fontWeight: 500 }}>{account.name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
                        <span style={{
                          display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                          background: account.status === "connected" ? "var(--green)" : "var(--text-dim)",
                          marginRight: 4, verticalAlign: "middle",
                        }} />
                        {account.status}
                      </div>
                    </td>
                    {agents.map((agent) => {
                      const cell = getCell(account.id, agent.id);
                      const enabled = cell?.enabled ?? false;
                      const isDefault = cell?.is_default ?? false;
                      const cellKey = `${account.id}:${agent.id}`;
                      const isLoading = loading[cellKey] || loading[`default:${account.id}`];

                      return (
                        <td key={agent.id} style={{
                          textAlign: "center", padding: "12px",
                          opacity: isLoading ? 0.5 : 1,
                          transition: "opacity 0.15s",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                            <label style={{ cursor: "pointer", display: "flex", alignItems: "center" }}>
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={() => handleToggle(account.id, agent.id, !enabled)}
                                disabled={!!isLoading}
                                style={{ width: 16, height: 16, cursor: "pointer" }}
                              />
                            </label>
                            <button
                              onClick={() => {
                                if (enabled && !isDefault) {
                                  handleSetDefault(account.id, agent.id);
                                }
                              }}
                              disabled={!enabled || isDefault || !!isLoading}
                              title={
                                !enabled ? "Enable access first"
                                  : isDefault ? "Current default"
                                    : "Set as default agent"
                              }
                              style={{
                                background: "none", border: "none", padding: 0,
                                fontSize: 18, cursor: enabled && !isDefault ? "pointer" : "default",
                                color: isDefault ? "var(--yellow, #f5a623)" : "var(--border)",
                                transition: "color 0.15s",
                                lineHeight: 1,
                              }}
                            >
                              {isDefault ? "★" : "☆"}
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", gap: 16 }}>
        <span>☑ = Agent accessible to all users on this WeChat</span>
        <span>★ = Default agent (used when no #tag is specified)</span>
      </div>
    </div>
  );
}
