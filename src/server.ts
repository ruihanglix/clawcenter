import path from "node:path";
import os from "node:os";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { Store } from "./core/db/store.js";
import { AgentManager } from "./core/agents/manager.js";
import { registerApiRoutes } from "./core/api/routes.js";
import { Dispatcher } from "./center/dispatcher.js";
import { WorkerHub } from "./center/hub.js";
import { WorkerClient } from "./worker/client.js";
import type { LogEntry } from "./center/dispatcher.js";
import { fileURLToPath } from "node:url";
import { debug, isDebug } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServerOptions {
  mode: "center" | "worker";
  dataDir?: string;
  webPort?: number;
  webHost?: string;
  workerPort?: number;
  workerHost?: string;
  centerUrl?: string;
  nodeId?: string;
  debug?: boolean;
}

export interface ClawCenterServer {
  store: Store;
  agentManager: AgentManager;
  dispatcher?: Dispatcher;
  workerHub?: WorkerHub;
  workerClient?: WorkerClient;
  logs: LogEntry[];
  stop: () => Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<ClawCenterServer> {
  const dataDir = opts.dataDir ?? path.join(os.homedir(), ".clawcenter");
  const dbPath = path.join(dataDir, "clawcenter.db");

  // Initialize store
  const store = new Store(dbPath);
  await store.initialize();
  console.log(`[ClawCenter] Database: ${dbPath}`);

  // Load settings
  const webPort = opts.webPort ?? parseInt(store.getSetting("web_port") ?? "9800", 10);
  const webHost = opts.webHost ?? store.getSetting(opts.mode === "worker" ? "worker_web_host" : "web_host") ?? "0.0.0.0";
  const workerPort = opts.workerPort ?? parseInt(store.getSetting("worker_port") ?? "9801", 10);
  const workerHost = opts.workerHost ?? store.getSetting("worker_host") ?? "0.0.0.0";

  // Agent manager
  const agentManager = new AgentManager(store);

  // Log buffer for TUI
  const logs: LogEntry[] = [];
  const maxLogs = 500;

  let dispatcher: Dispatcher | undefined;
  let workerHub: WorkerHub | undefined;
  let workerClient: WorkerClient | undefined;

  if (opts.mode === "center") {
    // ─── Center Mode ───
    dispatcher = new Dispatcher(store, agentManager);
    dispatcher.on("log", (entry: LogEntry) => {
      logs.push(entry);
      if (logs.length > maxLogs) logs.splice(0, logs.length - maxLogs);
    });

    workerHub = new WorkerHub(agentManager, store);
    workerHub.start(workerPort, workerHost);

    await agentManager.loadAndStartAll();
    await dispatcher.startAllConnectors();

    console.log(`[ClawCenter] Center mode started`);
  } else {
    // ─── Worker Mode ───
    if (!opts.centerUrl) {
      throw new Error("Worker mode requires --center <url>");
    }

    await agentManager.loadAndStartAll();

    workerClient = new WorkerClient({
      serverUrl: opts.centerUrl,
      nodeId: opts.nodeId,
      agentManager,
      store,
    });
    await workerClient.start();

    console.log(`[ClawCenter] Worker mode started, connecting to ${opts.centerUrl}`);
  }

  // ─── HTTP Server ───
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  if (opts.debug) {
    app.addHook("onRequest", async (req) => {
      debug("HTTP", `→ ${req.method} ${req.url}`);
    });
    app.addHook("onResponse", async (req, reply) => {
      debug("HTTP", `← ${req.method} ${req.url} ${reply.statusCode} (${reply.elapsedTime?.toFixed(0) ?? "?"}ms)`);
    });
    app.addHook("onError", async (req, _reply, err) => {
      debug("HTTP", `✗ ${req.method} ${req.url} Error: ${err.message}`);
    });
  }

  // API routes
  registerApiRoutes(app, store, agentManager, dispatcher);

  // SSE endpoint for real-time logs
  app.get("/api/events", async (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvent = (data: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial state
    sendEvent({ type: "init", mode: opts.mode, logs: logs.slice(-50) });

    // Subscribe to new logs
    const handler = (entry: LogEntry) => sendEvent({ type: "log", entry });
    dispatcher?.on("log", handler);

    // Agent status changes
    const agentHandler = (agentId: string) => {
      const agent = store.getAgent(agentId);
      const adapter = agentManager.getAdapter(agentId);
      sendEvent({ type: "agent-update", agent: { ...agent, runtimeStatus: adapter?.status } });
    };
    agentManager.on("agent:started", agentHandler);
    agentManager.on("agent:stopped", agentHandler);
    agentManager.on("agent:added", agentHandler);

    req.raw.on("close", () => {
      dispatcher?.off("log", handler);
      agentManager.off("agent:started", agentHandler);
      agentManager.off("agent:stopped", agentHandler);
      agentManager.off("agent:added", agentHandler);
    });
  });

  // Serve Web UI static files
  const webDistPath = path.join(__dirname, "..", "web", "dist");
  try {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: "/",
      wildcard: false,
    });
    // SPA fallback
    app.setNotFoundHandler(async (_req, reply) => {
      return reply.sendFile("index.html", webDistPath);
    });
  } catch {
    // Web UI not built yet, serve a placeholder
    app.get("/", async () => {
      return {
        name: "ClawCenter",
        mode: opts.mode,
        message: "Web UI not built. Run: npm run build:web",
        api: "/api",
      };
    });
  }

  const actualWebPort = opts.mode === "worker"
    ? (opts.webPort ?? parseInt(store.getSetting("worker_web_port") ?? "9802", 10))
    : webPort;

  await app.listen({ port: actualWebPort, host: webHost });
  console.log(`[ClawCenter] Web UI: http://${webHost === "0.0.0.0" ? "localhost" : webHost}:${actualWebPort}`);

  return {
    store,
    agentManager,
    dispatcher,
    workerHub,
    workerClient,
    logs,
    async stop() {
      console.log("[ClawCenter] Shutting down...");
      dispatcher?.stopAll();
      workerHub?.stop();
      workerClient?.stop();
      await agentManager.stopAll();
      await app.close();
      store.close();
    },
  };
}
