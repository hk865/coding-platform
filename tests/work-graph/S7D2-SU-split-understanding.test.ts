/**
 * 7D2 SPLITUND (`splitund-rulings.md` 1–15; write-tests brief §3): the understanding a tool split must write, the
 * split's recorded note version, and the adviser handoff brief the split's new line gets in its first Work Run.
 *
 * World: `openS7D2CapacityWorld` (tests/helpers/S7D2-capacity-world.ts; after SU-T1 its adviser Work binding merges
 * `record_note`) and, for SU-3, the maintenance page. L1 = `regionAdviser` on region `src`, whose children are `src/a`
 * and `src/b`; G = the world's goal 1. Every step is a public route or a scripted Work Run calling the real tool; the
 * understanding is written by `record_note` with the pointer `understandingPointer` read (brief §1). SU-1 and SU-2 run
 * on one world: SU-1 leaves the split's state, SU-2 continues it. SU-3 opens its own world.
 *
 * SU-1 — the call before the Run writes an understanding answers `{status:'incomplete', text:TEXT}` and registers
 * nothing; after the note the same call is accepted, the one split row is its operation, and `action.understanding` is
 * the note's `{noteId, version:1}`.
 * SU-2 — the split's new line, on the first ordinary Work Run linked to `su-t2`, gets `handoffBrief.binding`
 * `{operation: the split, source: L1, successor: NL, duty:'adviser', digest}` and a material naming N1 and L1, with
 * `callKind: 'handoff'`.
 * SU-3 — a too-long adviser line holding two goals: the maintenance page keeps the first goal and moves the second;
 * `action.understanding` is absent, and the new line's first Work Run gets the same adviser brief, its understanding
 * being the source line's last ended Run's current note.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { NoteItemV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type {
  RoleLineOperationV1, SessionCreateOperationRecord,
} from '../../src/core/work-graph/model/session-contracts.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import { advanceUntil } from '../helpers/A2-restart-fixture.js';
import { adoptPLMixedPlan } from '../helpers/PL-consumption-fixture.js';
import { understandingNote } from '../helpers/S4C2-note-card-fixture.js';
import { usageOf } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { understandingPointer } from '../helpers/S6B1-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import {
  openS7D2CapacityWorld, type S7D2CapacityWorld,
} from '../helpers/S7D2-capacity-world.js';
import {
  linkS7D2Scopes, runS7D2Work, S7D2_TOO_LONG_INPUT_TOKENS,
} from '../helpers/S7D2-role-line-world.js';
import { waitFor } from '../scenarios/harness.js';

type SplitRow = Extract<RoleLineOperationReadV1, { action: 'role_line' }>;

const P = S6A_SCOPE.projectId;

/** The first 11 lines are the v2 template text (block markers render away); the last two are `{{task_round}}`. */
const textOf = (goalId: string): string => [
  '## Handoff understanding',
  '',
  'You are handing a line of this project, or one part of its scope (a split), to',
  "a successor line; its duty follows the source line's. Before you hand it over,",
  'record the understanding the next line starts from: the decisions already made,',
  'the state of the tasks and what is still open. Write one',
  'note of kind `understanding` on a goal or stage anchor of the line you hand',
  'over; the current version must be written by the source Run. When your line',
  'holds a region, also put one module anchor in `extraAnchors` on a module of',
  'that region that is still yours; when you split a region off, use the module',
  'you split off.',
  '',
  'For each goal listed below, write one understanding note with these five parts: status (where the goal stands), decided (what is settled), open (what is still open), next (what happens next) and risks (what could go wrong).',
  `- Goal {"goalId":"${goalId}","projectId":"${P}"}`,
  '',
].join('\n');

/** The split rows of `role-lines/operations`: the `role_line` rows whose one step is `split`. */
const splitRows = (rows: readonly RoleLineOperationReadV1[]): SplitRow[] => rows.filter((row): row is SplitRow =>
  row.action === 'role_line' && row.steps.map(step => step.key).join(',') === 'split');

/** `sessions/operation` of an operation ref a public read returned. */
async function operationOf<T>(handle: S7D2CapacityWorld, ref: OperationRef): Promise<T> {
  return valueOf<T>(await handle.main.route('sessions/operation', ref), 'ready', `the operation ${ref.operationId}`);
}

/** The split's new line: the `plannedSessionRef` of its one step's child create. */
async function newLineOf(handle: S7D2CapacityWorld, row: SplitRow): Promise<SessionRef> {
  const child = row.steps[0]?.childOperation ?? null;
  if (child === null) throw new Error(`SPLITUND: the split names no child create: ${JSON.stringify(row)}`);
  return (await operationOf<SessionCreateOperationRecord>(handle, child)).action.plannedSessionRef;
}

