import { Command } from "commander";
import { startServer, type ServerOptions } from "./server.js";
import { setDebug } from "./logger.js";

const program = new Command();

program
  .name("clawcenter")
  .description("Central router bridging multiple WeChat accounts to multiple AI agents")
  .version("0.1.0");

program
  .command("start")
  .description("Start ClawCenter server")
  .option("--worker", "Run in worker mode (connect to a center)")
  .option("--center <url>", "Center WebSocket URL (worker mode)")
  .option("--node-id <id>", "Worker node ID")
  .option("--port <port>", "Web UI port", parseInt)
  .option("--host <host>", "Web UI host")
  .option("--worker-port <port>", "Worker hub port (center mode)", parseInt)
  .option("--data-dir <path>", "Data directory")
  .option("--no-tui", "Disable TUI")
  .option("--debug", "Enable debug logging (verbose HTTP requests, WeChat API calls, etc.)")
  .action(async (options) => {
    if (options.debug) {
      setDebug(true);
    }

    const serverOpts: ServerOptions = {
      mode: options.worker ? "worker" : "center",
      dataDir: options.dataDir,
      webPort: options.port,
      webHost: options.host,
      workerPort: options.workerPort,
      workerHost: options.workerHost,
      centerUrl: options.center,
      nodeId: options.nodeId,
      debug: !!options.debug,
    };

    const server = await startServer(serverOpts);

    const actualPort = server.store.getSetting(
      serverOpts.mode === "worker" ? "worker_web_port" : "web_port",
    ) ?? (serverOpts.mode === "worker" ? "9802" : "9800");

    if (options.tui !== false) {
      try {
        const { startTUI } = await import("./tui/index.js");
        startTUI({
          mode: serverOpts.mode,
          server,
          port: parseInt(actualPort, 10),
        });
      } catch (err) {
        console.error("[ClawCenter] TUI unavailable:", (err as Error).message);
        console.log(`[ClawCenter] Running in background. Web UI: http://localhost:${actualPort}`);
      }
    } else {
      console.log(`\n🐾 ClawCenter ${serverOpts.mode === "worker" ? "Worker" : ""} started`);
      console.log(`   Web UI: http://localhost:${actualPort}`);
      if (serverOpts.mode === "center") {
        const workerPort = server.store.getSetting("worker_port") ?? "9801";
        console.log(`   Worker hub: ws://0.0.0.0:${workerPort}`);
      }
      console.log(`\n   Press Ctrl+C to stop\n`);
    }

    // Graceful shutdown
    const shutdown = async () => {
      await server.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

program.parse();
