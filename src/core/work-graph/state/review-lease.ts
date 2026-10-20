/**
 * K3 (spec §2, L10/L21/M1): the two pure review-lease helpers shared by
 * `requeue-service`, `claim-service` and `attempt-machine`.
 *
 * - `leaseReleasedForContinuation`: the three sites that demand "the
 *   lease was released by the afterRun" must also accept a release by one of
 *   the afterRun's review rounds (the most recent holder, L12).
 * - `isUnenteredReviewRoundForCancellation`: the UR3h cancellation judgment
 *   (M1): a review-purpose Run that provably never entered the Kernel, with a
 *   `Claimed`/`Authorized`/`Revoked` authorization and any pointer except a
 *   committed `cancelled` (a `paused` pointer is accepted, unlike
 *   `isUnadmittedStarting` in workflow.ts).
 * - `reviewRoundEndedKnown`: the ONE "known end" rule.
 *
 * Pure: imports only `src/contracts` and this directory.
 */
import type { RunSnapshot } from '../../../contracts/dispatch.js';

/**
 * `release.runRef === afterRunRef`, or the releasing Run's purpose is this
 * review record and its run is one of the record's rounds
 * (`purpose.reviewRef.runId === afterRunRef.runId`). The caller reads
 * `releasingRunPurpose` in the same read window.
 */
export function leaseReleasedForContinuation(
  input: { release: { runRef: RunSnapshot['ref'] }; releasingRunPurpose: RunSnapshot['purpose'] | null },
  afterRunRef: RunSnapshot['ref'],
): boolean {
  if (sameRunRef(input.release.runRef, afterRunRef)) return true;
  const purpose = input.releasingRunPurpose;
  return purpose !== null && purpose !== undefined
    && purpose.kind === 'unknown_call_review'
    && purpose.reviewRef.runId === afterRunRef.runId;
}

/**
 * M1: the review round was claimed but never entered the Kernel. Mirrors
 * `isUnadmittedStarting` (`workflow.ts:895`) except that a `paused` pointer is
 * accepted here; an already `cancelled` Run is not.
 */
export function isUnenteredReviewRoundForCancellation(run: RunSnapshot, runRef: RunSnapshot['ref']): boolean {
  if (run.purpose?.kind !== 'unknown_call_review') return false;
  if (!sameRunRef(run.ref, runRef)) return false;
  if (run.status !== 'starting') return false;
  if (run.executionHistory !== undefined) return false;
  if (run.startedAt !== null) return false;
  if (run.lastEventSeq !== 0 || run.lastRuntimeEventId !== '' || run.lastFactEventId !== '') return false;
  const auth = run.executionAuthorization;
  if (auth !== undefined) {
    if (auth.phase !== 'authorized' && auth.phase !== 'revoked') return false;
  }
  // 'paused' is accepted (M1); only a committed cancel excludes the Run.
  return run.controlState?.desiredState !== 'cancelled';
}

/**
 * K3 (L15/L16, §3.4 UR4/UR5): the ONE "known end" rule shared by the
 * owner (`settleReview`), the Workflow's UR4/UR5 gate and the review-purpose
 * `start`/`observe` settlement helper. A Run that has ended with an outcome
 * that is neither null nor `outcome_unknown` is a known end. A Run that is
 * still going, or whose outcome is `outcome_unknown`, is not.
 */
export function reviewRoundEndedKnown(run: RunSnapshot): boolean {
  return run.status === 'ended' && run.outcome !== null && run.outcome !== 'outcome_unknown';
}

function sameRunRef(left: { projectId: string; goalId: string; runId: string }, right: { projectId: string; goalId: string; runId: string }): boolean {
  return left.projectId === right.projectId && left.goalId === right.goalId && left.runId === right.runId;
}
