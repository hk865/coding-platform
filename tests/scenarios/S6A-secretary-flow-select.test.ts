/**
 * `selectIdea`: a selection becomes a follow-up round of the request, and its
 * rejections.
 *
 * The success rows run with the Host's request-round driver on: an answer with
 * three ideas, `requests/select-idea` at index 1, and the round it queues. The
 * queued round's stored input is `选了第 2 个思路：<title>` and it names the
 * answer and the index it selected. The request then moves to B: B's rendered
 * input shows the idea's title and detail, once for a selection round of its
 * own and once for a selection that was absorbed into another round's batch.
 * A selection whose round is claimed on A and held there while the request is
 * routed to B runs on B: B's current-round section holds the idea's title and
 * detail, and for an absorbed selection B's executing round holds it in the
 * batch section.
 *
 * The rejection rows (`describe('rejects: …')`) each hold one error and show
 * through `requests/read` that nothing changed: an index outside the answer's
 * ideas, an answer with no ideas, and a selection on an answer that a later
 * round of the same request superseded.
 *
 * M1-07 is the race: the selection's commit is held at the frozen commit
 * barrier after the owner's reads and before the store's compare-and-swap; a
 * newer round of the same request answers meanwhile, so the released commit's
 * retry re-validates against the newer facts, answers `revision_conflict`, and
 * the request gains no selection round.
 *
 * Every prior state is a public step; the answers are the scripted model's,
 * and no record is written or read by hand.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type {
  RequestCoreViewV1, RequestRoundViewV1,
} from '../../src/core/work-graph/model/request-contracts.js';
import type { RequestSelectIdeaResultV1 } from '../../src/business/workflow/request-intake.js';
import {
  byIdentityPrefix, commitBarrier,
} from '../helpers/S6A-commit-barrier.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  buildAbsorbedSelection, buildLaterAnswer, followUp, initializeProject, newRequest, secretaryAnswer,
  submitRound, threeIdeas, waitForRound,
} from '../helpers/S6A-history-fixture.js';
import {
  SECRETARY_ANSWER_FORMAT_V1, SECRETARY_STRINGS, roundMaterialText, selectIdeaInputText, taskBatchedSlot, taskRoundSlot,
  type SampleSelectedIdea,
} from '../helpers/S6A-prompt-samples.js';
import type { S6ABackend, S6ASession } from '../helpers/S6A-request-fixture.js';

// The frozen commit barrier the race row holds a selection commit on; the test file owns its two mocks.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const BACKENDS = ['memory', 'sqlite'] as const;

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
  expect(left).toEqual([]);
});

async function openWorld(backend: S6ABackend): Promise<S6AHostWorld> {
  const world = await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' } });
  worlds.push(world);
  return world;
}

/** The last user message of one model request: the rendered input that run was given. */
function currentInput(request: ModelRequest): string {
  const messages = request.messages as unknown as { role: string; content: string }[];
  const last = messages.at(-1);
  if (last === undefined || last.role !== 'user') throw new Error('S6A: the model request carried no current user message');
  return last.content;
}

/** The round the request read lists, or a failed row. */
function roundOf(view: RequestCoreViewV1, round: QueryJobRef): RequestRoundViewV1 {
  const found = view.rounds.find(candidate => candidate.ref.queryJobId === round.queryJobId);
  if (found === undefined) throw new Error(`S6A: the request does not list the round ${round.queryJobId}`);
  return found;
}

/** The queued selection's follow-up round, or a failed row. */
function selectionFollowup(result: RequestSelectIdeaResultV1): QueryJobRef {
  if (result.status !== 'queued') throw new Error(`S6A: the selection was refused: ${JSON.stringify(result)}`);
  return result.followupRound;
}

/** The material a round shows for a selected idea: its line, then the title and detail. */
function selectedMaterial(since: string, input: string, idea: SampleSelectedIdea): string {
  return roundMaterialText({ since, input, selectedIdea: idea });
}

