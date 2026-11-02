/**
 * Slice PS (adopt-after-stop): PS-01 and PS-02.
 *
 * A person adopts a future candidate that changes the disposition of two Tasks:
 * the proposing Task's own Run is still `running` (the scripted model call is
 * held on a callback gate, not `holdReply`, which ends on abort), and another
 * affected Task's Run is claimed but not entered (`starting`, the Workflow
 * stopped before `start`). `plans/apply` over the real HTTP route first runs the
 * real adoption, is refused by TASK-19 (guard 1), and the adoption wrapper then
 * stops both affected Runs through a durable `cancel` control. The same body is
 * submitted again once both Runs ended; the second call commits the one unified
 * adoption. All reads go through public owners/routes; no record store is read.
 *
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import type { ControlIntentRef, ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import {
  AG2B_GOAL_REF, AG2B_QUERY_ROLE, AG2B_SCOPE, AG2B_WORK_TASK_ID, corePost, createAG2bSession, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { deferred, readControl, readExecution, submitControl } from '../helpers/A2-restart-fixture.js';
import {
  cleanupScenarios, hostCtx, openHostScenario, performs, SCENARIO_OPERATOR, waitFor,
  type HostScenario, type ScenarioCommitGate,
} from './harness.js';
import {
  cleanupCommon, draftFrom, NO_REDRIVE, operatorRequeue, PlanBoard, toolOutputJson,
} from './support/common.js';
import { intentOf } from './support/control.js';
import { committedOf, hostAdopt, hostGraph, workTask } from './support/plan.js';
import { ownerRequeue } from './support/rework.js';

afterEach(async () => {
  await cleanupCommon();
  await cleanupScenarios();
});

const PROPOSER = 'ps-proposer';
const CLAIMED = 'ps-claimed';
const PROPOSER_REPLACEMENT = 'ps-proposer-2';
const CLAIMED_REPLACEMENT = 'ps-claimed-2';

type Candidate = { ref: PlanProposalRef; revision: number };

type HeldAdoption = {
  board: PlanBoard;
  sourcePlan: PlanRevisionSnapshot;
  candidate: Candidate;
  proposerRun: RunRef;
  claimedRun: RunRef;
  /** Resolves the callback gate the proposer's Run is held on. Idempotent. */
  release(): void;
  /** The Workflow drive of the proposer, stopped before its `open_checks`. */
  driving: Promise<unknown>;
};

/**
 * PS-01's world: the seeded Plan has two work Tasks. The second is claimed and
 * the drive stops before `start` (`starting`); the first is driven until its
 * scripted Run has proposed a candidate that supersedes both Tasks and adds one
 * replacement for each, and is then held inside its second model call (still
 * `running`).
 */
