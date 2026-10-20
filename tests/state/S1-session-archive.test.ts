/**
 * Slice 1 (Session facts, corrections and archive) unit rows UT01–UT10, UT49,
 * UT50, UT54, UT55, UT56 (spec §5.2).
 *
 * Pure state: the archive request/lifecycle rows of `session-availability.ts`
 * (S1-SES-02..06) and the executor due derivation (S1-AUTO-01). No RecordStore,
 * no Kernel. Every value is the row's given/expected value; the part-1 stubs
 * throw `not implemented: …`, which is the expected RED.
 */
import { describe, expect, it } from 'vitest';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { RoleConfigurationRef, SessionAggregateRef } from '../../src/contracts/core/identity.js';
import type { SessionArchiveRequestV1 } from '../../src/contracts/core/session-archive.js';
import type { SessionProvenanceV1, SessionRecord } from '../../src/contracts/core/session.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import {
  executorArchiveDue, reactivateSessionRecord,
  releaseSessionArchiveRequestRecord, requestSessionArchiveRecord, transitionSession,
  type SessionArchiveGuardV1, type SessionEvent, type SessionGuardContext, type SessionMachineState,
} from '../../src/core/work-graph/state/session-availability.js';

// --------------------------------------------------------------------------
// Fixtures (§5.1: p / w, S / D, A / B, r0 / r1, m, request a; t0 / t1)
// --------------------------------------------------------------------------

const T0 = '2026-10-08T00:00:00.000Z';
const T1 = '2026-10-09T00:00:00.000Z';
const T1_MINUS_1MS = '2026-10-08T23:59:59.999Z';
const DAY_MS = 86_400_000;

const S_REF: SessionAggregateRef = { aggregateType: 'Session', projectId: 'p', sessionId: 'S' };
const RUN_0: RunRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r0' };
const ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'tpl-1', templateRevision: 'r1' };

const PROVENANCE_NEW: SessionProvenanceV1 = { schemaVersion: 1, kind: 'new' };

function archiveRequest(id: string): SessionArchiveRequestV1 {
  return {
    schemaVersion: 1, requestId: id,
    requestedBy: { kind: 'human', id: 'operator-1' } as Extract<ActorRef, { kind: 'human' | 'system' }>,
    requestedAt: T0, reason: 'the operator asked to archive this line', mode: 'operator',
    tasks: [], wait: null, execution: { kind: 'none' }, executionPins: [], confirmUnknownStopped: false,
    receipt: { identityKey: `s1-archive-step:${id}`, fingerprint: `fp-${id}` },
  };
}

const REQUEST_A = archiveRequest('a');
const REQUEST_B = archiveRequest('b');

function sessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    ref: S_REF, revision: 7, kernel: { adapterId: 'coding-agent', kernelSessionId: 'k-S' },
    lifecycle: 'active', health: 'available', healthConclusion: null, role: ROLE, workspaceId: 'w',
    lastExecutionRef: RUN_0, occupancy: { kind: 'execution', executionRef: RUN_0, generation: 7 },
    historyCursor: null, createdAt: T0, archivedAt: null, provenance: PROVENANCE_NEW, archiveRequest: null,
    ...overrides,
  };
}

type ActiveState = Exclude<SessionMachineState, 'absent'>;

function machineState(overrides: Partial<ActiveState> = {}): ActiveState {
  return {
    lifecycle: 'active', health: 'available', healthConclusion: null,
    occupancy: { kind: 'execution', holder: RUN_0, generation: 7 }, revision: 7,
    provenance: PROVENANCE_NEW, archiveRequest: null,
    ...overrides,
  };
}

function archiveGuard(overrides: Partial<SessionArchiveGuardV1> = {}): SessionArchiveGuardV1 {
  return {
    requestMatches: true, choicesValid: true, authorityValid: true,
    wait: 'not_waiting', retired: false, sourceExecutionStopped: true,
    stopQueued: false, failedDisposal: false,
    ...overrides,
  };
}

function ctx(overrides: Partial<SessionGuardContext> = {}): SessionGuardContext {
  return {
    caller: 'service', hostLease: null, pin: null, holder: null, probe: null, kernelHeader: null,
    openResponsibleLink: null, creation: null, link: null, ...overrides,
  };
}