describe.each(BACKENDS)('the selectIdea success (%s)', (backend: S6ABackend) => {
  it('queues a follow-up with the selected idea, and B sees its title and detail after the request moves', async () => {
    const world = await openWorld(backend);
    await initializeProject(world);
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    const ideas = threeIdeas('s6a-select');
    await world.scripted.script(a, [
      { kind: 'text', text: secretaryAnswer({ body: 'S6A select answer with ideas', ideas }) },
      { kind: 'text', text: secretaryAnswer({ body: 'S6A selection follow-up answer' }) },
    ]);
    const first = await submitRound(world, newRequest('s6a-select-1', a, 'S6A select question with ideas'));
    const answered = await waitForRound(world, first.requestRoot, first.round, 'ended');
    expect(roundOf(answered, first.round).ideas).toEqual(ideas);

    // The selection's follow-up is claimed by A's driver at once; the claim is
    // held, so the read below sees the round before any answer exists.
    const claim = world.gates.beforeClaim(a);
    const selected = await world.selectIdea({ commandId: 's6a-select-idea', round: first.round, index: 1 });
    const followup = selectionFollowup(selected);
    await claim.reached;
    const queued = await world.readRequest(first.requestRoot);
    const selection = roundOf(queued, followup);
    expect(selection).toMatchObject({
      kind: 'followup',
      input: selectIdeaInputText(1, ideas[1]!.title),
      selectedIdea: { round: first.round, index: 1 },
      answer: null,
    });
    const selectionMaterial = selectedMaterial(selection.since, selection.input,
      { title: ideas[1]!.title, detail: ideas[1]!.detail });
    claim.release();

    // The round that runs on A carries the selection in its current-round slot.
    await waitForRound(world, first.requestRoot, followup, 'ended');
    const aRequests = await world.scripted.requests(a);
    expect(aRequests).toHaveLength(2);
    expect(currentInput(aRequests[1]!)).toContain(selectionMaterial);

    // Moving the request to B: B's next round shows the selection as an
    // earlier round of the request, with the idea's title and detail.
    expect(await world.route({ commandId: 's6a-select-route', round: first.round, to: b }))
      .toMatchObject({ status: 'routed' });
    await world.scripted.script(b, [{ kind: 'text', text: secretaryAnswer({ body: 'S6A select answer on B' }) }]);
    const afterRoute = await submitRound(world, followUp('s6a-select-2', first.requestRoot, 'S6A select after the move'));
    const ended = await waitForRound(world, first.requestRoot, afterRoute.round, 'ended');
    expect(roundOf(ended, afterRoute.round)).toMatchObject({ answer: 'S6A select answer on B', session: b.ref });
    const bInput = currentInput((await world.scripted.requests(b))[0]!);
    expect(bInput).toContain(SECRETARY_STRINGS['secretary.earlierHeading']);
    expect(bInput).toContain(selectionMaterial);
  }, 90_000);

  it('a selection absorbed into another round\'s batch is shown there, and B sees it in that round', async () => {
    const world = await openWorld(backend);
    await initializeProject(world);
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    const built = await buildAbsorbedSelection(world, { a, routeTo: b, index: 1, tag: 's6a-absorbed' });
    const view = await world.readRequest(built.requestRoot);
    const selection = roundOf(view, built.selection);
    const executing = roundOf(view, built.executing);
    // The selection became an absorbed round of the executing round and never
    // a run of its own; its stored input and selected idea are unchanged.
    expect(selection).toMatchObject({
      status: 'ended', absorbedInto: built.executing, answer: null,
      input: selectIdeaInputText(1, built.ideas[1]!.title),
      selectedIdea: { round: built.answered, index: 1 },
    });
    expect(executing).toMatchObject({ status: 'ended', absorbedInto: null, answer: 's6a-absorbed batch answer' });
    const selectionMaterial = selectedMaterial(selection.since, selection.input,
      { title: built.ideas[1]!.title, detail: built.ideas[1]!.detail });

    // The executing round's batch holds the selection whole.
    const executingInput = currentInput(built.executingRequest);
    expect(executingInput).toContain(SECRETARY_STRINGS['secretary.batchedHeading']);
    expect(executingInput).toContain(selectionMaterial);
    // B's round shows the executing round, and through it the absorbed
    // selection, as an earlier round with the idea's title and detail.
    if (built.request === null) throw new Error('S6A: the absorbed-selection builder answered no round on B');
    expect(currentInput(built.request)).toContain(selectionMaterial);
  }, 120_000);
});

