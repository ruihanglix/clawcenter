import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { SCHEMA_SQL, DEFAULT_SETTINGS } from "./schema.js";

export interface WechatAccount {
  id: string;
  name: string;
  token: string | null;
  base_url: string;
  cdn_base_url: string;
  account_id: string | null;
  user_id: string | null;
  status: string;
  get_updates_buf: string;
  created_at: number;
  updated_at: number;
}

export interface Agent {
  id: string;
  display_name: string;
  type: string;
  config: Record<string, unknown>;
  status: string;
  node_id: string;
  created_at: number;
  updated_at: number;
}

export interface AccessRule {
  id: number;
  wechat_id: string;
  user_pattern: string;
  agent_id: string;
  is_default: number;
}

export interface Session {
  id: string;
  wechat_id: string;
  user_id: string;
  agent_id: string;
  agent_session: string | null;
  label: string | null;
  is_active: number;
  message_count: number;
  created_at: number;
  last_active: number;
}

export interface Message {
  id: number;
  wechat_msg_id: string | null;
  client_id: string | null;
  session_id: string;
  agent_id: string;
  wechat_id: string;
  user_id: string;
  direction: "inbound" | "outbound";
  content: string | null;
  media_path: string | null;
  created_at: number;
}

export interface StickyRoute {
  wechat_id: string;
  user_id: string;
  agent_id: string;
  updated_at: number;
}

export interface WorkerNode {
  id: string;
  address: string | null;
  status: string;
  last_seen: number;
  created_at: number;
}

function rowToObj(columns: string[], values: unknown[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) {
    obj[columns[i]] = values[i];
  }
  return obj;
}

function queryAll<T>(db: SqlJsDatabase, sql: string, params?: unknown[]): T[] {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    results.push(rowToObj(cols, vals) as T);
  }
  stmt.free();
  return results;
}

function queryOne<T>(db: SqlJsDatabase, sql: string, params?: unknown[]): T | null {
  const results = queryAll<T>(db, sql, params);
  return results[0] ?? null;
}

function run(db: SqlJsDatabase, sql: string, params?: unknown[]): void {
  if (params && params.length > 0) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
  } else {
    db.run(sql);
  }
}

