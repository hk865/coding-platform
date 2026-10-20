// Shared pure types for orchestration slice 5 (goal settings and decisions).
//
// This file lives in the shared `contracts/` layer (spec §0.2 T08) so that both
// `state/` and the WorkGraph model can depend on the SAME shapes without a
// model import. It declares only pure data (string unions, literal snapshots
// and the canonical source key); ports stay in `model/decision-contracts.ts`.
import type { CommitCursor } from './command-event.js';
import type { ModuleRef, VersionPin, WorkspaceScope } from './core/identity.js';
import type { SessionMessageRef } from './core/session-message.js';
import type { GoalRef, WorkspaceRef } from './ledger.js';
import type { PlanRevisionRef } from './plan.js';
import type { QueryJobAnswerRef, QueryJobRef } from './query-job.js';
import type { UnknownCallReviewRef } from './unknown-call-review.js';
import type { CommandRerunRequestRef } from './command-rerun-request.js';
import { canonicalJson } from './fingerprint.js';

// ------------------------------------------------------------------------ //
// Goal / Workspace settings (spec §2.2)                                     //
// ------------------------------------------------------------------------ //

export type GoalAutonomyV1 = 'every_step' | 'after_plan_confirmation';

export type GoalParallelRiskV1 = {
  otherGoalRef: GoalRef;
  selfPlanRef: PlanRevisionRef | null;
  otherPlanRef: PlanRevisionRef | null;
};

export type GoalSettingsV1 = {
  schemaVersion: 1;
  autonomy: GoalAutonomyV1;
  order: number;
  waitForGoalRef: GoalRef | null;
  parallelRisks: GoalParallelRiskV1[];
};

/** The exact settings a Goal without a saved `settings` field reads as (spec §2.2). */
export const DEFAULT_GOAL_SETTINGS_V1: GoalSettingsV1 = {
  schemaVersion: 1,
  autonomy: 'after_plan_confirmation',
  order: 0,
  waitForGoalRef: null,
  parallelRisks: [],
};

export type NoticeCategoryV1 =
  | 'member_notice' | 'second_expiry' | 'handoff' | 'note_review'
  | 'undelivered_reply' | 'automatic_rework' | 'continuation';

export type NoticePositionV1 = { kind: 'commit'; cursor: CommitCursor; itemKey: string };

export type WorkspaceDecisionSettingsV1 = {
  schemaVersion: 1;
  noticeSeen: Partial<Record<NoticeCategoryV1, NoticePositionV1>>;
};

/** The exact settings a Workspace without `decisionSettings` reads as (spec §2.2). */
export const DEFAULT_WORKSPACE_DECISION_SETTINGS_V1: WorkspaceDecisionSettingsV1 = {
  schemaVersion: 1,
  noticeSeen: {},
};

// ------------------------------------------------------------------------ //
// Decision objects, options, sources and the user response body (spec §2.3) //
// ------------------------------------------------------------------------ //

export type DecisionObjectV1 =
  | { kind: 'aggregate'; pin: VersionPin; label: string }
  | { kind: 'file'; workspace: WorkspaceScope; path: string;
      digest: string | null; label: string };

export type DecisionAnnotationV1 = { objectKey: string; text: string };

export type DecisionOptionV1 = {
  id: string; label: string; effect: 'apply' | 'reject' | 'defer';
};

export type DecisionSourceV1 = {
  kind: 'message' | 'goal_cause' | 'candidate' | 'note_review'
    | 'planning_question' | 'goal_conflict' | 'message_release'
    | 'unknown_call_review' | 'command_rerun_request';
  key: string; goalRef: GoalRef; pins: VersionPin[];
  goalBases?: GoalDecisionBasisV1[];
};

export type DecisionSelectionV1 =
  | { kind: 'option'; optionId: string }
  | { kind: 'other' }
  | { kind: 'conflict_wait'; earlier: GoalRef; later: GoalRef }
  | { kind: 'conflict_order'; goalOrder: GoalRef[] }
  | { kind: 'conflict_parallel'; earlier: GoalRef; later: GoalRef };

export type UserDecisionBodyV1 = {
  schemaVersion: 1; kind: 'user_decision_response';
  selection: DecisionSelectionV1; text: string;
  annotations: DecisionAnnotationV1[];
};

/** The shared autonomy table's action vocabulary (spec §3.2). */
export type DecisionActionV1 =
  | 'confirm_goal' | 'adopt_first_plan' | 'remember_user_preference'
  | 'refine_future' | 'system_requeue' | 'agent_requeue' | 'auto_reverify'
  | 'minor_semantic_patch' | 'structural_patch' | 'change_goal'
  | 'exceed_budget' | 'escalate' | 'secretary_action' | 'secretary_inquiry'
  | 'short_handoff' | 'secretary_too_long' | 'long_handoff' | 'change_duty';

// ------------------------------------------------------------------------ //
// Exact content bases, control rebases, footprints and change proofs (§2.8) //
// ------------------------------------------------------------------------ //

export type GoalDecisionBasisV1 = {
  goalRef: GoalRef; workspaceRef: WorkspaceRef; objective: string;
  activePlanRef: PlanRevisionRef | null; settings: GoalSettingsV1;
};

export type GoalControlRebaseV1 = {
  captured: VersionPin; actualBefore: VersionPin; basis: GoalDecisionBasisV1;
};

