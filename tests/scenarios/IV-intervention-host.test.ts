/**
 * IV acceptance rows: a person intervenes on an idle line while the REAL Host consume loop (not a direct
 * `handleIntervention` call) selects the message. Every row drives the Host's own `consumeIdle` pass through
 * `heartbeat` (`tests/helpers/IV-host-fixture.ts`), and every state is reached through public routes and reads.
 *
 * Expected after the fix (`src/core/work-graph/views/consumable-sessions.ts`): a line occupied by its own
 * `intervention_planning` Query at `claimed`/`prepared` still reads `busy: 'query'`, but its `sourceMessageRef` is
 * offered as `nextMessage` through `offerOf` only when that message is addressed to this line (a paused Goal offers
 * nothing). `offersOf` is not used for that offer, so a newer message cannot displace the claimed planning. Once the
 * Query is terminal the ordinary `offersOf` order selects the message and the handler continues from its first
 * missing stage (book-7b §3.10 item 7).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { AG2B_PROJECT_REF, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, AG2B_WORKSPACE_REF,
  graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow, readControl, readExecution } from '../helpers/A2-restart-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, S6A_WORK_ROLE_BINDING } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { committed, pauseS7AGoal, ready, resumeS7AGoal, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { sendPLActionWait } from '../helpers/PL-consumption-fixture.js';
import { plPlanChangeDraft, plToolPlanOf } from '../helpers/PL-workflow-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { firstPlan, refinementPlan } from '../helpers/S7B-V-fixture.js';
import { listed, readS7BMessage } from '../helpers/S7B-fixture.js';
import { claimQuery } from '../helpers/request-claim-steps.js';
import {
  abandonCandidate, answerCard, awaitCandidate, awaitClaimedPlanning, awaitPlanningAnswer, awaitProposal,
  candidateCards, consumeView, createLine, heartbeat, heartbeatUntil,
  heartbeatUntilModel, lineFacts, notices, openConsumeWorld, openIdleLine, openLine, proposalRefOf, proposeReplacement,
  questionCards, readBody, readPlanningQuery, readProposal,
  readQueryAnswer, sessionExecutions,
  sessionQueries, settleHost, systemWithdraw, waitForResponse, waitForWithdrawn,
} from '../helpers/IV-host-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { roleReadGate } from '../helpers/S8C-role-read-gate.js';

// The commit barrier is the S6A fixture's (tests/RULES.md A3): the IV-END-3 row holds one prepared Query commit
// across a real crash and one notice send across the system-withdraw guard arm. G7 W2: one consume pass now takes the
// planning Query's stages in a row, so IV-4 and IV-5 (memory) hold that pass on one Query commit the same way. The P5
// row also holds one `readMany` with the S8C read gate, layered over the barrier's in-memory backend.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S8C-role-read-gate.js')).inMemoryRoleGateModule(async () =>
    (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal)));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

// The lead's fixed closing sentences, verbatim: one notice per reason, `questions` sends none.
const INVALID_PLAN_NOTICE = '这次规划没有形成可采用的计划，模型的原回答在回复里。可以补充要求后重新发送。';
const DECLINED_NOTICE = '这次规划的方案没有采用，原回答在回复里。可以补充要求后重新发送。';
const CANDIDATE_NOTICE = '这次规划已写入候选，采用前可以继续补充要求。';
const NO_ANSWER_NOTICE = '对方这一轮结束，没有回复。这条消息已撤回。请补充要求后重新发送。';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  // Release every held commit first: a held commit keeps a tracked call open, and one of them belongs to a Host
  // that the crash row abandoned.
  commitBarrier.reset();
  roleReadGate.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

describe('IV: intervention on an idle line through the real Host consume loop', () => {
  it('IV-1 主路径与采用后开工: the first plan is answered, proposed, carded, adopted and started', async () => {
    const world = await openConsumeWorld({ label: 'iv1' });
    worlds.push(world);
    await settleHost(world);
    const { line, messageRef } = await openIdleLine(world,
      firstPlan({ label: 'iv1', taskId: 'iv1-task', role: S6A_WORK_ROLE.templateId }), 'iv1-line');

    const query = await awaitPlanningAnswer(world, messageRef);
    const proposalRef = proposalRefOf(messageRef, world.goals.second);
    const proposalRead = await awaitProposal(world, proposalRef);
    const view = await consumeView(world, line);

    expect(query?.job.job.status, 'the planning Query is answered').toBe('answered');
    expect(query?.run.run.status, 'the planning QueryRun is terminal').toBe('answered');
    expect(await world.scripted.requests(line), 'the planning Query made exactly one model request').toHaveLength(1);
    expect(view?.busy, 'the line is not parked on its own planning Query').toBeNull();
    expect(proposalRead.status, 'the person can read the plan proposal').toBe('ready');
    if (proposalRead.status !== 'ready') return;
    expect(proposalRead.value).toMatchObject({ status: 'candidate', sourceMessageRef: messageRef });

    const cards = await candidateCards(world, world.goals.second);
    const card = cards.find(candidate => candidate.source.subject.kind === 'goal'
      && candidate.source.subject.goalRef.goalId === world.goals.second.goalId
      && candidate.candidateStatus === 'candidate');
    expect(card, 'the person\'s decision queue contains this adoption card').toBeDefined();
    expect(card?.actions, 'the card offers the person\'s adoption').toContain('adopt');
    expect(card?.objects, 'the card pins the intervention proposal').toContainEqual(expect.objectContaining({
      kind: 'aggregate', label: 'candidate',
      pin: expect.objectContaining({ ref: expect.objectContaining({
        aggregateType: 'PlanProposal', proposalId: proposalRef.proposalId }) }),
    }));

    // IV-2 continues in IV-1's world: the same proposal is adopted, the line claims the first ready task and starts
    // a Run. The held model request is the started Run's, awaited after the gate is released.
    const gate = await world.gates.modelRequest(line);
    let pending: Promise<void> | null = null;
    try {
      committed((await world.post('plans/apply', graphWrite(S6A_SCOPE, {
        proposalRef, expectedProposalRevision: proposalRead.value.revision, decisionRefs: [],
      }, 'iv1-adopt'))).body, 'the proposal adoption');
      pending = (await heartbeatUntilModel(world, gate)).settled;

      const claims = await sessionExecutions(world, line);
      expect(claims, 'the line claims the first ready task').toHaveLength(1);
      expect(claims[0]?.task.taskId, 'the claim is the proposal\'s first ready task').toBe('iv1-task');
      const run = await readExecution(world.ag2b, claims[0]!.runRef);
      expect(run.run.startedAt, 'a Run starts').not.toBeNull();
      expect(await sessionQueries(world, line), 'there is exactly one planning Query').toHaveLength(1);
      expect(await candidateCards(world, world.goals.second), 'there is exactly one proposal').toHaveLength(1);
      const started = await consumeView(world, line);
      expect(started?.busy, 'the line is busy on the started Run').toBe('run');
      expect(started?.nextMessage, 'the intervention message is no longer selected').toBeNull();
    } finally {
      gate.release();
      if (pending !== null) await pending.catch(() => undefined);
    }
  }, 120_000);

  it('IV-4 插队: a newer message does not displace the claimed planning', async () => {
    const world = await openConsumeWorld({ label: 'iv4' });
    worlds.push(world);
    await settleHost(world);
    const { line } = await openLine(world, 'iv4-line');
    // P2 §2.7 deletes the message-release queue, so no approve/release step is needed. The source is the person's
    // B20 direct-intervention message (`entry:'person_intervention'`), which gives this EXECUTOR line the planning
    // shape (`plan-round.ts:148-150`); an agent's message to an executor would open only a text round
    // (`plan-round.ts:154-156`), which is not the "claimed planning" this row is about.
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    await adoptS6BPlan(ws, world.goals.second, { label: 'iv4-base', taskIds: ['iv4-base-task'],
      role: S6A_WORK_ROLE.templateId });
    await setS7AAutonomy(world, world.goals.second, 'every_step');
    const source = await sendS7A2PersonMessage(world, { label: 'iv4-source', recipient: line.ref,
      goal: world.goals.second });
    await world.scripted.script(line, [
      { kind: 'text', text: await refinementPlan(world, world.goals.second,
        { label: 'iv4-source', taskId: 'iv4-source-task', role: S6A_WORK_ROLE.templateId }) },
      { kind: 'text', text: await refinementPlan(world, world.goals.second,
        { label: 'iv4-newer', taskId: 'iv4-newer-task', role: S6A_WORK_ROLE.templateId }) },
    ]);

    // G7 W2: the pass that submits and claims the source's Query goes on to prepare it; the row holds that pass on the
    // prepared commit, so the newer message comes while the source's Query is `claimed`.
    const prepared = world.gates.beforePrepared(line);
    const pass = await heartbeatUntilModel(world, prepared, 12);
    const claimed = await readPlanningQuery(world, source.ref);
    expect(claimed?.run.run.executionState?.phase, 'the source planning Query is claimed').toBe('claimed');
    // A newer message (another B20 send) must queue behind the claimed planning, never displace it, and only get
    // its own round after the source finishes.
    const newer = await sendS7A2PersonMessage(world, { label: 'iv4-newer', recipient: line.ref,
      goal: world.goals.second });
    const held = await consumeView(world, line);
    expect(held?.nextMessage?.messageRef, 'the claimed planning keeps its source ahead of the newer message')
      .toEqual(source.ref);
    prepared.release();
    await pass.settled;

    const answered = await awaitPlanningAnswer(world, source.ref);
    expect(answered?.job.job.status, 'the current planning finishes first').toBe('answered');
    const after = await consumeView(world, line);
    expect(after?.nextMessage?.messageRef, 'the newer message stays queued').toEqual(newer.ref);
    expect(await readPlanningQuery(world, newer.ref), 'the newer message is not planned before the source finishes')
      .toBeNull();

    const newerQuery = await awaitPlanningAnswer(world, newer.ref);
    expect(newerQuery?.job.job.status, 'the queued newer message is processed, not a permanent busy rejection')
      .toBe('answered');
  }, 120_000);

  it('IV-5 暂停: a paused Goal offers nothing and resumes to the answer', async () => {
    const world = await openConsumeWorld({ label: 'iv5' });
    worlds.push(world);
    await settleHost(world);
    const { line } = await openLine(world, 'iv5-line');
    // A pause pins the Goal's `tasks/query`, which needs an adopted Plan. The line has no Task link, so the
    // handler still takes its no-task planning branch; every-step keeps the refinement a card.
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    await adoptS6BPlan(ws, world.goals.second, { label: 'iv5-base', taskIds: ['iv5-base-task'],
      role: S6A_WORK_ROLE.templateId });
    await setS7AAutonomy(world, world.goals.second, 'every_step');
    const message = await sendS7A2PersonMessage(world, { label: 'iv5', recipient: line.ref,
      goal: world.goals.second });
    const messageRef = message.ref;
    await world.scripted.script(line, [{ kind: 'text', text: await refinementPlan(world, world.goals.second,
      { label: 'iv5', taskId: 'iv5-task', role: S6A_WORK_ROLE.templateId }) }]);

    // G7 W2: one pass takes the Query's stages in a row and each stage re-reads the Goal. The row holds that pass on
    // the claim commit and pauses the Goal there; once the claim lands, the next stage reads the paused Goal and stops.
    const claim = world.gates.beforeClaim(line);
    const pass = await heartbeatUntilModel(world, claim, 12);
    await pauseS7AGoal(world, world.goals.second);
    claim.release();
    await pass.settled;
    const claimed = await awaitClaimedPlanning(world, messageRef);
    expect(claimed?.run.run.executionState?.phase, 'the planning Query stays claimed under the pause').toBe('claimed');
    const before = (await world.scripted.requests(line)).length;
    for (let pass = 0; pass < 3; pass += 1) await heartbeat(world);

    const paused = await consumeView(world, line);
    expect(paused?.nextMessage, 'no message is offered while the Goal is paused').toBeNull();
    expect(await world.scripted.requests(line), 'no model request is made while the Goal is paused')
      .toHaveLength(before);

    await resumeS7AGoal(world, world.goals.second);
    const answered = await awaitPlanningAnswer(world, messageRef);
    expect(answered?.job.job.status, 'after the resume the planning Query is answered').toBe('answered');
  }, 120_000);

  it('IV-6 收件人: a claimed planning on another line does not offer that line the source message', async () => {
    const world = await openConsumeWorld({ label: 'iv6' });
    worlds.push(world);
    await settleHost(world);
    const { line: recipient } = await openLine(world, 'iv6-recipient');
    const message = await sendS7A2PersonMessage(world, { label: 'iv6', recipient: recipient.ref,
      goal: world.goals.second });
    const other = await createLine(world, 'iv6-other');
    const goal = ready<{ goal: { revision: number } }>(
      (await world.post('goals/read', plain(S6A_SCOPE, world.goals.second))).body, 'the intervention Goal');
    const refs = interventionPlanningQueryRefs(message.ref);
    committed((await world.post('queries/submit', graphWrite(S6A_SCOPE, {
      queryJobId: refs.queryJobRef.queryJobId, runId: refs.queryRunRef.runId,
      intent: { schemaVersion: 1, intentId: refs.queryJobRef.queryJobId, projectId: S6A_SCOPE.projectId,
        workspaceId: S6A_SCOPE.workspaceId, goalId: world.goals.second.goalId,
        question: 'IV cross-line planning', focusTaskRefs: [], budget: AG2B_QUERY_BUDGET,
        multiTurn: { maxRounds: 1 }, correlationId: 'iv6-correlation',
        execution: { kind: 'intervention_planning', sourceMessageRef: message.ref,
          roleBinding: S6A_WORK_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET } },
    }, 'iv6-submit', [
      { ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 },
      { ref: world.goals.second, revision: goal.goal.revision },
      { ref: refs.queryJobRef, revision: 0 }, { ref: refs.queryRunRef, revision: 0 },
    ]))).body, 'the cross-line planning Query');
    committed(await claimQuery(world, refs.queryJobRef, other, null, 'iv6-claim'), 'the cross-line claim');

    const view = await consumeView(world, other);
    expect(view?.busy, 'the other line is parked on the claimed planning').toBe('query');
    expect(view?.nextMessage, 'the other line does not offer the recipient line\'s message').toBeNull();
  }, 120_000);
});

/** One legal v2 needs_decision answer with a non-empty question list. */
const questionsAnswer = (summary: string, questions: readonly string[]): string =>
  JSON.stringify({ schemaVersion: 2, kind: 'needs_decision', summary, questions: [...questions] });

