import React, { useState, useEffect } from "react";
import {
  listAgents, createAgent, updateAgent, deleteAgent, startAgent, stopAgent,
  listAgentModels, setAgentModel,
  type Agent, type ModelInfo,
} from "../api.js";

const cardStyle: React.CSSProperties = {
  background: "var(--bg-card)", border: "1px solid var(--border)",
  borderRadius: "var(--radius)", padding: 20, marginBottom: 16,
};

const fieldStyle: React.CSSProperties = { marginBottom: 14 };
const labelStyle: React.CSSProperties = { fontSize: 13, color: "var(--text-dim)", marginBottom: 4, display: "block" };
const descStyle: React.CSSProperties = { fontSize: 11, color: "var(--text-dim)", marginTop: 2, opacity: 0.7 };

const MODEL_SWITCH_TYPES = new Set(["opencode", "openclaw", "claude-sdk", "codex", "codebuddy", "cursor-agent"]);

const AGENT_TYPES = [
  { value: "claude-code", label: "Claude Code (CLI)" },
  { value: "claude-sdk", label: "Claude Agent SDK" },
  { value: "opencode", label: "OpenCode (CLI)" },
  { value: "openclaw", label: "OpenClaw (CLI)" },
  { value: "codex", label: "Codex (CLI)" },
  { value: "codebuddy", label: "CodeBuddy (CLI)" },
  { value: "cursor-agent", label: "Cursor Agent (CLI)" },
  { value: "http", label: "Custom HTTP" },
];

const THINKING_LEVELS = [
  { value: "", label: "Default" },
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
];

const PERMISSION_MODES = [
  { value: "", label: "Default (dangerously-skip-permissions)" },
  { value: "bypassPermissions", label: "Bypass Permissions" },
  { value: "acceptEdits", label: "Accept Edits" },
  { value: "plan", label: "Plan Mode" },
];

/* ─── Key-Value pair editor (for env / headers) ─── */

function KeyValueEditor({ value, onChange, keyPlaceholder, valuePlaceholder }: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const entries = Object.entries(value);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");

  const handleAdd = () => {
    const k = newKey.trim();
    if (!k) return;
    onChange({ ...value, [k]: newVal });
    setNewKey("");
    setNewVal("");
  };

  const handleRemove = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  const handleValChange = (key: string, newValue: string) => {
    onChange({ ...value, [key]: newValue });
  };

  return (
    <div>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "center" }}>
          <input value={k} readOnly style={{ flex: "0 0 160px", opacity: 0.8, fontSize: 13 }} />
          <input value={v} onChange={(e) => handleValChange(k, e.target.value)} style={{ flex: 1, fontSize: 13 }} />
          <button
            onClick={() => handleRemove(k)}
            style={{ padding: "4px 8px", fontSize: 12, color: "var(--red)", background: "transparent", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
          >✕</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          value={newKey} onChange={(e) => setNewKey(e.target.value)}
          placeholder={keyPlaceholder ?? "KEY"}
          style={{ flex: "0 0 160px", fontSize: 13 }}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />
        <input
          value={newVal} onChange={(e) => setNewVal(e.target.value)}
          placeholder={valuePlaceholder ?? "value"}
          style={{ flex: 1, fontSize: 13 }}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />
        <button
          onClick={handleAdd}
          style={{ padding: "4px 10px", fontSize: 12, cursor: "pointer", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 4 }}
        >+</button>
      </div>
    </div>
  );
}

/* ─── Agent Settings Modal ─── */

