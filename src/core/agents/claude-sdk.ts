import type { AgentAdapter, AgentConfig, ModelInfo, SendParams, SendResult } from "./adapter.js";

const CLAUDE_MODELS: ModelInfo[] = [
  { id: "sonnet", provider: "anthropic" },
  { id: "haiku", provider: "anthropic" },
  { id: "opus", provider: "anthropic" },
];

export class ClaudeSDKAdapter implements AgentAdapter {
  readonly type = "claude-sdk" as const;
  readonly supportsModelSwitch = true;
  status: "running" | "stopped" | "error" = "stopped";
  private config: AgentConfig = {};

  constructor(
    readonly id: string,
    readonly displayName: string,
  ) {}

  async start(config: AgentConfig): Promise<void> {
    this.config = config;
    this.status = "running";
  }

  async stop(): Promise<void> {
    this.status = "stopped";
  }

  getModel(): string | undefined {
    return (this.config.model as string | undefined) ?? "sonnet";
  }

  setModel(model: string): void {
    this.config.model = model;
  }

  async listModels(): Promise<ModelInfo[]> {
    return CLAUDE_MODELS;
  }

  async send(params: SendParams): Promise<SendResult> {
    if (this.status !== "running") {
      throw new Error(`Agent ${this.id} is not running`);
    }

    try {
      const { query } = await import("@anthropic-ai/claude-agent-sdk");

      async function* messages() {
        yield {
          type: "user" as const,
          session_id: params.agentSessionId ?? "",
          parent_tool_use_id: null,
          message: { role: "user" as const, content: params.message },
        };
      }

      let result = "";
      let sessionId: string | undefined;

      for await (const msg of query({
        prompt: messages(),
        options: {
          model: (this.config.model as string) ?? "sonnet",
          baseTools: [{ preset: "default" }],
          deniedTools: ["AskUserQuestion"],
          cwd: this.config.cwd ?? process.cwd(),
          env: { ...process.env, ...(this.config.env ?? {}) },
          abortController: new AbortController(),
        },
      })) {
        if (msg.type === "assistant" && typeof msg.message === "object") {
          const content = (msg.message as { content?: Array<{ type: string; text?: string }> }).content;
          if (content) {
            for (const block of content) {
              if (block.type === "text" && block.text) {
                params.onStream?.(block.text);
              }
            }
          }
        }
        if (msg.type === "result") {
          result = (msg as { result?: string }).result ?? "";
          sessionId = (msg as { session_id?: string }).session_id;
        }
      }

      return {
        text: result || "(No response)",
        agentSessionId: sessionId,
      };
    } catch (err) {
      throw new Error(`Claude SDK error: ${(err as Error).message}`);
    }
  }
}
