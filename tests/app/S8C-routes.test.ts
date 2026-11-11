/**
 * The architecture route and wiring row.
 *
 * Every entry is the real HTTP server over the real `createTargetPlatform`
 * composition: W-B's `architecture/revise` as the person, the same request as
 * the real Runtime-issued member (forbidden), the two card application rows
 * through W-A's real repair and W-C's real proposal, the route row table, and
 * the A3 commit barrier holding the real revise commit while `platform.close()`
 * waits for it. No read value, pin, context or receipt is hand-made.
 *
 * The repair answer's step ③ formal receipt is the activation commit's own
 * receipt: `create-platform.ts` looks it up by the commit's `s4-note-activate:`
 * identity, so `recordDecisionApplication` reads the proof on the commit's last
 * event instead of looking for the catalog-revise identity. The row therefore
 * asserts the application is committed beside the one effect and the replay.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CORE_ROUTE_SPECS } from '../../src/app/core-routes.js';
import type { ArchitectureCatalogPinV1, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { ArchitectureRevision } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import type { DecisionCardV1, ResolveDecisionReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { MemoryHistoryResultV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { ProposalResult } from '../../src/contracts/architecture-proposal.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { EXPECTED_ROUTE_ROWS } from '../helpers/S6B3-route-suffixes.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { ready } from '../helpers/S1-runtime-scenario-fixture.js';
import { openMaintainerWorld4, type MaintainerWorld } from '../helpers/S8B-maintainer-world.js';
import type { S6ACardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS8CRepairWorld, repairCommits, type S8CRepairWorld } from '../helpers/S8C-repair-world.js';
import { openProposalWorld, type ProposalWorld } from '../helpers/S8C-proposal-world.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { waitFor } from '../scenarios/harness.js';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: ({ close(): Promise<void> } | null)[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.all(worlds.splice(0).map(world => world?.close()));
  expect(left).toEqual([]);
});

async function w4(): Promise<MaintainerWorld> {
  const opened = await openMaintainerWorld4({ backend: 'memory' });
  worlds.push(opened);
  return opened;
}

function addModule(projectId: string, moduleId: string, path: string) {
  return { op: 'add_module' as const, module: {
    ref: { projectId, moduleId }, name: moduleId, responsibility: `Own ${moduleId}`,
    paths: [path], interfaces: [],
  } };
}

async function currentArchitecture(world: MaintainerWorld): Promise<ArchitectureRevision> {
  const answer = await world.postRoute('architecture/read', plain(world.scope, { selection: { kind: 'current' } }));
  return valueOf<ArchitectureRevision>(answer.body, 'ready', 'the current architecture');
}

function pinOf(value: ArchitectureRevision): ArchitectureCatalogPinV1 {
  return { catalogRef: value.catalog.ref,
    baseline: { ref: value.baseline.ref, digest: value.baseline.contentDigest } };
}

async function scopePins(world: MaintainerWorld) {
  const read = ready(await world.platform.projects.readWorkspaceRegistration(world.ctx, world.scope));
  return [{ ref: read.project.ref, revision: read.project.revision },
    { ref: read.workspace.ref, revision: read.workspace.revision }];
}

async function reviseOverHttp(world: MaintainerWorld, input: {
  expected: ArchitectureCatalogPinV1; ops: readonly unknown[]; reason: string; requestId: string;
}) {
  return await world.postRoute('architecture/revise', graphWrite(world.scope, {
    expected: input.expected, ops: input.ops, responsibilityMoves: [], reason: input.reason,
  }, input.requestId, await scopePins(world)));
}

function modulesOf(value: ArchitectureRevision): readonly ModuleDefinition[] {
  return value.catalog.catalog.modules;
}

function proposeR14(world: ProposalWorld, moduleId: string): Promise<ProposalResult> {
  return world.propose([{ baseCatalogPin: world.pin, ops: [addModule(world.projectId, moduleId, `src/${moduleId}`)],
    reason: `R14 proposal ${moduleId}` }]).then(results => results[0]!);
}

function needsDecision(result: ProposalResult) {
  if (result.status !== 'needs_decision') throw new Error(`expected needs_decision: ${JSON.stringify(result)}`);
  return result;
}

/** The person's real `goals/settings/set`: a small repair needs the card under every-step. */
async function setEveryStep(world: S8CRepairWorld): Promise<void> {
  const read = await world.main.route('goals/settings', { goalRef: world.goal }) as
    { status?: string; value?: { goal?: { revision?: number } } };
  const revision = read.value?.goal?.revision;
  if (read.status !== 'ready' || revision === undefined) {
    throw new Error(`R14: the Goal settings are not readable: ${JSON.stringify(read)}`);
  }
  const body = await world.main.post('goals/settings/set', graphWrite(world.main.scope, {
    goalRef: world.goal, autonomy: 'every_step', waitForGoalRef: null,
  }, `r14-repair-autonomy-${world.goal.goalId}`, [{ ref: world.goal, revision }])) as { status?: string };
  expect(body.status).toBe('committed');
}