describe.each(BACKENDS)('a selection transferred before its round runs (%s)', (backend: S6ABackend) => {
  it('runs the selection round on B, whose current-round section holds the idea\'s title and detail', async () => {
    const world = await openWorld(backend);
    await initializeProject(world);
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    const ideas = threeIdeas('s6a-move-select');
    await world.scripted.script(a, [
      { kind: 'text', text: secretaryAnswer({ body: 'S6A move answer with ideas', ideas }) },
    ]);
    const first = await submitRound(world, newRequest('s6a-move-1', a, 'S6A move question with ideas'));
    await waitForRound(world, first.requestRoot, first.round, 'ended');

    // The selection queues on A and A's driver claims it at once; the claim is
    // held, so the request can move to B before that attempt runs a model
    // request. The claim's own attempt finds another owner when it is let go.
    const claim = world.gates.beforeClaim(a);
    const selected = await world.selectIdea({ commandId: 's6a-move-select', round: first.round, index: 1 });
    const followup = selectionFollowup(selected);
    await claim.reached;
    // B's answer is queued before the route: the route wakes the driver, which may claim the round on B at once.
    await world.scripted.script(b, [{ kind: 'text', text: secretaryAnswer({ body: 'S6A move answer on B' }) }]);
    expect(await world.route({ commandId: 's6a-move-route', round: first.round, to: b }))
      .toMatchObject({ status: 'routed' });
    claim.release();

    const ended = await waitForRound(world, first.requestRoot, followup, 'ended');
    const selection = roundOf(ended, followup);
    expect(ended.owner).toEqual(b.ref);
    expect(selection).toMatchObject({
      status: 'ended', session: b.ref, answer: 'S6A move answer on B',
      input: selectIdeaInputText(1, ideas[1]!.title),
      selectedIdea: { round: first.round, index: 1 },
    });

    // One model request on B, and it is the selection round's: B's
    // current-round section holds the selected idea's title and detail.
    const onB = await world.scripted.requests(b);
    expect(onB).toHaveLength(1);
    const bInput = currentInput(onB[0]!);
    expect(bInput).toContain(taskRoundSlot({ since: selection.since, input: selectIdeaInputText(1, ideas[1]!.title),
      selectedIdea: ideas[1]! }, SECRETARY_ANSWER_FORMAT_V1));
    // A made its own round 1's request only; the claimed attempt it held made none.
    expect(await world.scripted.requests(a)).toHaveLength(1);
  }, 90_000);

  it('runs the executing round on B with the absorbed selection in B\'s batch section', async () => {
    const world = await openWorld(backend);
    await initializeProject(world);
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    const ideas = threeIdeas('s6a-move-batch');
    await world.scripted.script(a, [
      { kind: 'text', text: secretaryAnswer({ body: 'S6A move batch answer with ideas', ideas }) },
    ]);
    const first = await submitRound(world, newRequest('s6a-move-batch-1', a, 'S6A move batch question'));
    await waitForRound(world, first.requestRoot, first.round, 'ended');

    // The executing follow-up is claimed by A's driver and held there; the
    // selection queues behind it, so it joins the executing round's batch.
    const claim = world.gates.beforeClaim(a);
    const executing = await submitRound(world, followUp('s6a-move-batch-2', first.requestRoot,
      'S6A move batch executing input'));
    await claim.reached;
    const selected = await world.selectIdea({ commandId: 's6a-move-batch-select', round: first.round, index: 1 });
    const selectionRef = selectionFollowup(selected);
    // B's answer is queued before the route: the route wakes the driver, which may claim the round on B at once.
    await world.scripted.script(b, [{ kind: 'text', text: secretaryAnswer({ body: 'S6A move batch answer on B' }) }]);
    expect(await world.route({ commandId: 's6a-move-batch-route', round: first.round, to: b }))
      .toMatchObject({ status: 'routed' });
    claim.release();

    const ended = await waitForRound(world, first.requestRoot, executing.round, 'ended');
    expect(roundOf(ended, executing.round)).toMatchObject({
      status: 'ended', session: b.ref, answer: 'S6A move batch answer on B', absorbedInto: null,
    });
    const selection = roundOf(ended, selectionRef);
    expect(selection).toMatchObject({
      status: 'ended', absorbedInto: executing.round, answer: null,
      input: selectIdeaInputText(1, ideas[1]!.title),
      selectedIdea: { round: first.round, index: 1 },
    });

    // One model request on B: the executing round's, whose batch section holds
    // the absorbed selection's title and detail.
    const onB = await world.scripted.requests(b);
    expect(onB).toHaveLength(1);
    const bInput = currentInput(onB[0]!);
    expect(bInput).toContain(taskBatchedSlot([{ since: selection.since, input: selectIdeaInputText(1, ideas[1]!.title),
      selectedIdea: ideas[1]! }]));
    expect(await world.scripted.requests(a)).toHaveLength(1);
  }, 90_000);
});

