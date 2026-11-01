/**
 * Q-secretary-tools-service, Q-withdraw and Q-no-adviser-note.
 *
 * A real secretary request round is the only producer: the frozen tool list
 * carries the five secretary Query tools and `read_requests`; the model request
 * the Runtime serves is the offered set; the tool result and the mailbox read
 * carry the trusted round principal. The class table is exercised inside the
 * service row (a plain Query in the same world strips all six). The note row
 * uses the existing `record_note` path and reads the live note back through the
 * platform note read; N's satisfaction read consumes that note.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { driveWorkflow, readExecution } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { secretaryAnswer } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_SECRETARY_ROLE, S6A_WORK_ROLE, type S6ASession,
  type S6AWorldOptions } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, holdS6BRequestRound } from '../helpers/S6B1-fixture.js';
import { openS7B2RoundWorld } from '../helpers/S7B2-secretary-rounds.js';
import { openS7BL46World } from '../helpers/S7B-L46-fixture.js';
import { jsonOf } from '../helpers/S7C-member-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import type { ModuleOverlapGateV1 } from '../../src/core/work-graph/persistence/module-overlap-gate-codecs.js';

const SECRETARY_TOOLS = [
  'read', 'send_session_message', 'ack_session_message', 'respond_session_message',
  'withdraw_session_message', 'create_member', 'read_requests', 'record_note',
  // Names the secretary class must never receive, even when the Host grant
  // carries them.
  'write', 'edit', 'shell', 'read_session_inbox', 'read_session_message', 'read_session_message_body',
  'query_task_graph', 'query_ready_tasks', 'propose_future_plan',
] as const;
const SECRETARY_ONLY = [
  'send_session_message', 'ack_session_message', 'respond_session_message',
  'withdraw_session_message', 'create_member', 'read_requests',
] as const;
const STRIPPED = [
  'write', 'edit', 'shell', 'read_session_inbox', 'read_session_message', 'read_session_message_body',
  'query_task_graph', 'query_ready_tasks', 'propose_future_plan',
] as const;

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  await Promise.all(worlds.splice(0).map(world => world.close().catch(() => undefined)));
});

function toolNames(request: ModelRequest | undefined): string[] {
  if (request === undefined) throw new Error('the round served no model request');
  return request.tools.map(tool => tool.name);
}

function readValue<T>(answer: unknown, what: string): T {
  const result = answer as { status?: string; value?: T; code?: string; reason?: string };
  if (result.status !== 'ready') throw new Error(`${what} was not ready: ${JSON.stringify(answer)}`);
  return result.value as T;
}

type Held = { secretary: S6ASession; requestRoot: QueryJobRef; manifest: PreparedQueryManifestV1 };

/** Runs one real round with its first reply and optional later replies added at the held next request. */
async function runRound(world: S6AHostWorld, input: {
  label: string; goalId: string | null; first: S6AReply[];
  after?: Array<(request: ModelRequest, prior: readonly ModelRequest[]) => S6AReply[] | null>;
}): Promise<Held & { requests: ModelRequest[] }> {
  let task: Promise<void> | undefined;
  const held = await holdS6BRequestRound(world, { label: input.label, goalId: input.goalId,
    replies: () => input.first }, async round => {
    // Register every later request's hold while the first is still held, so a
    // fast second request cannot slip past an unregistered gate.
    const gates = [];
    for (const _ of input.after ?? []) gates.push(await world.gates.modelRequest(round.secretary));
    const run = (async () => {
      for (const [index, step] of (input.after ?? []).entries()) {
        const gate = gates[index]!;
        const request = await gate.reached;
        const prior = await world.scripted.requests(round.secretary);
        const replies = step(request, prior);
        if (replies !== null) await world.scripted.script(round.secretary, replies);
        gate.release();
      }
    })();
    task = run;
    return { secretary: round.secretary, requestRoot: round.request.requestRoot, manifest: round.manifest };
  });
  await task;
  return { ...held.value, requests: await world.scripted.requests(held.value.secretary) };
}

