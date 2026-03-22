import crypto from "node:crypto";
import { debug } from "../../logger.js";

const CHANNEL_VERSION = "1.0.2";

export interface WeixinApiOptions {
  baseUrl: string;
  token?: string | null;
}

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

async function apiRequest(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string | null;
    timeoutMs?: number;
  } = {},
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/$/, "")}/${path}`;
  const method = options.method ?? (options.body ? "POST" : "GET");

  debug("WX-API", `→ ${method} ${url}`);

  const payload = options.body
    ? { ...(options.body as Record<string, unknown>), base_info: { channel_version: CHANNEL_VERSION } }
    : undefined;
  const bodyStr = payload ? JSON.stringify(payload) : undefined;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
  };
  if (bodyStr) {
    headers["Content-Length"] = String(Buffer.byteLength(bodyStr, "utf-8"));
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const controller = new AbortController();
  const timeout = options.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: bodyStr,
      signal: controller.signal,
    });

    const text = await response.text();
    debug("WX-API", `← ${response.status} ${url} (${text.length} bytes)`);

    try {
      const parsed = JSON.parse(text);
      if (parsed.ret !== undefined && parsed.ret !== 0) {
        debug("WX-API", `  ret=${parsed.ret} errmsg=${parsed.errmsg ?? "?"}`);
      }
      return parsed;
    } catch {
      debug("WX-API", `  Non-JSON response: ${text.slice(0, 300)}`);
      return { ret: -1, errmsg: `Non-JSON response: ${text.slice(0, 200)}` };
    }
  } catch (err) {
    debug("WX-API", `✗ ${method} ${url} Error: ${(err as Error).message}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Message types ───

export const MessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  file_size?: number;
}

export interface MessageItem {
  type: number;
  text_item?: { text: string };
  image_item?: { media?: CDNMedia };
  voice_item?: { media?: CDNMedia; text?: string };
  file_item?: { media?: CDNMedia; file_name?: string };
  video_item?: { media?: CDNMedia };
  ref_msg?: { message_id?: string; message_item?: MessageItem };
}

export interface WeixinMessage {
  message_id?: string;
  from_user_id?: string;
  to_user_id?: string;
  message_type?: number;
  message_state?: number;
  context_token?: string;
  session_id?: string;
  seq?: number;
  create_time_ms?: number;
  item_list?: MessageItem[];
}

export interface GetUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface GetConfigResponse {
  ret?: number;
  errcode?: number;
  typing_ticket?: string;
}

// ─── API functions ───

export async function getUpdates(opts: {
  baseUrl: string;
  token?: string | null;
  get_updates_buf: string;
  timeoutMs?: number;
}): Promise<GetUpdatesResponse> {
  return apiRequest(opts.baseUrl, "ilink/bot/getupdates", {
    body: { get_updates_buf: opts.get_updates_buf },
    token: opts.token,
    timeoutMs: opts.timeoutMs ?? 38_000,
  }) as Promise<GetUpdatesResponse>;
}

export async function sendMessage(opts: {
  baseUrl: string;
  token?: string | null;
  to: string;
  text: string;
  contextToken?: string;
}): Promise<{ clientId: string; serverMsgId?: string }> {
  const clientId = `cc-${crypto.randomUUID()}`;
  const resp = await apiRequest(opts.baseUrl, "ilink/bot/sendmessage", {
    body: {
      msg: {
        from_user_id: "",
        to_user_id: opts.to,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        context_token: opts.contextToken,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: opts.text } }],
      },
    },
    token: opts.token,
  }) as Record<string, unknown>;
  const serverMsgId = (resp.message_id ?? resp.msg_id ?? resp.msgId) as string | undefined;
  debug("WX-API", `sendMessage response keys=${Object.keys(resp).join(",")}, serverMsgId=${serverMsgId ?? "none"}`);
  return { clientId, serverMsgId };
}