async function openHeldAdoption(): Promise<HeldAdoption> {
  const propose = { callId: 'ps-propose', name: 'propose_future_plan', args: {} as Record<string, unknown> };
  let board!: PlanBoard;
  let candidate: Candidate | undefined;
  const held = deferred();
  const gate = deferred();
  board = await PlanBoard.open({
    workIds: [PROPOSER, CLAIMED],
    check: 'pass',
    replies: [
      { kind: 'calls', calls: [propose] },
      { kind: 'text', text: 'PS: the proposer finished its turn' },
    ],
    duringReply: async (index, request) => {
      if (index === 0) {
        // The proposer's Run is in the Kernel: it proposes P2 = P1 with both affected Tasks superseded
        // and one replacement for each, all carrying the source obligation.
        const next = await board.nextDraft('ps-plan-p2', draft => ({
          ...draft,
          tasks: draft.tasks.flatMap(task => {
            if (task.taskId === PROPOSER) {
              return [{ ...task, disposition: 'superseded' as const, replacedByTaskId: PROPOSER_REPLACEMENT },
                workTask(PROPOSER_REPLACEMENT, 'Replace the proposer work')];
            }
            if (task.taskId === CLAIMED) {
              return [{ ...task, disposition: 'superseded' as const, replacedByTaskId: CLAIMED_REPLACEMENT },
                workTask(CLAIMED_REPLACEMENT, 'Replace the claimed work')];
            }
            return [task];
          }),
          assignments: [...(draft.assignments ?? []),
            { taskId: PROPOSER_REPLACEMENT, role: 'builder', instruction: 'Perform the proposer replacement work' },
            { taskId: CLAIMED_REPLACEMENT, role: 'builder', instruction: 'Perform the claimed replacement work' }],
          obligations: draft.obligations.map(obligation => obligation.taskIds.includes(PROPOSER)
            || obligation.taskIds.includes(CLAIMED)
            ? { ...obligation, taskIds: [...new Set([...obligation.taskIds, PROPOSER_REPLACEMENT, CLAIMED_REPLACEMENT])] }
            : obligation),
        }));
        Object.assign(propose.args, { basedOn: next.source.ref, draft: next.draft,
          reason: { text: 'PS: both affected Tasks are replaced', sources: [],
            affectedTaskIds: [PROPOSER, CLAIMED] }, expected: [] });
      }
      if (index === 1) {
        const proposed = toolOutputJson(request, 'ps-propose') as
          { status?: string; value?: Candidate } | undefined;
        if (proposed?.status !== 'committed' || proposed.value === undefined) {
          throw new Error(`propose: ${JSON.stringify(proposed)}`);
        }
        candidate = proposed.value;
        held.resolve();
        await gate.promise;
      }
    },
  });
  const sourcePlan = (await board.graph()).plan;

  // The other affected Task is claimed but not entered: its Run stays `starting`.
  const toStart = await board.advance(board.select('ps-claimed-flow', CLAIMED), performs('start'));
  const claim = committedOf(toStart.receipts, 'claim_task');
  expect((await board.readRun(claim.runRef)).run).toMatchObject({ status: 'starting', planRef: sourcePlan.ref });

  // Drive the proposer: its Run proposes, then the held second model call keeps it `running`.
  const driving = board.advance(board.select('ps-proposer-flow', PROPOSER), performs('open_checks'));
  await Promise.race([
    held.promise,
    driving.then(() => { throw new Error('the proposer Run ended before its held model call'); }),
  ]);
  const row = await board.taskRow(PROPOSER);
  if (row.execution === null) throw new Error('the proposer Task must select its Run');
  expect((await board.readRun(row.execution)).run).toMatchObject({ status: 'running', planRef: sourcePlan.ref });

  return { board, sourcePlan, candidate: candidate!, proposerRun: row.execution, claimedRun: claim.runRef,
    release: () => gate.resolve(), driving };
}

/** The durable cancel of one affected Run, read through the public control owner. */
async function runControlOf(board: PlanBoard,
  run: { controlState?: { intentRef: ControlIntentRef } }): Promise<ControlIntentSnapshotV1> {
  const intentRef = run.controlState?.intentRef;
  if (intentRef === undefined) throw new Error('the affected Run must point at its cancel intent');
  return await intentOf(board.platform, board.ctx(), intentRef);
}

it('PS-01: a person adopts a candidate that changes two Tasks\' dispositions while one Run is running and one starting; the adoption stops both, returns 409 stopping_affected_work and writes no plan', async () => {
  const world = await openHeldAdoption();
  try {
    const response = await world.board.routeResponse('plans/apply', hostApplyBody(world.candidate, 'ps-01-apply'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      status: 'rejected', code: 'busy', reason: 'stopping_affected_work',
    });

    // Both affected Runs are pointed at a cancel; the not-entered one ended by RUN-09.
    const proposer = (await world.board.readRun(world.proposerRun)).run;
    const claimed = (await world.board.readRun(world.claimedRun)).run;
    expect(proposer).toMatchObject({ status: 'running', controlState: { desiredState: 'cancelled' } });
    expect(claimed).toMatchObject({ status: 'ended', outcome: 'cancelled', controlState: { desiredState: 'cancelled' } });
    // Two cancels, both requested by the operator; the running one is still queued, the starting one applied.
    expect(await runControlOf(world.board, proposer)).toMatchObject({
      kind: 'cancel', reason: 'stopping_affected_work', requestedBy: { ...SCENARIO_OPERATOR }, status: 'queued',
    });
    expect(await runControlOf(world.board, claimed)).toMatchObject({
      kind: 'cancel', reason: 'stopping_affected_work', requestedBy: { ...SCENARIO_OPERATOR },
      status: 'applied', observation: { origin: 'platform_not_entered', kind: 'cancelled' },
    });

    // The Plan is unchanged and the candidate is still a candidate: zero plan write.
    expect((await world.board.graph()).plan.ref).toEqual(world.sourcePlan.ref);
    const proposal = await world.board.route<ReadResult<{ status: string; revision: number }>>('plans/proposal',
      plain(AG2B_SCOPE, world.candidate.ref));
    expect(proposal).toMatchObject({ status: 'ready', value: { status: 'candidate', revision: world.candidate.revision } });
  } finally {
    world.release();
    await world.driving.catch(() => undefined);
  }
}, 120_000);