export class Store {
  private db!: SqlJsDatabase;
  private dbPath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    const SQL = await initSqlJs();
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    db_exec(this.db, SCHEMA_SQL);
    this.migrateSchema();
    this.initDefaultSettings();
    this.persist();
  }

  private migrateSchema(): void {
    const alterStatements = [
      "ALTER TABLE sessions ADD COLUMN label TEXT",
      "ALTER TABLE sessions ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
    ];
    for (const sql of alterStatements) {
      try { this.db.run(sql); } catch { /* column already exists */ }
    }
  }

  private initDefaultSettings(): void {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      const existing = queryOne<{ key: string }>(
        this.db,
        "SELECT key FROM settings WHERE key = ?",
        [key],
      );
      if (!existing) {
        run(this.db, "INSERT INTO settings (key, value) VALUES (?, ?)", [key, value]);
      }
    }
  }

  private persist(): void {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  private schedulePersist(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, 100);
  }

  close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.persist();
    this.db.close();
  }

  // ─── Settings ───

  getSetting(key: string): string | null {
    const row = queryOne<{ value: string }>(
      this.db,
      "SELECT value FROM settings WHERE key = ?",
      [key],
    );
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    run(
      this.db,
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      [key, value],
    );
    this.schedulePersist();
  }

  getAllSettings(): Record<string, string> {
    const rows = queryAll<{ key: string; value: string }>(
      this.db,
      "SELECT key, value FROM settings",
    );
    const result: Record<string, string> = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  }

  // ─── WeChat Accounts ───

  createWechatAccount(data: { id: string; name: string; base_url?: string; cdn_base_url?: string }): WechatAccount {
    const now = Date.now();
    run(this.db,
      `INSERT INTO wechat_accounts (id, name, base_url, cdn_base_url, status, get_updates_buf, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'disconnected', '', ?, ?)`,
      [data.id, data.name, data.base_url ?? "https://ilinkai.weixin.qq.com",
       data.cdn_base_url ?? "https://novac2c.cdn.weixin.qq.com/c2c", now, now],
    );

    const agents = this.listAgents();
    for (let i = 0; i < agents.length; i++) {
      run(this.db,
        `INSERT OR IGNORE INTO access_rules (wechat_id, user_pattern, agent_id, is_default) VALUES (?, '*', ?, ?)`,
        [data.id, agents[i].id, i === 0 ? 1 : 0],
      );
    }

    this.schedulePersist();
    return this.getWechatAccount(data.id)!;
  }

  getWechatAccount(id: string): WechatAccount | null {
    return queryOne<WechatAccount>(this.db, "SELECT * FROM wechat_accounts WHERE id = ?", [id]);
  }

  listWechatAccounts(): WechatAccount[] {
    return queryAll<WechatAccount>(this.db, "SELECT * FROM wechat_accounts ORDER BY created_at");
  }

  updateWechatAccount(id: string, data: Partial<Omit<WechatAccount, "id" | "created_at">>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(data)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    fields.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);
    run(this.db, `UPDATE wechat_accounts SET ${fields.join(", ")} WHERE id = ?`, values);
    this.schedulePersist();
  }

  deleteWechatAccount(id: string): void {
    run(this.db, "DELETE FROM wechat_accounts WHERE id = ?", [id]);
    run(this.db, "DELETE FROM access_rules WHERE wechat_id = ?", [id]);
    run(this.db, "DELETE FROM sticky_routes WHERE wechat_id = ?", [id]);
    this.schedulePersist();
  }

  // ─── Agents ───

  createAgent(data: { id: string; display_name: string; type: string; config?: Record<string, unknown>; node_id?: string }): Agent {
    const now = Date.now();
    run(this.db,
      `INSERT INTO agents (id, display_name, type, config, status, node_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'stopped', ?, ?, ?)`,
      [data.id, data.display_name, data.type, JSON.stringify(data.config ?? {}),
       data.node_id ?? "local", now, now],
    );

    const accounts = this.listWechatAccounts();
    for (const account of accounts) {
      const hasDefault = queryOne<AccessRule>(
        this.db,
        "SELECT * FROM access_rules WHERE wechat_id = ? AND user_pattern = '*' AND is_default = 1",
        [account.id],
      );
      run(this.db,
        `INSERT OR IGNORE INTO access_rules (wechat_id, user_pattern, agent_id, is_default) VALUES (?, '*', ?, ?)`,
        [account.id, data.id, hasDefault ? 0 : 1],
      );
    }

    this.schedulePersist();
    return this.getAgent(data.id)!;
  }

  getAgent(id: string): Agent | null {
    const row = queryOne<Agent & { config: string }>(this.db, "SELECT * FROM agents WHERE id = ?", [id]);
    if (!row) return null;
    return { ...row, config: JSON.parse(row.config as string) };
  }

  listAgents(): Agent[] {
    return queryAll<Agent & { config: string }>(this.db, "SELECT * FROM agents ORDER BY created_at").map(
      (row) => ({ ...row, config: JSON.parse(row.config as string) }),
    );
  }

  updateAgent(id: string, data: Partial<Omit<Agent, "id" | "created_at">>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (key === "config") {
        fields.push("config = ?");
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    fields.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);
    run(this.db, `UPDATE agents SET ${fields.join(", ")} WHERE id = ?`, values);
    this.schedulePersist();
  }

  deleteAgent(id: string): void {
    run(this.db, "DELETE FROM agents WHERE id = ?", [id]);
    run(this.db, "DELETE FROM access_rules WHERE agent_id = ?", [id]);
    this.schedulePersist();
  }

  // ─── Access Rules ───

  createAccessRule(data: { wechat_id: string; user_pattern?: string; agent_id: string; is_default?: boolean }): AccessRule {
    if (data.is_default) {
      run(this.db,
        "UPDATE access_rules SET is_default = 0 WHERE wechat_id = ? AND user_pattern = ?",
        [data.wechat_id, data.user_pattern ?? "*"],
      );
    }
    run(this.db,
      `INSERT OR REPLACE INTO access_rules (wechat_id, user_pattern, agent_id, is_default)
       VALUES (?, ?, ?, ?)`,
      [data.wechat_id, data.user_pattern ?? "*", data.agent_id, data.is_default ? 1 : 0],
    );
    this.schedulePersist();
    return queryOne<AccessRule>(
      this.db,
      "SELECT * FROM access_rules WHERE wechat_id = ? AND user_pattern = ? AND agent_id = ?",
      [data.wechat_id, data.user_pattern ?? "*", data.agent_id],
    )!;
  }

  listAccessRules(wechatId?: string): AccessRule[] {
    if (wechatId) {
      return queryAll<AccessRule>(this.db, "SELECT * FROM access_rules WHERE wechat_id = ?", [wechatId]);
    }
    return queryAll<AccessRule>(this.db, "SELECT * FROM access_rules");
  }

  getDefaultAgent(wechatId: string, userId: string): string | null {
    // Specific user match first
    let rule = queryOne<AccessRule>(
      this.db,
      "SELECT * FROM access_rules WHERE wechat_id = ? AND user_pattern = ? AND is_default = 1",
      [wechatId, userId],
    );
    if (rule) return rule.agent_id;
    // Wildcard match
    rule = queryOne<AccessRule>(
      this.db,
      "SELECT * FROM access_rules WHERE wechat_id = ? AND user_pattern = '*' AND is_default = 1",
      [wechatId],
    );
    return rule?.agent_id ?? null;
  }

  isAgentAllowed(wechatId: string, userId: string, agentId: string): boolean {
    const specific = queryOne<AccessRule>(
      this.db,
      "SELECT * FROM access_rules WHERE wechat_id = ? AND user_pattern = ? AND agent_id = ?",
      [wechatId, userId, agentId],
    );
    if (specific) return true;
    const wildcard = queryOne<AccessRule>(
      this.db,
      "SELECT * FROM access_rules WHERE wechat_id = ? AND user_pattern = '*' AND agent_id = ?",
      [wechatId, agentId],
    );
    return !!wildcard;
  }

  getAllowedAgents(wechatId: string, userId: string): string[] {
    const rules = queryAll<AccessRule>(
      this.db,
      "SELECT DISTINCT agent_id FROM access_rules WHERE wechat_id = ? AND (user_pattern = '*' OR user_pattern = ?)",
      [wechatId, userId],
    );
    return rules.map((r) => r.agent_id);
  }

  deleteAccessRule(id: number): void {
    run(this.db, "DELETE FROM access_rules WHERE id = ?", [id]);
    this.schedulePersist();
  }

  getAccessMatrix(): { wechat_id: string; agent_id: string; enabled: boolean; is_default: boolean }[] {
    const accounts = this.listWechatAccounts();
    const agents = this.listAgents();
    const rules = queryAll<AccessRule>(
      this.db,
      "SELECT * FROM access_rules WHERE user_pattern = '*'",
    );
    const ruleMap = new Map<string, AccessRule>();
    for (const r of rules) {
      ruleMap.set(`${r.wechat_id}:${r.agent_id}`, r);
    }

    // Fix dirty data: ensure at most one default per wechat account
    const defaultSeen = new Set<string>();
    let dirty = false;
    for (const r of rules) {
      if (r.is_default === 1) {
        if (defaultSeen.has(r.wechat_id)) {
          run(this.db, "UPDATE access_rules SET is_default = 0 WHERE id = ?", [r.id]);
          r.is_default = 0;
          dirty = true;
        } else {
          defaultSeen.add(r.wechat_id);
        }
      }
    }
    if (dirty) this.schedulePersist();

    const matrix: { wechat_id: string; agent_id: string; enabled: boolean; is_default: boolean }[] = [];
    for (const account of accounts) {
      for (const agent of agents) {
        const rule = ruleMap.get(`${account.id}:${agent.id}`);
        matrix.push({
          wechat_id: account.id,
          agent_id: agent.id,
          enabled: !!rule,
          is_default: !!rule && rule.is_default === 1,
        });
      }
    }
    return matrix;
  }

  setAccess(wechatId: string, agentId: string, enabled: boolean): void {
    if (enabled) {
      const hasDefault = queryOne<AccessRule>(
        this.db,
        "SELECT * FROM access_rules WHERE wechat_id = ? AND user_pattern = '*' AND is_default = 1",
        [wechatId],
      );
      run(this.db,
        `INSERT OR IGNORE INTO access_rules (wechat_id, user_pattern, agent_id, is_default) VALUES (?, '*', ?, ?)`,
        [wechatId, agentId, hasDefault ? 0 : 1],
      );
    } else {
      const wasDefault = queryOne<AccessRule>(
        this.db,
        "SELECT * FROM access_rules WHERE wechat_id = ? AND user_pattern = '*' AND agent_id = ? AND is_default = 1",
        [wechatId, agentId],
      );
      run(this.db,
        "DELETE FROM access_rules WHERE wechat_id = ? AND user_pattern = '*' AND agent_id = ?",
        [wechatId, agentId],
      );
      if (wasDefault) {
        const nextRule = queryOne<AccessRule>(
          this.db,
          "SELECT * FROM access_rules WHERE wechat_id = ? AND user_pattern = '*' LIMIT 1",
          [wechatId],
        );
        if (nextRule) {
          run(this.db, "UPDATE access_rules SET is_default = 1 WHERE id = ?", [nextRule.id]);
        }
      }
    }
    this.schedulePersist();
  }

  setDefaultAgent(wechatId: string, agentId: string): void {
    run(this.db,
      "UPDATE access_rules SET is_default = 0 WHERE wechat_id = ? AND user_pattern = '*'",
      [wechatId],
    );
    run(this.db,
      "UPDATE access_rules SET is_default = 1 WHERE wechat_id = ? AND user_pattern = '*' AND agent_id = ?",
      [wechatId, agentId],
    );
    this.schedulePersist();
  }

  // ─── Sessions ───

  getOrCreateSession(wechatId: string, userId: string, agentId: string): Session {
    let session = queryOne<Session>(
      this.db,
      "SELECT * FROM sessions WHERE wechat_id = ? AND user_id = ? AND agent_id = ? AND is_active = 1",
      [wechatId, userId, agentId],
    );
    if (!session) {
      const id = crypto.randomUUID();
      const now = Date.now();
      run(this.db,
        `INSERT INTO sessions (id, wechat_id, user_id, agent_id, is_active, message_count, created_at, last_active)
         VALUES (?, ?, ?, ?, 1, 0, ?, ?)`,
        [id, wechatId, userId, agentId, now, now],
      );
      this.schedulePersist();
      session = this.getSession(id)!;
    }
    return session;
  }

  getSession(id: string): Session | null {
    return queryOne<Session>(this.db, "SELECT * FROM sessions WHERE id = ?", [id]);
  }

  listSessions(agentId?: string): Session[] {
    if (agentId) {
      return queryAll<Session>(this.db, "SELECT * FROM sessions WHERE agent_id = ? ORDER BY last_active DESC", [agentId]);
    }
    return queryAll<Session>(this.db, "SELECT * FROM sessions ORDER BY last_active DESC");
  }

  incrementSessionMessages(sessionId: string): void {
    run(this.db,
      "UPDATE sessions SET message_count = message_count + 1, last_active = ? WHERE id = ?",
      [Date.now(), sessionId],
    );
    this.schedulePersist();
  }

  updateSessionAgentSession(sessionId: string, agentSession: string): void {
    run(this.db,
      "UPDATE sessions SET agent_session = ?, last_active = ? WHERE id = ?",
      [agentSession, Date.now(), sessionId],
    );
    this.schedulePersist();
  }

  clearSession(sessionId: string): void {
    run(this.db, "UPDATE sessions SET agent_session = NULL, message_count = 0 WHERE id = ?", [sessionId]);
    run(this.db, "DELETE FROM messages WHERE session_id = ?", [sessionId]);
    this.schedulePersist();
  }

  deleteSessionsByAgent(agentId: string): void {
    run(this.db, "DELETE FROM messages WHERE agent_id = ?", [agentId]);
    run(this.db, "DELETE FROM sessions WHERE agent_id = ?", [agentId]);
    this.schedulePersist();
  }

  listUserAgentSessions(wechatId: string, userId: string, agentId: string): Session[] {
    return queryAll<Session>(
      this.db,
      "SELECT * FROM sessions WHERE wechat_id = ? AND user_id = ? AND agent_id = ? ORDER BY last_active DESC",
      [wechatId, userId, agentId],
    );
  }

  createNewSession(wechatId: string, userId: string, agentId: string, label?: string): Session {
    run(this.db,
      "UPDATE sessions SET is_active = 0 WHERE wechat_id = ? AND user_id = ? AND agent_id = ?",
      [wechatId, userId, agentId],
    );
    const id = crypto.randomUUID();
    const now = Date.now();
    run(this.db,
      `INSERT INTO sessions (id, wechat_id, user_id, agent_id, label, is_active, message_count, created_at, last_active)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      [id, wechatId, userId, agentId, label ?? null, now, now],
    );
    this.schedulePersist();
    return this.getSession(id)!;
  }

  switchActiveSession(wechatId: string, userId: string, agentId: string, sessionId: string): boolean {
    const target = this.getSession(sessionId);
    if (!target || target.wechat_id !== wechatId || target.user_id !== userId || target.agent_id !== agentId) {
      return false;
    }
    run(this.db,
      "UPDATE sessions SET is_active = 0 WHERE wechat_id = ? AND user_id = ? AND agent_id = ?",
      [wechatId, userId, agentId],
    );
    run(this.db, "UPDATE sessions SET is_active = 1 WHERE id = ?", [sessionId]);
    this.schedulePersist();
    return true;
  }

  renameSession(sessionId: string, label: string): void {
    run(this.db, "UPDATE sessions SET label = ? WHERE id = ?", [label, sessionId]);
    this.schedulePersist();
  }

  setSessionLabelIfEmpty(sessionId: string, label: string): void {
    run(this.db, "UPDATE sessions SET label = ? WHERE id = ? AND label IS NULL", [label, sessionId]);
    this.schedulePersist();
  }

  deleteSession(sessionId: string): { ok: boolean; error?: string } {
    const session = this.getSession(sessionId);
    if (!session) return { ok: false, error: "会话不存在" };

    const siblings = this.listUserAgentSessions(session.wechat_id, session.user_id, session.agent_id);
    if (siblings.length <= 1) {
      return { ok: false, error: "无法删除唯一的会话，请使用 /clear 清空会话内容" };
    }

    const wasActive = session.is_active === 1;
    run(this.db, "DELETE FROM messages WHERE session_id = ?", [sessionId]);
    run(this.db, "DELETE FROM sessions WHERE id = ?", [sessionId]);

    if (wasActive) {
      const remaining = this.listUserAgentSessions(session.wechat_id, session.user_id, session.agent_id);
      if (remaining.length > 0) {
        run(this.db, "UPDATE sessions SET is_active = 1 WHERE id = ?", [remaining[0].id]);
      }
    }

    this.schedulePersist();
    return { ok: true };
  }

  // ─── Messages ───

  recordMessage(data: {
    wechat_msg_id?: string;
    client_id?: string;
    session_id: string;
    agent_id: string;
    wechat_id: string;
    user_id: string;
    direction: "inbound" | "outbound";
    content?: string;
    media_path?: string;
  }): number {
    run(this.db,
      `INSERT INTO messages (wechat_msg_id, client_id, session_id, agent_id, wechat_id, user_id, direction, content, media_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.wechat_msg_id ?? null, data.client_id ?? null, data.session_id,
       data.agent_id, data.wechat_id, data.user_id, data.direction,
       data.content ?? null, data.media_path ?? null, Date.now()],
    );
    this.schedulePersist();
    return this.db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] as number ?? 0;
  }

  findMessageByClientId(clientId: string): Message | null {
    return queryOne<Message>(this.db, "SELECT * FROM messages WHERE client_id = ?", [clientId]);
  }

  findMessageByWechatMsgId(wechatMsgId: string): Message | null {
    return queryOne<Message>(this.db, "SELECT * FROM messages WHERE wechat_msg_id = ?", [wechatMsgId]);
  }

  findOutboundMessageByContent(wechatId: string, userId: string, contentPrefix: string): Message | null {
    return queryOne<Message>(
      this.db,
      "SELECT * FROM messages WHERE wechat_id = ? AND user_id = ? AND direction = 'outbound' AND content LIKE ? ORDER BY created_at DESC LIMIT 1",
      [wechatId, userId, contentPrefix + "%"],
    );
  }

  listRecentMessages(limit: number = 50): Message[] {
    return queryAll<Message>(
      this.db,
      "SELECT * FROM messages ORDER BY created_at DESC LIMIT ?",
      [limit],
    ).reverse();
  }

  // ─── Sticky Routes ───

  getStickyRoute(wechatId: string, userId: string): string | null {
    const row = queryOne<StickyRoute>(
      this.db,
      "SELECT * FROM sticky_routes WHERE wechat_id = ? AND user_id = ?",
      [wechatId, userId],
    );
    return row?.agent_id ?? null;
  }

  setStickyRoute(wechatId: string, userId: string, agentId: string): void {
    run(this.db,
      `INSERT OR REPLACE INTO sticky_routes (wechat_id, user_id, agent_id, updated_at)
       VALUES (?, ?, ?, ?)`,
      [wechatId, userId, agentId, Date.now()],
    );
    this.schedulePersist();
  }

  // ─── Worker Nodes ───

  registerWorkerNode(id: string, address: string | null): WorkerNode {
    const now = Date.now();
    const existing = queryOne<WorkerNode>(this.db, "SELECT * FROM worker_nodes WHERE id = ?", [id]);
    if (existing) {
      run(this.db,
        "UPDATE worker_nodes SET address = ?, status = 'connected', last_seen = ? WHERE id = ?",
        [address, now, id],
      );
    } else {
      run(this.db,
        `INSERT INTO worker_nodes (id, address, status, last_seen, created_at)
         VALUES (?, ?, 'connected', ?, ?)`,
        [id, address, now, now],
      );
    }
    this.schedulePersist();
    return queryOne<WorkerNode>(this.db, "SELECT * FROM worker_nodes WHERE id = ?", [id])!;
  }

  updateWorkerNodeStatus(id: string, status: string): void {
    run(this.db,
      "UPDATE worker_nodes SET status = ?, last_seen = ? WHERE id = ?",
      [status, Date.now(), id],
    );
    this.schedulePersist();
  }

  listWorkerNodes(): WorkerNode[] {
    return queryAll<WorkerNode>(this.db, "SELECT * FROM worker_nodes ORDER BY created_at");
  }

  // ─── Stats ───

  getStats(): { accounts: number; agents: number; sessions: number; messages_today: number } {
    const accounts = (queryOne<{ c: number }>(this.db, "SELECT COUNT(*) as c FROM wechat_accounts") ?? { c: 0 }).c;
    const agents = (queryOne<{ c: number }>(this.db, "SELECT COUNT(*) as c FROM agents") ?? { c: 0 }).c;
    const sessions = (queryOne<{ c: number }>(this.db, "SELECT COUNT(*) as c FROM sessions") ?? { c: 0 }).c;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const messages_today = (queryOne<{ c: number }>(
      this.db,
      "SELECT COUNT(*) as c FROM messages WHERE created_at >= ?",
      [todayStart.getTime()],
    ) ?? { c: 0 }).c;
    return { accounts, agents, sessions, messages_today };
  }
}

function db_exec(db: SqlJsDatabase, sql: string): void {
  db.run(sql);
}
