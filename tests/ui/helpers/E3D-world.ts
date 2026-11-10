import type { QueryJobRef } from '../../../src/contracts/query-job.js';
import type { DecisionCardV1 } from '../../../src/core/work-graph/model/decision-contracts.js';
import { AG2B_WORK_TASK_ID, graphWrite, plain } from '../../helpers/AG2b-collaboration-fixture.js';
import { moveKernelAside } from '../../helpers/A2-restart-fixture.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../../helpers/S6A-host-fixture.js';
import { s6aCardsWorkspace, type S6ACandidate, type S6ACardsWorkspace, type S6ARequest } from '../../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE } from '../../helpers/S6A-request-fixture.js';
import { secretaryAnswer } from '../../helpers/S6A-history-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from '../../helpers/request-claim-steps.js';
import { crashedUnknownKernel } from '../../helpers/S2C-K-scenario-support.js';
import { openHostScenario, performs, type HostScenario } from '../../scenarios/harness.js';
import { createFileReplies, editThenText, readCall, redrivePolicy, textReply } from '../../scenarios/support/common.js';

/**
 * The E3 Decide worlds the shared openers do not give (test sheet §1.2), every
 * state through a public step:
 * - W3, one Host scenario per stop reason (X9: `openHostScenario`, the real
 *   Host over HTTP, scripted model replies, the real check process): the C8 cap
 *   (four failing Runs, cap 3), a Run that exceeds the AG2b grant's sixteen
 *   tool calls (budget exhausted), a timed-out check on an unchanged workspace
 *   (no new basis on the re-verification), the S2C-K missing Kernel (outcome
 *   unknown), the SMK3b Goal interruption after a restart with the start-up
 *   position `ask`, and the cap world whose stopped Task the person deferred
 *   (`plans/propose` + `plans/apply`). Each opener drives `workflow/advance`
 *   and fails with what the Goal showed when the stop is not there.
 * - `seePlanAdoptions`: `decisions/notices/seen` with the token and positions a
 *   `plan_adoption` read issued, so the W1/W2n queues show only the notices the
 *   sheet's rows name.
 * - `openOldAnswerWorld` (D44a): a request whose first round the secretary
 *   answered (`queries/claim` + `prepare` + `start`, the scripted answer), then
 *   a candidate tied to that request, so its card carries `requestRef`.
 */

async function expectCause(h: HostScenario, code: string): Promise<void> {
  const display = await h.goalDisplay();
  const codes = [display.cause, ...display.causes].map((cause) => (cause as { code?: string } | null)?.code);
  if (!codes.includes(code)) {
    throw new Error(`E3D: the Goal does not show ${code}: ${JSON.stringify(display)}`);
  }
}

/** C8 cap: every Run creates its own file and the registered check always fails; cap 3 stops after Run 4. */
export async function openCapWorld(): Promise<HostScenario> {
  const replies = [1, 2, 3, 4].flatMap((n) => createFileReplies(`e3d-cap-run-${n}`, `src/e3d-cap-run-${n}.txt`,
    `E3D cap: Run ${n} tries another fix\n`));
  const h = await openHostScenario({ check: 'fail', script: { replies } });
  await h.advance(h.select('e3d-cap', AG2B_WORK_TASK_ID), { invariants: false });
  await expectCause(h, 'auto_rework_cap_reached');
  return h;
}

/** The AG2b grant allows sixteen tool calls per Run; seventeen reads end the Run budget exhausted. */
export async function openBudgetWorld(): Promise<HostScenario> {
  const replies = Array.from({ length: 17 }, (_, index) => readCall(`e3d-budget-${index + 1}`));
  const h = await openHostScenario({ script: { replies } });
  await h.advance(h.select('e3d-budget', AG2B_WORK_TASK_ID), { invariants: false });
  await expectCause(h, 'budget_exhausted');
  return h;
}

