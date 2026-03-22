# Message Routing

When a message arrives from WeChat, ClawCenter decides which agent should handle it using a priority-based routing system.

## Routing Priority

Messages are routed in this order (first match wins):

```
1. System command (/help, /agents, etc.)
   → Handled internally, not sent to any agent

2. #Hashtag in message text
   → Route to the specified agent

3. Reply to an agent's message (quote)
   → Route to the same agent that sent the quoted message

4. Sticky routing
   → Route to the last agent this user talked to

5. Default agent
   → Route to the default agent configured for this WeChat account
```

## Hashtag Syntax

Start your message with `#agent-id` followed by a space:

```
#claude fix the bug in main.ts
#助手 帮我写一段代码
#backend check the database schema
```

The hashtag is stripped before sending to the agent — the agent only sees the message body.

Supported characters in agent IDs: letters (any language), numbers, hyphens, underscores.

## Reply-Based Continuation

When you quote (reply to) a message from an agent in WeChat, ClawCenter automatically routes your new message to the same agent, continuing the same session.

This means you can:
1. Send `#claude explain this code`
2. Get a reply `[🤖 Claude] This code does...`
3. Quote that reply and write `go deeper on step 3`
4. It automatically goes to Claude with full conversation context

**If you quote a message AND include a hashtag**, the hashtag takes priority. This lets you redirect a conversation to a different agent.

## Sticky Routing

If you send a plain message (no hashtag, no quote), it goes to whichever agent you last interacted with. This is tracked per user per WeChat account.

Use `/switch <agent>` to manually change your sticky agent without sending a message.

## Access Control

Access rules define which agents a user can reach. Configure them in **Web UI → Routing**.

Each rule has:
- **WeChat Account**: Which WeChat connection this rule applies to
- **User Pattern**: `*` for all users, or a specific WeChat user ID
- **Agent**: Which agent is accessible
- **Default**: Whether this is the fallback agent

If a user tries to reach an agent they don't have access to, they get an error listing their available agents.

## Reply Prefix

Every agent reply is prefixed with the agent's display name:

```
[🤖 Claude] Here's what I found...
[🧠 Assistant] The answer is...
```

The format is configurable in **Web UI → Settings → Reply Prefix Format**. The default is `[{displayName}]`. The `{displayName}` placeholder is replaced with the agent's display name.
