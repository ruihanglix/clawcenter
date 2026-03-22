import { EventEmitter } from "node:events";
import type { Store } from "../core/db/store.js";
import type { AgentManager } from "../core/agents/manager.js";
import { Router, PermissionError } from "./router/engine.js";
import { isSystemCommand, handleSystemCommand } from "./commands/system-commands.js";
import { WechatConnector, type InboundMessage } from "./wechat/connector.js";

export interface DispatcherEvents {
  log: (entry: LogEntry) => void;
}

export interface LogEntry {
  time: number;
  type: "inbound" | "outbound" | "system" | "error" | "info" | "thinking";
  wechatId: string;
  userId?: string;
  agentId?: string;
  text: string;
}

export class Dispatcher extends EventEmitter {
  private store: Store;
  private agentManager: AgentManager;
  private router: Router;
  private connectors = new Map<string, WechatConnector>();

  constructor(store: Store, agentManager: AgentManager) {
    super();
    this.store = store;
    this.agentManager = agentManager;

    const prefixFormat = store.getSetting("reply_prefix_format") ?? "[{displayName}]";
    this.router = new Router({ store, agentManager, replyPrefixFormat: prefixFormat });
  }

  getConnector(wechatId: string): WechatConnector | undefined {
    return this.connectors.get(wechatId);
  }

  listConnectors(): WechatConnector[] {
    return Array.from(this.connectors.values());
  }

  async startConnector(wechatId: string): Promise<void> {
    if (this.connectors.has(wechatId)) {
      throw new Error(`Connector for "${wechatId}" already running`);
    }

    const connector = new WechatConnector(this.store, wechatId);
    this.connectors.set(wechatId, connector);

    connector.on("message", (msg: InboundMessage) => {
      this.handleMessage(connector, msg).catch((err) => {
        console.error(`[Dispatcher] Message handling error:`, err);
        this.emitLog({
          type: "error",
          wechatId: msg.wechatAccountId,
          userId: msg.fromUserId,
          text: `Error: ${(err as Error).message}`,
        });
      });
    });

    connector.on("error", (err: Error) => {
      this.emitLog({ type: "error", wechatId, text: `Connector error: ${err.message}` });
    });

    connector.on("session_expired", () => {
      this.emitLog({ type: "error", wechatId, text: "Session expired, paused for 1 hour" });
    });

    await connector.start();
    this.emitLog({ type: "info", wechatId, text: "Connector started" });
  }

  async stopConnector(wechatId: string): Promise<void> {
    const connector = this.connectors.get(wechatId);
    if (!connector) return;
    connector.stop();
    this.connectors.delete(wechatId);
    this.emitLog({ type: "info", wechatId, text: "Connector stopped" });
  }

  async stopAll(): Promise<void> {
    for (const [id, connector] of this.connectors) {
      connector.stop();
      this.emitLog({ type: "info", wechatId: id, text: "Connector stopped" });
    }
    this.connectors.clear();
  }

  /** Start all connected WeChat accounts */
  async startAllConnectors(): Promise<void> {
    const accounts = this.store.listWechatAccounts();
    for (const account of accounts) {
      if (account.token) {
        try {
          await this.startConnector(account.id);
        } catch (err) {
          console.error(`[Dispatcher] Failed to start connector ${account.id}:`, (err as Error).message);
        }
      }
    }
  }

