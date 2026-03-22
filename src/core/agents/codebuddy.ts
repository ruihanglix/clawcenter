import { execFile, spawn, type ChildProcess } from "node:child_process";
import type { AgentAdapter, AgentConfig, ModelInfo, SendParams, SendResult } from "./adapter.js";

const MODELS_CACHE_TTL = 5 * 60_000;

const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_STDERR = 8 * 1024;

function clampTimeout(ms: unknown): number {
  const n = typeof ms === "number" ? ms : 0;
  return n > 0 ? Math.min(n, MAX_TIMEOUT_MS) : 0;
}

function getIdleTimeoutMs(totalTimeoutMs: number): number {
  const raw = process.env.CODEBUDDY_IDLE_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const idle =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(parsed, MAX_TIMEOUT_MS)
      : DEFAULT_IDLE_TIMEOUT_MS;
  return totalTimeoutMs > 0 ? Math.min(idle, totalTimeoutMs) : idle;
}

function buildArgs(
  prompt: string,
  sessionId: string | undefined,
  permissionMode?: string,
  model?: string,
): string[] {
  const args = ["--print", "--output-format", "stream-json"];

  if (permissionMode === "dangerously-skip-permissions") {
    args.push("--dangerously-skip-permissions");
  } else if (permissionMode === "bypassPermissions") {
    args.push("--permission-mode", "bypassPermissions");
  } else if (permissionMode === "plan") {
    args.push("--permission-mode", "plan");
  } else if (permissionMode === "acceptEdits") {
    args.push("--permission-mode", "acceptEdits");
  }

  if (model) args.push("--model", model);
  if (sessionId) args.push("--resume", sessionId);

  args.push(prompt);
  return args;
}

// --- SSE / NDJSON stream parsing ---

function parseSseChunk(buffer: string): Array<{ event: string; data: string }> {
  const chunks = buffer.split(/\r?\n\r?\n/);
  const events: Array<{ event: string; data: string }> = [];

  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/);
    let event = "";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }

    if (event && dataLines.length > 0) {
      events.push({ event, data: dataLines.join("\n") });
    }
  }

  return events;
}

function extractSseFrames(state: { buffer: string }): Array<{ event: string; data: string }> {
  const frames: Array<{ event: string; data: string }> = [];

  for (;;) {
    const separatorIndex = state.buffer.search(/\r?\n\r?\n/);
    if (separatorIndex < 0) break;

    const chunk = state.buffer.slice(0, separatorIndex);
    const separatorMatch = state.buffer.slice(separatorIndex).match(/^\r?\n\r?\n/);
    const separatorLength = separatorMatch?.[0].length ?? 2;
    state.buffer = state.buffer.slice(separatorIndex + separatorLength);
    frames.push(...parseSseChunk(chunk));
  }

  return frames;
}

function extractNdjsonPayloads(state: { buffer: string }): string[] {
  const payloads: string[] = [];

  for (;;) {
    const idx = state.buffer.indexOf("\n");
    if (idx < 0) break;
    const line = state.buffer.slice(0, idx).trim();
    state.buffer = state.buffer.slice(idx + 1);
    if (line) payloads.push(line);
  }

  return payloads;
}

function extractBufferedPayloads(state: { buffer: string }): string[] {
  if (state.buffer.includes("event:") || state.buffer.includes("data:")) {
    const payloads: string[] = [];
    for (const frame of extractSseFrames(state)) {
      if (frame.event === "done") continue;
      payloads.push(frame.data);
    }
    return payloads;
  }
  return extractNdjsonPayloads(state);
}

function flushBufferedPayloads(state: { buffer: string }): string[] {
  const payloads = extractBufferedPayloads(state);
  const trailing = state.buffer.trim();
  if (trailing) {
    payloads.push(trailing);
    state.buffer = "";
  }
  return payloads;
}

function extractTextBlocks(content: unknown): string {
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const rec = block as Record<string, unknown>;
    if (rec.type === "text" && typeof rec.text === "string") {
      text += (text ? "\n" : "") + rec.text;
    }
  }
  return text;
}

// --- Adapter ---

export class CodeBuddyAdapter implements AgentAdapter {
  readonly type = "codebuddy" as const;
  readonly supportsModelSwitch = true;
  status: "running" | "stopped" | "error" = "stopped";
  private config: AgentConfig = {};
  private processes = new Map<string, ChildProcess>();
  private modelsCache: { models: ModelInfo[]; time: number } | null = null;

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
    const now = Date.now();
    if (this.modelsCache && now - this.modelsCache.time < MODELS_CACHE_TTL) {
      return this.modelsCache.models;
    }