it('PS-02: once both affected Runs ended cancelled, the same candidate is applied again and commits one adoption with both dispositions and both replacements', async () => {
  const world = await openHeldAdoption();
  try {
    const first = await world.board.routeResponse('plans/apply', hostApplyBody(world.candidate, 'ps-02-apply-1'));
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ status: 'rejected', code: 'busy', reason: 'stopping_affected_work' });

    // Let the held Run finish, then wait for the public terminal facts of both Runs.
    world.release();
    await world.driving;
    const proposer = await waitFor(async () => (await world.board.readRun(world.proposerRun)).run,
      run => run.status === 'ended', 'the proposer Run to end');
    const claimed = await waitFor(async () => (await world.board.readRun(world.claimedRun)).run,
      run => run.status === 'ended', 'the claimed Run to end');
    expect(proposer).toMatchObject({ status: 'ended', outcome: 'cancelled' });
    expect(claimed).toMatchObject({ status: 'ended', outcome: 'cancelled' });

    const second = await world.board.route<WriteResult<PlanRevisionSnapshot>>('plans/apply',
      hostApplyBody(world.candidate, 'ps-02-apply-2'));
    expect(second).toMatchObject({ status: 'committed', value: { planRevision: world.sourcePlan.planRevision + 1 } });

    // The one unified adoption: a single new revision carries both dispositions and both replacements.
    const adopted = (await world.board.graph()).plan;
    expect(adopted.planRevision).toBe(world.sourcePlan.planRevision + 1);
    const sourceProposer = world.sourcePlan.tasks.find(task => task.taskId === PROPOSER);
    const sourceClaimed = world.sourcePlan.tasks.find(task => task.taskId === CLAIMED);
    if (sourceProposer === undefined || sourceClaimed === undefined) throw new Error('both affected Tasks are source Tasks');
    expect(adopted.tasks.find(task => task.taskId === PROPOSER))
      .toEqual({ ...sourceProposer, disposition: 'superseded', replacedByTaskId: PROPOSER_REPLACEMENT });
    expect(adopted.tasks.find(task => task.taskId === CLAIMED))
      .toEqual({ ...sourceClaimed, disposition: 'superseded', replacedByTaskId: CLAIMED_REPLACEMENT });
    expect(adopted.tasks.find(task => task.taskId === PROPOSER_REPLACEMENT))
      .toMatchObject({ disposition: 'active', phase: 'pending', taskKind: 'work' });
    expect(adopted.tasks.find(task => task.taskId === CLAIMED_REPLACEMENT))
      .toMatchObject({ disposition: 'active', phase: 'pending', taskKind: 'work' });
    const changes = adopted.dispositionRecord?.entries ?? [];
    expect(changes).toHaveLength(2);
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: PROPOSER, from: 'active', to: 'superseded',
        replacedByTaskId: PROPOSER_REPLACEMENT, setIn: adopted.ref }),
      expect.objectContaining({ taskId: CLAIMED, from: 'active', to: 'superseded',
        replacedByTaskId: CLAIMED_REPLACEMENT, setIn: adopted.ref }),
    ]));
  } finally {
    world.release();
    await world.driving.catch(() => undefined);
  }
}, 120_000);

// ---------------------------------------------------------------------------
// Host-mode helpers for the failure/idempotency rows
// ---------------------------------------------------------------------------

type DraftEdit = NonNullable<Parameters<typeof draftFrom>[2]>;

