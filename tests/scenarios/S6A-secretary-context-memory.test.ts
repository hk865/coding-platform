/**
 * The secretary round's context and memory, read through the tools a real
 * secretary round receives, on SQLite.
 *
 * Every row opens the Host world with its own request driver on, so the Host
 * itself claims, prepares, starts and answers each round; the test calls no
 * `queries/*` route. The scripted model's replies are queued on the owner
 * Session before the submit: a tool reply names the real `look_graph` /
 * `find_graph` call, the next reply answers, and the tool result is the `tool`
 * message of the following model request. Expected texts are the frozen
 * samples of `tests/helpers/S6A-prompt-samples.ts` filled with values public
 * steps returned, and the memory fixture's own literals; nothing is read from
 * the store and no record is written by hand.
 *
 * The refusal row wraps the two real owners with forwarding spies before the
 * Host starts (rule sheet A3): the calls are the production ones and the
 * wrappers only count them, so a refusal that reached an owner stays red.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { GraphReadPageV1, NodeCardV1 } from '../../src/core/work-graph/model/graph-context-contracts.js';
import type { MemoryLookupResultV1, MemoryResultV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { QueryRunRef } from '../../src/app/core-http-types.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import * as inputModule from '../../src/core/work-graph/tasks/context-input-service.js';
import * as historyModule from '../../src/core/agent-runtime/graph-execution-history.js';
import {
  openS6AHostWorld, type S6AHostWorld, type S6AHostWorldOptions, type S6AReply,
} from '../helpers/S6A-host-fixture.js';
import {
  seedS6AMemory, S6A_MEMORY_TEXTS, type S6AMemory, type S6AWrittenNote,
} from '../helpers/S6A-memory-fixture.js';
import { secretaryAnswer, submitRound, waitForRound } from '../helpers/S6A-history-fixture.js';
import {
  architectureSample, QUERY_PRELUDE, secretaryInputText, secretaryNotesSlot, secretaryRoleSlot, goalPayloadText,
  type SampleGoalPayload, type SampleNote, type SampleUnderstanding, type SecretaryInputSample,
} from '../helpers/S6A-prompt-samples.js';
import {
  S6A_GOAL_1, S6A_GOAL_2, S6A_SCOPE, type S6ASession,
} from '../helpers/S6A-request-fixture.js';

/** The Host grant of every row; the role section lists exactly these tools in this order. */
const SECRETARY_TOOLS = ['read', 'look_graph', 'find_graph'] as const;
/** Today's Query tool list for the Host grant `read`, in its declared order. */
const QUERY_TOOLS = ['read', 'list_files', 'search', 'symbols', 'code_index', 'project_source',
  'python_index', 'cpp_index', 'source_excerpt'] as const;
const BACKEND = 'sqlite' as const;

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

function remember(world: S6AHostWorld): S6AHostWorld {
  worlds.push(world);
  return world;
}

async function openWorld(extra: Partial<S6AHostWorldOptions> = {}): Promise<S6AHostWorld> {
  return remember(await openS6AHostWorld({
    backend: BACKEND,
    extraHostOptions: { requestDriver: 'on' },
    secretaryTools: [...SECRETARY_TOOLS],
    ...extra,
  }));
}

type Submit = Parameters<S6AHostWorld['submit']>[0];

type DrivenRound = { requestRoot: QueryJobRef; round: QueryJobRef; since: string };

/**
 * Queues the replies on the owner, submits and waits through the public steps
 * (`submitRound`, `waitForRound`), and projects the ended round's own `since`.
 */
async function drivenRound(world: S6AHostWorld, session: S6ASession, replies: readonly S6AReply[],
  submit: Submit): Promise<DrivenRound> {
  await world.scripted.script(session, replies);
  const round = await submitRound(world, submit);
  const view = await waitForRound(world, round.requestRoot, round.round, 'ended');
  const entry = view.rounds.find(candidate => candidate.ref.queryJobId === round.round.queryJobId);
  if (entry === undefined) throw new Error('the request read lists no such round');
  return { requestRoot: round.requestRoot, round: round.round, since: entry.since };
}