/** The plan body of `firstPlan`, as the draft `plans/propose` takes (a replacement arm). */
function replacementDraft(world: S6AHostWorld, label: string): Record<string, unknown> {
  const text = firstPlan({ label, taskId: `iv-${label}-task`, role: S6A_WORK_ROLE.templateId });
  const plan = (JSON.parse(text) as { plan: Record<string, unknown> }).plan;
  return { ...plan, goalId: world.goals.second.goalId, planId: `iv-${label}`, planRevision: 1 };
}

/**
 * IV-END-1's line: a secretary. The goal loop's `planresume` branch serves the adviser/secretary planning lines and,
 * since P5, the executor line too (`design-frozen.md:118`, A17; `p5-frozen.md:470`). This helper keeps IV-END-1's
 * secretary world; IV-END-1b builds the same steps on an executor line. Everything else is `openIdleLine`'s shape:
 * the governance, one real line, one person message and the scripted first plan.
 */
async function openIdleSecretaryLine(world: S6AHostWorld, text: string, label: string) {
  await governS6B(world, s6aCardsWorkspace(world, S6A_SCOPE), world.goals);
  // The `planresume` branch is read only after `selectNext`'s active-Plan check (`workflow.ts:3258`), so the Goal
  // needs an adopted Plan; `every_step` keeps the later candidates a person card, as IV-END-1b's world does.
  await adoptS6BPlan(s6aCardsWorkspace(world, S6A_SCOPE), world.goals.second,
    { label, taskIds: [`${label}-task`], role: S6A_WORK_ROLE.templateId });
  await setS7AAutonomy(world, world.goals.second, 'every_step');
  const line = await world.createSecretary(label);
  const message = await sendS7A2PersonMessage(world, { label, recipient: line.ref, goal: world.goals.second });
  await world.scripted.script(line, [{ kind: 'text', text }]);
  return { line, messageRef: message.ref };
}

