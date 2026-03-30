import os from "node:os";
import path from "node:path";
import { Store, type Message, type WechatAccount } from "./core/db/store.js";
import { sendMessage } from "./center/wechat/api.js";

export interface NotifyOptions {
  dataDir?: string;
  text: string;
  wechatId?: string;
  userId?: string;
  dryRun?: boolean;
}

interface NotifyTarget {
  account: WechatAccount;
  userId: string;
  lastMessage: Message | null;
}

function getDefaultDataDir(dataDir?: string): string {
  return dataDir ?? path.join(os.homedir(), ".clawcenter");
}

function resolveTarget(store: Store, wechatId?: string, userId?: string): NotifyTarget {
  if (wechatId && userId) {
    const account = store.getWechatAccount(wechatId);
    if (!account) {
      throw new Error(`WeChat account "${wechatId}" not found`);
    }
    return { account, userId, lastMessage: null };
  }

  const recentMessages = store.listRecentMessages(200);
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const message = recentMessages[i];
    const account = store.getWechatAccount(message.wechat_id);
    if (!account?.token || account.status !== "connected") continue;
    return {
      account,
      userId: message.user_id,
      lastMessage: message,
    };
  }

  throw new Error("No recent connected WeChat target found");
}

export async function sendSystemNotification(options: NotifyOptions): Promise<Record<string, unknown>> {
  const dbPath = path.join(getDefaultDataDir(options.dataDir), "clawcenter.db");
  const store = new Store(dbPath);
  await store.initialize();

  try {
    const { account, userId, lastMessage } = resolveTarget(store, options.wechatId, options.userId);
    if (!account.token) {
      throw new Error(`WeChat account "${account.id}" is not connected`);
    }

    if (options.dryRun) {
      return {
        dryRun: true,
        wechatId: account.id,
        userId,
        text: options.text,
        baseUrl: account.base_url,
      };
    }

    const result = await sendMessage({
      baseUrl: account.base_url,
      token: account.token,
      to: userId,
      text: options.text,
    });

    if (lastMessage) {
      store.recordMessage({
        wechat_msg_id: result.serverMsgId,
        client_id: result.clientId,
        session_id: lastMessage.session_id,
        agent_id: lastMessage.agent_id,
        wechat_id: account.id,
        user_id: userId,
        direction: "outbound",
        content: options.text,
      });
    }

    return {
      dryRun: false,
      wechatId: account.id,
      userId,
      clientId: result.clientId,
      serverMsgId: result.serverMsgId,
    };
  } finally {
    store.close();
  }
}
