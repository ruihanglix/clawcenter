import React from "react";
import { render } from "ink";
import { App } from "./App.js";
import type { ClawCenterServer } from "../server.js";

export function startTUI(opts: {
  mode: "center" | "worker";
  server: ClawCenterServer;
  port: number;
}): void {
  const element = React.createElement(App, {
    mode: opts.mode,
    server: opts.server,
    port: opts.port,
  });
  render(element);
}