/**
 * 依据：p5-frozen:489（T3）、:490（T4）；lead 裁定 P5-1（`p5-frozen:3-21`，`:5` 压过 T4 表行）；design-frozen:422。
 * 世界：执行者线负责 A；A 的 Work Run 真调 `send_session_message` 把 M 发给空闲秘书并让出（needsReply/waitAfterSend）；
 *   秘书线经真实 Host 消费 M 开规划轮，脚本模型用真 `submit_plan_round` 交一版把 A 的 disposition 设为 `cancelled`
 *   （不带 `replacedByTaskId`）的候选；目标循环推进到 A13 候选卡；此时不调 `plans/apply`。
 * 期望值 T3：候选卡存在（candidateStatus `candidate`、source.kind `candidate`、actions 含 `adopt`）；A 的 Run
 *   {status:'ended', outcome:'yielded'} 且 `controlState` 为 undefined；活动计划 planRevision 不变。
 * 期望值 T4（同一世界，一次公开 `plans/apply`）：该次调用直接 committed（raw apply 先 busy，平台自动化身份
 *   `hostSystemContext(ctx, WORKFLOW_AUTOMATION_ACTOR)` 收尾同来源链的让出等待、同一固定号且不投递，再 raw apply）；
 *   A 的 Run `controlState.desiredState === 'cancelled'`；固定取消意图 requestedBy 是 WORKFLOW_AUTOMATION_ACTOR、
 *   status `queued`、无 observation（没有投递）；活动计划里 A 为 `cancelled`；planRevision 是 before+1。
 * 具名变异 T3：「目标循环一看到卡就提前取消」；「A13 包装顺手写控制」——两条都会让 controlState 断言变红。
 * 具名变异 T4：「PS 先停活着的 Run、不跑 yielded 收尾（第一次没有任何控制写）」；「yielded 收尾后仍要求活句柄投递
 *   （第一次不是 committed）」；「用操作者身份而不是平台自动化身份提交」。
 */
