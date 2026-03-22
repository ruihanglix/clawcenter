import type { Store } from "../../core/db/store.js";
import type { AgentManager } from "../../core/agents/manager.js";
import type { InboundMessage } from "../wechat/connector.js";
import { parseHashtag } from "./hashtag.js";
import { handleSystemCommand, isSystemCommand } from "../commands/system-commands.js";
import { debug } from "../../logger.js";

export type RoutedVia = "hashtag" | "reply" | "sticky" | "default";

export interface RouteResult {
  agentId: string;
  displayName: string;
  body: string;
  sessionId: string;
  agentSessionId?: string;
  routedVia: RoutedVia;
}

export interface RouterDeps {
  store: Store;
  agentManager: AgentManager;
  replyPrefixFormat: string;
}

export class Router {
  private store: Store;
  private agentManager: AgentManager;

  constructor(private deps: RouterDeps) {
    this.store = deps.store;
    this.agentManager = deps.agentManager;
  }

  /**
   * Route an inbound message to the appropriate agent.
   * Returns null if the message was handled as a system command.
   */
  async route(msg: InboundMessage): Promise<RouteResult | null> {
    const { wechatAccountId, fromUserId, text } = msg;

    // 1. System command?
    if (isSystemCommand(text)) {
      return null; // Handled separately by the dispatcher
    }

    // 2. Parse #hashtag
    const hashtagResult = parseHashtag(text);
    let agentId: string | null = hashtagResult?.agentId ?? null;
    let body = hashtagResult?.body ?? text;
    let routedVia: RoutedVia = "hashtag";

    // 3. Reply-based routing (if no hashtag)
    if (!agentId && (msg.refMessageId || msg.refMessageText)) {
      debug("Router", `Reply-based routing: refMessageId=${msg.refMessageId ?? "none"}, refText=${msg.refMessageText?.slice(0, 60) ?? "none"}`);

      let refMsg = null;

      // Try exact ID match first
      if (msg.refMessageId) {
        refMsg = this.store.findMessageByWechatMsgId(msg.refMessageId)
          ?? this.store.findMessageByClientId(msg.refMessageId);
        debug("Router", `  ID lookup: ${refMsg ? `found agent=${refMsg.agent_id}` : "not found"}`);
      }

      // Fallback: match by content prefix (for outbound messages whose server ID we don't have)
      if (!refMsg && msg.refMessageText) {
        refMsg = this.store.findOutboundMessageByContent(
          msg.wechatAccountId, msg.fromUserId, msg.refMessageText.slice(0, 100),
        );
        debug("Router", `  Content fallback: ${refMsg ? `found agent=${refMsg.agent_id}` : "not found"}`);
      }

      if (refMsg) {
        agentId = refMsg.agent_id;
        body = text;
        routedVia = "reply";
      }
    }

    // 4. Sticky routing
    if (!agentId) {
      agentId = this.store.getStickyRoute(wechatAccountId, fromUserId);
      routedVia = "sticky";
    }

    // 5. Default agent
    if (!agentId) {
      agentId = this.store.getDefaultAgent(wechatAccountId, fromUserId);
      routedVia = "default";
    }

    // 6. No agent found at all
    if (!agentId) {
      return null;
    }

    // 7. Permission check
    const allowed = this.store.isAgentAllowed(wechatAccountId, fromUserId, agentId);
    if (!allowed) {
      const allowedAgents = this.store.getAllowedAgents(wechatAccountId, fromUserId);
      throw new PermissionError(agentId, allowedAgents);
    }

    // 8. Check agent exists and is running
    const agentData = this.store.getAgent(agentId);
    if (!agentData) {
      throw new Error(`Agent "${agentId}" not found`);
    }
    const adapter = this.agentManager.getAdapter(agentId);
    if (!adapter || adapter.status !== "running") {
      throw new Error(`Agent "${agentId}" is not running`);
    }

    // 9. Get/create session
    const session = this.store.getOrCreateSession(wechatAccountId, fromUserId, agentId);

    // 10. Update sticky route
    this.store.setStickyRoute(wechatAccountId, fromUserId, agentId);

    return {
      agentId,
      displayName: agentData.display_name,
      body,
      sessionId: session.id,
      agentSessionId: session.agent_session ?? undefined,
      routedVia,
    };
  }

  formatReply(displayName: string, text: string): string {
    const prefix = this.deps.replyPrefixFormat.replace("{displayName}", displayName);
    return `${prefix} ${text}`;
  }
}

export class PermissionError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly allowedAgents: string[],
  ) {
    super(`No permission to access agent "${agentId}"`);
    this.name = "PermissionError";
  }
}
