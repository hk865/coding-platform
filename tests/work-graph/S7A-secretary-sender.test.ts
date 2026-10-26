/** X-secretary-sender (§2.8, §3.4 item 12, §6.8): the resolved round is the sender; the Query mailbox tool stays closed. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { SESSION_MAILBOX_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import * as toolGroupAssembly from '../../src/core/agent-runtime/tool-group-assembly.js';
import { sessionMessageRefKey } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import type { SessionMessage, SessionMessageSendInputV1 } from '../../src/core/work-graph/model/communication-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { AG2B_WORK_TASK_ID } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, S6A_SECRETARY_ROLE } from '../helpers/S6A-request-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { adoptS6BPlan } from '../helpers/S6B1-fixture.js';
import {
  holdS7AQueryRound, openS7AQueryWorld, pauseS7AGoal, seedS7AGoalPlan, sendS7ASecretaryMessage, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));
const worlds: S6AHostWorld[] = [];
afterEach(async () => { commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });
async function heldSend<T>(world: S6AHostWorld, label: string, goalId: string | null,
  send: (context: CoreCallContext) => Promise<T>) {
  return { value: await holdS7AQueryRound(world, { label, goalId }, context => send(context)) };
}
describe('X-secretary-sender: the round is the sender', () => {
  it('persists the resolved round, its request root and effective goal', async () => {
    const opened = await openS7AQueryWorld({ backend: 'memory' });
    worlds.push(opened.world);
    // 「每步确认」 makes the inquiry await the person instead of releasing it.
    await setS7AAutonomy(opened.world, opened.goal, 'every_step');
    const sent = await sendS7ASecretaryMessage(opened.world,
      { label: 'x-secretary-sender', goalId: opened.goal.goalId }, opened.session, 'Please review the request.');
    // The resolver's shape: the frozen manifest carries the round, the run, the
    // session generation and the effective goal; the message names all of them.
    const request = sent.round.manifest.request;
    expect(request).not.toBeNull();
    if (request === null) return;
    const requestRoot: QueryJobRef = request.requestRoot;
    const run = sent.round.prepared.queryRunRef;
    const generation = sent.round.manifest.sessionGeneration;
    const secretary = sent.round.secretary.ref;
    expect(request.effectiveGoalId).toBe(opened.goal.goalId);
    expect(sent.round.query.job.job.requestRoot).toEqual(requestRoot);
    expect(sent.round.query.run.run.executionState?.sessionGeneration).toBe(generation);
    expect(sent.message).toMatchObject({
      revision: 1,
      status: 'pending',
      release: 'awaiting',
      pins: null,
      deadlineMs: 86_400_000,
      deadline: null,
      requestRoot,
      goalRef: { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId: opened.goal.goalId },
      sender: {
        kind: 'secretary_round',
        sessionRef: secretary,
        // The sender's run is the resolver's `run`, never the `round` (a
        // QueryJob ref has no `runId`, and a different aggregate type).
        queryRunRef: run,
        requestRoot,
        generation,
      },
    });
    expect((sent.message.sender as unknown as { queryRunRef: QueryJobRef }).queryRunRef)
      .not.toEqual(requestRoot as unknown as { aggregateType: string });
    // Exactly the four trusted sender facts, with no derived or input field.
    expect(sent.message.sender).toEqual({
      kind: 'secretary_round', sessionRef: secretary, queryRunRef: run, requestRoot, generation,
    });
    expect(sent.message.requestRoot).toEqual(requestRoot);
    expect('waitAfterSend' in sent.message).toBe(false);
    // The ordinary Query mailbox tool is still not granted: the secretary
    // binding keeps `read` and `look_graph` only, and the tool-name table keeps
    // its exact six mailbox names.
    expect(SESSION_MAILBOX_TOOL_NAMES).toEqual([
      'send_session_message', 'read_session_inbox', 'read_session_message',
      'read_session_message_body', 'ack_session_message', 'respond_session_message',
    ]);
    expect(sent.round.manifest.permissions.tools
      .filter(tool => (SESSION_MAILBOX_TOOL_NAMES as readonly string[]).includes(tool))).toEqual([]);
    expect(sent.context.principal.kind).toBe('query_run');
    // The request's owner is the request's own fact, read through the public
    // request view; the sending secretary is never substituted for it.
    const view = await opened.world.readRequest(requestRoot);
    expect(view.requestRoot).toEqual(requestRoot);
    expect(view.effectiveGoalId).toBe(opened.goal.goalId);
    expect(view.owner).not.toBeNull();
  });
  it('refuses a send on a paused Goal instead of throwing, and writes nothing', async () => {
    const opened = await openS7AQueryWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const seeded = await seedS7AGoalPlan(opened.world);
    await setS7AAutonomy(opened.world, seeded.goal, 'after_plan_confirmation');
    const held = await heldSend(opened.world, 'x-secretary-paused', seeded.goal.goalId, async context => {
      await pauseS7AGoal(opened.world, seeded.goal);
      return opened.world.platform.messages.sendMessage(context, {
        input: { recipient: opened.session.ref, text: 'The paused Goal refuses this inquiry.',
          intent: 'inquiry' as const, needsReply: true },
        meta: { requestId: 's7a-secretary-paused', expected: [] },
      });
    });
    expect(held.value).toMatchObject({ status: 'rejected', code: 'busy', reason: 'the Goal is not active' });
    const inbox = await opened.world.platform.messages.readInbox(opened.world.humanContext(),
      { recipient: opened.session.ref, page: { limit: 10 } });
    expect(inbox).toMatchObject({ status: 'ready', value: { items: [] } });
  });
  it('releases a no-goal secretary inquiry without a Goal guard, counter or pins', async () => {
    const opened = await openS7AQueryWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const hold = commitBarrier.hold(byIdentityPrefix('session-message-send:'), 'x-ax04');
    const sending = sendS7ASecretaryMessage(opened.world,
      { label: 'x-no-goal', goalId: null }, opened.session, 'No goal, but a deadline.');
    const batch = await hold.reached; hold.release();
    const sent = await sending;
    expect(sent.message).toMatchObject({ release: 'released', goalRef: null, pins: null,
      deadlineMs: 86_400_000, deadline: expect.any(String) });
    expect(batch.records.at(-1)?.refKey).toBe(sessionMessageRefKey(sent.message.ref));
    expect(batch.records).toHaveLength(2);
    expect(batch.guards.every(guard => !guard.refKey.includes('"Goal"')
      && !guard.refKey.includes('DispatchCounter'))).toBe(true);
    expect(batch.guards.some(guard => guard.refKey.includes('"SessionActivity"'))).toBe(true);
    expect(batch.claims).toEqual([]);
  });
  it('refuses a secretary followup that only touches the recipient, and writes nothing', async () => {
    const opened = await openS7AQueryWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const host = await opened.world.platform.messages.sendMessage(opened.world.humanContext(), {
      input: { recipient: opened.session.ref, text: 'the Host message to follow' }, meta: { requestId: 'x-ax10-host', expected: [] } });
    if (host.status !== 'committed') throw new Error(`the Host message did not commit: ${JSON.stringify(host)}`);
    const input: SessionMessageSendInputV1['input'] = { recipient: opened.session.ref,
      text: 'Only the recipient is shared.', intent: 'inquiry', needsReply: true, followupOf: host.value.ref };
    const held = await heldSend(opened.world, 'x-ax10', null, context =>
      opened.world.platform.messages.sendMessage(context, {
        input, meta: { requestId: 'x-ax10-send', expected: [] },
      }));
    expect(held.value).toMatchObject({ status: 'rejected', code: 'invalid' });
    const inbox = await opened.world.platform.messages.readInbox(opened.world.humanContext(),
      { recipient: opened.session.ref, page: { limit: 10 } });
    expect(inbox).toMatchObject({ status: 'ready', value: { items: [{ ref: host.value.ref }] } });
  });
});
describe.each(['memory', 'sqlite'] as const)('X-outbox: the person sees the secretary candidate (%s)', backend => {
  it('includes the secretary message in the Host senderSession outbox', async () => {
    const opened = await openS7AQueryWorld({ backend });
    worlds.push(opened.world);
    const sent = await sendS7ASecretaryMessage(opened.world,
      { label: 'x-outbox', goalId: null }, opened.session, 'For the person to read.');
    const page = await opened.world.platform.messages.readOutbox(opened.world.humanContext(),
      { senderSession: sent.round.secretary.ref, page: { limit: 10 } });
    expect(page).toMatchObject({ status: 'ready' });
    if (page.status !== 'ready') return;
    expect(page.value.items.map(item => item.ref)).toContainEqual(sent.message.ref);
    expect(page.value.sourceCursor).not.toBeNull();
  });
});
describe.each(['memory', 'sqlite'] as const)('X-outbox: the work_run caller skips the secretary candidate (%s)', backend => {
  it('skips the secretary messages on both pages and advances the cursor', async () => {
    const world = await openS6AHostWorld({ backend, secretaryWork: true, secretaryTools: ['read', 'look_graph'] });
    worlds.push(world);
    const recipient = await world.createWorkSession('x-outbox-work-recipient');
    const sent = await holdS7AQueryRound(world, { label: 'x-outbox-work', goalId: null },
      async (context, round) => {
        const refs: SessionMessage['ref'][] = [];
        for (const n of [1, 2, 3]) {
          const saved = await world.platform.messages.sendMessage(context, {
            input: { recipient: recipient.ref, text: `For the person to read ${n}.`,
              intent: 'inquiry' as const, needsReply: true },
            meta: { requestId: `x-outbox-work-${n}`, expected: [] },
          });
          if (saved.status !== 'committed') throw new Error(`the secretary send ${n} did not commit: ${JSON.stringify(saved)}`);
          refs.push(saved.value.ref);
        }
        return { round, refs };
      });
    const session = sent.round.secretary.ref;
    const readPage = async (context: CoreCallContext, cursor?: string) => {
      const page = await world.platform.messages.readOutbox(context,
        { senderSession: session, page: { limit: 2, ...(cursor === undefined ? {} : { cursor }) } });
      if (page.status !== 'ready') throw new Error(`the outbox page is not ready: ${JSON.stringify(page)}`);
      return page.value;
    };
    const hostPage1 = await readPage(world.humanContext());
    expect(hostPage1.nextCursor).not.toBeNull();
    const hostPage2 = await readPage(world.humanContext(), hostPage1.nextCursor!);
    expect([...hostPage1.items, ...hostPage2.items].map(item => item.ref.messageId).sort())
      .toEqual(sent.refs.map(ref => ref.messageId).sort());
    expect(hostPage2.nextCursor).toBeNull();

    await ensureProjectPointers(world);
    await adoptS6BPlan(s6aCardsWorkspace(world, S6A_SCOPE), S6A_GOAL_1, { label: 'x-outbox-work',
      taskIds: [AG2B_WORK_TASK_ID], role: S6A_SECRETARY_ROLE.templateId });
    await world.scripted.script(sent.round.secretary, [{ kind: 'text', text: 'x-outbox Work answer' }]);
    const contexts: CoreCallContext[] = [];
    const original = toolGroupAssembly.selectWorkToolGroup;
    const spy = vi.spyOn(toolGroupAssembly, 'selectWorkToolGroup').mockImplementation(input => {
      const real = original(input); contexts.push(input.context); return real;
    });
    try {
      await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: S6A_GOAL_1, flowId: 'x-outbox-work',
        sessionHint: session, kind: 'select_work', taskId: AG2B_WORK_TASK_ID }, { stopBefore: 'open_checks' });
    } finally { spy.mockRestore(); }
    const workContext = contexts.find(candidate => candidate.principal.kind === 'work_run');
    if (workContext === undefined) throw new Error('the Work Run captured no Runtime context');
    const workPage1 = await readPage(workContext);
    expect(workPage1.items).toEqual([]);
    expect(workPage1.nextCursor).not.toBeNull();
    const workPage2 = await readPage(workContext, workPage1.nextCursor!);
    expect(workPage2.items).toEqual([]);
    expect(workPage2.nextCursor).toBeNull();
  });
});