async function answerR14Card(world: S6ACardsWorkspace, card: DecisionCardV1, optionId: 'approve' | 'reject',
  requestId: string): Promise<ResolveDecisionReadV1> {
  const read = valueOf<DecisionCardV1>(await world.route('decisions/card',
    { source: card.source }), 'ready', `the card ${card.cardKey}`);
  return valueOf<ResolveDecisionReadV1>(await world.post('decisions/answer', graphWrite(world.scope, {
    source: read.source, selection: { kind: 'option', optionId }, text: '', annotations: [],
  }, requestId, read.source.pins)), 'ready', `the answer ${requestId}`);
}

describe('R14 (a): architecture/revise over HTTP and the public architecture/read agree', () => {
  it('returns the same catalog, revision and responsibility the route committed', async () => {
    const world = await w4();
    const before = await currentArchitecture(world);
    expect(before.catalog.ref.revision).toBe(1); // one initial adoption
    const expected = pinOf(before);
    const committed = await reviseOverHttp(world, {
      expected, ops: [addModule(world.projectId, 'r14-a', 'r14-a')], reason: 'R14 (a) add', requestId: 'r14-a-revise' });
    expect(committed.body).toMatchObject({ status: 'committed' });
    const result = valueOf<ArchitectureRevision>(committed.body, 'committed', 'the revise');
    const after = await currentArchitecture(world);
    // The public read, not the route's own return, is the compared value.
    expect(after.catalog.ref).toEqual(result.catalog.ref);
    expect(after.baseline.ref).toEqual(result.baseline.ref);
    expect(after.catalog.catalog.modules).toEqual(result.catalog.catalog.modules);
    expect(after.catalog.ref.revision).toBe(before.catalog.ref.revision + 1);
    expect(modulesOf(after).find(module => module.ref.moduleId === 'r14-a')).toMatchObject({
      responsibility: 'Own r14-a', paths: ['r14-a'] });
  });
});

describe('R14 (b): the agent principal is refused by the human-only revise route', () => {
  it('answers forbidden for the real Runtime-issued member context and writes nothing', async () => {
    const world = await w4();
    const before = await currentArchitecture(world);
    let rejection: unknown;
    try {
      await world.dispatch('architecture/revise', world.member, graphWrite(world.scope, {
        expected: pinOf(before), ops: [addModule(world.projectId, 'r14-b', 'r14-b')],
        responsibilityMoves: [], reason: 'R14 (b) agent',
      }, 'r14-b-revise', await scopePins(world)));
    } catch (error) {
      rejection = (error as { rejection?: unknown }).rejection;
    }
    expect(rejection).toEqual({ status: 'rejected', code: 'forbidden',
      reason: 'only the person may call this route' });
    expect((await currentArchitecture(world)).catalog.ref).toEqual(before.catalog.ref);
  });
});