function firstUserText(requests: readonly ModelRequest[]): string {
  const request = requests[0];
  if (request === undefined) throw new Error('the Session served no model request');
  const message = request.messages.find(candidate => candidate.role === 'user');
  if (message === undefined || message.role !== 'user') throw new Error('the model request has no user message');
  return message.content;
}

/** The `tool` message of one call in the first request that carries its result. */
function toolOutcome(requests: readonly ModelRequest[], callId: string):
{ status: string; output: readonly { kind: string; value?: unknown }[] } {
  for (const request of requests) {
    const message = request.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
    if (message !== undefined && message.role === 'tool') {
      return message.result as { status: string; output: readonly { kind: string; value?: unknown }[] };
    }
  }
  throw new Error(`no model request carries the tool result ${callId}`);
}

/** The JSON output block of a tool result: the owner's `ReadResult`, verbatim. */
function toolJson(requests: readonly ModelRequest[], callId: string): unknown {
  const outcome = toolOutcome(requests, callId);
  const block = outcome.output.find(candidate => candidate.kind === 'json');
  if (block === undefined) throw new Error(`the tool result ${callId} has no JSON output`);
  return block.value;
}

function noteOf(note: S6AWrittenNote): SampleNote {
  return { noteId: note.noteId, version: note.version, kind: note.kind, anchor: note.anchor,
    conclusion: note.conclusion, structural: note.structural };
}

function understandingOf(note: S6AWrittenNote): SampleUnderstanding {
  return { noteId: note.noteId, version: note.version, conclusion: note.conclusion, sections: note.sections };
}

/** The goal request's whole input: the returned memory's goal payload and note index, and the Host grant. */
function goalInputSample(memory: S6AMemory, since: string, text: string): SecretaryInputSample {
  const architecture = memory.governance.architecture;
  const policy = memory.governance.policy;
  const project = memory.project.understanding;
  const goal = memory.first.understanding;
  if (project === null || goal === null) throw new Error('the memory fixture wrote no understanding');
  const payload: SampleGoalPayload = {
    goalId: memory.first.goalId,
    objective: memory.first.objective,
    autonomy: memory.first.autonomy,
    projectUnderstanding: understandingOf(project),
    goalUnderstanding: understandingOf(goal),
    norms: [...memory.project.norms].reverse().map(noteOf),
    normsOmitted: 0,
  };
  return {
    role: { policyRevision: 's6a-secretary-binding@1', tools: [...SECRETARY_TOOLS], takesSessionHistory: false },
    workspace: { projectId: 'ag2b-collab-project', workspaceId: memory.workspace.workspaceId,
      revision: memory.workspace.revision },
    executionRoles: ['builder'],
    architecture: architecture === null ? null : architectureSample(architecture),
    policy: policy === null ? null : { policyId: policy.policyId, revision: policy.revision },
    goals: memory.goals.map(entry => ({ goalId: entry.goalId, desiredState: entry.desiredState,
      objective: entry.objective })),
    request: { kind: 'goal', goal: payload, noteIndex: memory.first.notes.map(noteOf) },
    executionKind: 'semantic_query',
    round: { since, input: text },
  };
}

/** The no-goal notes slot: the project understanding line then the norms, newest first. */
function projectNotesSection(memory: S6AMemory): string {
  const understanding = memory.project.understanding;
  if (understanding === null) throw new Error('the memory fixture wrote no project understanding');
  return secretaryNotesSlot({ kind: 'no_goal', projectUnderstanding: understandingOf(understanding),
    norms: [...memory.project.norms].reverse().map(noteOf) }).trimStart();
}

function readValue<T>(answer: unknown): T {
  const result = answer as { status?: string; value?: T };
  expect(result.status, JSON.stringify(answer)).toBe('ready');
  if (result.status !== 'ready') throw new Error(`not ready: ${JSON.stringify(answer)}`);
  return result.value as T;
}

