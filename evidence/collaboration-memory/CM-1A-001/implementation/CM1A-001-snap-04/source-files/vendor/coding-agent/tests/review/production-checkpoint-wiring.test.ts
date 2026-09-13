import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appConfigSchema } from "../../src/app/composition/app-config.js";
import { runCodingAgent } from "../../src/app/composition/composition-root.js";
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

describe("production checkpoint wiring review", () => {
  it("persists checkpoints from the production run composition after committed Session events", async () => {
    const workspace = await createTempWorkspace("review-production-checkpoint-");
    workspaces.push(workspace);
    const databasePath = workspace.resolve("data", "sessions.sqlite");
    const config = appConfigSchema.parse({
      schemaVersion: 1,
      model: {
        provider: "deepseek",
        model: "review-checkpoint-model",
        options: {},
        maxOutputTokens: 64,
      },
      runtime: { tokenBudget: 4_000, maxModelRequests: 2, maxToolCalls: 2 },
      tools: { enabledNames: ["read"] },
      storage: { databasePath },
      skills: { resourceRoot: path.resolve("resources/skills"), enabledIds: [] },
      memory: { provider: "empty" },
    });
    const model: ModelClientPort = {
      async *stream(request): AsyncIterable<ModelEvent> {
        yield {
          schemaVersion: 1,
          requestId: request.requestId,
          sequence: 1,
          type: "text_delta",
          delta: "checkpoint review complete",
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
      defaultBaseUrl: "https://invalid.test",
      capabilities: { streaming: true, toolCalls: true, usage: true },
      create: () => model,
    });

    const run = await runCodingAgent({
      config,
      workspaceRoot: workspace.root,
      sessionId: "review-production-checkpoint-session",
      providerRegistry: registry,
      secretSource: { get: () => "review-secret" },
      input: "complete and checkpoint",
    });
    expect(run.state.status).toBe("completed");

    const store = await SqliteStores.open(databasePath);
    const options = { signal: new AbortController().signal };
    const checkpoints = await store.listCheckpoints(run.state.runId, options);
    const records = await store.read("review-production-checkpoint-session", 0, 100, options);
    await store.close();

    expect(checkpoints.length).toBeGreaterThan(0);
    expect(checkpoints[0]?.state.status).toBe("completed");
    expect(checkpoints[0]?.recordPosition).toBe(records.records.at(-1)?.position);
    expect(checkpoints[0]?.lastEventId).toBe(
      records.records.findLast((record) => record.recordType === "agent.event")?.payload.event.meta
        .eventId,
    );
  });
});
