/**
 * XWS2A rows XA-07, XA-08, XA-09, XA-10, XA-15 and XA-16: a main-workspace line works the second workspace's
 * Goal, reads its files, writes notes whose reminder reaches the main scribe, sends to the main scribe from the
 * second workspace's Run, and a second workspace executor line is not displaced by a main executor line. XA-09 keeps
 * the join across a Host restart.
 *
 * The world is `tests/helpers/XWS2A-world.ts`; every state is a public step and every read is a public route.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { bindingOf, sessionOf } from '../helpers/S7A-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import {
  openS6ATwoWorkspaceWorld, S6A_SCOPE, S6A_SECOND_SCOPE, S6A_WORK_ROLE, S6A_WORK_ROLE_BINDING,
  type S6AExtraBinding,
} from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { PL_ADVISER_ROLE, PL_ADVISER_ROLE_BINDING } from '../helpers/PL-consumption-fixture.js';
import { jsonOf } from '../helpers/S7C-member-fixture.js';
import { openLink } from '../helpers/S7D1-role-line-world.js';
import { S7D2_MODULE_IDS } from '../helpers/S7D2-role-line-world.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import {
  adoptSecondPlan, driveSecondWorkflow, noteCall, openXWS2AWorld, readRun, xws2aJoinRef,
  type XWS2AJoinRow, type XWS2AWorld,
} from '../helpers/XWS2A-world.js';
import { waitFor } from '../scenarios/harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const P = S6A_SCOPE.projectId;
const worlds: XWS2AWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

async function opened(options: Parameters<typeof openXWS2AWorld>[0] = { backend: 'memory' }): Promise<XWS2AWorld> {
  const world = await openXWS2AWorld(options);
  worlds.push(world);
  return world;
}

describe('XWS2A: the join survives a restart and a main-workspace line works the second workspace', () => {
  it('XA-07 the main adviser opens the second workspace Goal: Run and claim in ws2, sessionRef in ws1', async () => {
    const world = await opened();
    await world.waitCoarseAnswered();
    const { run, line } = await world.workRun({ label: 'xa07', replies: [{ kind: 'text', text: 'XA-07 done' }] });
    const record = await readRun(world, run);
    expect(record.run.workspaceSnapshot.workspaceId).toBe(world.second.scope.workspaceId);
    expect(record.outbox.claim.workspaceId).toBe(world.second.scope.workspaceId);
    expect(record.outbox.claim.sessionRef).toEqual(line.ref);
    expect(record.run.roleBinding).toEqual(PL_ADVISER_ROLE_BINDING);
  }, 180_000);

  it('XA-08 the Run reads README.md from the second workspace, not the first', async () => {
    const world = await opened({ backend: 'memory',
      mainFiles: { 'README.md': '# first workspace' },
      secondFiles: { 'README.md': '# second workspace' } });
    await world.waitCoarseAnswered();
    const { line } = await world.workRun({ label: 'xa08', replies: [
      { kind: 'calls', calls: [{ callId: 'xa08-read', name: 'read', args: { path: 'README.md' } }] },
      { kind: 'text', text: 'XA-08 done' },
    ] });
    const requests = await world.base.world.scripted.requests(line);
    const last = requests.at(-1);
    if (last === undefined) throw new Error('XA-08: the adviser served no model request');
    const seen = JSON.stringify(last);
    expect(seen).toContain('# second workspace');
    expect(seen).not.toContain('# first workspace');
  }, 180_000);

  it('XA-10 the main scribe gets the second workspace note reminder, with its anchor and count', async () => {
    const world = await opened({ backend: 'memory', extraHostOptions: { scribeReminderPeriodMs: 5 },
      coarseNote: true,
      secondFiles: Object.fromEntries(Array.from({ length: 10 }, (_, index) =>
        [`src/note-${String(index)}.ts`, `// XA-10 note ${String(index)}\n`])) });
    await world.waitCoarseAnswered();
    const joinNote = (await world.notes({ kind: 'module', moduleId: S7D2_MODULE_IDS.region }))
      .find(note => note.topic === 'xws2a-join-note');
    if (joinNote === undefined) throw new Error('XA-10: the join note is not readable');
    const calls = Array.from({ length: 10 }, (_, index) => noteCall(index, [joinNote.noteId]));
    const { run } = await world.workRun({ label: 'xa10', replies: [
      { kind: 'calls', calls }, { kind: 'text', text: 'XA-10 notes written' },
    ] });
    await readRun(world, run);
    world.base.world.clock.advance(10);
    const scribe = world.base.lines.scribe;
    const reminders = await waitFor(async () => (await world.inbox(scribe)).filter(message =>
      message.intent === 'notify' && message.sender.kind === 'host'),
    messages => messages.length > 0, 'the scribe reminder');
    const bodies = await Promise.all(reminders.map(message => world.messageText(message)));
    const index = bodies.findIndex(body => body.includes('书记提醒：'));
    expect(index).toBeGreaterThanOrEqual(0);
    const message = reminders[index]!;
    expect((message.recipient as SessionRef).sessionId).toBe(scribe.ref.sessionId);
    expect(message.ref.workspaceId).toBe(S6A_SCOPE.workspaceId);
    expect(bodies[index]).toContain('待审 10 条');
    expect(bodies[index]).toContain('src/note-0.ts');
  }, 180_000);

  it('XA-09 a Host restart resumes the one join at its saved phase without a second exploration', async () => {
    const world = await opened({ backend: 'sqlite' });
    const before = await world.waitCoarseAnswered();
    const ids = (before.explorations ?? []).map(entry => `${entry.queryRunRef.queryJobId}:${entry.queryRunRef.runId}`);
    await world.base.world.crash();
    const readJoin = async (): Promise<XWS2AJoinRow | null> => {
      try { return await world.join(); } catch { return null; }
    };
    const after = await waitFor(readJoin, row => row !== null, 'the join after the Host restart');
    expect(after!.operation).toEqual(xws2aJoinRef(P, world.second.scope.workspaceId));
    expect(after!.operation.operationId).toBe(xws2aJoinRef(P, world.second.scope.workspaceId).operationId);
    expect(after!.actionPhase).toBe(before.actionPhase);
    expect(after!.phase).toBe(before.phase);
    expect((after!.explorations ?? []).map(entry =>
      `${entry.queryRunRef.queryJobId}:${entry.queryRunRef.runId}`)).toEqual(ids);
    const rows = await world.operations(world.second.scope);
    expect(rows.filter(row => row.action === 'role_line'
      && row.operation.operationId === xws2aJoinRef(P, world.second.scope.workspaceId).operationId)).toHaveLength(1);
  }, 240_000);

  it('XA-15 the main adviser sends to the main scribe from the second workspace Run: the message lands in ws1', async () => {
    const world = await opened();
    await world.waitCoarseAnswered();
    const scribe = world.base.lines.scribe;
    const { line } = await world.workRun({ label: 'xa15', replies: [
      { kind: 'calls', calls: [{ callId: 'xa15-send', name: 'send_session_message',
        args: { recipient: scribe.ref, intent: 'notify', text: 'XA-15 跨工作区通知' } }] },
      { kind: 'text', text: 'XA-15 done' },
    ] });
    const sent = jsonOf(await world.base.world.scripted.requests(line), 'xa15-send') as { status: string };
    expect(sent.status).toBe('committed');
    const inbox = await world.inbox(scribe);
    const bodies = await Promise.all(inbox.map(message => world.messageText(message)));
    const index = bodies.indexOf('XA-15 跨工作区通知');
    expect(index).toBeGreaterThanOrEqual(0);
    const message = inbox[index]!;
    expect(message.intent).toBe('notify');
    expect(message.ref.workspaceId).toBe(S6A_SCOPE.workspaceId);
    expect(message.sender.kind).toBe('work_run');
    if (message.sender.kind !== 'work_run') throw new Error('XA-15: the message sender is not a Work Run');
    expect(message.sender.sessionRef).toEqual(line.ref);
    const secondInbox = valueOf<{ items: SessionMessage[] }>(await world.second.workspace.route('messages/inbox', {
      recipient: scribe.ref, page: { limit: 50 },
    }), 'ready', 'the second workspace inbox').items;
    expect(secondInbox.some(item => item.ref.messageId === message.ref.messageId)).toBe(false);
  }, 180_000);

  it('XA-16 a new selection on the second workspace Goal takes its own executor line, not a main executor line on its Goal', async () => {
    const baseWork = bindingOf('xa16-work-second', S6A_WORK_ROLE, 'XA-16 second workspace work', ['read']);
    const secondWorkBinding: S6AExtraBinding = {
      binding: { ...baseWork, scope: { ...S6A_SECOND_SCOPE } },
      workflow: { workspace: { ...S6A_SECOND_SCOPE }, sessionRole: S6A_WORK_ROLE,
        roleBinding: S6A_WORK_ROLE_BINDING, budget: { tokenBudget: 1_000_000, deadline: null } },
    };
    const { world } = await openS6ATwoWorkspaceWorld({ backend: 'memory', extraBindings: [secondWorkBinding] });
    let closeWorld: (() => Promise<void>) | null = null;
    try {
      closeWorld = () => world.close();
      const second = s6aCardsWorkspace(world, S6A_SECOND_SCOPE);
      const goal: GoalRef = (await second.createGoal('xa16-goal', 'XA-16 second workspace goal')).ref;
      // The project's governance (architecture and completion policy) is what `plans/apply` needs; the request
      // world seeds no governance, so the test writes it through the same public steps the S6A fixture uses.
      await governS6B(world, second, { first: goal, second: goal });
      // The second workspace's own executor line: a new selection there should take this one.
      const created = valueOf<{ ref: { projectId: string; sessionId: string } }>(await second.route('sessions/create', {
        workspace: { ...S6A_SECOND_SCOPE }, role: S6A_WORK_ROLE, recommendedRefs: [], initialLinks: [],
        meta: { requestId: 'xa16-second-line', expected: [] },
      }), 'completed', 'the XA-16 second executor line');
      const secondExecutor: SessionRef = { projectId: created.ref.projectId, sessionId: created.ref.sessionId };
      // The main-workspace executor line with an open responsible link on the second workspace's Goal. It is
      // created later, so the pick's latest-activity key would take it if the duty gate let it through.
      world.clock.advance(10);
      const mainExecutor = await world.createWorkSession('xa16-main');
      const linked = await openLink(world, { line: mainExecutor, target: { kind: 'goal', ref: goal },
        requestId: 'xa16-main-goal' });
      expect(linked.result.status).toBe('committed');
      // The Task has no Attempt yet: the selection is a new one through `chooseSession` and the project-wide
      // responsible-link read, not a requeue's afterRun continuation.
      const { taskId } = await adoptSecondPlan(world, second, goal, 'xa16', S6A_WORK_ROLE.templateId);
      const task: TaskTriple = { projectId: goal.projectId, goalId: goal.goalId, taskId };
      const before = await second.taskRun(goal, taskId);
      expect(before).toBeNull();
      world.scriptReplies([{ kind: 'text', text: 'XA-16 the second workspace executor line runs' }]);
      let current: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: goal, flowId: 'xa16-select',
        sessionHint: null, kind: 'select_work', taskId };
      let claimPending = false;
      let reachedChecks = false;
      for (let guard = 0; guard < 32; guard += 1) {
        const result = await second.route('workflow/advance', current) as WorkflowAdvanceResult;
        if (result.status !== 'ready') throw new Error(`XA-16: the Workflow call was not ready: ${JSON.stringify(result)}`);
        const value = result.value;
        if (claimPending) {
          // The new selection's claim has just been committed: read it before its Run opens a model turn.
          const run = await second.taskRun(goal, taskId);
          if (run === null) throw new Error('XA-16: the claimed Run is not readable');
          const record = valueOf<TaskExecutionRecord>(await second.route('executions/read', run), 'ready',
            'the XA-16 selected Run');
          // 1. the selection took the second workspace's own executor line, not the main line on its Goal.
          expect(record.outbox.claim.sessionRef).toEqual(secondExecutor);
          expect(record.outbox.claim.sessionRef).not.toEqual(mainExecutor.ref);
          claimPending = false;
        }
        if (value.state === 'completed' || value.next === null) break;
        if (value.next.kind === 'perform' && value.next.operation.kind === 'open_checks') {
          reachedChecks = true;
          break;
        }
        if (value.next.kind === 'perform' && value.next.operation.kind === 'claim_task') claimPending = true;
        current = value.next;
      }
      expect(reachedChecks).toBe(true);
      const selected = await second.taskRun(goal, taskId);
      if (selected === null) throw new Error('XA-16: the selected Run is not readable');
      const selectedRecord = valueOf<TaskExecutionRecord>(await second.route('executions/read', selected), 'ready',
        'the XA-16 selected Run');
      // 2. the main executor opened no turn: every model request belongs to the one selected Run.
      expect(world.model.calls()).toBe(1);
      const kernelRuns = [selectedRecord.run.executionAuthorization?.kernel?.runId ?? null];
      expect(new Set(world.model.requests.map(request => request.runId))).toEqual(new Set(kernelRuns));
      // 3. the selection happened: the Task now holds one new Run where it had none.
      expect(selected).not.toBeNull();
    } finally {
      if (closeWorld !== null) await closeWorld();
    }
  }, 240_000);

  it('XA-17 a ws1 line executing a ws2 Run does not block the same consumable page', async () => {
    const world = await opened();
    await world.waitCoarseAnswered();
    const adviser = world.base.lines.adviser;
    // A second ws1 line with a queued inquiry: the page's other candidate.
    const other = await world.base.world.createWorkSession('xa17-other');
    const sent = await world.base.world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: other.ref, text: 'XA-17 queued inquiry', intent: 'inquiry', needsReply: true,
    }, 'xa17-message', []));
    expect((sent.body as { status?: string }).status).toBe('committed');
    // Hold the main adviser's ws2 Run at its model request: its ws1 line is occupied while the Run is in ws2.
    const gate = await world.base.world.gates.modelRequest(adviser);
    const running = world.workRun({ label: 'xa17', replies: [{ kind: 'text', text: 'XA-17 held' }] });
    const occupied = await waitFor(async () => await world.base.world.readSession(adviser),
      card => card.record.occupancy !== null, 'the XA-17 occupied adviser line');
    expect(occupied.record.occupancy).not.toBeNull();
    const page = await world.base.world.platform.consumableSessions.readConsumableSessions(
      world.base.world.humanContext(), { workspace: S6A_SCOPE, after: null, limit: 50 });
    expect(page.status).toBe('ready');
    if (page.status !== 'ready') throw new Error(`XA-17: the consumable page is not ready: ${JSON.stringify(page)}`);
    const busy = page.value.items.find(item => item.session.sessionId === adviser.ref.sessionId);
    expect(busy?.busy).not.toBeNull();
    const queued = page.value.items.find(item => item.session.sessionId === other.ref.sessionId);
    expect(queued?.nextMessage).not.toBeNull();
    gate.release();
    await running;
  }, 180_000);

  it('XA-18 a ws2 Work Run reads the mail addressed to its ws1 line', async () => {
    const world = await opened();
    await world.waitCoarseAnswered();
    const adviser = world.base.lines.adviser;
    const sent = await world.base.world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: adviser.ref, text: 'XA-18 letter to the line', intent: 'notify',
    }, 'xa18-letter', []));
    const letter = valueOf<SessionMessage>(sent.body, 'committed', 'the XA-18 letter');
    const { line } = await world.workRun({ label: 'xa18', replies: [
      { kind: 'calls', calls: [
        { callId: 'xa18-inbox', name: 'read_session_inbox', args: { page: { limit: 50 } } },
        { callId: 'xa18-read', name: 'read_session_message', args: { messageRef: letter.ref } },
      ] },
      { kind: 'text', text: 'XA-18 read' },
    ] });
    const requests = await world.base.world.scripted.requests(line);
    const inbox = jsonOf(requests, 'xa18-inbox') as { items: SessionMessage[] };
    expect(inbox.items.some(message => message.ref.messageId === letter.ref.messageId)).toBe(true);
    const read = jsonOf(requests, 'xa18-read') as SessionMessage;
    expect(read.ref.messageId).toBe(letter.ref.messageId);
  }, 180_000);

  it('XA-19 a ws1 line waiting on a reply from its ws2 Run resumes after the reply arrives', async () => {
    const world = await opened();
    await world.waitCoarseAnswered();
    const main = world.base.main;
    const adviser = world.base.lines.adviser;
    // The reply comes from a second adviser line on its own main-workspace Goal: the counterparty is in ws1.
    const replyGoal = (await main.createGoal('xa19-reply-goal', 'XA-19 reply goal')).ref;
    const replyPlan = await adoptS6BPlan(main, replyGoal,
      { label: 'xa19-reply', taskIds: ['xa19-reply-task'], role: PL_ADVISER_ROLE.templateId });
    const recipient = await sessionOf(world.base.world, await createS6BLine(main,
      { label: 'xa19-recipient', role: PL_ADVISER_ROLE, tasks: replyPlan.tasks }));
    const { run, task } = await world.workRun({ label: 'xa19', replies: [
      { kind: 'calls', calls: [{ callId: 'xa19-send', name: 'send_session_message',
        args: { recipient: recipient.ref, text: 'XA-19 question', intent: 'inquiry',
          needsReply: true, waitAfterSend: true } }] },
    ] });
    const yielded = await waitFor(async () => await readRun(world, run),
      record => record.run.outcome !== null, 'the XA-19 yielded Run');
    expect(yielded.run.outcome).toBe('yielded');
    const questionRef = yielded.run.continuation?.messageRef;
    if (questionRef === undefined) throw new Error('XA-19: the yielded Run carries no wait message');
    const question = valueOf<SessionMessage>(await main.route('messages/read', questionRef), 'ready',
      'the XA-19 question');
    // The recipient's own Work Run writes the reply through the real tool.
    await world.base.world.scripted.script(recipient, [
      { kind: 'calls', calls: [{ callId: 'xa19-reply', name: 'respond_session_message',
        args: { messageRef: questionRef, expectedRevision: question.revision, text: 'XA-19 reply' } }] },
      { kind: 'text', text: 'XA-19 reply saved' },
    ]);
    await driveWorkflow(world.base.world.ag2b, { schemaVersion: 1, goalRef: replyGoal, flowId: 'xa19-reply',
      sessionHint: recipient.ref, kind: 'select_work', taskId: replyPlan.tasks[0]!.taskId }, { stopBefore: 'open_checks' });
    const replied = await waitFor(async () => valueOf<SessionMessage>(
      await main.route('messages/read', questionRef), 'ready', 'the XA-19 question'),
    message => message.response !== null, 'the XA-19 reply');
    expect(replied.response).not.toBeNull();
    // The waiting Run's continuation is claimed on the same ws1 line, after the wait is readable at the line.
    await world.base.world.scripted.script(adviser, [{ kind: 'text', text: 'XA-19 continuation done' }]);
    let resumedRef = await world.second.workspace.taskRun(world.second.goal, task.taskId);
    for (let attempt = 0; attempt < 4 && (resumedRef === null || resumedRef.runId === run.runId); attempt += 1) {
      await driveSecondWorkflow(world.second.workspace, { schemaVersion: 1, goalRef: world.second.goal,
        flowId: `xa19-accept-${String(attempt)}`, sessionHint: null, kind: 'select_work', taskId: task.taskId }, 'open_checks');
      resumedRef = await world.second.workspace.taskRun(world.second.goal, task.taskId);
    }
    if (resumedRef === null) throw new Error('XA-19: the continued Run is not readable');
    expect(resumedRef.runId).not.toBe(run.runId);
    const resumed = valueOf<TaskExecutionRecord>(
      await world.second.workspace.route('executions/read', resumedRef), 'ready', 'the XA-19 continued Run');
    expect(resumed.run.previousRun?.runId).toBe(run.runId);
    expect(await world.base.world.scripted.pending(adviser)).toBe(0);
  }, 240_000);

  it('XA-20 a ws1 line withdraws its own letter from the ws2 Run and the receiver sees it withdrawn', async () => {
    const world = await opened();
    await world.waitCoarseAnswered();
    const adviser = world.base.lines.adviser;
    const receiver = await world.base.world.createWorkSession('xa20-receiver');
    // Hold the send's commit answer so the test can read the letter and add the withdraw turn.
    const sentHold = commitBarrier.holdAfter(commit =>
      commit.records.some(record => record.schemaId === 'SessionMessage@1'), 'XA-20: after the send');
    const running = world.workRun({ label: 'xa20', replies: [
      { kind: 'calls', calls: [{ callId: 'xa20-send', name: 'send_session_message',
        args: { recipient: receiver.ref, text: 'XA-20 withdraw me', intent: 'notify' } }] },
    ] });
    await sentHold.reached;
    const letter = (await world.inbox(receiver)).find(message =>
      message.sender.kind === 'work_run' && message.sender.sessionRef.sessionId === adviser.ref.sessionId);
    if (letter === undefined) throw new Error('XA-20: the receiver has no letter from the Run line');
    await world.base.world.scripted.script(adviser, [
      { kind: 'calls', calls: [{ callId: 'xa20-withdraw', name: 'withdraw_session_message',
        args: { messageRef: letter.ref } }] },
      { kind: 'text', text: 'XA-20 withdrawn' },
    ]);
    sentHold.release();
    const { line } = await running;
    const sent = jsonOf(await world.base.world.scripted.requests(line), 'xa20-send') as { status: string };
    expect(sent.status).toBe('committed');
    const withdrawn = jsonOf(await world.base.world.scripted.requests(line), 'xa20-withdraw') as { status: string };
    expect(withdrawn.status).toBe('committed');
    const seen = valueOf<SessionMessage>(await world.base.main.route('messages/read', letter.ref), 'ready',
      'the XA-20 withdrawn letter');
    expect(seen.withdrawnAt).toEqual(expect.any(String));
    expect((await world.inbox(receiver)).some(message => message.ref.messageId === letter.ref.messageId
      && message.withdrawnAt !== null)).toBe(true);
  }, 240_000);

  it('XA-21 a ws1 reply reaches the next request of the same ws2 Run after a send that did not wait', async () => {
    const world = await opened();
    await world.waitCoarseAnswered();
    const main = world.base.main;
    const adviser = world.base.lines.adviser;
    // The counterparty is a second ws1 line on its own main-workspace Goal, as in XA-19.
    const replyGoal = (await main.createGoal('xa21-reply-goal', 'XA-21 reply goal')).ref;
    const replyPlan = await adoptS6BPlan(main, replyGoal,
      { label: 'xa21-reply', taskIds: ['xa21-reply-task'], role: PL_ADVISER_ROLE.templateId });
    const recipient = await sessionOf(world.base.world, await createS6BLine(main,
      { label: 'xa21-recipient', role: PL_ADVISER_ROLE, tasks: replyPlan.tasks }));
    // Hold the inquiry's commit answer so the reply is durable before the Run's next request.
    const sentHold = commitBarrier.holdAfter(commit =>
      commit.records.some(record => record.schemaId === 'SessionMessage@1'), 'XA-21: after the inquiry');
    const running = world.workRun({ label: 'xa21', replies: [
      { kind: 'calls', calls: [{ callId: 'xa21-send', name: 'send_session_message',
        args: { recipient: recipient.ref, text: 'XA-21 question', intent: 'inquiry', needsReply: true,
          waitAfterSend: false } }] },
    ] });
    await sentHold.reached;
    const question = (await world.inbox(recipient)).find(message =>
      message.sender.kind === 'work_run' && message.sender.sessionRef.sessionId === adviser.ref.sessionId);
    if (question === undefined) throw new Error('XA-21: the recipient has no question from the Run line');
    await world.base.world.scripted.script(recipient, [
      { kind: 'calls', calls: [{ callId: 'xa21-reply', name: 'respond_session_message',
        args: { messageRef: question.ref, expectedRevision: question.revision, text: 'XA-21 reply' } }] },
      { kind: 'text', text: 'XA-21 reply saved' },
    ]);
    await driveWorkflow(world.base.world.ag2b, { schemaVersion: 1, goalRef: replyGoal, flowId: 'xa21-reply',
      sessionHint: recipient.ref, kind: 'select_work', taskId: replyPlan.tasks[0]!.taskId }, { stopBefore: 'open_checks' });
    await waitFor(async () => valueOf<SessionMessage>(
      await main.route('messages/read', question.ref), 'ready', 'the XA-21 question'),
    message => message.response !== null, 'the XA-21 reply');
    await world.base.world.scripted.script(adviser, [{ kind: 'text', text: 'XA-21 done' }]);
    sentHold.release();
    const { line } = await running;
    const requests = await world.base.world.scripted.requests(line);
    const last = requests.at(-1);
    if (last === undefined) throw new Error('XA-21: the Run served no request after the inquiry');
    expect(JSON.stringify(last)).toContain('XA-21 reply');
  }, 240_000);

  it('XA-22 a ws1 project line busy in ws2 refuses the withdraw; the letter stays', async () => {
    const world = await opened();
    await world.waitCoarseAnswered();
    const adviser = world.base.lines.adviser;
    // Hold the Run at its model request: it is claimed in ws2 while its Session stays in ws1.
    const gate = await world.base.world.gates.modelRequest(adviser);
    const running = world.workRun({ label: 'xa22', replies: [{ kind: 'text', text: 'XA-22 held' }] });
    const occupied = await waitFor(async () => await world.base.world.readSession(adviser),
      card => card.record.occupancy !== null, 'the XA-22 occupied adviser line');
    expect(occupied.record.occupancy).not.toBeNull();
    try {
      // A sender in the line's own workspace sends to the busy line and withdraws its own letter.
      const sent = await world.base.world.post('messages/send', graphWrite(S6A_SCOPE, {
        recipient: adviser.ref, text: 'XA-22 letter to the busy line', intent: 'notify',
      }, 'xa22-send', []));
      const letter = valueOf<SessionMessage>(sent.body, 'committed', 'the XA-22 letter');
      const withdrawn = await world.base.world.post('messages/withdraw',
        graphWrite(S6A_SCOPE, { messageRef: letter.ref }, 'xa22-withdraw', []));
      expect(withdrawn.body).toMatchObject({ status: 'rejected', code: 'unavailable',
        reason: 'the recipient has an open execution that could have been offered this message' });
      const still = valueOf<SessionMessage>(await world.base.main.route('messages/read', letter.ref), 'ready',
        'the XA-22 letter after the refused withdraw');
      expect(still.withdrawnAt).toBeNull();
      expect((await world.inbox(adviser)).some(message => message.ref.messageId === letter.ref.messageId
        && message.withdrawnAt === null)).toBe(true);
    } finally {
      gate.release();
      await running;
    }
  });
});
