/**
 * P1-15 lane C — local OpenAI-compatible model endpoint fixture.
 *
 * Reference: P1-16 real-kernel pattern (tests/integration/real-kernel/replay-server.ts).
 * This fixture serves a SELF-CONTAINED /v1/chat/completions SSE endpoint on
 * 127.0.0.1:<random port> and returns SCRIPTED completions (tool calls + final text)
 * that drive the P1-15 collaboration loop: 需求歧义 -> 选项 -> 决定 -> 派发 -> 验证 ->
 * 返工 -> 接续. It is the model-endpoint degradation boundary evidence for the
 * acceptance item "对用户选定真实任务运行一次模型协作集成" (no external network /
 * no real provider credentials; DEEPSEEK_API_KEY = fixture-secret).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import type { ServerResponse } from "node:http";

/** The fixture credential the kernel CLI is launched with. */
export const P115_FIXTURE_SECRET = "fixture-secret";

export type P115ChatChunk = Record<string, unknown>;

/** A single scripted completion as an OpenAI-compatible SSE tool-call chunk. */
export function p115ToolCallChunk(name: string, callId: string, argumentsJson: string): P115ChatChunk {
  return {
    id: "p115-fixture-tool-call",
    object: "chat.completion.chunk",
    created: 0,
    model: "p115-fixture-model",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: null, tool_calls: [{ index: 0, id: callId, type: "function", function: { name, arguments: argumentsJson } }] },
        finish_reason: "tool_calls",
      },
    ],
  };
}

/** Final (stop) + usage chunks. */
export function p115FinalChunks(text: string): P115ChatChunk[] {
  return [
    { id: "p115-fixture-final", object: "chat.completion.chunk", created: 0, model: "p115-fixture-model", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: "stop" }] },
    { id: "p115-fixture-usage", object: "chat.completion.chunk", created: 0, model: "p115-fixture-model", choices: [], usage: { prompt_tokens: 21, completion_tokens: 9, total_tokens: 30 } },
  ];
}

/** Write SSE-delimited chunks + DONE terminator. */
export function p115Sse(response: ServerResponse, chunks: readonly P115ChatChunk[]): void {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  for (const chunk of chunks) response.write("data: " + JSON.stringify(chunk) + "\n\n");
  response.end("data: [DONE]\n\n");
}

export type P115ModelServer = {
  baseUrl: string;
  requests: { url: string; body: Record<string, unknown> }[];
  close(): Promise<void>;
};

/**
 * Start the local fixture model server. handlers are indexed by the GLOBAL request
 * order across every run/resume against this server; a handler at any index returns
 * a final completion, and the LAST handler is the fallback for later indices.
 */
export async function startP115ModelServer(handlers: ((index: number, response: ServerResponse) => void)[]): Promise<P115ModelServer> {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const server = http.createServer(async (incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (c: Buffer) => chunks.push(c));
    await once(incoming, "end");
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const index = requests.length;
    requests.push({ url: incoming.url ?? "", body });
    const handler = handlers[index] ?? handlers[handlers.length - 1]!;
    try {
      handler(index, response);
    } catch (error) {
      response.statusCode = 500;
      response.end(String(error));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    baseUrl: "http://127.0.0.1:" + String(address.port) + "/v1",
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    },
  };
}

/** The scripted P1-15 collaboration flow (spell out the loop in the model text). */
export function p115CollaborationFlowHandlers(): ((index: number, response: ServerResponse) => void)[] {
  const resumedFinal = "P1-15 模型协作闭环（真实内核，close/reopen 续接）：需求歧义→选项(opt-a/opt-b)→决定(accept opt-a)→派发→验证→返工(一次)→接续——从持久事实与 Handoff 继续";
  // ONE index-driven handler (global request order across run+resume):
  //   index 0 = turn 1 model tool call (read); index 1 = HANG (the turn stays OPEN so the
  //   run is SIGKILLed mid-turn -> open session turn); index >= 2 = the final completed by
  //   the RESUME (continuation from persisted facts, not re-running the turn).
  return [
    (index, response) => {
      if (index === 0) p115Sse(response, [p115ToolCallChunk("read", "p115-call-read-1", '{"path":"requirement.md"}')]);
      else if (index === 1) { void response; /* hang: keep the turn OPEN */ }
      else p115Sse(response, p115FinalChunks(resumedFinal));
    },
  ];
}