function AgentSettingsModal({ agent, onClose, onSaved }: {
  agent: Agent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const cfg = agent.config as Record<string, any>;
  const [displayName, setDisplayName] = useState(agent.display_name);
  const [cwd, setCwd] = useState<string>(cfg.cwd ?? "");
  const [model, setModel] = useState<string>(cfg.model ?? "");
  const [url, setUrl] = useState<string>(cfg.url ?? "");
  const [permissionMode, setPermissionMode] = useState<string>(cfg.permissionMode ?? "");
  const [env, setEnv] = useState<Record<string, string>>(cfg.env ?? {});
  const [headers, setHeaders] = useState<Record<string, string>>(cfg.headers ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [cliPath, setCliPath] = useState<string>(cfg.cliPath ?? "");
  const [proxy, setProxy] = useState<string>(cfg.proxy ?? "");
  const [timeoutMs, setTimeoutMs] = useState<string>(cfg.timeoutMs ? String(cfg.timeoutMs) : "");
  const [thinking, setThinking] = useState<string>(cfg.thinking ?? "");
  const [timeout, setTimeout_] = useState<string>(cfg.timeout ? String(cfg.timeout) : "");

  const isCursorAgent = agent.type === "cursor-agent";
  const isOpenClaw = agent.type === "openclaw";
  const isCli = agent.type === "claude-code" || agent.type === "opencode" || agent.type === "openclaw" || agent.type === "codex" || agent.type === "codebuddy" || isCursorAgent;
  const isHttp = agent.type === "http";
  const isClaude = agent.type === "claude-code" || agent.type === "claude-sdk";
  const isCodex = agent.type === "codex";
  const isCodeBuddy = agent.type === "codebuddy";
  const isCodexLike = isCodex || isCodeBuddy;
  const hasCliPath = isCodexLike || isCursorAgent || isOpenClaw;
  const hasTimeoutMs = isCodexLike || isCursorAgent;
  const hasPermissionMode = isClaude || isCodexLike || isCursorAgent;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const config: Record<string, unknown> = { ...cfg };
      config.cwd = cwd || undefined;
      config.model = model || undefined;
      if (isHttp) {
        config.url = url || undefined;
        config.headers = Object.keys(headers).length > 0 ? headers : undefined;
      }
      if (hasPermissionMode) {
        config.permissionMode = permissionMode || undefined;
      }
      if (hasCliPath) {
        config.cliPath = cliPath || undefined;
      }
      if (hasTimeoutMs) {
        config.timeoutMs = timeoutMs ? Number(timeoutMs) : undefined;
      }
      if (isCodex) {
        config.proxy = proxy || undefined;
      }
      if (isOpenClaw) {
        config.thinking = thinking || undefined;
        config.timeout = timeout ? Number(timeout) : undefined;
      }
      config.env = Object.keys(env).length > 0 ? env : undefined;

      for (const k of Object.keys(config)) {
        if (config[k] === undefined) delete config[k];
      }

      await updateAgent(agent.id, { display_name: displayName, config });

      const wasRunning = (agent.runtimeStatus ?? agent.status) === "running";
      if (wasRunning && agent.node_id === "local") {
        await stopAgent(agent.id);
        await startAgent(agent.id);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} />
      <div style={{
        position: "relative", zIndex: 1001, background: "var(--bg)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", width: 580, maxHeight: "85vh", overflowY: "auto",
        boxShadow: "0 16px 48px rgba(0,0,0,0.4)", padding: 24,
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0 }}>Agent Settings</h3>
            <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
              #{agent.id} · {AGENT_TYPES.find(t => t.value === agent.type)?.label ?? agent.type}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer", color: "var(--text-dim)", padding: "4px 8px" }}
          >✕</button>
        </div>

        {error && (
          <div style={{ ...cardStyle, borderColor: "var(--red)", color: "var(--red)", marginBottom: 16, padding: 12 }}>{error}</div>
        )}

        {/* Display Name */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Display Name</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={{ width: "100%" }} />
        </div>

        {/* Working Directory */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Working Directory</label>
          <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/home/user/project" style={{ width: "100%" }} />
          <div style={descStyle}>{isCli ? "CLI process working directory" : "Optional working context path"}</div>
        </div>

        {/* Model */}
        {!MODEL_SWITCH_TYPES.has(agent.type) && (
          <div style={fieldStyle}>
            <label style={labelStyle}>Model</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. sonnet" style={{ width: "100%" }} />
          </div>
        )}

        {/* Permission Mode (claude / codex / codebuddy) */}
        {hasPermissionMode && (
          <div style={fieldStyle}>
            <label style={labelStyle}>Permission Mode</label>
            <select value={permissionMode} onChange={(e) => setPermissionMode(e.target.value)} style={{ width: "100%" }}>
              {PERMISSION_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <div style={descStyle}>Controls how the agent handles tool permissions.</div>
          </div>
        )}

        {/* CLI Path */}
        {hasCliPath && (
          <div style={fieldStyle}>
            <label style={labelStyle}>CLI Path</label>
            <input value={cliPath} onChange={(e) => setCliPath(e.target.value)} placeholder={isOpenClaw ? "openclaw" : isCodex ? "codex" : isCodeBuddy ? "codebuddy" : "cursor"} style={{ width: "100%" }} />
            <div style={descStyle}>Path to the CLI executable. Defaults to "{isOpenClaw ? "openclaw" : isCodex ? "codex" : isCodeBuddy ? "codebuddy" : "cursor"}".</div>
          </div>
        )}

        {/* Thinking Level (openclaw only) */}
        {isOpenClaw && (
          <div style={fieldStyle}>
            <label style={labelStyle}>Thinking Level</label>
            <select value={thinking} onChange={(e) => setThinking(e.target.value)} style={{ width: "100%" }}>
              {THINKING_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <div style={descStyle}>Controls the thinking/reasoning depth of the agent.</div>
          </div>
        )}

        {/* Timeout in seconds (openclaw only) */}
        {isOpenClaw && (
          <div style={fieldStyle}>
            <label style={labelStyle}>Timeout (seconds)</label>
            <input value={timeout} onChange={(e) => setTimeout_(e.target.value)} placeholder="300" style={{ width: "100%" }} type="number" />
            <div style={descStyle}>Agent timeout in seconds. Empty for default (300s).</div>
          </div>
        )}

        {/* Proxy (codex only) */}
        {isCodex && (
          <div style={fieldStyle}>
            <label style={labelStyle}>Proxy</label>
            <input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="http://127.0.0.1:7890" style={{ width: "100%" }} />
            <div style={descStyle}>HTTP/HTTPS proxy for Codex API requests.</div>
          </div>
        )}

        {/* Timeout */}
        {hasTimeoutMs && (
          <div style={fieldStyle}>
            <label style={labelStyle}>Timeout (ms)</label>
            <input value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} placeholder="600000" style={{ width: "100%" }} type="number" />
            <div style={descStyle}>Maximum execution time in milliseconds. 0 or empty for no limit.</div>
          </div>
        )}

        {/* URL (http only) */}
        {isHttp && (
          <div style={fieldStyle}>
            <label style={labelStyle}>Endpoint URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:3000/chat" style={{ width: "100%" }} />
          </div>
        )}

        {/* Headers (http only) */}
        {isHttp && (
          <div style={fieldStyle}>
            <label style={labelStyle}>HTTP Headers</label>
            <KeyValueEditor value={headers} onChange={setHeaders} keyPlaceholder="Header-Name" valuePlaceholder="header value" />
          </div>
        )}

        {/* Environment Variables */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Environment Variables</label>
          <KeyValueEditor value={env} onChange={setEnv} keyPlaceholder="ENV_VAR" valuePlaceholder="value" />
          <div style={descStyle}>Extra environment variables passed to the agent process.</div>
        </div>

        {/* Other Config (read-only) */}
        {(() => {
          const knownKeys = new Set(["cwd", "model", "url", "headers", "env", "permissionMode", "cliPath", "proxy", "timeoutMs", "thinking", "timeout"]);
          const extraKeys = Object.keys(cfg).filter(k => !knownKeys.has(k));
          if (extraKeys.length === 0) return null;
          return (
            <div style={fieldStyle}>
              <label style={labelStyle}>Other Config</label>
              <div style={{
                background: "var(--bg-hover)", padding: 10, borderRadius: 6,
                fontSize: 12, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all",
              }}>
                {JSON.stringify(Object.fromEntries(extraKeys.map(k => [k, cfg[k]])), null, 2)}
              </div>
            </div>
          );
        })()}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          {saved && <span style={{ color: "var(--green)", fontSize: 13, alignSelf: "center", marginRight: "auto" }}>Saved & restarted</span>}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Model Switcher (inline dropdown) ─── */

function ModelSwitcher({ agent, onError }: { agent: Agent; onError: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrentModel] = useState<string | undefined>(
    (agent.config as Record<string, string>).model,
  );
  const [loading, setLoading] = useState(false);
  const [filterProvider, setFilterProvider] = useState<string | null>(null);

  const loadModels = async (provider?: string) => {
    setLoading(true);
    try {
      const res = await listAgentModels(agent.id, provider ?? undefined);
      setModels(res.models);
      setCurrentModel(res.currentModel);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setFilterProvider(null);
    loadModels();
  };

  const handleSelectModel = async (modelId: string) => {
    try {
      await setAgentModel(agent.id, modelId);
      setCurrentModel(modelId);
      setOpen(false);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const providers = React.useMemo(() => {
    const grouped = new Map<string, ModelInfo[]>();
    for (const m of models) {
      const list = grouped.get(m.provider) ?? [];
      list.push(m);
      grouped.set(m.provider, list);
    }
    return grouped;
  }, [models]);

  const displayModels = filterProvider ? (providers.get(filterProvider) ?? []) : models;

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, position: "relative" }}>
      <span
        onClick={handleOpen}
        style={{
          cursor: "pointer", padding: "2px 8px", borderRadius: 4,
          background: "var(--bg-hover, rgba(255,255,255,0.06))",
          border: "1px solid var(--border)",
          fontSize: 13, color: "var(--accent)",
          transition: "background 0.15s",
        }}
        title="Click to switch model"
      >
        {currentModel ?? "(default)"} ▾
      </span>

      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, zIndex: 100,
          marginTop: 4, minWidth: 320, maxHeight: 400, overflowY: "auto",
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          padding: 8,
        }}>
          {loading ? (
            <div style={{ padding: 12, color: "var(--text-dim)", textAlign: "center" }}>Loading models...</div>
          ) : (
            <>
              {providers.size > 1 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
                  <button
                    style={{
                      fontSize: 11, padding: "2px 8px", borderRadius: 3,
                      background: !filterProvider ? "var(--accent)" : "transparent",
                      color: !filterProvider ? "#fff" : "var(--text-dim)",
                      border: "1px solid var(--border)", cursor: "pointer",
                    }}
                    onClick={() => setFilterProvider(null)}
                  >All ({models.length})</button>
                  {Array.from(providers.entries()).map(([prov, provModels]) => (
                    <button
                      key={prov}
                      style={{
                        fontSize: 11, padding: "2px 8px", borderRadius: 3,
                        background: filterProvider === prov ? "var(--accent)" : "transparent",
                        color: filterProvider === prov ? "#fff" : "var(--text-dim)",
                        border: "1px solid var(--border)", cursor: "pointer",
                      }}
                      onClick={() => setFilterProvider(prov)}
                    >{prov} ({provModels.length})</button>
                  ))}
                </div>
              )}

              {displayModels.map((m) => {
                const shortName = m.id.includes("/") ? m.id.substring(m.id.indexOf("/") + 1) : m.id;
                const isCurrent = m.id === currentModel;
                return (
                  <div
                    key={m.id}
                    onClick={() => !isCurrent && handleSelectModel(m.id)}
                    style={{
                      padding: "6px 10px", borderRadius: 4, cursor: isCurrent ? "default" : "pointer",
                      background: isCurrent ? "rgba(var(--accent-rgb, 99,102,241), 0.15)" : "transparent",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      fontSize: 13,
                    }}
                    onMouseEnter={(e) => { if (!isCurrent) (e.currentTarget.style.background = "var(--bg-hover, rgba(255,255,255,0.06))"); }}
                    onMouseLeave={(e) => { if (!isCurrent) (e.currentTarget.style.background = "transparent"); }}
                  >
                    <span>
                      <span style={{ color: "var(--text-dim)", fontSize: 11, marginRight: 6 }}>{m.provider}/</span>
                      {shortName}
                    </span>
                    {isCurrent && <span style={{ fontSize: 11, color: "var(--accent)" }}>current</span>}
                  </div>
                );
              })}

              {displayModels.length === 0 && (
                <div style={{ padding: 12, color: "var(--text-dim)", textAlign: "center", fontSize: 13 }}>
                  No models available
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Main AgentManager page ─── */

export function AgentManager() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [settingsAgent, setSettingsAgent] = useState<Agent | null>(null);
  const [formId, setFormId] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formType, setFormType] = useState("claude-code");
  const [formCwd, setFormCwd] = useState("");
  const [formModel, setFormModel] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formPermissionMode, setFormPermissionMode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const formHasPermissionMode = formType === "claude-code" || formType === "codex" || formType === "codebuddy" || formType === "cursor-agent";

  const refresh = () => listAgents().then(setAgents).catch(() => {});
  useEffect(() => { refresh(); const i = setInterval(refresh, 3000); return () => clearInterval(i); }, []);

  const handleAdd = async () => {
    if (!formId || !formDisplayName) return;
    try {
      setError(null);
      const config: Record<string, unknown> = {};
      if (formCwd) config.cwd = formCwd;
      if (formModel) config.model = formModel;
      if (formUrl) config.url = formUrl;
      if (formHasPermissionMode && formPermissionMode) config.permissionMode = formPermissionMode;

      await createAgent({
        id: formId,
        display_name: formDisplayName,
        type: formType,
        config,
        auto_start: true,
      });
      setFormId(""); setFormDisplayName(""); setFormCwd(""); setFormModel(""); setFormUrl(""); setFormPermissionMode("");
      setShowAdd(false);
      refresh();
    } catch (err) { setError((err as Error).message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete agent "${id}"? This will also delete all its sessions.`)) return;
    try {
      await deleteAgent(id);
      refresh();
    } catch (err) { setError((err as Error).message); }
  };

  const handleToggle = async (agent: Agent) => {
    try {
      setError(null);
      const status = agent.runtimeStatus ?? agent.status;
      if (status === "running") {
        await stopAgent(agent.id);
      } else {
        await startAgent(agent.id);
      }
      refresh();
    } catch (err) { setError((err as Error).message); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2>Agent Manager</h2>
        <button className="primary" onClick={() => setShowAdd(!showAdd)}>+ Add Agent</button>
      </div>

      {error && <div style={{ ...cardStyle, borderColor: "var(--red)", color: "var(--red)" }}>⚠️ {error}</div>}

      {showAdd && (
        <div style={cardStyle}>
          <h3 style={{ marginBottom: 12 }}>Add Agent</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 13, color: "var(--text-dim)" }}>ID (used as #hashtag)</label>
              <input value={formId} onChange={(e) => setFormId(e.target.value)} placeholder="claude" />
            </div>
            <div>
              <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Display Name</label>
              <input value={formDisplayName} onChange={(e) => setFormDisplayName(e.target.value)} placeholder="🤖 Claude" />
            </div>
            <div>
              <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Type</label>
              <select value={formType} onChange={(e) => setFormType(e.target.value)}>
                {AGENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Working Directory</label>
              <input value={formCwd} onChange={(e) => setFormCwd(e.target.value)} placeholder="/home/user/project" />
            </div>
            <div>
              <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Model</label>
              <input value={formModel} onChange={(e) => setFormModel(e.target.value)} placeholder="sonnet" />
            </div>
            {formType === "http" && (
              <div>
                <label style={{ fontSize: 13, color: "var(--text-dim)" }}>URL</label>
                <input value={formUrl} onChange={(e) => setFormUrl(e.target.value)} placeholder="http://localhost:3000/chat" />
              </div>
            )}
          </div>
          {formHasPermissionMode && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Permission Mode</label>
                <select value={formPermissionMode} onChange={(e) => setFormPermissionMode(e.target.value)}>
                  {PERMISSION_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary" onClick={handleAdd}>Create & Start</button>
            <button onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {agents.map((agent) => {
        const status = agent.runtimeStatus ?? agent.status;
        const statusColor = status === "running" ? "var(--green)" : status === "error" ? "var(--red)" : "var(--text-dim)";
        const config = agent.config as Record<string, string>;
        const canSwitchModel = MODEL_SWITCH_TYPES.has(agent.type);

        return (
          <div key={agent.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: statusColor, marginRight: 8 }} />
                <span style={{ fontWeight: 600, fontSize: 16 }}>{agent.display_name}</span>
                <span style={{ color: "var(--accent)", fontSize: 13, marginLeft: 8 }}>#{agent.id}</span>
                <span style={{ color: "var(--text-dim)", fontSize: 13, marginLeft: 12 }}>{agent.type}</span>
                {agent.node_id !== "local" && (
                  <span style={{ color: "var(--yellow)", fontSize: 13, marginLeft: 8 }}>📡 {agent.node_id}</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setSettingsAgent(agent)} title="Agent Settings">⚙️</button>
                {agent.node_id === "local" && (
                  <button onClick={() => handleToggle(agent)}>
                    {status === "running" ? "Stop" : "Start"}
                  </button>
                )}
                <button className="danger" onClick={() => handleDelete(agent.id)}>Delete</button>
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span>Status: {status}</span>
              {config.cwd && <span>| CWD: {config.cwd}</span>}
              {canSwitchModel ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  | Model: <ModelSwitcher agent={agent} onError={(msg) => setError(msg)} />
                </span>
              ) : (
                config.model && <span>| Model: {config.model}</span>
              )}
              {config.url && <span>| URL: {config.url}</span>}
              {config.cliPath && <span>| CLI: {config.cliPath}</span>}
              {config.proxy && <span>| Proxy: {config.proxy}</span>}
              {config.permissionMode && <span>| Permission: {config.permissionMode}</span>}
              {config.thinking && <span>| Thinking: {config.thinking}</span>}
            </div>
          </div>
        );
      })}

      {agents.length === 0 && !showAdd && (
        <div style={{ ...cardStyle, textAlign: "center" as const, color: "var(--text-dim)" }}>
          No agents configured. Click "Add Agent" to get started.
        </div>
      )}

      {settingsAgent && (
        <AgentSettingsModal
          agent={settingsAgent}
          onClose={() => setSettingsAgent(null)}
          onSaved={() => { refresh(); setSettingsAgent(null); }}
        />
      )}
    </div>
  );
}
