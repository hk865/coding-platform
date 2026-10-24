/**
 * R-09 (spec §5.2, book §3.6 items 6 and 8, §3.7 item 7): a round whose result is
 * unknown, and a Host whose request queues are unarmed at start.
 *
 * First row: a request round that started a Kernel tool call and got no result
 * when the Host crashed. The start-up reconcile proves the Run has no terminal
 * (QRR-05) and only observes it: the round reads `unknown`, it is never rerun
 * (the new Host's model calls are 0, and the abandoned Host's own are counted),
 * and the unknown round holds no `secretary-intake`, so a new request to the
 * same secretary takes the key and queues on that line.
 *
 * Second row: `automation.resumeOnStartup` off (through `automation/save`). The
 * Host's start-up reconcile runs and its commits start nothing: the queues stay
 * unarmed and the queued round is still where `requests/submit` left it, with 0
 * model calls on the new Host, until a `requests/submit` command wakes the
 * workspace and the round runs.
 *
 * Third row: a round run to its terminal state holds no `secretary-intake`
 * either. After the Host reopens on the same directory the answered round still
 * reads ended with its answer, and a new request to the same secretary takes
 * the key and queues on that line.
 *
 * Every world is SQLite (each restarts the Host), and each builds the old Host's
 * state with the request driver OFF through the public manual Query steps
 * (`queries/claim`, `queries/prepare`, `queries/start`). The first row's crash
 * gives the new Host the driver; the second crashes it with the driver on while
 * the Kernel entry is held, so the start commit has landed and the abandoned
 * Host has nothing running but that one held step — an abandoned Host keeps its
 * loops, so a Host whose loop ran freely could still write after the crash. The
 * third row's round is complete, so it reopens the Host and keeps the driver
 * off: nothing runs on its own, and the new request waits where its command
 * left it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { claimWithSecretaryProfile } from '../helpers/request-claim-steps.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

// The frozen commit barrier (tests/helpers/S6A-commit-barrier.ts): the two
// `vi.mock`s every host-world file that uses the fixture's gates installs.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
  expect(left).toEqual([]);
});

function remember(world: S6AHostWorld): S6AHostWorld {
  worlds.push(world);
  return world;
}

const body = (input: unknown): { scope: typeof S6A_SCOPE; input: unknown } => ({ scope: S6A_SCOPE, input });

/** A semantic answer body: the v2 answer format's JSON, as the scripted model writes it. */
const answerText = (text: string): string =>
  JSON.stringify({ schemaVersion: 1, body: text, ideas: [], goalCardDrafts: [] });

function queued(result: RequestSubmitResultV1): { requestRoot: QueryJobRef; round: QueryJobRef } {
  if (result.status !== 'queued') throw new Error(`S6A: the request was not queued: ${JSON.stringify(result)}`);
  return { requestRoot: result.requestRoot, round: result.round };
}

/** `queries/prepare` of the claimed round. */
async function prepareStep(world: S6AHostWorld, round: QueryJobRef): Promise<PreparedQueryExecution> {
  const read = (await world.post('queries/prepare', body({
    queryRunRef: (await readQuery(world.ag2b, round)).run.ref, requestId: `s6a-unknown-prepare-${round.queryJobId}`,
  }))).body as ReadResult<PreparedQueryExecution>;
  if (read.status !== 'ready') throw new Error(`S6A: the Query was not prepared: ${JSON.stringify(read)}`);
  return read.value;
}

/**
 * `queries/start` of the prepared round, not awaited: a held step (the Kernel
 * entry, a tool call) keeps the route pending until the world releases it.
 */
function start(world: S6AHostWorld, prepared: PreparedQueryExecution, requestId: string): Promise<unknown> {
  return world.post('queries/start', body({ prepared, consumerId: 'ag2b-consumer', requestId }))
    .then(answer => answer.body, () => undefined);
}