async function acceptedNotes(world: S6AHostWorld, goalId: string): Promise<string[]> {
  const value = readValue<{ items: { noteId: string; version: number }[] }>(await world.dispatch('notes/list',
    world.humanContext(), { scope: world.scope,
      input: { goalId, state: 'accepted', limit: 20, cursor: null } }));
  return value.items.map(item => `${item.noteId}@${String(item.version)}`);
}

describe('a secretary round sends the sampled memory sections', () => {
  it('sends the whole sampled goal input, its note index and one goal understanding', async () => {
    const world = await openWorld();
    const session = await world.createSecretary('a');
    const memory = await seedS6AMemory(world, { architecture: true, policy: true });
    const text = 'S6A goal request';
    const round = await drivenRound(world, session, [{ kind: 'text', text: secretaryAnswer({ body: 'S6A goal answer' }) }],
      { commandId: 's6a-context-goal', goalId: S6A_GOAL_1.goalId, text, continues: null, recipient: session });

    const input = firstUserText(await world.scripted.requests(session));
    expect(input).toBe(secretaryInputText(goalInputSample(memory, round.since, text)));

    // The notes section is the goal's own index: both goal notes, no duplicated understanding.
    expect(input).toContain('## Note index');
    for (const note of S6A_MEMORY_TEXTS.firstGoalNotes) expect(input).toContain(note.conclusion);
    const understanding = memory.first.understanding;
    if (understanding === null) throw new Error('the memory fixture wrote no goal understanding');
    expect(input.split(understanding.conclusion)).toHaveLength(2);
  }, 180_000);

  it('sends the project understanding and both norms in a no-goal round', async () => {
    const world = await openWorld();
    const session = await world.createSecretary('a');
    const memory = await seedS6AMemory(world, { architecture: true, policy: true });
    await drivenRound(world, session, [{ kind: 'text', text: secretaryAnswer({ body: 'S6A project answer' }) }],
      { commandId: 's6a-context-project', goalId: null, text: 'S6A no-goal request', continues: null,
        recipient: session });

    const input = firstUserText(await world.scripted.requests(session));
    const start = input.indexOf('## Note index');
    const end = input.indexOf('## Accepted task');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(input.slice(start, end).trimEnd()).toBe(projectNotesSection(memory));
  }, 180_000);
});

describe('a no-goal secretary round reads the project graph', () => {
  it('looks the architecture from the project root and carries the project notes on its cards', async () => {
    const world = await openWorld();
    const session = await world.createSecretary('a');
    await seedS6AMemory(world, { architecture: true, policy: true });
    await drivenRound(world, session, [
      { kind: 'calls', calls: [{ callId: 's6a-look-project', name: 'look_graph',
        args: { mode: 'path', path: '.', relation: 'card' } }] },
      { kind: 'text', text: secretaryAnswer({ body: 'S6A project look answer' }) },
    ], { commandId: 's6a-context-look', goalId: null, text: 'S6A project look request', continues: null,
      recipient: session });

    const requests = await world.scripted.requests(session);
    expect(toolOutcome(requests, 's6a-look-project').status).toBe('success');
    const read = toolJson(requests, 's6a-look-project') as
      { status: string; value: GraphReadPageV1<NodeCardV1> };
    expect(read.status).toBe('ready');
    expect(read.value.items.map(item => item.name)).toEqual(['S6A core', 'S6A UI']);
    expect(read.value.items.map(item => item.paths)).toEqual([['src'], ['src/ui']]);
    const notes = read.value.items[0]?.indexes.notes;
    expect(notes?.understanding.rows.map(row => row.conclusion))
      .toEqual([S6A_MEMORY_TEXTS.projectUnderstanding.conclusion]);
    expect(notes?.understanding.norms.map(row => row.conclusion)).toEqual([
      S6A_MEMORY_TEXTS.norms[1].conclusion,
      S6A_MEMORY_TEXTS.norms[0].conclusion,
    ]);
    expect(notes?.general).toEqual([]);
  }, 180_000);

  it('reads the second goal card by name, changing nothing', async () => {
    const world = await openWorld();
    const session = await world.createSecretary('a');
    const memory = await seedS6AMemory(world, { architecture: true, policy: true });
    const beforeSettings = await memory.readGoal(world.goals.second);
    const beforeNotes = await acceptedNotes(world, S6A_GOAL_2.goalId);
    await drivenRound(world, session, [
      { kind: 'calls', calls: [{ callId: 's6a-look-second', name: 'look_graph',
        args: { mode: 'node', target: { kind: 'goal', ref: world.goals.second },
          relation: 'card' } }] },
      { kind: 'text', text: secretaryAnswer({ body: 'S6A second goal answer' }) },
    ], { commandId: 's6a-context-second', goalId: null, text: 'S6A second goal request', continues: null,
      recipient: session });

    const requests = await world.scripted.requests(session);
    const looked = toolJson(requests, 's6a-look-second') as
      { status: string; value: GraphReadPageV1<NodeCardV1> };
    expect(looked.status).toBe('ready');
    expect(looked.value.items).toHaveLength(1);
    const card = looked.value.items[0]!;
    expect(card.node.kind).toBe('goal');
    expect(card.goal?.ref.goalId).toBe(S6A_GOAL_2.goalId);
    const goalRow = card.indexes.notes.understanding.rows.find(row => row.scope === 'goal');
    expect(goalRow?.conclusion).toBe('S6A goal two understanding: the second goal marker');

    expect((await memory.readGoal(world.goals.second)).revision).toBe(beforeSettings.revision);
    expect(await acceptedNotes(world, S6A_GOAL_2.goalId)).toEqual(beforeNotes);
  }, 180_000);
});

