export type AgentType = "claude-code" | "claude-sdk" | "opencode" | "openclaw" | "codex" | "codebuddy" | "cursor-agent" | "http" | "worker";

export interface AgentConfig {
  cwd?: string;
  model?: string;
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  permissionMode?: string;
  [key: string]: unknown;
}

export interface SendParams {
  sessionId: string;
  agentSessionId?: string;
  message: string;
  mediaPath?: string;
  onStream?: (chunk: string) => void;
}

export interface SendResult {
  text: string;
  agentSessionId?: string;
  mediaUrls?: string[];
}

export interface ModelInfo {
  id: string;
  provider: string;
}

export interface AgentAdapter {
  readonly id: string;
  readonly type: AgentType;
  readonly displayName: string;
  status: "running" | "stopped" | "error";
  readonly supportsModelSwitch: boolean;

  start(config: AgentConfig): Promise<void>;
  stop(): Promise<void>;
  send(params: SendParams): Promise<SendResult>;
  getModel(): string | undefined;
  setModel(model: string): void;
  listModels(provider?: string): Promise<ModelInfo[]>;
}

export interface AgentAdapterFactory {
  create(id: string, displayName: string): AgentAdapter;
}
