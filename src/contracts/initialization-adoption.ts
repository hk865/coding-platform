import { defineShape, f, type InferShape } from './data-format.js';
import type { CommitCursor } from './command-event.js';
import type { CoreError, CoreRejection, WriteResult } from './core/results.js';
import { canonicalJson, sha256Hex, type JsonValue } from './fingerprint.js';
import type { ArchitectureBaselineRevisionRef, CompletionPolicyRevisionRef } from './governance.js';
import type { GoalRef } from './ledger.js';
import type { PlanRevisionRef } from './plan.js';
import type { QueryJobAnswerRef } from './query-job.js';
import type { InitializationSourceV1 } from './initial-planning.js';
import type { RegisteredCommandCheck, TrustedCheckConfiguration } from './verification.js';
import { id } from './data-format-refs.js';

export const InitializationAdoptionRefShape = defineShape({ name: 'InitializationAdoptionRef', fields: {
  aggregateType: f.literal('InitializationAdoption'), projectId: id, operationId: id,
} });
export type InitializationAdoptionRef = InferShape<(typeof InitializationAdoptionRefShape)['fields']>;

/** The operation locator. It is a stable hash of the material, never `commandId`, the generation or `goalId`
 *  alone: a new authorized submission with the same material finds the same operation and raises its generation;
 *  a different material is a different operation. `ctx.workspaceId` must be non-empty (checked before this). */
export function initializationAdoptionOperationId(input: {
  projectId: string; workspaceId: string;
  source: InitializationSourceV1;
  expectedGoal: InitializationAdoptInputV1['expectedGoal'];
}): string {
  return sha256Hex(canonicalJson({
    schemaVersion: 1,
    operation: 'initialization.adopt',
    scope: { projectId: input.projectId, workspaceId: input.workspaceId },
    source: input.source,
    goal: input.expectedGoal.ref,
  } as unknown as JsonValue));
}

export const INITIALIZATION_ADOPT_STAGES = [
  'admission', 'freeze', 'architecture', 'policy_install', 'policy_activate', 'checks', 'propose', 'apply',
] as const;
export type InitializationAdoptStageV1 = (typeof INITIALIZATION_ADOPT_STAGES)[number];

export type InitializationAdoptInputV1 = {
  commandId: string; source: InitializationSourceV1;
  expectedAnswerDigest: string; expectedGoal: { ref: GoalRef; revision: number };
};
export type ChecksSettingsSourceV1 = { answerRef: QueryJobAnswerRef; answerDigest: string };
/** The actual installed configuration (a string revision and a content digest) plus the nullable settings source:
 *  the static fallback has `settings: null`, no configuration has both fields null, an approved empty array has a
 *  real revision/digest and a settings source (R6B3-10). */
export type ChecksConfigurationPinV1 = {
  configurationRevision: string | null;
  contentDigest: string | null;
  checksRevision: number;                    // monotonic save counter; 0 when nothing was saved or an old file lacks it
  settings: ChecksSettingsSourceV1 | null;
};
export type AdoptionGovernancePinsV1 = {
  architecture: { ref: ArchitectureBaselineRevisionRef; revision: number; digest: string };
  policy: { ref: CompletionPolicyRevisionRef; revision: number; digest: string };
};
export type AdoptionPinSetV1 = {
  project: { ref: { aggregateType: 'Project'; projectId: string }; revision: number };
  goal: { ref: GoalRef; revision: number };
  architecture: AdoptionGovernancePinsV1['architecture'] | null;
  policy: AdoptionGovernancePinsV1['policy'] | null;
  checks: ChecksConfigurationPinV1 | null;
};
export type AdoptionStageOutcomeV1 = 'skipped' | 'reused' | 'installed' | 'not_saved' | 'saved_unconfirmed' | 'failed';
/** A ledger child's receipt: the child command, the cursor its own commit returned and its projected value. */
export type AdoptionChildReceiptV1 = { commandId: string; cursor: CommitCursor; value: JsonValue };
/** The two kinds of child result, kept apart: a ledger child carries a `CommitCursor`; a checks write or
 *  confirmation has none (R6B3-07, R6B3-11), so it can never be mistaken for a ledger receipt. */
