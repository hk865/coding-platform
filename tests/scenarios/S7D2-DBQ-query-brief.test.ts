/**
 * BRIEFQ (`splitund-rulings.md` item 10, Q3/Q4; the test sheet's R1–R3): a successor adviser line's first
 * Query round freezes record 5 (the handoff brief) into its manifest and input, with the operation's actually
 * handed scope (`handedScope`) listed before the project background; the adviser template names that scope; the
 * Query's entry consumes record 5 once, so the same line's first Work Run no longer sees it.
 *
 * R1 and R3 share one world (`openS7D2ProjectWorld` with the adviser Query profile): a real source Work Run writes
 * a goal-understanding, a real person's full handoff makes the adviser successor, the successor claims and prepares
 * a goal-1 `semantic_query` through the public routes, and the frozen manifest is opened through `materials/open`.
 * R3 starts that same prepared Query through `queries/start`, then runs the successor's first Work Run.
 * R2 opens its own split world: L1 = `regionAdviser` on region `src`, a real `propose_role_split` moves `src/a` to
 * the new line NL, and NL's first Work Run is the observed model request. The R2 expectation is the frozen template
 * text (§3.8) and `handedScope` (§3.11); the model request is the input the line actually receives.
 *
 * Named mutations: R1 — `src/core/agent-runtime/query-preparation.ts`'s read gate
 * (`if (!requestRound && deps.handoffBriefs !== undefined)`) forced to `if (false)` turns the
 * `## Handoff brief` assertion (and `handoffBrief` itself) red. R2 — restoring the old sentence in
 * `resources/prompts/platform/templates/handoff-brief-adviser.txt:3–:5` (and regenerating
 * `platform-pack.generated.ts`) turns `toContain('The handed scope listed')` red and the whitespace-normalized
 * `not.toContain('The project scope below is now yours.')` red (the old sentence is line-wrapped in the tree, so
 * the literal form alone stays green). R3 — forcing `handoffRecord = null; handoffGuard = null;` after the
 * consumption contribution in `src/core/work-graph/queries/query-execution.ts`'s `beginEntry` turns the Work
 * request's `not.toContain('## Handoff brief')` red.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { QueryExecutionRecord } from '../../src/app/core-http-types.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { PreparedQueryExecution, PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { SessionRef, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RoleScopeV1 } from '../../src/contracts/role-lines.js';
import type { HandoffBriefBindingV1, HandoffBriefMaterialV1 } from '../../src/contracts/handoff-brief.js';
import type { NoteItemV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type {
  SessionCard, SessionCreateOperationRecord,
} from '../../src/core/work-graph/model/session-contracts.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import { advanceUntil, claimQueryOn, driveWorkflow, type AdvanceValue } from '../helpers/A2-restart-fixture.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { AG2B_CONSUMER_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { adoptPLMixedPlan, PL_ADVISER_ROLE_BINDING } from '../helpers/PL-consumption-fixture.js';
import { understandingNote } from '../helpers/S4C2-note-card-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { understandingPointer } from '../helpers/S6B1-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import {
  handoffS7D2Line, linkS7D2Scopes, openS7D2ProjectWorld, openTargetsOf, runS7D2Work,
  type S7D2ProjectWorld,
} from '../helpers/S7D2-role-line-world.js';
import { waitFor } from './harness.js';

type SplitRow = Extract<RoleLineOperationReadV1, { action: 'role_line' }>;

/** BRIEFQ: the Query manifest now carries record 5; the production type gains the field in the same change. */
type QueryManifestV1 = PreparedQueryManifestV1 & {
  handoffBrief?: {
    binding: HandoffBriefBindingV1;
    material: HandoffBriefMaterialV1 & { handedScope: RoleScopeV1[] };
  };
};

/** BRIEFQ: the Work manifest the same Run prepared, read to show the brief is gone after consumption. */
type WorkManifestV1 = PreparedTaskManifestV1 & { handoffBrief?: unknown };

