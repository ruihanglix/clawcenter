import type { Store } from "../../core/db/store.js";
import type { AgentManager } from "../../core/agents/manager.js";

export interface CommandContext {
  wechatAccountId: string;
  fromUserId: string;
  text: string;
  store: Store;
  agentManager: AgentManager;
}

export interface CommandResult {
  reply: string;
}

export function isSystemCommand(text: string): boolean {
  return text.trim().startsWith("/");
}

export async function handleSystemCommand(ctx: CommandContext): Promise<CommandResult> {
  const trimmed = ctx.text.trim();
  const spaceIdx = trimmed.indexOf(" ");
  const command = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

  switch (command) {
    case "/help":
      return handleHelp();
    case "/agents":
      return handleAgents(ctx);
    case "/status":
      return handleStatus(ctx);
    case "/switch":
      return handleSwitch(ctx, args);
    case "/model":
      return handleModel(ctx, args);
    case "/clear":
      return handleClear(ctx, args);
    case "/echo":
      return handleEcho(args);
    case "/session":
      return handleSession(ctx, args);
    case "/sessions":
      return handleSessions(ctx);
    default:
      return { reply: `未知命令: ${command}\n输入 /help 查看可用命令。` };
  }
}

function handleHelp(): CommandResult {
  return {
    reply: [
      "📋 可用命令:",
      "",
      "/help              显示此帮助",
      "/agents            列出可用 Agent",
      "/status            查看系统状态",
      "/switch <名称>     切换默认 Agent",
      "/model             查看/切换模型",
      "/session           管理当前 Agent 的会话",
      "/session new [名称] 新建会话",
      "/session <编号>     切换到指定会话",
      "/session rename <名称> 重命名当前会话",
      "/session delete <编号> 删除会话",
      "/sessions          查看所有会话(全局)",
      "/clear             清空当前会话上下文",
      "/echo <文本>       回显测试",
      "",
      "使用 #agent-name 可将消息发送给指定 Agent。",
      "引用回复某条 Agent 消息可继续与该 Agent 对话。",
    ].join("\n"),
  };
}

function handleAgents(ctx: CommandContext): CommandResult {
  const allowed = ctx.store.getAllowedAgents(ctx.wechatAccountId, ctx.fromUserId);
  const defaultAgent = ctx.store.getDefaultAgent(ctx.wechatAccountId, ctx.fromUserId);
  const sticky = ctx.store.getStickyRoute(ctx.wechatAccountId, ctx.fromUserId);

  if (allowed.length === 0) {
    return { reply: "暂无可用 Agent，请联系管理员配置权限。" };
  }

  const lines = ["可用 Agent:"];
  for (const agentId of allowed) {
    const agent = ctx.store.getAgent(agentId);
    if (!agent) continue;
    const adapter = ctx.agentManager.getAdapter(agentId);
    const status = adapter?.status === "running" ? "🟢" : "⚪";
    const isDefault = agentId === defaultAgent ? " [默认]" : "";
    const isCurrent = agentId === sticky ? " ← 当前" : "";
    lines.push(`${status} ${agent.display_name} (#${agentId})${isDefault}${isCurrent}`);
  }

  return { reply: lines.join("\n") };
}

function handleStatus(ctx: CommandContext): CommandResult {
  const stats = ctx.store.getStats();
  const accounts = ctx.store.listWechatAccounts();
  const agents = ctx.store.listAgents();

  const lines = [
    "📊 系统状态:",
    "",
    `微信账号: ${accounts.length}`,
  ];

  for (const acc of accounts) {
    lines.push(`  ${acc.status === "connected" ? "🟢" : "🔴"} ${acc.name}`);
  }

  lines.push("", `Agent: ${agents.length}`);
  for (const agent of agents) {
    const adapter = ctx.agentManager.getAdapter(agent.id);
    const status = adapter?.status === "running" ? "🟢" : adapter?.status === "error" ? "🔴" : "⚪";
    const node = agent.node_id !== "local" ? ` (${agent.node_id})` : "";
    lines.push(`  ${status} ${agent.display_name} (#${agent.id})${node}`);
  }

  lines.push(
    "",
    `会话数: ${stats.sessions}`,
    `今日消息: ${stats.messages_today}`,
  );

  return { reply: lines.join("\n") };
}

