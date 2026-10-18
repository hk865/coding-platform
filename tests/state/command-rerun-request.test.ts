/**
 * K3 spec §3.2b (CRR-01..CRR-07), L19a and lead decisions K8-7 (2026-10-16):
 * the pure `CommandRerunRequest` machine and the one-alias-open-request helper.
 *
 * Strict TDD: every fixture is a hand-written literal record, and the expected
 * states, revisions, declared forms and rejection reasons are the spec's
 * literal values, written here independently of the implementation. No
 * `node:crypto`, no vendor, no RecordStore.
 */
import { describe, expect, it } from 'vitest';
import type { CommandRerunRequestRef, CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewRef } from '../../src/contracts/unknown-call-review.js';
import {
  newCommandRerunRequest,
  openRequestForAlias,
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
const T1 = '2026-01-02T00:00:00.000Z';
const T2 = '2026-01-03T00:00:00.000Z';

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
    ref: requestRef('rq1'),
    workspaceId: W,
    task,
    reviewRef: reviewRef('review-1'),
    runRef: runRef('run-1'),
    alias: 3,
    command: 'npm run db:migrate',
    commandSha256: 'sha-command',
    match: { kind: 'exact' },
    reason: 'rerun after the check',
    createdAt: T0,
    ...overrides,
  };
}

/** A literal `pending@1` record built through the constructor (the CRR-01 fixture). */
function record(overrides: Partial<NewCommandRerunRequestInputV1> = {}): CommandRerunRequestV1 {
  const result = newCommandRerunRequest(baseInput(overrides));
  if (!result.ok) throw new Error(`constructor rejected: ${result.detail}`);
  return result.next;
}

type AllowedEvent = Extract<CommandRerunRequestEventV1, { kind: 'allowed' }>;
type UsedEvent = Extract<CommandRerunRequestEventV1, { kind: 'used' }>;
type DeniedEvent = Extract<CommandRerunRequestEventV1, { kind: 'denied' }>;
type DeniedFinalEvent = Extract<CommandRerunRequestEventV1, { kind: 'denied_final' }>;
type ClosedEvent = Extract<CommandRerunRequestEventV1, { kind: 'closed' }>;
type FormsAddedEvent = Extract<CommandRerunRequestEventV1, { kind: 'forms_added' }>;

const allowedEvent = (overrides: Partial<Omit<AllowedEvent, 'kind'>> = {}): AllowedEvent =>
  ({ kind: 'allowed', identityKey: 'a1', fingerprint: 'fp-a1',
    answerMessageRef: messageRef('m1'), allowedAt: T1, ...overrides });
const usedEvent = (overrides: Partial<Omit<UsedEvent, 'kind'>> = {}): UsedEvent =>
  ({ kind: 'used', identityKey: 'u1', fingerprint: 'fp-u1', usedAt: T2,
    usedBy: { runId: 'run-1', callId: 'call-1' }, ...overrides });
const deniedEvent = (overrides: Partial<Omit<DeniedEvent, 'kind'>> = {}): DeniedEvent =>
  ({ kind: 'denied', identityKey: 'd1', fingerprint: 'fp-d1', answerMessageRef: messageRef('m2'), ...overrides });
const deniedFinalEvent = (overrides: Partial<Omit<DeniedFinalEvent, 'kind'>> = {}): DeniedFinalEvent =>
  ({ kind: 'denied_final', identityKey: 'df1', fingerprint: 'fp-df1',
    answerMessageRef: messageRef('m3'), ...overrides });
const closedEvent = (overrides: Partial<Omit<ClosedEvent, 'kind'>> = {}): ClosedEvent =>
  ({ kind: 'closed', identityKey: 'c1', fingerprint: 'fp-c1', ...overrides });
const formsAddedEvent = (
  form: CommandRerunRequestFormV1,
  overrides: Partial<Omit<FormsAddedEvent, 'kind' | 'form'>> = {},
): FormsAddedEvent => ({ kind: 'forms_added', identityKey: 'f1', fingerprint: 'fp-f1', form, ...overrides });
const createdEvent = (input: NewCommandRerunRequestInputV1): Extract<CommandRerunRequestEventV1, { kind: 'created' }> =>
  ({ kind: 'created', identityKey: 'create-1', fingerprint: 'fp-create-1', input });

function ctx(overrides: Partial<CommandRerunRequestContextV1> = {}): CommandRerunRequestContextV1 {
  return { expectedRevision: 1, updatedAt: T1, cardMatches: true, taskActive: true, sameRun: true, ...overrides };
}

type CrrTransition = ReturnType<typeof transitionCommandRerunRequest>;

