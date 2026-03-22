# Agent Configuration

Agents are the AI backends that process your messages. ClawCenter supports nine types.

## Agent Types

### Claude Code (CLI)

Spawns a local `claude` CLI process. Requires the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed.

| Field | Description |
|-------|-------------|
| Working Directory | The project folder where Claude Code runs |
| Model | Model to use (optional) |

The CLI runs with `--dangerously-skip-permissions` for non-interactive use.

### Claude Agent SDK

Calls the Anthropic API directly via `@anthropic-ai/claude-agent-sdk`. No CLI installation needed, but requires an `ANTHROPIC_AUTH_TOKEN` environment variable.

| Field | Description |
|-------|-------------|
| Working Directory | The project folder context |
| Model | Model name (default: `sonnet`) |

### OpenCode (CLI)

Spawns a local `opencode` CLI process. Requires [OpenCode](https://github.com/opencode-ai/opencode) installed.

| Field | Description |
|-------|-------------|
| Working Directory | The project folder where OpenCode runs |
| Model | Model to use (set via `OPENCODE_MODEL` env var) |

### OpenClaw (CLI)

Spawns a local `openclaw` CLI process. Requires [OpenClaw](https://github.com/openclaw/openclaw) installed.

| Field | Description |
|-------|-------------|
| Working Directory | The project folder where OpenClaw runs |
| Model | Model to use (optional) |

### Codex (CLI)

Spawns a local `codex` CLI process. Requires [OpenAI Codex CLI](https://github.com/openai/codex) installed.

| Field | Description |
|-------|-------------|
| Working Directory | The project folder where Codex runs |
| Model | Model to use (optional) |
| Permission Mode | Permission level (optional) |

### CodeBuddy (CLI)

Spawns a local `codebuddy` CLI process. Requires [Tencent CodeBuddy CLI](https://github.com/nicepkg/codebuddy) installed.

| Field | Description |
|-------|-------------|
| Working Directory | The project folder where CodeBuddy runs |
| Model | Model to use (optional) |
| Permission Mode | Permission level (optional) |

### Cursor Agent (CLI)

Spawns a local `cursor` CLI agent process. Requires the [Cursor CLI](https://docs.cursor.com/cli) installed.

| Field | Description |
|-------|-------------|
| Working Directory | The project folder where Cursor Agent runs |
| Model | Model to use (optional) |
| Permission Mode | Permission level (optional) |

### Custom HTTP

Sends messages to any HTTP endpoint. Use this to integrate your own AI services.

| Field | Description |
|-------|-------------|
| URL | The HTTP endpoint (e.g. `http://localhost:3000/chat`) |
| Headers | Custom headers (optional) |

The endpoint should accept POST with `{ message, session_id }` and return `{ text }`.

### Remote Worker

Agents running on remote machines connected via WebSocket. See [Multi-Machine Deployment](08-multi-machine.md). These agents are registered automatically when a Worker connects — you don't create them manually.

## Multiple Agents of the Same Type

You can create multiple agents of the same type with different working directories. This is the recommended way to work with multiple projects:

| ID | Type | Working Directory |
|----|------|------------------|
| `frontend` | Claude Code | `/home/user/frontend` |
| `backend` | Claude Code | `/home/user/backend` |
| `infra` | Claude Code | `/home/user/infra` |

Each agent has its own process, sessions, and conversation history.

## Starting and Stopping

- Agents can be started/stopped individually from the Web UI
- When ClawCenter starts, it automatically starts all previously running agents
- Stopped agents are not available for routing — messages to a stopped agent return an error

## Agent Display Name

The display name appears in reply prefixes (e.g. `[🤖 Claude]`). Use emoji and short names to make it easy to identify agents in WeChat.