const refOf = (message: SessionMessage): SessionMessageRef => message.ref;

describe('Q-secretary-tools-service: the secretary request round', () => {
  it('lifts exactly the six secretary names and keeps every other Query stripped', async () => {
    const options: S6AWorldOptions & { secretaryTools: readonly string[] } = {
      backend: 'memory', secretaryTools: SECRETARY_TOOLS, extraHostOptions: { requestDriver: 'off' },
    };
    const { world, secretary } = await openS7B2RoundWorld(options);
    worlds.push(world);
    const target = await world.createWorkSession('q-service-target');
    // The adopted-plan Task and its responsible adviser are what create_member needs; every_step makes the call
    // the `needs_decision` arm of M's one autonomy table.
    await setS7AAutonomy(world, world.goals.first, 'every_step');
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const { tasks } = await adoptS6BPlan(main, world.goals.first, { label: 'q-service-member',
      role: S6A_WORK_ROLE.templateId, taskIds: ['q-service-member-task'] });
    await createS6BLine(main, { label: 'q-service-member-adviser', role: platformRoleProfile('adviser').template });
    const round = await runRound(world, { label: 'q-service', goalId: world.goals.first.goalId,
      first: [
        { kind: 'calls', calls: [{ callId: 'q-service-member', name: 'create_member', args: {
          duty: 'executor', scope: { kind: 'task', task: tasks[0]! }, reason: 'Q service member request',
        } }, { callId: 'q-service-send', name: 'send_session_message', args: {
          recipient: target.ref, text: 'Q service principal', intent: 'notify',
        } }] },
        { kind: 'text', text: secretaryAnswer({ body: 'Q service answer' }) },
      ] });

    // The Runtime's own offered list: the six lift for this secretary round,
    // and the read-only/whiteboard names stay stripped.
    const offered = toolNames(round.requests[0]);
    expect(offered).toEqual(expect.arrayContaining([...SECRETARY_ONLY]));
    for (const name of STRIPPED) expect(offered).not.toContain(name);
    expect(round.manifest.request).not.toBeNull();

    // The trusted principal of the tool call is the resolved round, and the
    // saved message carries it.
    const sent = jsonOf([round.requests[1]!], 'q-service-send') as { status: string; value: SessionMessage };
    expect(sent.status).toBe('committed');
    // One real create_member tool call: M's documented owner result for this every_step world.
    expect(jsonOf(round.requests, 'q-service-member')).toMatchObject({ status: 'needs_decision' });
    const message = readValue<SessionMessage>(
      (await world.post('messages/read', plain(S6A_SCOPE, refOf(sent.value)))).body, 'the sent message');
    expect(message.sender).toMatchObject({
      kind: 'secretary_round',
      sessionRef: { projectId: round.secretary.ref.projectId, sessionId: round.secretary.ref.sessionId },
      queryRunRef: expect.objectContaining({ aggregateType: 'QueryRun' }),
      requestRoot: round.requestRoot,
    });

    // A plain Query on a Secretary Session in the same world is not a request
    // round: the class fact strips all six.
    const plainLine = await world.createSecretary('q-service-plain');
    await world.scripted.script(plainLine, [{ kind: 'text', text: secretaryAnswer({ body: 'Q plain answer' }) }]);
    const refs = await world.occupy(plainLine);
    await world.finishQuery(refs);
    const plainRequests = await world.scripted.requests(plainLine);
    expect(plainRequests).toHaveLength(1);
    const plainOffered = toolNames(plainRequests[0]);
    for (const name of SECRETARY_ONLY) expect(plainOffered).not.toContain(name);
    for (const name of STRIPPED) expect(plainOffered).not.toContain(name);
  });
});