describe('T3/T4 yielded-task close-out: the A13 card keeps the wait, one person click finishes it and adopts', () => {
  it('T3/T4 让出任务收尾: the A13 card writes no control, then one plans/apply commits the cancel and the plan',
    async () => {
      const world = await openConsumeWorld({ label: 't3-t4', tools: ['send_session_message'] });
      worlds.push(world);
      await settleHost(world);
      const goal = world.goals.second;
      const main = s6aCardsWorkspace(world, S6A_SCOPE);
      await governS6B(world, main, world.goals);
      const adopted = await adoptS6BPlan(main, goal, { label: 't3-t4', taskIds: ['t3-a'],
        role: S6A_WORK_ROLE.templateId });
      await setS7AAutonomy(world, goal, 'every_step');
      const secretary = await world.createSecretary('t3-t4-secretary');
      const line = await sessionOf(world, await createS6BLine(main, { label: 't3-t4-line', role: S6A_WORK_ROLE,
        tasks: adopted.tasks }));

      // A's real Work Run sends M to the idle secretary and yields on the reply.
      const sent = await sendPLActionWait(world, { goal, session: line, sessionTaskId: 't3-a',
        recipient: secretary.ref, text: 'T3/T4: A cannot continue on this premise', label: 't3-t4' });
      // The cancelled draft is inline (no shared-fixture helper): only A's disposition moves, no replacement.
      const draft = plPlanChangeDraft(adopted.plan, goal, {
        planId: 't3-t4-plan-v2',
        tasks: adopted.plan.tasks.map(task => task.taskId === 't3-a'
          ? { ...task, disposition: 'cancelled' as const } : task),
        assignments: [...(adopted.plan.assignments ?? [])],
        obligations: adopted.plan.obligations,
      });
      await world.scripted.script(secretary, [{ kind: 'calls', calls: [{ callId: 't3-t4-plan',
        name: 'submit_plan_round', args: { answerKind: 'plan', summary: 'T3/T4 cancel A',
          plan: plToolPlanOf(draft),
          reason: { text: 'T3/T4 cancel A', affectedTaskIds: ['t3-a'] } } }] }]);
      const candidateRead = await awaitProposal(world, proposalRefOf(sent.message.ref, goal));
      expect(candidateRead.status, 'the secretary planning round writes the cancelled candidate').toBe('ready');
      if (candidateRead.status !== 'ready') return;
      const candidate = candidateRead.value;
      expect(candidate).toMatchObject({ status: 'candidate', sourceMessageRef: sent.message.ref });
      expect(candidate.draft.tasks.find(task => task.taskId === 't3-a'), 'the candidate cancels A without a replacement')
        .toMatchObject({ disposition: 'cancelled' });

      // T3: the goal loop reaches the A13 card and writes nothing on A.
      const before = (await main.activePlan(goal))!.planRevision;
      await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 't3-t4-card', sessionHint: null,
        kind: 'select_work' }, { stopBefore: operation => operation.kind === 'claim_task'
          || operation.kind === 'create_session' });
      const cards = await heartbeatUntil(world, () => candidateCards(world, goal),
        items => items.some(card => card.candidateStatus === 'candidate' && card.source.kind === 'candidate'));
      const card = cards.find(item => item.candidateStatus === 'candidate' && item.source.kind === 'candidate');
      expect(card, 'the secretary candidate waits on the A13 card').toBeDefined();
      expect(card?.candidateStatus, 'the card waits for the person').toBe('candidate');
      expect(card?.source.kind, 'the card source is the candidate').toBe('candidate');
      expect(card?.actions, 'the card offers the person\'s adoption').toContain('adopt');
      const yielded = (await readExecution(world.ag2b, sent.run)).run;
      expect(yielded).toMatchObject({ status: 'ended', outcome: 'yielded' });
      expect(yielded.controlState, 'the card itself writes no control').toBeUndefined();
      expect((await main.activePlan(goal))!.planRevision, 'the card changes no Plan').toBe(before);

      // T4: one public click; the single call must finish the yielded wait as automation and then commit.
      const applied = await world.post('plans/apply', graphWrite(S6A_SCOPE, {
        proposalRef: candidate.ref, expectedProposalRevision: candidate.revision, decisionRefs: [],
      }, 't3-t4-apply'));
      const adoption = committed<{ planRevision: number }>(applied.body, 'the single-click adoption');
      const cancelled = (await readExecution(world.ag2b, sent.run)).run;
      expect(cancelled.controlState, 'the single click writes the fixed cancel intent').toBeDefined();
      expect(cancelled.controlState?.desiredState, 'the automation cancel fences the yielded wait').toBe('cancelled');
      const intentRef = cancelled.controlState?.intentRef;
      if (intentRef === undefined) throw new Error('T4: the cancel intent ref is missing');
      const intent = await readControl(world.ag2b, intentRef);
      expect(intent).toMatchObject({ kind: 'cancel', status: 'queued',
        requestedBy: { ...WORKFLOW_AUTOMATION_ACTOR } });
      expect(intent.observation, 'the automation finish submits, never delivers to a live handle').toBeUndefined();
      // The reason lives on the intent (`cancelYieldedWaitStep`'s `input.reason`); `p5-frozen:12` fixes the sentence.
      expect(intent.reason, 'the fixed cancel reason names the Task, its disposition and the candidate')
        .toBe(`task t3-a is cancelled by plan candidate ${candidate.ref.proposalId}@${candidate.revision}`);
      const now = await main.activePlan(goal);
      expect(now, 'the single click adopted the Plan').not.toBeNull();
      expect(now?.tasks.find(task => task.taskId === 't3-a')).toMatchObject({ disposition: 'cancelled' });
      expect(now?.planRevision, 'the adoption is one revision on').toBe(before + 1);
      expect(adoption.planRevision, 'the apply receipt names the same revision').toBe(before + 1);
    }, 120_000);
});

/**
 * 依据：c3rv-rulings.md P5 行（表一 P5-1、P5-2、P5-3）；design-frozen:421–423；p5-frozen:5、:9、:118、:153。
 * 世界：T3/T4 的世界换成任务 A、B 各一条执行者线。A 的 Work Run 把 M_A 发给空闲秘书并让出，秘书的规划轮交候选 C1
 *   （取消 A、B，来源 M_A）；之后 B 的 Work Run 把 M_B 发给秘书并让出（不再心跳，M_B 一直没人答）。
 * P5-1：人点 C1@1，raw apply 读 A 的 Run 时按住；同一来源的替代 C2 把 C1 变成 not_adopted@2，再放开。期望：返回采用方
 *   的最新裁定（invalid），A 的 Run 没有控制写。具名变异：去掉收尾的版本核对（照 C1@2 生成取消号并提交，A 被取消）。
 * P5-2：人点 C2。守卫 3 先报 A；平台收尾 A 的等待后，第二次采用报 B；A、B 都已让出，没有可停的 Run。期望：返回 B 的
 *   原因句。具名变异：最后的退路返回第一次的拒绝（A 的原因句）。
 * P5-3：人提一版无来源、只取消 B 的候选 C3；A 的指针意图（A 不在 C3 的差异里）设读故障后点 C3。期望：照旧是 B 的
 *   原因句，A 的指针意图零读。具名变异：收尾入口先读任务图、再判来源（任务图会读 A 的指针意图）。
 */
