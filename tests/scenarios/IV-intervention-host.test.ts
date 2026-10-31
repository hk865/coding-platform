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
import { afterEach, describe, expect, it } from 'vitest';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import { AG2B_PROJECT_REF, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, AG2B_WORKSPACE_REF,
  graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution } from '../helpers/A2-restart-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, S6A_WORK_ROLE_BINDING } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan } from '../helpers/S6B1-fixture.js';
import { committed, pauseS7AGoal, ready, resumeS7AGoal, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { approveS7A2Message, driveS7A2Release, sendS7A2PersonMessage, sendS7A2Request } from '../helpers/S7A2-fixture.js';
import { firstPlan, refinementPlan } from '../helpers/S7B-V-fixture.js';
import { claimQuery } from '../helpers/request-claim-steps.js';
import {
  awaitClaimedPlanning, awaitPlanningAnswer, awaitProposal, candidateCards, consumeView, createLine,
  heartbeat, heartbeatUntilModel, openConsumeWorld, openIdleLine, openLine, proposalRefOf, readPlanningQuery,
  sessionExecutions, sessionQueries, settleHost,
} from '../helpers/IV-host-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
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
    // `sendS7A2Request` sends a released `action_request` only on a Goal with an active Plan; the line itself has
    // no Task link, so the handler's no-task branch still runs. Every-step keeps the refinement a person card so
    // the line stays free after the answer.
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    await adoptS6BPlan(ws, world.goals.second, { label: 'iv4-base', taskIds: ['iv4-base-task'],
      role: S6A_WORK_ROLE.templateId });
    await setS7AAutonomy(world, world.goals.second, 'every_step');
    const source = await sendS7A2Request(world, { label: 'iv4-source', goal: world.goals.second,
      recipient: line.ref, intent: 'action_request' });
    const approved = await approveS7A2Message(world, source, 'iv4-source');
    const released = await driveS7A2Release(world, { goal: world.goals.second, messageRef: approved.ref,
      label: 'iv4-source' });
    await world.scripted.script(line, [
      { kind: 'text', text: await refinementPlan(world, world.goals.second,
        { label: 'iv4-source', taskId: 'iv4-source-task', role: S6A_WORK_ROLE.templateId }) },
      { kind: 'text', text: await refinementPlan(world, world.goals.second,
        { label: 'iv4-newer', taskId: 'iv4-newer-task', role: S6A_WORK_ROLE.templateId }) },
    ]);

    const claimed = await awaitClaimedPlanning(world, released.message.ref);
    expect(claimed?.run.run.executionState?.phase, 'the source planning Query is claimed').toBe('claimed');
    const newer = await sendS7A2PersonMessage(world, { label: 'iv4-newer', recipient: line.ref,
      goal: world.goals.second });
    const held = await consumeView(world, line);
    expect(held?.nextMessage?.messageRef, 'the claimed planning keeps its source ahead of the newer message')
      .toEqual(released.message.ref);

    const answered = await awaitPlanningAnswer(world, released.message.ref);
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

    const claimed = await awaitClaimedPlanning(world, messageRef);
    expect(claimed?.run.run.executionState?.phase, 'the planning Query is claimed before the pause').toBe('claimed');
    await pauseS7AGoal(world, world.goals.second);
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