describe('Q-withdraw: the secretary withdraws its own round message', () => {
  it('records the real withdrawal and refuses another round through the tool result', async () => {
    const options: S6AWorldOptions & { secretaryTools: readonly string[] } = {
      backend: 'memory', secretaryTools: SECRETARY_TOOLS, extraHostOptions: { requestDriver: 'off' },
    };
    const { world } = await openS7B2RoundWorld(options);
    worlds.push(world);
    const target = await world.createWorkSession('q-withdraw-target');
    // Another round's message: its ref is the real tool result of that round.
    const other = await runRound(world, { label: 'q-withdraw-other', goalId: null,
      first: [
        { kind: 'calls', calls: [{ callId: 'q-other-send', name: 'send_session_message', args: {
          recipient: target.ref, text: 'Q other round message', intent: 'notify',
        } }] },
        { kind: 'text', text: secretaryAnswer({ body: 'Q other answer' }) },
      ] });
    const otherSent = jsonOf([other.requests[1]!], 'q-other-send') as { status: string; value: SessionMessage };
    expect(otherSent.status).toBe('committed');

    let ownRef: SessionMessageRef | undefined;
    const round = await runRound(world, { label: 'q-withdraw', goalId: null,
      first: [
        { kind: 'calls', calls: [{ callId: 'q-withdraw-send', name: 'send_session_message', args: {
          recipient: target.ref, text: 'Q withdraw me', intent: 'notify',
        } }] },
      ],
      after: [(request) => {
        const sent = jsonOf([request], 'q-withdraw-send') as { status: string; value: SessionMessage };
        if (sent.status !== 'committed') throw new Error('the secretary send did not commit');
        ownRef = refOf(sent.value);
        return [
          { kind: 'calls', calls: [
            { callId: 'q-withdraw-own', name: 'withdraw_session_message', args: { messageRef: refOf(sent.value) } },
            { callId: 'q-withdraw-other', name: 'withdraw_session_message',
              args: { messageRef: refOf(otherSent.value) } },
          ] },
          { kind: 'text', text: secretaryAnswer({ body: 'Q withdraw answer' }) },
        ];
      }] });

    const own = jsonOf(round.requests, 'q-withdraw-own') as {
      status: string; value?: { ref: SessionMessageRef } };
    expect(own.status).toBe('committed');
    expect(own.value?.ref).toMatchObject({ aggregateType: 'SessionMessage' });
    if (ownRef === undefined) throw new Error('the secretary send returned no message ref');
    const withdrawn = readValue<SessionMessage>((await world.post('messages/read',
      plain(S6A_SCOPE, ownRef))).body, 'the withdrawn message');
    expect(withdrawn.withdrawnAt).toEqual(expect.any(String));
    // The other round's message is a real refusal, never a success.
    const foreignRequest = round.requests.find(request => request.messages.some(
      message => message.role === 'tool' && message.callId === 'q-withdraw-other'));
    expect(foreignRequest).toBeDefined();
    const foreign = foreignRequest!.messages.find(
      message => message.role === 'tool' && message.callId === 'q-withdraw-other');
    expect(foreign?.role).toBe('tool');
    if (foreign?.role !== 'tool') return;
    expect(foreign.result.status).toBe('error');
    const output = foreign.result.output.find(block => block.kind === 'json')?.value as
      { status?: string; code?: string } | undefined;
    expect(output).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });
});