/** The next candidate of the seeded Plan through the real `plans/propose` route. */
async function proposeOnHost(h: HostScenario, planId: string, edit: DraftEdit, requestId: string,
  reasonText: string, affectedTaskIds: readonly string[]): Promise<Candidate> {
  const source = (await hostGraph(h)).plan;
  const proposed = await h.post<{ status: string; value: { ref: PlanProposalRef; revision: number; issues: unknown[] } }>(
    'plans/propose', graphWrite(AG2B_SCOPE, {
      goalRef: AG2B_GOAL_REF, basedOn: source.ref, draft: draftFrom(source, planId, edit),
      reason: { text: reasonText, sources: [], affectedTaskIds: [...affectedTaskIds] },
    }, requestId));
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
    throw new Error(`proposal ${requestId}: ${JSON.stringify(proposed)}`);
  }
  return { ref: proposed.value.ref, revision: proposed.value.revision };
}

/** One candidate's `plans/apply` graph write, without a success-only route. */
function hostApplyBody(candidate: Candidate, requestId: string): ReturnType<typeof graphWrite> {
  return graphWrite(AG2B_SCOPE, {
    proposalRef: candidate.ref, expectedProposalRevision: candidate.revision, decisionRefs: [],
  }, requestId);
}

/** The disposition-only edit the host rows adopt. */
function dispositionEdit(taskIds: readonly string[], disposition: 'deferred' | 'active' | 'superseded' | 'cancelled'): DraftEdit {
  return draft => ({ ...draft, tasks: draft.tasks.map(task => taskIds.includes(task.taskId)
    ? { ...task, disposition } : task) });
}

it('PS-03: two HTTP apply calls inside one live model step reuse the one plan-change cancel pointer and both answer 409 stopping_affected_work with zero plan write', async () => {
  const T = AG2B_WORK_TASK_ID;
  let h!: HostScenario;
  let candidate: Candidate | undefined;
  let sourcePlan: PlanRevisionSnapshot | undefined;
  let first: Response | undefined;
  let second: Response | undefined;
  let firstBody: unknown;
  let secondBody: unknown;
  let firstPointer: ControlIntentRef | undefined;
  let secondPointer: ControlIntentRef | undefined;
  h = await openHostScenario({ check: 'pass', workIds: [T], script: {
    replies: [{ kind: 'calls', calls: [{ callId: 'ps-03-read', name: 'read', args: { path: 'src/module.ts' } }] }],
    duringReply: async (index) => {
      if (index !== 0 || candidate === undefined) return;
      const runRef = (await h.taskRow(T)).execution;
      if (runRef === null) throw new Error('PS-03: the Run must be selected before its model call');
      first = await corePost(h.host.base, 'plans/apply', h.host.token, hostApplyBody(candidate, 'ps-03-apply-1'));
      firstBody = await first.json();
      firstPointer = (await readExecution(h.host, runRef)).run.controlState?.intentRef;
      second = await corePost(h.host.base, 'plans/apply', h.host.token, hostApplyBody(candidate, 'ps-03-apply-2'));
      secondBody = await second.json();
      secondPointer = (await readExecution(h.host, runRef)).run.controlState?.intentRef;
    },
  } });
  sourcePlan = (await hostGraph(h)).plan;
  try {

    candidate = await proposeOnHost(h, 'ps-03-plan', dispositionEdit([T], 'deferred'), 'ps-03-propose',
      'PS-03: defer the running work', [T]);
    await h.advance(h.select('ps-03-flow', T), { stopBefore: performs('open_checks') });

    expect(first, 'the first apply ran inside the held model step').toBeDefined();
    expect(second, 'the second apply ran inside the held model step').toBeDefined();
    expect(first!.status).toBe(409);
    expect(firstBody).toMatchObject({ status: 'rejected', code: 'busy', reason: 'stopping_affected_work' });
    expect(second!.status).toBe(409);
    expect(secondBody).toMatchObject({ status: 'rejected', code: 'busy', reason: 'stopping_affected_work' });
    expect(secondPointer).toEqual(firstPointer);

    const run = (await readExecution(h.host, (await h.taskRow(T)).execution!)).run;
    expect(run).toMatchObject({ status: 'ended', outcome: 'cancelled', controlState: { desiredState: 'cancelled' } });
    expect(await readControl(h.host, firstPointer!)).toMatchObject({
      kind: 'cancel', reason: 'stopping_affected_work', requestedBy: { ...SCENARIO_OPERATOR }, status: 'applied',
    });

    expect((await hostGraph(h)).plan.ref).toEqual(sourcePlan!.ref);
    const proposal = await h.post<ReadResult<{ status: string; revision: number }>>('plans/proposal',
      plain(AG2B_SCOPE, candidate!.ref));
    expect(proposal).toMatchObject({ status: 'ready', value: { status: 'candidate', revision: candidate!.revision } });
  } finally {
    await h.host.host.close().catch(() => undefined);
  }
}, 120_000);

