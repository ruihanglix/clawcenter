import { spawn, execFile, type ChildProcess } from "node:child_process";
import type { AgentAdapter, AgentConfig, ModelInfo, SendParams, SendResult } from "./adapter.js";

const MODELS_CACHE_TTL = 60_000;

export class OpenCodeAdapter implements AgentAdapter {
  readonly type = "opencode" as const;
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

    const opencodePath = (this.config.opencodePath as string | undefined) ?? "opencode";
    const args = ["models"];
    if (provider) args.push(provider);

    const models = await new Promise<ModelInfo[]>((resolve) => {
      execFile(opencodePath, args, {
        timeout: 15_000,
        env: { ...process.env, TERM: "dumb" },
      }, (err, stdout) => {
        if (err) {
          console.error(`[opencode:${this.id}] Failed to list models:`, err.message);
          resolve([]);
          return;
        }
        const lines = stdout.trim().split("\n").map((l) => l.trim()).filter(Boolean);
        resolve(lines.map((line) => {
          const slashIdx = line.indexOf("/");
          return {
            id: line,
            provider: slashIdx !== -1 ? line.substring(0, slashIdx) : "default",
          };
        }));
      });
    });

    this.modelsCache = { key: cacheKey, models, time: now };
    return models;
  }

  async send(params: SendParams): Promise<SendResult> {
    if (this.status !== "running") {
      throw new Error(`Agent ${this.id} is not running`);
    }

    const args = ["run", "--format", "json"];
    if (params.agentSessionId) {
      args.push("--session", params.agentSessionId);
    }

    const model = this.config.model as string | undefined;
    if (model) {
      args.push("-m", model);
    }

    args.push("--", params.message);

    const env: Record<string, string> = { TERM: "dumb" };
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    for (const [k, v] of Object.entries(this.config.env ?? {})) {
      env[k] = v as string;
    }

    return new Promise<SendResult>((resolve, reject) => {
      const opencodePath = this.config.opencodePath as string | undefined ?? "opencode";
      const proc = spawn(opencodePath, args, {
        cwd: this.config.cwd ?? process.cwd(),
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.processes.set(params.sessionId, proc);

      let sessionId: string | undefined;
      const chunks: string[] = [];
      let lastResult = "";
      let lineBuffer = "";

      proc.stdout?.on("data", (data: Buffer) => {
        lineBuffer += data.toString();
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.sessionID || event.sessionId || event.session_id) {
              sessionId = event.sessionID ?? event.sessionId ?? event.session_id;
            }

            if (event.type === "text" && event.part?.text) {
              chunks.push(event.part.text);
              params.onStream?.(event.part.text);
            } else if (event.type === "text" || event.type === "content") {
              const text = event.text ?? event.content ?? "";
              if (text) {
                chunks.push(text);
                params.onStream?.(text);
              }
            }
            if (event.type === "result" || event.type === "finish") {
              lastResult = event.result ?? event.text ?? "";
            }
          } catch {
            if (line.trim()) {
              chunks.push(line.trim());
              params.onStream?.(line.trim());
            }
          }
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) console.error(`[opencode:${this.id}] stderr:`, text);
      });

      proc.on("error", (err) => {
        this.processes.delete(params.sessionId);
        reject(new Error(`OpenCode process error: ${err.message}`));
      });

      proc.on("close", (code) => {
        this.processes.delete(params.sessionId);

        if (lineBuffer.trim()) {
          try {
            const event = JSON.parse(lineBuffer);
            if (event.sessionID || event.sessionId || event.session_id) {
              sessionId = event.sessionID ?? event.sessionId ?? event.session_id;
            }
            if (event.type === "text" && event.part?.text) {
              chunks.push(event.part.text);
            } else if (event.type === "text" || event.type === "content") {
              const text = event.text ?? event.content ?? "";
              if (text) chunks.push(text);
            }
          } catch { /* ignore */ }
        }

        if (code !== 0 && chunks.length === 0 && !lastResult) {
          reject(new Error(`OpenCode exited with code ${code}`));
          return;
        }
        resolve({
          text: lastResult || chunks.join("\n") || "(No response)",
          agentSessionId: sessionId,
        });
      });
    });
  }
}
