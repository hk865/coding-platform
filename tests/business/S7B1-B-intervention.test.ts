/**
 * B-intervention (SR8 §8.4; book-7b.md:156, :664–:667; v3.4 B-01): a person's message on a Work line with an unfinished
 * Task is claimed with the `intervention` binding on the message's line and the open wait stays; a line with no
 * unfinished Task is `queued/no_task`; after a real Host restart in the default `ask` the pending GoalInterruption makes
 * the handler answer `busy`.
 *
 * `platform.workflow.handleIntervention` is L's publication (SR11 §11.5's `B-intervention`); this row now calls that
 * published member on the public message. The restart case is SQLite only because it restarts the Host
 * (`tests/RULES.md:193–:195` S3); the others are memory. B-06's two mutations: (1) make the intervention claim consume
 * the wait → the unfinished-case `open` assertion fails; (2) delete the pending-interruption guard → the restart case
 * answers `claimed`, not `busy`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { GoalDisplayHostReadV1 } from '../../src/app/goal-fan-out-driver.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, AG2B_WORK_ROLE_BINDING,
  graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { callPublishedOwnerAsHost, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { openS7BInterventionWorld, openS7BWorld, runS7BWait } from '../helpers/S7B-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

describe('B-intervention (memory)', () => {
  it('claims an unfinished Task on the message line and leaves the open wait open', async () => {
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const { wait, run, claim } = await openS7BInterventionWorld(world, { label: 'intervention-unfinished' });
    expect(claim.sessionRef).toMatchObject({ projectId: wait.waitingSession.projectId,
      sessionId: wait.waitingSession.sessionId });
    const facts = ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, wait.waitingSession)),
      'the unfinished wait facts');
    expect(wait.state.state).toBe('open');
    expect(facts.waits[0]).toMatchObject({ messageRef: wait.messageRef, state: { state: 'open' } });
    expect(facts.wait).toMatchObject({ messageRef: wait.messageRef, runRef: wait.originalRun });
    expect(claim.task).toEqual(facts.wait!.task);
    const inbox = ready<{ items: SessionMessage[] }>(await world.post('messages/inbox',
      plain(S6A_SCOPE, { recipient: wait.waitingSession, page: { limit: 20 } })), 'the intervention inbox');
    const sent = inbox.items.find(message => message.intent === 'action_request')!;
    const started = ready<{ run: RunSnapshot }>(await world.post('executions/read',
      plain(S6A_SCOPE, run)), 'the intervention execution');
    expect(started.run.task).toEqual(claim.task);
    expect(started.run.consumedWait).toMatchObject({ kind: 'intervention', messageRef: sent.ref });
  }, 120_000);

  it('starts the intervention planning Query for a line with no unfinished Task', async () => {
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const wait = await runS7BWait(world, { label: 'intervention-no-task' });
    // The recipient line was opened without a Task and has no latest Work Task.
    const sent = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: wait.recipient.ref, text: 'S7B intervene with no unfinished Task', intent: 'action_request',
      goalRef: wait.goal,
    }, 's7b-intervention-no-task-send')), 'the no-task intervention message');
    expect(sent.recipient).toEqual({ projectId: wait.recipient.ref.projectId, sessionId: wait.recipient.ref.sessionId });
    expect(sent.taskRef).toBeNull();

    expect(await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'workflow.handleIntervention', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, { messageRef: sent.ref, roleBinding: AG2B_WORK_ROLE_BINDING,
      runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID }))
      .toMatchObject({ status: 'progressed', branch: 'no_task', stage: 'query' });
  }, 120_000);
});

describe('B-intervention (SQLite only: the Host restart)', () => {
  it('a real restart in the default ask keeps the pending interruption and the message undelivered', async () => {
    const { world } = await openS7BWorld({ backend: 'sqlite' });
    worlds.push(world);
    const wait = await runS7BWait(world, { label: 'intervention-restart' });
    // The restart itself records the GoalInterruption; no record is written here.
    await world.crash();
    const display = ready<GoalDisplayHostReadV1>(
      await world.post('goals/display', plain(S6A_SCOPE, { goalRef: wait.goal })), 'the interrupted Goal display');
    expect(display.display.cause).toMatchObject({ code: 'interrupted_pending_resume', source: 'host_restart' });
    expect(display.display.causes).toContainEqual(expect.objectContaining({ code: 'interrupted_pending_resume' }));

    const sent = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: wait.sender.ref, text: 'S7B intervene after the restart', intent: 'action_request',
      goalRef: wait.goal, taskRef: wait.tasks[0],
    }, 's7b-intervention-restart-send')), 'the post-restart intervention message');

    // 97-9: a Task-scoped intervention never resolves the pending interruption; it answers `busy`.
    expect(await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'workflow.handleIntervention', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, { messageRef: sent.ref, roleBinding: AG2B_WORK_ROLE_BINDING,
      runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID }))
      .toMatchObject({ status: 'rejected', code: 'busy' });
    const saved = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, sent.ref)),
      'the undelivered post-restart intervention message');
    expect(saved.delivery).toBe('queued');
    expect((saved.acceptedInputs ?? []).some(entry => entry.part === 'message')).toBe(false);
  }, 120_000);
});
