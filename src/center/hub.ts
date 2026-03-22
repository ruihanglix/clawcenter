import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { AgentManager } from "../core/agents/manager.js";
import type { Store } from "../core/db/store.js";
import type { SendParams, SendResult } from "../core/agents/adapter.js";
import { EventEmitter } from "node:events";

interface WorkerConnection {
  ws: WebSocket;
  nodeId: string;
  address: string;
  agents: Map<string, { displayName: string; type: string; status: string }>;
  pendingTasks: Map<string, {
    resolve: (result: SendResult) => void;
    reject: (err: Error) => void;
    onStream?: (chunk: string) => void;
  }>;
}

export class WorkerHub extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private workers = new Map<string, WorkerConnection>();
  private agentManager: AgentManager;
  private store: Store;

  constructor(agentManager: AgentManager, store: Store) {
    super();
    this.agentManager = agentManager;
    this.store = store;
  }

  start(port: number, host: string = "0.0.0.0"): void {
    this.wss = new WebSocketServer({ port, host });
    console.log(`[WorkerHub] Listening on ${host}:${port}`);

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const address = req.socket.remoteAddress ?? "unknown";
      console.log(`[WorkerHub] New connection from ${address}`);
      this.handleConnection(ws, address);
    });

    this.wss.on("error", (err) => {
      console.error("[WorkerHub] Server error:", err);
    });
  }

  stop(): void {
    for (const [nodeId, worker] of this.workers) {
      worker.ws.close();
      this.agentManager.disconnectWorkerAgents(nodeId);
      this.store.updateWorkerNodeStatus(nodeId, "disconnected");
    }
    this.workers.clear();
    this.wss?.close();
  }

  private handleConnection(ws: WebSocket, address: string): void {
    let worker: WorkerConnection | null = null;

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(ws, msg, address, worker, (w) => { worker = w; });
      } catch (err) {
        console.error("[WorkerHub] Invalid message:", err);
      }
    });

    ws.on("close", () => {
      if (worker) {
        console.log(`[WorkerHub] Worker ${worker.nodeId} disconnected`);
        this.agentManager.disconnectWorkerAgents(worker.nodeId);
        this.store.updateWorkerNodeStatus(worker.nodeId, "disconnected");
        this.workers.delete(worker.nodeId);

        // Reject all pending tasks
        for (const [, task] of worker.pendingTasks) {
          task.reject(new Error("Worker disconnected"));
        }

        this.emit("worker:disconnected", worker.nodeId);
      }
    });

    ws.on("error", (err) => {
      console.error(`[WorkerHub] WebSocket error:`, err);
    });
  }

  private handleMessage(
    ws: WebSocket,
    msg: Record<string, unknown>,
    address: string,
    worker: WorkerConnection | null,
    setWorker: (w: WorkerConnection) => void,
  ): void {
    switch (msg.type) {
      case "register": {
        const nodeId = msg.nodeId as string;
        if (!nodeId) {
          ws.send(JSON.stringify({ type: "error", message: "Missing nodeId" }));
          return;
        }

        const existing = this.workers.get(nodeId);
        if (existing) {
          existing.ws.close();
          this.agentManager.disconnectWorkerAgents(nodeId);
        }

        const newWorker: WorkerConnection = {
          ws,
          nodeId,
          address,
          agents: new Map(),
          pendingTasks: new Map(),
        };
        this.workers.set(nodeId, newWorker);
        setWorker(newWorker);

        this.store.registerWorkerNode(nodeId, address);
        ws.send(JSON.stringify({ type: "registered", nodeId }));
        console.log(`[WorkerHub] Worker registered: ${nodeId} (${address})`);
        this.emit("worker:connected", nodeId);
        break;
      }

      case "sync": {
        if (!worker) return;
        const agents = msg.agents as Array<{ id: string; displayName: string; type: string; status: string }>;
        if (!agents) return;

        // Clear existing worker agents
        this.agentManager.removeWorkerAgents(worker.nodeId);
        worker.agents.clear();

        for (const agent of agents) {
          worker.agents.set(agent.id, {
            displayName: agent.displayName,
            type: agent.type,
            status: agent.status,
          });

          if (agent.status === "running") {
            this.agentManager.registerWorkerAgent(
              agent.id,
              agent.displayName,
              worker.nodeId,
              (agentId, params) => this.sendTaskToWorker(worker!, agentId, params),
            );
          }
        }

        console.log(`[WorkerHub] Synced ${agents.length} agents from ${worker.nodeId}`);
        this.emit("worker:synced", worker.nodeId);
        break;
      }

      case "agent-added":
      case "agent-update": {
        if (!worker) return;
        const agent = msg.agent as { id: string; displayName: string; type: string; status: string };
        if (!agent) return;

        worker.agents.set(agent.id, {
          displayName: agent.displayName,
          type: agent.type,
          status: agent.status,
        });

        if (agent.status === "running") {
          this.agentManager.registerWorkerAgent(
            agent.id,
            agent.displayName,
            worker.nodeId,
            (agentId, params) => this.sendTaskToWorker(worker!, agentId, params),
          );
        } else {
          const adapter = this.agentManager.getAdapter(agent.id);
          if (adapter) adapter.status = agent.status as "running" | "stopped" | "error";
        }
        break;
      }

      case "agent-removed": {
        if (!worker) return;
        const agentId = msg.agentId as string;
        worker.agents.delete(agentId);
        try {
          this.agentManager.removeAgent(agentId).catch(() => {});
        } catch { /* ignore */ }
        break;
      }

      case "stream": {
        if (!worker) return;
        const taskId = msg.taskId as string;
        const chunk = msg.chunk as string;
        const task = worker.pendingTasks.get(taskId);
        task?.onStream?.(chunk);
        break;
      }

      case "result": {
        if (!worker) return;
        const taskId = msg.taskId as string;
        const task = worker.pendingTasks.get(taskId);
        if (task) {
          worker.pendingTasks.delete(taskId);
          task.resolve({
            text: msg.text as string ?? "",
            agentSessionId: msg.agentSessionId as string | undefined,
            mediaUrls: msg.mediaUrls as string[] | undefined,
          });
        }
        break;
      }

      case "task-error": {
        if (!worker) return;
        const taskId = msg.taskId as string;
        const task = worker.pendingTasks.get(taskId);
        if (task) {
          worker.pendingTasks.delete(taskId);
          task.reject(new Error(msg.error as string ?? "Unknown error"));
        }
        break;
      }
    }
  }

  private sendTaskToWorker(worker: WorkerConnection, agentId: string, params: SendParams): Promise<SendResult> {
    return new Promise((resolve, reject) => {
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      worker.pendingTasks.set(taskId, {
        resolve,
        reject,
        onStream: params.onStream,
      });

      const timeout = setTimeout(() => {
        worker.pendingTasks.delete(taskId);
        reject(new Error("Task timeout (5 minutes)"));
      }, 5 * 60_000);

      const origResolve = resolve;
      const origReject = reject;
      worker.pendingTasks.set(taskId, {
        resolve: (result) => { clearTimeout(timeout); origResolve(result); },
        reject: (err) => { clearTimeout(timeout); origReject(err); },
        onStream: params.onStream,
      });

      worker.ws.send(JSON.stringify({
        type: "task",
        taskId,
        agentId,
        sessionId: params.sessionId,
        agentSessionId: params.agentSessionId,
        message: params.message,
        mediaPath: params.mediaPath,
      }));
    });
  }
}