it('PS-04: a candidate that changes a yielded Task and a running Task stops only the running Run, returns 409 stopping_affected_work and leaves the yielded wait and the plan untouched', async () => {
  const Y = 'ps-yield';
  const B = 'ps-zbusy';
  let recipient: { projectId: string; sessionId: string } | undefined;
  const send = { callId: 'ps-04-send', name: 'send_session_message', args: {
    recipient: {}, text: 'PS-04: a question nobody answers', intent: 'inquiry', needsReply: true, waitAfterSend: true,
  } as Record<string, unknown> };
  const h = await openHostScenario({ check: 'pass', automation: NO_REDRIVE, workIds: [Y, B], script: {
    replies: [{ kind: 'calls', calls: [send] }, { kind: 'text', text: 'PS-04: the busy Run never answers' }],
    duringReply: async (index) => {
      if (index === 0 && recipient !== undefined) send.args['recipient'] = { ...recipient };
    },
  } });
  recipient = (await createAG2bSession(h.host, 'ps-04-recipient', AG2B_QUERY_ROLE, [{ target: { kind: 'task',
    ref: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: Y } }, relation: 'participates' }])).sessionRef;

  // Y sends a wait and yields: its continuation is not consumed.
  expect(await h.advance(h.select('ps-04-yield', Y))).toMatchObject({ state: 'waiting' });
  const yRun = (await h.taskRow(Y)).execution;
  if (yRun === null) throw new Error('PS-04: the yielded Task must select its Run');
  expect((await readExecution(h.host, yRun)).run).toMatchObject({ status: 'ended', outcome: 'yielded',
    continuation: { kind: 'wait_reply' } });

  // B is held inside its first model call, still running.
  const held = h.holdReply(1);
  const driveB = h.advance(h.select('ps-04-busy', B), { stopBefore: performs('open_checks') });
  await held.reached;
  const bRun = (await h.taskRow(B)).execution;
  if (bRun === null) throw new Error('PS-04: the busy Task must select its Run');
  expect((await readExecution(h.host, bRun)).run).toMatchObject({ status: 'running' });

  const source = (await hostGraph(h)).plan;
  const candidate = await proposeOnHost(h, 'ps-04-plan', draft => ({ ...draft,
    tasks: draft.tasks.map(task => task.taskId === Y || task.taskId === B
      ? { ...task, disposition: 'cancelled' as const } : task) }), 'ps-04-propose',
  'PS-04: cancel the yielded and the running work', [Y, B]);

  try {
    const response = await corePost(h.host.base, 'plans/apply', h.host.token, hostApplyBody(candidate, 'ps-04-apply'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ status: 'rejected', code: 'busy', reason: 'stopping_affected_work' });

    // Only B was fenced with a new cancel; the yielded Run has no pointer and keeps its wait.
    const busy = (await readExecution(h.host, bRun)).run;
    expect(busy.controlState).toEqual({ desiredState: 'cancelled', intentRef: expect.anything() });
    expect(await readControl(h.host, busy.controlState!.intentRef)).toMatchObject({ kind: 'cancel',
      reason: 'stopping_affected_work', requestedBy: { ...SCENARIO_OPERATOR } });
    expect((await readExecution(h.host, yRun)).run).toMatchObject({ status: 'ended', outcome: 'yielded',
      continuation: { kind: 'wait_reply' } });
    expect((await readExecution(h.host, yRun)).run.controlState).toBeUndefined();
    expect((await readExecution(h.host, yRun)).run.consumedWait).toBeUndefined();

    expect((await hostGraph(h)).plan.ref).toEqual(source.ref);
    const proposal = await h.post<ReadResult<{ status: string; revision: number }>>('plans/proposal',
      plain(AG2B_SCOPE, candidate.ref));
    expect(proposal).toMatchObject({ status: 'ready', value: { status: 'candidate', revision: candidate.revision } });
  } finally {
    held.release();
    await driveB.catch(() => undefined);
  }
}, 120_000);

