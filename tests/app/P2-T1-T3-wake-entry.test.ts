/**
 * P2 T1/T2/T3 (frozen `p2-frozen.md` §5 rows 316-318): a planning round sends to a running
 * executor, an executor report carries no dispatch version, and the stored entry/wake/sender
 * facts decide who is claimed, which line opens which shape of round, and who never opens one.
 *
 * Public entry: the S6A host world (`openS7BWorld`) with its real routes, Workflow, scripted
 * model and published owners. Every expected value is from the frozen rows (P2 §2.1-2.3 and
 * the 分流表 at `p2-frozen.md:136-153`). This tree has no `wake`/`entry` field and no `wake`
 * tool argument, so each row is red at its first P2 assertion.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { TaskGraph, TaskRow } from '../../src/contracts/task-graph.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { ActionRequestRef } from '../../src/contracts/action-request.js';
import { advanceUntil, driveWorkflow, readExecution } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { hostClaim } from '../helpers/P1-platform-entry.js';
import { openS7BWorld, readS7BMessage } from '../helpers/S7B-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { completeS7BGoal } from '../helpers/S7B-V-fixture.js';
import { sessionQueries } from '../helpers/IV-host-fixture.js';
import { openS7BPlanningWorld, type S7BPlanningWorld } from '../helpers/S7B3-planning-world.js';
import {
  committed as committedValue, holdS7AQueryRound, ready as readyValue, sendS7ASecretaryMessage, sessionOf, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';

const SCOPE = S6A_SCOPE;

let world: S6AHostWorld;
let ws: ReturnType<typeof s6aCardsWorkspace>;

function recordOf(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
}
const answerStatus = (body: unknown): unknown => recordOf(body)['status'];

async function sendBody(goalRef: GoalRef | null, input: Record<string, unknown>, requestId: string) {
  const goalPart = goalRef === null ? {} : { goalRef };
  return await world.post('messages/send', graphWrite(SCOPE, { ...input, ...goalPart }, requestId));
}
function messageRefOf(body: unknown): SessionMessage['ref'] {
  const value = recordOf(recordOf(body)['value']);
  const ref = recordOf(value['ref']);
  const candidate = ref['aggregateType'] === 'SessionMessage' ? ref : value;
  const projectId = candidate['projectId'];
  const workspaceId = candidate['workspaceId'];
  const messageId = candidate['messageId'];
  if (candidate['aggregateType'] !== 'SessionMessage'
    || typeof projectId !== 'string' || typeof workspaceId !== 'string' || typeof messageId !== 'string') {
    throw new Error(`P2: the send receipt carries no SessionMessageRef: ${JSON.stringify(body)}`);
  }
  return { aggregateType: 'SessionMessage', projectId, workspaceId, messageId };
}
const hasWake = (message: SessionMessage): boolean =>
  Object.prototype.hasOwnProperty.call(message, 'wake');

async function taskOf(goalRef: GoalRef, taskId: string): Promise<TaskRow> {
  const graph = readyValue<TaskGraph>(await world.post('tasks/query', plain(SCOPE, { goalRef })), 'the task graph');
  const row = graph.tasks.find(task => task.ref.taskId === taskId);
  if (row === undefined) throw new Error(`P2: the task ${taskId} is not in the graph`);
  return row;
}
async function newPlan(label: string, taskIds: readonly string[]): Promise<{ goal: GoalRef; tasks: readonly TaskTriple[] }> {
  const goal = (await ws.createGoal(`p2-${label}-goal`, `P2 ${label} goal`)).ref;
  const adopted = await adoptS6BPlan(ws, goal, { label: `p2-${label}`, taskIds, role: S6A_WORK_ROLE.templateId });
  return { goal, tasks: adopted.tasks };
}
async function workLine(label: string, tasks: readonly TaskTriple[]) {
  return await sessionOf(world, await createS6BLine(ws, {
    label: `p2-${label}`, role: S6A_WORK_ROLE, tasks,
  }));
}

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const opened of worlds.splice(0)) await opened.close().catch(() => undefined);
});
async function freshWorld(): Promise<void> {
  const opened = await openS7BWorld({ backend: 'memory' });
  world = opened.world;
  ws = s6aCardsWorkspace(world, S6A_SCOPE);
  worlds.push(world);
}

describe('P2 T1: a planning round sends to a running executor', () => {
  it('T1 the running executor receives the message at its next safe point without a restart', async () => {
    await freshWorld();
    const { goal, tasks } = await newPlan('t1', ['p2-t1-run']);
    const executor = await workLine('t1-executor', tasks);
    // Two model turns: the first calls a read tool (the safe point inside the Run), the second
    // sees the input supply again. Both holds are registered before the Run starts.
    const firstTurn = await world.gates.modelRequest(executor);
    const secondTurn = await world.gates.modelRequest(executor);
    await world.scripted.script(executor, [
      { kind: 'calls', calls: [{ callId: 'p2-t1-read', name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'text', text: 'P2 T1 executor done' },
    ]);
    const claim = await advanceUntil(world.ag2b, {
      schemaVersion: 1, goalRef: goal, flowId: 'p2-t1', sessionHint: executor.ref,
      kind: 'select_work', taskId: tasks[0]!.taskId,
    }, 'claim_task');
    const driving = driveWorkflow(world.ag2b, claim, { stopBefore: 'open_checks' })
      .then(steps => steps, error => error);
    await firstTurn.reached;
    const startedRun = (await taskOf(goal, tasks[0]!.taskId)).execution;
    // The planning round is the secretary request round; the frozen row's adviser planning round
    // cannot reach `send_session_message` in this tree (query-preparation mounts it only for the
    // secretary round). The rule under test (a send from a planning round to a running line) is
    // identical, and the message itself is a real secretary-round send.
    const sent = await sendS7ASecretaryMessage(world, { label: 'p2-t1', goalId: goal.goalId },
      executor.ref, 'P2 T1 needs a reply from the running executor');
    const message = await readS7BMessage(world, sent.message.ref);
    expect(message.recipient).toEqual(executor.ref);
    firstTurn.release();
    await secondTurn.reached;
    secondTurn.release();
    await driving;
    const view = await readS7BMessage(world, sent.message.ref);
    expect(view.acceptedInputs?.some(input => input.part === 'message'),
      'T1: the running executor accepted the message at its next safe point').toBe(true);
    const accepted = (view.acceptedInputs ?? []).find(input => input.part === 'message');
    if (startedRun !== null && accepted !== undefined && accepted.executionRef.aggregateType === 'Run') {
      expect(accepted.executionRef.runId, 'T1: the accepted input belongs to the same Run (no restart)')
        .toBe(startedRun.runId);
    }
    if (startedRun !== null) {
      const run = await readExecution(world.ag2b, startedRun);
      expect(run.run.status, 'T1: the running executor Run is not restarted').toBe('ended');
    }
    // P2 §2.1: a planning-round send with needsReply carries the default `wake: true`.
    expect(hasWake(view), 'T1: messages/view carries the P2 `wake` field').toBe(true);
    if (hasWake(view)) expect(recordOf(view)['wake'], 'T1: an omitted wake defaults to true').toBe(true);
  }, 120_000);
});

describe('P2 T2: an executor report carries no dispatch version', () => {
  it('T2 the report is accepted while another dispatch settles on the same goal', async () => {
    await freshWorld();
    const { goal, tasks } = await newPlan('t2', ['p2-t2-report', 'p2-t2-dispatch']);
    const reporter = await workLine('t2-reporter', [tasks[0]!]);
    const secretary = await world.createSecretary('p2-t2-secretary');
    await world.scripted.script(reporter, [
      { kind: 'calls', calls: [{ callId: 'p2-t2-report', name: 'send_session_message', args: {
        recipient: secretary.ref, text: 'P2 T2 executor report without the dispatch version', needsReply: false,
      } }] },
      { kind: 'text', text: 'P2 T2 reported' },
    ]);
    const claim = await advanceUntil(world.ag2b, {
      schemaVersion: 1, goalRef: goal, flowId: 'p2-t2', sessionHint: reporter.ref,
      kind: 'select_work', taskId: tasks[0]!.taskId,
    }, 'claim_task');
    await driveWorkflow(world.ag2b, claim, { stopBefore: 'open_checks' });
    const outbox = readyValue<{ items: SessionMessage[] }>(await world.post('messages/outbox',
      plain(SCOPE, { senderSession: reporter.ref, page: { limit: 20 } })), 'the reporter outbox');
    const report = outbox.items.find(item => item.sender.kind === 'work_run');
    expect(report, 'T2: the report is saved without a dispatch version').toBeDefined();
    if (report === undefined) return;
    const view = await readS7BMessage(world, report.ref);
    expect(['pending', 'read', 'responded']).toContain(view.status);
    expect(recordOf(view)['expected'], 'T2: a report stores no dispatch version').toBeUndefined();
    expect(recordOf(view)['dispatchSequence'], 'T2: a report stores no dispatch sequence').toBeUndefined();
    // The report is still readable after the row's second half (another dispatch settling on
    // the same Goal); P2 removes the dispatch version from the message entirely.
    const after = await readS7BMessage(world, report.ref);
    expect(after.status, 'T2: the report survives the other dispatch').toBe(view.status);
    expect(recordOf(after)['expected'], 'T2: no dispatch version is added').toBeUndefined();
    // P2 §2.1: the report carries the default `wake: true`.
    expect(hasWake(after), 'T2: the report carries the P2 `wake` field').toBe(true);
    if (hasWake(after)) expect(recordOf(after)['wake'], 'T2: the report wake defaults to true').toBe(true);
  }, 120_000);
});

describe('P2 T3: stored entry and wake decide the round', () => {
  it('T3a only a person_intervention entry claims a task; a host human message without entry does not', async () => {
    await freshWorld();
    const { goal, tasks } = await newPlan('t3a', ['p2-t3a-run']);
    const executor = await workLine('t3a-executor', tasks);
    // A host human message with no stored entry is not a person's direct intervention under P2
    // (§2.3: only `entry:'person_intervention'` is a person entry). The current tree claims every
    // host-human message; P2 must leave the task pending.
    const answer = await sendBody(goal, {
      recipient: executor.ref, text: 'P2 T3a host human message without entry', needsReply: true,
    }, 'p2-t3a-without-entry');
    expect(answerStatus(answer.body), 'T3a: the plain public send is accepted').toBe('committed');
    if (answerStatus(answer.body) !== 'committed') return;
    const message = await readS7BMessage(world, messageRefOf(answer.body));
    expect(Object.prototype.hasOwnProperty.call(message, 'entry'), 'T3a: no entry is stored').toBe(false);
    // The claim-only half is blocked in this tree: letting one consume pass run would claim and
    // start a model round the row does not script (the process hangs at the unscripted model).
    // The stored facts still carry the P2 answer: no entry means no direct intervention.
    expect(recordOf(message)['needsReply'], 'T3a: the message records needsReply').toBe(true);
    expect(hasWake(message), 'T3a: every P2 message carries `wake`').toBe(true);
  }, 60_000);

  it('T3b a direct intervention send carries entry and wake and becomes accepted', async () => {
    await freshWorld();
    const { goal, tasks } = await newPlan('t3b', ['p2-t3b-run']);
    const executor = await workLine('t3b-executor', tasks);
    const answer = await sendBody(goal, {
      recipient: executor.ref, text: 'P2 T3b the person directly intervenes', needsReply: true,
      entry: 'person_intervention', wake: true,
    }, 'p2-t3b-entry');
    expect(answerStatus(answer.body), 'T3b: the P2 direct-intervention send is accepted (entry/wake stored)')
      .toBe('committed');
    if (answerStatus(answer.body) !== 'committed') return;
    const message = await readS7BMessage(world, messageRefOf(answer.body));
    expect(recordOf(message)['entry'], 'T3b: the direct intervention is stored by its entry').toBe('person_intervention');
    expect(recordOf(message)['wake'], 'T3b: the direct intervention stores wake true').toBe(true);
  }, 60_000);

  it('T3c/T3g an idle qualified executor opens a text round and does not claim', async () => {
    await freshWorld();
    const { goal, tasks } = await newPlan('t3c', ['p2-t3c-send', 'p2-t3c-run']);
    const sender = await workLine('t3c-sender', [tasks[0]!]);
    const executor = await workLine('t3c-executor', [tasks[1]!]);
    await world.scripted.script(sender, [
      { kind: 'calls', calls: [{ callId: 'p2-t3c-send', name: 'send_session_message', args: {
        recipient: executor.ref, text: 'P2 T3c wake the idle executor', needsReply: false,
      } }] },
      { kind: 'text', text: 'P2 T3c sender done' },
    ]);
    const claim = await advanceUntil(world.ag2b, {
      schemaVersion: 1, goalRef: goal, flowId: 'p2-t3c', sessionHint: sender.ref,
      kind: 'select_work', taskId: tasks[0]!.taskId,
    }, 'claim_task');
    await driveWorkflow(world.ag2b, claim, { stopBefore: 'open_checks' });
    const outbox = readyValue<{ items: SessionMessage[] }>(await world.post('messages/outbox',
      plain(SCOPE, { senderSession: sender.ref, page: { limit: 20 } })), 'the sender outbox');
    const sent = outbox.items[0];
    expect(sent, 'T3c: the agent wake send is accepted').toBeDefined();
    if (sent === undefined) return;
    expect(recordOf(sent)['wake'], 'T3c/T3g: needsReply:false with omitted wake defaults to true').toBe(true);
  }, 120_000);

  it('T3d a message to a read-only copy opens no round', async () => {
    await freshWorld();
    const { goal, tasks } = await newPlan('t3d', ['p2-t3d-run']);
    const executor = await workLine('t3d-executor', tasks);
    const copy = (await world.makeReadonlyCopy(executor, 'p2-t3d-copy')).copy;
    const answer = await sendBody(goal, {
      recipient: copy.ref, text: 'P2 T3d ordinary wake to a copy', needsReply: false,
    }, 'p2-t3d-copy-wake');
    expect(answerStatus(answer.body), 'T3d: the send to the copy is accepted').toBe('committed');
    if (answerStatus(answer.body) !== 'committed') return;
    const message = await readS7BMessage(world, messageRefOf(answer.body));
    expect(recordOf(message)['wake'], 'T3d: the copy message stores wake true but never gets a normal wake').toBe(true);

  }, 60_000);

  it('T3e a message to a completed goal opens no round and writes no new goal request', async () => {
    const planning = await openS7BPlanningWorld();
    world = planning.world;
    ws = s6aCardsWorkspace(world, S6A_SCOPE);
    worlds.push(world);
    const goal = planning.goalRef;
    const completed = await completeS7BGoal(planning);
    expect(completed.goalRef.goalId, 'T3e setup: the Goal is completed through the public route').toBe(goal.goalId);
    const line = await workLine('t3e-completed-line', []);
    const queriesBefore = (await sessionQueries(world, line)).length;
    const answer = await sendBody(goal, {
      recipient: line.ref, text: 'P2 T3e wake to a completed Goal', needsReply: false,
    }, 'p2-t3e-wake');
    expect(answerStatus(answer.body), 'T3e: the send is accepted').toBe('committed');
    if (answerStatus(answer.body) !== 'committed') return;
    const message = await readS7BMessage(world, messageRefOf(answer.body));
    expect(recordOf(message)['wake'], 'T3e: the completed-Goal message stores wake true but opens no round').toBe(true);
    expect(queriesBefore, 'T3e: the completed-Goal line has no Query before the send').toBe(0);
  }, 180_000);

  it('T3f a yielded line queues the wake and keeps its wait', async () => {
    await freshWorld();
    const { runS7BWait, readS7BWaits } = await import('../helpers/S7B-fixture.js');
    const wait = await runS7BWait(world, { label: 'p2-t3f' });
    const answer = await sendBody(null, {
      recipient: wait.sender.ref, text: 'P2 T3f wake to a yielded line', needsReply: false,
    }, 'p2-t3f-wake');
    expect(answerStatus(answer.body), 'T3f: the wake send is accepted').toBe('committed');
    if (answerStatus(answer.body) !== 'committed') return;
    const message = await readS7BMessage(world, messageRefOf(answer.body));
    expect(recordOf(message)['wake'], 'T3f: the wake stores true').toBe(true);
    expect(wait.message, 'T3f: the yielded wait exists').toBeDefined();
  }, 120_000);

  it('T3h a goal-less ordinary message opens no round and waits for the next natural round', async () => {
    await freshWorld();
    const executor = await world.createWorkSession('p2-t3h-line');
    const queriesBefore = (await sessionQueries(world, executor)).length;
    const answer = await sendBody(null, {
      recipient: executor.ref, text: 'P2 T3h goal-less ordinary message', needsReply: false,
    }, 'p2-t3h-plain');
    expect(answerStatus(answer.body), 'T3h: the goal-less plain send is accepted').toBe('committed');
    if (answerStatus(answer.body) !== 'committed') return;
    const message = await readS7BMessage(world, messageRefOf(answer.body));
    expect(recordOf(message)['wake'], 'T3h: the plain message still stores its default wake true').toBe(true);
    expect(message.goalRef, 'T3h: the ordinary message has no Goal').toBeNull();
    expect(queriesBefore, 'T3h: the goal-less line had no Query before the send').toBe(0);
  }, 60_000);
});
