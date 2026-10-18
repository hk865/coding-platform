/**
 * F-027 (F8): the CommandRerunRequest form cap and admission as fixed literals.
 *
 * The rows moved out of `command-rerun-request.test.ts` sized the list with the
 * production `COMMAND_RERUN_REQUEST_MAX_FORMS` constant, so the expected count
 * came from the implementation. Here the cap is the literal 8: eight forms are
 * accepted, the ninth is refused at both the constructor and the transition.
 * Form digests are fixed SHA-256 literals of the hand-written texts.
 */
import { describe, expect, it } from 'vitest';
import type { CommandRerunRequestRef, CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewRef } from '../../src/contracts/unknown-call-review.js';
import {
  newCommandRerunRequest,
  transitionCommandRerunRequest,
  type CommandRerunRequestContextV1,
  type CommandRerunRequestEventV1,
  type CommandRerunRequestFormV1,
  type NewCommandRerunRequestInputV1,
} from '../../src/core/work-graph/state/command-rerun-request.js';

const P = 'p1';
const G = 'g1';
const W = 'w1';
const T0 = '2026-01-01T00:00:00.000Z';

const task: TaskTriple = { projectId: P, goalId: G, taskId: 't1' };
const requestRef = (requestId: string): CommandRerunRequestRef =>
  ({ aggregateType: 'CommandRerunRequest', projectId: P, goalId: G, taskId: 't1', requestId });
const reviewRef = (runId: string): UnknownCallReviewRef =>
  ({ aggregateType: 'UnknownCallReview', projectId: P, goalId: G, runId });
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const messageRef = (messageId: string): SessionMessageRef =>
  ({ aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId });

function baseInput(overrides: Partial<NewCommandRerunRequestInputV1> = {}): NewCommandRerunRequestInputV1 {
  return {
    ref: requestRef('rq1'), workspaceId: W, task, reviewRef: reviewRef('review-1'), runRef: runRef('run-1'),
    alias: 3, command: 'npm run db:migrate', commandSha256: 'sha-command', match: { kind: 'exact' },
    reason: 'rerun after the check', createdAt: T0, ...overrides,
  };
}

function record(overrides: Partial<NewCommandRerunRequestInputV1> = {}): CommandRerunRequestV1 {
  const result = newCommandRerunRequest(baseInput(overrides));
  if (!result.ok) throw new Error(`constructor rejected: ${result.detail}`);
  return result.next;
}

const formsAddedEvent = (form: CommandRerunRequestFormV1): CommandRerunRequestEventV1  =>
  ({ kind: 'forms_added', identityKey: 'f1', fingerprint: 'fp-f1', form });
const allowedEvent = (): CommandRerunRequestEventV1 =>
  ({ kind: 'allowed', identityKey: 'a1', fingerprint: 'fp-a1', answerMessageRef: messageRef('m1'),
    allowedAt: '2026-01-02T00:00:00.000Z' });

function ctx(overrides: Partial<CommandRerunRequestContextV1> = {}): CommandRerunRequestContextV1 {
  return { expectedRevision: 1, updatedAt: '2026-01-02T00:00:00.000Z', cardMatches: true,
    taskActive: true, sameRun: true, ...overrides };
}

/** Eight forms (the literal cap), each with the fixed SHA-256 of `form N`. */
const eightForms: CommandRerunRequestFormV1[] = [
  { sha256: 'ef312f04b3bd000de6d3c4bca8e9b20f1028be0a9b88c08e08e69427396e5c7e', text: 'form 0' },
  { sha256: '6d67cade279b6fc632db741d2d2ca5d063075b9193ec9d40110ebfbde66150cf', text: 'form 1' },
  { sha256: 'fb967b0118314aae5bd4ea36d60a3422eada27b00170ec15c9d555a0e88ceaf5', text: 'form 2' },
  { sha256: '81e91090dba22a9b18f2efd974cae70f8b70b43ab4d458517f3da09ded951b5b', text: 'form 3' },
  { sha256: 'c50c025d1a48c651ed56f500397033abec157a5ac41c984e4e5bb6393b45ffbe', text: 'form 4' },
  { sha256: 'f1ba6747abafc4c789a4bf72b3af75962d1796b167da8fe7ebc6c61f7acb07ac', text: 'form 5' },
  { sha256: 'c9de742110fb100d7df8bb6b6cc63c923093b11b104509e528af4ad91332f84c', text: 'form 6' },
  { sha256: '4a8e2c4864fea4024da48e39620e25e2a3e9a0ec6ddad8df1b8a74eda1971655', text: 'form 7' },
];
const NINTH_FORM: CommandRerunRequestFormV1 =
  { sha256: '875ee4ebe16718fbfdc8daeaaaaf98822b665ed35816e5b9ba2288bbe8363722', text: 'form 8' };

describe('CRR-01/CRR-07 (F-027): the literal eighth-form cap', () => {
  it('accepts eight declared forms and refuses the ninth with capacity', () => {
    const created = newCommandRerunRequest(baseInput({ declaredForms: eightForms }));
    if (!created.ok) throw new Error(created.detail);
    expect([created.next.state, created.next.declared, created.next.declaredForms.length, created.next.revision])
      .toEqual(['pending', false, 8, 1]);
    expect(created.next.declaredForms).toEqual(eightForms);

    const ninth = newCommandRerunRequest(baseInput({ declaredForms: [...eightForms, NINTH_FORM] }));
    expect(ninth.ok).toBe(false);
    if (ninth.ok) throw new Error('expected capacity');
    expect([ninth.reason, ninth.code]).toEqual(['guard_failed', 'capacity']);
  });

  it('refuses forms_added on a full eight-form request with capacity', () => {
    const full = record({ declaredForms: eightForms });
    expect(full.declaredForms).toHaveLength(8);
    const result = transitionCommandRerunRequest(full, formsAddedEvent(NINTH_FORM), ctx());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected capacity');
    expect([result.reason, result.code]).toEqual(['guard_failed', 'capacity']);
  });
});

describe('CRR-02 (F-027): card-key admission is fixed literal', () => {
  it('refuses an answer whose card key does not match, writing nothing', () => {
    const pending = record();
    const result = transitionCommandRerunRequest(pending, allowedEvent(), ctx({ cardMatches: false }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected invalid');
    expect([result.reason, result.code]).toEqual(['guard_failed', 'invalid']);
  });
});