it('PS-05: a person pauses the Run first, then adopts; the cancel ends it through RUN-23, the adoption commits, and only the operator may requeue', async () => {
  const T = AG2B_WORK_TASK_ID;
  let h!: HostScenario;
  let candidate: Candidate | undefined;
  let pauseRef: ControlIntentRef | undefined;
  h = await openHostScenario({ check: 'pass', automation: NO_REDRIVE, workIds: [T], script: {
    replies: [{ kind: 'calls', calls: [{ callId: 'ps-05-read', name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'text', text: 'PS-05: the requeued Run answers' }],
    duringReply: async (index) => {
      if (index !== 0) return;
      const runRef = (await h.taskRow(T)).execution;
      if (runRef === null) throw new Error('PS-05: the Run must be selected before its model call');
      const paused = await submitControl(h.host, runRef, 'pause', 'PS-05: a person pauses', 'ps-05-pause');
      pauseRef = paused.intent.ref;
    },
  } });
  const source = (await hostGraph(h)).plan;
  candidate = await proposeOnHost(h, 'ps-05-plan', dispositionEdit([T], 'cancelled'), 'ps-05-propose',
    'PS-05: cancel the paused work', [T]);

  // The pause is applied at the first tool-group safe point; the Run is still running.
  await h.advance(h.select('ps-05-flow', T), { stopBefore: performs('open_checks') });
  const runRef = (await h.taskRow(T)).execution;
  if (runRef === null) throw new Error('PS-05: the paused Task must select its Run');
  const paused = (await readExecution(h.host, runRef)).run;
  expect(paused).toMatchObject({ status: 'running', controlState: { desiredState: 'paused' } });
  expect(await readControl(h.host, pauseRef!)).toMatchObject({ kind: 'pause', requestedBy: { ...SCENARIO_OPERATOR } });

  const response = await corePost(h.host.base, 'plans/apply', h.host.token, hostApplyBody(candidate, 'ps-05-apply-1'));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ status: 'rejected', code: 'busy', reason: 'stopping_affected_work' });
  const stopped = (await readExecution(h.host, runRef)).run;
  expect(stopped).toMatchObject({ status: 'ended', outcome: 'cancelled', controlState: { desiredState: 'cancelled' } });
  const cancelRef = stopped.controlState!.intentRef;
  expect(await readControl(h.host, cancelRef)).toMatchObject({ kind: 'cancel', reason: 'stopping_affected_work',
    requestedBy: { ...SCENARIO_OPERATOR } });

  // The old plan Task is still active: only a person may requeue it, and the human stop is recorded.
  const direct = await h.direct();
  expect(await ownerRequeue(direct, hostCtx({ ...WORKFLOW_AUTOMATION_ACTOR }), runRef, 'ps-05-auto-requeue'))
    .toMatchObject({ status: 'rejected', code: 'forbidden' });
  const requeued = await operatorRequeue(h.host, runRef, 'ps-05-op-requeue', 'PS-05: continue after the pause');
  expect(requeued).toMatchObject({ status: 'committed', value: { kind: 'requeued', requeue: {
    stopRequester: 'human', stopIntentRef: cancelRef } } });

  const adopted = await corePost(h.host.base, 'plans/apply', h.host.token, hostApplyBody(candidate, 'ps-05-apply-2'));
  expect(adopted.status).toBe(200);
  expect(await adopted.json()).toMatchObject({ status: 'committed' });
  expect(await h.taskRow(T)).toMatchObject({ disposition: 'cancelled' });
  expect((await hostGraph(h)).plan.planRevision).toBe(source.planRevision + 1);
}, 120_000);

