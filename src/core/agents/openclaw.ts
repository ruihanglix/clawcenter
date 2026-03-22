import { spawn, execFile, type ChildProcess } from "node:child_process";
import type { AgentAdapter, AgentConfig, ModelInfo, SendParams, SendResult } from "./adapter.js";

const MODELS_CACHE_TTL = 60_000;

type OpenClawJsonResponse = {
  reply?: string;
  sessionId?: string;
  sessionKey?: string;
  mediaUrls?: string[];
};

/**
 * Extract the last valid JSON object from stdout, which may contain
 * plugin/bootstrap log lines before the actual JSON payload.
 * See: https://github.com/openclaw/openclaw/issues/37323
 */
function extractJson(stdout: string): OpenClawJsonResponse {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;
    try {
      return JSON.parse(trimmed) as OpenClawJsonResponse;
    } catch {
      continue;
    }
  }
  return {};
}

export class OpenClawAdapter implements AgentAdapter {
  readonly type = "openclaw" as const;
  readonly supportsModelSwitch = true;
  status: "running" | "stopped" | "error" = "stopped";
  private config: AgentConfig = {};
  private processes = new Map<string, ChildProcess>();
  private modelsCache: { key: string; models: ModelInfo[]; time: number } | null = null;

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

  async listModels(provider?: string): Promise<ModelInfo[]> {
    const cacheKey = provider ?? "__all__";
    const now = Date.now();
    if (this.modelsCache && this.modelsCache.key === cacheKey && now - this.modelsCache.time < MODELS_CACHE_TTL) {
      return this.modelsCache.models;
    }

    const cliPath = (this.config.cliPath as string | undefined) ?? "openclaw";
    const args = ["models", "list", "--json"];

    const models = await new Promise<ModelInfo[]>((resolve) => {
      execFile(cliPath, args, {
        timeout: 15_000,
        env: { ...process.env, TERM: "dumb", NO_COLOR: "1" },
      }, (err, stdout) => {
        if (err) {
          console.error(`[openclaw:${this.id}] Failed to list models:`, err.message);
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          const list: ModelInfo[] = [];
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              const id = typeof item === "string" ? item : (item.id ?? item.name ?? String(item));
              const prov = typeof item === "object" && item.provider ? String(item.provider) : "default";
              if (!provider || prov === provider) {
                list.push({ id: String(id), provider: prov });
              }
            }
          }
          resolve(list);
        } catch {
          const lines = stdout.trim().split("\n").map((l) => l.trim()).filter(Boolean);
          resolve(lines.map((line) => {
            const slashIdx = line.indexOf("/");
            return {
              id: line,
              provider: slashIdx !== -1 ? line.substring(0, slashIdx) : "default",
            };
          }));
        }
      });
    });

    this.modelsCache = { key: cacheKey, models, time: now };
    return models;
  }

  async send(params: SendParams): Promise<SendResult> {
    if (this.status !== "running") {
      throw new Error(`Agent ${this.id} is not running`);
    }

    const cliPath = (this.config.cliPath as string | undefined) ?? "openclaw";

    const args = ["agent", "--message", params.message, "--json"];

    if (params.agentSessionId) {
      args.push("--session-id", params.agentSessionId);
    }

    const thinking = this.config.thinking as string | undefined;
    if (thinking) {
      args.push("--thinking", thinking);
    }

    const model = this.config.model as string | undefined;
    if (model) {
      args.push("--model", model);
    }

    const timeout = this.config.timeout as number | undefined;
    if (timeout && timeout > 0) {
      args.push("--timeout", String(timeout));
    }

    if (params.mediaPath) {
      args.push("--media", params.mediaPath);
    }

    const env: Record<string, string> = { TERM: "dumb", NO_COLOR: "1" };
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    for (const [k, v] of Object.entries(this.config.env ?? {})) {
      env[k] = v as string;
    }

    return new Promise<SendResult>((resolve, reject) => {
      const proc = spawn(cliPath, args, {
        cwd: this.config.cwd ?? process.cwd(),
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.processes.set(params.sessionId, proc);

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("error", (err) => {
        this.processes.delete(params.sessionId);
        reject(new Error(`OpenClaw process error: ${err.message}`));
      });

      proc.on("close", (code) => {
        this.processes.delete(params.sessionId);

        if (stderr.trim()) {
          console.error(`[openclaw:${this.id}] stderr:`, stderr.trim().slice(0, 2048));
        }

        if (code !== 0 && !stdout.trim()) {
          reject(new Error(stderr.trim() || `OpenClaw exited with code ${code}`));
          return;
        }

        const json = extractJson(stdout);
        const text = json.reply ?? stdout.trim();

        params.onStream?.(text);

        resolve({
          text: text || "(No response)",
          agentSessionId: json.sessionId ?? json.sessionKey,
          mediaUrls: json.mediaUrls,
        });
      });
    });
  }
}
