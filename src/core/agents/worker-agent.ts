import type { AgentAdapter, AgentConfig, ModelInfo, SendParams, SendResult } from "./adapter.js";

export type WorkerSendFn = (
  agentId: string,
  params: SendParams,
) => Promise<SendResult>;

/**
 * Proxy adapter for agents running on remote Worker nodes.
 * The actual work is delegated to the Worker via WebSocket.
 */
export class WorkerAgentAdapter implements AgentAdapter {
  readonly type = "worker" as const;
  readonly supportsModelSwitch = false;
  status: "running" | "stopped" | "error" = "stopped";
  private workerSend: WorkerSendFn | null = null;
  readonly nodeId: string;

  constructor(
    readonly id: string,
    readonly displayName: string,
    nodeId: string,
  ) {
    this.nodeId = nodeId;
  }

  setWorkerSend(fn: WorkerSendFn): void {
    this.workerSend = fn;
  }

  async start(_config: AgentConfig): Promise<void> {
    if (!this.workerSend) {
      throw new Error(`Worker agent ${this.id}: no worker connection`);
    }
    this.status = "running";
  }

  async stop(): Promise<void> {
    this.status = "stopped";
  }

  async send(params: SendParams): Promise<SendResult> {
    if (this.status !== "running" || !this.workerSend) {
      throw new Error(`Worker agent ${this.id} is not available`);
    }
    return this.workerSend(this.id, params);
  }

  getModel(): string | undefined { return undefined; }
  setModel(): void { /* not supported */ }
  async listModels(): Promise<ModelInfo[]> { return []; }
}
