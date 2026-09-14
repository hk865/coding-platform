#!/usr/bin/env node
import { access } from "node:fs/promises";
import path from "node:path";

import { createCodingAgentWebServer, listenWebServer } from "./web-server.js";

const configuredPort = Number(process.env["CODING_AGENT_WEB_PORT"] ?? "4173");
if (!Number.isSafeInteger(configuredPort) || configuredPort < 0 || configuredPort > 65_535) {
  throw new Error("CODING_AGENT_WEB_PORT 必须是有效端口");
}

if (!process.env["CODING_AGENT_BWRAP_PATH"]) {
  const bundledBwrap = path.resolve(".tooling", "bwrap", "usr", "bin", "bwrap");
  try {
    await access(bundledBwrap);
    process.env["CODING_AGENT_BWRAP_PATH"] = bundledBwrap;
  } catch {
    // shell 工具会按现有安全策略 fail closed；read/edit 仍可使用。
  }
}

const server = createCodingAgentWebServer();
const listener = await listenWebServer(server, { port: configuredPort });
process.stdout.write(`Coding Agent Web UI: ${listener.url}\n`);
