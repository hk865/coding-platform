/**
 * K3 model contracts: the `UnknownCallReview` read port and write port
 * (spec §2).
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { DecisionSelectionV1, DecisionSourceV1 } from '../../../contracts/goal-decisions.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type {
  CrashSuspicionV1, UnknownCallReviewRef, UnknownCallReviewStatusV1, UnknownCallReviewV1,
} from '../../../contracts/unknown-call-review.js';
import type { GraphWrite } from './task-contracts.js';

export interface UnknownCallReviewReadPort {
  readReview(
    ctx: CoreCallContext,
    input: { ref: UnknownCallReviewRef } | { runRef: RunRef },
  ): Promise<ReadResult<UnknownCallReviewV1>>;
  /**
   * By goal + status (the card source, index k3-ucr-by-goal-status), or by
   * workspace + open (startup 2b/6b, index k3-ucr-by-workspace-open).
   */
  listReviews(
    ctx: CoreCallContext,
    input: {
      workspace: WorkspaceScope;
      filter:
        | { goalRef: GoalRef; status: UnknownCallReviewStatusV1[] }
        | { goalRef: GoalRef; taskId: string }
        | { open: 'yes' };
      page: { limit: number /* 1..200 */; cursor?: string };
    },
  ): Promise<ReadResult<{ items: UnknownCallReviewV1[]; nextCursor: string | null; readThrough: CommitCursor | null }>>;
  /**
   * D4: the card answers of this record whose ② is committed but ③ is not
   * recorded (index k3-decision-answer-by-source-goal, read to the end, L28).
   * M2: each answer is driven by its own `reviewRef`, independent of the
   * selected Run, task eligibility and the record's `open`.
   */
  listUnappliedAnswers(
    ctx: CoreCallContext,
    input: { reviewRef: UnknownCallReviewRef } | { goalRef: GoalRef },
  ): Promise<ReadResult<{
    answers: Array<{
      answerMessageRef: SessionMessageRef;
      phase: 'disposition' | 'approval';
      source: DecisionSourceV1;
      /** M2: each answer drives itself by its own record ref. */
      reviewRef: UnknownCallReviewRef;
    }>;
    readThrough: CommitCursor | null;
  }>>;
}

export interface UnknownCallReviewPort {
  /**
   * Tool call: the review round Run comes from `ctx.principal`, never from the
   * input (L14); items are given by alias and the owner maps to callId.
   * M3: evidence and self-check text are optional model text; over
   * 512 KiB - reserve R -> capacity, nothing written.
   */
  recordConclusion(
    ctx: CoreCallContext,
    request: GraphWrite<{
      reviewRef: UnknownCallReviewRef;
      item: number;
      verdict: 'done' | 'not_done' | 'partial' | 'undetermined';
      evidence: string;
      crashSuspicion: CrashSuspicionV1;
    }>,
  ): Promise<WriteResult<UnknownCallReviewV1>>;
  /**
   * The item must be in `proposalTargets` (D7); measured with
   * `approvedMethodLinesZh`, over 5,120 bytes -> capacity (L20).
   */
  recordProposal(
    ctx: CoreCallContext,
    request: GraphWrite<{
      reviewRef: UnknownCallReviewRef;
      item: number;
      command: string;
      cwd: string | null;
      rationale: string;
    }>,
  ): Promise<WriteResult<UnknownCallReviewV1>>;
  /**
   * At `round_ended` the owner reads the round's Run and pointer, divides
   * "unfinished" from "stopped by you" via `reworkFenceOf` (L15), and reads
   * the preparing manifest of the round that wrote a conclusion for `display`
   * (D6, L16). M3: settlement is a must-write class, always admitted.
   */
  settleReview(
    ctx: CoreCallContext,
    request: GraphWrite<{ reviewRef: UnknownCallReviewRef; cause: 'round_ended' | 'review_unavailable' }>,
  ): Promise<WriteResult<UnknownCallReviewV1>>;
  /** Identity is derived from the answer message (L19); the same identity+fingerprint replays. */
  applyDisposition(
    ctx: CoreCallContext,
    request: GraphWrite<{
      source: DecisionSourceV1;
      selection: DecisionSelectionV1;
      decisionMessageRef: SessionMessageRef;
    }>,
  ): Promise<WriteResult<UnknownCallReviewV1>>;
  /** UCR-15: the direct "I'll handle it", human only (L21). */
  holdReview(
    ctx: CoreCallContext,
    request: GraphWrite<{ reviewRef: UnknownCallReviewRef; text: string | null }>,
  ): Promise<WriteResult<UnknownCallReviewV1>>;
  /** UCR-14: `activeRound` not null -> busy ("the review round is not settled", D3). */
  releaseHold(
    ctx: CoreCallContext,
    request: GraphWrite<{ reviewRef: UnknownCallReviewRef }>,
  ): Promise<WriteResult<UnknownCallReviewV1>>;
}