describe('S1-session-archive: the Session archive state rows (S1-SES-02..06, S1-AUTO-01)', () => {
  it('UT01 archive_requested keeps the running occupancy generation and writes request a', () => {
    const state = machineState();
    const event: SessionEvent = { kind: 'archive_requested', archive: REQUEST_A };
    expect(transitionSession(state, event, ctx({ pin: 7, archive: archiveGuard() }))).toEqual({
      ok: true,
      next: { ...state, revision: 8, archiveRequest: REQUEST_A },
      effects: [
        { kind: 'write_archive_request', archive: REQUEST_A },
        { kind: 'emit_event', eventType: 'SessionArchiveRequested' },
      ],
    });
    const record = sessionRecord();
    expect(requestSessionArchiveRecord(record, REQUEST_A)).toEqual({
      ...record, revision: 8, archiveRequest: REQUEST_A,
    });
  });

  it('UT02 archive_requested with a different request on a pending Session is busy and changes nothing', () => {
    const state = machineState({ archiveRequest: REQUEST_A, revision: 8 });
    const frozen = { ...state };
    const result = transitionSession(state, { kind: 'archive_requested', archive: REQUEST_B },
      ctx({ pin: 8, archive: archiveGuard() }));
    expect(result).toMatchObject({ ok: false, reason: 'guard_failed', code: 'busy' });
    expect(state).toEqual(frozen);
  });

  it('UT03 archive_requested on an archived Session is invalid and has no effects', () => {
    const state = machineState({ lifecycle: 'archived', occupancy: null });
    const result = transitionSession(state, { kind: 'archive_requested', archive: REQUEST_A },
      ctx({ pin: 7, archive: archiveGuard() }));
    expect(result).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    expect(result).not.toHaveProperty('effects');
  });

  it('UT04 session_archived of a waiting Session is busy until the wait is disposed', () => {
    const state = machineState({ occupancy: null, archiveRequest: REQUEST_A });
    const result = transitionSession(state, { kind: 'session_archived' },
      ctx({ pin: 7, openResponsibleLink: false, archive: archiveGuard({ wait: 'waiting' }) }));
    expect(result).toMatchObject({ ok: false, reason: 'guard_failed', code: 'busy' });
    if (!result.ok) expect(result.detail.startsWith('archive_wait_disposal_required:')).toBe(true);
  });

  it('UT05 a retired Session archives despite the wait, clears request a and emits no wait effect', () => {
    // A retired Session looks retired in its facts: its Kernel Turn was left open
    // (health unavailable / kernel_turn_open), so it can never run again.
    const state = machineState({
      occupancy: null, archiveRequest: REQUEST_A,
      health: 'unavailable', healthConclusion: 'kernel_turn_open',
    });
    expect(transitionSession(state, { kind: 'session_archived' },
      ctx({ pin: 7, openResponsibleLink: false, archive: archiveGuard({ wait: 'waiting', retired: true }) }))).toEqual({
      ok: true,
      next: { ...state, lifecycle: 'archived', archiveRequest: null, revision: 8 },
      effects: [
        { kind: 'archive_session' },
        { kind: 'clear_archive_request' },
        { kind: 'emit_event', eventType: 'SessionArchived' },
      ],
    });
  });

  it('UT06 an occupied Session is busy before the link and wait failures', () => {
    const state = machineState({ archiveRequest: REQUEST_A });
    const result = transitionSession(state, { kind: 'session_archived' },
      ctx({ pin: 7, openResponsibleLink: 'task', archive: archiveGuard({ wait: 'waiting' }) }));
    expect(result).toMatchObject({ ok: false, reason: 'guard_failed', code: 'busy' });
  });

  it('UT07 reactivating an unavailable archived Session is unavailable and stays archived', () => {
    const state = machineState({
      lifecycle: 'archived', health: 'unavailable', healthConclusion: 'kernel_turn_open',
      occupancy: null, revision: 9, archiveRequest: null,
    });
    const result = transitionSession(state, { kind: 'session_reactivated' }, ctx({ pin: 9 }));
    expect(result).toMatchObject({ ok: false, reason: 'guard_failed', code: 'unavailable' });
    expect(state.lifecycle).toBe('archived');
  });

  it('UT08 reactivating an available archived Session clears archivedAt and keeps the health', () => {
    const state = machineState({
      lifecycle: 'archived', health: 'available', healthConclusion: null,
      occupancy: null, revision: 9, archiveRequest: null,
    });
    expect(transitionSession(state, { kind: 'session_reactivated' }, ctx({ pin: 9 }))).toEqual({
      ok: true,
      next: { ...state, lifecycle: 'active', revision: 10 },
      effects: [
        { kind: 'reactivate_session' },
        { kind: 'emit_event', eventType: 'SessionReactivated' },
      ],
    });
    const record = sessionRecord({ lifecycle: 'archived', revision: 9, archivedAt: T0, occupancy: null });
    expect(reactivateSessionRecord(record)).toEqual({
      ...record, lifecycle: 'active', revision: 10, archivedAt: null,
    });
  });

  it('UT49 releasing request a while its stop is queued stays busy with the request and revision', () => {
    const state = machineState({ occupancy: null, archiveRequest: REQUEST_A });
    const frozen = { ...state };
    const result = transitionSession(state, { kind: 'archive_request_released', archiveRequestId: 'a' },
      ctx({ pin: 7, archive: archiveGuard({ failedDisposal: true, sourceExecutionStopped: true, stopQueued: true }) }));
    expect(result).toMatchObject({ ok: false, reason: 'guard_failed', code: 'busy' });
    expect(state.archiveRequest?.requestId).toBe('a');
    expect(state.revision).toBe(7);
    expect(state).toEqual(frozen);
  });

  it('UT50 a failed disposal with a stopped execution and no queued stop clears request a', () => {
    const state = machineState({ occupancy: null, archiveRequest: REQUEST_A });
    expect(transitionSession(state, { kind: 'archive_request_released', archiveRequestId: 'a' },
      ctx({ pin: 7, archive: archiveGuard({ failedDisposal: true, sourceExecutionStopped: true, stopQueued: false }) }))).toEqual({
      ok: true,
      next: { ...state, archiveRequest: null, revision: 8 },
      effects: [
        { kind: 'clear_archive_request' },
        { kind: 'emit_event', eventType: 'SessionArchiveRequestReleased' },
      ],
    });
    const record = sessionRecord({ occupancy: null, archiveRequest: REQUEST_A });
    expect(releaseSessionArchiveRequestRecord(record)).toEqual({
      ...record, revision: 8, archiveRequest: null,
    });
  });

  it('UT54 executorArchiveDue is false one millisecond before the one-day threshold', () => {
    const session = sessionRecord({ occupancy: null, archiveRequest: null, revision: 9 });
    const frozen = { ...session };
    expect(executorArchiveDue({
      duty: 'executor', session, unfinishedResponsibility: false, waiting: false,
      openModuleResponsibility: false, finishedAt: T0, now: T1_MINUS_1MS, thresholdMs: DAY_MS,
    })).toBe(false);
    expect(session).toEqual(frozen);
  });

  it('UT55 executorArchiveDue is true exactly at the one-day threshold', () => {
    const session = sessionRecord({ occupancy: null, archiveRequest: null, revision: 9 });
    const frozen = { ...session };
    expect(executorArchiveDue({
      duty: 'executor', session, unfinishedResponsibility: false, waiting: false,
      openModuleResponsibility: false, finishedAt: T0, now: T1, thresholdMs: DAY_MS,
    })).toBe(true);
    expect(session).toEqual(frozen);
  });

  it('UT56 an open module responsibility keeps the due executor line out of automatic archive', () => {
    const session = sessionRecord({ occupancy: null, archiveRequest: null, revision: 9 });
    const frozen = { ...session };
    expect(executorArchiveDue({
      duty: 'executor', session, unfinishedResponsibility: false, waiting: false,
      openModuleResponsibility: true, finishedAt: T0, now: T1, thresholdMs: DAY_MS,
    })).toBe(false);
    expect(session).toEqual(frozen);
  });
});
