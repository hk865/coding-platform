import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appConfigSchema } from "../../src/app/composition/app-config.js";
import { runCodingAgent } from "../../src/app/composition/composition-root.js";
import type { AppRuntimeConfiguration } from "../../src/app/composition/composition-root.js";
import type {
  ModelClientPort,
  ModelEvent,
} from "../../src/core/ports/model_client/model-client-port.js";
import { ProviderRegistry } from "../../src/model/providers/registry/provider-registry.js";
import { SqliteStores } from "../../src/storage/adapters/sqlite/sqlite-stores.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

const workspaces: TempWorkspace[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => workspace.cleanup()));
});

class ReplayModelClient implements ModelClientPort {
  async *stream(request: Parameters<ModelClientPort["stream"]>[0]): AsyncIterable<ModelEvent> {
    yield {
      schemaVersion: 1,
      requestId: request.requestId,
      sequence: 1,
      type: "reasoning_delta",
      delta: "先确认组合层与持久化边界。",
    };
    yield {
      schemaVersion: 1,
      requestId: request.requestId,
      sequence: 2,
      type: "text_delta",
      delta: "M5 replay ok",
    };
    yield {
      schemaVersion: 1,
      requestId: request.requestId,
      sequence: 3,
      type: "usage_snapshot",
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        cachedInputTokens: 0,
        costUsdMicros: null,
      },
    };
    yield {
      schemaVersion: 1,
      requestId: request.requestId,
      sequence: 4,
      type: "completed",
      reason: "final_answer",
    };
  }
}

describe("M5 Composition smoke", () => {
  it("显式 DeepSeek 选择贯通 Runtime、固定 ToolList 和 SQLite required sink", async () => {
    const workspace = await createTempWorkspace("m5-composition-");
    workspaces.push(workspace);
    const databasePath = workspace.resolve("app-data", "sessions.sqlite");
    const config = appConfigSchema.parse({
      schemaVersion: 1,
      model: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        options: {},
        maxOutputTokens: 128,
      },
      runtime: { tokenBudget: 8_000, maxModelRequests: 2, maxToolCalls: 3 },
      tools: { enabledNames: ["read", "edit", "shell"] },
      storage: { databasePath },
      skills: {
        resourceRoot: path.resolve("resources/skills"),
        enabledIds: ["coding-safety"],
      },
      memory: { provider: "empty" },
    });
    const registry = new ProviderRegistry().register({
      id: "deepseek",
      secretEnvironmentVariable: "DEEPSEEK_API_KEY",
      defaultBaseUrl: "https://api.deepseek.com",
      capabilities: { streaming: true, toolCalls: true, usage: true },
      create: () => new ReplayModelClient(),
    });
    const requestedSecrets: string[] = [];
    let output = "";
    let reasoning = "";
    let textRequestId = "";
    let reasoningRequestId = "";
    let runtimeConfiguration: AppRuntimeConfiguration | null = null;
    const result = await runCodingAgent({
      config,
      workspaceRoot: workspace.root,
      input: "只返回 replay 结果",
      sessionId: "session-m5-smoke",
      providerRegistry: registry,
      secretSource: {
        get(name) {
          requestedSecrets.push(name);
          return "fixture-secret-never-persist";
        },
      },
      onTextDelta: (delta, requestId) => {
        output += delta;
        textRequestId = requestId;
      },
      onReasoningDelta: (delta, requestId) => {
        reasoning += delta;
        reasoningRequestId = requestId;
      },
      onConfiguration: (configuration) => {
        runtimeConfiguration = configuration;
      },
    });
    expect(result.state.status).toBe("completed");
    expect(result.provider).toBe("deepseek");
    expect(result.enabledTools).toEqual(["read", "edit", "shell"]);
    expect(requestedSecrets).toEqual(["DEEPSEEK_API_KEY"]);
    expect(output).toBe("M5 replay ok");
    expect(reasoning).toBe("先确认组合层与持久化边界。");
    expect(textRequestId).not.toBe("");
    expect(reasoningRequestId).toBe(textRequestId);
    expect(runtimeConfiguration).toMatchObject({
      systemPromptVersion: "coding-agent-v3",
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: "read",
          description: expect.stringContaining("workspace-relative"),
        }),
        expect.objectContaining({ name: "edit" }),
        expect.objectContaining({ name: "shell" }),
      ]),
      skills: expect.arrayContaining([
        expect.objectContaining({ id: "coding-safety", content: expect.any(String) }),
      ]),
    });
    expect(result.state.transcript.at(-1)).toMatchObject({
      kind: "assistant_message",
      message: { reasoningContent: "先确认组合层与持久化边界。" },
    });

    const store = await SqliteStores.open(databasePath);
    try {
      const page = await store.read("session-m5-smoke", 0, 100, {
        signal: new AbortController().signal,
      });
      expect(page.records.map((record) => record.recordType)).toEqual([
        "session.created",
        "turn.started",
        "agent.event",
        "agent.event",
        "agent.event",
        "agent.event",
        "agent.event",
      ]);
      expect(JSON.stringify(page.records)).not.toContain("fixture-secret-never-persist");
      expect(JSON.stringify(page.records)).toContain("先确认组合层与持久化边界。");
    } finally {
      await store.close();
    }
  });
});
