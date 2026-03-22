const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (options?.body) headers["Content-Type"] = "application/json";
  Object.assign(headers, options?.headers);

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Stats
export const getStats = () => request<{ accounts: number; agents: number; sessions: number; messages_today: number }>("/stats");

// Settings
export const getSettings = () => request<Record<string, string>>("/settings");
export const updateSetting = (key: string, value: string) =>
  request("/settings", { method: "PUT", body: JSON.stringify({ key, value }) });

// WeChat Accounts
export interface WechatAccount {
  id: string; name: string; token: string | null; base_url: string; cdn_base_url: string;
  account_id: string | null; user_id: string | null; status: string;
  created_at: number; updated_at: number;
}
export const listWechatAccounts = () => request<WechatAccount[]>("/wechat-accounts");
export const createWechatAccount = (data: { id: string; name: string }) =>
  request<WechatAccount>("/wechat-accounts", { method: "POST", body: JSON.stringify(data) });
export const deleteWechatAccount = (id: string) =>
  request(`/wechat-accounts/${id}`, { method: "DELETE" });
export const loginWechatAccount = (id: string) =>
  request<{ qrUrl: string }>(`/wechat-accounts/${id}/login`, { method: "POST" });
export const connectWechatAccount = (id: string) =>
  request(`/wechat-accounts/${id}/connect`, { method: "POST" });
export const disconnectWechatAccount = (id: string) =>
  request(`/wechat-accounts/${id}/disconnect`, { method: "POST" });

// Agents
export interface Agent {
  id: string; display_name: string; type: string; config: Record<string, unknown>;
  status: string; node_id: string; runtimeStatus?: string;
  created_at: number; updated_at: number;
}
export const listAgents = () => request<Agent[]>("/agents");
export const createAgent = (data: { id: string; display_name: string; type: string; config?: Record<string, unknown>; auto_start?: boolean }) =>
  request<Agent>("/agents", { method: "POST", body: JSON.stringify(data) });
export const updateAgent = (id: string, data: { display_name?: string; config?: Record<string, unknown> }) =>
  request<Agent>(`/agents/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteAgent = (id: string) => request(`/agents/${id}`, { method: "DELETE" });
export const startAgent = (id: string) => request(`/agents/${id}/start`, { method: "POST" });
export const stopAgent = (id: string) => request(`/agents/${id}/stop`, { method: "POST" });

export interface ModelInfo { id: string; provider: string; }
export interface AgentModelsResponse { models: ModelInfo[]; currentModel?: string; }
export const listAgentModels = (id: string, provider?: string) =>
  request<AgentModelsResponse>(`/agents/${id}/models${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`);
export const setAgentModel = (id: string, model: string) =>
  request<{ ok: boolean; model: string }>(`/agents/${id}/model`, { method: "PUT", body: JSON.stringify({ model }) });

// Access Rules
export interface AccessRule {
  id: number; wechat_id: string; user_pattern: string; agent_id: string; is_default: number;
}
export const listAccessRules = (wechatId?: string) =>
  request<AccessRule[]>(`/access-rules${wechatId ? `?wechat_id=${wechatId}` : ""}`);
export const createAccessRule = (data: { wechat_id: string; user_pattern?: string; agent_id: string; is_default?: boolean }) =>
  request<AccessRule>("/access-rules", { method: "POST", body: JSON.stringify(data) });
export const deleteAccessRule = (id: number) => request(`/access-rules/${id}`, { method: "DELETE" });

// Access Matrix
export interface AccessMatrixCell {
  wechat_id: string; agent_id: string; enabled: boolean; is_default: boolean;
}
export interface AccessMatrixAccount { id: string; name: string; status: string; }
export interface AccessMatrixAgent { id: string; display_name: string; type: string; status: string; }
export interface AccessMatrixData {
  matrix: AccessMatrixCell[];
  wechat_accounts: AccessMatrixAccount[];
  agents: AccessMatrixAgent[];
}
export const getAccessMatrix = () => request<AccessMatrixData>("/access-matrix");
export const toggleAccess = (wechatId: string, agentId: string, enabled: boolean) =>
  request("/access-matrix/toggle", { method: "PUT", body: JSON.stringify({ wechat_id: wechatId, agent_id: agentId, enabled }) });
export const setDefaultAgent = (wechatId: string, agentId: string) =>
  request("/access-matrix/default", { method: "PUT", body: JSON.stringify({ wechat_id: wechatId, agent_id: agentId }) });

// Sessions
export interface Session {
  id: string; wechat_id: string; user_id: string; agent_id: string;
  agent_session: string | null; message_count: number;
  created_at: number; last_active: number;
}
export const listSessions = (agentId?: string) =>
  request<Session[]>(`/sessions${agentId ? `?agent_id=${agentId}` : ""}`);
export const clearSession = (id: string) => request(`/sessions/${id}`, { method: "DELETE" });

// Messages
export interface Message {
  id: number; wechat_msg_id: string | null; client_id: string | null;
  session_id: string; agent_id: string; wechat_id: string; user_id: string;
  direction: string; content: string | null; media_path: string | null; created_at: number;
}
export const listMessages = (limit?: number) =>
  request<Message[]>(`/messages${limit ? `?limit=${limit}` : ""}`);

// Workers
export interface WorkerNode {
  id: string; address: string | null; status: string; last_seen: number; created_at: number;
}
export const listWorkers = () => request<WorkerNode[]>("/workers");

// SSE
export function subscribeEvents(onEvent: (data: unknown) => void): () => void {
  const es = new EventSource(`${BASE}/events`);
  es.onmessage = (e) => {
    try { onEvent(JSON.parse(e.data)); } catch {}
  };
  es.onerror = () => {
    setTimeout(() => {
      es.close();
      subscribeEvents(onEvent);
    }, 3000);
  };
  return () => es.close();
}