describe('P5 review rework: the person\'s adoption finish keeps the clicked version, the latest refusal and its early exits',
  () => {
    it('P5-1/P5-2/P5-3: stale click ends with the adopter\'s ruling; the second busy is returned; no source reads no pointer',
      async () => {
        const world = await openConsumeWorld({ label: 'p5r', tools: ['send_session_message'] });
        worlds.push(world);
        await settleHost(world);
        const goal = world.goals.second;
        const main = s6aCardsWorkspace(world, S6A_SCOPE);
        await governS6B(world, main, world.goals);
        const [A, B] = ['p5r-a', 'p5r-b'];
        const adopted = await adoptS6BPlan(main, goal, { label: 'p5r', taskIds: [A, B], role: S6A_WORK_ROLE.templateId });
        await setS7AAutonomy(world, goal, 'every_step');
        const secretary = await world.createSecretary('p5r-secretary');
        const executorLine = async (label: string) => await sessionOf(world, await createS6BLine(main,
          { label, role: S6A_WORK_ROLE, tasks: adopted.tasks }));
        const cancelOf = (ids: readonly string[], planId: string) => plPlanChangeDraft(adopted.plan, goal, { planId,
          tasks: adopted.plan.tasks.map(task => ids.includes(task.taskId) ? { ...task, disposition: 'cancelled' as const }
            : task),
          assignments: [...(adopted.plan.assignments ?? [])], obligations: adopted.plan.obligations });
        const apply = async (ref: unknown, revision: number, requestId: string) => (await world.post('plans/apply',
          graphWrite(S6A_SCOPE, { proposalRef: ref, expectedProposalRevision: revision, decisionRefs: [] }, requestId))).body;
        type Proposed = { ref: unknown; revision: number };
        const proposeOnPlan = async (input: Record<string, unknown>, requestId: string, pins: unknown[] = []) =>
          committed<Proposed>((await world.post('plans/propose', graphWrite(S6A_SCOPE,
            { goalRef: goal, basedOn: adopted.plan.ref, ...input }, requestId, pins))).body, requestId);

        const sentA = await sendPLActionWait(world, { goal, session: await executorLine('p5r-line-a'), sessionTaskId: A,
          recipient: secretary.ref, text: 'P5: A cannot continue on this premise', label: 'p5r-a' });
        await world.scripted.script(secretary, [{ kind: 'calls', calls: [{ callId: 'p5r-plan', name: 'submit_plan_round',
          args: { answerKind: 'plan', summary: 'P5 cancel A and B', plan: plToolPlanOf(cancelOf([A, B], 'p5r-c1')),
            reason: { text: 'P5 cancel A and B', affectedTaskIds: [A, B] } } }] }]);
        const c1Read = await awaitProposal(world, proposalRefOf(sentA.message.ref, goal));
        if (c1Read.status !== 'ready') throw new Error('P5: the secretary candidate C1 is not readable');
        const c1 = c1Read.value;
        const sentB = await sendPLActionWait(world, { goal, session: await executorLine('p5r-line-b'), sessionTaskId: B,
          recipient: secretary.ref, text: 'P5: B waits on its own question', label: 'p5r-b' });
        const bBusy = { status: 'rejected', code: 'busy',
          reason: `task ${B}: cancel or resume the yielded wait of run ${sentB.run.runId} first` };

        // P5-1: C1 is replaced while the click's raw apply is inside its TASK-19 reads.
        const held = roleReadGate.holdRead(keys => keys.includes(canonicalRefKey(sentA.run)));
        const clicked = apply(c1.ref, c1.revision, 'p5r-apply-1');
        await held.reached;
        const goalNow = ready<{ goal: { ref: unknown; revision: number } }>(
          (await world.post('goals/read', plain(S6A_SCOPE, goal))).body, 'the Goal').goal;
        const c2 = await proposeOnPlan({ draft: cancelOf([A, B], 'p5r-c2'), requestRef: c1.requestRef,
          sourceMessageRef: sentA.message.ref, replaces: { proposalRef: c1.ref, revision: c1.revision },
          reason: { text: 'P5 replacement', sources: [], affectedTaskIds: [A, B] } }, 'p5r-replace',
        [{ ref: goalNow.ref, revision: goalNow.revision }]);
        held.release();
        expect(await clicked, 'the stale click returns the adopter\'s latest ruling').toMatchObject(
          { status: 'rejected', code: 'invalid' });
        expect((await readExecution(world.ag2b, sentA.run)).run.controlState,
          'no cancel is written under the withdrawn version').toBeUndefined();

        // P5-2: the platform finishes A's wait, the second adoption names B, and that refusal is returned.
        expect(await apply(c2.ref, c2.revision, 'p5r-apply-2'), 'the second busy (B) is returned').toMatchObject(bBusy);
        const aIntent = (await readExecution(world.ag2b, sentA.run)).run.controlState?.intentRef;
        if (aIntent === undefined) throw new Error('P5-2: the finish did not cancel A\'s wait');

        // P5-3: a candidate with no source exits before the Task graph reads A's pointer intent.
        const c3 = await proposeOnPlan({ draft: cancelOf([B], 'p5r-c3'),
          reason: { text: 'P5-3 cancel B', sources: [], affectedTaskIds: [B] } }, 'p5r-c3-propose');
        const pointer = commitBarrier.failReads(canonicalRefKey(aIntent), 'throw-always');
        const third = await apply(c3.ref, c3.revision, 'p5r-apply-3');
        const pointerReads = pointer.calls();
        pointer.release();
        expect(third, 'the sourceless click keeps B\'s refusal').toMatchObject(bBusy);
        expect(pointerReads, 'no Task graph read before the source exit').toBe(0);
      }, 120_000);
  });

