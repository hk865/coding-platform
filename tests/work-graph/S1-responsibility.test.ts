/**
 * Slice 1 §5.3 SV16–SV20 and SV47: the Session responsibility write owner
 * (`createSessionResponsibilityService`) over the real Memory/SQLite
 * RecordStore, with the trusted Task basis built by
 * `createSessionResponsibilityBasisReader` and the real Session lifecycle
 * writer used only to open the source link.
 *
 * Every committed result must come from the formal service; no link is
 * fabricated to prove a transfer. Part 1 ships only throwing stubs, so every
 * row is expected RED at its first `not implemented:` call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AggregateRef } from '../../src/contracts/ledger.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type {
  SessionRef, SessionWorkLinkRef, VersionPin, WorkLinkTarget,
} from '../../src/contracts/core/identity.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { SessionWorkLink } from '../../src/contracts/core/session.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GraphWrite } from '../../src/core/work-graph/model/session-contracts.js';
import type {
  ArchiveSessionInput, LinkSessionWorkInput, SessionLifecyclePort,
} from '../../src/core/work-graph/sessions/lifecycle-contracts.js';
import {
  createSessionResponsibilityService, type SessionResponsibilityPort,
} from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { createSessionResponsibilityBasisReader } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { commitBarrier } from '../helpers/graph-session-fixture.js';
import {
  type B2ExecutionFixture, type B2Records,
} from '../helpers/B2-execution-fixture.js';
import type { TaskClaimFixture } from '../helpers/task-claim-fixture.js';
import {
  createR3eEvidenceFixture, R3E_WORK_TASK_ID, type R3eEvidenceFixture,
} from '../helpers/R3e-evidence-fixture.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { CheckProcessObservation, RoundSnapshot } from '../../src/contracts/verification.js';
import {
  checkAllInvariants, invariantStoreOf, readInvariantWorld,
} from '../state/invariants.js';

import { s1Schemas, observeStore, workHistory, createSession as createScopedSession, type StoreObservation } from '../helpers/S1-session-facts-fixture.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';

/** §5.1 fixed clocks; the new owner's injected `now`, never the fixture's `B2_AT`. */
const t0 = '2026-10-08T00:00:00.000Z';
const t1 = '2026-10-09T00:00:00.000Z';

/**
 * G2: every bundle the real path writes/reads. `linkSessionWork` writes
 * `SessionWorkLink` and emits `SessionWorkLinkChanged`; the terminal proof in
 * SV19 runs the formal completion path and emits `TaskCompleted`.
 */
const S1_RESPONSIBILITY_SCHEMAS = s1Schemas(true);

type LinkTransfer = { from: SessionWorkLink; to: SessionWorkLink };
type TransferInput = { from: SessionRef; to: SessionRef; target: WorkLinkTarget };

type Opened = {
  b2: B2ExecutionFixture;
  /** The real R3e evidence fixture over the same store: SV19's terminal proofs. */
  r3e: R3eEvidenceFixture;
  base: TaskClaimFixture;
  records: B2Records;
  audit: StoreObservation;
  responsibilities: SessionResponsibilityPort;
  lifecycle: SessionLifecyclePort;
  S: SessionRef;
  D: SessionRef;
  A: TaskTriple;
  B: TaskTriple;
  r0: RunRef;
  pinOf(ref: AggregateRef): Promise<VersionPin>;
  sessionPin(ref: SessionRef): Promise<VersionPin>;
  sessionRevision(ref: SessionRef): Promise<number>;
  goalPinOf(goalId: string): Promise<VersionPin>;
  linksOf(ref: SessionRef): Promise<SessionWorkLink[]>;
  openLink(ref: SessionRef, target: WorkLinkTarget, requestId: string): Promise<WriteResult<SessionWorkLink>>;
  transferRequest(from: SessionRef, to: SessionRef, target: WorkLinkTarget, requestId: string): Promise<GraphWrite<TransferInput>>;
  transfer(from: SessionRef, to: SessionRef, target: WorkLinkTarget, requestId: string): Promise<WriteResult<LinkTransfer>>;
  closeTerminal(ref: SessionRef, target: WorkLinkTarget, requestId: string): Promise<WriteResult<SessionWorkLink>>;
  archiveSessionRequest(ref: SessionRef, requestId: string): Promise<GraphWrite<ArchiveSessionInput>>;
  /** The owner's injected clock (t0 by default); rows that need `t1` advance it. */
  setNow(value: string): void;
  /** The formal B2 path that leaves the source Task's writer running. */
  startRun(): Promise<void>;
  /** The formal B2 path that ends the source Task's writer. */
  endRun(): Promise<void>;
  /** The formal B2 path that fails the second Goal's Task writer while its Task stays non-terminal. */
  crashSecondRun(): Promise<void>;
};

