# Architecture

This document covers the internal design of ClawCenter for developers who want to understand or extend the codebase.

## Code Structure

```
src/
├── index.ts              CLI entry point (commander)
├── server.ts             Main server startup (center/worker modes)
│
├── core/                 Shared between Center and Worker
│   ├── db/               SQLite schema and data access
│   ├── agents/           Agent adapter interface and implementations
│   └── api/              REST API route handlers
│
├── center/               Center-mode only
│   ├── wechat/           iLink Bot API, login, CDN, connector
│   ├── router/           Hashtag parsing, routing engine
│   ├── commands/         System command handlers
│   ├── dispatcher.ts     Message dispatch orchestrator
│   └── hub.ts            WebSocket server for workers
│
├── worker/
│   └── client.ts         WebSocket client to connect to center
│
└── tui/                  Terminal UI (ink + React)
```

## Data Flow

### Inbound Message

```
WeChat User sends message
  → iLink API (long-poll getUpdates)
  → WechatConnector.pollLoop()
  → Dispatcher.handleMessage()
  → isSystemCommand? → handle and reply
  → Router.route()
    → parseHashtag()
    → check reply reference → messages table lookup
    → sticky route → sticky_routes table
    → default agent → access_rules table
    → permission check
  → AgentManager.sendToAgent()
  → AgentAdapter.send()
    → Claude CLI / SDK / OpenCode / OpenClaw / Codex / CodeBuddy / Cursor / HTTP / Worker
  → Format reply with prefix
  → WechatConnector.sendText()
  → iLink API sendMessage
```

### Worker Task Flow

```
Center receives message routed to worker agent
  → WorkerAgentAdapter.send()
  → WorkerHub → WebSocket → Worker
  → WorkerClient.handleMessage(task)
  → Local AgentManager.sendToAgent()
  → AgentAdapter.send() (local CLI/SDK)
  → Result back via WebSocket
  → Center continues with reply
```

## Database Schema

| Table | Purpose |
|-------|---------|
| `wechat_accounts` | WeChat login credentials, connection state, sync position |
| `agents` | Agent definitions: type, config, status, which node |
| `access_rules` | (WeChat account, user pattern) → allowed agents |
| `sessions` | (WeChat account, user, agent) → conversation state |
| `messages` | All inbound/outbound messages for reply tracking |
| `sticky_routes` | Last-used agent per user per WeChat account |
| `settings` | Key-value configuration store |
| `worker_nodes` | Connected worker nodes |

## Adding a New Agent Type

1. Create a new class implementing `AgentAdapter` in `src/core/agents/`
2. Add the type string to the `AgentType` union in `adapter.ts`
3. Add a case in `AgentManager.createAdapter()`
4. Add the type option in the Web UI's agent creation form

The `AgentAdapter` interface:

```typescript
interface AgentAdapter {
  readonly id: string;
  readonly type: AgentType;
  readonly displayName: string;
  status: "running" | "stopped" | "error";

  start(config: AgentConfig): Promise<void>;
  stop(): Promise<void>;
  send(params: SendParams): Promise<SendResult>;
}
```

## WebSocket Protocol (Center ↔ Worker)

| Direction | Message Type | Purpose |
|-----------|-------------|---------|
| W → C | `register` | Worker announces itself with a node ID |
| W → C | `sync` | Full list of worker's agents |
| W → C | `agent-added/updated/removed` | Incremental agent changes |
| C → W | `task` | Send a user message to a worker agent |
| W → C | `stream` | Streaming response chunk |
| W → C | `result` | Final response |
| W → C | `task-error` | Task failed |