function handleSwitch(ctx: CommandContext, args: string): CommandResult {
  const agentId = args.trim().replace(/^#/, "");
  if (!agentId) {
    return { reply: "用法: /switch <agent-name>\n示例: /switch claude" };
  }

  const agent = ctx.store.getAgent(agentId);
  if (!agent) {
    return { reply: `Agent "${agentId}" 未找到。` };
  }

  const allowed = ctx.store.isAgentAllowed(ctx.wechatAccountId, ctx.fromUserId, agentId);
  if (!allowed) {
    return { reply: `你没有权限访问 Agent "${agentId}"。` };
  }

  ctx.store.setStickyRoute(ctx.wechatAccountId, ctx.fromUserId, agentId);
  return { reply: `✅ 已切换到 ${agent.display_name} (#${agentId})` };
}

async function handleModel(ctx: CommandContext, args: string): Promise<CommandResult> {
  const sticky = ctx.store.getStickyRoute(ctx.wechatAccountId, ctx.fromUserId);
  const defaultAgent = ctx.store.getDefaultAgent(ctx.wechatAccountId, ctx.fromUserId);
  const agentId = sticky || defaultAgent;

  if (!agentId) {
    return { reply: "请先使用 /switch <agent> 选择一个 Agent。" };
  }

  const adapter = ctx.agentManager.getAdapter(agentId);
  if (!adapter) {
    return { reply: `Agent "${agentId}" 未找到。` };
  }

  if (!adapter.supportsModelSwitch) {
    return { reply: `当前 Agent #${agentId} (${adapter.type}) 不支持切换模型。` };
  }

  const trimmedArgs = args.trim();

  if (!trimmedArgs) {
    const currentModel = adapter.getModel() ?? "(默认)";
    return {
      reply: [
        `🤖 当前 Agent: ${adapter.displayName} (#${agentId})`,
        `📌 当前模型: ${currentModel}`,
        "",
        "用法:",
        "  /model list          查看可用 Provider",
        "  /model list <name>   查看某 Provider 的模型",
        "  /model <model-name>  切换模型",
      ].join("\n"),
    };
  }

  if (trimmedArgs === "list" || trimmedArgs.startsWith("list ")) {
    const provider = trimmedArgs.slice(4).trim() || undefined;

    try {
      const models = await adapter.listModels(provider);
      if (models.length === 0) {
        return { reply: provider ? `Provider "${provider}" 没有可用模型。` : "未获取到可用模型列表。" };
      }

      const currentModel = adapter.getModel();

      if (provider) {
        const lines = [`📋 ${provider} 可用模型:`];
        for (const m of models) {
          const shortName = m.id.includes("/") ? m.id.substring(m.id.indexOf("/") + 1) : m.id;
          const marker = m.id === currentModel ? " ← 当前" : "";
          lines.push(`  ${m.id === currentModel ? "→" : " "} ${shortName}${marker}`);
        }
        lines.push("", `切换: /model ${models[0].id}`);
        return { reply: lines.join("\n") };
      }

      const grouped = new Map<string, typeof models>();
      for (const m of models) {
        const list = grouped.get(m.provider) ?? [];
        list.push(m);
        grouped.set(m.provider, list);
      }

      const lines = [
        `🤖 Agent: ${adapter.displayName} (#${agentId})`,
        `📌 当前模型: ${currentModel ?? "(默认)"}`,
        "",
        "可用 Provider:",
      ];
      for (const [prov, provModels] of grouped) {
        const hasCurrent = provModels.some((m) => m.id === currentModel);
        lines.push(`  ${hasCurrent ? "★" : " "} ${prov} (${provModels.length} models)`);
      }
      lines.push("", "使用 /model list <provider> 查看具体模型");

      return { reply: lines.join("\n") };
    } catch (err) {
      return { reply: `获取模型列表失败: ${(err as Error).message}` };
    }
  }

  const modelName = trimmedArgs;
  try {
    ctx.agentManager.setAgentModel(agentId, modelName);
    return { reply: `✅ 已将 ${adapter.displayName} (#${agentId}) 的模型切换为: ${modelName}` };
  } catch (err) {
    return { reply: `切换模型失败: ${(err as Error).message}` };
  }
}

function handleClear(ctx: CommandContext, args: string): CommandResult {
  const arg = args.trim().replace(/^#/, "");

  if (arg === "all") {
    const sessions = ctx.store.listSessions().filter(
      (s) => s.wechat_id === ctx.wechatAccountId && s.user_id === ctx.fromUserId,
    );
    for (const session of sessions) {
      ctx.store.clearSession(session.id);
    }
    return { reply: `✅ 已清空所有会话历史` };
  }

  if (arg) {
    const sessions = ctx.store.listSessions(arg).filter(
      (s) => s.wechat_id === ctx.wechatAccountId && s.user_id === ctx.fromUserId,
    );
    for (const session of sessions) {
      ctx.store.clearSession(session.id);
    }
    return { reply: `✅ 已清空 #${arg} 的会话历史` };
  }

  const agentId = ctx.store.getStickyRoute(ctx.wechatAccountId, ctx.fromUserId)
    ?? ctx.store.getDefaultAgent(ctx.wechatAccountId, ctx.fromUserId);
  if (!agentId) {
    return { reply: "⚠️ 请先用 /switch <agent> 选择一个 Agent" };
  }

  const session = ctx.store.getOrCreateSession(ctx.wechatAccountId, ctx.fromUserId, agentId);
  ctx.store.clearSession(session.id);
  const agent = ctx.store.getAgent(agentId);
  return { reply: `✅ 已清空 ${agent?.display_name ?? agentId} 的当前会话` };
}

function handleEcho(args: string): CommandResult {
  const message = args.trim() || "(空)";
  return { reply: message };
}

function formatTimeAgo(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return "刚刚";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.round(hours / 24);
  return `${days}天前`;
}

function handleSession(ctx: CommandContext, args: string): CommandResult {
  const agentId = ctx.store.getStickyRoute(ctx.wechatAccountId, ctx.fromUserId)
    ?? ctx.store.getDefaultAgent(ctx.wechatAccountId, ctx.fromUserId);

  if (!agentId) {
    return { reply: "⚠️ 请先用 /switch <agent> 选择一个 Agent" };
  }

  const agent = ctx.store.getAgent(agentId);
  const agentName = agent?.display_name ?? agentId;
  const trimmed = args.trim();

  if (!trimmed || trimmed === "list") {
    return sessionList(ctx, agentId, agentName);
  }

  if (trimmed.startsWith("new")) {
    const label = trimmed.slice(3).trim() || undefined;
    return sessionNew(ctx, agentId, agentName, label);
  }

  if (trimmed.startsWith("rename ")) {
    const label = trimmed.slice(7).trim();
    return sessionRename(ctx, agentId, label);
  }

  if (trimmed.startsWith("delete ")) {
    const numStr = trimmed.slice(7).trim();
    const num = parseInt(numStr, 10);
    if (isNaN(num) || num < 1) {
      return { reply: "⚠️ 用法: /session delete <编号>" };
    }
    return sessionDelete(ctx, agentId, agentName, num);
  }

  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 1) {
    return sessionSwitch(ctx, agentId, agentName, num);
  }

  return {
    reply: [
      `📋 ${agentName} 会话管理:`,
      "",
      "/session            列出会话",
      "/session new [名称]  新建会话",
      "/session <编号>      切换会话",
      "/session rename <名称> 重命名当前会话",
      "/session delete <编号> 删除会话",
    ].join("\n"),
  };
}

function sessionList(ctx: CommandContext, agentId: string, agentName: string): CommandResult {
  const sessions = ctx.store.listUserAgentSessions(ctx.wechatAccountId, ctx.fromUserId, agentId);

  if (sessions.length === 0) {
    return { reply: `${agentName} 暂无会话。发送消息即可自动创建。` };
  }

  const now = Date.now();
  const lines = [`📋 ${agentName} 会话列表:`];
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const label = s.label ? `[${s.label}]` : "[未命名]";
    const active = s.is_active ? " ← 当前" : "";
    const ago = formatTimeAgo(now - s.last_active);
    lines.push(`  ${i + 1}. ${label} — ${s.message_count}条消息, ${ago}${active}`);
  }
  lines.push("", "💡 /session <编号> 切换 | /session new 新建");

  return { reply: lines.join("\n") };
}

