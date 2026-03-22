export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS wechat_accounts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  token         TEXT,
  base_url      TEXT NOT NULL DEFAULT 'https://ilinkai.weixin.qq.com',
  cdn_base_url  TEXT NOT NULL DEFAULT 'https://novac2c.cdn.weixin.qq.com/c2c',
  account_id    TEXT,
  user_id       TEXT,
  status        TEXT NOT NULL DEFAULT 'disconnected',
  get_updates_buf TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  type          TEXT NOT NULL,
  config        TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'stopped',
  node_id       TEXT NOT NULL DEFAULT 'local',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS access_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  wechat_id     TEXT NOT NULL,
  user_pattern  TEXT NOT NULL DEFAULT '*',
  agent_id      TEXT NOT NULL,
  is_default    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(wechat_id, user_pattern, agent_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  wechat_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  agent_session TEXT,
  label         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_active   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  wechat_msg_id TEXT,
  client_id     TEXT,
  session_id    TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  wechat_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  direction     TEXT NOT NULL,
  content       TEXT,
  media_path    TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_id);
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

CREATE TABLE IF NOT EXISTS sticky_routes (
  wechat_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY(wechat_id, user_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_nodes (
  id            TEXT PRIMARY KEY,
  address       TEXT,
  status        TEXT NOT NULL DEFAULT 'disconnected',
  last_seen     INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
`;

export const DEFAULT_SETTINGS: Record<string, string> = {
  reply_prefix_format: "[{displayName}]",
  web_port: "9800",
  worker_port: "9801",
  web_host: "0.0.0.0",
  worker_host: "0.0.0.0",
  worker_web_port: "9802",
  worker_web_host: "127.0.0.1",
};
