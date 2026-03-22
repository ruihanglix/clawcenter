import type { AgentAdapter, AgentConfig, ModelInfo, SendParams, SendResult } from "./adapter.js";

export class HttpAgentAdapter implements AgentAdapter {
  readonly type = "http" as const;
  readonly supportsModelSwitch = false;
  status: "running" | "stopped" | "error" = "stopped";
  private config: AgentConfig = {};

  constructor(
    readonly id: string,
    readonly displayName: string,
  ) {}

  async start(config: AgentConfig): Promise<void> {
    if (!config.url) {
      throw new Error("HTTP agent requires a 'url' in config");
    }
    this.config = config;
    this.status = "running";
  }

  async stop(): Promise<void> {
    this.status = "stopped";
  }

  getModel(): string | undefined { return undefined; }
  setModel(): void { /* not supported */ }
  async listModels(): Promise<ModelInfo[]> { return []; }

  async send(params: SendParams): Promise<SendResult> {
    if (this.status !== "running") {
      throw new Error(`Agent ${this.id} is not running`);
    }

    const url = this.config.url as string;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.config.headers ?? {}),
    };

    const body = {
      message: params.message,
      session_id: params.agentSessionId ?? params.sessionId,
      media_path: params.mediaPath,
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP agent returned ${response.status}: ${await response.text()}`);
    }

    const contentType = response.headers.get("content-type") ?? "";

    // Support streaming (ndjson)
    if (contentType.includes("ndjson") || contentType.includes("stream")) {
      const chunks: string[] = [];
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              if (event.text || event.content) {
                const text = event.text ?? event.content;
                chunks.push(text);
                params.onStream?.(text);
              }
            } catch {
              chunks.push(line);
              params.onStream?.(line);
            }
          }
        }
      }

      return { text: chunks.join("\n") || "(No response)" };
    }

    // Standard JSON response
    const data = await response.json() as {
      text?: string;
      message?: string;
      response?: string;
      session_id?: string;
      media_urls?: string[];
    };

    return {
      text: data.text ?? data.message ?? data.response ?? "(No response)",
      agentSessionId: data.session_id,
      mediaUrls: data.media_urls,
    };
  }
}
