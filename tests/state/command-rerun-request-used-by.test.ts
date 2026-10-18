/**
 * K3 L19a / lead ruling 2 (B2-09): the `CommandRerunRequest` record keeps the
 * exact `{ runId, callId }` that consumed the one-time allowance, next to
 * `usedAt`. Pure state machine only: no store, no clock, hand-written literals.
 */
import { describe, expect, it } from 'vitest';
import type { CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewRef } from '../../src/contracts/unknown-call-review.js';
import {
  newCommandRerunRequest,
  transitionCommandRerunRequest,
  type CommandRerunRequestContextV1,
  type CommandRerunRequestEventV1,
  type NewCommandRerunRequestInputV1,
} from '../../src/core/work-graph/state/command-rerun-request.js';

const P = 'p1';
const G = 'g1';
const W = 'w1';
const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';
const T2 = '2026-01-03T00:00:00.000Z';

const task: TaskTriple = { projectId: P, goalId: G, taskId: 't1' };
const reviewRef: UnknownCallReviewRef = { aggregateType: 'UnknownCallReview', projectId: P, goalId: G, runId: 'review-1' };
const runRef: RunRef = { aggregateType: 'Run', projectId: P, goalId: G, runId: 'run-1' };
const messageRef: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId: 'm1' };

function baseInput(overrides: Partial<NewCommandRerunRequestInputV1> = {}): NewCommandRerunRequestInputV1 {
  return {
    ref: { aggregateType: 'CommandRerunRequest', projectId: P, goalId: G, taskId: 't1', requestId: 'rq1' },
    workspaceId: W,
    task,
    reviewRef,
    runRef,
    alias: 3,
    command: 'npm run db:migrate',
    commandSha256: 'sha-command',
    match: { kind: 'exact' },
    reason: 'rerun after the check',
    createdAt: T0,
    ...overrides,
  };
}

type AllowedEvent = Extract<CommandRerunRequestEventV1, { kind: 'allowed' }>;
type UsedEvent = Extract<CommandRerunRequestEventV1, { kind: 'used' }>;

const allowedEvent: AllowedEvent = { kind: 'allowed', identityKey: 'a1', fingerprint: 'fp-a1',
  answerMessageRef: messageRef, allowedAt: T1 };
const usedEvent: UsedEvent = { kind: 'used', identityKey: 'u1', fingerprint: 'fp-u1', usedAt: T2,
  usedBy: { runId: 'run-9', callId: 'call-42' } };

function ctx(overrides: Partial<CommandRerunRequestContextV1> = {}): CommandRerunRequestContextV1 {
  return { expectedRevision: 1, updatedAt: T1, cardMatches: true, taskActive: true, sameRun: true, ...overrides };
}

function accepted(
  result: ReturnType<typeof transitionCommandRerunRequest>,
): Extract<ReturnType<typeof transitionCommandRerunRequest>, { ok: true }> {
  if (!result.ok) throw new Error(`expected acceptance: ${result.code} ${result.detail}`);
  return result;
}

function pending(): CommandRerunRequestV1 {
  const result = newCommandRerunRequest(baseInput());
  if (!result.ok) throw new Error(`constructor rejected: ${result.detail}`);
  return result.next;
}

function allowed(): CommandRerunRequestV1 {
  const current = pending();
  const next = accepted(transitionCommandRerunRequest(current, allowedEvent, ctx({ expectedRevision: 1 }))).next;
  if (next === 'none') throw new Error('expected the allowed record');
  return next;
}

describe('B2-09 CommandRerunRequest usedBy', () => {
  it('B2-09 constructs a fresh request with usedBy: null', () => {
    expect(pending().usedBy).toBeNull();
  });

  it('B2-09 a used transition from allowed writes the exact runId/callId and emits used', () => {
    const current = allowed();
    const result = accepted(transitionCommandRerunRequest(current, usedEvent, ctx({ expectedRevision: 2 })));
    const next = result.next;
    if (next === 'none') throw new Error('expected the used record');
    expect(next.state).toBe('used');
    expect(next.revision).toBe(3);
    expect(next.usedAt).toBe(T2);
    expect(next.usedBy).toEqual({ runId: 'run-9', callId: 'call-42' });
    expect(result.effects).toEqual([
      { kind: 'write_request', request: next },
      { kind: 'emit_event', change: 'used' },
    ]);
  });

  it('B2-09 replays the same used identity unchanged', () => {
    const current = allowed();
    const used = accepted(transitionCommandRerunRequest(current, usedEvent, ctx({ expectedRevision: 2 }))).next;
    if (used === 'none') throw new Error('expected the used record');
    const replay = accepted(transitionCommandRerunRequest(used, usedEvent, ctx({
      expectedRevision: 3,
      updatedAt: T2,
      receipt: { identityKey: 'u1', fingerprint: 'fp-u1' },
    })));
    expect(replay.next).toBe(used);
    expect(replay.next === 'none' ? null : replay.next.usedBy).toEqual({ runId: 'run-9', callId: 'call-42' });
    expect(replay.effects).toEqual([]);
  });
});