describe('IV-END-1 questions: the answer\'s summary replies and the question card opens no planning round', () => {
  it('IV-END-1: the formal query_run reply, the Goal card, and the card answer waking one planresume round', async () => {
    const world = await openConsumeWorld({ label: 'iv-end-1' });
    worlds.push(world);
    await settleHost(world);
    const answer = questionsAnswer('IV questions', ['Which module owns the line?', 'Which check proves it?']);
    const { line, messageRef } = await openIdleSecretaryLine(world, answer, 'iv-end-1-line');

    const replied = await waitForResponse(world, messageRef);
    const queries = await sessionQueries(world, line);
    expect(queries, 'the planning Query exists').toHaveLength(1);
    expect(replied.response?.sender.kind, 'the reply comes from the formal query_run').toBe('query_run');
    expect(replied.response?.sender, 'the reply names the formal QueryRun')
      .toMatchObject({ queryRunRef: queries[0]!.ref });
    expect(await readBody(world, messageRef, 'response'), 'the reply body is the answer\'s summary').toBe('IV questions');
    expect(await notices(world, line, INVALID_PLAN_NOTICE), 'a questions answer sends no invalid_plan notice').toEqual([]);
    expect(await notices(world, line, NO_ANSWER_NOTICE), 'a questions answer sends no no_answer notice').toEqual([]);

    const cards = await heartbeatUntil(world, () => questionCards(world, world.goals.second),
      items => items.length === 2);
    expect(cards, 'each model question has one card for the Goal').toHaveLength(2);
    expect(cards[0]!.subject, 'the card subject is the intervened Goal')
      .toMatchObject({ kind: 'goal', goalRef: world.goals.second });
    expect(cards[0]!.source.pins.some(pin => (pin.ref as { aggregateType?: string }).aggregateType === 'QueryJobAnswer'),
      'the card pins the formal answer').toBe(true);

    const callsBefore = (await world.scripted.requests(line)).length;
    const queriesBefore = (await sessionQueries(world, line)).length;
    const resolved = await answerCard(world, cards[0]!, 'iv-end-1-answer', 'The coordinator module owns it');
    expect(resolved.answer.status, 'the card answer commits').toBe('committed');
    expect(resolved.state, 'the card is answered').toBe('answered');
    const after = (await s6aCardsWorkspace(world, S6A_SCOPE).readCards(world.goals.second))
      .find(card => card.cardKey === cards[0]!.cardKey);
    expect(after?.answerMessageRef, 'the card records its answer message').not.toBeNull();
    expect(await readBody(world, after!.answerMessageRef!, 'response'),
      'the saved card answer text').toBe('The coordinator module owns it');
    // P2 §6 (IV-intervention-host:151, re-ruling 4): a card answer wakes the line. With every planning question
    // answered the goal loop sends one `planresume:` planning round — a new Query and a new model request. The
    // goal loop is the public `workflow/advance` step (the same one IV-END-1b drives); the Host consume loop then
    // serves the system round on the line's own profile. Script that round's model reply before it opens.
    await world.scripted.script(line, [{ kind: 'text', text: questionsAnswer('IV after the resume', ['One more?']) }]);
    const secondCard = cards[1]!;
    await answerCard(world, secondCard, 'iv-end-1-answer-2', 'The work line owns it');
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: world.goals.second, flowId: 'iv-end-1',
      sessionHint: null, kind: 'select_work' }, { stopBefore: operation => operation.kind === 'claim_task' });
    const woken = await heartbeatUntil(world, () => sessionQueries(world, line),
      queries => queries.length > queriesBefore);
    expect(woken, 'the card answers wake exactly one planning round').toHaveLength(queriesBefore + 1);
    expect((await world.scripted.requests(line)).length, 'the waking round makes one model request')
      .toBe(callsBefore + 1);
    const resumedBodies = await Promise.all(
      (await listed(world, 'inbox', line)).map(message => readBody(world, message.ref, 'message')));
    expect(resumedBodies, 'the planning question carries planresume:')
      .toEqual(expect.arrayContaining([expect.stringMatching(/^planresume:/)]));
  }, 120_000);

  // 依据：A17（p5-frozen:470、:491；design-frozen:433、:118、:653）。世界：执行者线的卡全答完后只发一条 `planresume:`，
  // 期望值：续轮 Query 冻结 plan_round，`submit_plan_round` 只写候选，线不 claim_task、不开新 Run，卡片答案仍在。
  // 具名变异：(a) 发送门仍只给参谋/秘书（零 planresume）；(b) 形状仍回 text（Query 是 text、没有 submit_plan_round）；(c) 续轮自己采用/领取（候选直接 accepted 或线被 claim）。
  it('IV-END-1b: every card answered on an executor line: one planresume: and one plan_round Query write only a candidate',
    async () => {
      const world = await openConsumeWorld({ label: 'iv-end-1b' });
      worlds.push(world);
      await settleHost(world);
      const goal = world.goals.second;
      const { line } = await openLine(world, 'iv-end-1b-line');
      const ws = s6aCardsWorkspace(world, S6A_SCOPE);
      const adopted = await adoptS6BPlan(ws, goal, { label: 'iv-end-1b', taskIds: ['iv-end-1b-task'],
        role: S6A_WORK_ROLE.templateId });
      await setS7AAutonomy(world, goal, 'every_step');
      await world.scripted.script(line, [{ kind: 'text', text: questionsAnswer('IV b', ['First?', 'Second?']) }]);
      await sendS7A2PersonMessage(world, { label: 'iv-end-1b', recipient: line.ref, goal });
      const cards = await heartbeatUntil(world, () => questionCards(world, goal), items => items.length === 2);
      const queriesBefore = (await sessionQueries(world, line)).length;

      // The continuation round's answer: add one optional future Task, so the model writes a plan candidate and nothing
      // adopts or claims it (the every_step Goal keeps it for the person). Script it before the cards are answered.
      const futureTaskId = 'iv-end-1b-future';
      const draft = plPlanChangeDraft(adopted.plan, goal, {
        planId: 'iv-end-1b-plan-v2',
        tasks: [...adopted.plan.tasks, { taskId: futureTaskId, title: 'IV END 1b optional future work',
          requirementLevel: 'optional', taskKind: 'work', disposition: 'active', phase: 'pending',
          scope: { kind: 'goal' }, executionIntent: 'request_execution' }],
        assignments: [...(adopted.plan.assignments ?? []), { taskId: futureTaskId, role: S6A_WORK_ROLE.templateId,
          instruction: 'IV END 1b optional future work' }],
        obligations: adopted.plan.obligations,
      });
      await world.scripted.script(line, [{ kind: 'calls', calls: [{ callId: 'iv-end-1b-plan',
        name: 'submit_plan_round', args: { answerKind: 'plan', summary: 'IV END 1b continuation',
          plan: plToolPlanOf(draft),
          reason: { text: 'IV END 1b continuation candidate', affectedTaskIds: [futureTaskId] } } }] }]);
      for (const [index, card] of cards.entries()) await answerCard(world, card, `iv-end-1b-${index}`, `answer ${index}`);
      await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'iv-end-1b', sessionHint: null,
        kind: 'select_work' }, { stopBefore: operation => operation.kind === 'claim_task'
          || operation.kind === 'create_session' });

      const inbox = await listed(world, 'inbox', line);
      const bodies = await Promise.all(inbox.map(message => readBody(world, message.ref, 'message')));
      const resumes = inbox.filter((_message, index) => bodies[index]!.startsWith('planresume:'));
      expect(resumes, 'exactly one planresume: to the executor line').toHaveLength(1);
      const resumeRef = resumes[0]!.ref;
      const resumeQuery = await heartbeatUntil(world, () => readPlanningQuery(world, resumeRef),
        record => record !== null);
      expect(resumeQuery, 'the planresume opens its planning Query').not.toBeNull();
      if (resumeQuery === null) return;
      const execution = resumeQuery.job.job.intent.execution;
      expect(execution.kind, 'the continuation stays an intervention planning Query').toBe('intervention_planning');
      if (execution.kind !== 'intervention_planning') {
        throw new Error('IV-END-1b: the continuation is not an intervention planning Query');
      }
      expect(execution.answerShape, 'the continuation Query freezes answerShape plan_round').toBe('plan_round');
      expect((await sessionQueries(world, line)).length - queriesBefore,
        'the answers open exactly one new Query').toBe(1);
      const proposalRead = await awaitProposal(world, proposalRefOf(resumeRef, goal), 16);
      expect(proposalRead.status, 'the continuation writes a candidate').toBe('ready');
      if (proposalRead.status !== 'ready') return;
      expect(proposalRead.value.status, 'the candidate waits for the person').toBe('candidate');
      expect(proposalRead.value.draft.tasks.find(task => task.taskId === futureTaskId),
        'the submitted change only adds optional future work')
        .toMatchObject({ requirementLevel: 'optional', taskKind: 'work', disposition: 'active' });
      expect(await sessionExecutions(world, line), 'the continuation claims no Task').toEqual([]);
      expect((await lineFacts(world, line)).latestWork, 'the continuation starts no Run').toBeNull();

      const saved = (await ws.readCards(goal)).filter(card => card.source.kind === 'planning_question');
      expect(await Promise.all(saved.map(card => readBody(world, card.answerMessageRef!, 'response'))),
        'the answers stay saved').toEqual(['answer 0', 'answer 1']);
    }, 120_000);
});

