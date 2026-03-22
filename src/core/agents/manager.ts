import type { AgentAdapter, AgentConfig, AgentType, ModelInfo, SendParams, SendResult } from "./adapter.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { ClaudeSDKAdapter } from "./claude-sdk.js";
import { OpenCodeAdapter } from "./opencode.js";
import { OpenClawAdapter } from "./openclaw.js";
import { CodexAdapter } from "./codex.js";
import { CodeBuddyAdapter } from "./codebuddy.js";
import { CursorAgentAdapter } from "./cursor-agent.js";
import { HttpAgentAdapter } from "./http-agent.js";
import { WorkerAgentAdapter, type WorkerSendFn } from "./worker-agent.js";
import type { Store } from "../db/store.js";
import { EventEmitter } from "node:events";

export interface AgentManagerEvents {
  "agent:started": (agentId: string) => void;
  "agent:stopped": (agentId: string) => void;
  "agent:error": (agentId: string, error: Error) => void;
  "agent:added": (agentId: string) => void;
  "agent:removed": (agentId: string) => void;
}

export class AgentManager extends EventEmitter {
  private adapters = new Map<string, AgentAdapter>();
  private store: Store;

  constructor(store: Store) {
    super();
    this.store = store;
  }

  private createAdapter(id: string, displayName: string, type: AgentType, nodeId?: string): AgentAdapter {
    switch (type) {
      case "claude-code":
        return new ClaudeCodeAdapter(id, displayName);
      case "claude-sdk":
        return new ClaudeSDKAdapter(id, displayName);
      case "opencode":
        return new OpenCodeAdapter(id, displayName);
      case "openclaw":
        return new OpenClawAdapter(id, displayName);
      case "codex":
        return new CodexAdapter(id, displayName);
      case "codebuddy":
        return new CodeBuddyAdapter(id, displayName);
      case "cursor-agent":
        return new CursorAgentAdapter(id, displayName);
      case "http":
        return new HttpAgentAdapter(id, displayName);
      case "worker":
        return new WorkerAgentAdapter(id, displayName, nodeId ?? "unknown");
      default:
        throw new Error(`Unknown agent type: ${type}`);
    }
  }

  async addAgent(data: {
    id: string;
    displayName: string;
    type: AgentType;
    config?: AgentConfig;
    nodeId?: string;
    autoStart?: boolean;
  }): Promise<AgentAdapter> {
    if (this.adapters.has(data.id)) {
      throw new Error(`Agent "${data.id}" already exists`);
    }

    this.store.createAgent({
      id: data.id,
      display_name: data.displayName,
      type: data.type,
      config: data.config,
      node_id: data.nodeId,
    });

    const adapter = this.createAdapter(data.id, data.displayName, data.type, data.nodeId);
    this.adapters.set(data.id, adapter);
    this.emit("agent:added", data.id);

    if (data.autoStart !== false) {
      await this.startAgent(data.id);
    }

    return adapter;
  }

