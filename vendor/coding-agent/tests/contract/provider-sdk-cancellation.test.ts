import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import { DeepSeekModelClient, DeepSeekSdkChatTransport } from "../../src/model/providers/deepseek/deepseek-model-client.js";
import { OpenAIModelClient, OpenAISdkResponsesTransport } from "../../src/model/providers/openai/openai-model-client.js";
import { validateModelEventSequence, type ModelEvent, type ModelRequest } from "../../src/core/ports/model_client/model-client-port.js";

const request: ModelRequest = {
  schemaVersion: 1, requestId: "sdk-cancel", runId: "sdk-cancel",
  systemPrompt: "Test local stream", messages: [{ role: "user", messageId: "u", content: "OK" }],
  tools: [], maxOutputTokens: 128,
};

for (const provider of ["deepseek", "openai"] as const) {
  for (const boundary of ["waiting", "after-content", "eof", "finished"] as const) {
    it(`${provider} actual SDK preserves the correct terminal at ${boundary}`, async () => {
      const abort = new AbortController();
      let entered!: () => void;
      const waiting = new Promise<void>(resolve => { entered = resolve; });
      const server = createServer((incoming, response) => {
        incoming.resume();
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        if (boundary === "finished") {
          const value = provider === "deepseek"
            ? { choices: [{ delta: {}, finish_reason: "stop" }] }
            : { type: "response.completed", response: {} };
          response.write(`data: ${JSON.stringify(value)}\n\n`);
        } else if (boundary === "after-content") {
          const value = provider === "deepseek"
            ? { choices: [{ delta: { content: "partial" }, finish_reason: null }] }
            : { type: "response.output_text.delta", delta: "partial" };
          response.write(`data: ${JSON.stringify(value)}\n\n`);
        } else response.write(": keep-alive\n\n");
        if (boundary === "eof") response.end();
      });
      server.listen(0, "127.0.0.1"); await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw Error("No local port");
      const options = { apiKey: "local-test-only", baseUrl: `http://127.0.0.1:${address.port}` };
      const sdk = provider === "deepseek" ? new DeepSeekSdkChatTransport(options) : new OpenAISdkResponsesTransport(options);
      const transport = { async create(body: Readonly<Record<string, unknown>>, signal: AbortSignal) {
        const source = await sdk.create(body, signal);
        const iterator = source[Symbol.asyncIterator]();
        return { [Symbol.asyncIterator]() { return {
          next() {
            const next = iterator.next(); entered();
            return next.then(value => {
              // Abort only after the SDK delivered the genuine finish event.
              if (boundary === "finished" && !value.done) abort.abort();
              return value;
            });
          },
          return() { return iterator.return ? iterator.return() : Promise.resolve({ done: true as const, value: undefined }); },
        }; } };
      } };
      const client = provider === "deepseek" ? new DeepSeekModelClient({ model: "local", transport }) : new OpenAIModelClient({ model: "local", transport });
      const events: ModelEvent[] = [];
      const collecting = (async () => {
        for await (const event of client.stream(request, { signal: abort.signal })) {
          events.push(event);
          if (boundary === "after-content" && event.type === "text_delta") abort.abort();
        }
      })();
      try {
        if (boundary === "waiting") { await waiting; abort.abort(); }
        await collecting;
        expect(validateModelEventSequence(events)).toEqual({ ok: true });
        if (boundary === "eof") expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "missing_terminal" } });
        else if (boundary === "finished") expect(events.at(-1)).toMatchObject({ type: "completed", reason: "final_answer" });
        else {
          expect(events.at(-1)).toMatchObject({ type: "cancelled" });
          expect(events.some(event => event.type === "error")).toBe(false);
          if (boundary === "after-content") expect(events[0]).toMatchObject({ type: "text_delta", delta: "partial" });
        }
      } finally {
        abort.abort(); await collecting.catch(() => undefined);
        server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  }
}
