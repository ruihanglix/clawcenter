# Web Management Panel

ClawCenter includes a built-in web UI for configuration and monitoring. Open it at `http://localhost:9800` (default).

## Dashboard

The home page shows an overview:

- **Stats cards**: WeChat account count, agent count, active sessions, messages today
- **WeChat Accounts**: Connection status of each account
- **Agents**: Running status of each agent
- **Recent Messages**: Live feed of incoming and outgoing messages

The dashboard refreshes automatically every 5 seconds.

## WeChat Accounts

Manage your WeChat connections:

- **Add Account**: Create a new account entry with an ID and display name
- **Login (QR)**: Scan a QR code to connect the WeChat account
- **Connect / Disconnect**: Start or stop receiving messages
- **Delete**: Remove the account and all its routing rules

## Agent Manager

Add, configure, and control your AI agents:

- **Add Agent**: Create a new agent with an ID (used as hashtag), display name, type, working directory, and model
- **Start / Stop**: Control individual agents
- **Delete**: Remove an agent and all its sessions

The agent list shows real-time status, type, working directory, and whether it's local or remote.

## Routing Configuration

Set up access rules per WeChat account:

1. Select a WeChat account from the dropdown
2. Add rules: choose an agent, set a user pattern (`*` for everyone), and optionally mark as default
3. Rules take effect immediately — no restart needed

The rules table shows all current rules with the ability to remove individual ones.

## Settings

Configure global settings:

- **Reply Prefix Format**: Template for agent reply prefixes (default: `[{displayName}]`)
- **Web UI Port**: Port for this management panel
- **Worker Hub Port**: Port for remote worker connections
- **Host bindings**: Control which network interfaces to listen on

Changes take effect on next restart for port/host settings. Reply prefix format changes apply immediately.

The settings page also shows connected **Worker Nodes** with their IDs, addresses, and connection status.
