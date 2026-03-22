import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import type { Store } from "../db/store.js";
import type { AgentManager } from "../agents/manager.js";
import type { AgentType, AgentConfig } from "../agents/adapter.js";
import type { Dispatcher } from "../../center/dispatcher.js";

export function registerApiRoutes(
  app: FastifyInstance,
  store: Store,
  agentManager: AgentManager,
  dispatcher?: Dispatcher,
): void {
  // ─── Settings ───

  app.get("/api/settings", async () => {
    return store.getAllSettings();
  });

  app.put<{ Body: { key: string; value: string } }>("/api/settings", async (req) => {
    const { key, value } = req.body;
    store.setSetting(key, value);
    return { ok: true };
  });

  // ─── Stats ───

  app.get("/api/stats", async () => {
    return store.getStats();
  });

  // ─── WeChat Accounts ───

  app.get("/api/wechat-accounts", async () => {
    return store.listWechatAccounts().map((a) => ({
      ...a,
      token: a.token ? "***" : null,
      get_updates_buf: a.get_updates_buf ? `(${a.get_updates_buf.length} bytes)` : "",
    }));
  });

  app.post<{
    Body: { id: string; name: string; base_url?: string; cdn_base_url?: string };
  }>("/api/wechat-accounts", async (req) => {
    const account = store.createWechatAccount(req.body);
    return account;
  });

  app.delete<{ Params: { id: string } }>("/api/wechat-accounts/:id", async (req) => {
    if (dispatcher) {
      await dispatcher.stopConnector(req.params.id);
    }
    store.deleteWechatAccount(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/wechat-accounts/:id/login", async (req, reply) => {
    if (!dispatcher) {
      return reply.code(400).send({ error: "Not in center mode" });
    }

    const connector = dispatcher.getConnector(req.params.id);
    if (connector) {
      return reply.code(400).send({ error: "Already connected" });
    }

    const account = store.getWechatAccount(req.params.id);
    if (!account) {
      return reply.code(404).send({ error: `Account "${req.params.id}" not found` });
    }

    const { WechatConnector } = await import("../../center/wechat/connector.js");
    const tempConnector = new WechatConnector(store, req.params.id);

    const accountId = req.params.id;
    const emitLog = (type: "info" | "error", text: string) => {
      dispatcher?.emit("log", { time: Date.now(), type, wechatId: accountId, text });
    };

    try {
      let loginResolved = false;
      const qrContent = await new Promise<string>((resolve, reject) => {
        tempConnector.login({
          onQrCode: (url) => { loginResolved = true; resolve(url); },
          onStatus: (msg) => {
            console.log(`[Login:${accountId}]`, msg);
            emitLog("info", `[Login] ${msg}`);
          },
        }).then(async () => {
          console.log(`[Login:${accountId}] Login successful, starting connector...`);
          emitLog("info", `[Login] Login successful`);
          try {
            await dispatcher!.startConnector(accountId);
          } catch (err) {
            console.error(`[Login:${accountId}] Auto-connect failed:`, (err as Error).message);
            emitLog("error", `[Login] Auto-connect failed: ${(err as Error).message}`);
          }
        }).catch((err) => {
          const msg = (err as Error).message;
          console.error(`[Login:${accountId}] Background login failed:`, msg);
          emitLog("error", `[Login] Failed: ${msg}`);
          if (!loginResolved) reject(err);
        });
      });
      const qrUrl = await QRCode.toDataURL(qrContent, { width: 300, margin: 2 });
      return { qrUrl, status: "waiting_for_scan" };
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[Login:${accountId}] Error:`, message);
      emitLog("error", `[Login] Failed: ${message}`);
      return reply.code(500).send({ error: `Login failed: ${message}` });
    }
  });

  app.post<{ Params: { id: string } }>("/api/wechat-accounts/:id/connect", async (req, reply) => {
    if (!dispatcher) {
      return reply.code(400).send({ error: "Not in center mode" });
    }

    try {
      await dispatcher.startConnector(req.params.id);
      return { ok: true, status: "connected" };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>("/api/wechat-accounts/:id/disconnect", async (req) => {
    if (dispatcher) {
      await dispatcher.stopConnector(req.params.id);
    }
    return { ok: true };
  });

  // ─── Agents ───

  app.get("/api/agents", async () => {
    const agents = store.listAgents();
    return agents.map((a) => ({
      ...a,
      runtimeStatus: agentManager.getAdapter(a.id)?.status ?? a.status,
    }));
  });

  app.post<{
    Body: {
      id: string;
      display_name: string;
      type: AgentType;
      config?: AgentConfig;
      auto_start?: boolean;
    };
  }>("/api/agents", async (req, reply) => {
    try {
      await agentManager.addAgent({
        id: req.body.id,
        displayName: req.body.display_name,
        type: req.body.type,
        config: req.body.config,
        autoStart: req.body.auto_start,
      });
      return store.getAgent(req.body.id);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.put<{
    Params: { id: string };
    Body: { display_name?: string; config?: AgentConfig };
  }>("/api/agents/:id", async (req, reply) => {
    const agent = store.getAgent(req.params.id);
    if (!agent) return reply.code(404).send({ error: "Agent not found" });

    const updates: Record<string, unknown> = {};
    if (req.body.display_name) updates.display_name = req.body.display_name;
    if (req.body.config) updates.config = req.body.config;
    store.updateAgent(req.params.id, updates);
    return store.getAgent(req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/api/agents/:id", async (req) => {
    await agentManager.removeAgent(req.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { provider?: string } }>("/api/agents/:id/models", async (req, reply) => {
    const adapter = agentManager.getAdapter(req.params.id);
    if (!adapter) return reply.code(404).send({ error: "Agent not found" });
    if (!adapter.supportsModelSwitch) {
      return reply.code(400).send({ error: `Agent type "${adapter.type}" does not support model switching` });
    }
    try {
      const provider = (req.query as Record<string, string>).provider;
      const models = await agentManager.listAgentModels(req.params.id, provider);
      const currentModel = agentManager.getAgentModel(req.params.id);
      return { models, currentModel };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.put<{ Params: { id: string }; Body: { model: string } }>("/api/agents/:id/model", async (req, reply) => {
    try {
      agentManager.setAgentModel(req.params.id, req.body.model);
      return { ok: true, model: req.body.model };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>("/api/agents/:id/start", async (req, reply) => {
    try {
      await agentManager.startAgent(req.params.id);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>("/api/agents/:id/stop", async (req, reply) => {
    try {
      await agentManager.stopAgent(req.params.id);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // ─── Access Rules ───

  app.get("/api/access-rules", async (req) => {
    const wechatId = (req.query as Record<string, string>).wechat_id;
    return store.listAccessRules(wechatId);
  });

  app.post<{
    Body: { wechat_id: string; user_pattern?: string; agent_id: string; is_default?: boolean };
  }>("/api/access-rules", async (req) => {
    return store.createAccessRule(req.body);
  });

  app.delete<{ Params: { id: string } }>("/api/access-rules/:id", async (req) => {
    store.deleteAccessRule(parseInt(req.params.id, 10));
    return { ok: true };
  });

  // ─── Access Matrix ───

  app.get("/api/access-matrix", async () => {
    return {
      matrix: store.getAccessMatrix(),
      wechat_accounts: store.listWechatAccounts().map((a) => ({ id: a.id, name: a.name, status: a.status })),
      agents: store.listAgents().map((a) => ({ id: a.id, display_name: a.display_name, type: a.type, status: a.status })),
    };
  });

  app.put<{
    Body: { wechat_id: string; agent_id: string; enabled: boolean };
  }>("/api/access-matrix/toggle", async (req) => {
    store.setAccess(req.body.wechat_id, req.body.agent_id, req.body.enabled);
    return { ok: true };
  });

  app.put<{
    Body: { wechat_id: string; agent_id: string };
  }>("/api/access-matrix/default", async (req) => {
    store.setDefaultAgent(req.body.wechat_id, req.body.agent_id);
    return { ok: true };
  });

  // ─── Sessions ───

  app.get("/api/sessions", async (req) => {
    const agentId = (req.query as Record<string, string>).agent_id;
    return store.listSessions(agentId);
  });

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (req) => {
    store.clearSession(req.params.id);
    return { ok: true };
  });

  // ─── Messages ───

  app.get("/api/messages", async (req) => {
    const limit = parseInt((req.query as Record<string, string>).limit ?? "50", 10);
    return store.listRecentMessages(limit);
  });

  // ─── Workers ───

  app.get("/api/workers", async () => {
    return store.listWorkerNodes();
  });
}
