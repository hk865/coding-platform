/**
 * PC-14 (K): a completed history run, then a current run with a task input, one real tool loop
 * and an input injected during that loop, on one Session through the frozen Kernel harness.
 *
 * The budget fits only the base prompt and the current content: the earlier run's user message
 * and conclusion are removed, while both current user messages (real ids and texts) and the
 * current tool exchange stay in the request the provider actually received.
 */
import { describe, expect, it } from "vitest";
import type { ModelRequest } from "../../vendor/coding-agent/dist/public-api.js";
import {
  createKernelHarness,
  fixtureTool,
  type ScriptedStep,
} from "../helpers/PC-kernel-fixture.js";
import { successResult } from "../helpers/orchestration-fixture.js";

const HISTORY_INPUT = "history-question-marker";
const HISTORY_ANSWER = "history-answer-marker";
const TASK_INPUT = "task input";
const INJECTED_INPUT = "injected current input";
const CALL_ID = "call-current";

/**
 * Hand-written counts: 900 while the request still carries run 1's text, 700 otherwise.
 * Window 900, output reserve 100, so 900 never fits and 700 always does.
 */
function edgePreview(request: ModelRequest) {
  const serialized = JSON.stringify(request);
  const carriesHistory = serialized.includes(HISTORY_INPUT)
    || serialized.includes(HISTORY_ANSWER);
  const inputTokens = carriesHistory ? 900 : 700;
  return {
    outgoing: request,
    inputTokens,
    outputReserve: 100,
    fits: inputTokens + 100 <= 900,
  };
}

describe("PC-14 task input and injected input survive", () => {
  it("keeps both current user messages and the current tool exchange, and drops run 1", async () => {
    let enqueueInjected = () => {};
    const steps: readonly ScriptedStep[] = [
      { text: HISTORY_ANSWER },
      {
        toolCalls: [{ callId: CALL_ID, name: "echo", arguments: {} }],
        beforeReply: () => { enqueueInjected(); },
      },
      { text: "current answer" },
    ];
    const echo = {
      ...fixtureTool("echo", async (call) => successResult(call.callId, "echo ok")),
      requiredCapabilities: ["workspace_read"] as const,
    };
    const harness = await createKernelHarness(steps, { tools: [echo] });
    try {
      enqueueInjected = () => harness.inputs.enqueue("injected-1", INJECTED_INPUT);
      const history = await harness.run(HISTORY_INPUT);
      expect(history.state.status).toBe("completed");

      const current = await harness.run(TASK_INPUT, {
        window: 900,
        outputCap: 100,
        previewRequest: edgePreview,
      });
      expect(current.state.status).toBe("completed");
      expect(harness.model.callCount).toBe(3);

      const request = harness.model.requests[2]!;
      const taskId = current.state.turn.userMessage.messageId;
      const users = request.messages.flatMap((message) =>
        message.role === "user"
          ? [{ role: message.role, messageId: message.messageId, content: message.content }]
          : []);
      expect(users).toEqual([
        { role: "user", messageId: taskId, content: TASK_INPUT },
        { role: "user", messageId: "input-injected-1", content: INJECTED_INPUT },
      ]);

      const serialized = JSON.stringify(request);
      expect(serialized).not.toContain(HISTORY_INPUT);
      expect(serialized).not.toContain(HISTORY_ANSWER);

      const assistant = request.messages.find(
        (message) => message.role === "assistant" && message.toolCalls.length > 0,
      );
      expect(assistant).toBeDefined();
      if (assistant?.role === "assistant") {
        expect(assistant.toolCalls.map((call) => [call.callId, call.name]))
          .toEqual([[CALL_ID, "echo"]]);
      }
      const tool = request.messages.find(
        (message) => message.role === "tool" && message.callId === CALL_ID,
      );
      expect(tool).toBeDefined();
      if (tool?.role === "tool") {
        expect(tool.result.status).toBe("success");
        expect(tool.result.output).toEqual([{ kind: "text", text: "echo ok" }]);
      }

      expect(harness.reports).toHaveLength(3);
      expect(harness.reports[2]).toMatchObject({
        inputTokens: 700,
        budget: 800,
        removed: {
          memory: 0,
          skillReference: 0,
          additionalInstruction: 0,
          toolResultBody: 0,
          historyExchange: 1,
          historyConclusion: 1,
          currentExchange: 0,
        },
      });
    } finally {
      await harness.close();
    }
  });
});
