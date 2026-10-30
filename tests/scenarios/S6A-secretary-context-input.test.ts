/**
 * The secretary round's whole input and the prompt record the round freezes,
 * reached through the public steps only: the request commands, the Host's own
 * request-driver loop (claim, prepare, start and answer), each Session's
 * scripted model, the owner read of the request and the runtime's
 * prompt-record read.
 *
 * Rows:
 * - one input carrying all three task slots — the round this Session runs, the
 *   input it absorbs while a claim is held, and the earlier round the same
 *   request ran on another secretary — together with the frozen prompt set the
 *   round recorded: the section order of every Query call kind, the final
 *   Kernel tool list and every template the preparation read.
 * - a person's pack that overrides `secretary-round` with another legal
 *   section order and `secretary-answer` with other text reaching a real round:
 *   the section moves and the answer format is the person's text.
 * - a pack edit while the round waits at the start gate: the prepared input and
 *   the recorded set stay the ones the round was prepared with.
 *
 * SQLite only, as this file's row table says: every row needs the Host's own
 * request driver to run its rounds and the commit barrier to hold a real
 * prepared commit, which a memory run would only repeat.
 *
 * Expected texts are `tests/helpers/S6A-prompt-samples.ts` filled with what
 * public steps returned (the request read's `since` and input, the goals and
 * workspace the memory fixture read) and hand-written literals. Nothing here
 * reads a store, writes a record by hand or builds a platform value.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptRecordReadResultV1 } from '../../src/contracts/prompts/prompt-set.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import {
  answeredRound, followUp, secretaryAnswer, submitRound, waitForRound,
} from '../helpers/S6A-history-fixture.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { seedS6AMemory, type S6AMemory } from '../helpers/S6A-memory-fixture.js';
import {
  architectureSample, promptRecordOf, QUERY_PRELUDE, SECRETARY_ANSWER_FORMAT_V1, SECRETARY_ROUND_TEMPLATE_V1,
  SECRETARY_TEMPLATE_VERSIONS, secretaryInputText,
  type SampleRound, type SecretaryInputSample,
} from '../helpers/S6A-prompt-samples.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { DELIVERY_SET_IDS } from '../helpers/S7B-delivery-samples.js';

// The commit barrier holds the prepared commits the Host gates use; its two
// backend factories must be wrapped before any world opens, and the barrier is
// reset before the worlds close so no held commit keeps a close waiting.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close();
  expect(left).toEqual([]);
});

/** A SQLite world whose Host runs every request round in its own driver loop. */
async function openWorld(): Promise<S6AHostWorld> {
  const world = await openS6AHostWorld({ backend: 'sqlite', extraHostOptions: { requestDriver: 'on' } });
  worlds.push(world);
  return world;
}

/**
 * The project's two pointers, so a secretary round runs `semantic_query`, and
 * the goals and workspace the whole input shows, read by public steps. The
 * memory fixture is seeded here and its governance handed to the host fixture,
 * so neither helper replays the other's writes. It writes the notes: the
 * project understanding and both norms make the no-goal notes slot non-empty,
 * so a wrong section order or a dropped section is visible in the whole input.
 */
async function seeded(world: S6AHostWorld): Promise<S6AMemory> {
  const memory = await seedS6AMemory(world, { architecture: false, policy: false, notes: true });
  await ensureProjectPointers(world, memory.governance);
  return memory;
}

/** One round's material as the owner read of the request shows it. */
function roundOf(view: RequestCoreViewV1, ref: QueryJobRef): SampleRound {
  const found = view.rounds.find(entry => entry.ref.queryJobId === ref.queryJobId);
  if (found === undefined) throw new Error(`the request read lists no round ${ref.queryJobId}`);
  return { since: found.since, input: found.input };
}

/** The round's entry in the owner read, once it reads `ended` on `session`. */
function endedOn(view: RequestCoreViewV1, ref: QueryJobRef, session: S6ASession): void {
  const found = view.rounds.find(entry => entry.ref.queryJobId === ref.queryJobId);
  if (found === undefined) throw new Error(`the request read lists no round ${ref.queryJobId}`);
  if (found.status !== 'ended') throw new Error(`the round ${ref.queryJobId} reads ${found.status}`);
  if (found.session?.sessionId !== session.ref.sessionId) {
    throw new Error(`the round ${ref.queryJobId} ran on ${JSON.stringify(found.session)}, not ${session.label}`);
  }
}