/** A committed write's value; a failing step fails the row with its own message. */
function committedResult<T>(result: WriteResult<T>): Extract<WriteResult<T>, { status: 'committed' }> {
  expect(result, 'the write must commit').toMatchObject({ status: 'committed' });
  if (result.status !== 'committed') {
    throw new Error(`the write did not commit: ${JSON.stringify(result)}`);
  }
  return result;
}
function committed<T>(result: WriteResult<T>): T {
  return committedResult(result).value;
}

/**
 * G4: after a real mutation, the whole store must still satisfy §11. The
 * checker reads a SQLite file; the memory backend has no read window, so only
 * the sqlite row runs it.
 */
async function invariantsHold(f: Opened, label: string): Promise<void> {
  if (f.base.kind !== 'sqlite') return;
  const world = await readInvariantWorld(invariantStoreOf(f.base.directory), f.base.scope.projectId);
  expect(checkAllInvariants(world), `${label}: invariant violations`).toEqual([]);
}

const opened: Opened[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t0); });
afterEach(async () => {
  for (const fixture of opened.splice(0)) await fixture.r3e.close(); vi.restoreAllMocks(); vi.useRealTimers();
});

async function open(kind: 'memory' | 'sqlite'): Promise<Opened> {
  // The real evidence fixture composes the same B2 store and adds the formal
  // completion path SV19 needs; every other row uses only its `b2`.
  const r3e = await createR3eEvidenceFixture(kind, S1_RESPONSIBILITY_SCHEMAS);
  const b2 = r3e.b2;
  const base = b2.base;
  const records = base.records;
  const audit = await observeStore(base);
  const history = workHistory(b2);
  let clock = t0;
  const now = () => clock;
  const sessionFacts = createSessionFactsService({ records });
  const basis = createSessionResponsibilityBasisReader(records);
  const responsibilities = createSessionResponsibilityService({ records, lookups: records, basis, now });
  const lifecycle = createSessionLifecycleService({ records, lookups: records, sessionFacts });
  const S = base.sessions.first;
  const D = base.sessions.second;
  const A = base.tasks.first;
  const B = base.tasks.second;

  async function pinOf(ref: AggregateRef): Promise<VersionPin> {
    const key = canonicalJson(ref as unknown as JsonValue);
    const read = await records.readMany([key]);
    if (read.status !== 'ready') throw new Error(`pin read failed: ${JSON.stringify(read)}`);
    return { ref, revision: read.value.records.find(record => record.refKey === key)?.revision ?? 0 };
  }
  async function sessionPin(ref: SessionRef): Promise<VersionPin> {
    return pinOf(plainSessionRefToAggregate(ref));
  }
  async function goalPinOf(goalId: string): Promise<VersionPin> {
    const ref = { aggregateType: 'Goal' as const, projectId: base.scope.projectId, goalId };
    const read = await base.plans.queryGoal(base.ctx, ref);
    if (read.status !== 'ready') throw new Error(`goal read failed: ${JSON.stringify(read)}`);
    return { ref, revision: read.value.goal.revision };
  }
  function responsibleLink(ref: SessionRef, target: WorkLinkTarget): SessionWorkLinkRef {
    return { ...ref, aggregateType: 'SessionWorkLink', target, relation: 'responsible' };
  }
  async function sessionRevision(ref: SessionRef): Promise<number> {
    return (await sessionPin(ref)).revision;
  }
  async function linksOf(ref: SessionRef): Promise<SessionWorkLink[]> {
    const card = await base.sessionsPort.readSession(base.ctx, ref);
    if (card.status !== 'ready') throw new Error(`session read failed: ${JSON.stringify(card)}`);
    return card.value.links;
  }
  async function openLink(ref: SessionRef, target: WorkLinkTarget, requestId: string): Promise<WriteResult<SessionWorkLink>> {
    const request: GraphWrite<LinkSessionWorkInput> = {
      input: { sessionRef: ref, target, relation: 'responsible', active: true },
      meta: { requestId, expected: [await sessionPin(ref), await pinOf(responsibleLink(ref, target))] },
    };
    return lifecycle.linkSessionWork(base.ctx, request);
  }
  async function transferRequest(from: SessionRef, to: SessionRef, target: WorkLinkTarget,
    requestId: string): Promise<GraphWrite<TransferInput>> {
    return {
      input: { from, to, target },
      meta: { requestId, expected: [
        await sessionPin(from), await sessionPin(to),
        await pinOf(responsibleLink(from, target)), await pinOf(responsibleLink(to, target)),
      ] },
    };
  }
  async function transfer(from: SessionRef, to: SessionRef, target: WorkLinkTarget, requestId: string): Promise<WriteResult<LinkTransfer>> {
    return responsibilities.transferSessionResponsibility(base.ctx, await transferRequest(from, to, target, requestId));
  }
  async function closeTerminal(ref: SessionRef, target: WorkLinkTarget, requestId: string): Promise<WriteResult<SessionWorkLink>> {
    return responsibilities.closeTerminalResponsibility(base.ctx, {
      input: { sessionRef: ref, target },
      meta: { requestId, expected: [
        await sessionPin(ref), await pinOf(responsibleLink(ref, target)),
        await goalPinOf(target.kind === 'task' ? target.ref.goalId : base.goalRef.goalId),
      ] },
    });
  }
  async function archiveSessionRequest(ref: SessionRef, requestId: string): Promise<GraphWrite<ArchiveSessionInput>> {
    return { input: { sessionRef: ref, reason: 'the operator archives this line' },
      meta: { requestId, expected: [await sessionPin(ref)] } };
  }
  async function startRun(): Promise<void> {
    await history.enter();
    expect((await b2.read()).run.status, 'the formal entry leaves the writer running').toBe('running');
  }
  async function endRun(): Promise<void> {
    await history.finish(await history.enter());
  }
  async function crashSecondRun(): Promise<void> {
    const ended = await history.crash(await history.enter(b2.secondClaim));
    expect(ended.value.outcome, 'the second Run really failed').toBe('crashed');
  }

  const fixture: Opened = {
    b2, r3e, base, records, audit, responsibilities, lifecycle, S, D, A, B, r0: b2.claim.runRef,
    pinOf, sessionPin, sessionRevision, goalPinOf, linksOf, openLink, transferRequest, transfer,
    closeTerminal, archiveSessionRequest, setNow(value: string) { clock = value; vi.setSystemTime(value); },
    startRun, endRun, crashSecondRun,
  };
  opened.push(fixture);
  return fixture;
}

