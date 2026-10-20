/**
 * Slice 1 (Session facts, corrections and archive) unit rows UT16–UT22, UT42,
 * UT48 (spec §5.2).
 *
 * Pure state: the immutable anomaly anchor of `state/session-anomaly.ts`
 * (S1-ANCHOR-01/02, S1-TASK-02) and the Task archive label/next read
 * (`deriveTaskArchiveState`). No RecordStore, no Kernel. Every value is the
 * row's given/expected value; the part-1 stubs throw `not implemented: …`,
 * which is the expected RED.
 *
 * UT19–22, UT42 and UT48 assert label/next through `deriveTaskArchiveState`
 * (spec §0.3 #1): the inputs the rows do not name default to
 * `goalDesiredState='active'`, `phaseCause=null`, `reworkRefusal=null`,
 * `claimable=true`.
 */
import { describe, expect, it } from 'vitest';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { RoleConfigurationRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { RunRef, TaskAttemptRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { ArchiveChangedFilesV1, SessionAnomalyAnchorRef } from '../../src/contracts/session-anomaly.js';
import {
  deriveSessionAnomalyView, deriveTaskArchiveState, newSessionAnomalyAnchorRecord, transitionSessionAnomaly,
  type AnomalyGuardV1, type NewSessionAnomalyInputV1,
} from '../../src/core/work-graph/state/session-anomaly.js';

// --------------------------------------------------------------------------
// Fixtures (§5.1: p / w, S / D, Task A, r0 / r1, request a; t0 / t1)
// --------------------------------------------------------------------------

const T0 = '2026-10-08T00:00:00.000Z';
const T1 = '2026-10-09T00:00:00.000Z';

const TASK_A: TaskTriple = { projectId: 'p', goalId: 'g', taskId: 'A' };
const PLAN_REF: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: 'p', planId: 'plan-1' };
const SESSION_S: SessionRef = { projectId: 'p', sessionId: 'S' };
const SESSION_D: SessionRef = { projectId: 'p', sessionId: 'D' };
const ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'tpl-1', templateRevision: 'r1' };
const RUN_0: RunRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r0' };
const RUN_1: RunRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r1' };
const ATTEMPT: TaskAttemptRef = {
  aggregateType: 'TaskAttempt', projectId: 'p', goalId: 'g', taskId: 'A', attemptId: 'att-1',
};
const ANCHOR_REF: SessionAnomalyAnchorRef = {
  aggregateType: 'SessionAnomalyAnchor', projectId: 'p', goalId: 'g', runId: 'r0',
};
const RECEIPT = { identityKey: 's1-archive-step:k', fingerprint: 'fp-a' };
const ARCHIVED_BY = { kind: 'human', id: 'operator-1' } as Extract<ActorRef, { kind: 'human' | 'system' }>;
const CHANGED_FILES: ArchiveChangedFilesV1 = {
  source: 'kernel', status: 'known', confirmed: ['src/a.ts'], possible: [], omitted: 0,
  baseCommit: 'commit-1', runBaselineKnown: false, reason: null,
};

const ANOMALY_INPUT: NewSessionAnomalyInputV1 = {
  ref: ANCHOR_REF, workspaceId: 'w', task: TASK_A, planRef: PLAN_REF,
  lineHead: SESSION_S, sessionRef: SESSION_S, role: ROLE, runRef: RUN_0, attemptRef: ATTEMPT,
  cause: 'archive_interrupted', archiveRequestId: 'a', archiveRequestReceipt: RECEIPT,
  archivedBy: ARCHIVED_BY, recordedAt: T0, changedFiles: CHANGED_FILES, resultVerification: 'not_checked',
};

function anomalyGuard(overrides: Partial<AnomalyGuardV1> = {}): AnomalyGuardV1 {
  return { execution: 'work', stopped: true, taskTerminal: false, sameScope: true, requestMatches: true, ...overrides };
}

/** The §3.5 defaults for the label/next rows, then the row's own inputs. */
function archiveOf(
  views: Parameters<typeof deriveTaskArchiveState>[0]['views'],
  overrides: Partial<Parameters<typeof deriveTaskArchiveState>[0]> = {},
): ReturnType<typeof deriveTaskArchiveState> {
  return deriveTaskArchiveState({
    views, goalDesiredState: 'active', phaseCause: null, reworkRefusal: null, claimable: true, ...overrides,
  });
}