/** A check that times out on an unchanged workspace: one automatic re-verification, then no new basis. */
export async function openReverifyWorld(): Promise<HostScenario> {
  const h = await openHostScenario({ check: { timeoutAfterMs: 300 },
    script: { replies: [textReply('E3D reverify: the work Run answers')] } });
  await h.advance(h.select('e3d-reverify', AG2B_WORK_TASK_ID), { invariants: false });
  await expectCause(h, 'no_new_basis');
  return h;
}

/** S2C-K: a Run held in its Turn, the Kernel store moved aside, a crash restart: the Run reads outcome_unknown. */
export async function openUnknownWorld(): Promise<HostScenario> {
  const h = await openHostScenario({ automation: redrivePolicy(true), script: { replies: [
    readCall('e3d-unknown'), textReply('E3D unknown: the missing-Kernel Turn is never answered'),
  ] } });
  await crashedUnknownKernel(h, 'e3d-unknown-run1', 'missing', () => moveKernelAside(h.database));
  await expectCause(h, 'unknown_outcome');
  return h;
}

/**
 * D24 (SMK3b, decision 97-9): the seeded Plan's work `t1` ended its Run and its round is open with the check not
 * started (`t2` never started); a clean close and a start with the start-up position `ask` (the default) record
 * the Goal interruption, whose card waits for the person to start the Goal's driver.
 */
export async function openInterruptedWorld(): Promise<HostScenario> {
  const h = await openHostScenario({ workIds: ['t1', 't2'], script: { replies: [...editThenText('e3d-interrupted'),
    textReply('E3D interrupted: the person starts the work again')] } });
  const driven = await h.advance(h.select('e3d-interrupted', 't1'), { stopBefore: performs('run_check'), invariants: false });
  if (driven.state !== 'stopped') throw new Error(`E3D: t1 did not stop before its check: ${JSON.stringify(driven.reason)}`);
  await h.restart({ invariants: false });
  await expectCause(h, 'interrupted_pending_resume');
  return h;
}

/**
 * D27's start: the C8 cap world whose stopped Task the person deferred through `plans/propose` + `plans/apply`
 * (the adopted Plan as a draft: a new id, the next revision, the Task `deferred`), so the Goal waits on
 * `required_task_deferred`.
 */
export async function openDeferredWorld(): Promise<HostScenario> {
  const h = await openCapWorld();
  const goalRef = { aggregateType: 'Goal' as const, projectId: S6A_SCOPE.projectId, goalId: 'ag2b-goal' };
  const graph = await h.answer('tasks/query', plain(S6A_SCOPE, { goalRef })) as { value?: { plan?: Record<string, unknown> } };
  const plan = graph.value?.plan;
  if (plan === undefined) throw new Error(`E3D: the cap world has no adopted Plan: ${JSON.stringify(graph)}`);
  const { ref, revision, goalRef: planGoal, acceptedAt, effectiveCompletionPolicy, effectiveArchitectureBaseline, ...draft } = plan;
  void revision; void planGoal; void acceptedAt; void effectiveCompletionPolicy; void effectiveArchitectureBaseline;
  const goal = await h.answer('goals/read', plain(S6A_SCOPE, goalRef)) as { value?: { goal?: { revision: number } } };
  const proposed = await h.answer('plans/propose', graphWrite(S6A_SCOPE, { goalRef, basedOn: ref,
    draft: { ...draft, planId: 'e3d-deferred', goalId: goalRef.goalId, planRevision: (plan['planRevision'] as number) + 1,
      tasks: (draft['tasks'] as Array<Record<string, unknown>>).map((task) => task['taskId'] === AG2B_WORK_TASK_ID
        ? { ...task, disposition: 'deferred' } : task) },
    reason: { text: 'E3D: defer the stopped Task', sources: [], affectedTaskIds: [AG2B_WORK_TASK_ID] },
  }, 'e3d-deferred-propose', [{ ref: goalRef, revision: goal.value?.goal?.revision ?? 0 }])) as
    { status?: string; value?: { ref: unknown; revision: number } };
  if (proposed.status !== 'committed' || proposed.value === undefined) {
    throw new Error(`E3D: the deferral was not proposed: ${JSON.stringify(proposed)}`);
  }
  const applied = await h.answer('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: proposed.value.ref,
    expectedProposalRevision: proposed.value.revision, decisionRefs: [] }, 'e3d-deferred-apply')) as { status?: string };
  if (applied.status !== 'committed') throw new Error(`E3D: the deferral was not adopted: ${JSON.stringify(applied)}`);
  await expectCause(h, 'required_task_deferred');
  return h;
}