export type AdoptionStageResultV1 =
  | { kind: 'ledger'; receipt: AdoptionChildReceiptV1 }
  | { kind: 'checks'; save: ChecksSaveResultV1; confirmation: ChecksConfirmationV1 | null }
  | { kind: 'none' };   // a stage that wrote no ledger child: skipped/reused, admission/freeze, or a failed plain child
export type AdoptionStageProgressV1 = {
  stage: InitializationAdoptStageV1;
  child: { commandId: string; identityKey: string; fingerprint: string };  // the frozen child identity
  savedInput: JsonValue;
  pins: AdoptionPinSetV1;
  generation: number;                                // the generation of the before/after write that last wrote this mark
  outcome: AdoptionStageOutcomeV1 | null;
  result: AdoptionStageResultV1 | null;               // null until the after-write; a stopped stage keeps its result
};
export type InitializationAdoptReceiptV1 = { plan: PlanRevisionRef; cursor: CommitCursor };
export type InitializationAdoptFailureV1 = { code: CoreError; reason: string };
export type InitializationAdoptResultV1 =
  | { status: 'committed'; receipt: InitializationAdoptReceiptV1; replayed: boolean }
  | { status: 'pending'; operationRef: InitializationAdoptionRef; stage: InitializationAdoptStageV1;
      completedSteps: readonly InitializationAdoptStageV1[]; retryable: boolean;
      failure: InitializationAdoptFailureV1 }
  | { status: 'stopped'; operationRef: InitializationAdoptionRef;
      observed: InitializationAdoptionReadV1 | null; failure: InitializationAdoptFailureV1 }
  | CoreRejection;

/** A stage write's result. `committed` is R2's `WriteResult` and only this call's own committed receipt may
 *  produce it. A recovery branch that reads the record and writes nothing returns `unchanged` with that record:
 *  no new cursor, no revision. The service re-reads the record to decide the next step; `unchanged` is never
 *  reported as a fresh commit. */
export type AdoptionStageWriteResultV1 =
  | WriteResult<InitializationAdoptionRecordV1>
  | { status: 'unchanged'; value: InitializationAdoptionRecordV1 };

export type InitializationAdoptionRecordV1 = {
  ref: InitializationAdoptionRef; revision: number;                       // 1 at accept, +1 per progress write
  scope: { projectId: string; workspaceId: string };
  principal: JsonValue; commandId: string; fingerprint: string;          // the accept's identity material
  generation: number;                                                     // raised only by a new authorized submission
  source: InitializationSourceV1; expectedAnswerDigest: string;
  expectedGoal: { ref: GoalRef; revision: number };
  completedSteps: readonly InitializationAdoptStageV1[];                 // a prefix of INITIALIZATION_ADOPT_STAGES
  stages: readonly AdoptionStageProgressV1[];                            // one per written stage mark, in stage order
  result: InitializationAdoptResultV1 | null;          // the committed receipt or the persisted pending stop; never `stopped`
  since: CommitCursor | null;
};
export type AdoptionWriteIdentityV1 = {
  commandId: string; operationRef: InitializationAdoptionRef;
  stage: InitializationAdoptStageV1; generation: number;
};
export type AdoptionSaveBeforeInputV1 = AdoptionWriteIdentityV1 & {
  child: { commandId: string; identityKey: string; fingerprint: string };
  savedInput: JsonValue; pins: AdoptionPinSetV1;
};
/** The after-write has three branches, and the record's `result` is formed here, never by an external writer
 *  (R2-6B3-01, R2-6B3-02):
 *  - `advance`: the child finished; the mark keeps its result and `completedSteps` extends by exactly this stage;
 *    no record result is written.
 *  - `stop`: the stage really failed (or saved unconfirmed); the mark keeps the real result, the completed prefix
 *    does NOT extend, and the record result is `pending` with the real failure and `retryable`.
 *  - `complete`: the apply stage wrote the final plan receipt; every stage is completed and the record result is
 *    `committed` with that receipt.
 *  At most one current mark follows the prefix: a before-mark or a stopped mark. `saveBefore` leaves the prefix
 *  unchanged and clears `record.result`. */
