/**
 * 模块职责：定义 checkpoint 的结构、完整性校验、恢复模式和持久化端口。
 *
 * 设计边界：Core 只依赖该抽象，不关心 checkpoint 保存到内存、SQLite 还是其他介质。
 * 关键流程：由稳定状态生成草稿和校验和，适配器保存；恢复时先验签再选择候选。
 */
import { z } from "zod";

import { isoUtcDateTimeSchema, nonEmptyIdSchema } from "../../context/types/context-types.js";
import { deriveRunPhase, runStateSchema } from "../../runtime/state/run-state.js";
import type { RunState } from "../../runtime/state/run-state.js";
import {
  checksum,
  contextBasisSchema,
  runConfigSnapshotSchema,
  StoreError,
  workspaceReferenceSchema,
} from "../session_store/session-store-port.js";
import type {
  ContextBasis,
  RunConfigSnapshot,
  StoreCallOptions,
  WorkspaceReference,
} from "../session_store/session-store-port.js";

export const checkpointResumeModeSchema = z.enum([
  "before_model",
  "before_tools",
  "ready_to_complete",
  "paused",
  "terminal",
]);

export const checkpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    checkpointId: nonEmptyIdSchema,
    sessionId: nonEmptyIdSchema,
    runId: nonEmptyIdSchema,
    turnId: nonEmptyIdSchema,
    recordPosition: z.number().int().positive(),
    lastEventSequence: z.number().int().nonnegative(),
    lastEventId: nonEmptyIdSchema.nullable(),
    state: runStateSchema,
    resumeMode: checkpointResumeModeSchema,
    config: runConfigSnapshotSchema,
    workspace: workspaceReferenceSchema,
    /**
     * 可选扩展字段：`session_history` Run 的 checkpoint 保存与其 turn.started 相同的重建
     * 绑定。摘要/checkpoint 只加速恢复，不能取代原 Session 记录；旧 checkpoint 缺省该字段
     * 时保持 `current_turn` 含义，checksum 仍按不含该字段的原正文校验。
     */
    contextBasis: contextBasisSchema.optional(),
    createdAt: isoUtcDateTimeSchema,
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const checkpointDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    checkpointId: nonEmptyIdSchema,
    sessionId: nonEmptyIdSchema,
    recordPosition: z.number().int().positive(),
    state: runStateSchema,
    config: runConfigSnapshotSchema,
    workspace: workspaceReferenceSchema,
    contextBasis: contextBasisSchema.optional(),
    createdAt: isoUtcDateTimeSchema,
  })
  .strict();

export type CheckpointResumeMode = z.infer<typeof checkpointResumeModeSchema>;
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type CheckpointDraft = z.infer<typeof checkpointDraftSchema>;

export interface CheckpointCandidate {
  readonly checkpointId: string;
  readonly checkpoint: Checkpoint | null;
}

export interface CheckpointStorePort {
  save(
    checkpoint: Readonly<CheckpointDraft>,
    options: Readonly<StoreCallOptions>,
  ): Promise<Checkpoint>;
  loadLatest(runId: string, options: Readonly<StoreCallOptions>): Promise<Checkpoint | null>;
  listCheckpoints(
    runId: string,
    options: Readonly<StoreCallOptions>,
  ): Promise<readonly Checkpoint[]>;
  /**
   * 恢复专用候选读取：单条损坏以 checkpoint=null 表示，不能阻断更旧 checkpoint 回退。
   */
  listCheckpointCandidates?(
    runId: string,
    options: Readonly<StoreCallOptions>,
  ): Promise<readonly CheckpointCandidate[]>;
  deleteInvalid(
    checkpointIds: readonly string[],
    options: Readonly<StoreCallOptions>,
  ): Promise<number>;
  close(): Promise<void>;
}

export function deriveCheckpointResumeMode(state: RunState): CheckpointResumeMode {
  const phase = deriveRunPhase(state);
  if (phase === "created" || phase === "awaiting_model") {
    throw new StoreError("invalid_record", `阶段 ${phase} 不能保存可恢复 checkpoint`);
  }
  if (
    phase === "before_tools" &&
    state.toolBatch?.calls.some((call) => call.status === "running")
  ) {
    throw new StoreError("invalid_record", "running tool 不能保存可恢复 checkpoint");
  }
  return phase;
}

export function createCheckpoint(draftInput: Readonly<CheckpointDraft>): Checkpoint {
  const draft = checkpointDraftSchema.parse(draftInput);
  const content = {
    schemaVersion: 1 as const,
    checkpointId: draft.checkpointId,
    sessionId: draft.sessionId,
    runId: draft.state.runId,
    turnId: draft.state.turn.turnId,
    recordPosition: draft.recordPosition,
    lastEventSequence: draft.state.lastEventSequence,
    lastEventId: draft.state.lastEventId,
    state: draft.state,
    resumeMode: deriveCheckpointResumeMode(draft.state),
    config: draft.config,
    workspace: draft.workspace,
    // 缺省不写该键：current_turn 记录与原 schemaVersion=1 正文保持逐字节一致。
    ...(draft.contextBasis ? { contextBasis: draft.contextBasis } : {}),
    createdAt: draft.createdAt,
  };
  return checkpointSchema.parse({ ...content, checksum: checksum(content) });
}

export function assertCheckpointChecksum(checkpoint: Checkpoint): void {
  const { checksum: actual, ...content } = checkpoint;
  if (checksum(content) !== actual) throw new StoreError("corrupt", "Checkpoint checksum 不匹配");
}

export function checkpointDraft(
  checkpointId: string,
  sessionId: string,
  recordPosition: number,
  state: RunState,
  config: RunConfigSnapshot,
  workspace: WorkspaceReference,
  createdAt: string,
  contextBasis?: ContextBasis,
): CheckpointDraft {
  return {
    schemaVersion: 1,
    checkpointId,
    sessionId,
    recordPosition,
    state,
    config,
    workspace,
    ...(contextBasis ? { contextBasis } : {}),
    createdAt,
  };
}