const task = (ref: TaskTriple): WorkLinkTarget => ({ kind: 'task', ref });

/** A real observed check execution at the fixed row clock. */
function executedObservation(text: string): CheckProcessObservation {
  return { kind: 'executed', startedAt: t0, finishedAt: t0, exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text, totalBytes: Buffer.byteLength(text), truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { workspaceRevision: 's1-responsibility-revision-1', changedPaths: [] }, sandboxProfileVersion: 'bwrap-m3-v4' };
}

/** The formal begin/record of every check, then finalize: a real PASS round. */
async function passRound(r3e: R3eEvidenceFixture, opened: RoundSnapshot): Promise<RoundSnapshot> {
  let round = opened;
  for (const check of round.checks) {
    const begun = committed(await r3e.evidence.beginCheck(r3e.ctx, r3e.beginRequest(round, check.checkId)));
    const current = await r3e.evidence.readVerification(r3e.ctx, round.ref);
    if (current.status !== 'ready') throw new Error(`round read failed: ${JSON.stringify(current)}`);
    round = current.value;
    round = committed(await r3e.evidence.recordCheckResult(r3e.ctx,
      r3e.recordRequest(round, check.checkId, begun.invocationId,
        executedObservation(`S1_RESPONSIBILITY_OK_${check.checkId}\n`))));
  }
  const finalized = committed(await r3e.evidence.finalizeChecks(r3e.ctx, r3e.finalizeRequest(round)));
  expect(finalized, 'the formal round finalizes PASS').toMatchObject({ outcome: 'PASS' });
  return finalized.snapshot;
}