/**
 * The whole input the secretary received: the last user message of the last
 * model request the Session's queue served. A Session that already answered a
 * round carries earlier exchanges, so the current input is the last user turn.
 */
async function lastInput(world: S6AHostWorld, session: S6ASession): Promise<string> {
  const requests = await world.scripted.requests(session);
  const last = requests.at(-1);
  if (last === undefined) throw new Error(`${session.label} served no model request`);
  for (let index = last.messages.length - 1; index >= 0; index -= 1) {
    const message = last.messages[index] as { role?: string; content?: unknown } | undefined;
    if (message?.role === 'user' && typeof message.content === 'string') return message.content;
  }
  throw new Error(`the last model request of ${session.label} has no user input`);
}

/** The set's template entries, as the set names each used template's source pack and version. */
function templateEntries(record: PromptRecordReadResultV1): { id: string; version: number; packId: string }[] {
  return record.set.templates.map(entry => ({ id: entry.id, version: entry.version, packId: entry.packId }));
}

/** The delivery-set templates a preparation freezes after the ones the round read, from the platform pack. */
const DELIVERY_SET_ENTRIES = DELIVERY_SET_IDS.map(id => ({ id, version: 1, packId: 'platform' }));

/**
 * The sample's fixed sections: the role the binding prepared, the workspace and
 * the goal list the memory fixture read, and the no-goal request whose notes
 * slot lists the project understanding and then the norms, newest first.
 */
function noGoalSample(memory: S6AMemory, round: SampleRound): Omit<SecretaryInputSample, 'batched' | 'earlier'> {
  const governance = memory.governance;
  const architecture = governance.architecture;
  const policy = governance.policy;
  return {
    role: { policyRevision: 's6a-secretary-binding@1', tools: ['read'], takesSessionHistory: false },
    workspace: { projectId: 'ag2b-collab-project', workspaceId: memory.workspace.workspaceId,
      revision: memory.workspace.revision },
    executionRoles: ['builder'],
    architecture: architecture === null ? null : architectureSample(architecture),
    policy: policy === null ? null : { policyId: policy.policyId, revision: policy.revision },
    goals: memory.goals.map(goal => ({ goalId: goal.goalId, desiredState: goal.desiredState,
      objective: goal.objective })),
    request: { kind: 'no_goal',
      projectUnderstanding: memory.project.understanding,
      norms: [...memory.project.norms].reverse() },
    executionKind: 'semantic_query',
    round,
  };
}

// The platform pack's own texts, from the frozen samples: the round template and
// the first sentence of the semantic answer format. The two person's texts are
// the test's own pack edits.
const PLATFORM_ROUND_TEXT = SECRETARY_ROUND_TEMPLATE_V1;
const PERSON_ROUND_TEXT = '{{prelude}}\n\n{{role}}{{goal}}{{task_round}}{{task_batched}}{{task_earlier}}{{notes}}';
const EDITED_ROUND_TEXT = '{{prelude}}\n\n{{role}}{{notes}}{{goal}}{{task_round}}{{task_batched}}{{task_earlier}}';
const PLATFORM_ANSWER_OPENING = `${SECRETARY_ANSWER_FORMAT_V1.split('. ')[0]}.`;
const PACK_ID = 's6a-input-pack';

/**
 * Selects the person's pack for the workspace's model through the settings
 * routes; the selection must name the pack and the model that carries it, so a
 * row that then reads the platform pack fails for the right reason.
 */
async function selectPack(world: S6AHostWorld): Promise<void> {
  const selected = await world.packs.select(PACK_ID);
  const carrying = selected.models.filter(model => model.promptPack === PACK_ID);
  expect(carrying).toHaveLength(1);
  expect(selected.workspaces).toEqual(expect.arrayContaining([
    expect.objectContaining({ scope: { ...S6A_SCOPE }, modelId: carrying[0]!.id }),
  ]));
}