function accepted(result: CrrTransition): CommandRerunRequestV1 {
  if (!result.ok) throw new Error(`expected acceptance: ${result.code} ${result.detail}`);
  if (result.next === 'none') throw new Error('expected a record, got none');
  return result.next;
}

function rejected(result: CrrTransition): Extract<CrrTransition, { ok: false }> {
  if (result.ok) throw new Error('expected a rejection');
  return result;
}

function effectsOf(result: CrrTransition): readonly unknown[] {
  if (!result.ok) throw new Error('expected acceptance');
  return result.effects;
}

describe('CRR-01..CRR-07 CommandRerunRequest', () => {
  it('CRR-01 constructs a pending request at revision 1 with no declared forms', () => {
    const result = newCommandRerunRequest(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.detail);
    expect(result.next.state).toBe('pending');
    expect(result.next.revision).toBe(1);
    expect(result.next.schemaVersion).toBe(1);
    expect(result.next.declared).toBe(false);
    expect(result.next.declaredForms).toEqual([]);
    expect(result.next.answerMessageRef).toBeNull();
    expect(result.next.allowedAt).toBeNull();
    expect(result.next.usedAt).toBeNull();
    expect(result.next.updatedAt).toBe(T0);
    expect(result.effects).toEqual([
      { kind: 'write_request', request: result.next },
      { kind: 'emit_event', change: 'created' },
    ]);
  });

  it('CRR-01 starts declaredForms with the declared, unrecognised rewrite', () => {
    const form: CommandRerunRequestFormV1 = { sha256: 'sha-declared', text: 'npx prisma migrate deploy' };
    const result = newCommandRerunRequest(baseInput({ match: { kind: 'declared' }, declaredForm: form }));
    if (!result.ok) throw new Error(result.detail);
    expect([result.next.state, result.next.revision, result.next.declared, result.next.declaredForms])
      .toEqual(['pending', 1, true, [form]]);
  });

  it('CRR-01 created builds a pending record from none', () => {
    const result = transitionCommandRerunRequest('none', createdEvent(baseInput()), ctx());
    expect(accepted(result)).toMatchObject({ state: 'pending', revision: 1, schemaVersion: 1 });
    expect(effectsOf(result)).toHaveLength(2);
  });

  it('CRR-02 allows a pending request once and records the answer', () => {
    const result = transitionCommandRerunRequest(record(), allowedEvent(), ctx());
    const next = accepted(result);
    expect([next.state, next.revision, next.allowedAt, next.usedAt]).toEqual(['allowed', 2, T1, null]);
    expect(next.answerMessageRef).toEqual(messageRef('m1'));
    expect(effectsOf(result)).toEqual([
      { kind: 'write_request', request: next },
      { kind: 'emit_event', change: 'allowed' },
    ]);
  });

  it('CRR-02 refuses an answer when the Task is not active (busy)', () => {
    const result = transitionCommandRerunRequest(record(), allowedEvent(), ctx({ taskActive: false }));
    expect(rejected(result)).toMatchObject({ reason: 'guard_failed', code: 'busy' });
  });

  it('CRR-02 refuses an answer that does not name this card (invalid)', () => {
    const result = transitionCommandRerunRequest(record(), allowedEvent(), ctx({ cardMatches: false }));
    expect(rejected(result)).toMatchObject({ reason: 'guard_failed', code: 'invalid' });
  });

  it('CRR-02/CRR-03 the pending -> allowed -> used chain consumes the one-time allowance', () => {
    const allowed = accepted(transitionCommandRerunRequest(record(), allowedEvent(), ctx()));
    const result = transitionCommandRerunRequest(allowed, usedEvent(), ctx({ expectedRevision: 2 }));
    const used = accepted(result);
    expect([used.state, used.revision, used.allowedAt, used.usedAt]).toEqual(['used', 3, T1, T2]);
    expect(effectsOf(result)).toEqual([
      { kind: 'write_request', request: used },
      { kind: 'emit_event', change: 'used' },
    ]);
  });

  it('CRR-03 refuses used from pending (illegal)', () => {
    const result = transitionCommandRerunRequest(record(), usedEvent(), ctx());
    expect(rejected(result)).toMatchObject({ reason: 'illegal', code: 'invalid' });
  });

  it('CRR-04 denies a pending request and records the answer', () => {
    const result = transitionCommandRerunRequest(record(), deniedEvent(), ctx());
    const next = accepted(result);
    expect([next.state, next.revision, next.allowedAt]).toEqual(['denied', 2, null]);
    expect(next.answerMessageRef).toEqual(messageRef('m2'));
    expect(effectsOf(result)).toEqual([
      { kind: 'write_request', request: next },
      { kind: 'emit_event', change: 'denied' },
    ]);
  });

  it('CRR-04 refuses deny when the Task is not active (busy)', () => {
    const result = transitionCommandRerunRequest(record(), deniedEvent(), ctx({ taskActive: false }));
    expect(rejected(result)).toMatchObject({ reason: 'guard_failed', code: 'busy' });
  });

  it('CRR-05 refuses finally a pending request and records the answer', () => {
    const result = transitionCommandRerunRequest(record(), deniedFinalEvent(), ctx());
    const next = accepted(result);
    expect([next.state, next.revision, next.allowedAt]).toEqual(['denied_final', 2, null]);
    expect(next.answerMessageRef).toEqual(messageRef('m3'));
    expect(effectsOf(result)).toEqual([
      { kind: 'write_request', request: next },
      { kind: 'emit_event', change: 'denied_final' },
    ]);
  });

  it('CRR-05 refuses deny_final for another card (invalid)', () => {
    const result = transitionCommandRerunRequest(record(), deniedFinalEvent(), ctx({ cardMatches: false }));
    expect(rejected(result)).toMatchObject({ reason: 'guard_failed', code: 'invalid' });
  });

  it('CRR-06 closes a pending request when the Task ends', () => {
    const result = transitionCommandRerunRequest(record(), closedEvent(), ctx());
    const next = accepted(result);
    expect([next.state, next.revision]).toEqual(['closed', 2]);
    expect(effectsOf(result)).toEqual([
      { kind: 'write_request', request: next },
      { kind: 'emit_event', change: 'closed' },
    ]);
  });

  it('CRR-06 closes an allowed (unused) request when the Task ends', () => {
    const allowed = accepted(transitionCommandRerunRequest(record(), allowedEvent(), ctx()));
    const result = transitionCommandRerunRequest(allowed, closedEvent(), ctx({ expectedRevision: 2 }));
    const next = accepted(result);
    expect([next.state, next.revision, next.usedAt]).toEqual(['closed', 3, null]);
  });

  it('CRR-06 leaves used, denied and denied_final terminal (closed is illegal)', () => {
    const allowed = accepted(transitionCommandRerunRequest(record(), allowedEvent(), ctx()));
    const used = accepted(transitionCommandRerunRequest(allowed, usedEvent(), ctx({ expectedRevision: 2 })));
    const denied = accepted(transitionCommandRerunRequest(record(), deniedEvent(), ctx()));
    const deniedFinal = accepted(transitionCommandRerunRequest(record(), deniedFinalEvent(), ctx()));
    const terminals: ReadonlyArray<[string, CommandRerunRequestV1]> =
      [['used', used], ['denied', denied], ['denied_final', deniedFinal]];
    for (const [state, terminal] of terminals) {
      const result = transitionCommandRerunRequest(
        terminal, closedEvent(), ctx({ expectedRevision: terminal.revision }));
      expect(rejected(result)).toMatchObject({ reason: 'illegal', code: 'invalid' });
      expect(terminal.state).toBe(state);
    }
  });

  it('CRR-07 appends a declared form without changing pending, denied or denied_final', () => {
    const form: CommandRerunRequestFormV1 = { sha256: 'sha-form-2', text: 'FOO=1 npm run db:migrate' };
    const pending = record();
    const denied = accepted(transitionCommandRerunRequest(record(), deniedEvent(), ctx()));
    const deniedFinal = accepted(transitionCommandRerunRequest(record(), deniedFinalEvent(), ctx()));
    const cases: ReadonlyArray<[CommandRerunRequestV1, CommandRerunRequestV1['state'], number]> =
      [[pending, 'pending', 2], [denied, 'denied', 3], [deniedFinal, 'denied_final', 3]];
    for (const [source, expectedState, expectedRevision] of cases) {
      const result = transitionCommandRerunRequest(source, formsAddedEvent(form),
        ctx({ expectedRevision: source.revision }));
      const next = accepted(result);
      expect([next.state, next.revision, next.declaredForms])
        .toEqual([expectedState, expectedRevision, [...source.declaredForms, form]]);
      expect(effectsOf(result)).toEqual([
        { kind: 'write_request', request: next },
        { kind: 'emit_event', change: 'forms_added' },
      ]);
    }
  });

  it('CRR-07 refuses a denied record of another Run (illegal)', () => {
    const denied = accepted(transitionCommandRerunRequest(record(), deniedEvent(), ctx()));
    const result = transitionCommandRerunRequest(denied, formsAddedEvent({ sha256: 's', text: 't' }),
      ctx({ expectedRevision: denied.revision, sameRun: false }));
    expect(rejected(result)).toMatchObject({ reason: 'illegal', code: 'invalid' });
  });

  it('CRR-02/CRR-04/CRR-05/CRR-06/CRR-07 reject a wrong revision as stale revision_conflict', () => {
    const pending = record();
    const events: CommandRerunRequestEventV1[] = [
      allowedEvent(), deniedEvent(), deniedFinalEvent(), closedEvent(), formsAddedEvent({ sha256: 's', text: 't' }),
    ];
    for (const event of events) {
      const result = transitionCommandRerunRequest(pending, event, ctx({ expectedRevision: 7 }));
      expect(rejected(result)).toMatchObject({ reason: 'stale', code: 'revision_conflict' });
    }
  });

  it('out-of-table events are illegal invalid', () => {
    const pending = record();
    const allowed = accepted(transitionCommandRerunRequest(pending, allowedEvent(), ctx()));
    const denied = accepted(transitionCommandRerunRequest(record(), deniedEvent(), ctx()));
    const deniedFinal = accepted(transitionCommandRerunRequest(record(), deniedFinalEvent(), ctx()));
    const used = accepted(transitionCommandRerunRequest(allowed, usedEvent(), ctx({ expectedRevision: 2 })));
    const outOfTable: ReadonlyArray<[CommandRerunRequestV1, CommandRerunRequestEventV1, number]> = [
      [allowed, allowedEvent(), 2],
      [denied, allowedEvent(), 2],
      [deniedFinal, closedEvent(), 2],
      [used, formsAddedEvent({ sha256: 's', text: 't' }), 3],
      [allowed, formsAddedEvent({ sha256: 's', text: 't' }), 2],
      [pending, createdEvent(baseInput()), 1],
    ];
    for (const [state, event, expectedRevision] of outOfTable) {
      const result = transitionCommandRerunRequest(state, event, ctx({ expectedRevision }));
      expect(rejected(result)).toMatchObject({ reason: 'illegal', code: 'invalid' });
    }
  });

  it('a non-created event before the request exists is illegal', () => {
    const result = transitionCommandRerunRequest('none', allowedEvent(), ctx());
    expect(rejected(result)).toMatchObject({ reason: 'illegal', code: 'invalid' });
  });

  it('the same identity with the same content replays unchanged and writes nothing', () => {
    const allowed = accepted(transitionCommandRerunRequest(record(), allowedEvent(), ctx()));
    const receipt = { identityKey: 'a1', fingerprint: 'fp-a1' };
    const result = transitionCommandRerunRequest(allowed, allowedEvent(), ctx({ expectedRevision: 1, receipt }));
    expect(accepted(result)).toBe(allowed);
    expect(effectsOf(result)).toEqual([]);
  });

  it('the same identity with different content is an idempotency_conflict', () => {
    const allowed = accepted(transitionCommandRerunRequest(record(), allowedEvent(), ctx()));
    const result = transitionCommandRerunRequest(
      allowed,
      allowedEvent({ fingerprint: 'fp-other', answerMessageRef: messageRef('m-other') }),
      ctx({ expectedRevision: 1, receipt: { identityKey: 'a1', fingerprint: 'fp-a1' } }),
    );
    expect(rejected(result)).toMatchObject({ reason: 'duplicate', code: 'idempotency_conflict' });
  });

  it('openRequestForAlias selects only the open request for the (task, review, alias)', () => {
    const pending = record();
    const allowed = accepted(transitionCommandRerunRequest(record({ ref: requestRef('rq2') }), allowedEvent(), ctx()));
    const denied = accepted(transitionCommandRerunRequest(record({ ref: requestRef('rq3') }), deniedEvent(), ctx()));
    const otherAlias = record({ ref: requestRef('rq4'), alias: 4 });
    // The refused/other-alias records come first: only pending/allowed count.
    expect(openRequestForAlias([denied, otherAlias, pending],
      { task, reviewRef: reviewRef('review-1'), alias: 3 })).toBe(pending);
    expect(openRequestForAlias([denied, otherAlias, allowed],
      { task, reviewRef: reviewRef('review-1'), alias: 3 })).toBe(allowed);
    expect(openRequestForAlias([denied, otherAlias],
      { task, reviewRef: reviewRef('review-1'), alias: 3 })).toBeNull();
    expect(openRequestForAlias([pending],
      { task, reviewRef: reviewRef('review-2'), alias: 3 })).toBeNull();
    expect(openRequestForAlias([pending],
      { task: { projectId: P, goalId: G, taskId: 't2' }, reviewRef: reviewRef('review-1'), alias: 3 })).toBeNull();
  });
});
