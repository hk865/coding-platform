/**
 * Slice 2B round-2 R12 helper: the public verification round owner over the
 * accepted `S2B-activity-fixture` store, so 2B-24 can open a real round, record
 * a failing check result, finalize it FAIL, and then open the successor round on
 * the SAME task's subject Run through the public `reverifyRound` (VD-12/VR-14).
 *
 * The fixture only exposed open/begin; this companion `createEvidenceService`
 * is built over the same records, bodies and trusted static configuration, so
 * the public `recordCheckResult` / `finalizeChecks` / `reverifyRound` all run on
 * the real owner. Nothing here writes a record directly.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { CheckExecutionTicket, CheckProcessObservation, RoundSnapshot, TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { EvidencePort } from '../../src/core/work-graph/model/evidence-contracts.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { DEFAULT_TASK_AUTOMATION_POLICY } from '../../src/contracts/task-requeue.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import {
  openS2BActivityFixture, type S2BActivityFixture,
} from './S2B-activity-fixture.js';

const CONFIGURATION_REVISION = 's2b-r2-calendar-checks';
const PERMISSION_REVISION = 's2b-r2-calendar-permission';
const SOURCE_DIGEST = sha256Hex('s2b-r2-calendar-source');

export type CalendarReverifyFixture = {
  f: S2BActivityFixture;
  evidence: EvidencePort;
  openRound(subjectRunRef: RunRef, taskId: string): Promise<RoundSnapshot>;
  begin(round: RoundSnapshot, checkId: string): Promise<CheckExecutionTicket>;
  recordFail(round: RoundSnapshot, ticket: CheckExecutionTicket): Promise<RoundSnapshot>;
  finalize(round: RoundSnapshot): Promise<RoundSnapshot>;
  reverify(predecessor: RoundSnapshot, requestId: string): Promise<RoundSnapshot>;
};

export async function openCalendarReverifyFixture(kind: 'memory' | 'sqlite'): Promise<CalendarReverifyFixture> {
  const f = await openS2BActivityFixture(kind);
  const records = f.b2.base.records;
  const now = (): string => f.clock();
  let seq = 0;
  const configuration: TrustedCheckConfiguration = {
    configurationRevision: CONFIGURATION_REVISION, workspace: f.b2.base.workspaceRef,
    executor: { kind: 'human', id: 'r4c-claim-operator' },
    permissionRevision: PERMISSION_REVISION,
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: [],
    checks: [1, 2, 3, 4].map((n) => ({ checkId: `check-${String(n)}`, kind: 'static', command: 'fixture-check',
      cwd: '.', timeoutMs: 1000, taskIds: 'all' })),
  };
  const evidence = createEvidenceService({
    records,
    executions: createRunStateReader({ records }),
    materials: createMaterialService({ bodies: f.b2.bodies,
      authority: createMaterialRecordReaders(records).authority, now }),
    workspaceHost: {
      async resolveRoot() { return { status: 'ready' as const, value: { root: f.b2.base.directory, workspaceRevision: 1 } }; },
      async authorize() { return { status: 'ready' as const, value: { subjectKey: 's2b-r2-calendar-host',
        permissionRevision: PERMISSION_REVISION, allowsRead: () => true } }; },
    },
    source: { async capture() { return { status: 'ready' as const, sourceDigest: SOURCE_DIGEST,
      sourceProof: { kind: 'current-workspace-only' as const, runBaselineKnown: false },
      changeScope: { diffClass: 'code-change', changedFiles: ['src/s2b/a.ts'], writeSummary: 's2b r2 calendar source' },
      gaps: [] }; } },
    configuration,
    automationPolicy: () => DEFAULT_TASK_AUTOMATION_POLICY,
    now, newId: () => `s2b-r2-calendar-new-${++seq}`,
  });

  async function planRef(): Promise<PlanRevisionRef> {
    const read = await f.b2.base.plans.queryGoal(f.ctx, f.goalRef);
    if (read.status !== 'ready' || read.value.goal.activePlanRevision === null) {
      throw new Error('the S2B activity Goal has no accepted plan');
    }
    return read.value.goal.activePlanRevision;
  }

  function executedFail(): CheckProcessObservation {
    return { kind: 'executed', startedAt: now(), finishedAt: now(), exitCode: 1, signal: null, timedOut: false, cancelled: false,
      stdout: { text: 'S2B_R2_FAILED\n', totalBytes: 15, truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
      effects: { workspaceRevision: 's2b-r2-workspace-revision-1', changedPaths: [] }, sandboxProfileVersion: 'bwrap-m3-v4' };
  }

  async function openRound(subjectRunRef: RunRef, taskId: string): Promise<RoundSnapshot> {
    const opened = await evidence.openVerification(f.ctx, {
      input: { subjectRunRef, subject: { projectId: f.goalRef.projectId, goalId: f.goalRef.goalId, taskId },
        planRef: await planRef() },
      meta: { requestId: `s2b-r2-calendar-open-${++seq}`, expected: [] },
    });
    if (opened.status !== 'committed') throw new Error(`S2B r2 openVerification failed: ${JSON.stringify(opened)}`);
    return opened.value;
  }

  async function begin(round: RoundSnapshot, checkId: string): Promise<CheckExecutionTicket> {
    const ticket = await evidence.beginCheck(f.ctx, {
      input: { roundRef: round.ref, checkId },
      meta: { requestId: `s2b-r2-calendar-begin-${++seq}`, expected: [{ ref: round.ref, revision: round.revision }] },
    });
    if (ticket.status !== 'committed') throw new Error(`S2B r2 beginCheck failed: ${JSON.stringify(ticket)}`);
    return ticket.value;
  }

  async function latest(round: RoundSnapshot): Promise<RoundSnapshot> {
    const read = await evidence.readVerification(f.ctx, round.ref);
    if (read.status !== 'ready') throw new Error(`S2B r2 round read failed: ${JSON.stringify(read)}`);
    return read.value;
  }

  async function recordFail(round: RoundSnapshot, ticket: CheckExecutionTicket): Promise<RoundSnapshot> {
    const current = await latest(round);
    const recorded = await evidence.recordCheckResult(f.ctx, {
      input: { roundRef: round.ref, checkId: ticket.checkId, invocationId: ticket.invocationId, observation: executedFail() },
      meta: { requestId: `s2b-r2-calendar-record-${++seq}`, expected: [{ ref: current.ref, revision: current.revision }] },
    } as GraphWrite<{ roundRef: RoundSnapshot['ref']; checkId: string; invocationId: string;
      observation: CheckProcessObservation }>);
    if (recorded.status !== 'committed') throw new Error(`S2B r2 recordCheckResult failed: ${JSON.stringify(recorded)}`);
    return recorded.value;
  }

  async function finalize(round: RoundSnapshot): Promise<RoundSnapshot> {
    const current = await latest(round);
    const finalized = await evidence.finalizeChecks(f.ctx, {
      input: { roundRef: round.ref },
      meta: { requestId: `s2b-r2-calendar-finalize-${++seq}`, expected: [{ ref: current.ref, revision: current.revision }] },
    });
    if (finalized.status !== 'committed') throw new Error(`S2B r2 finalizeChecks failed: ${JSON.stringify(finalized)}`);
    return finalized.value.snapshot;
  }

  async function reverify(predecessor: RoundSnapshot, requestId: string): Promise<RoundSnapshot> {
    if (evidence.reverifyRound === undefined) throw new Error('the evidence port has no reverifyRound');
    const result = await evidence.reverifyRound(f.ctx, {
      input: { predecessorRoundRef: predecessor.ref },
      meta: { requestId, expected: [{ ref: predecessor.ref, revision: predecessor.revision }] },
    } as GraphWrite<{ predecessorRoundRef: RoundSnapshot['ref'] }>);
    if (result.status !== 'committed') throw new Error(`S2B r2 reverifyRound failed: ${JSON.stringify(result)}`);
    if (result.value.kind !== 'reverified') throw new Error(`S2B r2 reverify was refused: ${JSON.stringify(result.value)}`);
    return result.value.round;
  }

  return { f, evidence, openRound, begin, recordFail, finalize, reverify };
}

/** The fixture's call context (a host principal), kept for callers. */
export type CalendarReverifyContext = CoreCallContext;