describe.each(BACKENDS)('rejects: selectIdea (%s)', (backend: S6ABackend) => {
  it('an index outside the answer\'s ideas is invalid and leaves the request unchanged', async () => {
    const world = await openWorld(backend);
    await initializeProject(world);
    const a = await world.createSecretary('a');
    const ideas = threeIdeas('s6a-select-range');
    await world.scripted.script(a, [{ kind: 'text', text: secretaryAnswer({ body: 'S6A range answer', ideas }) }]);
    const first = await submitRound(world, newRequest('s6a-select-range-1', a, 'S6A range question'));
    await waitForRound(world, first.requestRoot, first.round, 'ended');
    const before = await world.readRequest(first.requestRoot);

    expect(await world.selectIdea({ commandId: 's6a-select-range-3', round: first.round, index: 3 }))
      .toEqual({ status: 'rejected', code: 'invalid', reason: 'index is outside the answer ideas' });
    expect(await world.readRequest(first.requestRoot)).toEqual(before);
  }, 90_000);

  it('an answer with no ideas is invalid and leaves the request unchanged', async () => {
    const world = await openWorld(backend);
    await initializeProject(world);
    const a = await world.createSecretary('a');
    await world.scripted.script(a, [{ kind: 'text', text: secretaryAnswer({ body: 'S6A no-idea answer' }) }]);
    const first = await submitRound(world, newRequest('s6a-select-empty-1', a, 'S6A no-idea question'));
    const answered = await waitForRound(world, first.requestRoot, first.round, 'ended');
    expect(roundOf(answered, first.round).ideas).toEqual([]);
    const before = await world.readRequest(first.requestRoot);

    expect(await world.selectIdea({ commandId: 's6a-select-empty', round: first.round, index: 0 }))
      .toEqual({ status: 'rejected', code: 'invalid', reason: 'the answer does not carry 2-3 ideas' });
    expect(await world.readRequest(first.requestRoot)).toEqual(before);
  }, 90_000);

  it('a later answered round makes the selection a revision_conflict and adds no round', async () => {
    const world = await openWorld(backend);
    await initializeProject(world);
    const a = await world.createSecretary('a');
    const built = await buildLaterAnswer(world, { a, tag: 's6a-select-later' });
    const before = await world.readRequest(built.requestRoot);
    expect(before.rounds.map(round => round.ref)).toEqual([built.answered, built.later]);

    expect(await world.selectIdea({ commandId: 's6a-select-later', round: built.answered, index: 1 }))
      .toEqual({ status: 'rejected', code: 'revision_conflict',
        reason: 'the round is no longer the request latest answered round' });
    expect(await world.readRequest(built.requestRoot)).toEqual(before);
  }, 120_000);
});

describe.each(BACKENDS)('M1-07, a newer answer while the selection is held (%s)', (backend: S6ABackend) => {
  it('the released selection is a revision_conflict and the request has no selection round', async () => {
    const world = await openWorld(backend);
    await initializeProject(world);
    const a: S6ASession = await world.createSecretary('a');
    const ideas = threeIdeas('s6a-race');
    await world.scripted.script(a, [
      { kind: 'text', text: secretaryAnswer({ body: 'S6A race answer with ideas', ideas }) },
      { kind: 'text', text: secretaryAnswer({ body: 'S6A race later answer' }) },
    ]);
    const first = await submitRound(world, newRequest('s6a-race-1', a, 'S6A race question with ideas'));
    await waitForRound(world, first.requestRoot, first.round, 'ended');
    const before = await world.readRequest(first.requestRoot);
    expect(before.rounds).toHaveLength(1);

    // The selection's commit waits after its own reads; a newer round of the
    // same request is submitted and answered while it waits.
    const hold = commitBarrier.hold(byIdentityPrefix('request.select_idea:'), 'the selection commit');
    const pending = world.selectIdea({ commandId: 's6a-race-select', round: first.round, index: 1 });
    await hold.reached;
    const newer = await submitRound(world, followUp('s6a-race-2', first.requestRoot, 'S6A race newer round'));
    await waitForRound(world, first.requestRoot, newer.round, 'ended');
    // The newer answer is the request's latest answered round when the held
    // selection reaches the store, so its retry refuses the selection.
    hold.release();
    expect(await pending).toEqual({ status: 'rejected', code: 'revision_conflict',
      reason: 'the round is no longer the request latest answered round' });

    const after = await world.readRequest(first.requestRoot);
    expect(after.rounds.map(round => round.ref)).toEqual([first.round, newer.round]);
    expect(after.rounds.every(round => round.selectedIdea === null)).toBe(true);
    // One model request per round: the refused selection made none.
    expect(await world.scripted.requests(a)).toHaveLength(2);
  }, 120_000);
});
