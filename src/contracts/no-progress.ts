/**
 * ORCHESTRATION §9/A11 no-progress guard: the shared contract pieces (spec §13).
 *
 * The key builders (`noProgressKey`, `reverifyBasis`, `roundFailureFacts`) are
 * pure functions in `core/work-graph/state/no-progress.ts`; only the shapes they
 * produce, the new-input reference both rework owners accept, and the platform
 * body content types that are never a new basis live here, so WorkGraph, the
 * state machines and the read model share one declaration.
 */
import type { ArtifactRef } from './artifact.js';
import type { SessionMessageRef } from './core/session-message.js';
import type { RunOutcome, TaskTriple } from './dispatch.js';
import type { EvidenceOutcome } from './evidence.js';
import type { PlanRevisionRef } from './plan.js';
import type { RoundCheckIncompleteCause, RoundCheckSnapshot } from './verification.js';

// ------------------------------------------------------------------------ //
// Platform-generated bodies (ND-9)                                          //
// ------------------------------------------------------------------------ //
/** Task execution manifest body; same value as Runtime's PREPARED_MANIFEST_CONTENT_TYPE. */
export const MANIFEST_CONTENT_TYPE = 'application/vnd.coding-platform.task-execution-manifest+json;version=1';
/** Query execution manifest body. */
export const QUERY_MANIFEST_CONTENT_TYPE = 'application/vnd.coding-platform.query-execution-manifest+json;version=1';
/** Verification check report body. */
export const REPORT_CONTENT_TYPE = 'application/vnd.coding-platform.verification-check-report+json;version=1';
/** Bodies the platform writes on every execution or check; never a new basis (ND-9). */
export const PLATFORM_GENERATED_CONTENT_TYPES: readonly string[] = Object.freeze([
  MANIFEST_CONTENT_TYPE, QUERY_MANIFEST_CONTENT_TYPE, REPORT_CONTENT_TYPE,
]);

// ------------------------------------------------------------------------ //
// New basis inputs (requeue and reverify share them)                        //
// ------------------------------------------------------------------------ //
/**
 * A verified new input that may change a rework key (hard limit 2): a responded
 * SessionMessage or a stored Artifact (including an Agent's diagnosis or a human
 * `note` the owner stored). Free-text `reason` is never one of these.
 */
export type NewBasisInputRefV1 =
  | { kind: 'session_message'; ref: SessionMessageRef }
  | { kind: 'artifact'; ref: ArtifactRef };
/** `TaskRequeue.newInputRefs` and `ReverifyRoundInput.newInputRefs` hold at most this many. */
export const MAX_NEW_BASIS_INPUT_REFS = 16;
/**
 * What the owner read for one candidate input inside its read window. The owner
 * does the IO; `newBasisInputProblem` only judges, so both rework owners reach
 * the same conclusion for the same input.
 */
export type NewBasisInputObservationV1 =
  | { kind: 'not_found' }
  | { kind: 'session_message'; status: 'pending' | 'read' | 'responded' }
  /** The Artifact store returned a record for exactly this ref. */
  | { kind: 'artifact' };

/** Null when the input is an admissible new basis; otherwise the `invalid` reason. */
export function newBasisInputProblem(input: NewBasisInputRefV1, observed: NewBasisInputObservationV1): string | null {
  switch (input.kind) {
    case 'artifact':
      // A platform body is refused before any read result is considered.
      if (PLATFORM_GENERATED_CONTENT_TYPES.includes(input.ref.contentType)) {
        return `artifact ${input.ref.digest} is a platform-generated ${input.ref.contentType} body and is never a new basis`;
      }
      if (observed.kind !== 'artifact') return `artifact ${input.ref.digest} is not stored`;
      return null;
    case 'session_message':
      if (observed.kind !== 'session_message') return `session message ${input.ref.messageId} was not found`;
      if (observed.status !== 'responded') {
        return `session message ${input.ref.messageId} is ${observed.status}; only a responded message is a new basis`;
      }
      return null;
    default: {
      const unknownInput: never = input;
      return `unknown new input kind ${String((unknownInput as { kind?: unknown }).kind)}`;
    }
  }
}

// ------------------------------------------------------------------------ //
// Key shapes                                                                //
// ------------------------------------------------------------------------ //
/** ND-5: where a Run's known outcome came from. */
export type RunFailureOrigin = 'observed' | 'host_interrupted' | 'human_attested';
/** A digest-only source capture of the whole workspace (ND-2, ND-4). */
export type SourceStampV1 = { workspaceRevision: number; sourceDigest: string };
/** One non-PASS check of a round, without its report (ND-1). Legacy checks read `cause: null`. */
export type NoProgressCheckFactV1 = {
  checkId: string;
  phase: RoundCheckSnapshot['phase'];
  outcome: EvidenceOutcome | null;
  cause: RoundCheckIncompleteCause | null;
};
/**
 * The §13.1 requeue key, stored with its digest on `TaskRequeue.basis`. The
 * digest covers every field above it and nothing else: no ids, reason, actor,
 * actor class, requested budget, trigger, automatic count or time.
 * The reverify key is `ReverifyBasisV1` (`verification.ts`).
 */
export type NoProgressKeyV1 = {
  taskRef: TaskTriple;
  actionKind: 'requeue';
  failure: {
    outcome: Exclude<RunOutcome, 'outcome_unknown'>;
    origin: RunFailureOrigin;
    /** afterRun `budget.tokenBudget` when it ended `budget_exhausted`; otherwise null. */
    exhaustedTokenBudget: number | null;
    /** Sorted by checkId; `[]` without a round. */
    checks: NoProgressCheckFactV1[];
    /** Sorted; `[]` without a round. */
    gapCodes: string[];
  };
  source: SourceStampV1;
  /** The Task's effective basis Plan (L-4), not the Goal's active Plan. */
  plan: PlanRevisionRef;
  /** sha256 over the verified `NewBasisInputRefV1` list in order; null without inputs. */
  newInputDigest: string | null;
  digest: string;
};
