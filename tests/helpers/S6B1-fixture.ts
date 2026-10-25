/**
 * Steps for the project subject, a secretary request round held running, the line handoff records and the request
 * archive records, composed on the request world (tests/helpers/S6A-request-fixture.ts), its host world
 * (tests/helpers/S6A-host-fixture.ts) and the workspace handle (`s6aCardsWorkspace`,
 * tests/helpers/S6A-cards-fixture.ts). Memory or SQLite. Each step takes a world or workspace a test already has.
 *
 * Rules:
 * - Every state comes from a public step: core routes over HTTP as the Host's human operator (the body names the
 *   workspace), the governance seed of tests/helpers/S6A-memory-fixture.ts, `workflow/advance` with each `next` fed
 *   back as the platform returned it (`driveWorkflow`), the Query routes, and the Host's scripted provider, whose tool
 *   calls reach the real tools the Runtime gave the Kernel. Every pin and pointer revision a step sends is what a
 *   public read returned just before. Nothing is written to or read from the store, and no call context is made for a
 *   Run: a Run's writes are its own model's tool calls inside the Runtime.
 * - Only the project scribe writes the project understanding, and the scribe's Run needs a goal, so the project world
 *   keeps them apart: the scribe works in the main workspace on goal 1 (the Host's scribe bindings come from the
 *   request world's `scribe: true`); the second workspace of the same project is never given a goal, and its queue
 *   is the one the project card and notices are read from. Notes belong to the project, so both read the same notes.
 * - Each scribe write runs the next of its Plan's three tasks on the same line: two scripted replies, the
 *   `record_note` call and the answer, and the step fails unless the Run consumed exactly those two.
 * - A line gets its task links when it is created (`sessions/create` with `initialLinks`; the directory checks each
 *   task against the goal's adopted Plan), so no Run occupies it. One secretary owns two processing requests because
 *   a manual route of an owned request takes no intake from its new owner.
 * - The held round's first model request waits at the host world's model gate; the gate is released and the start
 *   awaited after the test's callback, also when the callback or the wait fails. Nothing else is installed here; the
 *   world's own `close` cleans up, and `openS6BProjectWorld` closes its world when a later step fails.
 */
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { RoleConfigurationRef, SessionAggregateRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { NoteAnchorV1 } from '../../src/contracts/note.js';
import { isRecord } from '../../src/contracts/validation/common.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { NoteItemV1, WriteNoteEnvelopeV1 } from '../../src/core/work-graph/model/note-contracts.js';
import { driveWorkflow, readQuery } from './A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, ag2bPlanDraft, graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { claimWithSecretaryProfile } from './request-claim-steps.js';
import { understandingNote } from './S4C2-note-card-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { submitRound, type S6ARound } from './S6A-history-fixture.js';
import type { S6AHostWorld, S6AReply } from './S6A-host-fixture.js';
import { seedS6AMemory } from './S6A-memory-fixture.js';
import {
  openS6ATwoWorkspaceWorld, S6A_SCOPE, S6A_SCRIBE_ROLE, S6A_SECOND_SCOPE, S6A_WORK_ROLE,
  type S6ABackend, type S6ARequestWorld, type S6ASession,
} from './S6A-request-fixture.js';

const field = (body: unknown, key: string): unknown => isRecord(body) ? body[key] : undefined;

/** The value of a route answer whose status is `status`; any other answer throws with what the platform said. */
function valueOf<T>(body: unknown, status: 'ready' | 'committed' | 'completed', what: string): T {
  if (field(body, 'status') !== status) throw new Error(`S6B: ${what} is not ${status}: ${JSON.stringify(body)}`);
  return field(body, 'value') as T;
}

const sameSession = (left: SessionRef, right: SessionRef): boolean =>
  left.projectId === right.projectId && left.sessionId === right.sessionId;

/** The project's policy and architecture through the memory fixture's governance seed, on `ws`'s workspace and two
 * of its goals (the seed reads them back). Once per world: the seed's request ids restart with each call. */
export async function governS6B(world: S6ARequestWorld, ws: S6ACardsWorkspace, goals: { first: GoalRef; second: GoalRef }) {
  const memory = await seedS6AMemory({ scope: ws.scope, goals, clock: world.clock, platform: world.platform,
    post: world.post, humanContext: ws.humanContext, settleDetached: world.settleDetached },
  { architecture: true, policy: true, notes: false });
  return memory.governance;
}

/** `plans/propose` + `plans/apply` of `goal`'s first Plan: the AG2b draft with the work tasks `taskIds` assigned to
 * `role` and the AG2b goal gate. The project needs its governance first. */
export async function adoptS6BPlan(ws: S6ACardsWorkspace, goal: GoalRef,
  input: { label: string; taskIds: readonly string[]; role: string }) {
  const draft = { ...ag2bPlanDraft(input.taskIds), planId: `s6b-plan-${input.label}`, goalId: goal.goalId,
    assignments: input.taskIds.map(taskId => ({ taskId, role: input.role, instruction: `S6B ${input.label} ${taskId}` })) };
  const proposed = valueOf<{ ref: unknown; revision: number }>(await ws.post('plans/propose', graphWrite(ws.scope, {
    goalRef: goal, basedOn: null, draft, reason: { text: `S6B plan ${input.label}`, sources: [] },
  }, `s6b-plan-${input.label}-propose`)), 'committed', `the Plan ${input.label}`);
  valueOf(await ws.post('plans/apply', graphWrite(ws.scope, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, `s6b-plan-${input.label}-apply`)), 'committed', `the adoption of ${input.label}`);
  const plan = await ws.activePlan(goal);
  if (plan === null) throw new Error(`S6B: ${goal.goalId} has no adopted Plan after ${input.label}`);
  const tasks: TaskTriple[] = input.taskIds.map(taskId => ({ projectId: goal.projectId, goalId: goal.goalId, taskId }));
  return { plan, tasks };
}

/** `sessions/create` in `ws`'s workspace with `role` and an open `responsible` link to each of `tasks`. */
export async function createS6BLine(ws: S6ACardsWorkspace,
  input: { label: string; role: RoleConfigurationRef; tasks?: readonly TaskTriple[] }) {
  const body = await ws.route('sessions/create', {
    workspace: { ...ws.scope }, role: input.role, recommendedRefs: [],
    initialLinks: (input.tasks ?? []).map(ref => ({ target: { kind: 'task', ref }, relation: 'responsible' })),
    meta: { requestId: `s6b-line-${ws.scope.workspaceId}-${input.label}`, expected: [] },
  });
  const record = valueOf<{ ref: SessionAggregateRef }>(body, 'completed', `the line ${input.label}`);
  const ref: SessionRef = { projectId: record.ref.projectId, sessionId: record.ref.sessionId };
  return { label: input.label, ref, operation: field(body, 'operationRef') as OperationRef };
}

export type S6BLine = Awaited<ReturnType<typeof createS6BLine>>;

/** `goal`'s first Plan with three work tasks of the work role, a source line responsible for all three and a target
 * line responsible for none: the real Sessions and Task links of the handoff records. Needs the governance. */
export async function seedS6BHandoffLines(ws: S6ACardsWorkspace, goal: GoalRef, label = 'handoff') {
  const { plan, tasks } = await adoptS6BPlan(ws, goal, { label, role: S6A_WORK_ROLE.templateId,
    taskIds: ['a', 'b', 'c'].map(name => `${label}-${name}`) });
  const source = await createS6BLine(ws, { label: `${label}-source`, role: S6A_WORK_ROLE, tasks });
  const target = await createS6BLine(ws, { label: `${label}-target`, role: S6A_WORK_ROLE });
  return { plan, tasks, source, target };
}

/** Two no-goal requests owned by one secretary (`source`): the first submit opens `source`, the second finds it busy
 * and opens `other`, then a manual `requests/route` moves the second request to `source`. Needs the workspace's
 * secretary profile (the request world's main workspace). */
export async function seedS6BArchiveSource(ws: S6ACardsWorkspace, label = 'archive') {
  const first = await ws.submit({ label: `${label}-1`, goalId: null });
  const second = await ws.submit({ label: `${label}-2`, goalId: null });
  const source = first.secretary;
  const other = second.secretary;
  if (source === null || other === null || sameSession(source, other)) {
    throw new Error(`S6B: the two requests did not open two secretaries: ${JSON.stringify([first, second])}`);
  }
  const routed = await ws.route('requests/route', { commandId: `s6b-${label}-route`, round: second.requestRoot,
    to: source, reason: 'manual' });
  if (field(routed, 'status') !== 'routed') throw new Error(`S6B: the route to the source failed: ${JSON.stringify(routed)}`);
  return { source, other, requests: [first, second] as const };
}

// ---------------------------------------------------------------------------
// The scribe and the project understanding
// ---------------------------------------------------------------------------

const PROJECT_ANCHOR: NoteAnchorV1 = { kind: 'project' };
const SCRIBE_TASKS = 3;

/** In the main workspace of a world opened with `scribe: true`: the project's governance on goals 1 and 2, goal 1's
 * Plan with three work tasks assigned to the scribe role, and a scribe line with no module link (so it manages the
 * project scope). Each scribe write runs the next task. */
export async function seedS6BScribe(world: S6ARequestWorld) {
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const goal = world.goals.first;
  const governance = await governS6B(world, main, world.goals);
  const { plan, tasks } = await adoptS6BPlan(main, goal, { label: 'scribe', role: S6A_SCRIBE_ROLE.templateId,
    taskIds: Array.from({ length: SCRIBE_TASKS }, (_, index) => `s6b-scribe-${index + 1}`) });
  const line = await createS6BLine(main, { label: 'scribe', role: S6A_SCRIBE_ROLE });
  let used = 0;
  const nextTask = (): TaskTriple => {
    const task = tasks[used];
    if (task === undefined) throw new Error(`S6B: the scribe's ${SCRIBE_TASKS} tasks are used up`);
    used += 1;
    return task;
  };
  return { main, goal, governance, plan, line, nextTask };
}

export type S6BScribe = Awaited<ReturnType<typeof seedS6BScribe>>;

/** The current-understanding pointer of `anchor` (default the project) as the note owner's anchor read returns it
 * (`noteId` and `revision` are null before the first understanding). */
export async function understandingPointer(world: S6ARequestWorld, anchor: NoteAnchorV1 = PROJECT_ANCHOR) {
  const read = await world.platform.notes.listByAnchor(world.humanContext(), { anchor, limit: 1, cursor: null });
  if (read.status !== 'ready' || read.value.pointer === null) {
    throw new Error(`S6B: the understanding pointer is not readable: ${JSON.stringify(read)}`);
  }
  return read.value.pointer;
}

/** An understanding of `anchor` over its current one (same topic, `replaces` the pointer's note). */
async function understandingOver(world: S6ARequestWorld, anchor: NoteAnchorV1, label: string, structural: boolean) {
  const pointer = await understandingPointer(world, anchor);
  const note = understandingNote({ anchor, topic: 's6b-understanding', structural,
    conclusion: `S6B understanding ${label}`, replaces: pointer.noteId === null ? [] : [pointer.noteId] });
  return { pointer, note: note as Extract<typeof note, { kind: 'understanding' }> };
}

/** The person writes the project understanding (`notes/write` over HTTP in `ws`): accepted and confirmed at once. */
export async function writeUserProjectUnderstanding(world: S6ARequestWorld, ws: S6ACardsWorkspace, label: string) {
  const { pointer, note } = await understandingOver(world, PROJECT_ANCHOR, `user-${label}`, false);
  return (await ws.route('notes/write', { commandId: `s6b-user-${label}`, goalId: null,
    expectedPointerRevision: pointer.revision, note }) as WriteNoteEnvelopeV1).write;
}

/**
 * The scribe writes an understanding of `anchor` (default the project) in its own Run: `workflow/advance` runs the
 * scribe's next task on its line (`select_work`, then each `next` unchanged) while the scripted model calls the real
 * `record_note` once and then answers. Answers the task and the note as `notes/list` by its anchor reads it:
 * `structural: false` rewrites the understanding at once (accepted), `true` leaves it pending for the person.
 */
export async function scribeUnderstanding(world: S6ARequestWorld, scribe: S6BScribe,
  input: { label: string; structural: boolean; anchor?: NoteAnchorV1 }) {
  const anchor = input.anchor ?? PROJECT_ANCHOR;
  const { pointer, note } = await understandingOver(world, anchor, `scribe-${input.label}`, input.structural);
  const task = scribe.nextTask();
  const before = world.model.calls();
  world.scriptReplies([
    { kind: 'calls', calls: [{ callId: `s6b-note-${input.label}`, name: 'record_note', args: { op: 'write',
      kind: note.kind, topic: note.topic, conclusion: note.conclusion, anchor, sections: note.sections,
      structural: note.structural, replaces: note.replaces, expectedPointerRevision: pointer.revision } }] },
    { kind: 'text', text: `S6B scribe wrote ${input.label}` },
  ]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: scribe.goal, flowId: `s6b-scribe-${input.label}`,
    sessionHint: scribe.line.ref, kind: 'select_work', taskId: task.taskId });
  if (world.model.calls() !== before + 2) {
    throw new Error(`S6B: the scribe's Run made ${world.model.calls() - before} model calls, not 2`);
  }
  const state = input.structural ? 'pending_review' : 'accepted';
  const listed = valueOf<{ items: NoteItemV1[] }>(await scribe.main.route('notes/list',
    { anchor, state, limit: 100, cursor: null }), 'ready', `the ${state} notes`);
  const written = listed.items.find(item => item.conclusion === note.conclusion);
  if (written === undefined) throw new Error(`S6B: the scribe's note ${input.label} is not listed as ${state}`);
  return { task, note: written };
}

