# Agent 配置

Agent 是处理消息的 AI 后端。ClawCenter 支持九种类型。

## Agent 类型

### Claude Code（CLI）

启动本地 `claude` CLI 进程。需要安装 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)。

| 字段 | 说明 |
|------|------|
| Working Directory | Claude Code 运行的项目目录 |
| Model | 使用的模型（可选） |

CLI 会以 `--dangerously-skip-permissions` 运行以实现非交互式使用。

### Claude Agent SDK

通过 `@anthropic-ai/claude-agent-sdk` 直接调用 Anthropic API。不需要安装 CLI，但需要设置 `ANTHROPIC_AUTH_TOKEN` 环境变量。

| 字段 | 说明 |
|------|------|
| Working Directory | 项目目录上下文 |
| Model | 模型名称（默认：`sonnet`） |

### OpenCode（CLI）

启动本地 `opencode` CLI 进程。需要安装 [OpenCode](https://github.com/opencode-ai/opencode)。

| 字段 | 说明 |
|------|------|
| Working Directory | OpenCode 运行的项目目录 |
| Model | 使用的模型（通过 `OPENCODE_MODEL` 环境变量设置） |

### OpenClaw（CLI）

启动本地 `openclaw` CLI 进程。需要安装 [OpenClaw](https://github.com/openclaw/openclaw)。

| 字段 | 说明 |
|------|------|
| Working Directory | OpenClaw 运行的项目目录 |
| Model | 使用的模型（可选） |

### Codex（CLI）

启动本地 `codex` CLI 进程。需要安装 [OpenAI Codex CLI](https://github.com/openai/codex)。

| 字段 | 说明 |
|------|------|
| Working Directory | Codex 运行的项目目录 |
| Model | 使用的模型（可选） |
| Permission Mode | 权限级别（可选） |

### CodeBuddy（CLI）

启动本地 `codebuddy` CLI 进程。需要安装[腾讯 CodeBuddy CLI](https://github.com/nicepkg/codebuddy)。

| 字段 | 说明 |
|------|------|
| Working Directory | CodeBuddy 运行的项目目录 |
| Model | 使用的模型（可选） |
| Permission Mode | 权限级别（可选） |

### Cursor Agent（CLI）

启动本地 `cursor` CLI Agent 进程。需要安装 [Cursor CLI](https://docs.cursor.com/cli)。

| 字段 | 说明 |
|------|------|
| Working Directory | Cursor Agent 运行的项目目录 |
| Model | 使用的模型（可选） |
| Permission Mode | 权限级别（可选） |

### Custom HTTP

向任意 HTTP 端点发送消息。用来接入你自己的 AI 服务。

| 字段 | 说明 |
|------|------|
| URL | HTTP 端点（如 `http://localhost:3000/chat`） |
| Headers | 自定义请求头（可选） |

端点应接受 POST `{ message, session_id }`，返回 `{ text }`。

### Remote Worker

运行在远程机器上、通过 WebSocket 连接的 Agent。详见[多机器部署](08-multi-machine.md)。Worker 连接时这些 Agent 会自动注册——无需手动创建。

## 同类型多实例

可以创建多个相同类型但不同工作目录的 Agent。这是管理多个项目的推荐方式：

| ID | 类型 | 工作目录 |
|----|------|---------|
| `frontend` | Claude Code | `/home/user/frontend` |
| `backend` | Claude Code | `/home/user/backend` |
| `infra` | Claude Code | `/home/user/infra` |

每个 Agent 有独立的进程、会话和对话历史。

## 启动和停止

- 可以在 Web 管理面板中单独启停每个 Agent
- ClawCenter 启动时会自动恢复之前运行中的 Agent
- 已停止的 Agent 不参与路由——发给已停止 Agent 的消息会返回错误

## Agent 显示名称

显示名称出现在回复前缀中（如 `[🤖 Claude]`）。使用 emoji 和简短名称，方便在微信中识别不同 Agent。
