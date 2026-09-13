import { describe, expect, it } from "vitest";

import type { ApprovalRequest } from "../../src/policy/approval/approval-coordinator.js";
import { agentEventSchema } from "../../src/core/runtime/events/agent-events.js";
import {
  WebRunConflictError,
  WebRunManager,
  type WebExecutor,
  type WebRunEvent,
} from "../../src/app/web/web-run-manager.js";

const baseRequest = {
  mode: "run" as const,
  workspaceRoot: "/tmp/web-workspace",
  sessionId: "session-web-1",
  provider: "deepseek" as const,
  model: "deepseek-test",
  apiKey: "secret-value",
  input: "读取 README",
};

function waitForEvent(manager: WebRunManager, runId: string, type: string): Promise<WebRunEvent> {
  return new Promise((resolve) => {
    let matched = false;
    let unsubscribe: () => void = () => undefined;
    unsubscribe = manager.subscribe(runId, (event) => {
      if (event.type === type) {
        matched = true;
        unsubscribe();
        resolve(event);
      }
    });
    if (matched) unsubscribe();
  });
}

describe("WebRunManager", () => {
  it("把文本增量和最终状态发送给浏览器且不暴露 API key", async () => {
    const executor: WebExecutor = async (request, callbacks) => {
      expect(request.apiKey).toBe("secret-value");
      callbacks.onConfiguration({ systemPromptVersion: "test-v1" });
      callbacks.onReasoningDelta("先读取文件", "request-web-1");
      callbacks.onTextDelta("完", "request-web-1");
      callbacks.onTextDelta("成", "request-web-1");
      callbacks.onTextDelta("下一轮", "request-web-2");
      await callbacks.eventSink.publish(
        agentEventSchema.parse({
          type: "run.started",
          meta: {
            schemaVersion: 1,
            eventId: "event-web-started",
            runId: "agent-run-web",
            turnId: "agent-turn-web",
            sequence: 1,
            occurredAt: "2026-08-20T00:00:00.000Z",
            elapsedMs: 0,
          },
          payload: {},
        }),
        { signal: callbacks.signal },
      );
      return { sessionId: request.sessionId, status: "completed" };
    };
    const manager = new WebRunManager({ executor, idFactory: () => "run-web-1" });

    const started = manager.start(baseRequest);
    const finished = await waitForEvent(manager, started.runId, "run_finished");
    const allEvents: WebRunEvent[] = [];
    manager.subscribe(started.runId, (event) => allEvents.push(event))();

    expect(finished.data).toMatchObject({ status: "completed" });
    expect(
      allEvents.filter((event) => event.type === "text_delta").map((event) => event.data),
    ).toEqual([
      expect.objectContaining({ requestId: "request-web-1", delta: "完", chunkIndex: 1 }),
      expect.objectContaining({ requestId: "request-web-1", delta: "成", chunkIndex: 2 }),
      expect.objectContaining({ requestId: "request-web-2", delta: "下一轮", chunkIndex: 1 }),
    ]);
    expect(allEvents.find((event) => event.type === "reasoning_delta")?.data).toMatchObject({
      requestId: "request-web-1",
      delta: "先读取文件",
      chunkIndex: 1,
    });
    expect(allEvents.some((event) => event.type === "configuration")).toBe(true);
    expect(allEvents.some((event) => event.type === "runtime_event")).toBe(true);
    expect(JSON.stringify(allEvents)).not.toContain("secret-value");
    expect(manager.snapshot(started.runId).status).toBe("completed");
  });

  it("把风险工具调用挂起到浏览器做一次性审批", async () => {
    const approval: ApprovalRequest = {
      requestId: "approval-1",
      runId: "agent-run-1",
      callId: "call-1",
      tool: "edit",
      effectClass: "workspace_write",
      argumentsPreview: '{"path":"result.txt"}',
      paths: ["result.txt"],
      cwd: null,
      commandPreview: null,
      policyReasonCode: "workspace_write_requires_approval",
      policyVersion: "m5-v1",
      workspaceRevision: "revision-1",
      operationFingerprint: "fingerprint-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const executor: WebExecutor = async (request, callbacks) => {
      const response = await callbacks.approvalRequester.request(approval, {
        signal: callbacks.signal,
      });
      expect(response.decision).toBe("allow_once");
      return { sessionId: request.sessionId, status: "completed" };
    };
    const manager = new WebRunManager({ executor, idFactory: () => "run-web-2" });

    const started = manager.start(baseRequest);
    const requested = await waitForEvent(manager, started.runId, "approval_requested");
    expect(manager.snapshot(started.runId).status).toBe("awaiting_approval");
    expect(requested.data).toMatchObject({ approvalId: "approval-1", tool: "edit" });

    manager.answerApproval(started.runId, "approval-1", "allow_once");
    await waitForEvent(manager, started.runId, "run_finished");
    expect(manager.snapshot(started.runId).status).toBe("completed");
  });

  it("任务级授权只复用同名工具，且每次仍由上游 Policy 产生审批请求", async () => {
    const approvals = ["approval-run-1", "approval-run-2"].map((requestId, index) => ({
      requestId,
      runId: "agent-run-grant",
      callId: `call-${index + 1}`,
      tool: "shell",
      effectClass: "process",
      argumentsPreview: JSON.stringify({ command: index === 0 ? "npm test" : "npm run check" }),
      paths: [],
      cwd: ".",
      commandPreview: index === 0 ? "npm test" : "npm run check",
      policyReasonCode: "process_requires_approval",
      policyVersion: "m5-v1",
      workspaceRevision: `revision-${index + 1}`,
      operationFingerprint: `fingerprint-${index + 1}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })) satisfies ApprovalRequest[];
    const executor: WebExecutor = async (request, callbacks) => {
      const first = await callbacks.approvalRequester.request(approvals[0]!, {
        signal: callbacks.signal,
      });
      const second = await callbacks.approvalRequester.request(approvals[1]!, {
        signal: callbacks.signal,
      });
      expect(first).toMatchObject({ decision: "allow_once", reason: "web_run_tool_grant" });
      expect(second).toMatchObject({ decision: "allow_once", reason: "web_run_tool_grant" });
      return { sessionId: request.sessionId, status: "completed" };
    };
    const manager = new WebRunManager({ executor, idFactory: () => "run-web-grant" });
    const started = manager.start(baseRequest);
    await waitForEvent(manager, started.runId, "approval_requested");
    manager.answerApproval(started.runId, approvals[0]!.requestId, "allow_for_run");
    await waitForEvent(manager, started.runId, "run_finished");

    const events: WebRunEvent[] = [];
    manager.subscribe(started.runId, (event) => events.push(event))();
    expect(events.filter((event) => event.type === "approval_requested")).toHaveLength(1);
    expect(events.filter((event) => event.type === "approval_resolved")).toHaveLength(2);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "approval_resolved",
        data: expect.objectContaining({ automatic: true, tool: "shell" }),
      }),
    );
  });

  it("执行异常进入浏览器事件前会脱敏 API key", async () => {
    const executor: WebExecutor = async (request) => {
      throw new Error(`provider rejected ${request.apiKey}`);
    };
    const manager = new WebRunManager({ executor, idFactory: () => "run-web-error" });

    const started = manager.start(baseRequest);
    const failed = await waitForEvent(manager, started.runId, "run_failed");

    expect(failed.data).toMatchObject({ message: "provider rejected [REDACTED]" });
    expect(JSON.stringify(failed)).not.toContain("secret-value");
  });

  it("同一 Web 服务只允许一个活动任务", () => {
    const executor: WebExecutor = async (_request, callbacks) => {
      await new Promise<void>((resolve) =>
        callbacks.signal.addEventListener("abort", () => resolve()),
      );
      return { sessionId: "session-web-1", status: "cancelled" };
    };
    const manager = new WebRunManager({ executor, idFactory: () => "run-web-3" });
    const started = manager.start(baseRequest);

    expect(() => manager.start({ ...baseRequest, sessionId: "session-web-2" })).toThrow(
      WebRunConflictError,
    );
    manager.cancel(started.runId);
  });
});
