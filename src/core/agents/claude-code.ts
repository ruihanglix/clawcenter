import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentAdapter, AgentConfig, ModelInfo, SendParams, SendResult } from "./adapter.js";

function buildPermissionArgs(configMode?: string): string[] {
  const mode = configMode || process.env.CLAUDE_PERMISSION_MODE;
  if (mode && mode !== "dangerously-skip-permissions") {
    return ["--permission-mode", mode];
  }
  return ["--dangerously-skip-permissions"];
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block.type === "text" || typeof block === "string")
      .map((block: any) => (typeof block === "string" ? block : block.text))
      .join("\n");
  }
  if (content && typeof content === "object" && "text" in content) {
    return (content as any).text;
  }
  return null;
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly type = "claude-code" as const;
  readonly supportsModelSwitch = false;
  status: "running" | "stopped" | "error" = "stopped";
  private config: AgentConfig = {};
  private processes = new Map<string, ChildProcess>();
  private sessionMessageCount = new Map<string, number>();

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
    this.sessionMessageCount.clear();
    this.status = "stopped";
  }

  getModel(): string | undefined { return undefined; }
  setModel(): void { /* not supported */ }
  async listModels(): Promise<ModelInfo[]> { return []; }

  async send(params: SendParams): Promise<SendResult> {
    if (this.status !== "running") {
      throw new Error(`Agent ${this.id} is not running`);
    }

    const msgCount = this.sessionMessageCount.get(params.sessionId) ?? 0;
    this.sessionMessageCount.set(params.sessionId, msgCount + 1);
    const isFirstMessage = !params.agentSessionId;

    const args = [
      "--print",
      ...buildPermissionArgs(this.config.permissionMode as string | undefined),
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose",
    ];

    if (params.agentSessionId) {
      args.push("--resume", params.agentSessionId);
    }

    const env = { ...process.env, ...(this.config.env ?? {}) };
    delete (env as any).CLAUDECODE;

    return new Promise<SendResult>((resolve, reject) => {
      const proc = spawn("claude", args, {
        cwd: this.config.cwd ?? process.cwd(),
        shell: true,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.processes.set(params.sessionId, proc);

      let resultText = "";
      let sessionId: string | undefined;
      const chunks: string[] = [];

      const rl = createInterface({ input: proc.stdout! });

      rl.on("line", (line) => {
        try {
          const event = JSON.parse(line);

          if (event.type === "assistant" && event.message?.content) {
            const text = extractTextContent(event.message.content);
            if (text) {
              chunks.push(text);
              params.onStream?.(text);
            }
          }
          if (event.type === "result") {
            resultText = event.result ?? "";
            sessionId = event.session_id;
          }
          if (event.session_id && !sessionId) {
            sessionId = event.session_id;
          }
        } catch {
          // Non-JSON line, ignore
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) console.error(`[claude-code:${this.id}] stderr:`, text);
      });

      proc.on("error", (err) => {
        this.processes.delete(params.sessionId);
        reject(new Error(`Claude Code process error: ${err.message}`));
      });

      proc.on("close", (code) => {
        this.processes.delete(params.sessionId);
        if (code !== 0 && code !== null && !resultText && chunks.length === 0) {
          reject(new Error(`Claude Code exited with code ${code}`));
          return;
        }
        const finalText = resultText || chunks.join("\n");
        resolve({
          text: finalText || "(No response)",
          agentSessionId: sessionId,
        });
      });

      const input = JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: params.message,
        },
      });
      proc.stdin!.write(input + "\n");
      proc.stdin!.end();
    });
  }
}
