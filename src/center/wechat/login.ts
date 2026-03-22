import { getBotQrcode, getQrcodeStatus } from "./api.js";
import { debug } from "../../logger.js";

const BOT_TYPE = "3";
const MAX_QR_REFRESHES = 3;
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 1000;

export interface LoginResult {
  token: string;
  baseUrl: string;
  accountId: string;
  userId: string;
}

export interface LoginCallbacks {
  onQrCode?: (qrcodeUrl: string) => void;
  onStatus?: (message: string) => void;
  onScanned?: () => void;
}

export async function loginWithQr(
  baseUrl: string,
  callbacks?: LoginCallbacks,
  abortSignal?: AbortSignal,
): Promise<LoginResult> {
  const log = callbacks?.onStatus ?? (() => {});

  log("Starting WeChat QR login...");
  debug("Login", `baseUrl=${baseUrl}, botType=${BOT_TYPE}`);

  const qrResp = await getBotQrcode(baseUrl, BOT_TYPE);
  debug("Login", `getBotQrcode response: qrcode=${!!qrResp.qrcode}, img=${!!qrResp.qrcode_img_content}, ret=${qrResp.ret}, errmsg=${qrResp.errmsg}`);

  if (!qrResp.qrcode || !qrResp.qrcode_img_content) {
    throw new Error(`Failed to get QR code: ${qrResp.errmsg ?? "unknown error"}`);
  }

  let currentQrcode = qrResp.qrcode;
  callbacks?.onQrCode?.(qrResp.qrcode_img_content);

  log("Waiting for scan...");
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let refreshCount = 0;

  while (Date.now() < deadline) {
    if (abortSignal?.aborted) throw new Error("Login cancelled");

    let status: Awaited<ReturnType<typeof getQrcodeStatus>>;
    try {
      status = await getQrcodeStatus(baseUrl, currentQrcode);
    } catch (err) {
      debug("Login", `getQrcodeStatus error: ${(err as Error).message}`);
      log(`Poll error, retrying...`);
      await sleep(POLL_INTERVAL_MS, abortSignal);
      continue;
    }

    debug("Login", `qrcode status: ${status.status}`);

    switch (status.status) {
      case "wait":
        break;
      case "scaned":
        callbacks?.onScanned?.();
        log("Scanned. Please confirm on WeChat...");
        break;
      case "expired":
        if (++refreshCount > MAX_QR_REFRESHES) {
          throw new Error("QR code expired too many times");
        }
        log(`QR expired, refreshing (${refreshCount}/${MAX_QR_REFRESHES})...`);
        const newQr = await getBotQrcode(baseUrl, BOT_TYPE);
        if (!newQr.qrcode || !newQr.qrcode_img_content) {
          throw new Error("Failed to refresh QR code");
        }
        currentQrcode = newQr.qrcode;
        callbacks?.onQrCode?.(newQr.qrcode_img_content);
        break;
      case "confirmed":
        if (!status.bot_token || !status.ilink_bot_id) {
          debug("Login", `confirmed but incomplete: token=${!!status.bot_token}, bot_id=${status.ilink_bot_id}`);
          throw new Error("Login confirmed but missing token/bot_id");
        }
        log("Login successful!");
        debug("Login", `Success: bot_id=${status.ilink_bot_id}, baseurl=${status.baseurl}`);
        return {
          token: status.bot_token,
          baseUrl: status.baseurl || baseUrl,
          accountId: status.ilink_bot_id,
          userId: status.ilink_user_id ?? "",
        };
    }

    await sleep(POLL_INTERVAL_MS, abortSignal);
  }

  throw new Error("Login timeout");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    }, { once: true });
  });
}
