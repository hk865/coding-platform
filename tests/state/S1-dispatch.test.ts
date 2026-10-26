/**
 * Slice 1 (Session facts, corrections and archive) unit rows UT26–UT31,
 * UT43–UT47 (spec §5.2).
 *
 * Pure state: the Work/Query claim admission of
 * `state/session-availability.ts` (`sessionDispatchAdmissionProblem`, S1-DISPATCH-01/02)
 * and the normal SES-02/SES-03 occupancy acquire those admitted claims run.
 * No RecordStore, no Kernel. Every value is the row's given/expected value;
 * the part-1 stubs throw `not implemented: …`, which is the expected RED.
 */
import { describe, expect, it } from 'vitest';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { RoleConfigurationRef, SessionAggregateRef } from '../../src/contracts/core/identity.js';
import type { CoreError } from '../../src/contracts/core/results.js';
import type { SessionArchiveRequestV1 } from '../../src/contracts/core/session-archive.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { SessionProvenanceV1, SessionRecord } from '../../src/contracts/core/session.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { QueryRunRef } from '../../src/contracts/query-job.js';
import {
  sessionDispatchAdmissionProblem, sessionMachineStateOf, transitionSession,
  type SessionDispatchGuardV1, type SessionGuardContext, type SessionWorkWaitStateV1,
} from '../../src/core/work-graph/state/session-availability.js';
import type { Rejected } from '../../src/core/work-graph/state/transition.js';

// --------------------------------------------------------------------------
// Fixtures (§5.1: p / w, S / D, Tasks A / B, r0, message m / n, request a)
// --------------------------------------------------------------------------

const T0 = '2026-10-08T00:00:00.000Z';

const S_REF: SessionAggregateRef = { aggregateType: 'Session', projectId: 'p', sessionId: 'S' };
const SESSION_S = { projectId: 'p', sessionId: 'S' } as const;
const ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'tpl-1', templateRevision: 'r1' };
const RUN_0: RunRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r0' };
const QUERY_RUN: QueryRunRef = {
  aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'w', queryJobId: 'qj-1', runId: 'qr-1',
};
const TASK_A: TaskTriple = { projectId: 'p', goalId: 'g', taskId: 'A' };
const TASK_B: TaskTriple = { projectId: 'p', goalId: 'g', taskId: 'B' };
const MESSAGE_M: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'w', messageId: 'm' };
const MESSAGE_N: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'w', messageId: 'n' };

const WAIT_M: SessionWorkWaitStateV1 = { runRef: RUN_0, messageRef: MESSAGE_M, task: TASK_A };
const WAIT_OTHER_TASK: SessionWorkWaitStateV1 = { runRef: RUN_0, messageRef: MESSAGE_M, task: TASK_B };
const WAIT_OTHER_MESSAGE: SessionWorkWaitStateV1 = { runRef: RUN_0, messageRef: MESSAGE_N, task: TASK_A };

const PROVENANCE_NEW: SessionProvenanceV1 = { schemaVersion: 1, kind: 'new' };
const PROVENANCE_COPY: SessionProvenanceV1 = {
  schemaVersion: 1, kind: 'readonly_copy', from: SESSION_S, messageRef: MESSAGE_M,
};

const ARCHIVE_REQUEST: SessionArchiveRequestV1 = {
  schemaVersion: 1, requestId: 'a',
  requestedBy: { kind: 'human', id: 'operator-1' } as Extract<ActorRef, { kind: 'human' | 'system' }>,
  requestedAt: T0, reason: 'the operator asked to archive this line', mode: 'operator',
  condition: null,
  tasks: [], wait: null, execution: { kind: 'none' }, executionPins: [], confirmUnknownStopped: false,
  receipt: { identityKey: 's1-archive-step:k', fingerprint: 'fp-a' },
};

function sessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    ref: S_REF, revision: 7, kernel: { adapterId: 'coding-agent', kernelSessionId: 'k-S' },
    lifecycle: 'active', health: 'available', healthConclusion: null, role: ROLE, workspaceId: 'w',
    lastExecutionRef: null, occupancy: null, historyCursor: null, createdAt: T0, archivedAt: null,
    provenance: PROVENANCE_NEW, archiveRequest: null, ...overrides,
  };
}

function dispatchFacts(overrides: Partial<SessionDispatchGuardV1> = {}): SessionDispatchGuardV1 {
  return { purpose: 'work', waiting: null, consumedWait: null, readonlyQueryMatches: false, ...overrides };
}

function ctxOf(overrides: Partial<SessionGuardContext> = {}): SessionGuardContext {
  return {
    caller: 'service', hostLease: null, pin: null, holder: null, probe: null, kernelHeader: null,
    openResponsibleLink: null, creation: null, link: null, ...overrides,
  };
}

