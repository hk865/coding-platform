/**
 * The secretary lifecycle's cross-group types: the too-long basis the request side reads, the coverage/routing/brief
 * facts the handoff orchestration uses and the archive condition's mergeable fragment.
 *
 * Declarations only. The pure rules (the too-long basis, `coverageHolds`/`briefReady`) and
 * the readers live in their owning modules; no function here reads a store, writes a record or publishes a route.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { SessionArchiveConditionV1 } from '../../../contracts/core/session-archive.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { CurrentPointerRef } from '../../../contracts/note.js';
import type { QueryJobRef, QueryRunRef } from '../../../contracts/query-job.js';
import type { RecordGuard, UniqueClaimChange } from '../../record-store/ports.js';

// ------------------------------------------------------------------------ //
// The shared too-long fact                                                   //
// ------------------------------------------------------------------------ //

export type SecretaryHandoffBasisV1 = {
  tooLong: boolean;
  /** min(SECRETARY_HANDOFF_INPUT_TOKENS, floor(0.8 × contextWindowTokens)); the profile's real number. */
  threshold: number;
  lastInputTokens: number | null;
  /** The QueryRun the usage came from; null only when there is no usage at all. */
  run: QueryRunRef | null;
  /** The model request index inside that run's execution state; null with `run`. */
  requestIndex: number | null;
  /** The ordered read's watermark; selection merges it; null only for an empty ledger. */
  readThrough: CommitCursor | null;
};

// ------------------------------------------------------------------------ //
// Coverage, routing and the brief                                           //
// ------------------------------------------------------------------------ //

export type CoverageGoalV1 = {
  goalRef: GoalRef;
  /** The goal's current understanding pointer and the version it points at. */
  pointer: CurrentPointerRef; pointerRevision: number; textVersion: number;
  /** The Session whose last text write produced that version; null for a user or project write. */
  textSource: SessionRef | null;
  /** The old Session's round that wrote it; null with `textSource`, and never a review or an accept. */
  textRound: QueryRunRef | null;
};
export type CoverageFactsV1 = {
  source: SessionRef; activityRevision: number;
  /** The source's last round that entered and ended; a not-entered attempt is not a model round. */
  lastRound: QueryRunRef | null;
  goals: CoverageGoalV1[];
  /** The first read horizon; a conflict re-reads the whole set. */
  horizon: CommitCursor | null;
};
export type RoutingRootV1 = { requestRoot: QueryJobRef; owner: SessionRef; effectiveGoalId: string | null };
export type RoutingSetFactsV1 = { roots: RoutingRootV1[]; closed: boolean; horizon: CommitCursor | null };
export type HandoffBriefNoteV1 = { noteId: string; version: number; text: string };
export type HandoffBriefRequestV1 = { requestRoot: QueryJobRef; text: string; lastAnswer: string | null };
export type HandoffBriefGoalV1 = { goalRef: GoalRef; written: HandoffBriefNoteV1 | null; current: HandoffBriefNoteV1 | null };
export type HandoffBriefV1 = {
  operation: OperationRef; source: SessionRef;
  /** The old line link the successor's brief names. */
  line: SessionRef;
  requests: HandoffBriefRequestV1[]; goals: HandoffBriefGoalV1[];
};
/** The four states a successor's first round can see; `waiting` must block preparation, never read as `none`. */
export type HandoffBriefStateV1 =
  | { state: 'none' }
  | { state: 'waiting'; operation: OperationRef }
  | { state: 'ready'; operation: OperationRef; brief: HandoffBriefV1 }
  | { state: 'consumed'; operation: OperationRef; by: QueryRunRef };

// ------------------------------------------------------------------------ //
// The archive condition's mergeable fragment                                //
// ------------------------------------------------------------------------ //

/** The condition type is C/core/session-archive.ts's `SessionArchiveConditionV1`; W imports it, no second spelling. */
export type ConditionCheckV1 =
  | { ok: true; commit: SecretaryArchiveConditionCommitV1 }
  | { ok: false; reason: string };
/** The one condition fragment every final archive commit merges. */
export type SecretaryArchiveConditionCommitV1 = {
  /** The exact guards the commit merges: source and activity. */
  guards: readonly RecordGuard[];
  /** The fence claim the commit merges (handoff: the held operation); a manual archive
   *  has none (`null`), and the commit then merges no claim. */
  fence: UniqueClaimChange | null;
  /** `PreparedCommit.ledgerHorizon`, separate from `guards` (`src/core/record-store/ports.ts:122`). */
  ledgerHorizon: CommitCursor | null;
};
export interface SecretaryHandoffFactsPort {
  readCoverage(ctx: CoreCallContext, input: { source: SessionRef }): Promise<ReadResult<CoverageFactsV1>>;
  readRoutingSet(ctx: CoreCallContext, input: { source: SessionRef; horizon: CommitCursor | null }):
    Promise<ReadResult<RoutingSetFactsV1>>;
  readBriefState(ctx: CoreCallContext, input: { session: SessionRef }): Promise<ReadResult<HandoffBriefStateV1>>;
  checkArchiveCondition(ctx: CoreCallContext,
    input: { condition: Extract<SessionArchiveConditionV1, { kind: 'secretary_handoff' }>; session: SessionRef }):
    Promise<ReadResult<ConditionCheckV1>>;
}
export interface SecretaryArchiveConditionPort {
  check(ctx: CoreCallContext, input: { condition: SessionArchiveConditionV1; session: SessionRef }):
    Promise<ReadResult<ConditionCheckV1>>;
}
