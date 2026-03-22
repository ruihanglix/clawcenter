import { EventEmitter } from "node:events";
import {
  getUpdates, sendMessage, sendTyping, getConfig, extractTextFromMessage, getRefMessageId,
  getRefMessageText, sendImageMessage,
  type WeixinMessage, type GetUpdatesResponse,
} from "./api.js";
import { encryptAndUploadMedia, downloadAndDecryptMedia, downloadRemoteToTemp } from "./cdn.js";
import type { CDNMedia, MessageItem } from "./api.js";
import { loginWithQr, type LoginCallbacks, type LoginResult } from "./login.js";
import type { Store } from "../../core/db/store.js";
import { debug } from "../../logger.js";

const SESSION_EXPIRED_CODE = -14;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;
const SESSION_PAUSE_MS = 60 * 60_000;

export interface InboundMessage {
  wechatAccountId: string;
  messageId?: string;
  fromUserId: string;
  text: string;
  contextToken?: string;
  refMessageId?: string;
  refMessageText?: string;
  mediaItems: MediaItemInfo[];
  rawMessage: WeixinMessage;
  receivedAt: number;
}

export interface MediaItemInfo {
  type: "image" | "voice" | "file" | "video";
  media?: CDNMedia;
  fileName?: string;
  voiceText?: string;
}

export class WechatConnector extends EventEmitter {
  private store: Store;
  private accountId: string;
  private running = false;
  private abortController: AbortController | null = null;
  private pausedUntil = 0;
  private contextTokenCache = new Map<string, string>();
  private typingTicketCache = new Map<string, string>();

  constructor(store: Store, accountId: string) {
    super();
    this.store = store;
    this.accountId = accountId;
  }

  get isRunning(): boolean {
    return this.running;
  }

  async login(callbacks?: LoginCallbacks): Promise<LoginResult> {
    const account = this.store.getWechatAccount(this.accountId);
    if (!account) throw new Error(`WeChat account "${this.accountId}" not found`);

    debug("Connector", `Starting login for "${this.accountId}", base_url=${account.base_url}`);
    const result = await loginWithQr(account.base_url, callbacks);
    this.store.updateWechatAccount(this.accountId, {
      token: result.token,
      base_url: result.baseUrl,
      account_id: result.accountId,
      user_id: result.userId,
      status: "connected",
      get_updates_buf: "",
    });
    return result;
  }

  async start(): Promise<void> {
    if (this.running) return;
    const account = this.store.getWechatAccount(this.accountId);
    if (!account?.token) {
      throw new Error(`WeChat account "${this.accountId}" not logged in`);
    }

    this.running = true;
    this.abortController = new AbortController();
    this.store.updateWechatAccount(this.accountId, { status: "connected" });
    this.emit("started", this.accountId);

    this.pollLoop(account.base_url, account.token, account.cdn_base_url, account.get_updates_buf)
      .catch((err) => {
        if (!this.abortController?.signal.aborted) {
          console.error(`[WechatConnector:${this.accountId}] Poll loop error:`, err);
          this.emit("error", err);
        }
      })
      .finally(() => {
        this.running = false;
        this.store.updateWechatAccount(this.accountId, { status: "disconnected" });
        this.emit("stopped", this.accountId);
      });
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
  }

  async sendText(toUserId: string, text: string): Promise<{ clientId: string; serverMsgId?: string }> {
    const account = this.store.getWechatAccount(this.accountId);
    if (!account?.token) throw new Error("Not connected");

    const contextToken = this.contextTokenCache.get(toUserId);
    return sendMessage({
      baseUrl: account.base_url,
      token: account.token,
      to: toUserId,
      text,
      contextToken,
    });
  }

  async sendMediaFile(toUserId: string, filePath: string, text?: string): Promise<{ clientId: string; serverMsgId?: string }> {
    const account = this.store.getWechatAccount(this.accountId);
    if (!account?.token) throw new Error("Not connected");

    const uploaded = await encryptAndUploadMedia(filePath, {
      baseUrl: account.base_url,
      token: account.token,
      cdnBaseUrl: account.cdn_base_url,
    });

    const contextToken = this.contextTokenCache.get(toUserId);
    return sendImageMessage({
      baseUrl: account.base_url,
      token: account.token,
      to: toUserId,
      text,
      contextToken,
      imageAesKey: uploaded.aesKey,
      encryptQueryParam: uploaded.encryptQueryParam,
      fileSize: uploaded.fileSize,
    });
  }

  async sendTypingIndicator(toUserId: string, typing: boolean): Promise<void> {
    const account = this.store.getWechatAccount(this.accountId);
    if (!account?.token) return;

    const ticket = this.typingTicketCache.get(toUserId);
    if (!ticket) return;

    try {
      await sendTyping({
        baseUrl: account.base_url,
        token: account.token,
        userId: toUserId,
        typingTicket: ticket,
        status: typing ? 1 : 2,
      });
    } catch {
      // Typing indicator failures are non-critical
    }
  }

