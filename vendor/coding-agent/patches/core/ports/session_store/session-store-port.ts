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
import type { RunLimits } from "../../runtime/limits/limit-guard.js";
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

/**
 * R4a 有效恢复约束快照：写入 `turn.started` / checkpoint 正文的是解析后的**实际生效值**
 * （限额、实际 denied / snapshot-ignored prefixes、进程沙箱已规范化并过滤的选项、宿主
 * 非只读工具授权），不是调用者传入的可选覆盖。摘要（`baseConfigDigest`）不能证明调用者
 * 当时没有额外传入沙箱 / 授权选项，因此恢复继续执行只认这份字段。
 *
 * 该字段是可选兼容扩展：旧 `schemaVersion=1` 记录没有它，仍按原正文读取、校验与
 * terminal 回放；未知 version 由 `parseEffectiveRecoveryConstraints` 显式
 * `version_unsupported`（读取期不把整条记录判成损坏）。不要在这里保存 secret / API key。
 */
export const effectiveRecoveryConstraintsSchema = z
  .object({
    // 形状只做校验，不锁死字面量：未知 version 由 parseEffectiveRecoveryConstraints
    // 显式报 version_unsupported，而不是在读取期把整条记录判成损坏。
    version: z.number().int().positive(),
    limits: runLimitsSchema,
    workspace: z
      .object({
        // 数组用 readonly 推断：与冻结的 EffectiveRecoveryConstraints 形状一致。
        deniedPrefixes: z.array(z.string().min(1)).readonly(),
        snapshotIgnoredPrefixes: z.array(z.string().min(1)).readonly(),
        consistencyMode: z.enum(["session", "workspace", "strict"]),
        maxFileBytes: z.number().int().positive(),
      })
      .strict(),
    process: z
      .object({
        protectedPaths: z.array(z.string().min(1)).readonly(),
        readOnlyPaths: z.array(z.string().min(1)).readonly(),
        executablePath: z.string().min(1),
      })
      .strict(),
    hostAuthorizedTools: z.array(z.string().min(1)).readonly(),
  })
  .strict();

/**
 * 可重建的会话历史绑定：`throughPosition` 指向开始当前 Turn 前最后已完成轮次的稳定边界。
 *
 * schemaVersion=1 的旧记录没有该字段，含义固定为 `current_turn`。这里对版本/模式只做
 * 形状校验而不锁死字面量：遇到本读取器无法解释的契约变体，由 `session-history.ts` 显式
 * 报 `version_unsupported`，而不是把记录改写成「补字段」或静默当成缺省。
 */
export const contextBasisSchema = z
  .object({
    version: z.number().int().positive(),
    mode: z.string().min(1),
    throughPosition: z.number().int().positive(),
    /** 派生隔离基线：前缀来自该源 Session；缺省表示当前 Session 自身。 */
    sourceSessionId: z.string().min(1).optional(),
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

/**
 * turn.started 的正文形状。`contextBasis` 与 `recoveryConstraints` 都是可选扩展字段：
 * 旧记录缺省时分别保持 `current_turn` 含义与「无有效约束证据」含义，checksum 仍按不含
 * 这些字段的原正文校验；新记录带字段时按其真实正文校验（checksum 覆盖整个 payload，
 * 天然覆盖新增字段）。
 */
const turnStartedPayloadShape = {
  run: runSchema,
  config: runConfigSnapshotSchema,
  workspace: workspaceReferenceSchema,
  contextBasis: contextBasisSchema.optional(),
  recoveryConstraints: effectiveRecoveryConstraintsSchema.optional(),
} as const;

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
      payload: z.object(turnStartedPayloadShape).strict(),
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
      payload: z.object(turnStartedPayloadShape).strict(),
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
export type RawContextBasis = z.infer<typeof contextBasisSchema>;
/**
 * 本读取器唯一支持的有效约束版本（version=1）。字段形状与冻结的
 * `EffectiveRecoveryConstraints` 一致，可直接互相赋值。
 */
export interface EffectiveRecoveryConstraintsRecord {
  readonly version: 1;
  readonly limits: RunLimits;
  readonly workspace: {
    readonly deniedPrefixes: readonly string[];
    readonly snapshotIgnoredPrefixes: readonly string[];
    readonly consistencyMode: "session" | "workspace" | "strict";
    readonly maxFileBytes: number;
  };
  readonly process: {
    readonly protectedPaths: readonly string[];
    readonly readOnlyPaths: readonly string[];
    readonly executablePath: string;
  };
  readonly hostAuthorizedTools: readonly string[];
}
/** 本读取器唯一支持的会话历史绑定（version=1 且 mode=session_history）。 */
export type ContextBasis = {
  readonly version: 1;
  readonly mode: "session_history";
  readonly throughPosition: number;
  readonly sourceSessionId?: string;
};
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

/**
 * 解析并校验一份有效恢复约束：未知 version 显式 `version_unsupported`，形状不合法报
 * `invalid_record`。调用方在继续执行前必须先用原记录（turn.started）的这份字段做核对，
 * 不得用调用者本次参数或摘要替代。
 */
export function parseEffectiveRecoveryConstraints(
  value: unknown,
): EffectiveRecoveryConstraintsRecord {
  const version =
    typeof value === "object" && value !== null
      ? (value as { readonly version?: unknown }).version
      : undefined;
  if (version !== 1) {
    throw new StoreError("version_unsupported", `有效恢复约束 version=${String(version)} 不受支持`);
  }
  const parsed = effectiveRecoveryConstraintsSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new StoreError(
      "invalid_record",
      `有效恢复约束不合法：${issue ? `${issue.path.join(".")} ${issue.message}` : "shape"}`,
    );
  }
  // schema 只校验 version 为正整数；上面已确认恰为唯一受支持的 1。
  return parsed.data as EffectiveRecoveryConstraintsRecord;
}
