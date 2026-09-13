/**
 * 模块职责：定义 Session 头、记录、分页读取、乐观并发追加和存储错误协议。
 *
 * 设计边界：Core 不依赖具体数据库；适配器必须自行保证原子性、顺序和 revision 语义。
 * 关键流程：创建 Session 后按 expectedRevision 追加记录，读取端按 position 分页重放。
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { isoUtcDateTimeSchema, nonEmptyIdSchema } from "../../context/types/context-types.js";
import { agentEventSchema } from "../../runtime/events/agent-events.js";
import { runLimitsSchema } from "../../runtime/limits/limit-guard.js";
import { runSchema } from "../../runtime/state/run-state.js";

const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const workspaceReferenceSchema = z
  .object({
    identity: nonEmptyIdSchema,
    revision: nonEmptyIdSchema,
    reference: z.string().min(1),
  })
  .strict();

export const runConfigSnapshotSchema = z
  .object({
    modelConfigId: nonEmptyIdSchema,
    limits: runLimitsSchema,
    enabledToolSchemaDigest: checksumSchema,
    policyVersion: nonEmptyIdSchema,
    sandboxProfileVersion: nonEmptyIdSchema,
    baseConfigDigest: checksumSchema,
  })
  .strict();

const recordBase = {
  recordId: nonEmptyIdSchema,
  sessionId: nonEmptyIdSchema,
  position: z.number().int().positive(),
  schemaVersion: z.literal(1),
  recordedAt: isoUtcDateTimeSchema,
  checksum: checksumSchema,
};

export const sessionRecordSchema = z.discriminatedUnion("recordType", [
  z
    .object({
      ...recordBase,
      recordType: z.literal("session.created"),
      payload: z.object({ sessionId: nonEmptyIdSchema, createdAt: isoUtcDateTimeSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...recordBase,
      recordType: z.literal("turn.started"),
      payload: z
        .object({
          run: runSchema,
          config: runConfigSnapshotSchema,
          workspace: workspaceReferenceSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...recordBase,
      recordType: z.literal("agent.event"),
      payload: z.object({ event: agentEventSchema }).strict(),
    })
    .strict(),
]);

const draftBase = {
  recordId: nonEmptyIdSchema,
  schemaVersion: z.literal(1),
  recordedAt: isoUtcDateTimeSchema,
};

export const sessionRecordDraftSchema = z.discriminatedUnion("recordType", [
  z
    .object({
      ...draftBase,
      recordType: z.literal("turn.started"),
      payload: z
        .object({
          run: runSchema,
          config: runConfigSnapshotSchema,
          workspace: workspaceReferenceSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...draftBase,
      recordType: z.literal("agent.event"),
      payload: z.object({ event: agentEventSchema }).strict(),
    })
    .strict(),
]);

export const sessionHeaderSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: nonEmptyIdSchema,
    createdAt: isoUtcDateTimeSchema,
    updatedAt: isoUtcDateTimeSchema,
    revision: z.number().int().positive(),
    activeRunId: nonEmptyIdSchema.nullable(),
    activeTurnId: nonEmptyIdSchema.nullable(),
  })
  .strict();

export type WorkspaceReference = z.infer<typeof workspaceReferenceSchema>;
export type RunConfigSnapshot = z.infer<typeof runConfigSnapshotSchema>;
export type SessionRecord = z.infer<typeof sessionRecordSchema>;
export type SessionRecordDraft = z.infer<typeof sessionRecordDraftSchema>;
export type SessionHeader = z.infer<typeof sessionHeaderSchema>;

export type StoreErrorCode =
  | "not_found"
  | "already_exists"
  | "conflict"
  | "idempotency_conflict"
  | "invalid_record"
  | "version_unsupported"
  | "corrupt"
  | "busy"
  | "cancelled"
  | "closed"
  | "internal";

export class StoreError extends Error {
  constructor(
    readonly code: StoreErrorCode,
    message: string,
    readonly lastTrustedPosition: number | null = null,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

export interface StoreCallOptions {
  readonly signal: AbortSignal;
}

export interface CreateSessionInput {
  readonly sessionId: string;
  readonly recordId: string;
  readonly createdAt: string;
}

export interface AppendSessionResult {
  readonly revision: number;
  readonly positions: readonly number[];
  readonly records: readonly SessionRecord[];
}

export interface ReadSessionPage {
  readonly revision: number;
  readonly records: readonly SessionRecord[];
  readonly nextPosition: number | null;
}

export interface SessionListPage {
  readonly sessions: readonly SessionHeader[];
  readonly nextCursor: string | null;
}

export interface SessionStorePort {
  create(
    input: Readonly<CreateSessionInput>,
    options: Readonly<StoreCallOptions>,
  ): Promise<SessionHeader>;
  append(
    sessionId: string,
    expectedRevision: number,
    records: readonly Readonly<SessionRecordDraft>[],
    options: Readonly<StoreCallOptions>,
  ): Promise<AppendSessionResult>;
  read(
    sessionId: string,
    afterPosition: number,
    limit: number,
    options: Readonly<StoreCallOptions>,
  ): Promise<ReadSessionPage>;
  get(sessionId: string, options: Readonly<StoreCallOptions>): Promise<SessionHeader>;
  list(
    cursor: string | null,
    limit: number,
    options: Readonly<StoreCallOptions>,
  ): Promise<SessionListPage>;
  close(): Promise<void>;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

export function checksum(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function computeSessionRecordChecksum(record: Omit<SessionRecord, "checksum">): string {
  return checksum(record);
}

export function assertSessionRecordChecksum(record: SessionRecord): void {
  const { checksum: actual, ...content } = record;
  if (computeSessionRecordChecksum(content) !== actual) {
    throw new StoreError(
      "corrupt",
      `Session record ${record.position} checksum 不匹配`,
      record.position - 1,
    );
  }
}