describe('R-09, a round whose result is unknown across a restart (sqlite)', () => {
  it('reads unknown, never reruns, and leaves the intake free for a new request', async () => {
    const world = remember(await openS6AHostWorld({ backend: 'sqlite' }));
    await ensureProjectPointers(world);
    const a = await world.createSecretary('a');
    // The first model call starts a real tool and gets no result before the
    // crash; the second reply exists so a rerun would be visible as one.
    await world.scripted.script(a, [
      { kind: 'calls', calls: [{ callId: 's6a-unknown-list', name: 'list_files', args: { prefix: '.' } }] },
      { kind: 'text', text: answerText('S6A rerun answer') },
    ]);

    // The driver is off in the old Host: the test drives claim, prepare and start.
    const submitted = queued(await world.submit({ commandId: 's6a-unknown-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A unknown request' }));
    const tool = await world.gates.toolCall(a, 'list_files');
    expect(await claimWithSecretaryProfile(world, submitted.round, a, `s6a-unknown-claim-${submitted.round.queryJobId}`))
      .toMatchObject({ status: 'committed' });
    const started = start(world, await prepareStep(world, submitted.round), 's6a-unknown-start');
    await tool.reached;
    // The Kernel started the call and the call has no result.
    expect(await world.scripted.requests(a)).toHaveLength(1);

    // The crash gives the new Host the driver; its reconcile settles the Run as
    // unknown (QRR-05) and never starts it again.
    await world.crash({ extraHostOptions: { requestDriver: 'on' } });
    const view = await world.waitForRequest(submitted.requestRoot,
      current => current.rounds[0]?.status === 'unknown', 'the round reads unknown');
    expect(view.rounds).toHaveLength(1);
    expect(view.rounds[0]).toMatchObject({ ref: submitted.round, kind: 'request', status: 'unknown', input: 'S6A unknown request',
      answer: null, session: a.ref, absorbedInto: null });
    expect(view.owner).toEqual(a.ref);
    // Nothing reran: the Session's one request is the old Host's, the world
    // model was never called and the abandoned Host started no model call.
    expect(await world.scripted.requests(a)).toHaveLength(1);
    expect(await world.scripted.pending(a)).toBe(1);
    expect(world.model.requests).toHaveLength(0);
    expect(world.scripted.abandonedCalls()).toEqual([]);

    // An unknown round holds no `secretary-intake`: a new request to the same
    // secretary takes the key and queues on that line.
    const next = await world.submit({ commandId: 's6a-unknown-2', goalId: S6A_GOAL_1.goalId, text: 'S6A next request',
      recipient: a });
    expect(next).toMatchObject({ status: 'queued', assignment: 'assigned', created: false, waitReason: null });
    if (next.status !== 'queued') throw new Error(`S6A: the second request was refused: ${JSON.stringify(next)}`);
    expect(next.secretary).toEqual(a.ref);
    const nextView = await world.readRequest(next.requestRoot);
    expect(nextView).toMatchObject({ owner: a.ref, ownerState: 'owned', assignment: 'assigned' });
    expect(nextView.rounds).toHaveLength(1);
    expect(nextView.rounds[0]).toMatchObject({ ref: next.round, status: 'queued', input: 'S6A next request',
      assignedSession: a.ref });
    // The unknown round is still the only round of its own request, unchanged.
    expect((await world.readRequest(submitted.requestRoot)).rounds).toMatchObject([
      { ref: submitted.round, status: 'unknown', answer: null },
    ]);
    // The unknown attempt's occupancy keeps the line from taking a second run.
    expect(await world.scripted.requests(a)).toHaveLength(1);
    void started;
  }, 120_000);
});

describe('R-09, a restart with resumeOnStartup off (sqlite)', () => {
  it('starts nothing until a request command wakes the workspace', async () => {
    const world = remember(await openS6AHostWorld({ backend: 'sqlite' }));
    await ensureProjectPointers(world);
    await world.setResumeOnStartup(false);
    const a = await world.createSecretary('a');
    await world.scripted.script(a, [
      { kind: 'text', text: answerText('S6A wake answer one') },
      { kind: 'text', text: answerText('S6A wake answer two') },
    ]);

    // The driver is off in the old Host: the test drives claim, prepare and
    // start. The Kernel entry is held, so the start commit has landed, the
    // Kernel was never entered, and the old Host is abandoned with nothing
    // running but that one held step.
    const submitted = queued(await world.submit({ commandId: 's6a-wake-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A wake one' }));
    expect(await claimWithSecretaryProfile(world, submitted.round, a, `s6a-wake-claim-${submitted.round.queryJobId}`))
      .toMatchObject({ status: 'committed' });
    const prepared = await prepareStep(world, submitted.round);
    const entry = await world.gates.beforeKernel(a);
    const started = start(world, prepared, 's6a-wake-start');
    await entry.reached;
    expect((await world.readRequest(submitted.requestRoot)).rounds.map(round => round.status)).toEqual(['running']);
    expect(await world.scripted.requests(a)).toHaveLength(0);

    await world.crash({ extraHostOptions: { requestDriver: 'on' } });
    // The start-up reconcile ran and its own commit (the never-entered round's
    // new attempt) started nothing: the round is back to a fresh pending round
    // the command left behind, and no model call was made.
    const parked = await world.readRequest(submitted.requestRoot);
    expect(parked.rounds).toHaveLength(1);
    expect(parked.rounds[0]).toMatchObject({ ref: submitted.round, status: 'queued', input: 'S6A wake one',
      answer: null, session: null, absorbedInto: null });
    expect(await world.scripted.requests(a)).toHaveLength(0);
    expect(await world.scripted.pending(a)).toBe(2);
    expect(world.model.requests).toHaveLength(0);
    expect(world.scripted.abandonedCalls()).toEqual([]);

    // A request command in the workspace arms its queues: the parked round runs,
    // with the one reply scripted for its Session. The command is a request to a
    // second secretary, so the parked round is not that command's own follow-up.
    const b = await world.createSecretary('b');
    await world.scripted.script(b, [{ kind: 'text', text: answerText('S6A wake answer two') }]);
    const armed = await world.submit({ commandId: 's6a-wake-2', goalId: S6A_GOAL_1.goalId, text: 'S6A wake two',
      recipient: b });
    expect(armed).toMatchObject({ status: 'queued', assignment: 'assigned' });
    if (armed.status !== 'queued') throw new Error(`S6A: the arming request was refused: ${JSON.stringify(armed)}`);
    const woken = await world.waitForRequest(submitted.requestRoot,
      current => current.rounds[0]?.status === 'ended', 'the parked round ran after the command');
    expect(woken.rounds[0]).toMatchObject({ ref: submitted.round, status: 'ended', answer: 'S6A wake answer one',
      session: a.ref });
    expect(await world.scripted.requests(a)).toHaveLength(1);
    const queuedB = await world.waitForRequest(armed.requestRoot,
      current => current.rounds[0]?.status === 'ended', 'the arming request answered');
    expect(queuedB.rounds[0]).toMatchObject({ ref: armed.round, status: 'ended', answer: 'S6A wake answer two' });
    expect(await world.scripted.requests(b)).toHaveLength(1);
    void started;
  }, 120_000);
});