describe('Q-no-adviser-note: the secretary writes the gate note', () => {
  it('satisfies the no-adviser gate through the real record_note path', async () => {
    const options: S6AWorldOptions & { secretaryTools: readonly string[] } = {
      backend: 'memory', secretaryTools: ['read', 'record_note'],
    };
    const opened = await openS7BL46World(options);
    const world = opened.world;
    worlds.push(world);
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    // A real running Work Run (held at its model request) is the overlap basis;
    // a real secretary line is the only duty recipient, so the note request
    // reaches the secretary with no adviser line in the world.
    await createS6BLine(ws, { label: 'q-note-secretary', role: S6A_SECRETARY_ROLE });
    const runLine = await sessionOf(world, await createS6BLine(ws, { label: 'q-note-run', role: S6A_WORK_ROLE,
      tasks: [opened.tasks.B] }));
    await world.scripted.script(runLine, [{ kind: 'text', text: 'Q note running answer' }]);
    const hold = await world.gates.modelRequest(runLine);
    const driven = driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: opened.goalRef, flowId: 'q-note-run',
      sessionHint: runLine.ref, kind: 'select_work', taskId: opened.tasks.B.taskId });
    try {
      await hold.reached;
      const run = await ws.taskRun(opened.goalRef, opened.tasks.B.taskId);
      if (run === null) throw new Error('the q-note Run is not running');
      const execution = await readExecution(world.ag2b, run);
      const startedSince = execution.run.startedSince;
      if (startedSince === null) throw new Error('the q-note Run has no startedSince');
      const plan = await ws.activePlan(opened.goalRef);
      if (plan === null) throw new Error('the L46 Goal has no active Plan');
      const graph = readValue<{ tasks: readonly { ref: { taskId: string };
        currentAttempt?: { attemptId: string } }[] }>((await world.post('tasks/query',
        plain(S6A_SCOPE, { goalRef: opened.goalRef }))).body, 'the Task graph');
      const waiting = graph.tasks.find(task => task.ref.taskId === opened.tasks.C.taskId);
      if (waiting === undefined) throw new Error('the q-note waiting Task is not in the graph');
      const gateResult = await world.platform.overlapGates.openOverlapGate(world.systemContext(), {
        goalRef: opened.goalRef, task: opened.tasks.C, moduleId: 's6a-core',
        running: [{ task: opened.tasks.B, run, startCursor: startedSince }],
        planRevision: plan.planRevision, waitingAttempt: waiting.currentAttempt?.attemptId ?? 'none',
      });
      expect(gateResult).toMatchObject({ status: 'opened', noteRequest: 'sent' });
      if (gateResult.status !== 'opened') throw new Error('the gate did not open');
      const gate = gateResult.gate;
      expect(gate.noteRequest).toMatchObject({ recipient: expect.objectContaining({
        projectId: S6A_SCOPE.projectId }) });
      expect(gate.noteRequest?.recipient).not.toHaveProperty('aggregateType');

      const before = readValue<{ status: string }>(await world.platform.overlapGates.checkOverlapGate(
        world.systemContext(), { gate: gate.ref }), 'the pre-note gate read');
      expect(before).toEqual({ status: 'not_satisfied' });

      const noteRound = await runRound(world, { label: 'q-note', goalId: opened.goalRef.goalId,
        first: [
          { kind: 'calls', calls: [{ callId: 'q-note-write', name: 'record_note', args: {
            op: 'write', kind: 'decision', topic: 's7c-q-no-adviser',
            conclusion: 'the no-adviser interface note',
            anchor: { kind: 'module', moduleId: 's6a-core' },
            extraAnchors: [], facts: [], basisFiles: [], replaces: [], contradicts: [], coexistWith: [],
            structural: false, body: 'S7C Q no-adviser interface note',
          } }] },
          { kind: 'text', text: secretaryAnswer({ body: 'Q note answer' }) },
        ] });
      const write = jsonOf(noteRound.requests, 'q-note-write') as
        { write?: { status?: string; noteId?: string }; check?: unknown };
      expect(write.write?.status).toBe('accepted');
      const noteId = write.write?.noteId;
      if (noteId === undefined) throw new Error('the note tool returned no noteId');
      const note = readValue<{ noteId: string; kind: string; conclusion: string;
        anchor: { kind: string; moduleId?: string }; source: { duty?: string } }>(
        await world.platform.notes.readNote(world.humanContext(), { noteId }), 'the live note');
      expect(note).toMatchObject({ noteId, kind: 'decision', conclusion: 'the no-adviser interface note',
        anchor: { kind: 'module', moduleId: 's6a-core' }, source: { duty: 'secretary' } });

      const after = readValue<{ status: string; by?: string }>(
        await world.platform.overlapGates.checkOverlapGate(world.systemContext(), { gate: gate.ref }),
        'the post-note gate read');
      expect(after).toEqual({ status: 'satisfied', by: 'note' });
    } finally {
      hold.release();
      await driven.catch(() => undefined);
    }
  });
});
