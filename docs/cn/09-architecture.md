# 架构设计

本文介绍 ClawCenter 的内部设计，面向需要理解或扩展代码库的开发者。

## 代码结构

```
src/
├── index.ts              CLI 入口（commander）
├── server.ts             主服务启动（center/worker 模式）
│
├── core/                 Center 和 Worker 共用
│   ├── db/               SQLite schema 和数据访问
│   ├── agents/           Agent 适配器接口和实现
│   └── api/              REST API 路由
│
├── center/               仅 Center 模式
│   ├── wechat/           iLink Bot API、登录、CDN、连接器
│   ├── router/           话题标签解析、路由引擎
│   ├── commands/         系统命令处理器
│   ├── dispatcher.ts     消息调度编排器
│   └── hub.ts            WebSocket 服务端（接受 Worker）
│
├── worker/
│   └── client.ts         WebSocket 客户端（连接 Center）
│
└── tui/                  终端 UI（ink + React）
```

## 数据流

### 入站消息

```
微信用户发送消息
  → iLink API（长轮询 getUpdates）
  → WechatConnector.pollLoop()
  → Dispatcher.handleMessage()
  → 是系统命令？→ 处理并回复
  → Router.route()
    → parseHashtag()
    → 检查引用回复 → messages 表查找
    → 粘性路由 → sticky_routes 表
    → 默认 Agent → access_rules 表
    → 权限检查
  → AgentManager.sendToAgent()
  → AgentAdapter.send()
    → Claude CLI / SDK / OpenCode / OpenClaw / Codex / CodeBuddy / Cursor / HTTP / Worker
  → 格式化回复，添加前缀
  → WechatConnector.sendText()
  → iLink API sendMessage
```

### Worker 任务流

```
Center 收到路由到 Worker Agent 的消息
  → WorkerAgentAdapter.send()
  → WorkerHub → WebSocket → Worker
  → WorkerClient.handleMessage(task)
  → 本地 AgentManager.sendToAgent()
  → AgentAdapter.send()（本地 CLI/SDK）
  → 结果通过 WebSocket 返回
  → Center 继续处理回复
```

## 数据库 Schema

| 表 | 用途 |
|----|------|
| `wechat_accounts` | 微信登录凭证、连接状态、同步位置 |
| `agents` | Agent 定义：类型、配置、状态、所在节点 |
| `access_rules` | （微信账号, 用户匹配）→ 可用 Agent |
| `sessions` | （微信账号, 用户, Agent）→ 对话状态 |
| `messages` | 所有收发消息，用于引用回复追踪 |
| `sticky_routes` | 每个用户每个微信账号上次使用的 Agent |
| `settings` | 键值配置存储 |
| `worker_nodes` | 已连接的 Worker 节点 |

## 添加新 Agent 类型

1. 在 `src/core/agents/` 中创建实现 `AgentAdapter` 接口的新类
2. 在 `adapter.ts` 的 `AgentType` 联合类型中添加新类型字符串
3. 在 `AgentManager.createAdapter()` 中添加对应的 case
4. 在 Web 管理面板的 Agent 创建表单中添加该类型选项

`AgentAdapter` 接口：

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

## WebSocket 协议（Center ↔ Worker）

| 方向 | 消息类型 | 用途 |
|------|---------|------|
| W → C | `register` | Worker 用 node ID 宣告自己 |
| W → C | `sync` | Worker 所有 Agent 的完整列表 |
| W → C | `agent-added/updated/removed` | Agent 增量变更 |
| C → W | `task` | 发送用户消息到 Worker Agent |
| W → C | `stream` | 流式响应分片 |
| W → C | `result` | 最终响应 |
| W → C | `task-error` | 任务失败 |
