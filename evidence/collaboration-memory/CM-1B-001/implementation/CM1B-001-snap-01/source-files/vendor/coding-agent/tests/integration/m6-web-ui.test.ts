import type { Server } from "node:http";
import { Script } from "node:vm";

import { afterEach, describe, expect, it } from "vitest";

import { createCodingAgentWebServer, listenWebServer } from "../../src/app/web/web-server.js";
import { WebRunManager, type WebExecutor } from "../../src/app/web/web-run-manager.js";

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("本机 Web UI", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server?.listening) await close(server);
  });

  it("只在回环地址提供页面并通过 HTTP 创建任务", async () => {
    const executor: WebExecutor = async (request, callbacks) => {
      callbacks.onTextDelta("web-ok", "request-http-1");
      return { sessionId: request.sessionId, status: "completed" };
    };
    const manager = new WebRunManager({ executor, idFactory: () => "web-http-1" });
    server = createCodingAgentWebServer(manager);
    const listener = await listenWebServer(server, { port: 0 });

    const page = await fetch(listener.url);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const html = await page.text();
    expect(html).toContain("Coding Agent");
    expect(html).toContain('id="metric-tps"');
    expect(html).toContain("runtime_event");
    expect(html).toContain("reasoning_delta");
    expect(html).toContain("renderMarkdown");
    expect(html).toContain("appendAssistantDelta(data.requestId, data.delta, data.chunkIndex)");
    expect(html).toContain("CODING AGENT · 中间进度");
    expect(html).toContain("CODING AGENT · 最终回答");
    expect(html).not.toContain("CODING AGENT · 最终输出");
    expect(html).toContain('id="allow-run"');
    expect(html).toContain("上下文 / 1M");
    const browserScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    if (!browserScript) throw new Error("Web 页面缺少内嵌脚本");
    expect(() => new Script(browserScript)).not.toThrow();

    const response = await fetch(`${listener.url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "run",
        workspaceRoot: "/tmp/web-workspace",
        sessionId: "session-http-1",
        provider: "deepseek",
        model: "deepseek-test",
        apiKey: "secret-http",
        input: "hello",
      }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      runId: "web-http-1",
      sessionId: "session-http-1",
    });
  });

  it("SSE 在模型完成前逐块交付文本，而不是结束后一次性回放", async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const executor: WebExecutor = async (request, callbacks) => {
      await first;
      callbacks.onTextDelta("第一块", "request-stream-1");
      await second;
      callbacks.onTextDelta("第二块", "request-stream-1");
      return { sessionId: request.sessionId, status: "completed" };
    };
    const manager = new WebRunManager({ executor, idFactory: () => "web-stream-1" });
    server = createCodingAgentWebServer(manager);
    const listener = await listenWebServer(server, { port: 0 });
    const started = await fetch(`${listener.url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "run",
        workspaceRoot: "/tmp/web-workspace",
        sessionId: "session-stream-1",
        provider: "deepseek",
        model: "deepseek-test",
        apiKey: "secret-http",
        input: "stream",
      }),
    });
    const snapshot = (await started.json()) as { runId: string };
    const stream = await fetch(`${listener.url}/api/runs/${snapshot.runId}/events`);
    expect(stream.headers.get("x-accel-buffering")).toBe("no");
    const reader = stream.body?.getReader();
    if (!reader) throw new Error("SSE response 缺少 body");
    const decoder = new TextDecoder();
    let buffered = "";
    const nextEvent = async (): Promise<{ type: string; data: Record<string, unknown> }> => {
      while (true) {
        const boundary = buffered.indexOf("\n\n");
        if (boundary >= 0) {
          const block = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          if (block.startsWith(":")) continue;
          const type = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (type && data) return { type, data: JSON.parse(data) as Record<string, unknown> };
          continue;
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error("SSE 在目标事件前结束");
        buffered += decoder.decode(chunk.value, { stream: true });
      }
    };
    const nextTextDelta = async () => {
      while (true) {
        const event = await nextEvent();
        if (event.type === "text_delta") return event;
      }
    };

    releaseFirst();
    const firstDelta = await nextTextDelta();
    expect(firstDelta.data).toMatchObject({ delta: "第一块", chunkIndex: 1 });
    let secondArrived = false;
    const secondDeltaPromise = nextTextDelta().then((event) => {
      secondArrived = true;
      return event;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondArrived).toBe(false);
    releaseSecond();
    const secondDelta = await secondDeltaPromise;
    expect(secondDelta.data).toMatchObject({ delta: "第二块", chunkIndex: 2 });
    await reader.cancel();
  });

  it("拒绝监听非回环地址", async () => {
    server = createCodingAgentWebServer(new WebRunManager());
    await expect(listenWebServer(server, { host: "0.0.0.0", port: 0 })).rejects.toThrow("回环地址");
  });
});
