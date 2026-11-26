/**
 * P2 T13 (p2-frozen.md:328; P2 §2.6, design-frozen.md:263): `failCommitOnce` lets the Answer land and makes the
 * candidate submit throw I/O once; after the Host restart the candidate is written once (the request keeps its
 * rounds, `previous === null`, the same proposal ref/rev). A second restart reads the same candidate back and writes
 * none.
 *
 * SQLite only. `world.crash()` stops the running Host's writes, abandons it and starts a new one on the same store
 * directory (`tests/helpers/S6A-host-fixture.ts`), so only the restart can write the candidate. Lead ruling 11-27
 * (FLK item 7; flkcr.out.md row 11) pins the moment: the row waits until the old Host's first try has thrown and its
 * next try is held before the store, crashes it there, and compares every round id of the request and the candidate's
 * proposal id and revision with the one the old Host tried.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { PreparedCommit } from '../../src/core/record-store/ports.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  initializeProject, newRequest, secretaryAnswer, submitRound, threeIdeas, waitForRound,
} from '../helpers/S6A-history-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close();
});

type PlanForm = {
  stages: unknown[];
  tasks: Record<string, unknown>[];
  assignments: { taskId: string; role: string; instruction: string }[];
  obligations: Record<string, unknown>[];
  taskHierarchy: { parentOf: unknown[] };
  executionDag: { dependsOn: unknown[] };
  taskRelations: unknown[];
  inputRequirements: unknown[];
};

/** A complete v2 plan (one required work Task, the goal gate, one acceptance obligation). */
function planForm(tag: string): PlanForm {
  const work = `${tag}-work`;
  const gate = `${tag}-gate`;
  return {
    stages: [],
    tasks: [
      { taskId: work, title: `${tag} work`, requirementLevel: 'required', taskKind: 'work', disposition: 'active',
        scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: gate, title: `${tag} goal gate`, requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: work, role: S6A_WORK_ROLE.templateId, instruction: `${tag} instruction` }],
    obligations: [{
      obligationId: `${tag}-obligation`, title: `${tag} delivery`, requirementLevel: 'required',
      taskIds: [work, gate],
      verificationRequirements: [{ requirementId: `${tag}-check`, requirementLevel: 'required', kind: 'static',
        description: `${tag} static check` }],
    }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

function planCall(callId: string, summary: string, plan: PlanForm) {
  return { kind: 'calls' as const, calls: [{ callId, name: 'submit_plan_round',
    args: { answerKind: 'plan', summary, plan } }] };
}

type CandidateRead = {
  head: { ref: { proposalId: string }; revision: number } | null;
  status: string | null;
  previous: { ref: { proposalId: string }; revision: number } | null;
};

const candidateOf = async (world: S6AHostWorld, requestRoot: QueryJobRef): Promise<CandidateRead> => ready<CandidateRead>(await world.post('plans/request-candidate',
  plain(S6A_SCOPE, { goalRef: S6A_GOAL_1, requestRef: requestRoot })), 'plans/request-candidate');

async function sleep(ms: number): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, ms));
}

const writesCandidate = (commit: PreparedCommit): boolean =>
  commit.records.some(record => record.schemaId === 'PlanProposal@2');

/** The proposal a candidate commit writes: its id and the revision it writes (1 for a first write). */
function proposalOf(commit: PreparedCommit): { proposalId: string; revision: number } {
  const record = commit.records.find(entry => entry.schemaId === 'PlanProposal@2');
  if (record === undefined) throw new Error('P2-T13: the commit writes no PlanProposal');
  const value = JSON.parse(record.json) as { ref: { proposalId: string } };
  return { proposalId: value.ref.proposalId, revision: record.revision };
}

/** Every round id of the request, in the request's own order. */
async function roundIdsOf(world: S6AHostWorld, requestRoot: QueryJobRef): Promise<string[]> {
  return (await world.readRequest(requestRoot)).rounds.map(round => round.ref.queryJobId);
}

type FailedCandidate = {
  secretary: S6ASession; requestRoot: QueryJobRef; followup: QueryJobRef;
  /** The request's round ids when the old Host had stopped at its candidate retry. */
  rounds: string[];
  /** The candidate the old Host tried again (its first try threw), held before the store. */
  retried: { proposalId: string; revision: number };
  /** Lets the held retry go on; after the crash the crashed Host's store refuses it. */
  releaseRetry(): void;
};

/**
 * A request whose follow-up round's plan Answer lands while the old Host's candidate write fails (FLK item 7): the
 * first candidate commit throws I/O (`failCommitOnce`), and the Host's next try is held before the store, so the old
 * Host is seen to have met the fault and can write no candidate before the row crashes it. A world whose request
 * driver is on.
 */