describe('IV-END-2 invalid answers: the fixed notice and the verbatim answer, with no proposal', () => {
  it.each([
    { label: 'iv-end-2', answer: 'this is not a plan, it is the model writing prose' },
    { label: 'iv-end-2b',
      answer: JSON.stringify({ schemaVersion: 2, kind: 'needs_decision', summary: 'IV empty', questions: [] }) },
  ])('$label: the rejected answer replies verbatim, one fixed notice, no proposal, and the next message is consumable',
    async ({ label, answer }) => {
      const world = await openConsumeWorld({ label });
      worlds.push(world);
      await settleHost(world);
      const { line, messageRef } = await openIdleLine(world, answer, `${label}-line`);

      const replied = await waitForResponse(world, messageRef);
      expect(replied.response?.sender.kind, 'the reply comes from the formal query_run').toBe('query_run');
      expect(await readBody(world, messageRef, 'response'), 'the reply is the original rejected text').toBe(answer);
      await heartbeatUntil(world, () => notices(world, line, INVALID_PLAN_NOTICE), items => items.length === 1);
      expect(await notices(world, line, INVALID_PLAN_NOTICE), 'exactly one fixed invalid_plan notice').toHaveLength(1);
      expect(await candidateCards(world, world.goals.second), 'the rejected answer writes no proposal').toEqual([]);
      expect(await readQueryAnswer(world, interventionPlanningQueryRefs(messageRef).queryJobRef),
        'the formal Answer itself is the rejected text, unchanged').toBe(answer);
      if (label === 'iv-end-2b') {
        expect(await questionCards(world, world.goals.second), 'no question cards come from the rejected answer')
          .toEqual([]);
      }

      const callsBefore = label === 'iv-end-2' ? (await world.scripted.requests(line)).length : 0;
      await world.scripted.script(line, [{ kind: 'text', text: questionsAnswer(`IV after ${label}`, ['The next?']) }]);
      const second = await sendS7A2PersonMessage(world, { label: `${label}-second`, recipient: line.ref,
        goal: world.goals.second });
      await waitForResponse(world, second.ref);
      const all = await sessionQueries(world, line);
      expect(all, 'the new message is not blocked by the old one').toHaveLength(2);
      expect(new Set(all.map(query => query.run.queryJobRef.queryJobId)).size).toBe(2);
      if (label === 'iv-end-2') {
        expect((await world.scripted.requests(line)).length, 'the model did not re-run for the old message')
          .toBe(callsBefore + 1);
        expect((await readS7BMessage(world, messageRef)).response?.sender.kind,
          'the old reply is still the formal query_run reply').toBe('query_run');
      }
    }, 120_000);
});

describe('IV-END-3 restart-no-answer (SQLite only): the saved Query pair continues and ends by notice plus withdrawal', () => {
  it('IV-END-3: the same Job/Run survives the crash, ends without an Answer, and the system Host may withdraw only such a source', async () => {
    const world = await openConsumeWorld({ backend: 'sqlite', label: 'iv-end-3' });
    worlds.push(world);
    await settleHost(world);
    const { line } = await openLine(world, 'iv-end-3-line');
    // > 16 KiB: a real gap, no formal Answer. The claim is held before its prepared commit so the crash lands
    // with the QueryRun still `claimed`.
    await world.scripted.script(line, [{ kind: 'text', text: 'x'.repeat(17 * 1024) }]);
    const prepared = world.gates.beforePrepared(line);
    const sent = await sendS7A2PersonMessage(world, { label: 'iv-end-3', recipient: line.ref,
      goal: world.goals.second });
    // The consumer runs on the injected clock: keep passing until the prepared commit is held, then crash. G7 W2: that
    // same pass submits and claims first, so the QueryRun reads `claimed` while its prepared commit is held.
    await heartbeatUntilModel(world, prepared, 12);
    const pair = await readPlanningQuery(world, sent.ref);
    expect(pair?.run.run.executionState?.phase, 'the planning Query is claimed').toBe('claimed');

    await world.crash();
    // Still the original Job/Run pair: the restart continues the saved claim, never a new Query.
    const afterCrash = await sessionQueries(world, line);
    const same = afterCrash.find(query => query.run.queryJobRef.queryJobId === pair!.run.run.queryJobRef.queryJobId);
    expect(same?.ref, 'the restart keeps the same QueryRun').toEqual(pair!.run.ref);
    expect(same?.run.executionState?.phase, 'the restart continues the saved pair instead of closing it')
      .not.toBe('settled');
    expect(same?.run.status, 'the restart does not close the saved QueryRun').not.toBe('closed');

    // Hold the one fixed notice before its commit: the source is formally ended but still unwithdrawn.
    const noticeHold = commitBarrier.hold(byIdentityPrefix('session-message-send:'));
    const held = await heartbeatUntilModel(world, noticeHold, 24);
    expect(await readQueryAnswer(world, pair!.run.run.queryJobRef), 'the resumed Query has no Answer').toBeNull();
    const ended = await readPlanningQuery(world, sent.ref);
    expect(ended?.run.run.status === 'closed'
      || ended?.run.run.executionState?.phase === 'settled', 'the QueryRun is formally ended').toBe(true);
    expect((await readS7BMessage(world, sent.ref)).withdrawnAt,
      'the source is not withdrawn before the notice commits').toBeNull();
    noticeHold.release();
    await held.settled;

    const withdrawn = await waitForWithdrawn(world, sent.ref);
    expect(withdrawn.response, 'no reply was associated').toBeNull();
    expect(await notices(world, line, NO_ANSWER_NOTICE), 'exactly one fixed no_answer notice').toHaveLength(1);
    expect(await readQueryAnswer(world, pair!.run.run.queryJobRef), 'the public read sees no formal Answer').toBeNull();

    // A new message is consumed although the first is withdrawn.
    await world.scripted.script(line, [{ kind: 'text', text: questionsAnswer('IV after no answer', ['One?']) }]);
    const second = await sendS7A2PersonMessage(world, { label: 'iv-end-3-second', recipient: line.ref,
      goal: world.goals.second });
    await waitForResponse(world, second.ref);
    expect(new Set((await sessionQueries(world, line))
      .map(query => query.run.queryJobRef.queryJobId)).size, 'the next message takes a new Query').toBe(2);
  }, 180_000);
});

