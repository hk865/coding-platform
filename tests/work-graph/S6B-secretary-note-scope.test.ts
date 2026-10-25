/**
 * Row 8: the secretary QueryRun's pure note scope and its service use.
 *
 * Part 1 calls the pure `secretaryNoteScope` with constructed inputs (its facts are goal ids, an effective goal and a
 * hand-built grant set; nothing else). Part 2 drives the real held request round (the frozen `holdS6BRequestRound`) and
 * hands it the Runtime's own `query_run` context through the A3 pass-through wrapper on `createQueryGraphToolGroup`
 * (the real group is built and returned unchanged), as in row 7. Expected values come from §3.4 items 2–3 and the
 * frozen manifest's `effectiveGoalId`; state is read through `notes/read` and `notes/listByAnchor`, never the store.
 * The stage rows adopt the goal's Plans through `plans/propose` and `plans/apply`, as a person does; a stage anchor's
 * version is the Plan adopted before the round's preparation (the draft's `planRevision: 1`), not a later one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { NoteDraftAnchorV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type { NoteItemV1 } from '../../src/core/work-graph/model/note-contracts.js';
import { secretaryNoteScope, type SecretaryNoteScopeFactsV1 } from '../../src/core/work-graph/state/note-machine.js';
import { draftFrom } from '../scenarios/support/common.js';
import { ag2bPlanDraft, graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { holdS6BRequestRound } from '../helpers/S6B1-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { captureQueryContexts } from '../helpers/query-context-capture.js';

// ---------------------------------------------------------------------------
// Part 1: the pure scope table
// ---------------------------------------------------------------------------

const G1 = 'goal-one';
const G2 = 'goal-two';

type Expected = { storedGoalId: string | null }
  | { ok: false; reason: 'guard_failed'; code: 'forbidden' | 'invalid'; detail: string };

const refusal = (code: 'forbidden' | 'invalid', detail: string): Expected =>
  ({ ok: false, reason: 'guard_failed', code, detail });
const stored = (storedGoalId: string | null): Expected => ({ storedGoalId });

const understandingFacts = (over: Partial<SecretaryNoteScopeFactsV1> = {}): SecretaryNoteScopeFactsV1 => ({
  kind: 'understanding', target: 'goal', anchorGoalIds: [], mainAnchorGoalId: null, effectiveGoalId: null,
  grantedGoalIds: [], ...over,
});
const generalFacts = (over: Partial<SecretaryNoteScopeFactsV1> = {}): SecretaryNoteScopeFactsV1 => ({
  kind: 'convention', target: null, anchorGoalIds: [], mainAnchorGoalId: null, effectiveGoalId: null,
  grantedGoalIds: [], ...over,
});

const grantCases: { name: string; facts: SecretaryNoteScopeFactsV1; expected: Expected }[] = [
  { name: 'a granted Goal as the main anchor of a no-goal round stores that Goal', expected: stored(G1),
    facts: understandingFacts({ anchorGoalIds: [G1], mainAnchorGoalId: G1, effectiveGoalId: null, grantedGoalIds: [G1] }) },
  { name: 'a granted main anchor with an anchor in another Goal is refused', expected: refusal('forbidden', 'anchor_out_of_goal'),
    facts: understandingFacts({ anchorGoalIds: [G1, G2], mainAnchorGoalId: G1, effectiveGoalId: G1, grantedGoalIds: [G1] }) },
  { name: 'a granted Goal that is not the effective goal stores the grant', expected: stored(G2),
    facts: understandingFacts({ anchorGoalIds: [G2], mainAnchorGoalId: G2, effectiveGoalId: G1, grantedGoalIds: [G2] }) },
  { name: 'a stage understanding whose Goal is granted but not effective is refused',
    expected: refusal('forbidden', 'anchor_out_of_goal'),
    facts: understandingFacts({ target: 'stage', anchorGoalIds: [G2], mainAnchorGoalId: G2, effectiveGoalId: G1,
      grantedGoalIds: [G2] }) },
  { name: 'a stage understanding in the effective goal stores it', expected: stored(G1),
    facts: understandingFacts({ target: 'stage', anchorGoalIds: [G1], mainAnchorGoalId: G1, effectiveGoalId: G1 }) },
  { name: 'a goal understanding in the effective goal without a grant stores it', expected: stored(G1),
    facts: understandingFacts({ anchorGoalIds: [G1], mainAnchorGoalId: G1, effectiveGoalId: G1 }) },
  { name: 'a goal understanding outside the effective goal without a grant is refused',
    expected: refusal('forbidden', 'anchor_out_of_goal'),
    facts: understandingFacts({ anchorGoalIds: [G2], mainAnchorGoalId: G2, effectiveGoalId: G1 }) },
  { name: 'a project understanding is refused', expected: refusal('forbidden', 'project_understanding_scribe_only'),
    facts: understandingFacts({ target: 'project' }) },
  { name: 'an understanding on a file anchor is invalid',
    expected: refusal('invalid', 'an understanding may only hang on a goal, a stage or the project'),
    facts: understandingFacts({ target: null, mainAnchorGoalId: G1, effectiveGoalId: G1, anchorGoalIds: [G1] }) },
];

const generalCases: { name: string; facts: SecretaryNoteScopeFactsV1; expected: Expected }[] = [
  { name: 'a plain note on a goal inside the effective goal stores it', expected: stored(G1),
    facts: generalFacts({ anchorGoalIds: [G1], mainAnchorGoalId: G1, effectiveGoalId: G1 }) },
  { name: 'a plain note on project, module, interface and file anchors stores the effective goal', expected: stored(G1),
    facts: generalFacts({ effectiveGoalId: G1 }) },
  { name: 'a plain note on another goal is refused', expected: refusal('forbidden', 'anchor_out_of_goal'),
    facts: generalFacts({ anchorGoalIds: [G2], mainAnchorGoalId: G2, effectiveGoalId: G1 }) },
  { name: 'a plain note in a no-goal round stores no goal', expected: stored(null),
    facts: generalFacts({ kind: 'decision' }) },
  { name: 'a no-goal round refuses a goal anchor', expected: refusal('forbidden', 'anchor_out_of_goal'),
    facts: generalFacts({ anchorGoalIds: [G1], mainAnchorGoalId: G1 }) },
  { name: 'a no-goal round refuses a stage anchor', expected: refusal('forbidden', 'anchor_out_of_goal'),
    facts: generalFacts({ anchorGoalIds: [G2], mainAnchorGoalId: G2 }) },
  { name: 'a no-goal round refuses a task anchor', expected: refusal('forbidden', 'anchor_out_of_goal'),
    facts: generalFacts({ anchorGoalIds: [G1], mainAnchorGoalId: G1 }) },
  { name: 'a repair is refused', expected: refusal('forbidden', 'only an agent or a scribe stages a repair'),
    facts: generalFacts({ kind: 'repair' }) },
];

describe('the secretary note scope (pure)', () => {
  it.each([...grantCases, ...generalCases])('$name', ({ facts, expected }) => {
    expect(secretaryNoteScope(facts)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Part 2: the service rows on the real held round
// ---------------------------------------------------------------------------

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

async function openWorld() {
  const world = await openS6AHostWorld({ backend: 'memory', secretaryTools: ['read', 'look_graph'] });
  worlds.push(world);
  // The module anchors resolve through the project's adopted architecture (a public governance step).
  await ensureProjectPointers(world);
  return world;
}

const common = (topic: string, anchor: NoteDraftAnchorV1) => ({ topic, conclusion: `S6B ${topic}`, anchor,
  extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [] });

function general(topic: string, anchor: NoteDraftAnchorV1): NoteDraftV1 {
  return { ...common(topic, anchor), kind: 'convention', body: `S6B ${topic} body` };
}

function understanding(topic: string, anchor: NoteDraftAnchorV1): NoteDraftV1 {
  return { ...common(topic, anchor), kind: 'understanding',
    sections: { status: 's6b-status', decided: 's6b-decided', open: 's6b-open', next: 's6b-next', risks: 's6b-risks' } };
}

function repair(topic: string, anchor: NoteDraftAnchorV1): NoteDraftV1 {
  return { ...common(topic, anchor), kind: 'repair', body: `S6B ${topic} body` };
}

async function readNote(world: S6AHostWorld, noteId: string): Promise<NoteItemV1> {
  const read = await world.platform.notes.readNote(world.humanContext(), { noteId });
  if (read.status !== 'ready') throw new Error(`S6B: the note is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

const writeInto = (world: S6AHostWorld, ctx: CoreCallContext, commandId: string, note: NoteDraftV1) =>
  world.platform.notes.writeNote(ctx, { commandId, note, expectedPointerRevision: null, goalId: null });

const STAGE_ID = 's6b-stage';

/** `plans/propose` + `plans/apply` of `goal`'s next Plan: the AG2b draft with its tasks in one stage when the goal
 * has none, else the adopted Plan's next revision. Answers the adopted Plan as `tasks/query` reads it. */
