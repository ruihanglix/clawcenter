import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentAdapter, AgentConfig, ModelInfo, SendParams, SendResult } from "./adapter.js";

const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const MODELS_CACHE_TTL = 5 * 60_000;

function clampTimeout(ms: unknown): number {
  const n = typeof ms === "number" ? ms : 0;
  return n > 0 ? Math.min(n, MAX_TIMEOUT_MS) : 0;
}

function getIdleTimeoutMs(totalTimeoutMs: number): number {
  const raw = process.env.CURSOR_AGENT_IDLE_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const idle =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(parsed, MAX_TIMEOUT_MS)
      : DEFAULT_IDLE_TIMEOUT_MS;
  return totalTimeoutMs > 0 ? Math.min(idle, totalTimeoutMs) : idle;
}

function buildArgs(
  prompt: string,
  agentSessionId: string | undefined,
  permissionMode: string | undefined,
  model: string | undefined,
): string[] {
  const args = ["agent", "--print", "--output-format", "stream-json", "--trust"];

  if (permissionMode === "plan") {
    args.push("--mode", "plan");
  } else if (permissionMode === "ask") {
    args.push("--mode", "ask");
  } else {
    args.push("--force");
  }

  if (model) args.push("--model", model);
  if (agentSessionId) args.push("--resume", agentSessionId);

  args.push("--", prompt);
  return args;
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text" || typeof b === "string")
      .map((b: any) => (typeof b === "string" ? b : b.text))
      .join("\n") || null;
  }
  if (content && typeof content === "object" && "text" in content) {
    return (content as any).text;
  }
  return null;
}

function parseModelsOutput(stdout: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  for (const line of stdout.split("\n")) {
    const match = line.match(/^(\S+)\s+-\s+(.+?)(?:\s+\(.*\))?\s*$/);
    if (!match) continue;
    const id = match[1];
    const dash = id.indexOf("-");
    models.push({ id, provider: dash !== -1 ? id.substring(0, dash) : "cursor" });
  }
  return models;
}

export class CursorAgentAdapter implements AgentAdapter {
  readonly type = "cursor-agent" as const;
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

    const cliPath = (this.config.cliPath as string) || "cursor";
    const models = await new Promise<ModelInfo[]>((resolve) => {
      execFile(cliPath, ["agent", "models"], { timeout: 15_000 }, (err, stdout) => {
        if (err) {
          console.error(`[cursor-agent:${this.id}] Failed to list models:`, err.message);
          resolve([]);
          return;
        }
        resolve(parseModelsOutput(stdout));
      });
    });

    this.modelsCache = { models, time: now };
    return models;
  }

  async send(params: SendParams): Promise<SendResult> {
    if (this.status !== "running") {
      throw new Error(`Agent ${this.id} is not running`);
    }

    const cliPath = (this.config.cliPath as string) || "cursor";
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
      let resultText = "";
      let completed = false;

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
          failAndKill(`Cursor Agent idle timeout after ${idleTimeoutMs}ms`);
        }, idleTimeoutMs);
      };

      if (timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          failAndKill(`Cursor Agent timeout after ${timeoutMs}ms`);
        }, timeoutMs);
      }
      resetIdleTimeout();

      proc.stderr?.on("data", (data: Buffer) => {
        resetIdleTimeout();
        const text = data.toString().trim();
        if (text) console.error(`[cursor-agent:${this.id}] stderr:`, text);
      });

      const rl = createInterface({ input: proc.stdout! });

      rl.on("line", (line) => {
        resetIdleTimeout();
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }

        const type = event.type as string;

        // Extract session_id from any event
        if (event.session_id && !sessionId) {
          sessionId = event.session_id as string;
        }

        if (type === "assistant" && event.message) {
          const msg = event.message as Record<string, unknown>;
          const text = extractTextContent(msg.content);
          if (text) {
            accumulated += (accumulated ? "\n" : "") + text;
            params.onStream?.(text);
          }
          return;
        }

        if (type === "result") {
          if (completed) return;
          completed = true;
          clearTimers();

          if (event.session_id) sessionId = event.session_id as string;
          resultText = (event.result as string) ?? "";
          const isError = event.is_error === true;

          if (isError) {
            this.processes.delete(params.sessionId);
            reject(new Error(resultText || "Cursor Agent execution failed"));
            return;
          }

          this.processes.delete(params.sessionId);
          resolve({
            text: resultText || accumulated || "(No response)",
            agentSessionId: sessionId,
          });
        }
      });

      proc.on("close", (code) => {
        clearTimers();
        this.processes.delete(params.sessionId);
        if (completed) return;
        completed = true;

        if (code !== 0 && code !== null && !resultText && !accumulated) {
          reject(new Error(`Cursor Agent exited with code ${code}`));
          return;
        }
        resolve({
          text: resultText || accumulated || "(No response)",
          agentSessionId: sessionId,
        });
      });

      proc.on("error", (err) => {
        clearTimers();
        this.processes.delete(params.sessionId);
        if (!completed) {
          completed = true;
          reject(new Error(`Failed to start Cursor Agent CLI: ${err.message}`));
        }
      });
    });
  }
}
