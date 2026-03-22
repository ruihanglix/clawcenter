# 多机器部署

ClawCenter 支持在多台机器上运行 Agent。典型场景：一台中央服务器处理微信连接和路由，Agent 运行在其他更接近代码的机器上。

## 工作原理

```
机器 A（Center）                机器 B（Worker）
┌────────────────────┐          ┌────────────────────┐
│ ClawCenter         │          │ ClawCenter Worker   │
│ • 微信 ←→ iLink    │◄──WS───►│ • Agent: claude     │
│ • 路由器           │          │ • Agent: opencode   │
│ • Web :9800        │          │ • Web :9802         │
│ • Worker Hub :9801 │          │                     │
└────────────────────┘          └────────────────────┘
                                         ▲
                                机器 C（Worker）
                                ┌────────────────────┐
                                │ ClawCenter Worker   │
                                │ • Agent: backend    │
                                │ • Web :9802         │
                                └────────────────────┘
```

## 启动 Center

```bash
clawcenter start
```

Center 默认在 9801 端口监听 Worker 连接。

## 启动 Worker

在远程机器上：

```bash
clawcenter start --worker --center ws://center-ip:9801
```

参数说明：
- `--center <url>`：Center 的 WebSocket 地址（必填）
- `--node-id <id>`：Worker 名称（不填则自动生成）
- `--port <port>`：本地 Web 管理面板端口（默认 9802）

## 配置 Worker 的 Agent

每个 Worker 有自己的 Web 管理面板（默认 `http://localhost:9802`）。打开它可以：

1. 添加 Agent（和在 Center 上一样的操作）
2. 启停 Agent
3. 查看消息日志

Worker 上添加的 Agent 会自动出现在 Center 的 Agent 列表中，可直接用于路由规则。

## Worker 断开连接后会怎样

- 它的 Agent 在 Center 上标记为不可用
- 路由到这些 Agent 的消息会返回错误
- Worker 重新连接后，Agent 自动恢复可用
- Worker 会自动重连（指数退避）

## 网络要求

- Center 的 Worker Hub 端口（默认 9801）必须对 Worker 可达
- Worker 主动发起连接——Worker 机器不需要开放入站端口
- 通信使用 WebSocket（ws://）——需要 TLS 的话请用反向代理

## Worker Web 管理面板安全

默认情况下，Worker 的 Web 管理面板只监听 `127.0.0.1`（本机）。即只能从 Worker 本机访问。如需远程访问，在设置中修改 Host。