    const cliPath = (this.config.cliPath as string) || "codebuddy";
    const models = await new Promise<ModelInfo[]>((resolve) => {
      execFile(cliPath, ["--help"], { timeout: 10_000 }, (err, stdout) => {
        if (err) {
          console.error(`[codebuddy:${this.id}] Failed to list models:`, err.message);
          resolve([]);
          return;
        }
        const match = stdout.match(/--model\s+<model>\s+[^(]*\(([^)]+)\)/s);
        if (!match) { resolve([]); return; }

        const ids = match[1].split(",").map((s) => s.trim()).filter(Boolean);
        resolve(ids.map((id) => {
          const slash = id.indexOf("-");
          const provider = slash !== -1 ? id.substring(0, slash) : "default";
          return { id, provider };
        }));
      });
    });

    this.modelsCache = { models, time: now };
    return models;
  }

  async send(params: SendParams): Promise<SendResult> {
    if (this.status !== "running") {
      throw new Error(`Agent ${this.id} is not running`);
    }

    const cliPath = (this.config.cliPath as string) || "codebuddy";
    const timeoutMs = clampTimeout(this.config.timeoutMs);
    const idleTimeoutMs = getIdleTimeoutMs(timeoutMs);

    const args = buildArgs(
      params.message,
      params.agentSessionId,
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

    return new Promise<SendResult>((resolve, reject) => {
      const proc = spawn(cliPath, args, {
        cwd: this.config.cwd ?? process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });

      this.processes.set(params.sessionId, proc);

      let accumulated = "";
      let sessionId: string | undefined;
      let completed = false;
      const stdoutState = { buffer: "" };
      let stderrText = "";

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
        if (!proc.killed) proc.kill("SIGTERM");
        this.processes.delete(params.sessionId);
        reject(new Error(message));
      };

      const resetIdleTimeout = () => {
        if (idleTimeoutMs <= 0 || completed) return;
        if (idleTimeoutHandle) clearTimeout(idleTimeoutHandle);
        idleTimeoutHandle = setTimeout(() => {
          failAndKill(`CodeBuddy idle timeout after ${idleTimeoutMs}ms`);
        }, idleTimeoutMs);
      };

      if (timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          failAndKill(`CodeBuddy timeout after ${timeoutMs}ms`);
        }, timeoutMs);
      }
      resetIdleTimeout();

      const handlePayload = (payload: Record<string, unknown>) => {
        const type = payload.type;

        if (type === "system" && payload.subtype === "init") {
          const nextSessionId =
            typeof payload.session_id === "string" ? payload.session_id
            : typeof payload.uuid === "string" ? payload.uuid
            : undefined;
          if (nextSessionId && !sessionId) sessionId = nextSessionId;
          return;
        }

        if (type === "assistant") {
          const message = payload.message && typeof payload.message === "object"
            ? (payload.message as Record<string, unknown>)
            : undefined;
          if (!message) return;

          const text = extractTextBlocks(message.content);
          if (text) {
            accumulated = text;
            params.onStream?.(text);
          }
          return;
        }

        if (type === "result") {
          if (completed) return;
          completed = true;
          clearTimers();
          const isError = payload.is_error === true;
          const resultText = typeof payload.result === "string" ? payload.result : accumulated;

          if (isError) {
            const errors = Array.isArray(payload.errors)
              ? payload.errors.map((item) => String(item)).join("\n")
              : resultText || "CodeBuddy execution failed";
            this.processes.delete(params.sessionId);
            reject(new Error(errors));
            return;
          }

          this.processes.delete(params.sessionId);
          resolve({
            text: resultText || accumulated || "(No response)",
            agentSessionId: sessionId,
          });
        }
      };

      proc.stdout?.on("data", (chunk: Buffer) => {
        resetIdleTimeout();
        stdoutState.buffer += chunk.toString();
        for (const payload of extractBufferedPayloads(stdoutState)) {
          try {
            handlePayload(JSON.parse(payload) as Record<string, unknown>);
          } catch {
            // non-JSON payload, skip
          }
        }
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        resetIdleTimeout();
        stderrText += chunk.toString();
        if (stderrText.length > MAX_STDERR) {
          stderrText = stderrText.slice(-MAX_STDERR);
        }
      });

      proc.on("close", (code) => {
        clearTimers();
        this.processes.delete(params.sessionId);
        if (completed) return;

        // Flush any remaining buffered data
        if (stdoutState.buffer.trim()) {
          for (const payload of flushBufferedPayloads(stdoutState)) {
            try {
              handlePayload(JSON.parse(payload) as Record<string, unknown>);
            } catch {
              // ignore trailing partial payloads
            }
          }
          if (completed) return;
        }

        if (code && code !== 0) {
          completed = true;
          reject(new Error(stderrText.trim() || `CodeBuddy CLI exited with code ${code}`));
          return;
        }

        completed = true;
        resolve({
          text: accumulated || "(No response)",
          agentSessionId: sessionId,
        });
      });

      proc.on("error", (err) => {
        clearTimers();
        this.processes.delete(params.sessionId);
        if (!completed) {
          completed = true;
          reject(new Error(`Failed to start CodeBuddy CLI: ${err.message}`));
        }
      });
    });
  }
}