  async downloadMedia(media: CDNMedia, cdnBaseUrl?: string): Promise<Buffer> {
    const account = this.store.getWechatAccount(this.accountId);
    return downloadAndDecryptMedia(media, cdnBaseUrl ?? account?.cdn_base_url);
  }

  setContextToken(userId: string, token: string): void {
    this.contextTokenCache.set(userId, token);
  }

  private async pollLoop(
    baseUrl: string,
    token: string,
    cdnBaseUrl: string,
    initialBuf: string,
  ): Promise<void> {
    let buf = initialBuf;
    let consecutiveFailures = 0;
    const signal = this.abortController!.signal;

    while (this.running && !signal.aborted) {
      // Session pause check
      if (Date.now() < this.pausedUntil) {
        await sleep(Math.min(60_000, this.pausedUntil - Date.now()), signal);
        continue;
      }

      try {
        const resp: GetUpdatesResponse = await getUpdates({ baseUrl, token, get_updates_buf: buf, timeoutMs: 38_000 });
        debug("Connector", `[${this.accountId}] getUpdates: ret=${resp.ret}, errcode=${resp.errcode}, msgs=${resp.msgs?.length ?? 0}, buf=${!!resp.get_updates_buf}`);

        // API error handling
        const isError = (resp.ret !== undefined && resp.ret !== 0) || (resp.errcode !== undefined && resp.errcode !== 0);
        if (isError) {
          if (resp.errcode === SESSION_EXPIRED_CODE || resp.ret === SESSION_EXPIRED_CODE) {
            console.error(`[WechatConnector:${this.accountId}] Session expired (ret=${resp.ret}, errcode=${resp.errcode}), pausing for 1 hour`);
            this.pausedUntil = Date.now() + SESSION_PAUSE_MS;
            this.emit("session_expired", this.accountId);
            consecutiveFailures = 0;
            continue;
          }

          consecutiveFailures++;
          console.error(`[WechatConnector:${this.accountId}] getUpdates error: ret=${resp.ret} errcode=${resp.errcode}`);
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            consecutiveFailures = 0;
            await sleep(BACKOFF_DELAY_MS, signal);
          } else {
            await sleep(RETRY_DELAY_MS, signal);
          }
          continue;
        }

        consecutiveFailures = 0;

        if (resp.get_updates_buf) {
          buf = resp.get_updates_buf;
          this.store.updateWechatAccount(this.accountId, { get_updates_buf: buf });
        }

        for (const msg of resp.msgs ?? []) {
          if (msg.context_token && msg.from_user_id) {
            this.contextTokenCache.set(msg.from_user_id, msg.context_token);
          }

          // Fetch typing ticket for this user
          if (msg.from_user_id && !this.typingTicketCache.has(msg.from_user_id)) {
            try {
              const cfg = await getConfig({
                baseUrl, token,
                userId: msg.from_user_id,
                contextToken: msg.context_token,
              });
              if (cfg.typing_ticket) {
                this.typingTicketCache.set(msg.from_user_id, cfg.typing_ticket);
              }
            } catch { /* non-critical */ }
          }

          const refMessageId = getRefMessageId(msg) ?? undefined;
          const refMessageText = getRefMessageText(msg) ?? undefined;
          if (refMessageId || refMessageText) {
            debug("Connector", `[${this.accountId}] ref_msg: id=${refMessageId ?? "none"}, text=${refMessageText?.slice(0, 80) ?? "none"}`);
          }

          const inbound: InboundMessage = {
            wechatAccountId: this.accountId,
            messageId: msg.message_id,
            fromUserId: msg.from_user_id ?? "",
            text: extractTextFromMessage(msg),
            contextToken: msg.context_token,
            refMessageId,
            refMessageText,
            mediaItems: this.extractMediaItems(msg),
            rawMessage: msg,
            receivedAt: Date.now(),
          };

          this.emit("message", inbound);
        }
      } catch (err) {
        if (signal.aborted) return;
        consecutiveFailures++;
        console.error(`[WechatConnector:${this.accountId}] Poll error:`, (err as Error).message);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
          await sleep(BACKOFF_DELAY_MS, signal);
        } else {
          await sleep(RETRY_DELAY_MS, signal);
        }
      }
    }
  }

  private extractMediaItems(msg: WeixinMessage): MediaItemInfo[] {
    const items: MediaItemInfo[] = [];
    for (const item of msg.item_list ?? []) {
      if (item.type === 2 && item.image_item?.media?.encrypt_query_param) {
        items.push({ type: "image", media: item.image_item.media });
      } else if (item.type === 3 && item.voice_item?.media?.encrypt_query_param) {
        items.push({ type: "voice", media: item.voice_item.media, voiceText: item.voice_item.text });
      } else if (item.type === 4 && item.file_item?.media?.encrypt_query_param) {
        items.push({ type: "file", media: item.file_item.media, fileName: item.file_item.file_name });
      } else if (item.type === 5 && item.video_item?.media?.encrypt_query_param) {
        items.push({ type: "video", media: item.video_item.media });
      }
    }
    return items;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("aborted")); return; }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); }, { once: true });
  });
}
