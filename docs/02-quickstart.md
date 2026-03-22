# Quick Start

Get ClawCenter running in 5 minutes.

## Prerequisites

- Node.js 22 or later
- At least one AI agent CLI installed (e.g. `claude` for Claude Code)
- A WeChat account

## Install

```bash
npm install -g clawcenter
```

## Step 1: Start the Server

```bash
clawcenter start
```

You'll see:

```
🐾 ClawCenter started
   Web UI: http://localhost:9800
   Worker hub: ws://0.0.0.0:9801
```

Open `http://localhost:9800` in your browser.

## Step 2: Add a WeChat Account

1. Go to **WeChat** in the sidebar
2. Click **Add Account**
3. Enter an ID (e.g. `personal`) and a name (e.g. `My WeChat`)
4. Click **Create**, then click **Login (QR)**
5. Scan the QR code with WeChat
6. Confirm on your phone
7. Click **Connect** to start receiving messages

## Step 3: Add an Agent

1. Go to **Agents** in the sidebar
2. Click **Add Agent**
3. Fill in:
   - **ID**: `claude` (this becomes the `#claude` hashtag)
   - **Display Name**: `🤖 Claude`
   - **Type**: Claude Code
   - **Working Directory**: your project path (e.g. `/home/user/myproject`)
4. Click **Create & Start**

## Step 4: Set Up Routing

1. Go to **Routing** in the sidebar
2. Select your WeChat account
3. Click **Add** with:
   - **Agent**: select `claude`
   - **User Pattern**: `*` (all users)
   - Check **Default Agent**

## Step 5: Try It Out

Send a message in WeChat to your bot:

```
#claude Hello! What can you do?
```

The bot will reply:

```
[🤖 Claude] Hi! I can help you with coding tasks...
```

Try replying to that message (quote it) with a follow-up question — it automatically continues the conversation with the same agent.

## What's Next

- [Add more agents](04-agents.md) with different working directories
- [Configure routing rules](05-routing.md) for multiple users
- [Set up multi-machine deployment](08-multi-machine.md) for remote agents
- [Learn the system commands](06-commands.md) available in WeChat
