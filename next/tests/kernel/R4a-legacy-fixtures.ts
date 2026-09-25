/** Test-only legacy writer: synthetic identities and the historical JSON/checksum wire.
 * Derived from the previously accepted Kernel temp-workspace/session-record fixtures.
 * No private Kernel imports; raw SQLite writes intentionally bypass the new writer.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  sessionRecordSchema, agentEventSchema, reduceRunState, createInitialRunState,
  type SessionRecord, type AgentEvent, type RunState,
} from "../../vendor/coding-agent/dist/public-api.js";
type TurnPayload = Extract<SessionRecord, { recordType: "turn.started" }>["payload"];
type RunConfigSnapshot = TurnPayload["config"];
type WorkspaceReference = TurnPayload["workspace"];

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}
export function checksum(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function computeSessionRecordChecksum(record: Omit<SessionRecord, "checksum">): string {
  return checksum(record);
}

export interface TempWorkspace {
  readonly root: string;
  resolve(...segments: string[]): string;
  cleanup(): Promise<void>;
}

export async function createTempWorkspace(prefix = "coding-agent-test-"): Promise<TempWorkspace> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  let cleaned = false;

  return {
    root,
    resolve: (...segments) => path.join(root, ...segments),
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      await rm(root, { recursive: true, force: true });
    },
  };
}

const AT = "2026-09-23T00:00:00.000Z";

export const FIXTURE_CONFIG: RunConfigSnapshot = {
  modelConfigId: "fixture:model",
  limits: {
    maxModelRequests: null,
    maxToolCalls: null,
    maxInputTokens: null,
    maxOutputTokens: null,
    maxTotalTokens: null,
    maxCostUsdMicros: null,
    deadlineMs: null,
  },
  enabledToolSchemaDigest: "a".repeat(64),
  policyVersion: "policy-v1",
  sandboxProfileVersion: "sandbox-v1",
  baseConfigDigest: "b".repeat(64),
};

export const FIXTURE_WORKSPACE: WorkspaceReference = {
  identity: "workspace-fixture",
  revision: "rev-1",
  reference: "workspace:current",
};

export function makeSessionRecord(
  sessionId: string,
  position: number,
  draft: {
    readonly recordId: string;
    readonly recordType: SessionRecord["recordType"];
    readonly payload: unknown;
  },
): SessionRecord {
  const content = {
    recordId: draft.recordId,
    sessionId,
    position,
    recordType: draft.recordType,
    schemaVersion: 1 as const,
    recordedAt: AT,
    payload: draft.payload,
  };
  return sessionRecordSchema.parse({
    ...content,
    checksum: computeSessionRecordChecksum(content as never),
  });
}

export interface RawTurnSpec {
  readonly sessionId: string;
  readonly startPosition: number;
  readonly runId: string;
  readonly turnId: string;
  readonly input: string;
}
/** Completed legacy Turn: its original body omits contextBasis and recoveryConstraints. */
export function buildRawTurn(spec: RawTurnSpec): {
  readonly records: readonly SessionRecord[];
  readonly state: RunState;
} {
  const records: SessionRecord[] = [];
  const run = {
    schemaVersion: 1 as const,
    runId: spec.runId,
    turn: {
      turnId: spec.turnId,
      userMessage: {
        schemaVersion: 1 as const,
        messageId: `msg-${spec.turnId}-user`,
        role: "user" as const,
        content: spec.input,
      },
    },
    createdAt: AT,
  };
  records.push(
    makeSessionRecord(spec.sessionId, spec.startPosition, {
      recordId: `turn:${spec.turnId}`,
      recordType: "turn.started",
      payload: {
        run,
        config: FIXTURE_CONFIG,
        workspace: FIXTURE_WORKSPACE,
      },
    }),
  );
  let state = createInitialRunState(run);
  let tick = 0;
  const push = (type: AgentEvent["type"], payload: unknown): void => {
    tick += 1;
    const event = agentEventSchema.parse({
      type,
      meta: {
        schemaVersion: 1,
        eventId: `fixture-${spec.turnId}-${String(tick)}`,
        runId: spec.runId,
        turnId: spec.turnId,
        sequence: state.lastEventSequence + 1,
        occurredAt: AT,
        elapsedMs: tick * 10,
      },
      payload,
    });
    state = reduceRunState(state, event);
    records.push(
      makeSessionRecord(spec.sessionId, spec.startPosition + records.length, {
        recordId: `agent-event:${event.meta.eventId}`,
        recordType: "agent.event",
        payload: { event },
      }),
    );
  };
  push("run.started", {});
  push("model.request_started", { requestId: `req-${spec.turnId}-1`, retryOfRequestId: null });
  push("assistant.message_completed", {
    requestId: `req-${spec.turnId}-1`,
    message: {
      schemaVersion: 1, messageId: `msg-${spec.turnId}-assistant-1`,
      role: "assistant", content: `answer-${spec.turnId}`,
    },
    toolCalls: [],
  });
  push("run.completed", { finalMessageId: `msg-${spec.turnId}-assistant-1` });
  return { records, state };
}

/**
 * 以「旧二进制」方式直接写入 Session 记录：JSON 正文与 checksum 都按旧正文计算，
 * 不经过当前 schema 的 draft 通道，用来验证新读取器的向后兼容。
 */
export function rawInsertRecords(databasePath: string, records: readonly SessionRecord[]): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys=ON");
    const statement = database.prepare(
      "INSERT INTO session_records(session_id,position,record_id,record_type,run_id,turn_id,event_sequence,record_json) VALUES(?,?,?,?,?,?,?,?)",
    );
    for (const record of records) {
      const event = record.recordType === "agent.event" ? record.payload.event : null;
      const runId =
        record.recordType === "turn.started"
          ? record.payload.run.runId
          : (event?.meta.runId ?? null);
      const turnId =
        record.recordType === "turn.started"
          ? record.payload.run.turn.turnId
          : (event?.meta.turnId ?? null);
      statement.run(
        record.sessionId,
        record.position,
        record.recordId,
        record.recordType,
        runId,
        turnId,
        event?.meta.sequence ?? null,
        canonicalJson(record),
      );
    }
  } finally {
    database.close();
  }
}