/** A refused admission carries the spec's code and no acquire effect of any kind. */
function expectRejection(result: Rejected | null, code: CoreError): void {
  expect(result).not.toBeNull();
  expect(result).toMatchObject({ ok: false, code });
  if (result !== null && result.ok === false) expect(result.detail.length).toBeGreaterThan(0);
  expect(result).not.toHaveProperty('effects');
}

/** An admitted claim runs the normal SES-02/SES-03 acquire at generation revision + 1. */
function expectAcquire(record: SessionRecord, holder: RunRef | QueryRunRef): void {
  const state = sessionMachineStateOf(record);
  expect(state).not.toBe('absent');
  if (state === 'absent') return;
  const generation = record.revision + 1;
  expect(transitionSession(state, { kind: 'occupancy_acquired', holder }, ctxOf({ pin: record.revision }))).toEqual({
    ok: true,
    next: { ...state, occupancy: { kind: 'execution', holder, generation }, revision: generation },
    effects: [{ kind: 'occupy_session', holder, generation }],
  });
}

describe('S1-dispatch: the Work/Query claim admission rows (S1-DISPATCH-01/02)', () => {
  it('UT26 a copy Session is forbidden ordinary Work and never acquires', () => {
    const record = sessionRecord({ provenance: PROVENANCE_COPY });
    expectRejection(sessionDispatchAdmissionProblem(record, dispatchFacts()), 'forbidden');
    expect(record.occupancy).toBeNull();
  });

  it('UT27/UT28 a Session waiting on m refuses ordinary Work as busy with no effects', () => {
    const record = sessionRecord();
    expectRejection(sessionDispatchAdmissionProblem(record, dispatchFacts({ waiting: WAIT_M })), 'busy');
    expect(record.occupancy).toBeNull();
  });

  it('UT29 a claim whose consumedWait is exactly the wait on m is admitted and acquires at revision + 1', () => {
    const record = sessionRecord();
    const facts = dispatchFacts({ waiting: WAIT_M, consumedWait: WAIT_M });
    expect(sessionDispatchAdmissionProblem(record, facts)).toBeNull();
    expectAcquire(record, RUN_0);
  });

  it('UT30 a pending archive request makes an idle Session busy with no effects', () => {
    const record = sessionRecord({ archiveRequest: ARCHIVE_REQUEST });
    expectRejection(sessionDispatchAdmissionProblem(record, dispatchFacts()), 'busy');
    expect(record.occupancy).toBeNull();
  });

  it('UT31 a copy admits only its pinned consultation Query and then acquires', () => {
    const record = sessionRecord({ provenance: PROVENANCE_COPY });
    const facts = dispatchFacts({ purpose: 'query', readonlyQueryMatches: true });
    expect(sessionDispatchAdmissionProblem(record, facts)).toBeNull();
    expectAcquire(record, QUERY_RUN);
  });

  it('UT43 a Work wait refuses a Query as busy with no effects', () => {
    const record = sessionRecord();
    expectRejection(sessionDispatchAdmissionProblem(record, dispatchFacts({ purpose: 'query', waiting: WAIT_M })), 'busy');
    expect(record.occupancy).toBeNull();
  });

  it('UT44 a consumedWait with the same message but another Task does not match the real wait and stays busy', () => {
    const record = sessionRecord();
    const facts = dispatchFacts({ waiting: WAIT_M, consumedWait: WAIT_OTHER_TASK });
    expectRejection(sessionDispatchAdmissionProblem(record, facts), 'busy');
    expect(record.occupancy).toBeNull();
  });

  it('UT45 a consumedWait on the same Task but another message does not match the real wait and stays busy', () => {
    const record = sessionRecord();
    const facts = dispatchFacts({ waiting: WAIT_M, consumedWait: WAIT_OTHER_MESSAGE });
    expectRejection(sessionDispatchAdmissionProblem(record, facts), 'busy');
    expect(record.occupancy).toBeNull();
  });

  it('UT46 a pending archive request makes an idle Session busy for a Query too', () => {
    const record = sessionRecord({ archiveRequest: ARCHIVE_REQUEST });
    expectRejection(sessionDispatchAdmissionProblem(record, dispatchFacts({ purpose: 'query' })), 'busy');
    expect(record.occupancy).toBeNull();
  });

  it('UT47 a copy running another Query than its pinned consultation one is forbidden', () => {
    const record = sessionRecord({ provenance: PROVENANCE_COPY });
    const facts = dispatchFacts({ purpose: 'query', readonlyQueryMatches: false });
    expectRejection(sessionDispatchAdmissionProblem(record, facts), 'forbidden');
    expect(record.occupancy).toBeNull();
  });

});
