import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { AgentAdapter, AgentConfig, ModelInfo, SendParams, SendResult } from "./adapter.js";

const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_STDERR_HEAD = 4 * 1024;
const MAX_STDERR_TAIL = 6 * 1024;
const DEFAULT_PERMISSION_MODE = "dangerously-skip-permissions";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const IMAGE_PATH_PATTERNS = [
  /!\[[^\]]*]\(([^)]+)\)/g,
  /file:\/\/[^\s)"'`]+/g,
  /(?:^|[\s("'`])((?:\.{1,2}\/|~\/|\/)[^\s)"'`]+\.(?:png|jpe?g|gif|webp|bmp))/gi,
];

function clampTimeout(ms: unknown): number {
  const n = typeof ms === "number" ? ms : 0;
  return n > 0 ? Math.min(n, MAX_TIMEOUT_MS) : 0;
}

function getIdleTimeoutMs(totalTimeoutMs: number): number {
  const raw = process.env.CODEX_IDLE_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const idle =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(parsed, MAX_TIMEOUT_MS)
      : DEFAULT_IDLE_TIMEOUT_MS;
  return totalTimeoutMs > 0 ? Math.min(idle, totalTimeoutMs) : idle;
}

function resolvePermissionMode(permissionMode?: string): string {
  const normalized = permissionMode?.trim();
  return normalized || DEFAULT_PERMISSION_MODE;
}

function buildArgs(
  sessionId: string | undefined,
  workDir: string,
  permissionMode?: string,
  model?: string,
): string[] {
  const resolvedPermissionMode = resolvePermissionMode(permissionMode);
  const common = ["--json", "--skip-git-repo-check"];
  const isResume = Boolean(sessionId) && resolvedPermissionMode !== "plan";

  if (isResume) {
    const args = ["exec", "resume", ...common];
    if (resolvedPermissionMode === "dangerously-skip-permissions") {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      args.push("--full-auto");
    }
    if (model) args.push("--model", model);
    args.push(sessionId!, "-");
    return args;
  }

  const args = ["exec", ...common, "--cd", workDir];
  if (resolvedPermissionMode === "dangerously-skip-permissions") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (resolvedPermissionMode === "plan") {
    args.push("--sandbox", "read-only");
  } else {
    args.push("--full-auto");
  }
  if (model) args.push("--model", model);
  args.push("-");
  return args;
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stripEnclosingPunctuation(value: string): string {
  let normalized = value.trim();
  normalized = normalized.replace(/^[<"'`([{]+/, "");
  normalized = normalized.replace(/[>"'`)\]},;:.!?]+$/, "");
  return normalized;
}

function normalizeImagePath(candidate: string, workDir: string): string | null {
  const trimmed = stripEnclosingPunctuation(candidate);
  if (!trimmed || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return null;
  }

  let localPath = trimmed;
  if (localPath.startsWith("file://")) {
    try {
      localPath = decodeURIComponent(new URL(localPath).pathname);
    } catch {
      return null;
    }
  }

  if (localPath.startsWith("~/")) {
    const homeDir = process.env.HOME;
    if (!homeDir) return null;
    localPath = resolve(homeDir, localPath.slice(2));
  } else if (!isAbsolute(localPath)) {
    localPath = resolve(workDir, localPath);
  }

  const extension = extname(localPath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) {
    return null;
  }

  try {
    return existsSync(localPath) && statSync(localPath).isFile() ? localPath : null;
  } catch {
    return null;
  }
}

function extractImagePaths(text: string, workDir: string): string[] {
  const found = new Set<string>();

  for (const pattern of IMAGE_PATH_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const candidate = match[1] ?? match[0];
      const normalized = normalizeImagePath(candidate, workDir);
      if (normalized) found.add(normalized);
    }
  }

  return Array.from(found);
}

function collectImagePaths(value: unknown, workDir: string, found = new Set<string>()): string[] {
  if (typeof value === "string") {
    for (const imagePath of extractImagePaths(value, workDir)) {
      found.add(imagePath);
    }
    return Array.from(found);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectImagePaths(item, workDir, found);
    }
    return Array.from(found);
  }

  if (value && typeof value === "object") {
    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      collectImagePaths(nestedValue, workDir, found);
    }
  }

  return Array.from(found);
}

export class CodexAdapter implements AgentAdapter {
  readonly type = "codex" as const;
  readonly supportsModelSwitch = true;
  status: "running" | "stopped" | "error" = "stopped";
  private config: AgentConfig = {};
  private processes = new Map<string, ChildProcess>();

  constructor(
    readonly id: string,
    readonly displayName: string,
  ) {}

  async start(config: AgentConfig): Promise<void> {
    this.config = config;
    this.status = "running";
  }

  async stop(): Promise<void> {
    for (const proc of this.processes.values()) {
      proc.kill("SIGTERM");
    }
    this.processes.clear();
    this.status = "stopped";
  }

  getModel(): string | undefined {
    return this.config.model as string | undefined;
  }

  setModel(model: string): void {
    this.config.model = model;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async send(params: SendParams): Promise<SendResult> {
    if (this.status !== "running") {
      throw new Error(`Agent ${this.id} is not running`);
    }

    const cliPath = (this.config.cliPath as string) || "codex";
    const proxy = this.config.proxy as string | undefined;
    const timeoutMs = clampTimeout(this.config.timeoutMs);
    const idleTimeoutMs = getIdleTimeoutMs(timeoutMs);
    const workDir = this.config.cwd ?? process.cwd();

    const args = buildArgs(
      params.agentSessionId,
      workDir,
      this.config.permissionMode as string | undefined,
      this.config.model as string | undefined,
    );

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    for (const [k, v] of Object.entries(this.config.env ?? {})) {
      env[k] = v as string;
    }
    if (proxy) {
      env.HTTPS_PROXY = proxy;
      env.HTTP_PROXY = proxy;
      env.https_proxy = proxy;
      env.http_proxy = proxy;
      env.ALL_PROXY = proxy;
      env.all_proxy = proxy;
    }

    return new Promise<SendResult>((resolve, reject) => {
      const proc = spawn(cliPath, args, {
        cwd: workDir,
        stdio: ["pipe", "pipe", "pipe"],
        env,
      });

      this.processes.set(params.sessionId, proc);

      proc.stdin!.write(params.message);
      proc.stdin!.end();

      let accumulated = "";
      let sessionId: string | undefined;
      let completed = false;
      const chunks: string[] = [];
      const mediaPaths = new Set<string>();

      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let idleTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

      const clearTimers = () => {
        if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
        if (idleTimeoutHandle) { clearTimeout(idleTimeoutHandle); idleTimeoutHandle = null; }
      };

      const failAndKill = (message: string) => {
        if (completed) return;
        completed = true;
        clearTimers();
        rl.close();
        if (!proc.killed) proc.kill("SIGTERM");
        this.processes.delete(params.sessionId);
        reject(new Error(message));
      };

      const resetIdleTimeout = () => {
        if (idleTimeoutMs <= 0 || completed) return;
        if (idleTimeoutHandle) clearTimeout(idleTimeoutHandle);
        idleTimeoutHandle = setTimeout(() => {
          failAndKill(`Codex idle timeout after ${idleTimeoutMs}ms`);
        }, idleTimeoutMs);
      };

      if (timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          failAndKill(`Codex timeout after ${timeoutMs}ms`);
        }, timeoutMs);
      }
      resetIdleTimeout();

      // stderr capture (head + tail ring buffer)
      let stderrHead = "";
      let stderrTail = "";
      let stderrTotal = 0;
      let stderrHeadFull = false;

      proc.stderr?.on("data", (chunk: Buffer) => {
        resetIdleTimeout();
        const text = chunk.toString();
        stderrTotal += text.length;
        if (!stderrHeadFull) {
          const room = MAX_STDERR_HEAD - stderrHead.length;
          if (room > 0) {
            stderrHead += text.slice(0, room);
            if (stderrHead.length >= MAX_STDERR_HEAD) stderrHeadFull = true;
          }
        }
        stderrTail += text;
        if (stderrTail.length > MAX_STDERR_TAIL) {
          stderrTail = stderrTail.slice(-MAX_STDERR_TAIL);
        }
      });

      const rl = createInterface({ input: proc.stdout! });

      rl.on("line", (line) => {
        resetIdleTimeout();
        const event = parseJsonLine(line);
        if (!event) return;

        const type = event.type as string;

        if (type === "thread.started") {
          const threadId = (event.thread_id as string) ?? "";
          if (threadId) sessionId = threadId;
          return;
        }

        if (type === "turn.failed") {
          completed = true;
          clearTimers();
          const err = event.error as { message?: string } | undefined;
          failAndKill(err?.message ?? "Codex turn failed");
          return;
        }

        if (type === "error") {
          const msg = event.message as string | undefined;
          if (msg?.includes("Reconnecting")) return;
          failAndKill(msg ?? "Codex stream error");
          return;
        }

        if (type === "item.started" || type === "item.updated" || type === "item.completed") {
          const item = event.item as Record<string, unknown> | undefined;
          if (!item) return;
          const itemType = item.type as string;

          if (itemType === "command_execution") {
            for (const mediaPath of collectImagePaths(item, workDir)) {
              mediaPaths.add(mediaPath);
            }
          }

          if (itemType === "agent_message" && type === "item.completed") {
            const text = item.text as string | undefined;
            if (text) {
              accumulated += (accumulated ? "\n\n" : "") + text;
              chunks.push(text);
              params.onStream?.(text);
            }
            for (const mediaPath of collectImagePaths(item, workDir)) {
              mediaPaths.add(mediaPath);
            }
            return;
          }
        }

        if (type === "turn.completed") {
          if (completed) return;
          completed = true;
          clearTimers();
        }
      });

      let exitCode: number | null = null;
      let rlClosed = false;
      let childClosed = false;

      const finalize = () => {
        if (!rlClosed || !childClosed) return;
        clearTimers();
        this.processes.delete(params.sessionId);
        const resolvedMediaUrls = mediaPaths.size > 0 ? Array.from(mediaPaths) : undefined;
        if (completed) {
          resolve({
            text: accumulated || "(No response)",
            agentSessionId: sessionId,
            mediaUrls: resolvedMediaUrls,
          });
          return;
        }

        if (exitCode !== null && exitCode !== 0) {
          let errMsg = "";
          if (stderrTotal > 0) {
            if (!stderrHeadFull) {
              errMsg = stderrHead;
            } else if (stderrTotal <= MAX_STDERR_HEAD + MAX_STDERR_TAIL) {
              errMsg = stderrHead + stderrTail.slice(stderrTail.length - (stderrTotal - MAX_STDERR_HEAD));
            } else {
              errMsg = stderrHead +
                `\n\n... (omitted ${stderrTotal - MAX_STDERR_HEAD - MAX_STDERR_TAIL} bytes) ...\n\n` +
                stderrTail;
            }
          }
          reject(new Error(errMsg || `Codex CLI exited with code ${exitCode}`));
          return;
        }

        resolve({
          text: accumulated || "(No response)",
          agentSessionId: sessionId,
          mediaUrls: resolvedMediaUrls,
        });
      };

      proc.on("close", (code) => {
        exitCode = code;
        childClosed = true;
        finalize();
      });

      rl.on("close", () => {
        rlClosed = true;
        finalize();
      });

      proc.on("error", (err) => {
        clearTimers();
        this.processes.delete(params.sessionId);
        if (!completed) {
          completed = true;
          reject(new Error(`Failed to start Codex CLI: ${err.message}`));
        }
        childClosed = true;
        finalize();
      });
    });
  }
}