describe('R14 (c): each application row applies its one effect once', () => {
  it('repair_approval: the person approves W-A repair once and the catalog revision moves once', async () => {
    const repair: S8CRepairWorld = await openS8CRepairWorld({ label: 'r14-repair' });
    worlds.push(repair);
    // A small repair needs the card under every-step; its module text is inside the
    // Run's real footprint, so the approved activation can commit.
    await setEveryStep(repair);
    const staged = await repair.writeRepair({ ops: [{ op: 'set_responsibility' as const,
      moduleId: 's6a-core', text: 'R14 repaired core' }] });
    expect(staged.version).toBe(1);
    expect((await repair.pass(staged)).finalize.result).toMatchObject({ status: 'committed',
      value: { outcome: 'PASS' } });
    const card = (await repair.main.readCards(repair.goal))
      .find(entry => entry.source.kind === 'repair_approval');
    if (card === undefined) throw new Error('R14: the repair_approval card is missing');
    const before = await repair.readCatalog();
    const answered = await answerR14Card(repair.main, card, 'approve', 'r14-repair-answer');
    // Step ③'s formal receipt is the activation commit's own; its one effect
    // commit is also observable through the catalog and the note head.
    expect(answered.answer.status).toBe('committed');
    expect(answered.application).toMatchObject({ status: 'committed' });
    expect(answered.state).toBe('applied');
    expect(await repair.readCatalog()).toBe(before + 1);
    expect(await repair.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'accepted' });

    // The same decisions/answer request replays the original application: one effect only.
    await answerR14Card(repair.main, card, 'approve', 'r14-repair-answer');
    expect(await repair.readCatalog()).toBe(before + 1);
    expect(await repair.readNote(staged.noteId)).toMatchObject({ version: 2 });
  });

  it('row 2: rejecting the repair_approval withdraws with a proof, records the application and replays once', async () => {
    const repair = await openS8CRepairWorld({ label: 'row2-reject' });
    worlds.push(repair);
    await setEveryStep(repair);
    const staged = await repair.writeRepair({ ops: [{ op: 'set_responsibility' as const,
      moduleId: 's6a-core', text: 'Row 2 rejected core' }] });
    expect(staged.version).toBe(1);
    expect((await repair.pass(staged)).finalize.result).toMatchObject({ status: 'committed',
      value: { outcome: 'PASS' } });
    const card = (await repair.main.readCards(repair.goal))
      .find(entry => entry.source.kind === 'repair_approval');
    if (card === undefined) throw new Error('row 2: the repair_approval card is missing');

    repairCommits.reset();
    const answered = await answerR14Card(repair.main, card, 'reject', 'row2-repair-reject');
    expect(answered.answer.status).toBe('committed');
    // The reject's own withdraw commit carries the card proof, so step ③'s
    // formal application read proves the answer and records the application.
    expect(answered.application).toMatchObject({ status: 'committed' });
    expect(answered.state).toBe('applied');

    // The note is withdrawn by the person's answer, with the answer's reason.
    expect(await repair.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'withdrawn' });
    const history = valueOf<MemoryHistoryResultV1>(await repair.world.platform.notes.memoryHistory(
      repair.world.humanContext(), { v: 1, op: 'history', noteId: staged.noteId, limit: 10, cursor: null }),
      'ready', 'the withdrawn note history');
    expect(history.items.find(item => item.version === 2)?.change)
      .toMatchObject({ kind: 'withdraw', reason: 'rejected_by_user' });

    // The card is no longer pending: the saved answer's application is now recorded.
    const after = valueOf<DecisionCardV1>(await repair.main.route('decisions/card', { source: card.source }),
      'ready', 'the rejected repair card');
    expect(after).toMatchObject({ state: 'applied' });
    expect(after.application).not.toBeNull();

    // The same request replays the same application receipt and writes nothing. KLS-2b: the knowledge writes move
    // the Host's earlier automatic capture later; let it settle so the count sees only this replay.
    await waitFor(async () => valueOf<ArchitectureObservationStateV1>(await repair.world.platform.architecture
      .observationState(repair.world.humanContext(), { workspace: S6A_SCOPE }), 'ready', 'the observation state'),
    state => state.autoCapture?.pending !== true, 'the automatic capture to settle');
    const commits = repairCommits.count();
    const replay = await answerR14Card(repair.main, card, 'reject', 'row2-repair-reject');
    expect(replay.answer.status).toBe('committed');
    expect(replay.application).toMatchObject({ status: 'committed' });
    expect(replay.application).toMatchObject({ status: 'committed', replayed: true });
    expect((replay.application as { value?: unknown }).value)
      .toEqual((answered.application as { value?: unknown }).value);
    expect(replay.state).toBe('applied');
    expect(repairCommits.count()).toBe(commits);
    expect(await repair.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'withdrawn' });
  });

  it('row 2: an ordinary withdraw cannot inject a cardProof into a paused approval', async () => {
    const repair = await openS8CRepairWorld({ label: 'row2-ordinary-withdraw' });
    worlds.push(repair);
    await setEveryStep(repair);
    const staged = await repair.writeRepair({ ops: [{ op: 'set_responsibility' as const,
      moduleId: 's6a-core', text: 'Row 2 ordinary withdrawn core' }] });
    expect(staged.version).toBe(1);
    expect((await repair.pass(staged)).finalize.result).toMatchObject({ status: 'committed',
      value: { outcome: 'PASS' } });
    const before = await repair.readCatalog();

    // A paused Goal leaves the real approve answered but not applied: no
    // catalogue revision, no application on the answer.
    await repair.pause();
    const card = await repair.readRepairCard();
    const approved = await repair.answerRepairCard(card, 'approve', 'row2-ordinary-approve');
    expect(approved.answer.status).toBe('committed');
    expect(approved.application).toBeNull();
    // The paused coordinator hands the activation back (`answered`); the card's
    // own read is the approved, not-yet-applied state below.
    expect(approved.state).toBe('answered');
    if (approved.answer.status !== 'committed') throw new Error('row 2: the approval did not commit');
    const answer = approved.answer.value;
    const human = repair.world.humanContext();
    const actor = human.principal.kind === 'host' ? human.principal.actor : null;
    expect(await repair.readCatalog()).toBe(before);

    // The real caller can still put `cardProof` in the ordinary withdraw JSON,
    // but the note write port type must no longer admit it.
    type WithdrawInput = Parameters<typeof repair.world.platform.notes.withdrawNote>[1];
    const proofIsNotAnInput: WithdrawInput = { commandId: 'row2-ordinary-type',
      noteId: staged.noteId, expectedVersion: staged.version, reason: null,
      // @ts-expect-error: an ordinary note withdraw carries no card proof.
      cardProof: { acknowledgementRef: answer.ref, actor } };
    void proofIsNotAnInput;

    const withdrawn = await repair.main.post('notes/withdraw', plain(repair.main.scope, {
      commandId: 'row2-ordinary-withdraw', noteId: staged.noteId,
      expectedVersion: staged.version, reason: 'the person withdraws the staged repair',
      cardProof: { acknowledgementRef: answer.ref, actor },
    })) as { status?: string; noteId?: string; version?: number; state?: string;
      receipt?: { identityKey: string; fingerprint: string; cursor: string } };
    expect(withdrawn).toMatchObject({ status: 'done', noteId: staged.noteId,
      version: staged.version + 1, state: 'withdrawn' });
    expect(await repair.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'withdrawn' });
    if (withdrawn.status !== 'done' || withdrawn.receipt === undefined) {
      throw new Error(`row 2: the ordinary withdraw did not commit: ${JSON.stringify(withdrawn)}`);
    }

    // The withdraw's own event carries no proof, so the formality read refuses
    // this receipt as `incomplete` and records no application.
    const application = await repair.main.post('decisions/application', graphWrite(repair.main.scope, {
      messageRef: answer.ref, receipt: withdrawn.receipt,
    }, 'row2-ordinary-application',
    [{ ref: answer.ref, revision: answer.revision }])) as { status?: string; code?: string; reason?: string };
    expect(application).toMatchObject({ status: 'rejected', code: 'incomplete',
      reason: 'the formal event carries no decision change proof' });

    // The approval still has no application and the catalogue is unrevised.
    const after = valueOf<DecisionCardV1>(await repair.main.route('decisions/card', { source: card.source }),
      'ready', 'the paused repair card after the ordinary withdraw');
    expect(after).toMatchObject({ state: 'answered_pending_application' });
    expect(after.application).toBeNull();
    expect(await repair.readCatalog()).toBe(before);
    expect(await repair.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'withdrawn' });
  });

  it('structural_proposal: the person approves W-C proposal once and the catalog revision moves once', async () => {
    const proposal: ProposalWorld = await openProposalWorld();
    worlds.push(proposal);
    const frozen = needsDecision(await proposeR14(proposal, 'r14-c'));
    const card = await proposal.cardByKey(frozen.cardKey);
    const before = await proposal.readCatalog();
    expect(before.revision).toBe(2); // initial adoption c1 + the world's setup add c2
    const answered = await proposal.answer(card, 'approve', 'r14-proposal-answer');
    expect(answered).toMatchObject({ state: 'applied',
      answer: { status: 'committed' }, application: { status: 'committed' } });
    expect(proposal.lastApply()).toMatchObject({ status: 'applied', receipt: expect.anything() });
    expect((await proposal.readCatalog()).revision).toBe(before.revision + 1);
    expect((await proposal.read(frozen.proposalRef)).proposal).toMatchObject({ state: 'applied' });

    const replay = await proposal.answer(card, 'approve', 'r14-proposal-answer');
    expect(replay.state).toBe('applied');
    expect((await proposal.readCatalog()).revision).toBe(before.revision + 1);
  });
});