it('PS-06 (SQLite only): a Host crash after the durable cancel commit is reconciled by W-12/RUN-23 as ended/cancelled, and the next apply commits', async () => {
  const T = AG2B_WORK_TASK_ID;
  let armed = false;
  const reached = deferred();
  const heldGate = deferred<boolean>();
  const gate: ScenarioCommitGate = async (batch) => {
    if (!armed) return;
    if (!batch.events.some(event => event.eventType === 'ControlIntentSubmitted')) return;
    armed = false;
    reached.resolve();
    if (await heldGate.promise) throw new Error('injected: the old Host fell at the control commit');
  };
  const h = await openHostScenario({ check: 'pass', automation: NO_REDRIVE, workIds: [T], commitGate: gate, script: {
    replies: [{ kind: 'text', text: 'PS-06: the held Turn never answers on the old Host' }],
  } });
  const source = (await hostGraph(h)).plan;
  const candidate = await proposeOnHost(h, 'ps-06-plan', dispositionEdit([T], 'cancelled'), 'ps-06-propose',
    'Host restart', [T]);

  const heldCall = h.holdReply(0);
  const driving = h.advance(h.select('ps-06-flow', T), { stopBefore: performs('open_checks') });
  await heldCall.reached;
  const runRef = (await h.taskRow(T)).execution;
  if (runRef === null) throw new Error('PS-06: the running Task must select its Run');

  let applying: Promise<Response> | undefined;
  try {
    armed = true;
    applying = corePost(h.host.base, 'plans/apply', h.host.token, hostApplyBody(candidate, 'ps-06-apply-1'));
    await reached.promise;

    h.dropCommitGate();
    await h.restart({ crash: true });

    // W-12/RUN-23 on the new Host: the queued cancel stops the clean Turn.
    expect(h.reconcile.report?.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 'W-12', status: 'reconciled' }),
    ]));
    const run = (await readExecution(h.host, runRef)).run;
    expect(run).toMatchObject({ status: 'ended', outcome: 'cancelled', controlState: { desiredState: 'cancelled' } });
    expect(await readControl(h.host, run.controlState!.intentRef)).toMatchObject({ kind: 'cancel',
      reason: 'stopping_affected_work', requestedBy: { ...SCENARIO_OPERATOR } });

    const adopted = await corePost(h.host.base, 'plans/apply', h.host.token, hostApplyBody(candidate, 'ps-06-apply-2'));
    expect(adopted.status).toBe(200);
    expect(await adopted.json()).toMatchObject({ status: 'committed' });
    expect((await hostGraph(h)).plan.planRevision).toBe(source.planRevision + 1);
    expect(await h.taskRow(T)).toMatchObject({ disposition: 'cancelled' });
  } finally {
    heldGate.resolve(true);
    await applying?.catch(() => undefined);
    heldCall.release();
    await driving.catch(() => undefined);
    await h.drainAbandoned();
  }
}, 120_000);

it('PS-07: an adoption that changes only Task B stops B and leaves the unrelated running Task U untouched, then the second apply commits', async () => {
  const B = 'ps-07-busy';
  const U = 'ps-07-unrelated';
  const h = await openHostScenario({ check: 'pass', automation: NO_REDRIVE, workIds: [B, U], script: {
    replies: [{ kind: 'text', text: 'PS-07: B never answers' }, { kind: 'text', text: 'PS-07: U never answers' }],
  } });
  const heldB = h.holdReply(0);
  const driveB = h.advance(h.select('ps-07-b', B), { stopBefore: performs('open_checks') });
  await heldB.reached;
  const heldU = h.holdReply(1);
  const driveU = h.advance(h.select('ps-07-u', U), { stopBefore: performs('open_checks') });
  await heldU.reached;
  const bRun = (await h.taskRow(B)).execution;
  const uRun = (await h.taskRow(U)).execution;
  if (bRun === null || uRun === null) throw new Error('PS-07: both Tasks must select their Runs');
  expect((await readExecution(h.host, bRun)).run).toMatchObject({ status: 'running' });
  expect((await readExecution(h.host, uRun)).run).toMatchObject({ status: 'running' });

  const source = (await hostGraph(h)).plan;
  const candidate = await proposeOnHost(h, 'ps-07-plan', dispositionEdit([B], 'cancelled'), 'ps-07-propose',
    'PS-07: cancel only the busy work', [B]);

  try {
    const first = await corePost(h.host.base, 'plans/apply', h.host.token, hostApplyBody(candidate, 'ps-07-apply-1'));
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ status: 'rejected', code: 'busy', reason: 'stopping_affected_work' });
    const busy = (await readExecution(h.host, bRun)).run;
    expect(busy.controlState).toEqual({ desiredState: 'cancelled', intentRef: expect.anything() });
    expect(await readControl(h.host, busy.controlState!.intentRef)).toMatchObject({ kind: 'cancel',
      reason: 'stopping_affected_work', requestedBy: { ...SCENARIO_OPERATOR } });
    const unrelated = (await readExecution(h.host, uRun)).run;
    expect(unrelated).toMatchObject({ status: 'running' });
    expect(unrelated.controlState).toBeUndefined();
    expect((await hostGraph(h)).plan.ref).toEqual(source.ref);

    heldB.release();
    await driveB;
    const ended = await waitFor(async () => (await readExecution(h.host, bRun)).run,
      run => run.status === 'ended', 'PS-07: the stopped Run to end');
    expect(ended).toMatchObject({ outcome: 'cancelled' });

    const second = await corePost(h.host.base, 'plans/apply', h.host.token, hostApplyBody(candidate, 'ps-07-apply-2'));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: 'committed' });
    expect(await h.taskRow(B)).toMatchObject({ disposition: 'cancelled' });
    expect((await readExecution(h.host, uRun)).run).toMatchObject({ status: 'running' });
    expect((await readExecution(h.host, uRun)).run.controlState).toBeUndefined();
  } finally {
    heldB.release();
    heldU.release();
    await driveB.catch(() => undefined);
    await driveU.catch(() => undefined);
  }
}, 120_000);