describe('the memory branch of find and lookup in a secretary round', () => {
  it('marks another goal cross-goal in a goal round and the same note project-wide in a no-goal round', async () => {
    const world = await openWorld();
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    await seedS6AMemory(world, { architecture: true, policy: true });

    await drivenRound(world, a, [
      { kind: 'calls', calls: [{ callId: 's6a-find-other-goal', name: 'find_graph',
        args: { memory: { v: 1, op: 'find', terms: ['S6A', 'goal', 'two', 'understanding'],
          match: 'all' } } }] },
      { kind: 'calls', calls: [{ callId: 's6a-find-own-note', name: 'find_graph',
        args: { memory: { v: 1, op: 'find', terms: ['S6A', 'goal', 'one', 'pitfall'],
          match: 'all' } } }] },
      { kind: 'text', text: secretaryAnswer({ body: 'S6A goal memory answer' }) },
    ], { commandId: 's6a-memory-goal', goalId: S6A_GOAL_1.goalId, text: 'S6A goal memory request',
      continues: null, recipient: a });

    const goalRequests = await world.scripted.requests(a);
    expect(toolOutcome(goalRequests, 's6a-find-other-goal').status).toBe('success');
    expect(toolOutcome(goalRequests, 's6a-find-own-note').status).toBe('success');
    const crossGoal = toolJson(goalRequests, 's6a-find-other-goal') as
      { status: string; value: MemoryResultV1 };
    expect(crossGoal.status).toBe('ready');
    expect(crossGoal.value.items).toHaveLength(1);
    expect(crossGoal.value.items[0]?.conclusion)
      .toBe('S6A goal two understanding: the second goal marker');
    expect(crossGoal.value.items[0]?.crossGoal).toBe(true);

    const own = toolJson(goalRequests, 's6a-find-own-note') as
      { status: string; value: MemoryResultV1 };
    expect(own.status).toBe('ready');
    expect(own.value.items).toHaveLength(1);
    expect(own.value.items[0]?.conclusion).toBe('S6A goal one pitfall');
    expect(own.value.items[0]?.crossGoal).toBe(false);

    await drivenRound(world, b, [
      { kind: 'calls', calls: [{ callId: 's6a-find-no-goal', name: 'find_graph',
        args: { memory: { v: 1, op: 'find', terms: ['S6A', 'goal', 'two', 'understanding'],
          match: 'all' } } }] },
      { kind: 'text', text: secretaryAnswer({ body: 'S6A project memory answer' }) },
    ], { commandId: 's6a-memory-project', goalId: null, text: 'S6A project memory request', continues: null,
      recipient: b });

    const projectRequests = await world.scripted.requests(b);
    expect(toolOutcome(projectRequests, 's6a-find-no-goal').status).toBe('success');
    const projectWide = toolJson(projectRequests, 's6a-find-no-goal') as
      { status: string; value: MemoryResultV1 };
    expect(projectWide.status).toBe('ready');
    expect(projectWide.value.items).toHaveLength(1);
    expect(projectWide.value.items[0]?.conclusion)
      .toBe('S6A goal two understanding: the second goal marker');
    expect(projectWide.value.items[0]?.crossGoal).toBe(false);
  }, 180_000);

  it('returns the project understanding and both norms from the project anchor lookup', async () => {
    const world = await openWorld();
    const session = await world.createSecretary('a');
    await seedS6AMemory(world, { architecture: true, policy: true });
    await drivenRound(world, session, [
      { kind: 'calls', calls: [{ callId: 's6a-lookup-project', name: 'look_graph',
        args: { memory: { v: 1, op: 'lookup', anchor: { kind: 'project' } } } }] },
      { kind: 'text', text: secretaryAnswer({ body: 'S6A lookup answer' }) },
    ], { commandId: 's6a-lookup', goalId: null, text: 'S6A lookup request', continues: null,
      recipient: session });

    const requests = await world.scripted.requests(session);
    expect(toolOutcome(requests, 's6a-lookup-project').status).toBe('success');
    const read = toolJson(requests, 's6a-lookup-project') as
      { status: string; value: MemoryLookupResultV1 };
    expect(read.status).toBe('ready');
    expect(read.value.items).toHaveLength(4);
    expect([...read.value.items.map(item => item.conclusion)].sort()).toEqual([
      S6A_MEMORY_TEXTS.projectUnderstanding.conclusion,
      S6A_MEMORY_TEXTS.norms[0].conclusion,
      S6A_MEMORY_TEXTS.norms[1].conclusion,
      S6A_MEMORY_TEXTS.projectNotes[0].conclusion,
    ].sort());
    expect(read.value.items.filter(item => item.kind === 'understanding')).toHaveLength(1);
    expect([...new Set(read.value.items.filter(item => item.kind !== 'understanding').map(item => item.kind))].sort())
      .toEqual(['convention', 'decision', 'pitfall']);
  }, 180_000);
});

