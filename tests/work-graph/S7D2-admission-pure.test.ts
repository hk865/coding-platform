/**
 * 7D2 A1a: the running cap's pure half. The group map, the count-once rule,
 * the pure admission decision, the derived Run wait, the Query marker codec and
 * the at-cap detail produced by `seatAtCap`.
 *
 * A5: a pure table. Every input is constructed here and every expected value is
 * a hand-computed literal.
 */
import { describe, expect, it } from 'vitest';
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import type { ExecutionAuthorizationV2, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { QueryExecutionStateV1, QueryRunRef, QueryRunSnapshot } from '../../src/contracts/query-job.js';
import type { RoleLimitsNumbersV1 } from '../../src/contracts/role-lines.js';
import {
  admitModelCall, countRunningAdmission, runningGroupOf,
  type RunningAdmissionPhase, type RunningAdmissionVerdict, type RunningGroup,
} from '../../src/core/work-graph/state/running-admission.js';
import { runAdmissionWaitOf } from '../../src/contracts/dispatch.js';
import {
  decodeQueryExecutionRecordedEvent, decodeQueryRunSnapshotRecord,
  encodeQueryExecutionRecordedEvent, encodeQueryRunSnapshotRecord,
  type QueryExecutionRecordedEventV1,
} from '../../src/core/work-graph/queries/query-record-codecs.js';
import { seatAtCap } from '../../src/core/work-graph/sessions/allocation-read.js';

const LIMITS: RoleLimitsNumbersV1 = { secretary: 4, adviser: 4, scribe: 2, executor: 8 };
const ZERO = { secretary: 0, adviser: 0, scribe: 0, executor: 0 } satisfies Record<RunningGroup, number>;

type GroupCase = { duty: PlatformDutyV1 | 'unknown'; group: RunningGroup };
type DecisionCase = {
  name: string; duty: PlatformDutyV1 | 'unknown'; counts: Record<RunningGroup, number>;
  verdict: RunningAdmissionVerdict;
};

describe('the five-duty group map', () => {
  it.each<GroupCase>([
    { duty: 'secretary', group: 'secretary' },
    { duty: 'adviser', group: 'adviser' },
    { duty: 'scribe', group: 'scribe' },
    { duty: 'executor', group: 'executor' },
    { duty: 'reviewer', group: 'executor' },
    { duty: 'unknown', group: 'executor' },
  ])('$duty maps to the group it runs in', ({ duty, group }) => {
    expect(group).toBe(runningGroupOf(duty));
  });
});

describe('the pure admission decision', () => {
  it.each<DecisionCase>([
    {
      name: 'under the cap admits',
      duty: 'secretary', counts: { ...ZERO, secretary: 3 }, verdict: { status: 'admitted' },
    },
    {
      name: 'at the cap rejects busy/running_cap',
      duty: 'adviser', counts: { ...ZERO, adviser: 4 },
      verdict: { status: 'rejected', code: 'busy', reason: 'running_cap' },
    },
    {
      name: 'an unknown duty counts as executor: at the executor cap rejects busy/running_cap',
      duty: 'unknown', counts: { ...ZERO, executor: 8 },
      verdict: { status: 'rejected', code: 'busy', reason: 'running_cap' },
    },
  ])('$name', ({ duty, counts, verdict }) => {
    expect(verdict).toEqual(admitModelCall({ duty, limits: LIMITS, counts }));
  });
});

type CountCase = {
  name: string; entries: { duty: PlatformDutyV1 | 'unknown'; phase: RunningAdmissionPhase }[];
  counts: Record<RunningGroup, number>;
};

describe('the count-once rule', () => {
  it.each<CountCase>([
    {
      name: 'entering, entered and unknown each count once in their own group',
      entries: [
        { duty: 'secretary', phase: 'entering' },
        { duty: 'adviser', phase: 'entered' },
        { duty: 'scribe', phase: 'unknown' },
      ],
      counts: { secretary: 1, adviser: 1, scribe: 1, executor: 0 },
    },
    {
      name: 'authorized, prepared and no phase count nothing',
      entries: [
        { duty: 'executor', phase: 'authorized' },
        { duty: 'secretary', phase: 'prepared' },
        { duty: 'adviser', phase: undefined },
      ],
      counts: ZERO,
    },
    {
      name: 'a reviewer counts in the executor group',
      entries: [{ duty: 'reviewer', phase: 'entered' }],
      counts: { ...ZERO, executor: 1 },
    },
    {
      name: 'an unknown duty counts in the executor group',
      entries: [{ duty: 'unknown', phase: 'entered' }],
      counts: { ...ZERO, executor: 1 },
    },
    {
      name: 'two adviser entries count two',
      entries: [{ duty: 'adviser', phase: 'entering' }, { duty: 'adviser', phase: 'entered' }],
      counts: { ...ZERO, adviser: 2 },
    },
  ])('$name', ({ entries, counts }) => {
    expect(countRunningAdmission(entries)).toEqual(counts);
  });
});

const AUTHORIZATION: ExecutionAuthorizationV2 = {
  schemaVersion: 2, generation: 1, sessionGeneration: 1, revision: 1,
  consumerId: 'consumer-1', inputDigest: 'd'.repeat(64), phase: 'authorized', kernel: null,
};

type WaitCase = {
  name: string; status: RunSnapshot['status']; authorization: ExecutionAuthorizationV2 | null; atCap: boolean;
  wait: 'running_cap' | null;
};

describe('the derived Run wait', () => {
  it.each<WaitCase>([
    {
      name: 'starting with authorized and the group at cap waits',
      status: 'starting', authorization: AUTHORIZATION, atCap: true, wait: 'running_cap',
    },
    {
      name: 'starting with authorized but a free slot does not wait',
      status: 'starting', authorization: AUTHORIZATION, atCap: false, wait: null,
    },
    {
      name: 'a running Run never waits',
      status: 'running', authorization: AUTHORIZATION, atCap: true, wait: null,
    },
    {
      name: 'starting while entering does not wait',
      status: 'starting', authorization: { ...AUTHORIZATION, phase: 'entering' }, atCap: true, wait: null,
    },
    {
      name: 'starting without an authorization does not wait',
      status: 'starting', authorization: null, atCap: true, wait: null,
    },
  ])('$name', ({ status, authorization, atCap, wait }) => {
    const run = { status, ...(authorization === null ? {} : { executionAuthorization: authorization }) };
    expect(runAdmissionWaitOf(run, atCap)).toBe(wait);
  });
});

const runRef: QueryRunRef = {
  aggregateType: 'QueryRun', projectId: 'P', workspaceId: 'W', queryJobId: 'QJ-1', runId: 'QR-1',
};
const ROLE_BINDING = {
  schemaVersion: 1 as const, bindingId: 'binding-1', templateId: 'tpl-1', templateRevision: 'r1',
  bindingVersion: 1, policyRevision: 'policy-1',
};

function executionState(admissionWait: 'running_cap' | null): QueryExecutionStateV1 {
  return {
    schemaVersion: 1,
    phase: 'prepared',
    sessionRef: { projectId: 'P', sessionId: 'S-1' },
    sessionGeneration: 1,
    role: { kind: 'legacy_template', templateId: 'tpl-1', templateRevision: 'r1' },
    roleBinding: ROLE_BINDING,
    roleResolution: { status: 'absent', roleId: 'role-1', reason: 'no role spec' },
    priorHistoryCursor: null,
    prepared: null,
    entry: null,
    history: null,
    requests: [],
    requestProfile: null,
    admissionWait,
  };
}

function snapshot(admissionWait: 'running_cap' | null): QueryRunSnapshot {
  return {
    ref: runRef,
    revision: 2,
    schemaVersion: 1,
    run: {
      schemaVersion: 1,
      queryJobRef: { aggregateType: 'QueryJob', projectId: 'P', workspaceId: 'W', queryJobId: 'QJ-1' },
      runId: 'QR-1',
      status: 'pending',
      startedAt: null,
      endedAt: null,
      outcome: null,
      executionState: executionState(admissionWait),
    },
  };
}

function waitingEvent(): QueryExecutionRecordedEventV1 {
  return {
    eventId: 'event-waiting-1',
    eventType: 'QueryExecutionRecorded',
    schemaVersion: 1,
    identityKey: 'identity-waiting-1',
    fingerprint: 'a'.repeat(64),
    projectId: 'P',
    workspaceId: 'W',
    aggregateType: 'QueryRun',
    aggregateId: 'QR-1',
    aggregateRevision: 2,
    causationId: 'cause-1',
    correlationId: 'correlation-1',
    idempotencyKey: 'idempotency-1',
    actor: { kind: 'human', id: 'operator' },
    occurredAt: '2026-11-03T00:00:00.000Z',
    payload: {
      queryRunRef: runRef,
      operation: 'waiting',
      result: snapshot('running_cap'),
      phase: 'prepared',
      executionState: executionState('running_cap'),
    },
  };
}

describe('the Query marker event round-trip', () => {
  it('the waiting operation and its running_cap marker survive encode/decode', () => {
    const decoded = decodeQueryExecutionRecordedEvent(encodeQueryExecutionRecordedEvent(waitingEvent()));
    expect(decoded.status).toBe('decoded');
    if (decoded.status === 'decoded') {
      expect(decoded.value.payload.operation).toBe('waiting');
      expect(decoded.value.payload.executionState?.admissionWait).toBe('running_cap');
    }
  });
});

describe('the Query marker snapshot round-trip', () => {
  it.each([null, 'running_cap'] as const)('admissionWait %s round-trips', (admissionWait) => {
    const decoded = decodeQueryRunSnapshotRecord(encodeQueryRunSnapshotRecord(snapshot(admissionWait)));
    expect(decoded.status).toBe('decoded');
    if (decoded.status === 'decoded') {
      expect(decoded.value.run.executionState?.admissionWait).toBe(admissionWait);
    }
  });
});

type CapCase = {
  name: string; input: { duty: 'secretary' | 'executor'; open: number; holders: number; reservations: number };
  expected: ReturnType<typeof seatAtCap>;
};

describe('the at-cap detail produced by seatAtCap', () => {
  it.each<CapCase>([
    {
      name: 'at the cap names the four counted facts with no episode',
      input: { duty: 'secretary', open: 8, holders: 8, reservations: 0 },
      expected: {
        status: 'rejected', code: 'capacity',
        reason: 'at_cap: secretary has 8 holder(s) and 0 reservation(s) against open limit 8',
        detail: { duty: 'secretary', holders: 8, reservations: 0, open: 8, episode: null },
      },
    },
  ])('$name', ({ input, expected }) => {
    expect(seatAtCap(input)).toEqual(expected);
  });
});