describe('the whole input of a round that absorbs a queued input after an earlier round on another secretary', () => {
  // Rule: one input carries the three task slots of the request — this round,
  // the pending input this one absorbs, and the ended rounds that ran on
  // another Session with their stored answer — and the round records the
  // prompt set it was prepared with.
  it('sends the earlier round, this round and the queued input as one input, and records the frozen set', async () => {
    const world = await openWorld();
    const memory = await seeded(world);
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');

    // The person's request has no goal, so the whole input shows the goal list,
    // the no-goal line and the project's notes (its understanding and norms).
    const earlierAnswer = 'S6A earlier answer on A';
    const earlier = await answeredRound(world, {
      session: a, answer: secretaryAnswer({ body: earlierAnswer }),
      submit: { commandId: 's6a-input-1', goalId: null, text: 'S6A earlier question 1', continues: null, recipient: a },
    });
    const routed = await world.route({ commandId: 's6a-input-route', round: earlier.requestRoot, to: b });
    expect(routed.status).toBe('routed');

    // B's next claim is held, so the executing round is claimed and not yet
    // prepared while the second input queues behind it.
    const claim = world.gates.beforeClaim(b);
    await world.scripted.script(b, [{ kind: 'text', text: secretaryAnswer({ body: 'S6A batch answer on B' }) }]);
    const executing = await submitRound(world, followUp('s6a-input-2', earlier.requestRoot, 'S6A executing input'));
    await claim.reached;
    const batch = await submitRound(world, followUp('s6a-input-3', earlier.requestRoot, 'S6A queued input'));
    claim.release();
    const view = await waitForRound(world, earlier.requestRoot, executing.round, 'ended');
    endedOn(view, executing.round, b);

    const input = await lastInput(world, b);
    expect(input).toBe(secretaryInputText({
      ...noGoalSample(memory, roundOf(view, executing.round)),
      batched: [roundOf(view, batch.round)],
      earlier: [{ round: roundOf(view, earlier.round), result: { kind: 'answer', text: earlierAnswer } }],
    }));
    // The three slots are named sections of the one input.
    expect(input).toContain('## Also queued in this request');
    expect(input).toContain('## Earlier rounds of this request on other secretaries');
    expect(input).toContain('## This round');

    // The recorded set: every Query call kind's section order, the final Kernel
    // tool list (the grant's `read` plus its exploration group, in declared
    // order) and every template the preparation read, in first-read order.
    // The answer format is a used template of this call kind, read before the
    // round template that places it in the task slot; the base comes last.
    const record = await promptRecordOf(world, executing.round);
    expect(record.set.sectionOrder).toEqual({
      planning: ['role', 'goal', 'task', 'footprint'],
      copy: ['role', 'goal', 'task'],
      secretary: ['role', 'goal', 'notes', 'task'],
    });
    expect(record.set.toolNames).toEqual([
      'read', 'list_files', 'search', 'symbols', 'code_index', 'project_source', 'python_index', 'cpp_index',
      'source_excerpt', 'submit_secretary_answer',
    ]);
    expect(templateEntries(record)).toEqual([
      { id: 'secretary-answer', version: SECRETARY_TEMPLATE_VERSIONS['secretary-answer'], packId: 'platform' },
      { id: 'secretary-round', version: SECRETARY_TEMPLATE_VERSIONS['secretary-round'], packId: 'platform' },
      { id: 'base', version: 2, packId: 'platform' },
      ...DELIVERY_SET_ENTRIES,
    ]);
  }, 240_000);
});