describe('R14 (d): the route row table names the revise route', () => {
  it('matches the expected graph_write row', () => {
    expect(CORE_ROUTE_SPECS['architecture/revise']).toEqual(EXPECTED_ROUTE_ROWS['architecture/revise']);
    expect(CORE_ROUTE_SPECS['architecture/proposals/read'])
      .toEqual(EXPECTED_ROUTE_ROWS['architecture/proposals/read']);
  });
});

describe('R14 (e): the tracked revise commit holds platform.close()', () => {
  it('does not complete before release and completes after the revise returns committed', async () => {
    const world = await w4();
    const before = await currentArchitecture(world);
    const hold = commitBarrier.hold(byIdentityPrefix('architecture-catalog-revise:'), 'R14 revise');
    const revising = reviseOverHttp(world, { expected: pinOf(before),
      ops: [addModule(world.projectId, 'r14-e', 'r14-e')], reason: 'R14 (e) hold', requestId: 'r14-e-revise' });
    await hold.reached;
    let closed = false;
    const closing = world.platform.close().then(() => { closed = true; });
    // The revise commit is still held, so the tracked close cannot have finished.
    for (let turn = 0; turn < 100 && !closed; turn += 1) await Promise.resolve();
    expect(closed).toBe(false);
    hold.release();
    const [answer] = await Promise.all([revising, closing]);
    expect(closed).toBe(true);
    expect(answer.body).toMatchObject({ status: 'committed' });
    expect(valueOf<ArchitectureRevision>(answer.body, 'committed', 'the held revise').catalog.ref.revision)
      .toBe(before.catalog.ref.revision + 1);
  });
});