/** The new line as `sessions/read` returns it (the card's record, never a second record). */
async function lineOfCard(handle: S7D2CapacityWorld, ref: SessionRef, label: string): Promise<S6ASession> {
  const card = await handle.readCard(ref);
  return { label, ref, aggregateRef: card.record.ref, role: structuredClone(card.record.role),
    createdAt: card.record.createdAt };
}

/** Polls `role-lines/operations` until one split row has ended (outer `completed` or `failed`). */
async function splitEnd(handle: S7D2CapacityWorld): Promise<SplitRow> {
  const rows = await waitFor(async () => splitRows(await handle.operations()),
    found => found.some(row => row.phase === 'completed' || row.phase === 'failed'), 'the split to end');
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** The line's latest Work Run, from `sessions/facts`. */
async function latestRun(handle: S7D2CapacityWorld, line: S6ASession): Promise<RunRef> {
  const facts = valueOf<SessionFactsV1>(await handle.main.route('sessions/facts', line.ref), 'ready',
    `the facts of ${line.label}`);
  if (facts.latestWork === null) throw new Error(`SPLITUND: ${line.label} has no Work Run`);
  return facts.latestWork.runRef;
}

/** The accepted understanding `run` wrote on `goal` (`notes/list`), the note the split records. */
async function understandingOf(handle: S7D2CapacityWorld, goal: GoalRef, run: RunRef): Promise<NoteItemV1> {
  const page = valueOf<{ items: NoteItemV1[] }>(await handle.main.route('notes/list',
    { goalId: goal.goalId, state: 'accepted', limit: 20, cursor: null }), 'ready', 'the understanding notes');
  const note = page.items.find(item => item.kind === 'understanding' && item.anchor.kind === 'goal'
    && item.anchor.goalId === goal.goalId && item.source.kind === 'agent' && item.source.runRef !== null
    && item.source.runRef.runId === run.runId);
  if (note === undefined) throw new Error(`SPLITUND: the Run ${run.runId} wrote no understanding on ${goal.goalId}`);
  return note;
}

/** The prepared manifest of a Workflow `start` step, opened through `materials/open` (as the model gets it). */
async function preparedOfStart(handle: S7D2CapacityWorld, start: WorkflowAdvanceInput): Promise<PreparedTaskManifestV1> {
  if (start.kind !== 'perform' || start.operation.kind !== 'start') {
    throw new Error('SPLITUND: the Workflow next step is not the start');
  }
  const prepared = (start.operation.request as unknown as { prepared: { envelope: { bundleRef: unknown } } })
    .prepared;
  const opened = valueOf<{ body: string }>(await handle.main.route('materials/open',
    { ref: prepared.envelope.bundleRef, usage: 'historical_explanation' }), 'ready', 'materials/open');
  return JSON.parse(opened.body) as PreparedTaskManifestV1;
}

/** One `select_work` of a Work Run on `task` for `line`. */
function selectOf(goal: GoalRef, line: S6ASession, task: TaskTriple, flowId: string): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: goal, flowId, sessionHint: line.ref, kind: 'select_work', taskId: task.taskId };
}

/** The one template role a line runs as (the Plan assigns each Task to it). */
function roleOf(line: S6ASession): string {
  if (line.role.kind !== 'legacy_template') throw new Error(`SPLITUND: ${line.label} has no template role`);
  return line.role.templateId;
}

/** The `record_note` call writing `goal`'s understanding over `pointer`, with the five sections and `extraAnchors`. */
function understandingCall(callId: string, goal: GoalRef, topic: string, conclusion: string,
  pointer: Awaited<ReturnType<typeof understandingPointer>>, extraAnchors: { kind: 'module'; moduleId: string }[]) {
  const draft = understandingNote({ anchor: { kind: 'goal', goalId: goal.goalId }, topic, conclusion,
    structural: false, replaces: pointer.noteId === null ? [] : [pointer.noteId] });
  if (draft.kind !== 'understanding') throw new Error(`SPLITUND: ${callId} wrote no understanding`);
  return { callId, name: 'record_note', args: { op: 'write', kind: draft.kind, topic: draft.topic,
    conclusion: draft.conclusion, anchor: draft.anchor, sections: draft.sections, structural: draft.structural,
    replaces: draft.replaces, expectedPointerRevision: pointer.revision,
    ...(extraAnchors.length === 0 ? {} : { extraAnchors }) } };
}

const splitCall = (callId: string) => ({ callId, name: 'propose_role_split', args: {
  move: [{ kind: 'region', moduleRef: { projectId: P, moduleId: 'src/a' } }], reason: 'SU-1' } });