/**
 * The person answers the waiting note card of `noteId` in `ws`'s queue: the card `decisions/queue` lists, its read
 * through `decisions/card` with the card's own source, then `decisions/answer` of `optionId` with that source and
 * its pins. Answers the card read and the answer route's body.
 */
export async function resolveS6BProjectNote(ws: S6ACardsWorkspace, input: { noteId: string; optionId: string; label: string }) {
  const listed = (await ws.readCards()).find(card => card.state === 'waiting_answer'
    && card.source.kind === 'note_review'
    && card.source.pins.some(pin => field(pin.ref, 'noteId') === input.noteId));
  if (listed === undefined) throw new Error('S6B: pending project note card missing');
  const card = valueOf<DecisionCardV1>(await ws.route('decisions/card', { source: listed.source }),
    'ready', 'the project note card');
  const resolution = await ws.post('decisions/answer', graphWrite(ws.scope, {
    source: card.source, selection: { kind: 'option', optionId: input.optionId }, text: '', annotations: [],
  }, `s6b-project-answer-${input.label}`, card.source.pins));
  return { card, resolution };
}

/** The project world (see the header): the scribe in the main workspace, the second workspace with no goal. */
export async function openS6BProjectWorld(options: { backend: S6ABackend }) {
  const { world } = await openS6ATwoWorkspaceWorld({ backend: options.backend, scribe: true });
  try {
    const scribe = await seedS6BScribe(world);
    return { world, main: scribe.main, goalless: s6aCardsWorkspace(world, S6A_SECOND_SCOPE), scribe,
      close: () => world.close() };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// A secretary request round held running
// ---------------------------------------------------------------------------

/** A valid answer of each execution kind, so a released round ends normally. */
const ROUND_ANSWER = {
  semantic_query: JSON.stringify({ schemaVersion: 1, body: 'S6B answer', ideas: [], goalCardDrafts: [] }),
  initial_coordination: JSON.stringify({ schemaVersion: 2, kind: 'needs_decision', summary: 'S6B summary',
    questions: ['S6B question'] }),
};

export type S6BHeldRound = {
  secretary: S6ASession;
  request: S6ARound;
  prepared: PreparedQueryExecution;
  /** The frozen manifest as `materials/open` of the prepared bundle returns it. */
  manifest: PreparedQueryManifestV1;
  /** `queries/read` of the round while its Run is entered. */
  query: Awaited<ReturnType<typeof readQuery>>;
};

/**
 * A secretary request round held running in a host world: a new secretary, `requests/submit` addressed to it
 * (`goalId: null`: a no-goal request), `queries/claim` with the published secretary profile, `queries/prepare`, the
 * frozen manifest, the secretary's replies (default one valid answer of the manifest's execution kind), then
 * `queries/start`, whose first model request waits at the model gate while `use` runs. Answers `use`'s value and the
 * start's answer.
 */
export async function holdS6BRequestRound<T>(world: S6AHostWorld,
  input: { label: string; goalId: string | null; replies?: (manifest: PreparedQueryManifestV1) => S6AReply[] },
  use: (round: S6BHeldRound) => Promise<T>) {
  const id = `s6b-round-${input.label}`;
  const secretary = await world.createSecretary(id);
  const request = await submitRound(world, { commandId: id, goalId: input.goalId, text: `S6B round ${input.label}`,
    recipient: secretary });
  valueOf(await claimWithSecretaryProfile(world, request.round, secretary, `${id}-claim`), 'committed', 'the claim');
  const prepared = valueOf<PreparedQueryExecution>((await world.post('queries/prepare', plain(S6A_SCOPE, {
    queryRunRef: (await readQuery(world.ag2b, request.round)).run.ref, requestId: `${id}-prepare`,
  }))).body, 'ready', 'the preparation');
  const opened = valueOf<{ body: string }>((await world.post('materials/open', plain(S6A_SCOPE, {
    ref: prepared.bundleRef, usage: 'historical_explanation',
  }))).body, 'ready', 'the frozen manifest');
  const manifest = JSON.parse(opened.body) as PreparedQueryManifestV1;
  await world.scripted.script(secretary, input.replies?.(manifest)
    ?? [{ kind: 'text', text: ROUND_ANSWER[manifest.request?.executionKind ?? 'semantic_query'] }]);
  const gate = await world.gates.modelRequest(secretary);
  const started = world.post('queries/start', plain(S6A_SCOPE, { prepared, consumerId: AG2B_CONSUMER_ID,
    requestId: `${id}-start` })).then(answer => answer.body);
  const endedFirst = started.then(answer => {
    throw new Error(`S6B: the round ended before its model request: ${JSON.stringify(answer)}`);
  });
  endedFirst.catch(() => undefined);
  try {
    await Promise.race([gate.reached, endedFirst]);
    const value = await use({ secretary, request, prepared, manifest, query: await readQuery(world.ag2b, request.round) });
    gate.release();
    return { value, started: await started };
  } finally {
    gate.release();
    await started.catch(() => undefined);
  }
}