describe('rejects: graph reads that need a goal in a no-goal secretary round', () => {
  it('refuses input and history reads without reaching either owner', async () => {
    const inputCalls = { page: 0 };
    const historyCalls = { read: 0 };
    const realInput = inputModule.createTaskContextInputService;
    const inputSpy = vi.spyOn(inputModule, 'createTaskContextInputService').mockImplementation(deps => {
      const real = realInput(deps);
      return { ...real,
        async readTaskInputPage(ctx, request) { inputCalls.page += 1; return await real.readTaskInputPage(ctx, request); } };
    });
    const realHistory = historyModule.createGraphExecutionHistoryReader;
    const historySpy = vi.spyOn(historyModule, 'createGraphExecutionHistoryReader').mockImplementation(deps => {
      const real = realHistory(deps);
      return { ...real,
        async readTaskExecutionHistory(ctx, request) {
          historyCalls.read += 1; return await real.readTaskExecutionHistory(ctx, request);
        } };
    });
    let world: S6AHostWorld;
    try {
      world = await openWorld();
    } finally {
      inputSpy.mockRestore();
      historySpy.mockRestore();
    }
    const session = await world.createSecretary('a');
    const memory = await seedS6AMemory(world, { architecture: true, policy: true });
    const before = await memory.readGoal(world.goals.first);
    await drivenRound(world, session, [
      { kind: 'calls', calls: [
        { callId: 's6a-refused-input', name: 'look_graph', args: {
          mode: 'input',
          consumer: { projectId: S6A_SCOPE.projectId, goalId: S6A_GOAL_1.goalId, taskId: 's6a-refused-task' },
          planRef: { aggregateType: 'PlanRevision', projectId: S6A_SCOPE.projectId, planId: 's6a-refused-plan' },
          declarationId: 's6a-refused-declaration',
        } },
        { callId: 's6a-refused-history', name: 'look_graph', args: {
          mode: 'history',
          runRef: { aggregateType: 'Run', projectId: S6A_SCOPE.projectId, goalId: S6A_GOAL_1.goalId,
            runId: 's6a-refused-run' },
        } },
      ] },
      { kind: 'text', text: secretaryAnswer({ body: 'S6A refusal answer' }) },
    ], { commandId: 's6a-refusal', goalId: null, text: 'S6A refusal request', continues: null,
      recipient: session });

    const requests = await world.scripted.requests(session);
    // The refusals happen before the two owners: neither wrapper counted a call.
    expect(inputCalls.page).toBe(0);
    expect(historyCalls.read).toBe(0);
    for (const callId of ['s6a-refused-input', 's6a-refused-history']) {
      expect(toolOutcome(requests, callId).status).toBe('error');
      expect(toolJson(requests, callId)).toEqual({ status: 'rejected', code: 'invalid',
        reason: 'this request has no goal' });
    }
    expect((await memory.readGoal(world.goals.first)).revision).toBe(before.revision);
  }, 180_000);
});

