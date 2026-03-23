import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getUploadUrl } from "./api.js";
import type { CDNMedia } from "./api.js";

const DEFAULT_CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";

// ─── AES-128-ECB encryption/decryption ───

function aesEcbEncrypt(data: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function aesEcbDecrypt(data: Buffer, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

// ─── CDN Download (decrypt) ───

export async function downloadAndDecryptMedia(
  media: CDNMedia,
  cdnBaseUrl: string = DEFAULT_CDN_BASE,
  savePath?: string,
): Promise<Buffer> {
  if (!media.encrypt_query_param || !media.aes_key) {
    throw new Error("Media missing encrypt_query_param or aes_key");
  }

  const url = `${cdnBaseUrl}?${media.encrypt_query_param}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`CDN download failed: ${response.status}`);
  }

  const encrypted = Buffer.from(await response.arrayBuffer());
  const key = Buffer.from(media.aes_key, "hex");
  const decrypted = aesEcbDecrypt(encrypted, key);

  if (savePath) {
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(savePath, decrypted);
  }

  return decrypted;
}

// ─── CDN Upload (encrypt) ───

export async function encryptAndUploadMedia(
  filePath: string,
  opts: {
    baseUrl: string;
    token?: string | null;
    cdnBaseUrl?: string;
  },
): Promise<{ aesKey: string; encryptQueryParam: string; fileSize: number }> {
  const data = fs.readFileSync(filePath);
  const aesKey = crypto.randomBytes(16);
  const encrypted = aesEcbEncrypt(data, aesKey);

  // Get upload URL from API
  const uploadInfo = await getUploadUrl({ baseUrl: opts.baseUrl, token: opts.token });
  if (!uploadInfo.upload_url) {
    const suffix = [
      uploadInfo.errmsg ? `errmsg=${uploadInfo.errmsg}` : "",
      uploadInfo.ret !== undefined ? `ret=${uploadInfo.ret}` : "",
      uploadInfo.errcode !== undefined ? `errcode=${uploadInfo.errcode}` : "",
    ].filter(Boolean).join(", ");
    throw new Error(`Failed to get upload URL${suffix ? ` (${suffix})` : ""}`);
  }

  // Upload encrypted data
  const response = await fetch(uploadInfo.upload_url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: encrypted,
  });

  if (!response.ok) {
    throw new Error(`CDN upload failed: ${response.status}`);
  }

  const result = await response.json() as { encrypt_query_param?: string };
  if (!result.encrypt_query_param) {
    throw new Error("Upload response missing encrypt_query_param");
  }

  return {
    aesKey: aesKey.toString("hex"),
    encryptQueryParam: result.encrypt_query_param,
    fileSize: data.length,
  };
}

export async function uploadLocalToTempUrl(
  filePath: string,
  uploadUrl: string = process.env.CLAWCENTER_MEDIA_FALLBACK_UPLOAD_URL || "https://0x0.st",
): Promise<string> {
  const escapedFilePath = shellQuote(filePath);
  const escapedUploadUrl = shellQuote(uploadUrl);
  return new Promise<string>((resolve, reject) => {
    execFile("bash", ["-lc", `curl -fsS -F file=@${escapedFilePath} ${escapedUploadUrl}`], {
      timeout: 30_000,
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Fallback upload failed: ${stderr.trim() || err.message}`));
        return;
      }
      const text = stdout.trim();
      if (!text.startsWith("http://") && !text.startsWith("https://")) {
        reject(new Error(`Fallback upload returned unexpected response: ${text.slice(0, 200)}`));
        return;
      }
      resolve(text);
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

// ─── Download remote URL to temp file ───

export async function downloadRemoteToTemp(
  url: string,
  tempDir: string = "/tmp/clawcenter/media",
): Promise<string> {
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Remote download failed: ${response.status} ${url}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const ext = mimeToExt(contentType);
  const filename = `${crypto.randomUUID()}${ext}`;
  const filepath = path.join(tempDir, filename);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filepath, buffer);

  return filepath;
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "application/pdf": ".pdf",
  };
  for (const [key, ext] of Object.entries(map)) {
    if (mime.includes(key)) return ext;
  }
  return ".bin";
}