function sessionNew(ctx: CommandContext, agentId: string, agentName: string, label?: string): CommandResult {
  ctx.store.createNewSession(ctx.wechatAccountId, ctx.fromUserId, agentId, label);
  const labelStr = label ? `「${label}」` : "";
  return { reply: `✅ 已为 ${agentName} 新建会话${labelStr}并切换` };
}

function sessionSwitch(ctx: CommandContext, agentId: string, agentName: string, num: number): CommandResult {
  const sessions = ctx.store.listUserAgentSessions(ctx.wechatAccountId, ctx.fromUserId, agentId);
  if (num < 1 || num > sessions.length) {
    return { reply: `⚠️ 编号超出范围，当前共 ${sessions.length} 个会话` };
  }

  const target = sessions[num - 1];
  if (target.is_active) {
    const label = target.label ? `「${target.label}」` : `#${num}`;
    return { reply: `已经在会话 ${label} 中` };
  }

  ctx.store.switchActiveSession(ctx.wechatAccountId, ctx.fromUserId, agentId, target.id);
  const label = target.label ? `「${target.label}」` : `#${num}`;
  return { reply: `✅ 已切换到 ${agentName} 会话 ${label}` };
}

function sessionRename(ctx: CommandContext, agentId: string, label: string): CommandResult {
  if (!label) {
    return { reply: "⚠️ 用法: /session rename <名称>" };
  }
  const session = ctx.store.getOrCreateSession(ctx.wechatAccountId, ctx.fromUserId, agentId);
  ctx.store.renameSession(session.id, label);
  return { reply: `✅ 当前会话已命名为「${label}」` };
}

