# WeChat Setup

## Adding an Account

Each WeChat account is an independent connection to WeChat's iLink Bot API. You can add multiple accounts.

In the Web UI → **WeChat** → **Add Account**:

- **ID**: A unique key for this account (e.g. `personal`, `work`). Used internally.
- **Name**: A display name (e.g. "My WeChat", "Work Account").

## Logging In

After creating an account, click **Login (QR)**:

1. A QR code appears in the Web UI
2. Open WeChat on your phone → Scan
3. Confirm the login on your phone
4. The Web UI shows "Connected"

The login session is saved. Next time you restart ClawCenter, click **Connect** to resume without re-scanning.

## Session Expiry

WeChat sessions expire periodically. When this happens:

- ClawCenter automatically pauses polling for 1 hour to avoid hitting rate limits
- After the pause, it resumes automatically
- If it keeps failing, re-login by clicking **Login (QR)** again

## Multiple Accounts

You can connect multiple WeChat accounts simultaneously. Each one:

- Has its own login session
- Has independent routing rules
- Maintains separate message histories
- Runs its own long-polling loop

This is useful if you want one WeChat for personal use and another for team use, each with different agents available.

## Message Sync

ClawCenter uses long-polling (`getUpdates`) to receive messages. The sync position is persisted in the database, so restarting the server won't cause missed or duplicate messages.

## Disconnecting

Click **Disconnect** to stop receiving messages without deleting the account. Click **Connect** to resume.

Click **Delete** to permanently remove the account and all its routing rules.
