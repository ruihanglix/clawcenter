# API Reference

ClawCenter exposes a REST API on the same port as the Web UI (default 9800).

## Settings

### GET /api/settings

Returns all settings as a key-value object.

### PUT /api/settings

Update a setting. Body: `{ "key": "reply_prefix_format", "value": "[{displayName}]" }`

## Stats

### GET /api/stats

Returns: `{ accounts, agents, sessions, messages_today }`

## WeChat Accounts

### GET /api/wechat-accounts

List all WeChat accounts. Token is redacted in responses.

### POST /api/wechat-accounts

Create a new account. Body: `{ "id": "personal", "name": "My WeChat" }`

### DELETE /api/wechat-accounts/:id

Delete an account and its routing rules.

### POST /api/wechat-accounts/:id/login

Start QR login flow. Returns: `{ "qrUrl": "..." }`

### POST /api/wechat-accounts/:id/connect

Start receiving messages for a logged-in account.

### POST /api/wechat-accounts/:id/disconnect

Stop receiving messages without deleting the account.

## Agents

### GET /api/agents

List all agents. Includes `runtimeStatus` (live status from the adapter).

### POST /api/agents

Create and optionally start an agent. Body:

```json
{
  "id": "claude",
  "display_name": "🤖 Claude",
  "type": "claude-code",
  "config": { "cwd": "/home/user/project", "model": "sonnet" },
  "auto_start": true
}
```

Supported `type` values: `claude-code`, `claude-sdk`, `opencode`, `openclaw`, `codex`, `codebuddy`, `cursor-agent`, `http`, `worker`.

### PUT /api/agents/:id

Update agent config. Body: `{ "display_name": "...", "config": { ... } }`

### DELETE /api/agents/:id

Delete an agent and all its sessions.

### POST /api/agents/:id/start

Start a stopped agent.

### POST /api/agents/:id/stop

Stop a running agent.

## Access Rules

### GET /api/access-rules?wechat_id=...

List access rules, optionally filtered by WeChat account.

### POST /api/access-rules

Create a rule. Body:

```json
{
  "wechat_id": "personal",
  "user_pattern": "*",
  "agent_id": "claude",
  "is_default": true
}
```

### DELETE /api/access-rules/:id

Delete a rule.

## Sessions

### GET /api/sessions?agent_id=...

List sessions, optionally filtered by agent.

### DELETE /api/sessions/:id

Clear a session (resets conversation history).

## Messages

### GET /api/messages?limit=50

List recent messages (newest last).

## Workers

### GET /api/workers

List connected worker nodes.

## Server-Sent Events

### GET /api/events

SSE stream for real-time updates. Events:

- `{ type: "init", mode, logs }` — Initial state on connection
- `{ type: "log", entry }` — New log entry (inbound/outbound/error/info)
- `{ type: "agent-update", agent }` — Agent status changed