describe('IV-END-3 guard: the system Host withdraw exception does not cover other intervention sources', () => {
  it('IV-END-3 guard: the system Host may not withdraw an open intervention source', async () => {
    const world = await openConsumeWorld({ label: 'iv-end-3-guard' });
    worlds.push(world);
    await settleHost(world);
    const { line } = await openLine(world, 'iv-end-3-guard-line');
    const openGate = await world.gates.modelRequest(line);
    await world.scripted.script(line, [{ kind: 'text', text: firstPlan({ label: 'iv-end-3-guard',
      taskId: 'iv-end-3-guard-task', role: S6A_WORK_ROLE.templateId }) }]);
    const open = await sendS7A2PersonMessage(world, { label: 'iv-end-3-guard', recipient: line.ref,
      goal: world.goals.second });
    const opened = await heartbeatUntilModel(world, openGate);
    const refused = await systemWithdraw(world, open.ref, 'iv-end-3-guard-withdraw');
    expect(refused, 'the system Host may not withdraw an open intervention source')
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect((await readS7BMessage(world, open.ref)).withdrawnAt, 'the guarded message stays').toBeNull();
    openGate.release();
    await opened.settled;
  }, 120_000);
});

describe('IV-END-4 not_adopted: the candidate waits, then the ending replies the answer\'s summary', () => {
  it.each([
    { ending: 'abandoned', label: 'iv-end-4' },
    { ending: 'replaced', label: 'iv-end-4r' },
  ])('IV-END-4 $ending: the candidate keeps the message, then not_adopted replies the answer\'s summary',
    async ({ ending, label }) => {
      const world = await openConsumeWorld({ label });
      worlds.push(world);
      await settleHost(world);
      const answer = firstPlan({ label: `${label}-a`, taskId: `${label}-a-task`, role: S6A_WORK_ROLE.templateId });
      const { line, messageRef } = await openIdleLine(world, answer, `${label}-line`);
      // The handler's real candidate at the deterministic intervention proposal address keeps the message parked.
      const candidate = await awaitCandidate(world, messageRef, world.goals.second);
      const waiting = await readS7BMessage(world, messageRef);
      expect(waiting.response, 'the message is not yet replied while the candidate waits').toBeNull();
      expect(waiting.withdrawnAt).toBeNull();
      expect((await consumeView(world, line))?.nextMessage?.messageRef, 'the offered message is the source')
        .toEqual(messageRef);
      expect(candidate.proposal.status).toBe('candidate');

      if (ending === 'abandoned') {
        const abandoned = await abandonCandidate(world, world.goals.second, candidate.proposal, `${label}-abandon`);
        expect(abandoned, 'the public abandon writes not_adopted/abandoned')
          .toMatchObject({ status: 'not_adopted', notAdopted: { reason: 'abandoned' } });
      } else {
        const replacement = await proposeReplacement(world, {
          goal: world.goals.second, requestId: `${label}-replace`, queryRef: candidate.query.run.queryJobRef,
          proposal: candidate.proposal, sourceMessageRef: messageRef, draft: replacementDraft(world, `${label}-b`),
        });
        const replaced = await readProposal(world, candidate.proposal.ref);
        expect(replaced, 'the first proposal is not_adopted/replaced')
          .toMatchObject({ status: 'not_adopted', notAdopted: { reason: 'replaced' } });
        expect((replaced as { notAdopted?: { replacedBy?: unknown } }).notAdopted?.replacedBy,
          'the first proposal names its replacement').toEqual(replacement.ref);
        expect(replacement.status, 'the replacement is a real candidate').toBe('candidate');
      }

      const replied = await waitForResponse(world, messageRef);
      expect(replied.response?.sender.kind, 'the formal answer becomes the reply').toBe('query_run');
      expect(await readBody(world, messageRef, 'response'),
        'the reply is the answer\'s summary; replacedBy is not followed').toBe(`S7B3 V s7b3-v-${label}-a`);
      // A replaced candidate is not declined (lead A3-06, `cp2g3a-r3-opus-rulings.md:39`; `p2-frozen.md:167` closes on
      // a decline or an adoption only): the chain's end is the pending replacement of this same round, so the round's
      // one fixed notice is the candidate notice, and no declined notice is sent.
      expect(await notices(world, line, ending === 'abandoned' ? DECLINED_NOTICE : CANDIDATE_NOTICE),
        'exactly one fixed notice of the chain end').toHaveLength(1);
      if (ending === 'replaced') {
        expect(await notices(world, line, DECLINED_NOTICE), 'a replacement is not declined').toHaveLength(0);
      }

      if (ending === 'abandoned') {
        expect(await sessionExecutions(world, line), 'the abandonment claims no Task').toEqual([]);
        expect((await lineFacts(world, line)).latestWork, 'the line has no Work from the abandonment').toBeNull();
        // The replied source stops being offered; a new message gets its own Query.
        expect((await consumeView(world, line))?.nextMessage, 'the replied source is no longer offered').toBeNull();
        await world.scripted.script(line, [{ kind: 'text', text: questionsAnswer('IV after declined', ['What next?']) }]);
        const second = await sendS7A2PersonMessage(world, { label: `${label}-second`, recipient: line.ref,
          goal: world.goals.second });
        await waitForResponse(world, second.ref);
        const ids = (await sessionQueries(world, line)).map(query => query.run.queryJobRef.queryJobId);
        expect(ids, 'the new message has a different Query').toHaveLength(2);
        expect(ids[1]).not.toBe(ids[0]);
      }
    }, 120_000);
});