describe('R-09, a terminal round releases the intake across a reopen (sqlite)', () => {
  it('the answered round stays terminal after a reopen and a new request takes its intake', async () => {
    const world = remember(await openS6AHostWorld({ backend: 'sqlite' }));
    await ensureProjectPointers(world);
    const a = await world.createSecretary('a');
    await world.scripted.script(a, [{ kind: 'text', text: answerText('S6A terminal answer') }]);

    // The driver is off: the test runs the round through the Query routes to its
    // answer, so the round is terminal and nothing is left running.
    const submitted = queued(await world.submit({ commandId: 's6a-terminal-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A terminal request' }));
    expect(await claimWithSecretaryProfile(world, submitted.round, a, `s6a-terminal-claim-${submitted.round.queryJobId}`))
      .toMatchObject({ status: 'committed' });
    const prepared = await prepareStep(world, submitted.round);
    expect(await start(world, prepared, 's6a-terminal-start')).toMatchObject({ status: 'ready' });
    const answered = await world.waitForRequest(submitted.requestRoot,
      current => current.rounds[0]?.status === 'ended', 'the round answers');
    expect(answered.rounds).toHaveLength(1);
    expect(answered.rounds[0]).toMatchObject({ ref: submitted.round, status: 'ended', answer: 'S6A terminal answer',
      session: a.ref, closeCode: null });
    expect(await world.scripted.requests(a)).toHaveLength(1);
    expect(await world.scripted.pending(a)).toBe(0);

    // The round is terminal and nothing runs, so the Host reopens on the same
    // directory; the driver stays off and nothing runs on its own.
    await world.reopen();
    const after = await world.readRequest(submitted.requestRoot);
    expect(after.rounds).toHaveLength(1);
    expect(after.rounds[0]).toMatchObject({ ref: submitted.round, status: 'ended', answer: 'S6A terminal answer',
      session: a.ref, closeCode: null });

    // A terminal round holds no `secretary-intake`: a new request to the same
    // secretary takes the key and queues on that line.
    const next = await world.submit({ commandId: 's6a-terminal-2', goalId: S6A_GOAL_1.goalId,
      text: 'S6A after reopen', recipient: a });
    expect(next).toMatchObject({ status: 'queued', assignment: 'assigned', created: false, waitReason: null });
    if (next.status !== 'queued') throw new Error(`S6A: the request after the reopen was refused: ${JSON.stringify(next)}`);
    expect(next.secretary).toEqual(a.ref);
    const nextView = await world.readRequest(next.requestRoot);
    expect(nextView).toMatchObject({ owner: a.ref, ownerState: 'owned', assignment: 'assigned' });
    expect(nextView.rounds).toHaveLength(1);
    expect(nextView.rounds[0]).toMatchObject({ ref: next.round, status: 'queued', input: 'S6A after reopen',
      assignedSession: a.ref, session: null, answer: null });
    // Nothing ran on its own after the reopen: the new round waits where its
    // command left it, and the one model call is the answered round's.
    expect(await world.scripted.requests(a)).toHaveLength(1);
    expect(await world.scripted.pending(a)).toBe(0);
    expect(world.model.requests).toHaveLength(0);
  }, 120_000);
});
