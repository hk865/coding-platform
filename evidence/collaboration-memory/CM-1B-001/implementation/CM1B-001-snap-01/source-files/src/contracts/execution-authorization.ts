import type { RunSnapshot, TaskAttemptSnapshot, DispatchOutboxEntrySnapshot } from './dispatch.js';
import { canonicalJson } from './fingerprint.js';

/** Revocation is proof of no execution only because every ordinary consumer
 * must fresh-commit begin before calling any Runtime adapter. Entered generations
 * are never reset, even if the Runtime journal is missing or still prepared. */
export function executionRetryState(run: RunSnapshot, attempt: TaskAttemptSnapshot, outbox: DispatchOutboxEntrySnapshot,
  reason: string, at: string): { run: RunSnapshot; attempt: TaskAttemptSnapshot; outbox: DispatchOutboxEntrySnapshot } | null {
  if (run.status !== 'running' || run.executionAuthorization?.phase !== 'authorized' || !run.envelope || run.inputBinding ||
      run.lastEventSeq !== 0 || run.controlState?.desiredState === 'cancelled' || run.controlState?.desiredState === 'paused' ||
      attempt.status !== 'started' || attempt.runId !== run.ref.runId || outbox.status !== 'started' ||
      canonicalJson(outbox.intent.runRef) !== canonicalJson(run.ref)) return null;
  const count = (outbox.schedule?.attemptCount ?? 0) + 1;
  return {
    run: { ...run, revision: run.revision + 1, status: 'starting', envelope: null, startedAt: null,
      executionAuthorization: { ...run.executionAuthorization, phase: 'revoked' } },
    attempt: { ...attempt, revision: attempt.revision + 1, status: 'claimed', startedAt: null },
    outbox: { ...outbox, revision: outbox.revision + 1, status: 'pending', startedAt: null,
      schedule: { attemptCount: count, lastFailure: reason, quarantined: count >= 5,
        availableAt: new Date(Date.parse(at) + Math.min(60_000, 1000 * 2 ** (count - 1))).toISOString() } },
  };
}