export async function sendImageMessage(opts: {
  baseUrl: string;
  token?: string | null;
  to: string;
  text?: string;
  contextToken?: string;
  imageAesKey: string;
  encryptQueryParam: string;
  fileSize: number;
}): Promise<{ clientId: string; serverMsgId?: string }> {
  const clientId = `cc-${crypto.randomUUID()}`;
  const items: MessageItem[] = [];

  if (opts.text) {
    items.push({ type: MessageItemType.TEXT, text_item: { text: opts.text } });
  }
  items.push({
    type: MessageItemType.IMAGE,
    image_item: {
      media: {
        aes_key: opts.imageAesKey,
        encrypt_query_param: opts.encryptQueryParam,
        file_size: opts.fileSize,
      },
    },
  });

  const resp = await apiRequest(opts.baseUrl, "ilink/bot/sendmessage", {
    body: {
      msg: {
        from_user_id: "",
        to_user_id: opts.to,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        context_token: opts.contextToken,
        item_list: items,
      },
    },
    token: opts.token,
  }) as Record<string, unknown>;
  const serverMsgId = (resp.message_id ?? resp.msg_id ?? resp.msgId) as string | undefined;
  return { clientId, serverMsgId };
}

export async function getUploadUrl(opts: {
  baseUrl: string;
  token?: string | null;
}): Promise<{ upload_url?: string; upload_param?: string }> {
  return apiRequest(opts.baseUrl, "ilink/bot/getuploadurl", {
    body: {},
    token: opts.token,
  }) as Promise<{ upload_url?: string; upload_param?: string }>;
}

export async function getConfig(opts: {
  baseUrl: string;
  token?: string | null;
  userId?: string;
  contextToken?: string;
}): Promise<GetConfigResponse> {
  const body: Record<string, unknown> = {};
  if (opts.userId) body.ilink_user_id = opts.userId;
  if (opts.contextToken) body.context_token = opts.contextToken;
  return apiRequest(opts.baseUrl, "ilink/bot/getconfig", {
    body,
    token: opts.token,
  }) as Promise<GetConfigResponse>;
}

export async function sendTyping(opts: {
  baseUrl: string;
  token?: string | null;
  userId: string;
  typingTicket: string;
  status: number;
}): Promise<void> {
  await apiRequest(opts.baseUrl, "ilink/bot/sendtyping", {
    body: {
      ilink_user_id: opts.userId,
      typing_ticket: opts.typingTicket,
      status: opts.status,
    },
    token: opts.token,
  });
}

export async function getBotQrcode(baseUrl: string, botType: string = "3"): Promise<{
  qrcode?: string;
  qrcode_img_content?: string;
  ret?: number;
  errmsg?: string;
}> {
  return apiRequest(baseUrl, `ilink/bot/get_bot_qrcode?bot_type=${botType}`, {}) as Promise<{
    qrcode?: string;
    qrcode_img_content?: string;
    ret?: number;
    errmsg?: string;
  }>;
}

export async function getQrcodeStatus(baseUrl: string, qrcode: string): Promise<{
  status?: string;
  bot_token?: string;
  baseurl?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
}> {
  type QrStatusResult = {
    status?: string;
    bot_token?: string;
    baseurl?: string;
    ilink_bot_id?: string;
    ilink_user_id?: string;
  };
  try {
    return await apiRequest(
      baseUrl,
      `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      { timeoutMs: 40_000 },
    ) as QrStatusResult;
  } catch (err) {
    if ((err as Error).name === "AbortError" || (err as Error).message?.includes("aborted")) {
      debug("WX-API", "getQrcodeStatus long-poll timeout, returning wait");
      return { status: "wait" };
    }
    throw err;
  }
}

export function extractTextFromMessage(msg: WeixinMessage): string {
  for (const item of msg.item_list ?? []) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      return item.text_item.text;
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return `[语音] ${item.voice_item.text}`;
    }
    if (item.type === MessageItemType.IMAGE) return "[图片]";
    if (item.type === MessageItemType.FILE) return `[文件] ${item.file_item?.file_name ?? ""}`;
    if (item.type === MessageItemType.VIDEO) return "[视频]";
  }
  return "";
}

export function getRefMessageId(msg: WeixinMessage): string | null {
  for (const item of msg.item_list ?? []) {
    if (item.ref_msg?.message_id) {
      return item.ref_msg.message_id;
    }
  }
  return null;
}

export function getRefMessageText(msg: WeixinMessage): string | null {
  for (const item of msg.item_list ?? []) {
    if (item.ref_msg?.message_item) {
      const refItem = item.ref_msg.message_item;
      if (refItem.text_item?.text) return refItem.text_item.text;
    }
  }
  return null;
}