/**
 * G1: the three terminal proofs are produced through the real entries. The R3e
 * Plan (a v2 Plan with a `static` completion policy) gets two future-only
 * sibling Tasks whose dispositions are cancelled and superseded; `r3e-work`
 * stays in the plan and is satisfied later through the completion path. No
 * terminal state is raw-seeded.
 */
async function adoptTerminalSiblings(r3e: R3eEvidenceFixture): Promise<PlanRevisionSnapshot> {
  const goalRead = await r3e.b2.base.plans.queryGoal(r3e.ctx, r3e.goalRef);
  if (goalRead.status !== 'ready') throw new Error(`terminal-goal read failed: ${JSON.stringify(goalRead)}`);
  const source = r3e.plan;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: 'r3e-terminal-plan', planRevision: source.planRevision + 1, goalId: r3e.goalRef.goalId,
    stages: structuredClone(source.stages),
    tasks: [...structuredClone(source.tasks),
      { taskId: 'r3e-cancel', title: 'Cancelled sibling', requirementLevel: 'optional', taskKind: 'work',
        disposition: 'cancelled', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'r3e-super', title: 'Superseded sibling', requirementLevel: 'optional', taskKind: 'work',
        disposition: 'superseded', replacedByTaskId: R3E_WORK_TASK_ID, phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [...structuredClone(source.assignments ?? []),
      { taskId: 'r3e-cancel', role: 'builder', instruction: 'cancelled sibling' },
      { taskId: 'r3e-super', role: 'builder', instruction: 'superseded sibling' }],
    obligations: structuredClone(source.obligations),
    taskHierarchy: structuredClone(source.taskHierarchy),
    executionDag: structuredClone(source.executionDag),
    taskRelations: source.schemaVersion === 2 ? structuredClone(source.taskRelations ?? []) : [],
    inputRequirements: source.schemaVersion === 2 ? structuredClone(source.inputRequirements ?? []) : [],
  };
  const proposed = await r3e.b2.base.plans.proposePlan(r3e.ctx, {
    meta: { requestId: 'r3e-terminal-propose', expected: [{ ref: r3e.goalRef, revision: goalRead.value.goal.revision }] },
    input: { goalRef: r3e.goalRef, basedOn: source.ref, draft, reason: { text: 'S1 terminal-task siblings', sources: [] } },
  });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
    throw new Error(`terminal-sibling proposal failed: ${JSON.stringify(proposed)}`);
  }
  const applied = await r3e.b2.base.plans.applyPlanChange(r3e.ctx, {
    meta: { requestId: 'r3e-terminal-apply', expected: [{ ref: r3e.goalRef, revision: goalRead.value.goal.revision }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
  });
  if (applied.status !== 'committed') throw new Error(`terminal-sibling adoption failed: ${JSON.stringify(applied)}`);
  return applied.value;
}

/** The real completion path: a PASS round on the adopted Plan satisfies `r3e-work`. */
async function satisfyR3eWork(r3e: R3eEvidenceFixture, plan: PlanRevisionSnapshot): Promise<void> {
  const round = await passRound(r3e,
    committed(await r3e.evidence.openVerification(r3e.ctx, r3e.openRequest({ planRef: plan.ref }))));
  const goalRead = await r3e.b2.base.plans.queryGoal(r3e.ctx, r3e.goalRef);
  if (goalRead.status !== 'ready') throw new Error(`completion-goal read failed: ${JSON.stringify(goalRead)}`);
  const reductionRef = { aggregateType: 'TaskReduction' as const, projectId: r3e.scope.projectId,
    goalId: r3e.goalRef.goalId, taskId: R3E_WORK_TASK_ID };
  const completed = await r3e.b2.base.goals.completeTask(r3e.ctx, {
    input: { taskRef: r3e.subject, planRef: plan.ref, roundRef: round.ref },
    meta: { requestId: 'r3e-terminal-complete-work', expected: [
      { ref: r3e.goalRef, revision: goalRead.value.goal.revision }, { ref: reductionRef, revision: 0 }] },
  });
  if (completed.status !== 'committed') throw new Error(`work completion failed: ${JSON.stringify(completed)}`);
  expect(completed, 'the work Task satisfies through the completion path')
    .toMatchObject({ status: 'committed', value: { phase: 'satisfied' } });
}

describe.each(['memory', 'sqlite'] as const)('the Session responsibility owner (%s)', (kind) => {
  it('SV16: transfers Task A from S to D under one cursor and advances both Sessions once', async () => {
    const f = await open(kind);
    const target = task(f.A);
    const openedLink = committed(await f.openLink(f.S, target, 'a-open'));
    // S1-LINK-01: the source Task's old writer must be stopped before the move.
    await f.endRun();
    await invariantsHold(f, 'after the open link and the stopped writer');

    const sourceBefore = await f.sessionRevision(f.S);
    const destinationBefore = await f.sessionRevision(f.D);
    const taskBefore = await f.pinOf(f.base.planRef);
    const runBefore = (await f.b2.read()).run;
    const otherRecords = async () => (await f.audit.records()).filter(record => {
      const ref = JSON.parse(record.refKey) as { aggregateType: string };
      return ref.aggregateType !== 'Session' && ref.aggregateType !== 'SessionWorkLink';
    });
    const otherBefore = await otherRecords();

    const moved = committedResult(await f.transfer(f.S, f.D, target, 'a'));
    expect(moved.value.from.until).toBe(moved.cursor);
    expect(moved.value.to.since).toBe(moved.cursor);
    expect(moved.value.from.until).toBe(moved.value.to.since);
    expect(moved.value.from.ref).toEqual(openedLink.ref);
    expect(moved.value.from.since).toEqual(openedLink.since);
    expect(await f.sessionRevision(f.S)).toBe(sourceBefore + 1);
    expect(await f.sessionRevision(f.D)).toBe(destinationBefore + 1);
    // The Task definition and its Run are read facts, never touched by a link move.
    expect((await f.pinOf(f.base.planRef)).revision).toBe(taskBefore.revision);
    expect((await f.b2.read()).run).toEqual(runBefore);
    expect(await otherRecords()).toEqual(otherBefore);
  });

  it('SV17: refuses a transfer while the source Task writer is still running and writes no half state', async () => {
    const f = await open(kind);
    const target = task(f.A);
    const openedLink = committed(await f.openLink(f.S, target, 'a-open'));
    await f.startRun();
    await invariantsHold(f, 'after the open link and the running writer');
    const run = (await f.b2.read()).run;
    expect(run.status).toBe('running');
    const sourceBefore = await f.sessionRevision(f.S);
    const destinationBefore = await f.sessionRevision(f.D);

    const countsBefore = await f.audit.counts();
    const result = await f.transfer(f.S, f.D, target, 'a');
    expect(await f.audit.counts()).toEqual(countsBefore);
    expect(result, 'a running writer refuses the move').toMatchObject({ status: 'rejected', code: 'busy' });
    if (result.status !== 'rejected') throw new Error('transfer must refuse a running writer');
    expect(result.reason.startsWith('archive_execution_pending:')).toBe(true);
    expect(await f.sessionRevision(f.S)).toBe(sourceBefore);
    expect(await f.sessionRevision(f.D)).toBe(destinationBefore);
    // Both links are exactly as the open left them: no half transfer.
    expect(await f.linksOf(f.S)).toEqual([openedLink]);
    expect(await f.linksOf(f.D)).toEqual([]);
  });

  it('SV18: two concurrent transfers from S commit exactly one open responsibility', async () => {
    const f = await open(kind);
    const target = task(f.A);
    committed(await f.openLink(f.S, target, 'a-open'));
    // S1-LINK-01: only a stopped source writer may be moved.
    await f.endRun();
    await invariantsHold(f, 'after the open link and the stopped writer');
    const E = await f.base.createSession('s1-responsibility-third');
    const sourceBefore = await f.sessionRevision(f.S);
    const destinationBefore = await f.sessionRevision(f.D);
    const thirdBefore = await f.sessionRevision(E);
    const barrier = commitBarrier(f.records);
    const service = createSessionResponsibilityService({
      records: barrier.records, lookups: barrier.records,
      basis: createSessionResponsibilityBasisReader(barrier.records), now: () => t0,
    });
    const countsBefore = await f.audit.counts();
    const [toD, toE] = await Promise.all([
      barrier.run(async () => service.transferSessionResponsibility(f.base.ctx,
        await f.transferRequest(f.S, f.D, target, 'a-to-d'))),
      barrier.run(async () => service.transferSessionResponsibility(f.base.ctx,
        await f.transferRequest(f.S, E, target, 'a-to-e'))),
    ]);
    expect(barrier.arrivals).toBe(2);
    const winners = [toD, toE].filter(result => result.status === 'committed');
    expect(winners, 'exactly one concurrent transfer wins').toHaveLength(1);
    const loser = [toD, toE].find(result => result.status !== 'committed');
    expect(loser).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    if (loser?.status !== 'rejected') throw new Error('one transfer must lose');
    expect(loser.reason.length).toBeGreaterThan(0);
    expect(await f.audit.counts()).toEqual({ records: countsBefore.records + 1,
      events: countsBefore.events + 1, receipts: countsBefore.receipts + 1 });
    const winner = winners[0]!;
    if (winner.status !== 'committed') throw new Error(`the winner did not commit: ${JSON.stringify(winner)}`);
    // The winner opened the one new destination responsibility; both Sessions
    // advanced exactly by the writes the winner was told it had.
    const openDestinationLinks = [
      ...(await f.linksOf(f.D)).filter(link => link.until === null && link.ref.target.kind === 'task'),
      ...(await f.linksOf(E)).filter(link => link.until === null && link.ref.target.kind === 'task'),
    ];
    expect(openDestinationLinks).toEqual([winner.value.to]);
    expect(await f.sessionRevision(f.S)).toBe(sourceBefore + 1);
    expect(await f.sessionRevision(f.D)).toBe(destinationBefore + (winner.value.to.ref.sessionId === f.D.sessionId ? 1 : 0));
    expect(await f.sessionRevision(E)).toBe(thirdBefore + (winner.value.to.ref.sessionId === E.sessionId ? 1 : 0));
  });

  it('SV19: closes every terminal Task link, keeps each since, and leaves a non-terminal failed link open', async () => {
    const f = await open(kind);
    const r3e = f.r3e;
    // G1: the three terminal proofs are real. `r3e-work` is satisfied through
    // the completion path; the two added siblings are cancelled/superseded by
    // their real Plan disposition. Nothing is raw-seeded.
    const plan = await adoptTerminalSiblings(r3e);
    await satisfyR3eWork(r3e, plan);
    const g = { projectId: r3e.scope.projectId, goalId: r3e.goalRef.goalId };
    const terminal = [
      task({ ...g, taskId: R3E_WORK_TASK_ID }),
      task({ ...g, taskId: 'r3e-cancel' }),
      task({ ...g, taskId: 'r3e-super' }),
    ];
    const linked: SessionWorkLink[] = [];
    for (const [index, target] of terminal.entries()) {
      linked.push(committed(await f.openLink(f.S, target, `a-open-${index}`)));
    }
    // The fourth Task's latest Run really failed (crashed) while the Task is
    // not formally terminal, so its responsible link stays open.
    await f.crashSecondRun();
    await invariantsHold(f, 'after the three terminal proofs and the failed fourth Run');
    const failedTarget = task({
      projectId: f.base.scope.projectId, goalId: 'b2-second-goal', taskId: 'b2-second-task',
    });
    const failedLink = committed(await f.openLink(f.S, failedTarget, 'a-open-failed'));

    for (const [index, target] of terminal.entries()) {
      const closed = committedResult(await f.closeTerminal(f.S, target, `a-close-${index}`));
      expect(closed.value.until).toBe(closed.cursor);
      expect(closed.value.since).toEqual(linked[index]!.since);
    }
    const countsBeforeFailedClose = await f.audit.counts();
    const refusedClose = await f.closeTerminal(f.S, failedTarget, 'a-close-failed');
    expect(refusedClose.status).toBe('rejected');
    if (refusedClose.status !== 'rejected') throw new Error('failed Task is not terminal');
    expect(refusedClose.reason.length).toBeGreaterThan(0);
    expect(await f.audit.counts()).toEqual(countsBeforeFailedClose);
    // Exactly the failed fourth link is still open; every terminal link closed.
    const openLinks = (await f.linksOf(f.S)).filter(link => link.until === null && link.ref.target.kind === 'task');
    expect(openLinks).toEqual([failedLink]);
  });

  it('SV20: a completed Run without a formally satisfied Task leaves the link open and the archive busy', async () => {
    const f = await open(kind);
    const target = task(f.A);
    const openedLink = committed(await f.openLink(f.S, target, 'a-open'));
    await f.endRun();
    await invariantsHold(f, 'after the completed Run without a satisfied Task');
    const sourceBefore = await f.sessionRevision(f.S);
    const destinationBefore = await f.sessionRevision(f.D);
    // The archived attempt happens on the next day; the clock is the injected t1.
    f.setNow(t1);

    const countsBeforeClose = await f.audit.counts();
    const closed = await f.closeTerminal(f.S, target, 'a-close');
    expect(await f.audit.counts()).toEqual(countsBeforeClose);
    expect(closed, 'a completed Run is not a terminal Task proof').toMatchObject({ status: 'rejected' });
    if (closed.status !== 'rejected') throw new Error('completed Run is not terminal Task proof');
    expect(closed.reason.length).toBeGreaterThan(0);
    // The exact original link is still the one open responsibility; the close
    // wrote no revision and no event.
    expect(await f.linksOf(f.S)).toEqual([openedLink]);
    expect(await f.sessionRevision(f.S)).toBe(sourceBefore);
    expect(await f.sessionRevision(f.D)).toBe(destinationBefore);

    const archived = await f.lifecycle.archiveSession(f.base.ctx, await f.archiveSessionRequest(f.S, 'a-archive'));
    expect(archived).toMatchObject({ status: 'rejected', code: 'busy' });
    if (archived.status !== 'rejected') throw new Error('open responsibility must prevent archive');
    expect(archived.reason.length).toBeGreaterThan(0);
    expect(await f.audit.counts()).toEqual(countsBeforeClose);
    expect(await f.linksOf(f.S)).toEqual([openedLink]);
  });

  it('SV47: forbids a transfer whose destination Session is in workspace w2 and changes nothing', async () => {
    const f = await open(kind);
    const target = task(f.A);
    const openedLink = committed(await f.openLink(f.S, target, 'a-open'));
    await f.endRun();
    const workspace = { projectId: f.base.scope.projectId, workspaceId: 'w2' };
    const ctx2 = { ...f.base.ctx, workspaceId: 'w2' };
    const bootstrap = createProjectBootstrapServices({ records: f.records, now: () => t0, eventId: () => 'sv47-workspace' });
    committed(await bootstrap.projects.registerWorkspace(ctx2, {
      input: { workspace }, meta: { requestId: 'sv47-register-w2', expected: [
        await f.pinOf(f.base.projectRef), { ref: { aggregateType: 'Workspace', ...workspace }, revision: 0 }] },
    }));
    const destination = await createScopedSession(f.base, 'sv47-destination', { workspace });
    const D = destination.ref;
    const destinationCard = await f.base.sessionsPort.readSession(ctx2, D);
    if (destinationCard.status !== 'ready') throw new Error(JSON.stringify(destinationCard));
    const destinationBefore = destinationCard.value.record.revision;
    const sourceBefore = await f.sessionRevision(f.S);


    const countsBefore = await f.audit.counts();
    const result = await f.responsibilities.transferSessionResponsibility(f.base.ctx, {
      input: { from: f.S, to: D, target },
      meta: { requestId: 'a', expected: [await f.sessionPin(f.S),
        { ref: plainSessionRefToAggregate(D), revision: destinationBefore }, await f.pinOf(openedLink.ref),
        { ref: { aggregateType: 'SessionWorkLink', ...D, target, relation: 'responsible' }, revision: 0 }] },
    });
    expect(await f.audit.counts()).toEqual(countsBefore);
    expect(result, 'a w2 destination is out of the archive scope').toMatchObject({ status: 'rejected', code: 'forbidden' });
    if (result.status === 'rejected') expect(result.reason.startsWith('archive_scope:')).toBe(true);
    expect(await f.sessionRevision(f.S)).toBe(sourceBefore);
    const afterDestination = await f.base.sessionsPort.readSession(ctx2, D);
    if (afterDestination.status !== 'ready') throw new Error(JSON.stringify(afterDestination));
    expect(afterDestination.value).toEqual(destinationCard.value);
    expect(await f.linksOf(f.S)).toEqual([openedLink]);
    expect(afterDestination.value.links).toEqual([]);
  });
});

