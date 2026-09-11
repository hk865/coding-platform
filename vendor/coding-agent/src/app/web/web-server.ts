/** 本机 Web HTTP/SSE 入口：只提供同源页面、任务、审批和取消 API。 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { ZodError } from "zod";

import { WEB_PAGE } from "./web-page.js";
import {
  WebRunConflictError,
  WebRunManager,
  WebRunNotFoundError,
  type WebRunEvent,
} from "./web-run-manager.js";

export interface WebServerOptions {
  readonly host?: string;
  readonly port?: number;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage, limitBytes = 256 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    total += chunk.length;
    if (total > limitBytes) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function writeSse(response: ServerResponse, event: WebRunEvent): void {
  response.write(`id: ${String(event.sequence)}\n`);
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

function runRoute(pathname: string): { runId: string; suffix: string } | null {
  const match = /^\/api\/runs\/([^/]+)(.*)$/.exec(pathname);
  return match ? { runId: decodeURIComponent(match[1]!), suffix: match[2] || "" } : null;
}

export function createCodingAgentWebServer(manager = new WebRunManager()): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
        });
        response.end(WEB_PAGE);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/runs") {
        const snapshot = manager.start(await readJson(request));
        sendJson(response, 202, snapshot);
        return;
      }

      const route = runRoute(url.pathname);
      if (route && request.method === "GET" && route.suffix === "") {
        sendJson(response, 200, manager.snapshot(route.runId));
        return;
      }

      if (route && request.method === "GET" && route.suffix === "/events") {
        response.socket?.setNoDelay(true);
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
          "x-accel-buffering": "no",
          "content-encoding": "identity",
          "x-content-type-options": "nosniff",
        });
        response.flushHeaders();
        response.write(": connected\n\n");
        const unsubscribe = manager.subscribe(route.runId, (event) => writeSse(response, event));
        const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 15_000);
        keepAlive.unref?.();
        request.once("close", () => {
          clearInterval(keepAlive);
          unsubscribe();
        });
        return;
      }

      if (route && request.method === "POST" && route.suffix === "/cancel") {
        sendJson(response, 202, manager.cancel(route.runId));
        return;
      }

      const approvalMatch = route ? /^\/approvals\/([^/]+)$/.exec(route.suffix) : null;
      if (route && approvalMatch && request.method === "POST") {
        const body = await readJson(request);
        const decision =
          body && typeof body === "object" && "decision" in body
            ? (body as { decision?: unknown }).decision
            : undefined;
        if (decision !== "allow_once" && decision !== "allow_for_run" && decision !== "deny") {
          sendJson(response, 400, { error: "decision_invalid", message: "审批决定非法" });
          return;
        }
        const approvalId = decodeURIComponent(approvalMatch[1]!);
        sendJson(response, 200, manager.answerApproval(route.runId, approvalId, decision));
        return;
      }

      sendJson(response, 404, { error: "not_found", message: "接口不存在" });
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof ZodError) {
        sendJson(response, 400, {
          error: "invalid_request",
          message: error.issues[0]?.message ?? "请求参数非法",
        });
        return;
      }
      if (error instanceof WebRunConflictError) {
        sendJson(response, 409, { error: "run_conflict", message: error.message });
        return;
      }
      if (error instanceof WebRunNotFoundError) {
        sendJson(response, 404, { error: "run_not_found", message: error.message });
        return;
      }
      sendJson(response, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "Web UI 服务异常",
      });
    }
  });
}

export async function listenWebServer(
  server: Server,
  options: WebServerOptions = {},
): Promise<{ readonly host: string; readonly port: number; readonly url: string }> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4173;
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("Web UI 只允许监听本机回环地址");
  }
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Web UI 监听地址不可用");
  return { host, port: address.port, url: `http://${host}:${String(address.port)}` };
}