  async removeAgent(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter && adapter.status === "running") {
      await adapter.stop();
    }
    this.adapters.delete(id);
    this.store.deleteAgent(id);
    this.store.deleteSessionsByAgent(id);
    this.emit("agent:removed", id);
  }

  async startAgent(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      // Try to load from DB
      const agentData = this.store.getAgent(id);
      if (!agentData) throw new Error(`Agent "${id}" not found`);
      const newAdapter = this.createAdapter(id, agentData.display_name, agentData.type as AgentType, agentData.node_id);
      this.adapters.set(id, newAdapter);
      try {
        await newAdapter.start(agentData.config as AgentConfig);
        this.store.updateAgent(id, { status: "running" });
        this.emit("agent:started", id);
      } catch (err) {
        newAdapter.status = "error";
        this.store.updateAgent(id, { status: "error" });
        this.emit("agent:error", id, err as Error);
        throw err;
      }
      return;
    }

    if (adapter.status === "running") return;

    const agentData = this.store.getAgent(id);
    try {
      await adapter.start((agentData?.config ?? {}) as AgentConfig);
      this.store.updateAgent(id, { status: "running" });
      this.emit("agent:started", id);
    } catch (err) {
      adapter.status = "error";
      this.store.updateAgent(id, { status: "error" });
      this.emit("agent:error", id, err as Error);
      throw err;
    }
  }

  async stopAgent(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Agent "${id}" not found`);
    if (adapter.status !== "running") return;

    await adapter.stop();
    this.store.updateAgent(id, { status: "stopped" });
    this.emit("agent:stopped", id);
  }

  async sendToAgent(id: string, params: SendParams): Promise<SendResult> {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Agent "${id}" not found`);
    if (adapter.status !== "running") throw new Error(`Agent "${id}" is not running`);

    return adapter.send(params);
  }

  setAgentModel(id: string, model: string): void {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Agent "${id}" not found`);
    if (!adapter.supportsModelSwitch) throw new Error(`Agent "${id}" (${adapter.type}) does not support model switching`);

    adapter.setModel(model);

    const agentData = this.store.getAgent(id);
    if (agentData) {
      const config = (agentData.config ?? {}) as AgentConfig;
      config.model = model;
      this.store.updateAgent(id, { config });
    }
  }

  getAgentModel(id: string): string | undefined {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Agent "${id}" not found`);
    return adapter.getModel();
  }

  async listAgentModels(id: string, provider?: string): Promise<ModelInfo[]> {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Agent "${id}" not found`);
    if (!adapter.supportsModelSwitch) throw new Error(`Agent "${id}" (${adapter.type}) does not support model switching`);
    return adapter.listModels(provider);
  }

  getAdapter(id: string): AgentAdapter | undefined {
    return this.adapters.get(id);
  }

  listAdapters(): AgentAdapter[] {
    return Array.from(this.adapters.values());
  }

  getRunningAgentIds(): string[] {
    return Array.from(this.adapters.entries())
      .filter(([, a]) => a.status === "running")
      .map(([id]) => id);
  }

  /** Register a worker-based agent (called when a Worker connects) */
  registerWorkerAgent(
    id: string,
    displayName: string,
    nodeId: string,
    workerSend: WorkerSendFn,
  ): WorkerAgentAdapter {
    let adapter = this.adapters.get(id);
    if (adapter && !(adapter instanceof WorkerAgentAdapter)) {
      throw new Error(`Agent "${id}" already exists as a non-worker agent`);
    }

    if (!adapter) {
      adapter = new WorkerAgentAdapter(id, displayName, nodeId);
      this.adapters.set(id, adapter);
      this.store.createAgent({
        id,
        display_name: displayName,
        type: "worker",
        node_id: nodeId,
      });
    }

    const workerAdapter = adapter as WorkerAgentAdapter;
    workerAdapter.setWorkerSend(workerSend);
    workerAdapter.status = "running";
    this.store.updateAgent(id, { status: "running", node_id: nodeId });
    this.emit("agent:added", id);
    return workerAdapter;
  }

  /** Mark all agents from a worker as disconnected */
  disconnectWorkerAgents(nodeId: string): void {
    for (const [id, adapter] of this.adapters.entries()) {
      if (adapter instanceof WorkerAgentAdapter && adapter.nodeId === nodeId) {
        adapter.status = "stopped";
        this.store.updateAgent(id, { status: "stopped" });
        this.emit("agent:stopped", id);
      }
    }
  }

  /** Remove all agents from a worker */
  removeWorkerAgents(nodeId: string): void {
    const toRemove: string[] = [];
    for (const [id, adapter] of this.adapters.entries()) {
      if (adapter instanceof WorkerAgentAdapter && adapter.nodeId === nodeId) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.adapters.delete(id);
      this.store.deleteAgent(id);
      this.emit("agent:removed", id);
    }
  }

  /** Load all agents from DB and start them */
  async loadAndStartAll(): Promise<void> {
    const agents = this.store.listAgents();
    for (const agent of agents) {
      if (agent.type === "worker") continue; // Workers register themselves
      try {
        const adapter = this.createAdapter(agent.id, agent.display_name, agent.type as AgentType, agent.node_id);
        this.adapters.set(agent.id, adapter);
        await adapter.start(agent.config as AgentConfig);
        this.store.updateAgent(agent.id, { status: "running" });
        console.log(`[AgentManager] Started agent: ${agent.id} (${agent.type})`);
      } catch (err) {
        console.error(`[AgentManager] Failed to start agent ${agent.id}:`, (err as Error).message);
        this.store.updateAgent(agent.id, { status: "error" });
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const [id, adapter] of this.adapters.entries()) {
      if (adapter.status === "running") {
        try {
          await adapter.stop();
          this.store.updateAgent(id, { status: "stopped" });
        } catch (err) {
          console.error(`[AgentManager] Error stopping agent ${id}:`, (err as Error).message);
        }
      }
    }
  }
}