const worlds: S7D2ProjectWorld[] = [];
afterAll(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

// ---------------------------------------------------------------------------
// Private steps (no second world helper): public reads and copies of the three
// private split/read steps RL-13 and SU use.
// ---------------------------------------------------------------------------

const splitRows = (rows: readonly RoleLineOperationReadV1[]): SplitRow[] => rows.filter((row): row is SplitRow =>
  row.action === 'role_line' && row.steps.map(step => step.key).join(',') === 'split');

async function operationOf<T>(world: S7D2ProjectWorld, ref: OperationRef): Promise<T> {
  return valueOf<T>(await world.main.route('sessions/operation', ref), 'ready', `the operation ${ref.operationId}`);
}

/** The split's new line: the `plannedSessionRef` of its one step's child create. */
async function newLineOf(world: S7D2ProjectWorld, row: SplitRow): Promise<SessionRef> {
  const child = row.steps[0]?.childOperation ?? null;
  if (child === null) throw new Error(`BRIEFQ: the split names no child create: ${JSON.stringify(row)}`);
  return (await operationOf<SessionCreateOperationRecord>(world, child)).action.plannedSessionRef;
}

/** Polls `role-lines/operations` until the one split row has ended (outer `completed` or `failed`). */
async function splitEnd(world: S7D2ProjectWorld): Promise<SplitRow> {
  const rows = await waitFor(async () => splitRows(await world.operations()),
    found => found.some(row => row.phase === 'completed' || row.phase === 'failed'), 'the split to end');
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** The Session a public card names, in the shape the Work steps take. */
function lineOfCard(card: SessionCard, label: string): S6ASession {
  return { label, ref: card.record.ref, aggregateRef: card.record.ref,
    role: structuredClone(card.record.role), createdAt: card.record.createdAt };
}

function roleOf(line: S6ASession): string {
  if (line.role.kind !== 'legacy_template') throw new Error(`BRIEFQ: ${line.label} has no template role`);
  return line.role.templateId;
}

/** The line's latest Work Run, from `sessions/facts`. */
async function latestRun(world: S7D2ProjectWorld, line: S6ASession): Promise<RunRef> {
  const facts = valueOf<SessionFactsV1>(await world.main.route('sessions/facts', line.ref), 'ready',
    `the facts of ${line.label}`);
  if (facts.latestWork === null) throw new Error(`BRIEFQ: ${line.label} has no Work Run`);
  return facts.latestWork.runRef;
}

/** The accepted understanding `run` wrote on `goal`, through `notes/list` (the note the brief names). */
async function understandingOf(world: S7D2ProjectWorld, goal: GoalRef, run: RunRef): Promise<NoteItemV1> {
  const page = valueOf<{ items: NoteItemV1[] }>(await world.main.route('notes/list',
    { goalId: goal.goalId, state: 'accepted', limit: 20, cursor: null }), 'ready', 'the understanding notes');
  const note = page.items.find(item => item.kind === 'understanding' && item.anchor.kind === 'goal'
    && item.anchor.goalId === goal.goalId && item.source.kind === 'agent' && item.source.runRef !== null
    && item.source.runRef.runId === run.runId);
  if (note === undefined) throw new Error(`BRIEFQ: the Run ${run.runId} wrote no understanding on ${goal.goalId}`);
  return note;
}

/** The `record_note` call writing `goal`'s understanding over `pointer`, with an optional module anchor. */
function understandingCall(callId: string, goal: GoalRef, topic: string, conclusion: string,
  pointer: Awaited<ReturnType<typeof understandingPointer>>, extraAnchors: { kind: 'module'; moduleId: string }[]) {
  const draft = understandingNote({ anchor: { kind: 'goal', goalId: goal.goalId }, topic, conclusion,
    structural: false, replaces: pointer.noteId === null ? [] : [pointer.noteId] });
  if (draft.kind !== 'understanding') throw new Error(`BRIEFQ: ${callId} wrote no understanding`);
  return { callId, name: 'record_note', args: { op: 'write', kind: draft.kind, topic: draft.topic,
    conclusion: draft.conclusion, anchor: draft.anchor, sections: draft.sections, structural: draft.structural,
    replaces: draft.replaces, expectedPointerRevision: pointer.revision,
    ...(extraAnchors.length === 0 ? {} : { extraAnchors }) } };
}

/** The open responsible scope links of a card, in card order, as the operation hands them. */
function scopeOfCard(card: SessionCard): RoleScopeV1[] {
  return openTargetsOf(card).flatMap((target: WorkLinkTarget): RoleScopeV1[] => {
    switch (target.kind) {
      case 'project': return [{ kind: 'project' }];
      case 'goal': return [{ kind: 'goal', goalRef: target.ref }];
      case 'module': return [{ kind: 'region', moduleRef: target.ref }];
      case 'task': case 'work': return [];
    }
  });
}

/** One `RoleScopeV1` as JCS canonical JSON, the key order hand-written (`fingerprint.ts` sorts keys). */
function canonicalScope(scope: RoleScopeV1): string {
  switch (scope.kind) {
    case 'project': return '{"kind":"project"}';
    case 'goal': return '{"goalRef":{"aggregateType":"Goal",'
      + `"goalId":${JSON.stringify(scope.goalRef.goalId)},"projectId":${JSON.stringify(scope.goalRef.projectId)}},"kind":"goal"}`;
    case 'region': return '{"kind":"region","moduleRef":{'
      + `"moduleId":${JSON.stringify(scope.moduleRef.moduleId)},`
      + `"projectId":${JSON.stringify(scope.moduleRef.projectId)}}}`;
  }
}

/** The rendered `old line` value, hand-written in JCS key order. */
function canonicalOldLine(ref: SessionRef): string {
  return `{"projectId":${JSON.stringify(ref.projectId)},"sessionId":${JSON.stringify(ref.sessionId)}}`;
}

/** The frozen Query manifest, opened through the public `materials/open` route. */
async function queryManifestOf(world: S7D2ProjectWorld, prepared: PreparedQueryExecution): Promise<QueryManifestV1> {
  const opened = valueOf<{ body: string }>((await world.world.post('materials/open', plain(S6A_SCOPE, {
    ref: prepared.bundleRef, usage: 'historical_explanation',
  }))).body, 'ready', 'the frozen Query manifest');
  return JSON.parse(opened.body) as QueryManifestV1;
}

/** The Work manifest the start step prepared, opened through `materials/open`. */
async function startManifestOf(world: S7D2ProjectWorld, start: WorkflowAdvanceInput): Promise<WorkManifestV1> {
  if (start.kind !== 'perform' || start.operation.kind !== 'start') {
    throw new Error('BRIEFQ: the Workflow next step is not the Work start');
  }
  const prepared = (start.operation.request as unknown as { prepared: { envelope: { bundleRef: unknown } } }).prepared;
  const opened = valueOf<{ body: string }>((await world.world.post('materials/open', plain(S6A_SCOPE, {
    ref: prepared.envelope.bundleRef, usage: 'historical_explanation',
  }))).body, 'ready', 'the frozen Work manifest');
  return JSON.parse(opened.body) as WorkManifestV1;
}

/**
 * The current input of one model request: its last user message. A later round on the same Session carries the
 * earlier Query exchange as history before it, so the whole joined text would still show the Query's brief.
 */
function currentInput(request: { messages: readonly { role: string; content?: string }[] }): string {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (message?.role === 'user') return message.content ?? '';
  }
  throw new Error('BRIEFQ: the model request carried no current user message');
}

/** The Work input the world model received (the Query and the R3 Work Run are served by it). */
function userText(world: S7D2ProjectWorld): string {
  const last = world.world.model.lastRequest();
  if (last === undefined) throw new Error('BRIEFQ: the world model made no request');
  return currentInput(last);
}

/** The first model request a line's own scripted queue served (the R2 Work Run). */
async function lineText(world: S7D2ProjectWorld, line: S6ASession): Promise<string> {
  const first = (await world.world.scripted.requests(line))[0];
  if (first === undefined) throw new Error(`BRIEFQ: ${line.label} made no model request`);
  return currentInput(first);
}

/**
 * R3's first Work Run with its start input kept: `runS7D2Work` drives through the start, so the prepared Work
 * manifest is only reachable by stopping at the start and performing it here (the same public steps).
 */
async function runWorkWithStart(world: S7D2ProjectWorld, input: {
  line: S6ASession; goal: GoalRef; task: TaskTriple; label: string; replies: readonly ScriptedReply[];
}): Promise<{ start: WorkflowAdvanceInput; steps: AdvanceValue[] }> {
  // The successor's Session queue is not served after its Query round (the Query's Kernel scope owns the world
  // model), so the run scripts the ONE world model the same real Host uses; it is the same scripted provider.
  world.world.scriptReplies(input.replies);
  const start = await advanceUntil(world.world.ag2b, { schemaVersion: 1, goalRef: input.goal,
    flowId: `s7d2-${input.label}`, sessionHint: input.line.ref, kind: 'select_work',
    taskId: input.task.taskId }, 'start');
  const steps = await driveWorkflow(world.world.ag2b, start, { stopBefore: 'open_checks' });
  return { start, steps };
}

// ---------------------------------------------------------------------------
// R1 and R3: one successor line, one prepared Query, then its first Work Run
// ---------------------------------------------------------------------------

type BriefState = {
  readonly world: S7D2ProjectWorld;
  readonly source: S6ASession;
  readonly successor: SessionRef;
  readonly operation: OperationRef;
  readonly note: NoteItemV1;
  readonly prepared: PreparedQueryExecution;
  readonly manifest: QueryManifestV1;
  readonly handedScope: RoleScopeV1[];
  readonly r3Task: TaskTriple;
};

let brief: BriefState | null = null;

describe('BRIEFQ R1: Query preparation freezes record 5 into the manifest and input', () => {
  /*
   * Named mutation: `src/core/agent-runtime/query-preparation.ts`'s read gate
   * (`if (!requestRound && deps.handoffBriefs !== undefined)`) forced to `if (false)` -> `manifest.handoffBrief`
   * is absent and the `## Handoff brief` line is missing from `manifest.input`.
   */
  it('R1 (memory): the successor Query sees the handoff brief and the scope the handoff actually handed over',
    async () => {
      const world = await openS7D2ProjectWorld({ backend: 'memory', adviserQueryProfile: true,
        adviserTools: ['read', 'send_session_message', 'create_member', 'record_note'] });
      worlds.push(world);
      const source = world.lines.adviser;
      const role = roleOf(source);
      const { tasks } = await adoptPLMixedPlan(world.world, { goal: world.goal, label: 'briefq-r1', tasks: [
        { taskId: 'briefq-r1-work', role }, { taskId: 'briefq-r3-work', role },
      ] });
      const [r1Task, r3Task] = tasks;
      await linkS7D2Scopes(world.world, { line: source, targets: [{ kind: 'task', ref: r1Task! }],
        label: 'briefq-r1-task' });
      const pointer = await understandingPointer(world.world, { kind: 'goal', goalId: world.goal.goalId });
      const noteCall = understandingCall('briefq-r1-understanding', world.goal, 'briefq-r1-understanding',
        'BRIEFQ R1 understanding', pointer, []);
      await runS7D2Work(world.world, { line: source, goal: world.goal, task: r1Task!, label: 'briefq-r1',
        replies: [{ kind: 'calls', calls: [noteCall] }, { kind: 'text', text: 'BRIEFQ R1 done' }] });
      const note = await understandingOf(world, world.goal, await latestRun(world, source));

      // The operation's handed scope, from the public card before the handoff, in card order.
      const sourceCard = await world.readCard(source);
      const handedScope = scopeOfCard(sourceCard);

      const handed = await handoffS7D2Line(world.world, { source, duty: 'adviser', commandId: 'briefq-full' });
      const successorCard = await world.readCard(handed.successor);
      const claimed = await claimQueryOn(world.world.ag2b, { ref: successorCard.record.ref,
        revision: successorCard.record.revision }, 'briefq-r1', PL_ADVISER_ROLE_BINDING);
      const prepared = valueOf<PreparedQueryExecution>((await world.world.post('queries/prepare', plain(S6A_SCOPE, {
        queryRunRef: claimed.queryRunRef, requestId: 'briefq-r1-prepare',
      }))).body, 'ready', 'the Query prepare');
      const manifest = await queryManifestOf(world, prepared);
      brief = { world, source, successor: handed.successor, operation: handed.operation, note, prepared,
        manifest, handedScope, r3Task: r3Task! };

      expect(manifest.handoffBrief).toBeDefined();
      if (manifest.handoffBrief === undefined) return;
      expect(manifest.handoffBrief.binding).toEqual({ operation: handed.operation, source: source.ref,
        successor: handed.successor, duty: 'adviser', digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(manifest.handoffBrief.material.understanding).toEqual([{ noteId: note.noteId, version: 1 }]);
      expect(manifest.handoffBrief.material.handedScope).toEqual(handedScope);

      const scopeText = handedScope.map(canonicalScope).join('、');
      expect(manifest.input).toContain('## Handoff brief');
      expect(manifest.input).toContain(`- handed scope: ${scopeText}`);
      expect(manifest.input).toContain('- project background:');
      expect(manifest.input).toContain(`- understanding: ${note.noteId}@1`);
      expect(manifest.input).toContain(`- old line: ${canonicalOldLine(source.ref)}`);
    }, 300_000);
});

describe('BRIEFQ R3: Query entry consumes record 5 once, so the first Work Run does not see it', () => {
  /*
   * Named mutation: after the consumption contribution is computed in
   * `src/core/work-graph/queries/query-execution.ts`'s `beginEntry`, forcing `handoffRecord = null;
   * handoffGuard = null;` leaves record 5 unconsumed -> the Work request contains `## Handoff brief`.
   */
  it('R3 (memory): the Query start consumes the brief and the successor Work Run reads a manifest without it',
    async () => {
      if (brief === null) throw new Error('BRIEFQ: R1 left no prepared successor Query');
      const { world, successor, prepared, r3Task } = brief;
      const successorLine = lineOfCard(await world.readCard(successor), 'briefq-r3-successor');

      world.world.scriptReplies([{ kind: 'text', text: 'BRIEFQ R3 query answer' }]);
      const started = valueOf<QueryExecutionRecord>((await world.world.post('queries/start', plain(S6A_SCOPE, {
        prepared, consumerId: AG2B_CONSUMER_ID, requestId: 'briefq-r3',
      }))).body, 'ready', 'the Query start');
      expect(started.answer).not.toBeNull();

      await linkS7D2Scopes(world.world, { line: successorLine, targets: [{ kind: 'task', ref: r3Task }],
        label: 'briefq-r3-task' });
      const run = await runWorkWithStart(world, { line: successorLine, goal: world.goal, task: r3Task,
        label: 'briefq-r3', replies: [{ kind: 'text', text: 'BRIEFQ R3 done' }] });

      const text = userText(world);
      expect(text).not.toContain('## Handoff brief');
      expect(text).not.toContain('- old line:');
      expect((await startManifestOf(world, run.start)).handoffBrief).toBeUndefined();
    }, 300_000);
});

// ---------------------------------------------------------------------------
// R2: a partial handoff (the split of src/a) lists only the handed scope
// ---------------------------------------------------------------------------

describe('BRIEFQ R2: a partial handoff lists only the handed region', () => {
  /*
   * Named mutation: restoring the old sentence in
   * `resources/prompts/platform/templates/handoff-brief-adviser.txt:3–:5` (and regenerating
   * `platform-pack.generated.ts`) -> `toContain('The handed scope listed')` turns red, and the
   * whitespace-normalized `not.toContain('The project scope below is now yours.')` turns red; the literal form
   * alone stays green because the old sentence is line-wrapped (`... is\nnow yours.`).
   */
  it('R2 (memory): the split new line sees only src/a as the handed scope, then the project background',
    async () => {
      const world = await openS7D2ProjectWorld({ backend: 'memory',
        adviserTools: ['read', 'send_session_message', 'create_member', 'propose_role_split', 'record_note'] });
      worlds.push(world);
      const l1 = world.regionAdviser;
      const role = roleOf(l1);
      const { tasks } = await adoptPLMixedPlan(world.world, { goal: world.goal, label: 'briefq-r2', tasks: [
        { taskId: 'briefq-r2-split', role }, { taskId: 'briefq-r2-work', role },
      ] });
      const [splitTask, workTask] = tasks;
      await linkS7D2Scopes(world.world, { line: l1, targets: [{ kind: 'task', ref: splitTask! }],
        label: 'briefq-r2-split-task' });
      const pointer = await understandingPointer(world.world, { kind: 'goal', goalId: world.goal.goalId });
      const noteCall = understandingCall('briefq-r2-understanding', world.goal, 'briefq-r2-understanding',
        'BRIEFQ R2 understanding', pointer, [{ kind: 'module', moduleId: world.modules.child.moduleId }]);
      const splitCall = { callId: 'briefq-r2-split', name: 'propose_role_split', args: {
        move: [{ kind: 'region', moduleRef: world.modules.child }], reason: 'BRIEFQ R2 partial handoff',
      } };
      await runS7D2Work(world.world, { line: l1, goal: world.goal, task: splitTask!, label: 'briefq-r2-split',
        replies: [{ kind: 'calls', calls: [noteCall] }, { kind: 'calls', calls: [splitCall] },
          { kind: 'text', text: 'BRIEFQ R2 split done' }] });
      const note = await understandingOf(world, world.goal, await latestRun(world, l1));

      const end = await splitEnd(world);
      expect(end).toMatchObject({ phase: 'completed', actionPhase: 'done' });
      const nl = lineOfCard(await world.readCard(await newLineOf(world, end)), 'briefq-r2-new-line');
      await linkS7D2Scopes(world.world, { line: nl, targets: [{ kind: 'task', ref: workTask! }],
        label: 'briefq-r2-work-task' });
      await runS7D2Work(world.world, { line: nl, goal: world.goal, task: workTask!, label: 'briefq-r2',
        replies: [{ kind: 'text', text: 'BRIEFQ R2 done' }] });

      const text = await lineText(world, nl);
      const scopeLine = text.split('\n').find(line => line.startsWith('- handed scope: '));
      expect(scopeLine).toBe(`- handed scope: ${canonicalScope({ kind: 'region',
        moduleRef: world.modules.child })}`);
      expect(scopeLine).not.toContain('"moduleId":"src","projectId":');
      expect(scopeLine).not.toContain('"moduleId":"docs"');
      expect(text).toContain('- project background:\n- goal ');
      expect(text).toContain('The handed scope listed');
      expect(text).toContain('below is now yours; the background that follows is what the line knows, not a\nlarger scope.');
      expect(text).not.toContain('The project scope below is now yours.');
      expect(text.replace(/\s+/g, ' ')).not.toContain('The project scope below is now yours.');
      expect(text).toContain(`- understanding: ${note.noteId}@1`);
      expect(text).toContain(`- old line: ${canonicalOldLine(l1.ref)}`);
    }, 300_000);
});
