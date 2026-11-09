/** The `role_line` arm's vocabulary and shape (pure; D-11, the precedent is state/module-maintainer-assignment.ts). */
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { ModuleRef, SessionRef } from '../../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { QueryJobAnswerRef, QueryRunRef } from '../../../contracts/query-job.js';
import type { ArchitectureProposalBatchRef } from '../../../contracts/architecture-proposal.js';
import { architectureCatalogPinShape, type ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import { ROLE_LINE_DUTIES, type RoleLineDutyV1, type RoleLineSplitSavedV1 } from '../../../contracts/role-lines.js';
import { defineShape, f } from '../../../contracts/data-format.js';
import {
  GoalRefShape, id, ModuleRefShape, OperationRefShape, QueryJobAnswerRefShape, QueryRunRefShape,
  SessionMessageRefShape, SessionRefShape,
} from '../../../contracts/data-format-refs.js';

export const ROLE_LINE_ACTIONS = ['start_lines', 'open', 'role_line_add', 'role_line_split', 'role_line_reuse',
  'goal_queue_assign', 'cold_start', 'workspace_join'] as const;
export const ROLE_LINE_STEP_KEYS = ['secretary', 'adviser', 'scribe'] as const;
export const ROLE_LINE_STEP_STATES = ['pending', 'reserved', 'created', 'registered', 'linked', 'done', 'failed'] as const;
export type RoleLineStepKeyV1 = string; // the three start_lines keys are ROLE_LINE_STEP_KEYS; open/reviewer use their own key
export type RoleLineStepStateV1 = (typeof ROLE_LINE_STEP_STATES)[number];
export const COLD_START_PHASES = ['candidates', 'adopted', 'route', 'coarse_split', 'regions', 'proposals'] as const;
export type ColdStartPhaseV1 = (typeof COLD_START_PHASES)[number];
/** The second workspace's join always explores; its three phases are a subset of `COLD_START_PHASES`. */
export const WORKSPACE_JOIN_PHASES = ['coarse_split', 'regions', 'proposals'] as const;
export type WorkspaceJoinPhaseV1 = (typeof WORKSPACE_JOIN_PHASES)[number];
export type ColdStartExplorationQueryRefV1 = {
  queryRunRef: QueryRunRef; sessionRef: SessionRef; messageRef: SessionMessageRef;
  operationRef: OperationRef; segment: 'coarse_split' | 'region';
};
export const ColdStartExplorationQueryRefShape = defineShape({ name: 'ColdStartExplorationQueryRef', fields: {
  queryRunRef: f.ref(QueryRunRefShape), sessionRef: f.ref(SessionRefShape),
  messageRef: f.ref(SessionMessageRefShape), operationRef: f.ref(OperationRefShape),
  segment: f.enumOf(['coarse_split', 'region'] as const) } });
export type RoleLineActionV1 = {
  kind: 'role_line'; action: (typeof ROLE_LINE_ACTIONS)[number]; phase: string;
  /** b14: the single affected goal; `null` for a project/region request or several goals. */
  goalRef: GoalRef | null;
  /** b02: the saved split plan; present only on a `role_line_split` action. */
  split?: RoleLineSplitSavedV1 | null;
  steps: { key: RoleLineStepKeyV1; duty: RoleLineDutyV1 | null;
    childOperation: OperationRef | null; state: RoleLineStepStateV1 }[];
  result: { status: 'done' | 'failed' | 'waiting'; reason: string | null } | null;
  /** §3.13 cold-start payload: optional on every action, present only for `cold_start`. */
  lastCompleted?: ColdStartPhaseV1 | null;
  candidate?: { queryRunRef: QueryRunRef; answerRef: QueryJobAnswerRef } | null;
  pendingRegions?: ModuleRef[];
  explorations?: ColdStartExplorationQueryRefV1[];
  batchRefs?: ArchitectureProposalBatchRef[];
  route?: 'map' | 'split' | null;
  baseCatalogPin?: ArchitectureCatalogPinV1 | null;
  /** SPLITUND: an adviser tool split's admitted understanding versions, saved by its first write; absent otherwise. */
  understanding?: { noteId: string; version: number }[];
};
/** §3.1: the second workspace's join operation; always the split route, three phases over the cold-start vocabulary. */
export type WorkspaceJoinActionV1 = RoleLineActionV1 & {
  action: 'workspace_join';
  phase: WorkspaceJoinPhaseV1;
  lastCompleted: WorkspaceJoinPhaseV1 | null;
  pendingRegions: ModuleRef[];
  explorations: ColdStartExplorationQueryRefV1[];
  batchRefs: ArchitectureProposalBatchRef[];
  route: 'split';
  baseCatalogPin: ArchitectureCatalogPinV1 | null;
};
/** One note version `{ noteId, version }`: the one field (`model/session-operation-arms.ts` imports it). */
export const NoteVersionField = f.object({ noteId: id, version: f.integer({ min: 1 }) });
export const RoleLineActionShape = defineShape({ name: 'RoleLineAction', fields: {
  kind: f.literal('role_line'), action: f.enumOf(ROLE_LINE_ACTIONS), phase: id,
  goalRef: f.nullable(f.ref(GoalRefShape)),
  split: f.optional(f.nullable(f.json())),
  steps: f.array(f.object({ key: id, duty: f.nullable(f.enumOf(ROLE_LINE_DUTIES)),
    childOperation: f.nullable(f.ref(OperationRefShape)), state: f.enumOf(ROLE_LINE_STEP_STATES) })),
  result: f.nullable(f.object({ status: f.enumOf(['done', 'failed', 'waiting'] as const),
    reason: f.nullable(id) })),
  lastCompleted: f.optional(f.nullable(f.enumOf(COLD_START_PHASES))),
  candidate: f.optional(f.nullable(f.object({ queryRunRef: f.ref(QueryRunRefShape),
    answerRef: f.ref(QueryJobAnswerRefShape) }))),
  pendingRegions: f.optional(f.array(f.ref(ModuleRefShape))),
  explorations: f.optional(f.array(f.ref(ColdStartExplorationQueryRefShape))),
  batchRefs: f.optional(f.array(f.object({ aggregateType: f.literal('ArchitectureProposalBatch'),
    projectId: id, batchId: id }))),
  route: f.optional(f.nullable(f.enumOf(['map', 'split'] as const))),
  baseCatalogPin: f.optional(f.nullable(f.ref(architectureCatalogPinShape))),
  understanding: f.optional(f.array(NoteVersionField)) } });
