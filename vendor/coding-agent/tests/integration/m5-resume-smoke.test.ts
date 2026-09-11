import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appConfigSchema } from "../../src/app/composition/app-config.js";
import { runCodingAgent } from "../../src/app/composition/composition-root.js";
import { resumeCodingAgent } from "../../src/app/composition/resume-composition.js";
import type {
  ModelClientPort,
  ModelEvent,
} from "../../src/core/ports/model_client/model-client-port.js";
import { ProviderRegistry } from "../../src/model/providers/registry/provider-registry.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

const workspaces: TempWorkspace[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => workspace.cleanup()));
});

describe("M5 resume Composition", () => {
  it("从 SQLite Session 恢复 terminal Run，不重复调用模型", async () => {
    const workspace = await createTempWorkspace("m5-resume-");
    workspaces.push(workspace);
    const config = appConfigSchema.parse({
      schemaVersion: 1,
      model: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        options: {},
        maxOutputTokens: 64,
      },
      runtime: { tokenBudget: 4_000, maxModelRequests: 2, maxToolCalls: 2 },
      tools: { enabledNames: ["read", "edit", "shell"] },
      storage: { databasePath: workspace.resolve("data", "sessions.sqlite") },
      skills: { resourceRoot: path.resolve("resources/skills"), enabledIds: [] },
      memory: { provider: "empty" },
    });
    let modelCalls = 0;
    const client: ModelClientPort = {
      async *stream(request): AsyncIterable<ModelEvent> {
        modelCalls += 1;
        yield {
          schemaVersion: 1,
          requestId: request.requestId,
          sequence: 1,
          type: "text_delta",
          delta: "resume fixture",
        };
        yield {
          schemaVersion: 1,
          requestId: request.requestId,
          sequence: 2,
          type: "completed",
          reason: "final_answer",
        };
      },
    };
    const registry = new ProviderRegistry().register({
      id: "deepseek",
      secretEnvironmentVariable: "DEEPSEEK_API_KEY",
      defaultBaseUrl: "https://api.deepseek.com",
      capabilities: { streaming: true, toolCalls: true, usage: true },
      create: () => client,
    });
    const common = {
      config,
      workspaceRoot: workspace.root,
      sessionId: "resume-session",
      providerRegistry: registry,
      secretSource: { get: () => "fixture-secret" },
    };
    const run = await runCodingAgent({ ...common, input: "complete once" });
    expect(run.state.status).toBe("completed");
    const resumed = await resumeCodingAgent(common);
    expect(resumed.action).toBe("terminal");
    expect(resumed.state).toEqual(run.state);
    expect(modelCalls).toBe(1);
  });
});
