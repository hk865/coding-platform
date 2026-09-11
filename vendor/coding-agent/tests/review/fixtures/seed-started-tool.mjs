import { writeFile } from "node:fs/promises";

import { SqliteStores } from "../../../dist/storage/adapters/sqlite/sqlite-stores.js";

const [databasePath, markerPath] = process.argv.slice(2);
if (!databasePath || !markerPath) {
  throw new Error("usage: seed-started-tool.mjs <database> <marker>");
}

const time = "2026-08-28T00:00:00.000Z";
const digest = "d".repeat(64);
const run = {
  schemaVersion: 1,
  runId: "review-cross-process-run",
  turn: {
    turnId: "review-cross-process-turn",
    userMessage: {
      schemaVersion: 1,
      messageId: "review-cross-process-user",
      role: "user",
      content: "执行一次有副作用的工具",
    },
  },
  createdAt: time,
};
const config = {
  modelConfigId: "review-provider:review-model",
  limits: {
    maxModelRequests: 4,
    maxToolCalls: 4,
    maxInputTokens: null,
    maxOutputTokens: null,
    maxTotalTokens: null,
    maxCostUsdMicros: null,
    deadlineMs: null,
  },
  enabledToolSchemaDigest: digest,
  policyVersion: "review-policy",
  sandboxProfileVersion: "review-sandbox",
  baseConfigDigest: digest,
};
const workspace = {
  identity: "review-workspace",
  revision: "review-before-side-effect",
  reference: "workspace:current",
};
const call = {
  schemaVersion: 1,
  callId: "review-effect-call",
  name: "edit",
  arguments: { mode: "create", path: "effect.txt", newText: "executed-once" },
};

function event(sequence, type, payload) {
  return {
    type,
    meta: {
      schemaVersion: 1,
      eventId: `review-seed-${sequence}-${type}`,
      runId: run.runId,
      turnId: run.turn.turnId,
      sequence,
      occurredAt: time,
      elapsedMs: sequence,
    },
    payload,
  };
}

const events = [
  event(1, "run.started", {}),
  event(2, "model.request_started", {
    requestId: "review-seed-request",
    retryOfRequestId: null,
  }),
  event(3, "assistant.message_completed", {
    requestId: "review-seed-request",
    message: {
      schemaVersion: 1,
      messageId: "review-seed-assistant",
      role: "assistant",
      content: "",
    },
    toolCalls: [
      call,
      {
        schemaVersion: 1,
        callId: "review-never-started-call",
        name: "read",
        arguments: { path: "effect.txt" },
      },
    ],
  }),
  event(4, "tool.started", { call }),
];

const controller = new AbortController();
const options = { signal: controller.signal };
const store = await SqliteStores.open(databasePath);
try {
  await store.create(
    { sessionId: "review-cross-process-session", recordId: "review-session", createdAt: time },
    options,
  );
  const turn = await store.append(
    "review-cross-process-session",
    1,
    [
      {
        recordId: "review-turn",
        recordType: "turn.started",
        schemaVersion: 1,
        recordedAt: time,
        payload: { run, config, workspace },
      },
    ],
    options,
  );
  await store.append(
    "review-cross-process-session",
    turn.revision,
    events.map((item) => ({
      recordId: `agent-event:${item.meta.eventId}`,
      recordType: "agent.event",
      schemaVersion: 1,
      recordedAt: item.meta.occurredAt,
      payload: { event: item },
    })),
    options,
  );
  // 模拟工具在进程消失前已经产生一次外部副作用，但尚未写入 ToolResult。
  await writeFile(markerPath, "executed-once", "utf8");
} finally {
  await store.close();
}