describe('S1-anomaly: the anchor machine and the Task archive label/next rows (S1-ANCHOR-01/02, S1-TASK-02)', () => {
  it('UT16 a stopped Work on a live Task records anchor revision 1 with one write and one event', () => {
    const result = transitionSessionAnomaly('absent', { kind: 'record', input: ANOMALY_INPUT }, anomalyGuard());
    const anchor = newSessionAnomalyAnchorRecord(ANOMALY_INPUT);
    expect(anchor).toMatchObject({ revision: 1, resultVerification: 'not_checked' });
    expect(result).toEqual({
      ok: true,
      next: anchor,
      effects: [
        { kind: 'write_anchor', anchor },
        { kind: 'emit_event', eventType: 'SessionAnomalyRecorded' },
      ],
    });
  });

  it('UT17 a Work whose outcome is still unknown stays busy and records no anchor', () => {
    const result = transitionSessionAnomaly('absent', { kind: 'record', input: ANOMALY_INPUT },
      anomalyGuard({ stopped: false }));
    expect(result).toMatchObject({ ok: false, code: 'busy' });
    if (!result.ok) expect(result.detail.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('next');
  });

  it('UT18 a QueryRun is invalid for the anchor machine and records no anchor', () => {
    const result = transitionSessionAnomaly('absent', { kind: 'record', input: ANOMALY_INPUT },
      anomalyGuard({ execution: 'query' }));
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    if (!result.ok) expect(result.detail.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('next');
  });

  it('UT19/UT21 only a claimed successor carries the anchor, so it is not picked up and the Task waits for dispatch', () => {
    const anchor = newSessionAnomalyAnchorRecord(ANOMALY_INPUT);
    // A claim is not an entered execution: the reader contributes no `entered` entry.
    const view = deriveSessionAnomalyView(anchor, []);
    expect(view).toEqual({ anchor, pickedUpBy: null });
    const archive = archiveOf([view]);
    expect(archive.pending).toEqual([view]);
    expect(archive.label).toBe('中断，待核对');
    expect(archive.next).toEqual({ kind: 'dispatch' });
  });

  it('UT20 an entered successor in another Session picks the anchor up and clears the label', () => {
    const anchor = newSessionAnomalyAnchorRecord(ANOMALY_INPUT);
    const entered = [{ runRef: RUN_1, sessionRef: SESSION_D, enteredAt: T1, anchorRefs: [ANCHOR_REF] }];
    const view = deriveSessionAnomalyView(anchor, entered);
    expect(view.pickedUpBy).toEqual(RUN_1);
    expect(view.anchor).toEqual(anchor);
    const sameLine = deriveSessionAnomalyView(anchor,
      [{ runRef: RUN_1, sessionRef: SESSION_S, enteredAt: T1, anchorRefs: [ANCHOR_REF] }]);
    expect(sameLine.pickedUpBy).toBeNull();
    const archive = archiveOf([view]);
    expect(archive.pending).toEqual([]);
    expect(archive.label).toBeNull();
    expect(archive.next).toBeNull();
  });

  it('UT22 a paused-interrupted Task with a pending anchor reads human_continue', () => {
    const anchor = newSessionAnomalyAnchorRecord(ANOMALY_INPUT);
    const view = deriveSessionAnomalyView(anchor, []);
    const archive = archiveOf([view], { phaseCause: { code: 'paused_interrupted' } });
    expect(archive.label).toBe('中断，待核对');
    expect(archive.next).toEqual({ kind: 'human_continue' });
  });

  it('UT42 an unfinished Goal paused with a pending anchor reads goal_stopped(paused) and cannot claim', () => {
    const anchor = newSessionAnomalyAnchorRecord(ANOMALY_INPUT);
    const view = deriveSessionAnomalyView(anchor, []);
    const archive = archiveOf([view], { goalDesiredState: 'paused' });
    expect(archive.label).toBe('中断，待核对');
    expect(archive.next).toEqual({ kind: 'goal_stopped', desiredState: 'paused' });
    expect(archive.next).not.toEqual({ kind: 'dispatch' });
  });

  it('UT48 an unfinished Goal cancelled with a pending anchor reads goal_stopped(cancelled)', () => {
    const anchor = newSessionAnomalyAnchorRecord(ANOMALY_INPUT);
    const view = deriveSessionAnomalyView(anchor, []);
    const archive = archiveOf([view], { goalDesiredState: 'cancelled' });
    expect(archive.label).toBe('中断，待核对');
    expect(archive.next).toEqual({ kind: 'goal_stopped', desiredState: 'cancelled' });
  });
});
