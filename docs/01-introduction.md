# Introduction

> **Disclaimer**: This software is provided "as is", without warranty of any kind. By using ClawCenter, you agree that you assume all legal responsibility and risks associated with its use. The authors and contributors shall not be held liable for any claims, damages, or other liability arising from the use of this software.

ClawCenter is a central router that connects your WeChat accounts to multiple AI agents. It lets you chat with AI coding assistants (Claude Code, OpenCode, etc.) directly in WeChat — using `#hashtags` to switch between different agents in the same chat window.

## The Problem

WeChat bots have a single chat entry point per account. If you want to use multiple AI agents, all messages go through one conversation — it gets messy fast. You can't tell which agent you're talking to, and there's no way to maintain separate conversations.

## How ClawCenter Solves It

- **#Hashtag routing**: Type `#claude fix the bug` to direct a message to a specific agent
- **Reply-based continuation**: Quote an agent's reply to continue that conversation — no need to re-type the hashtag
- **Sticky routing**: If you don't specify an agent, the message goes to whoever you last talked to
- **Agent reply prefix**: Every reply is prefixed with the agent name (e.g. `[🤖 Claude]`), so you always know who's talking

## Core Concepts

| Concept | Description |
|---------|-------------|
| **WeChat Account** | A WeChat bot connection via the iLink Bot API |
| **Agent** | An AI backend instance — can be a local CLI process or a remote service |
| **Session** | An independent conversation between one user and one agent |
| **Route** | The logic that decides which agent receives a message |
| **Worker** | A remote machine that runs agents and connects to the central server |

## Architecture Overview

```
WeChat Users
     │
     ▼
┌─────────────────────────────────┐
│         ClawCenter (Center)     │
│                                 │
│  WeChat ──► Router ──► Agent    │
│  Connectors   │       Manager   │
│  (multi)      │       (multi)   │
│               │                 │
│            SQLite               │
│               │                 │
│    Web UI ◄───┤───► Worker Hub  │
│    :9800      │       :9801     │
└───────────────┼─────────────────┘
                │
      ┌─────────┼─────────┐
      │                   │
   Worker A            Worker B
   (remote)            (remote)
   agents...           agents...
```

**Center mode**: Connects to WeChat, routes messages, manages local agents, accepts remote workers.

**Worker mode**: Manages local agents, connects to a center to make them available remotely.