async function adoptStagePlan(world: S6AHostWorld, goal: GoalRef, label: string) {
  const ws = s6aCardsWorkspace(world, S6A_SCOPE);
  const current = await ws.activePlan(goal);
  const planId = `s6b-scope-plan-${label}`;
  const first = ag2bPlanDraft();
  const draft = current !== null ? draftFrom(current, planId) : { ...first, planId, goalId: goal.goalId,
    stages: [{ stageId: STAGE_ID, title: 'S6B stage' }], tasks: first.tasks.map(task => ({ ...task, stageId: STAGE_ID })) };
  const proposed = await ws.post('plans/propose', graphWrite(S6A_SCOPE, { goalRef: goal, basedOn: current?.ref ?? null,
    draft, reason: { text: `S6B plan ${label}`, sources: [] } }, `${planId}-propose`)) as { value: { ref: unknown; revision: number } };
  await ws.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: proposed.value.ref,
    expectedProposalRevision: proposed.value.revision, decisionRefs: [] }, `${planId}-apply`));
  const adopted = await ws.activePlan(goal);
  if (adopted?.ref.planId !== planId) throw new Error(`S6B: ${planId} is not the adopted Plan`);
  return adopted;
}

describe('the secretary note scope in a held request round', () => {
  it('a goal round keeps plain and understanding notes inside its effective goal', async () => {
    const world = await openWorld();
    const capture = captureQueryContexts();
    try {
      const userNote = await writeInto(world, world.humanContext(), 's6b-scope-user', general('scope-user', { kind: 'project' }));
      expect(userNote.status).toBe('accepted');
      if (userNote.status !== 'accepted') throw new Error('unreachable');
      const effective = world.goals.first.goalId;
      const other = world.goals.second.goalId;
      let ids!: { plain: string; understood: string };
      await holdS6BRequestRound(world, { label: 'scope-goal', goalId: effective }, async round => {
        expect(round.manifest.request!.effectiveGoalId).toBe(effective);
        const ctx = capture.latest();
        const plain = await writeInto(world, ctx, 's6b-scope-plain', general('scope-plain', { kind: 'module', moduleId: 's6a-core' }));
        expect(plain.status).toBe('accepted');
        expect(await writeInto(world, ctx, 's6b-scope-other', general('scope-other', { kind: 'goal', goalId: other })))
          .toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'anchor_out_of_goal' });
        const understood = await writeInto(world, ctx, 's6b-scope-understood',
          understanding('scope-understood', { kind: 'goal', goalId: effective }));
        expect(understood.status).toBe('accepted');
        expect(await writeInto(world, ctx, 's6b-scope-project-understood',
          understanding('scope-project', { kind: 'project' })))
          .toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'project_understanding_scribe_only' });
        expect(await writeInto(world, ctx, 's6b-scope-repair', repair('scope-repair', { kind: 'project' })))
          .toMatchObject({ status: 'rejected', code: 'forbidden' });
        if (plain.status !== 'accepted' || understood.status !== 'accepted') throw new Error('unreachable');
        ids = { plain: plain.noteId, understood: understood.noteId };
        expect(await world.platform.notes.reviewNote(ctx, { commandId: 's6b-scope-review', noteId: plain.noteId,
          expectedVersion: plain.version, expectedPointerRevision: null, verdict: 'review', reason: null }))
          .toMatchObject({ status: 'rejected', code: 'forbidden' });
        expect(await world.platform.notes.withdrawNote(ctx, { commandId: 's6b-scope-withdraw-own',
          noteId: plain.noteId, expectedVersion: plain.version, reason: 'S6B withdraw' }))
          .toMatchObject({ status: 'done', state: 'withdrawn' });
        const user = await readNote(world, userNote.noteId);
        expect(await world.platform.notes.withdrawNote(ctx, { commandId: 's6b-scope-withdraw-user',
          noteId: user.noteId, expectedVersion: user.version, reason: 'S6B withdraw' }))
          .toMatchObject({ status: 'rejected', code: 'forbidden' });
      });
      expect((await readNote(world, ids.plain)).goalId).toBe(effective);
      expect((await readNote(world, ids.plain)).storedState).toBe('withdrawn');
      expect((await readNote(world, ids.understood)).goalId).toBe(effective);
      expect((await readNote(world, userNote.noteId)).storedState).toBe('accepted');
      const others = await world.platform.notes.listByAnchor(world.humanContext(),
        { anchor: { kind: 'goal', goalId: other }, limit: 100, cursor: null });
      expect(others.status).toBe('ready');
      if (others.status === 'ready') expect(others.value.items).toEqual([]);
    } finally {
      capture.restore();
    }
  });

  it('a no-goal round accepts project and module anchors and refuses a goal anchor', async () => {
    const world = await openWorld();
    const capture = captureQueryContexts();
    try {
      let ids!: { project: string; module: string };
      await holdS6BRequestRound(world, { label: 'scope-no-goal', goalId: null }, async round => {
        expect(round.manifest.request!.effectiveGoalId).toBeNull();
        const ctx = capture.latest();
        const project = await writeInto(world, ctx, 's6b-scope-no-goal-project', general('no-goal-project', { kind: 'project' }));
        expect(project.status).toBe('accepted');
        const module = await writeInto(world, ctx, 's6b-scope-no-goal-module',
          general('no-goal-module', { kind: 'module', moduleId: 's6a-core' }));
        expect(module.status).toBe('accepted');
        expect(await writeInto(world, ctx, 's6b-scope-no-goal-goal',
          general('no-goal-goal', { kind: 'goal', goalId: world.goals.first.goalId })))
          .toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'anchor_out_of_goal' });
        if (project.status !== 'accepted' || module.status !== 'accepted') throw new Error('unreachable');
        ids = { project: project.noteId, module: module.noteId };
      });
      expect((await readNote(world, ids.project)).goalId).toBeNull();
      expect((await readNote(world, ids.module)).goalId).toBeNull();
      const goals = await world.platform.notes.listByAnchor(world.humanContext(),
        { anchor: { kind: 'goal', goalId: world.goals.first.goalId }, limit: 100, cursor: null });
      expect(goals.status).toBe('ready');
      if (goals.status === 'ready') expect(goals.value.items).toEqual([]);
    } finally {
      capture.restore();
    }
  });

  it('a stage anchor keeps the Plan frozen at the preparation after the Plan moved on', async () => {
    const world = await openWorld();
    const goal = world.goals.first;
    await adoptStagePlan(world, goal, 'first');
    const capture = captureQueryContexts();
    try {
      let noteId!: string;
      await holdS6BRequestRound(world, { label: 'scope-stage', goalId: goal.goalId }, async () => {
        expect((await adoptStagePlan(world, goal, 'second')).planRevision).toBe(2);
        const written = await writeInto(world, capture.latest(), 's6b-scope-stage',
          understanding('scope-stage', { kind: 'stage', goalId: goal.goalId, stageId: STAGE_ID }));
        if (written.status !== 'accepted') throw new Error(`S6B: the stage note was refused: ${JSON.stringify(written)}`);
        noteId = written.noteId;
      });
      expect((await readNote(world, noteId)).anchor)
        .toEqual({ kind: 'stage', goalId: goal.goalId, planRevision: 1, stageId: STAGE_ID });
    } finally {
      capture.restore();
    }
  });
});

describe('rejects: a stage anchor in a round prepared without a Plan', () => {
  it('a Plan adopted after the preparation gives the round no stage version', async () => {
    const world = await openWorld();
    const goal = world.goals.first;
    const capture = captureQueryContexts();
    try {
      await holdS6BRequestRound(world, { label: 'scope-unplanned', goalId: goal.goalId }, async () => {
        expect((await adoptStagePlan(world, goal, 'late')).planRevision).toBe(1);
        expect(await writeInto(world, capture.latest(), 's6b-scope-unplanned',
          understanding('scope-unplanned', { kind: 'stage', goalId: goal.goalId, stageId: STAGE_ID })))
          .toMatchObject({ status: 'rejected', code: 'invalid',
            reason: 'a stage anchor needs the Plan frozen at the round preparation' });
      });
      const stage = await world.platform.notes.listByAnchor(world.humanContext(), { anchor: { kind: 'stage',
        goalId: goal.goalId, planRevision: 1, stageId: STAGE_ID }, limit: 100, cursor: null });
      expect(stage.status).toBe('ready');
      if (stage.status === 'ready') expect(stage.value.items).toEqual([]);
    } finally {
      capture.restore();
    }
  });
});