describe('a consultation copy Query keeps its own tools and context', () => {
  it('sends the Query prelude and the Query tool list, not the secretary input', async () => {
    const world = await openWorld({ secretaryTools: ['read'] });
    const a = await world.createSecretary('a');
    const memory = await seedS6AMemory(world, { architecture: true, policy: true });
    const copy = await world.makeReadonlyCopy(a, 's6a-copy');

    const request = world.model.requests.at(-1);
    if (request === undefined) throw new Error('the copy Query served no model request');
    const users = request.messages.filter(message => message.role === 'user');
    const lastUser = users.at(-1);
    if (lastUser === undefined || lastUser.role !== 'user') throw new Error('the copy request has no user message');
    // The copy Query's whole input: the Query prelude, the secretary role slot
    // with its `read` grant, and the goal payload of goal 1 — the project and goal
    // understandings and both norms — then the person's question. The copy names no
    // focus task, so it has no task section.
    const project = memory.project.understanding;
    const goalUnderstanding = memory.first.understanding;
    if (project === null || goalUnderstanding === null) throw new Error('the memory fixture wrote no understanding');
    expect(lastUser.content).toBe([
      QUERY_PRELUDE,
      '',
      secretaryRoleSlot({ policyRevision: 's6a-secretary-binding@1', tools: ['read'], takesSessionHistory: false }),
      '',
      '## Goal',
      goalPayloadText(memory.workspace, { goalId: memory.first.goalId, objective: memory.first.objective,
        autonomy: memory.first.autonomy, projectUnderstanding: understandingOf(project),
        goalUnderstanding: understandingOf(goalUnderstanding), norms: [...memory.project.norms].reverse().map(noteOf) }),
      '## Question',
      'S6A copy question s6a-copy',
    ].join('\n'));
    expect(lastUser.content.startsWith(QUERY_PRELUDE)).toBe(true);
    expect(lastUser.content).not.toContain('## This round');
    expect(lastUser.content).not.toContain('## Workspace');
    expect(lastUser.content).not.toContain('## Earlier rounds of this request on other secretaries');
    expect(request.tools.map(tool => tool.name)).toEqual([...QUERY_TOOLS].sort());

    const readPromptRecord = world.platform.runtime.readPromptRecord;
    if (readPromptRecord === undefined) throw new Error('the Host runtime has no readPromptRecord');
    const prompt = await readPromptRecord.call(world.platform.runtime, world.humanContext(),
      copy.query.queryRunRef as QueryRunRef);
    expect(prompt.status).toBe('ready');
    if (prompt.status !== 'ready') return;
    expect(prompt.value.set.toolNames).toEqual([...QUERY_TOOLS]);
    expect(prompt.value.set.sectionOrder.copy).toEqual(['role', 'goal', 'task']);
  }, 180_000);
});
