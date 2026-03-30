import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { AgentAdapter, AgentConfig, ModelInfo, SendParams, SendResult } from "./adapter.js";

const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_STDERR_HEAD = 4 * 1024;
const MAX_STDERR_TAIL = 6 * 1024;
const DEFAULT_PERMISSION_MODE = "dangerously-skip-permissions";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const CODEX_CONFIG_CACHE_TTL = 5_000;
const IMAGE_PATH_PATTERNS = [
  /!\[[^\]]*]\(([^)]+)\)/g,
  /file:\/\/[^\s)"'`]+/g,
  /(?:^|[\s("'`])((?:\.{1,2}\/|~\/|\/)[^\s)"'`]+\.(?:png|jpe?g|gif|webp|bmp))/gi,
];

interface CodexConfigSnapshot {
  currentModel?: string;
  currentProvider?: string;
  models: ModelInfo[];
}

let codexConfigCache: {
  path: string;
  mtimeMs: number;
  loadedAt: number;
  snapshot: CodexConfigSnapshot;
} | null = null;

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

function getCodexConfigPath(): string {
  const codexHome = process.env.CODEX_HOME?.trim();
  return codexHome ? resolve(codexHome, "config.toml") : resolve(homedir(), ".codex", "config.toml");
}

function splitTomlPath(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "." && !inQuotes) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = "";
      continue;
    }
    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) parts.push(trimmed);
  return parts;
}

function parseTomlStringValue(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("\"")) {
    let value = "";
    let escaped = false;
    for (let i = 1; i < trimmed.length; i += 1) {
      const char = trimmed[i];
      if (escaped) {
        value += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        return value.trim() || undefined;
      }
      value += char;
    }
    return undefined;
  }

  const commentIndex = trimmed.indexOf("#");
  const value = (commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex)).trim();
  return value || undefined;
}

function normalizeProviderName(provider?: string): string | undefined {
  const normalized = provider?.trim().toLowerCase();
  return normalized || undefined;
}

function inferProviderFromModel(model: string): string {
  const normalized = model.trim().toLowerCase();
  if (normalized.startsWith("gpt-") || normalized.startsWith("o1") || normalized.startsWith("o3") || normalized.startsWith("o4")) {
    return "openai";
  }
  if (normalized.startsWith("claude")) return "anthropic";
  if (normalized.startsWith("gemini")) return "google";
  if (normalized.startsWith("grok")) return "xai";
  if (normalized.startsWith("deepseek")) return "deepseek";
  if (normalized.startsWith("qwen")) return "qwen";
  return "codex";
}

function addModelInfo(models: ModelInfo[], seen: Set<string>, model: string | undefined, provider?: string): void {
  const normalizedModel = model?.trim();
  if (!normalizedModel) return;

  const key = normalizedModel.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);

  models.push({
    id: normalizedModel,
    provider: normalizeProviderName(provider) ?? inferProviderFromModel(normalizedModel),
  });
}

function readCodexConfigSnapshot(): CodexConfigSnapshot {
  const path = getCodexConfigPath();

  try {
    if (!existsSync(path)) {
      return { models: [] };
    }

    const stat = statSync(path);
    const now = Date.now();
    if (
      codexConfigCache
      && codexConfigCache.path === path
      && codexConfigCache.mtimeMs === stat.mtimeMs
      && now - codexConfigCache.loadedAt < CODEX_CONFIG_CACHE_TTL
    ) {
      return codexConfigCache.snapshot;
    }

    const content = readFileSync(path, "utf8");
    let currentSection: string[] = [];
    let topLevelModel: string | undefined;
    let reviewModel: string | undefined;
    let topLevelProvider: string | undefined;
    const profileModels = new Map<string, { model?: string; provider?: string }>();

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        currentSection = splitTomlPath(sectionMatch[1]);
        continue;
      }

      const entryMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
      if (!entryMatch) continue;

      const [, key, rawValue] = entryMatch;
      const value = parseTomlStringValue(rawValue);
      if (!value) continue;

      if (currentSection.length === 0) {
        if (key === "model") topLevelModel = value;
        if (key === "review_model") reviewModel = value;
        if (key === "model_provider") topLevelProvider = value;
        continue;
      }

      if (currentSection.length === 2 && currentSection[0] === "profiles") {
        const profileName = currentSection[1];
        const profile = profileModels.get(profileName) ?? {};
        if (key === "model") profile.model = value;
        if (key === "model_provider") profile.provider = value;
        profileModels.set(profileName, profile);
      }
    }

    const models: ModelInfo[] = [];
    const seen = new Set<string>();
    addModelInfo(models, seen, topLevelModel, topLevelProvider);
    addModelInfo(models, seen, reviewModel, topLevelProvider);
    for (const profile of profileModels.values()) {
      addModelInfo(models, seen, profile.model, profile.provider ?? topLevelProvider);
    }

    const snapshot: CodexConfigSnapshot = {
      currentModel: topLevelModel,
      currentProvider: normalizeProviderName(topLevelProvider),
      models,
    };

    codexConfigCache = {
      path,
      mtimeMs: stat.mtimeMs,
      loadedAt: now,
      snapshot,
    };
    return snapshot;
  } catch {
    return { models: [] };
  }
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
    return (this.config.model as string | undefined) ?? readCodexConfigSnapshot().currentModel;
  }

  setModel(model: string): void {
    this.config.model = model;
  }

  async listModels(provider?: string): Promise<ModelInfo[]> {
    const snapshot = readCodexConfigSnapshot();
    const models: ModelInfo[] = [];
    const seen = new Set<string>();

    addModelInfo(models, seen, this.config.model as string | undefined, snapshot.currentProvider);
    for (const model of snapshot.models) {
      addModelInfo(models, seen, model.id, model.provider);
    }

    const normalizedProvider = normalizeProviderName(provider);
    if (!normalizedProvider) {
      return models;
    }
    return models.filter((model) => normalizeProviderName(model.provider) === normalizedProvider);
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
