# API 参考

ClawCenter 在 Web 管理面板同一端口（默认 9800）暴露 REST API。

## 设置

### GET /api/settings

返回所有设置（键值对象）。

### PUT /api/settings

更新设置。请求体：`{ "key": "reply_prefix_format", "value": "[{displayName}]" }`

## 统计

### GET /api/stats

返回：`{ accounts, agents, sessions, messages_today }`

## 微信账号

### GET /api/wechat-accounts

列出所有微信账号。Token 在返回中脱敏。

### POST /api/wechat-accounts

创建新账号。请求体：`{ "id": "personal", "name": "我的微信" }`

### DELETE /api/wechat-accounts/:id

删除账号及其路由规则。

### POST /api/wechat-accounts/:id/login

启动二维码登录流程。返回：`{ "qrUrl": "..." }`

### POST /api/wechat-accounts/:id/connect

开始接收已登录账号的消息。

### POST /api/wechat-accounts/:id/disconnect

停止接收消息但不删除账号。

## Agent

### GET /api/agents

列出所有 Agent。包含 `runtimeStatus`（适配器的实时状态）。

### POST /api/agents

创建并可选启动 Agent。请求体：

```json
{
  "id": "claude",
  "display_name": "🤖 Claude",
  "type": "claude-code",
  "config": { "cwd": "/home/user/project", "model": "sonnet" },
  "auto_start": true
}
```

支持的 `type` 值：`claude-code`、`claude-sdk`、`opencode`、`openclaw`、`codex`、`codebuddy`、`cursor-agent`、`http`、`worker`。

### PUT /api/agents/:id

更新 Agent 配置。请求体：`{ "display_name": "...", "config": { ... } }`

### DELETE /api/agents/:id

删除 Agent 及其所有会话。

### POST /api/agents/:id/start

启动已停止的 Agent。

### POST /api/agents/:id/stop

停止运行中的 Agent。

## 访问规则

### GET /api/access-rules?wechat_id=...

列出访问规则，可按微信账号过滤。

### POST /api/access-rules

创建规则。请求体：

```json
{
  "wechat_id": "personal",
  "user_pattern": "*",
  "agent_id": "claude",
  "is_default": true
}
```

### DELETE /api/access-rules/:id

删除规则。

## 会话

### GET /api/sessions?agent_id=...

列出会话，可按 Agent 过滤。

### DELETE /api/sessions/:id

清除会话（重置对话历史）。

## 消息

### GET /api/messages?limit=50

列出最近消息（最新的在后）。

## Worker

### GET /api/workers

列出已连接的 Worker 节点。

## Server-Sent Events

### GET /api/events

SSE 实时更新流。事件：

- `{ type: "init", mode, logs }` — 连接时的初始状态
- `{ type: "log", entry }` — 新日志条目（收消息/发消息/错误/信息）
- `{ type: "agent-update", agent }` — Agent 状态变更