type Shared = {
  readonly handle: S7D2CapacityWorld;
  readonly l1: S6ASession;
  readonly t2: TaskTriple;
  readonly end: SplitRow;
  readonly operation: OperationRef;
  readonly note: NoteItemV1;
  readonly newLine: S6ASession;
};

let opened: S7D2CapacityWorld | null = null;
let shared: Shared | null = null;
afterAll(async () => {
  if (opened !== null) await opened.close();
});

describe('SPLITUND SU-1 and SU-2', () => {
  /*
   * Named mutation (brief §3 SU-1): `propose_role_split` no longer requires the calling Run's current understanding
   * (`src/composition/create-platform.ts:2296` `requestSplit`, the `incomplete` exit before `startRoleLineSplit`) ->
   * the first call is `accepted` and the `toEqual` below (with TEXT) turns red; `action.understanding` is then absent
   * too.
   */
  it('SU-1 (memory): a tool split needs the Run\'s understanding and records its version', async () => {
    const handle = await openS7D2CapacityWorld({ backend: 'memory' });
    opened = handle;
    const l1 = handle.regionAdviser;
    const goal = handle.goal;
    const n = (await handle.allocation()).duties.adviser.holders.length;
    await handle.setOpen('adviser', n + 1, 'su1-cap');
    const { tasks } = await adoptPLMixedPlan(handle.world, { goal, label: 'su1',
      tasks: [{ taskId: 'su-t1', role: roleOf(l1) }, { taskId: 'su-t2', role: roleOf(l1) }] });
    const [t1, t2] = tasks;
    await linkS7D2Scopes(handle.world, { line: l1, targets: [{ kind: 'task', ref: t1! }], label: 'su1-t1' });
    const p0 = await understandingPointer(handle.world, { kind: 'goal', goalId: goal.goalId });
    const note = understandingCall('su1-note', goal, 'su1-understanding', 'SU-1 split understanding', p0,
      [{ kind: 'module', moduleId: 'src/a' }]);
    await runS7D2Work(handle.world, { line: l1, goal, task: t1!, label: 'su1', replies: [
      { kind: 'calls', calls: [splitCall('su1-first')] },
      { kind: 'calls', calls: [note] },
      { kind: 'calls', calls: [splitCall('su1-second')] },
      { kind: 'text', text: 'SU-1 done' },
    ] });
    const end = await splitEnd(handle);
    const second = await handle.toolResult(l1, 'su1-second');
    const run = await latestRun(handle, l1);
    const written = await understandingOf(handle, goal, run);
    const newLine = await lineOfCard(handle, await newLineOf(handle, end), 'su1-new-line');
    shared = { handle, l1, t2: t2!, end, operation: (second.json as { operation: OperationRef }).operation,
      note: written, newLine };

    const first = await handle.toolResult(l1, 'su1-first');
    expect(first.status).toBe('success');
    expect(first.json).toEqual({ status: 'incomplete', text: textOf(goal.goalId) });
    expect((await handle.toolResult(l1, 'su1-note')).status).toBe('success');
    expect(second.status).toBe('success');
    expect(second.json).toMatchObject({ status: 'accepted', operation: expect.any(Object),
      revision: expect.any(Number) });
    expect(splitRows(await handle.operations()).map(row => row.operation)).toEqual([shared.operation]);
    expect(end).toMatchObject({ phase: 'completed', actionPhase: 'done' });
    expect(written.version).toBe(1);
    const saved = await operationOf<RoleLineOperationV1>(handle, end.operation);
    expect(saved.action.split).toEqual({ source: l1.ref,
      move: [{ kind: 'region', moduleRef: { projectId: P, moduleId: 'src/a' } }],
      keep: [{ kind: 'region', moduleRef: { projectId: P, moduleId: 'src' } }], reason: 'agent_proposal' });
    expect((saved.action as unknown as { understanding?: unknown }).understanding)
      .toEqual([{ noteId: written.noteId, version: 1 }]);
  }, 300_000);

  /*
   * Named mutation (brief §3 SU-2): the split's completion writes no adviser handoff brief
   * (`src/core/work-graph/sessions/role-line-operations.ts` `continueRoleLineSplit`, the record-5 write) ->
   * `M.handoffBrief` is `undefined`, `callKind` is `'work'`, and the first `binding` assertion turns red.
   */
  it('SU-2 (memory): the split new line gets the adviser handoff brief in its first Work Run', async () => {
    if (shared === null) throw new Error('SPLITUND: SU-1 left no split state');
    const { handle, l1, t2, end, operation, note, newLine } = shared;
    await linkS7D2Scopes(handle.world, { line: newLine, targets: [{ kind: 'task', ref: t2 }], label: 'su2-t2' });
    const start = await advanceUntil(handle.world.ag2b,
      selectOf(handle.goal, newLine, t2, 'su2'), 'start');
    const manifest = await preparedOfStart(handle, start);
    expect(manifest.handoffBrief?.binding).toEqual({ operation, source: l1.ref, successor: newLine.ref,
      duty: 'adviser', digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(manifest.handoffBrief?.material).toMatchObject({ duty: 'adviser',
      understanding: [{ noteId: note.noteId, version: 1 }], oldLine: l1.ref });
    expect(manifest.continuationBrief).toBeUndefined();
    expect(manifest.contextAssembly.callKind).toBe('handoff');
  }, 300_000);
});

describe('SPLITUND SU-3', () => {
  /*
   * Named mutation (brief §3 SU-3): only a tool split that recorded a version writes the brief
   * (`src/core/work-graph/sessions/role-line-operations.ts` `continueRoleLineSplit`, the too-long arm's record-5
   * write) -> `MF.handoffBrief` is `undefined` and the first `binding` assertion turns red.
   */
  it('SU-3 (memory): a too-long maintenance split gives its new line the same adviser brief', async () => {
    const handle = await openS7D2CapacityWorld({ backend: 'memory' });
    try {
      const n = (await handle.allocation()).duties.adviser.holders.length;
      await handle.setOpen('adviser', n + 2, 'su3-cap');
      const ga = await handle.newGoal('su3-ga');
      const gb = await handle.newGoal('su3-gb');
      const line = await handle.line('su3-l', [{ kind: 'goal', goalRef: ga }, { kind: 'goal', goalRef: gb }]);
      const goals = (await handle.readCard(line)).links
        .filter(link => link.ref.relation === 'responsible' && link.until === null)
        .map(link => link.ref.target)
        .filter((target): target is { kind: 'goal'; ref: GoalRef } => target.kind === 'goal')
        .map(target => target.ref);
      if (goals.length !== 2) {
        throw new Error(`SPLITUND: the line has no two open goal links: ${JSON.stringify(goals)}`);
      }
      const [keep, move] = goals as [GoalRef, GoalRef];
      const [k1] = (await adoptPLMixedPlan(handle.world, { goal: keep, label: 'su3-k',
        tasks: [{ taskId: 'su3-k1', role: roleOf(line) }] })).tasks;
      await linkS7D2Scopes(handle.world, { line, targets: [{ kind: 'task', ref: k1! }], label: 'su3-k1' });
      const [m1] = (await adoptPLMixedPlan(handle.world, { goal: move, label: 'su3-m',
        tasks: [{ taskId: 'su3-m1', role: roleOf(line) }] })).tasks;
      const pk0 = await understandingPointer(handle.world, { kind: 'goal', goalId: keep.goalId });
      const note = understandingCall('su3-note', keep, 'su3-understanding', 'SU-3 split understanding', pk0, []);
      await runS7D2Work(handle.world, { line, goal: keep, task: k1!, label: 'su3', replies: [
        { kind: 'calls', calls: [note] },
        { kind: 'text', text: 'SU-3 done', usage: usageOf(S7D2_TOO_LONG_INPUT_TOKENS) },
      ] });
      const written = await understandingOf(handle, keep, await latestRun(handle, line));

      await handle.main.route('workflow/advance', { schemaVersion: 1, goalRef: keep,
        flowId: 'su3-page', sessionHint: null, kind: 'select_work' });
      const settled = handle.world.consumeBarrier();
      handle.world.clock.advance(25);
      await settled;

      const end = await splitEnd(handle);
      const newLine = await lineOfCard(handle, await newLineOf(handle, end), 'su3-new-line');
      await linkS7D2Scopes(handle.world, { line: newLine, targets: [{ kind: 'task', ref: m1! }],
        label: 'su3-m1' });
      const start = await advanceUntil(handle.world.ag2b,
        selectOf(move, newLine, m1!, 'su3-start'), 'start');
      const manifest = await preparedOfStart(handle, start);

      expect(end).toMatchObject({ phase: 'completed', actionPhase: 'done' });
      const saved = await operationOf<RoleLineOperationV1>(handle, end.operation);
      expect(saved.action.split).toEqual({ source: line.ref, move: [{ kind: 'goal', goalRef: move }],
        keep: [{ kind: 'goal', goalRef: keep }], reason: 'too_long' });
      expect((saved.action as unknown as { understanding?: unknown }).understanding).toBeUndefined();
      expect(manifest.handoffBrief?.binding).toEqual({ operation: end.operation, source: line.ref,
        successor: newLine.ref, duty: 'adviser', digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(manifest.handoffBrief?.material).toMatchObject({ duty: 'adviser',
        understanding: [{ noteId: written.noteId, version: 1 }], oldLine: line.ref });
      expect(manifest.contextAssembly.callKind).toBe('handoff');
    } finally {
      await handle.close();
    }
  }, 300_000);
});
