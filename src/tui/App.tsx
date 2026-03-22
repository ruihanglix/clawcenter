import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import type { ClawCenterServer } from "../server.js";
import type { LogEntry } from "../center/dispatcher.js";
import { isDebug, setDebug } from "../logger.js";

const h = React.createElement;

interface AppProps {
  mode: "center" | "worker";
  server: ClawCenterServer;
  port: number;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const hr = Math.floor(m / 60);
  return `${hr}h${m % 60}m`;
}

function LogLine({ entry }: { entry: LogEntry }) {
  const time = formatTime(entry.time);
  const agentTag = entry.agentId ? `[${entry.agentId}]` : "";

  switch (entry.type) {
    case "inbound":
      return h(Text, { wrap: "truncate" },
        h(Text, { dimColor: true }, time, " "),
        h(Text, { color: "cyan" }, "📩 ", entry.userId?.slice(0, 12) ?? "", ": ", entry.text.slice(0, 100)),
      );
    case "outbound":
      return h(Text, { wrap: "truncate" },
        h(Text, { dimColor: true }, time, " "),
        h(Text, { color: "green" }, "✅ ", agentTag, " → ", entry.text.slice(0, 100)),
      );
    case "thinking":
      return h(Text, { wrap: "truncate" },
        h(Text, { dimColor: true }, time, " "),
        h(Text, { color: "gray" }, "🤔 ", entry.text),
      );
    case "system":
      return h(Text, { wrap: "truncate" },
        h(Text, { dimColor: true }, time, " "),
        h(Text, { color: "blue" }, "💬 ", entry.text.slice(0, 100)),
      );
    case "error":
      return h(Text, { wrap: "truncate" },
        h(Text, { dimColor: true }, time, " "),
        h(Text, { color: "red" }, "❌ ", agentTag, " ", entry.text),
      );
    case "info":
    default:
      return h(Text, { wrap: "truncate" },
        h(Text, { dimColor: true }, time, " "),
        h(Text, { color: "yellow" }, entry.text),
      );
  }
}

export function App({ mode, server, port }: AppProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [startTime] = useState(Date.now());
  const [, forceUpdate] = useState(0);
  const { isRawModeSupported } = useStdin();

  useEffect(() => {
    const handler = (entry: LogEntry) => {
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.length > 200 ? next.slice(-200) : next;
      });
    };
    server.dispatcher?.on("log", handler);

    // Periodic refresh for uptime
    const interval = setInterval(() => forceUpdate((n) => n + 1), 10_000);

    return () => {
      server.dispatcher?.off("log", handler);
      clearInterval(interval);
    };
  }, [server]);

  const handleQuit = useCallback(() => {
    server.stop().then(() => process.exit(0));
  }, [server]);

  const [debugMode, setDebugMode] = useState(isDebug());

  useInput((input) => {
    if (input === "q" || input === "Q") handleQuit();
    if (input === "w" || input === "W") {
      console.log(`\nOpening http://localhost:${port}`);
    }
    if (input === "d" || input === "D") {
      const newState = !debugMode;
      setDebug(newState);
      setDebugMode(newState);
    }
  }, { isActive: isRawModeSupported });

  // Build status line
  const accounts = server.store.listWechatAccounts();
  const agents = server.store.listAgents();
  const accountStatus = accounts.map((a) => {
    const conn = server.dispatcher?.getConnector(a.id);
    const icon = conn?.isRunning ? "🟢" : "🔴";
    return `${icon}${a.name}`;
  }).join(" ");

  const agentStatus = agents.map((a) => {
    const adapter = server.agentManager.getAdapter(a.id);
    const icon = adapter?.status === "running" ? "🟢" : adapter?.status === "error" ? "🔴" : "⚪";
    return `${icon}${a.id}`;
  }).join(" | ");

  const modeLabel = mode === "center" ? "Center" : "Worker";
  const elapsed = formatElapsed(Date.now() - startTime);
  const visibleLogs = logs.slice(-14);
  const maxLines = 14;
  const padCount = Math.max(0, maxLines - visibleLogs.length);

  return h(Box, { flexDirection: "column", width: "100%" },
    // Header
    h(Box, { borderStyle: "single", borderBottom: false, paddingX: 1, justifyContent: "space-between" },
      h(Text, { bold: true }, "🐾 ClawCenter ", modeLabel),
      h(Text, null, `Web: :${port}`),
      h(Text, { dimColor: true }, elapsed),
    ),
    // Status bar
    h(Box, { borderStyle: "single", borderTop: false, borderBottom: false, paddingX: 1, flexDirection: "column" },
      accounts.length > 0
        ? h(Text, null, "WeChat: ", accountStatus)
        : h(Text, { dimColor: true }, "WeChat: (none)"),
      agents.length > 0
        ? h(Text, null, "Agent: ", agentStatus)
        : h(Text, { dimColor: true }, "Agent: (none)"),
    ),
    // Log view
    h(Box, { borderStyle: "single", borderTop: false, borderBottom: false, flexDirection: "column", paddingX: 1 },
      ...visibleLogs.map((entry, i) =>
        h(LogLine, { key: `log-${i}`, entry }),
      ),
      ...Array.from({ length: padCount }, (_, i) =>
        h(Text, { key: `pad-${i}` }, " "),
      ),
    ),
    // Footer menu
    h(Box, { borderStyle: "single", borderTop: false, paddingX: 1, gap: 2 },
      h(Text, { bold: true }, "[W]eb UI"),
      h(Text, { bold: true, color: debugMode ? "green" : undefined }, `[D]ebug${debugMode ? " ON" : ""}`),
      h(Text, { bold: true }, "[Q]uit"),
    ),
  );
}