  private async handleMessage(connector: WechatConnector, msg: InboundMessage): Promise<void> {
    this.emitLog({
      type: "inbound",
      wechatId: msg.wechatAccountId,
      userId: msg.fromUserId,
      text: msg.text,
    });

    // Record inbound message
    this.store.recordMessage({
      wechat_msg_id: msg.messageId,
      session_id: "", // Will be updated if routed
      agent_id: "",
      wechat_id: msg.wechatAccountId,
      user_id: msg.fromUserId,
      direction: "inbound",
      content: msg.text,
    });

    // System commands
    if (isSystemCommand(msg.text)) {
      const result = await handleSystemCommand({
        wechatAccountId: msg.wechatAccountId,
        fromUserId: msg.fromUserId,
        text: msg.text,
        store: this.store,
        agentManager: this.agentManager,
      });

      this.emitLog({
        type: "system",
        wechatId: msg.wechatAccountId,
        userId: msg.fromUserId,
        text: result.reply,
      });

      await connector.sendText(msg.fromUserId, result.reply);
      return;
    }

    // Snapshot sticky agent before routing (route() updates it)
    const previousStickyAgent = this.store.getStickyRoute(msg.wechatAccountId, msg.fromUserId);

    // Route to agent
    let route;
    try {
      route = await this.router.route(msg);
    } catch (err) {
      if (err instanceof PermissionError) {
        const allowedStr = err.allowedAgents.length > 0
          ? `可用: ${err.allowedAgents.map((a) => `#${a}`).join(", ")}`
          : "暂无已配置的 Agent。";
        const reply = `⚠️ 无权访问 #${err.agentId}。${allowedStr}`;
        await connector.sendText(msg.fromUserId, reply);
        return;
      }
      throw err;
    }

    if (!route) {
      // No agent resolved and not a system command
      const defaultAgent = this.store.getDefaultAgent(msg.wechatAccountId, msg.fromUserId);
      if (!defaultAgent) {
        await connector.sendText(
          msg.fromUserId,
          "⚠️ 未配置 Agent。使用 /agents 查看可用 Agent，或联系管理员配置路由。",
        );
      }
      return;
    }

    const agentSwitchedViaReply = route.routedVia === "reply"
      && previousStickyAgent != null
      && previousStickyAgent !== route.agentId;

    // Update inbound message record with proper session/agent info
    this.store.recordMessage({
      wechat_msg_id: msg.messageId,
      session_id: route.sessionId,
      agent_id: route.agentId,
      wechat_id: msg.wechatAccountId,
      user_id: msg.fromUserId,
      direction: "inbound",
      content: msg.text,
    });

    // Auto-label session from first message
    this.store.setSessionLabelIfEmpty(route.sessionId, route.body.slice(0, 20));

    this.emitLog({
      type: "thinking",
      wechatId: msg.wechatAccountId,
      userId: msg.fromUserId,
      agentId: route.agentId,
      text: `[${route.displayName}] Thinking...`,
    });

    // Send typing indicator
    await connector.sendTypingIndicator(msg.fromUserId, true);

    try {
      // Send to agent
      const result = await this.agentManager.sendToAgent(route.agentId, {
        sessionId: route.sessionId,
        agentSessionId: route.agentSessionId,
        message: route.body,
        onStream: (chunk) => {
          this.emitLog({
            type: "outbound",
            wechatId: msg.wechatAccountId,
            userId: msg.fromUserId,
            agentId: route!.agentId,
            text: chunk,
          });
        },
      });

      // Update session
      if (result.agentSessionId) {
        this.store.updateSessionAgentSession(route.sessionId, result.agentSessionId);
      }
      this.store.incrementSessionMessages(route.sessionId);

      // Stop typing
      await connector.sendTypingIndicator(msg.fromUserId, false);

      // Format and send reply
      const formattedReply = this.router.formatReply(route.displayName, result.text);

      // Chunk long messages (WeChat limit ~4000 chars)
      const chunks = chunkText(formattedReply, 4000);
      for (const chunk of chunks) {
        const { clientId, serverMsgId } = await connector.sendText(msg.fromUserId, chunk);

        // Record outbound for reply tracking (store both client_id and server-assigned wechat_msg_id)
        this.store.recordMessage({
          wechat_msg_id: serverMsgId,
          client_id: clientId,
          session_id: route.sessionId,
          agent_id: route.agentId,
          wechat_id: msg.wechatAccountId,
          user_id: msg.fromUserId,
          direction: "outbound",
          content: chunk,
        });
      }

      // Handle media in response
      if (result.mediaUrls) {
        for (const mediaUrl of result.mediaUrls) {
          try {
            if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
              const { downloadRemoteToTemp } = await import("./wechat/cdn.js");
              const tempPath = await downloadRemoteToTemp(mediaUrl);
              await connector.sendMediaFile(msg.fromUserId, tempPath);
            } else {
              await connector.sendMediaFile(msg.fromUserId, mediaUrl);
            }
          } catch (mediaErr) {
            console.error(`[Dispatcher] Failed to send media:`, mediaErr);
          }
        }
      }

      // Notify user when agent switched via reply-based routing
      if (agentSwitchedViaReply) {
        const hint = `💡 当前对话已切换至 ${route.displayName}`;
        await connector.sendText(msg.fromUserId, hint);
      }

      this.emitLog({
        type: "outbound",
        wechatId: msg.wechatAccountId,
        userId: msg.fromUserId,
        agentId: route.agentId,
        text: result.text.slice(0, 200) + (result.text.length > 200 ? "..." : ""),
      });
    } catch (err) {
      await connector.sendTypingIndicator(msg.fromUserId, false);
      const errorMsg = `⚠️ ${route.displayName} 出错: ${(err as Error).message}`;
      await connector.sendText(msg.fromUserId, errorMsg);
      this.emitLog({
        type: "error",
        wechatId: msg.wechatAccountId,
        userId: msg.fromUserId,
        agentId: route.agentId,
        text: (err as Error).message,
      });
    }
  }

  private emitLog(entry: Omit<LogEntry, "time">): void {
    this.emit("log", { ...entry, time: Date.now() } as LogEntry);
  }
}

function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen / 2) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}