/** `decisions/notices/seen` of every `plan_adoption` notice a read shows, with that read's token and positions. */
export async function seePlanAdoptions(ws: S6ACardsWorkspace, label: string): Promise<void> {
  const read = await ws.readNotices({ categories: ['plan_adoption'] });
  if (read.notices.length === 0) return;
  if (read.displayToken === null) throw new Error('E3D: the plan_adoption read issued no display token');
  const answer = await ws.markSeen({ label, displayToken: read.displayToken, seenThrough: read.seenThrough });
  if (answer['status'] !== 'committed') throw new Error(`E3D: the plan adoptions were not marked seen: ${JSON.stringify(answer)}`);
}

/** The text the secretary answered the first round of the D44a request with. */
export const E3D_OLD_ANSWER = '旧答复';

export type E3DOldAnswerWorld = {
  world: S6AHostWorld;
  ws: S6ACardsWorkspace;
  request: S6ARequest;
  candidate: S6ACandidate;
};

/** D44a: the project's pointers, a request whose first round answered `旧答复`, then a candidate tied to it. */
export async function openOldAnswerWorld(): Promise<E3DOldAnswerWorld> {
  const world = await openS6AHostWorld({ backend: 'memory' });
  try {
    await ensureProjectPointers(world);
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const secretary = await world.createSecretary('e3d-old-secretary');
    const request = await ws.submit({ label: 'e3d-old', goalId: world.goals.first.goalId, recipient: secretary.ref });
    const claimed = await claimWithSecretaryProfile(world, request.round, secretary, 'e3d-old-claim');
    if (claimed['status'] !== 'committed') throw new Error(`E3D: the old round was not claimed: ${JSON.stringify(claimed)}`);
    const prepared = await prepareAttempt(world, request.round, 'e3d-old-prepare');
    await world.scripted.script(secretary, [{ kind: 'text', text: secretaryAnswer({ body: E3D_OLD_ANSWER }) }]);
    await start(world, prepared, 'e3d-old-start');
    await world.waitForRequest(request.requestRoot, (view) => roundAnswered(view, request.round),
      'the old round answered');
    const candidate = await ws.proposeCandidate({ label: 'e3d-old', goal: world.goals.first, request });
    return { world, ws, request, candidate };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

function roundAnswered(view: { rounds: ReadonlyArray<{ ref: QueryJobRef; answer?: unknown }> }, round: QueryJobRef): boolean {
  const entry = view.rounds.find((item) => item.ref.queryJobId === round.queryJobId);
  return entry !== undefined && entry.answer !== null && entry.answer !== undefined;
}

/** The waiting card of `taskId` a public `decisions/queue` read shows (its `taskRef`, `runRef` and `source.pins`). */
export async function taskCardOf(h: HostScenario, taskId: string): Promise<DecisionCardV1> {
  const read = await h.answer('decisions/queue', { scope: S6A_SCOPE, input: { workspace: S6A_SCOPE,
    sections: ['waiting_answer'], page: { limit: 100 } } }) as { status?: string; value?: { waitingAnswer?: DecisionCardV1[] } };
  const card = read.value?.waitingAnswer?.find((entry) => entry.taskRef?.taskId === taskId);
  if (card === undefined) throw new Error(`E3D: no waiting card names ${taskId}: ${JSON.stringify(read)}`);
  return card;
}