async function failedCandidateWrite(tag: string): Promise<{ world: S6AHostWorld } & FailedCandidate> {
  const world = await openS6AHostWorld({ backend: 'sqlite', extraHostOptions: { requestDriver: 'on' } });
  worlds.push(world);
  await initializeProject(world);
  const secretary: S6ASession = await world.createSecretary('a');

  await world.scripted.script(secretary, [{ kind: 'text', text: secretaryAnswer({ body: `${tag} ideas`, ideas: threeIdeas(tag) }) }]);
  const first = await submitRound(world, newRequest(`${tag}-request`, secretary, `${tag} question`));
  await waitForRound(world, first.requestRoot, first.round, 'ended');
  const selected = await world.selectIdea({ commandId: `${tag}-select`, round: first.round, index: 1 });
  if (selected.status !== 'queued') throw new Error(`${tag}: the selection was refused: ${JSON.stringify(selected)}`);
  const followup = selected.followupRound;

  await world.scripted.script(secretary, [planCall(`${tag}-plan`, `${tag} summary`, planForm(tag))]);
  const tries = commitBarrier.watch(writesCandidate);
  commitBarrier.failCommitOnce(writesCandidate);
  const retry = commitBarrier.hold(writesCandidate, `${tag}: the old Host's candidate retry`);
  await world.waitForRequest(first.requestRoot, view => {
    const round = view.rounds.find(entry => entry.ref.queryJobId === followup.queryJobId);
    return round !== undefined && round.status !== 'queued' && round.status !== 'running';
  }, `the ${tag} follow-up to end`);
  // The fault fired on the old Host: its first try threw, and its next try is the one held now.
  const retried = proposalOf(await retry.reached);
  expect(tries.commits().map(proposalOf), 'the old Host tried the candidate twice: the failed try and the held one')
    .toEqual([retried, retried]);
  expect((await candidateOf(world, first.requestRoot)).head).toBeNull();
  return { world, secretary, requestRoot: first.requestRoot, followup, retried,
    rounds: await roundIdsOf(world, first.requestRoot), releaseRetry: () => retry.release() };
}

/** Crash the Host held at its candidate retry, then let the retry go: the crashed Host's store refuses it. */
async function crashAtRetry(world: S6AHostWorld, failed: FailedCandidate): Promise<void> {
  await world.crash();
  failed.releaseRetry();
}

/** The request's candidate once a restarted Host wrote it (the start-up reconcile writes it before `crash` returns). */
async function writtenCandidate(world: S6AHostWorld, requestRoot: QueryJobRef): Promise<CandidateRead> {
  let read = await candidateOf(world, requestRoot);
  for (let pass = 0; pass < 40 && read.head === null; pass += 1) {
    await sleep(100);
    read = await candidateOf(world, requestRoot);
  }
  return read;
}

/** The candidate is the one the old Host tried to write (same proposal, first revision, nothing before it). */
function expectRetriedCandidate(read: CandidateRead, failed: FailedCandidate): void {
  expect(read).toMatchObject({ status: 'candidate', previous: null });
  expect({ proposalId: read.head?.ref.proposalId, revision: read.head?.revision }).toEqual(failed.retried);
}

describe('P2 T13: the candidate submit fails once and the restart writes it once', () => {
  it('Answer lands; the candidate commit throws; after the crash one candidate exists with no previous', async () => {
    const { world, ...failed } = await failedCandidateWrite('p2-t13');

    await crashAtRetry(world, failed);
    expectRetriedCandidate(await writtenCandidate(world, failed.requestRoot), failed);

    // The once-only side: the request has the rounds it had, and a second read gives the same candidate.
    expect(await roundIdsOf(world, failed.requestRoot)).toEqual(failed.rounds);
    expectRetriedCandidate(await candidateOf(world, failed.requestRoot), failed);
  }, 300_000);

  it('two restarts: the first writes the candidate, the second reads it back and writes none', async () => {
    const { world, ...failed } = await failedCandidateWrite('p2-t13-twice');

    await crashAtRetry(world, failed);
    expectRetriedCandidate(await writtenCandidate(world, failed.requestRoot), failed);

    await world.crash();
    expectRetriedCandidate(await candidateOf(world, failed.requestRoot), failed);
    expect(await roundIdsOf(world, failed.requestRoot)).toEqual(failed.rounds);
  }, 300_000);

  it('another request holds the same line at the crash; the restart still writes the earlier request\'s candidate', async () => {
    const { world, ...failed } = await failedCandidateWrite('p2-t13-line');
    // Lead ruling 11-27 (FLK item 1): request B takes the same secretary line. Its round is claimed (the line's
    // occupant and last execution) and held before its prepared commit, so no Kernel run of the old Host goes on at
    // the crash.
    const occupied = world.gates.beforePrepared(failed.secretary);
    const other = await submitRound(world, newRequest('p2-t13-line-other', failed.secretary, 'p2-t13-line other question'));
    await occupied.reached;
    expect((await world.readSession(failed.secretary.ref)).record.occupancy, 'B holds the line')
      .toMatchObject({ kind: 'execution', executionRef: { aggregateType: 'QueryRun', queryJobId: other.round.queryJobId } });

    await crashAtRetry(world, failed);
    expectRetriedCandidate(await writtenCandidate(world, failed.requestRoot), failed);
    expect(await roundIdsOf(world, failed.requestRoot)).toEqual(failed.rounds);
  }, 300_000);
});