describe('a person\'s pack over the secretary templates reaching a real round', () => {
  // Rule: the round renders the selected pack — another legal section order is
  // followed and the person's `secretary-answer` text is the round's answer
  // format — and the recorded set names the person's pack and version.
  it('moves the notes section after the task block and sends the person\'s answer format', async () => {
    const world = await openWorld();
    const memory = await seeded(world);
    expect((await world.packs.create(PACK_ID)).status).toBe('ready');
    const savedRound = await world.packs.saveTemplate(PACK_ID, 'secretary-round', PERSON_ROUND_TEXT);
    expect(savedRound).toMatchObject({
      status: 'ready', value: { templateId: 'secretary-round', version: 2, fromPack: PACK_ID, text: PERSON_ROUND_TEXT },
    });
    const savedAnswer = await world.packs.saveTemplate(PACK_ID, 'secretary-answer', 'ANSWER FROM THE PERSON');
    expect(savedAnswer).toMatchObject({ status: 'ready', value: { version: 4, fromPack: PACK_ID } });
    await selectPack(world);

    const a = await world.createSecretary('a');
    await world.scripted.script(a, [{ kind: 'text', text: secretaryAnswer({ body: 'S6A person pack answer' }) }]);
    const round = await submitRound(world, { commandId: 's6a-input-person-1', goalId: null,
      text: 'S6A person pack question' });
    const view = await waitForRound(world, round.requestRoot, round.round, 'ended');
    endedOn(view, round.round, a);

    const input = await lastInput(world, a);
    expect(input).toBe(secretaryInputText({
      ...noGoalSample(memory, roundOf(view, round.round)),
      order: ['role', 'goal', 'task', 'notes'],
      semanticAnswerFormat: 'ANSWER FROM THE PERSON',
      prelude: QUERY_PRELUDE,
    }));
    // The platform's answer format is gone: the person's text is the format.
    expect(input).not.toContain(PLATFORM_ANSWER_OPENING);

    const record = await promptRecordOf(world, round.round);
    expect(record.set.packId).toBe(PACK_ID);
    expect(record.set.sectionOrder.secretary).toEqual(['role', 'goal', 'task', 'notes']);
    expect(templateEntries(record)).toEqual([
      { id: 'secretary-answer', version: 4, packId: PACK_ID },
      { id: 'secretary-round', version: 2, packId: PACK_ID },
      { id: 'base', version: 2, packId: 'platform' },
      ...DELIVERY_SET_ENTRIES,
    ]);
  }, 240_000);
});

describe('a pack edit while the round waits at the start gate', () => {
  // Rule: the round sends the input it was prepared with. The pack is edited
  // after preparation and before the start, so neither the section order nor
  // the answer format of the edit reaches this round, and the recorded set
  // still names the version the preparation read.
  it('keeps the prepared section order and answer format, and the recorded template version', async () => {
    const world = await openWorld();
    const memory = await seeded(world);
    expect((await world.packs.create(PACK_ID)).status).toBe('ready');
    const firstRound = await world.packs.saveTemplate(PACK_ID, 'secretary-round', PLATFORM_ROUND_TEXT);
    expect(firstRound).toMatchObject({ status: 'ready', value: { version: 2, fromPack: PACK_ID } });
    const firstAnswer = await world.packs.saveTemplate(PACK_ID, 'secretary-answer', 'PACK ONE ANSWER');
    expect(firstAnswer).toMatchObject({ status: 'ready', value: { version: 4, fromPack: PACK_ID } });
    await selectPack(world);

    const a = await world.createSecretary('a');
    const gate = world.gates.beforeStart(a);
    await world.scripted.script(a, [{ kind: 'text', text: secretaryAnswer({ body: 'S6A held round answer' }) }]);
    const round = await submitRound(world, { commandId: 's6a-input-held-1', goalId: null,
      text: 'S6A held question' });
    // Prepared and committed, the start not yet committed.
    await gate.reached;
    const editedRound = await world.packs.saveTemplate(PACK_ID, 'secretary-round', EDITED_ROUND_TEXT);
    expect(editedRound).toMatchObject({ status: 'ready', value: { version: 3, fromPack: PACK_ID } });
    const editedAnswer = await world.packs.saveTemplate(PACK_ID, 'secretary-answer', 'PACK TWO ANSWER');
    expect(editedAnswer).toMatchObject({ status: 'ready', value: { version: 5, fromPack: PACK_ID } });
    gate.release();

    const view = await waitForRound(world, round.requestRoot, round.round, 'ended');
    endedOn(view, round.round, a);
    const input = await lastInput(world, a);
    expect(input).toBe(secretaryInputText({
      ...noGoalSample(memory, roundOf(view, round.round)),
      order: ['role', 'goal', 'notes', 'task'],
      semanticAnswerFormat: 'PACK ONE ANSWER',
    }));
    expect(input).not.toContain('PACK TWO ANSWER');

    const record = await promptRecordOf(world, round.round);
    expect(record.set.sectionOrder.secretary).toEqual(['role', 'goal', 'notes', 'task']);
    expect(templateEntries(record)).toEqual([
      { id: 'secretary-answer', version: 4, packId: PACK_ID },
      { id: 'secretary-round', version: 2, packId: PACK_ID },
      { id: 'base', version: 2, packId: 'platform' },
      ...DELIVERY_SET_ENTRIES,
    ]);
  }, 240_000);
});