function sessionDelete(ctx: CommandContext, agentId: string, agentName: string, num: number): CommandResult {
  const sessions = ctx.store.listUserAgentSessions(ctx.wechatAccountId, ctx.fromUserId, agentId);
  if (num < 1 || num > sessions.length) {
    return { reply: `⚠️ 编号超出范围，当前共 ${sessions.length} 个会话` };
  }

  const target = sessions[num - 1];
  const result = ctx.store.deleteSession(target.id);
  if (!result.ok) {
    return { reply: `⚠️ ${result.error}` };
  }
  const label = target.label ? `「${target.label}」` : `#${num}`;
  return { reply: `✅ 已删除 ${agentName} 会话 ${label}` };
}

function handleSessions(ctx: CommandContext): CommandResult {
  const sessions = ctx.store.listSessions().filter(
    (s) => s.wechat_id === ctx.wechatAccountId && s.user_id === ctx.fromUserId,
  );

  if (sessions.length === 0) {
    return { reply: "暂无活跃会话。" };
  }

  const now = Date.now();
  const grouped = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const list = grouped.get(s.agent_id) ?? [];
    list.push(s);
    grouped.set(s.agent_id, list);
  }

  const lines = ["📋 所有会话概览:"];
  for (const [aid, agentSessions] of grouped) {
    const agent = ctx.store.getAgent(aid);
    const name = agent?.display_name ?? aid;
    lines.push(`\n${name} (${agentSessions.length}个会话):`);
    for (const s of agentSessions) {
      const label = s.label ? `[${s.label}]` : "[未命名]";
      const active = s.is_active ? " ← 当前" : "";
      const ago = formatTimeAgo(now - s.last_active);
      lines.push(`  • ${label} — ${s.message_count}条消息, ${ago}${active}`);
    }
  }

  return { reply: lines.join("\n") };
}
