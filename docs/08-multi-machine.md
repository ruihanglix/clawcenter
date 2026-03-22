# Multi-Machine Deployment

ClawCenter supports running agents across multiple machines. A typical setup: one central server handles WeChat connections and routing, while agents run on other machines closer to the code.

## How It Works

```
Machine A (Center)              Machine B (Worker)
┌────────────────────┐          ┌────────────────────┐
│ ClawCenter         │          │ ClawCenter Worker   │
│ • WeChat ←→ iLink  │◄──WS───►│ • Agent: claude     │
│ • Router           │          │ • Agent: opencode   │
│ • Web UI :9800     │          │ • Web UI :9802      │
│ • Worker Hub :9801 │          │                     │
└────────────────────┘          └────────────────────┘
                                         ▲
                                Machine C (Worker)
                                ┌────────────────────┐
                                │ ClawCenter Worker   │
                                │ • Agent: backend    │
                                │ • Web UI :9802      │
                                └────────────────────┘
```

## Starting the Center

```bash
clawcenter start
```

The center listens for worker connections on port 9801 by default.

## Starting a Worker

On a remote machine:

```bash
clawcenter start --worker --center ws://center-ip:9801
```

Options:
- `--center <url>`: WebSocket URL of the center (required)
- `--node-id <id>`: A name for this worker (auto-generated if not set)
- `--port <port>`: Local web UI port (default: 9802)

## Configuring Worker Agents

Each worker has its own web UI (default `http://localhost:9802`). Open it to:

1. Add agents (same process as on the center)
2. Start/stop agents
3. Monitor message logs

Agents added on a worker automatically appear in the center's agent list and can be used in routing rules.

## What Happens When a Worker Disconnects

- Its agents are marked as unavailable on the center
- Messages routed to those agents will return an error
- When the worker reconnects, agents become available again
- The worker automatically reconnects with exponential backoff

## Network Requirements

- The center's worker hub port (default 9801) must be reachable from workers
- Workers initiate the connection — no inbound ports needed on worker machines
- Communication uses WebSocket (ws://) — use a reverse proxy for TLS if needed

## Worker Web UI Security

By default, the worker's web UI only listens on `127.0.0.1` (localhost). This means it's only accessible from the worker machine itself. Change the host binding in settings if you need remote access.
