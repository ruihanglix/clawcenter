import WebSocket from "ws";
import { EventEmitter } from "node:events";
import type { AgentManager } from "../core/agents/manager.js";
import type { Store } from "../core/db/store.js";
import crypto from "node:crypto";

const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

export class WorkerClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private agentManager: AgentManager;
  private store: Store;
  private serverUrl: string;
  private nodeId: string;
  private running = false;
  private reconnectDelay = RECONNECT_DELAY_MS;

  constructor(opts: {
    serverUrl: string;
    nodeId?: string;
    agentManager: AgentManager;
    store: Store;
  }) {
    super();
    this.serverUrl = opts.serverUrl;
    this.nodeId = opts.nodeId ?? `worker-${crypto.randomBytes(3).toString("hex")}`;
    this.agentManager = opts.agentManager;
    this.store = opts.store;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get id(): string {
    return this.nodeId;
  }

  async start(): Promise<void> {
    this.running = true;
    this.connect();

    // Listen for agent changes and sync to center
    this.agentManager.on("agent:started", () => this.syncAgents());
    this.agentManager.on("agent:stopped", () => this.syncAgents());
    this.agentManager.on("agent:added", () => this.syncAgents());
    this.agentManager.on("agent:removed", () => this.syncAgents());
  }

  stop(): void {
    this.running = false;
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    if (!this.running) return;

    console.log(`[WorkerClient] Connecting to ${this.serverUrl}...`);
    this.ws = new WebSocket(this.serverUrl);

    this.ws.on("open", () => {
      console.log(`[WorkerClient] Connected to center`);
      this.reconnectDelay = RECONNECT_DELAY_MS;
      this.emit("connected");

      // Register
      this.send({ type: "register", nodeId: this.nodeId });

      // Sync agents
      this.syncAgents();
    });

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch (err) {
        console.error("[WorkerClient] Invalid message:", err);
      }
    });

    this.ws.on("close", () => {
      console.log(`[WorkerClient] Disconnected from center`);
      this.emit("disconnected");
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      console.error("[WorkerClient] Connection error:", err.message);
      this.emit("error", err);
    });
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    console.log(`[WorkerClient] Reconnecting in ${this.reconnectDelay / 1000}s...`);
    setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
      this.connect();
    }, this.reconnectDelay);
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private syncAgents(): void {
    const agents = this.store.listAgents().map((a) => ({
      id: a.id,
      displayName: a.display_name,
      type: a.type,
      status: this.agentManager.getAdapter(a.id)?.status ?? a.status,
    }));
    this.send({ type: "sync", agents });
  }

  private async handleMessage(msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case "registered":
        console.log(`[WorkerClient] Registered as ${msg.nodeId}`);
        break;

      case "task": {
        const taskId = msg.taskId as string;
        const agentId = msg.agentId as string;

        try {
          const result = await this.agentManager.sendToAgent(agentId, {
            sessionId: msg.sessionId as string,
            agentSessionId: msg.agentSessionId as string | undefined,
            message: msg.message as string,
            mediaPath: msg.mediaPath as string | undefined,
            onStream: (chunk) => {
              this.send({ type: "stream", taskId, chunk });
            },
          });

          this.send({
            type: "result",
            taskId,
            text: result.text,
            agentSessionId: result.agentSessionId,
            mediaUrls: result.mediaUrls,
          });
        } catch (err) {
          this.send({
            type: "task-error",
            taskId,
            error: (err as Error).message,
          });
        }
        break;
      }

      case "stop": {
        const agentId = msg.agentId as string;
        if (agentId) {
          await this.agentManager.stopAgent(agentId);
        }
        break;
      }
    }
  }
}