it('PS-09: deferring the running Task needs the stop; the deferred Task refuses a direct requeue until a later adoption makes it active again', async () => {
  const T = AG2B_WORK_TASK_ID;
  const h = await openHostScenario({ check: 'pass', automation: NO_REDRIVE, workIds: [T], script: {
    replies: [{ kind: 'text', text: 'PS-09: the stopped Run never answers' },
      { kind: 'text', text: 'PS-09: the requeued Run answers' }],
  } });
  const source = (await hostGraph(h)).plan;
  const candidate = await proposeOnHost(h, 'ps-09-plan', dispositionEdit([T], 'deferred'), 'ps-09-propose',
    'PS-09: defer the running work', [T]);

  const held = h.holdReply(0);
  const driving = h.advance(h.select('ps-09-flow', T), { stopBefore: performs('open_checks') });
  await held.reached;
  const runRef = (await h.taskRow(T)).execution;
  if (runRef === null) throw new Error('PS-09: the running Task must select its Run');

  try {
    const first = await corePost(h.host.base, 'plans/apply', h.host.token, hostApplyBody(candidate, 'ps-09-apply-1'));
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ status: 'rejected', code: 'busy', reason: 'stopping_affected_work' });

    held.release();
    await driving.catch(() => undefined);
    await waitFor(async () => (await readExecution(h.host, runRef)).run,
      run => run.status === 'ended', 'PS-09: the stopped Run to end');

    const second = await corePost(h.host.base, 'plans/apply', h.host.token, hostApplyBody(candidate, 'ps-09-apply-2'));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: 'committed' });
    expect(await h.taskRow(T)).toMatchObject({ disposition: 'deferred' });

    const refused = await operatorRequeue(h.host, runRef, 'ps-09-requeue-deferred', 'PS-09: too early');
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect((refused as { reason: string }).reason).toContain('task_not_active');

    const active = await hostAdopt(h, 'ps-09-reactivate', dispositionEdit([T], 'active'),
      { text: 'PS-09: make the Task active again', sources: [], affectedTaskIds: [T] }, 'ps-09-reactivate');
    expect(active.planRevision).toBe(source.planRevision + 2);
    expect(await h.taskRow(T)).toMatchObject({ disposition: 'active' });

    const requeued = await operatorRequeue(h.host, runRef, 'ps-09-requeue-active', 'PS-09: continue now');
    expect(requeued).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });

    const before = (await h.taskRow(T)).execution;
    await h.advance(h.select('ps-09-requeued', T));
    const after = (await h.taskRow(T)).execution;
    expect(after).not.toEqual(before);
    if (after === null) throw new Error('PS-09: the requeued Task must run');
    expect((await readExecution(h.host, after)).run).toMatchObject({ status: 'ended', outcome: 'completed' });
  } finally {
    held.release();
    await driving.catch(() => undefined);
  }
}, 120_000);
