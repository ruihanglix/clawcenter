# System Commands

Send these commands in WeChat (starting with `/`) to manage ClawCenter without leaving the chat.

## Available Commands

### /help

Show all available commands.

### /agents

List all agents you have access to, with their status:

```
Available agents:
🟢 🤖 Claude (#claude) [default]
🟢 🧠 Assistant (#助手) ← current
⚪ 💻 Code (#code)
```

- `[default]` marks the default agent for this WeChat account.
- `← current` indicates your sticky agent (where plain messages go).

### /status

Show system-wide status:

```
📊 System status:

WeChat accounts: 1
  🟢 My WeChat

Agents: 3
  🟢 🤖 Claude (#claude)
  🟢 🧠 Assistant (#助手)
  ⚪ 💻 Code (#code)

Sessions: 5
Messages today: 42
```

### /switch \<agent\>

Change your sticky agent (where plain messages go):

```
/switch 助手
→ ✅ Switched to 🧠 Assistant (#助手)
```

Now messages without a hashtag will go to `助手` instead of your previous agent.

### /model

View or change the current agent's model. Only works with agents that support model switching.

**View current model:**

```
/model
→ 🤖 Current agent: 🤖 Claude (#claude)
  📌 Current model: sonnet

  Usage:
    /model list          List available providers
    /model list <name>   List models for a provider
    /model <model-name>  Switch model
```

**List providers:**

```
/model list
→ 🤖 Agent: 🤖 Claude (#claude)
  📌 Current model: sonnet

  Available providers:
    ★ anthropic (5 models)
      openai (3 models)

  Use /model list <provider> to see models
```

**List models for a provider:**

```
/model list anthropic
→ 📋 anthropic models:
    → sonnet ← current
      opus
      haiku

  Switch: /model anthropic/sonnet
```

**Switch model:**

```
/model opus
→ ✅ Switched 🤖 Claude (#claude) to model: opus
```

### /session

Manage sessions for the current agent. Each agent can have multiple sessions with independent conversation history.

**List sessions:**

```
/session
→ 📋 🤖 Claude session list:
    1. [Bug fix] — 12 messages, 3 minutes ago ← current
    2. [Untitled] — 5 messages, 1 hour ago

  💡 /session <number> to switch | /session new to create
```

**Create new session:**

```
/session new refactor
→ ✅ Created new session "refactor" for 🤖 Claude and switched
```

**Switch session:**

```
/session 2
→ ✅ Switched to 🤖 Claude session #2
```

**Rename current session:**

```
/session rename API work
→ ✅ Current session renamed to "API work"
```

**Delete session:**

```
/session delete 2
→ ✅ Deleted 🤖 Claude session #2
```

### /sessions

List all your sessions across all agents:

```
📋 All sessions overview:

🤖 Claude (2 sessions):
  • [Bug fix] — 12 messages, 3 minutes ago ← current
  • [Untitled] — 5 messages, 1 hour ago

🧠 Assistant (1 session):
  • [Untitled] — 3 messages, 2 hours ago ← current
```

### /clear \[agent | all\]

Clear conversation history:

```
/clear             → Clear current agent's active session
/clear claude      → Clear all sessions with #claude
/clear all         → Clear all sessions across all agents
```

This resets the session, so the agent loses previous context.

### /echo \<text\>

Echo test — the bot replies with exactly what you typed. Useful for verifying the connection is working.

```
/echo hello
→ hello
```