export type AdoptionSaveAfterInputV1 = AdoptionWriteIdentityV1 & (
  | { branch: 'advance'; outcome: 'skipped' | 'reused' | 'installed';
      result: AdoptionStageResultV1 }
  | { branch: 'stop'; outcome: 'failed' | 'not_saved' | 'saved_unconfirmed'; result: AdoptionStageResultV1;
      failure: InitializationAdoptFailureV1; retryable: boolean }
  | { branch: 'complete'; outcome: 'installed' | 'reused' | 'skipped';
      result: AdoptionStageResultV1; receipt: InitializationAdoptReceiptV1; replayed: boolean }
);

/** The parent write's one identity material: operation `initialization.adoptAdvance`. The before projection is
 *  the frozen stage input; the after projection is the business outcome. `replayed`, the current record revision,
 *  `since` and the whole record are never members. The parent principal is the principal of the accept that wrote
 *  this generation; a child's `savedInput.actor` never replaces it. An accept identity is equal only when the
 *  principal is equal too, not merely the `commandId`. */
export type AdoptionParentFingerprintInputV1 =
  | { operationRef: InitializationAdoptionRef; stage: InitializationAdoptStageV1; generation: number;
      phase: 'before'; child: AdoptionStageProgressV1['child']; savedInput: JsonValue; pins: AdoptionPinSetV1 }
  | { operationRef: InitializationAdoptionRef; stage: InitializationAdoptStageV1; generation: number;
      phase: 'after'; branch: 'advance'; outcome: 'skipped' | 'reused' | 'installed';
      result: AdoptionStageResultV1 }
  | { operationRef: InitializationAdoptionRef; stage: InitializationAdoptStageV1; generation: number;
      phase: 'after'; branch: 'stop'; outcome: 'failed' | 'not_saved' | 'saved_unconfirmed';
      result: AdoptionStageResultV1; failure: InitializationAdoptFailureV1; retryable: boolean }
  | { operationRef: InitializationAdoptionRef; stage: InitializationAdoptStageV1; generation: number;
      phase: 'after'; branch: 'complete'; outcome: 'installed' | 'reused' | 'skipped';
      result: AdoptionStageResultV1; receipt: InitializationAdoptReceiptV1 };
/** The recovery read: the record's own `revision` and `generation` travel with the progress, so a continuation
 *  never guesses the next write (R6B3-07). `stage` is the first not-completed stage (`apply` once all are done). */
export type InitializationAdoptionReadV1 = {
  operationRef: InitializationAdoptionRef;
  revision: number;
  generation: number;
  stage: InitializationAdoptStageV1;
  completedSteps: readonly InitializationAdoptStageV1[];
  stages: readonly AdoptionStageProgressV1[];
  result: InitializationAdoptResultV1 | null;
};
/** The one explicit continue. The caller states the `(revision, generation)` it read; a moved record is
 *  `revision_conflict`, never a silent re-plan. Only `accept` raises the generation (SR9). */
export type AdoptionContinueInputV1 = {
  operationRef: InitializationAdoptionRef;
  commandId: string;
  expected: { revision: number; generation: number };
};
export type ChecksEntryValueV1 = {
  configuration: TrustedCheckConfiguration;
  settings: ChecksSettingsSourceV1;
  contentDigest: string;
};
export type ChecksSaveResultV1 =
  | { status: 'saved'; value: ChecksEntryValueV1 }
  | { status: 'saved_unconfirmed'; value: ChecksEntryValueV1 }
  | { status: 'not_saved'; rejection: CoreRejection };
export type ChecksConfirmationV1 = {
  configurationRevision: string | null; contentDigest: string | null;
  settings: ChecksSettingsSourceV1 | null;
  checks: readonly RegisteredCommandCheck[];
};