export type DecisionChangeProofV1 = {
  acknowledgementRef: SessionMessageRef;
  capturedPins: VersionPin[];
  changes: { before: VersionPin; after: VersionPin }[];
  basisRebases: GoalControlRebaseV1[];
};

export type GoalFootprintV1 = {
  goalRef: GoalRef; planRef: PlanRevisionRef | null;
  plannedModules: ModuleRef[];
  executedFiles: { path: string; moduleRef: ModuleRef | null;
    certainty: 'definite' | 'possible' }[];
  executedFilesAvailable: boolean; possiblyIncomplete: boolean;
};

export type GoalConflictFactsV1 = {
  overlaps: boolean; moduleRefs: ModuleRef[]; filePaths: string[];
  possiblyIncomplete: boolean;
};

/**
 * The natural, immutable identity of one decision source (spec §3.3 line 629),
 * per kind. It never contains CAS pins, Goal bases, Goal revisions or order:
 * those are guards (`source.pins` / `source.goalBases`), not identity.
 * [lead decision S5-T3-D1, 2026-10-08, frozen at the part-1 test freeze.]
 */
export type DecisionSourceIdentityV1 =
  | { kind: 'message'; messageRef: SessionMessageRef }
  | { kind: 'candidate'; goalRef: GoalRef; requestRef: QueryJobRef }
  | { kind: 'candidate'; goalRef: GoalRef; proposalRef: {
      aggregateType: 'PlanProposal'; projectId: string; workspaceId: string; proposalId: string } }
  | { kind: 'goal_cause'; goalRef: GoalRef; code: string; affected: VersionPin[] }
  | { kind: 'planning_question'; answerRef: QueryJobAnswerRef; questionIndex: number }
  | { kind: 'note_review'; note: VersionPin }
  | { kind: 'message_release'; messageRef: SessionMessageRef; revision: number }
  | { kind: 'goal_conflict'; pair: [
      { goalRef: GoalRef; activePlanRef: PlanRevisionRef | null },
      { goalRef: GoalRef; activePlanRef: PlanRevisionRef | null },
    ] }
  | { kind: 'unknown_call_review'; reviewRef: UnknownCallReviewRef; revision: number }
  | { kind: 'command_rerun_request'; requestRef: CommandRerunRequestRef; revision: number };

const goalKey = (goalRef: GoalRef): string => canonicalJson(goalRef as never);
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `source.key` (spec §3.3 line 629): the canonical JSON of the natural
 * identity only. message = full messageRef; candidate = goalRef + requestRef
 * (no request: proposalRef); goal_cause = goalRef + cause code + affected
 * refs/versions (sorted by canonical ref, de-duplicated); planning_question =
 * answerRef + question index; note_review = note ref/revision;
 * message_release = messageRef + revision; goal_conflict = the UNORDERED Goal
 * pair sorted by ascending Goal key, each with its active Plan pointer. Goal
 * revisions, order and CAS pins never enter the key, so a reorder never makes
 * another card for the same plan pair, and both entries (main conversation and
 * queue) derive the same key. Pure and total; the input is never a previous key.
 * [lead S5-T3-D1: implemented by the lead at the part-1 freeze; tests, fixtures
 * and part-2 readers must build every `source.key` through this function.]
 */
export function decisionSourceKey(identity: DecisionSourceIdentityV1): string {
  switch (identity.kind) {
    case 'message':
      return canonicalJson({ kind: 'message', messageRef: identity.messageRef } as never);
    case 'candidate':
      return 'requestRef' in identity
        ? canonicalJson({ kind: 'candidate', goalRef: identity.goalRef, requestRef: identity.requestRef } as never)
        : canonicalJson({ kind: 'candidate', goalRef: identity.goalRef, proposalRef: identity.proposalRef } as never);
    case 'goal_cause': {
      const byKey = new Map(identity.affected.map((pin) => [canonicalJson(pin as never), pin] as const));
      const affected = [...byKey.keys()].sort(compareText).map((key) => byKey.get(key)!);
      return canonicalJson({ kind: 'goal_cause', goalRef: identity.goalRef, code: identity.code, affected } as never);
    }
    case 'planning_question':
      return canonicalJson({
        kind: 'planning_question', answerRef: identity.answerRef, questionIndex: identity.questionIndex,
      } as never);
    case 'note_review':
      return canonicalJson({ kind: 'note_review', note: identity.note } as never);
    case 'message_release':
      return canonicalJson({ kind: 'message_release', messageRef: identity.messageRef, revision: identity.revision } as never);
    case 'goal_conflict': {
      const pair = [...identity.pair].sort((a, b) => compareText(goalKey(a.goalRef), goalKey(b.goalRef)));
      return canonicalJson({ kind: 'goal_conflict', pair } as never);
    }
    case 'unknown_call_review':
      return canonicalJson({
        kind: 'unknown_call_review', reviewRef: identity.reviewRef, revision: identity.revision,
      } as never);
    case 'command_rerun_request':
      return canonicalJson({
        kind: 'command_rerun_request', requestRef: identity.requestRef, revision: identity.revision,
      } as never);
    default: {
      const unknownKind: never = identity;
      throw new Error(`unknown decision source identity ${JSON.stringify(unknownKind)}`);
    }
  }
}
