/**
 * R-01b (spec R-01): the two ordering keys that decide a secretary pick among
 * idle candidates, and the two usage shapes key (2) reads.
 *
 * Key (1) is "a request round of this goal has run on it" (`ranGoal`, written
 * when a request round enters the Kernel on the Session); key (2) is "a known
 * measured model input before no usage". The row's four secretaries are made
 * with real entered rounds and scripted usage: each candidate's last measured
 * input comes from a model call the fixture's scripted provider reported a
 * usage snapshot for, never from a written usage record. The picks are judged
 * only through the request commands' receipts and `requests/read`.
 *
 * The three ordering rows run with the request driver on: the test scripts a
 * Session's replies, submits the request, and the Host's own loop claims,
 * prepares and starts the round and answers it — the test calls no Query route
 * for it and waits for the Host-reached state through the bounded
 * `requests/read` poll. The request that makes D "ran this goal" first picks
 * A; A's claim commit is held until the person has routed the request to D,
 * so the round runs on D. Each of the first three picks holds the chosen
 * line's claim commit, so its assigned round stays queued and the line stays
 * busy while the next pick is computed; those holds are released only after
 * the fourth pick has been judged.
 *
 * The two restart rows (SQLite only) differ in the old Host's driver. The row
 * that keeps a waiting request across a restart builds the old Host's state with
 * the driver off, through the public Query steps. The assigned-before-claim row
 * runs the old Host with the driver on, because only the drain writes the
 * `assigned` routing round, so it must show before the crash that the old Host
 * has nothing else left to run.
 *
 * Expectations are the row's literals: 100,000 / 500,000 / 80,000, a model
 * window of 625,000 (0.8 × 625,000 = 500,000 is the handoff threshold, so
 * 500,000 is too long and 100,000 and 80,000 are not), and the ordering the
 * spec states for each of the four picks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { readSecretaryHandoffBasis } from '../../src/core/work-graph/tasks/secretary-handoff-basis.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { claimProfile, claimWithSecretaryProfile } from '../helpers/request-claim-steps.js';
import { byIdentityPrefix, commitBarrier, type CommitHold } from '../helpers/S6A-commit-barrier.js';
import {
  ensureProjectPointers, openS6AHostWorld, queryStepCommitOn, usageOf, type S6AHostWorld,
} from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { platformRecordSchemas } from '../state/invariants.js';

// The frozen commit barrier the fixture's gates use (S6A-commit-barrier.ts: the test file owns its two mocks).
// The same pass-through also keeps each real backend, so the basis rows can call the real reader over the
// platform's own store (A3/A4: the real factory, its result unchanged).
const backendBox = vi.hoisted(() => ({ backends: [] as unknown[] }));

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const module = await (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal);
  return { ...module, createInMemoryRecordBackend: (options: Parameters<typeof module.createInMemoryRecordBackend>[0]) => {
    const backend = module.createInMemoryRecordBackend(options);
    backendBox.backends.push(backend);
    return backend;
  } };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const module = await (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal);
  return { ...module, createSqliteRecordBackend: (options: Parameters<typeof module.createSqliteRecordBackend>[0]) => {
    const backend = module.createSqliteRecordBackend(options);
    backendBox.backends.push(backend);
    return backend;
  } };
});

const BACKENDS = ['memory', 'sqlite'] as const;
/** The window the row names: 0.8 × 625,000 = 500,000, so 500,000 is too long and 100,000 is not. */
const WINDOW_TOKENS = 625_000;

const worlds: S6AHostWorld[] = [];
const basisTemp: string[] = [];

afterEach(async () => {
  // A held commit keeps a tracked call open, so the barrier goes first.
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.all(open.map(world => world.close()));
  for (const dir of basisTemp.splice(0)) await rm(dir, { recursive: true, force: true });
  expect(left).toEqual([]);
});

function remember(world: S6AHostWorld): S6AHostWorld {
  worlds.push(world);
  return world;
}

let commandSeq = 0;
function nextId(prefix: string): string {
  return `s6a-r1b-${prefix}-${++commandSeq}`;
}

// ------------------------------------------------------------------------ //
// The too-long basis on the platform's real store                           //
// ------------------------------------------------------------------------ //

/** The store surface the basis reader declares; a backend's real `records` is one. */
type BasisStore = Pick<GoalRecordTransactionPort, 'readMany'> & RecordOrderedLookupPort;

/** The real backend the current world built (A3/A4: captured, never replaced). */
function latestBackend(): BasisStore {
  const backend = backendBox.backends[backendBox.backends.length - 1] as
    { records: BasisStore } | undefined;
  if (backend === undefined) throw new Error('S6B2 basis: no record backend was captured');
  return backend.records;
}

/** A real store with no commit at all: only then is the ordered read's watermark `null`. */
async function openEmptyLedger(backend: 'memory' | 'sqlite'): Promise<{ records: BasisStore; close(): Promise<void> }> {
  const schemas = platformRecordSchemas();
  if (backend === 'memory') {
    const built = createInMemoryRecordBackend({ schemas });
    return { records: built.records as unknown as BasisStore, close: () => built.close() };
  }
  const dir = await mkdtemp(join(tmpdir(), 's6b2-basis-'));
  basisTemp.push(dir);
  const built = createSqliteRecordBackend({ path: join(dir, 'records.sqlite'), schemas });
  return { records: built.records as unknown as BasisStore, close: () => built.close() };
}

async function basisOf(
  records: Pick<RecordOrderedLookupPort, 'lookupOrdered'>, session: SessionRef,
  contextWindowTokens = WINDOW_TOKENS,
) {
  const read = await readSecretaryHandoffBasis(records, S6A_SCOPE, session, contextWindowTokens);
  if (read.status !== 'ready') throw new Error(`S6B2 basis: ${JSON.stringify(read)}`);
  return read.value;
}

/** The last page's watermark the real read saw; `null` only for the empty ledger. */
type WatermarkWatch = { read: CommitCursor | null | undefined };

/**
 * A3/A2 wrapper over the real ordered read: it records the real watermark, or at a named point answers a throw, a
 * failed page or a page whose real first record is damaged. No value is built and no state changes.
 */
function wrappedBasis(
  records: BasisStore, watch: WatermarkWatch, mode: 'real' | 'throw' | 'failed_page' | 'damaged' = 'real',
): Pick<RecordOrderedLookupPort, 'lookupOrdered'> {
  return {
    async lookupOrdered(request) {
      if (mode === 'throw') throw new Error('S6B2 basis: the ordered read threw');
      if (mode === 'failed_page') {
        return { status: 'rejected', code: 'unavailable', reason: 'S6B2 basis: the ordered page failed' };
      }
      const page = await records.lookupOrdered(request);
      if (page.status !== 'ready') return page;
      watch.read = page.value.readThrough;
      if (mode === 'damaged' && page.value.records.length > 0) {
        const [head, ...rest] = page.value.records;
        return { status: 'ready', value: { ...page.value,
          records: [{ ...head!, json: '{"not":"a QueryRun"' }, ...rest] } };
      }
      return page;
    },
  };
}

/** The run's execution state; a stored run without one is the row's own failure. */
function executionStateOf(query: Awaited<ReturnType<typeof readQuery>>) {
  const state = query.run.run.executionState;
  if (state === undefined) throw new Error('S6B2 basis: the stored run has no execution state');
  return state;
}

type QueuedSubmit = Extract<Awaited<ReturnType<S6AHostWorld['submit']>>, { status: 'queued' }>;

/** A submitted request whose round the Host runs; a refusal is the row's own failure, not a state to work around. */
function queuedOrThrow(result: Awaited<ReturnType<S6AHostWorld['submit']>>): QueuedSubmit {
  if (result.status !== 'queued') throw new Error(`S6A: the submit was refused: ${JSON.stringify(result)}`);
  return result;
}

async function submitOrThrow(
  world: S6AHostWorld,
  input: { goalId: string | null; text: string; continues?: QueryJobRef | null; recipient?: S6ASession | null },
): Promise<QueuedSubmit> {
  return queuedOrThrow(await world.submit({ commandId: nextId('submit'), text: input.text, goalId: input.goalId,
    continues: input.continues ?? null, recipient: input.recipient ?? null }));
}

/**
 * The claim step of a request round the test advances itself: a driver-off old
 * Host leaves its rounds where the command put them, so the public steps are
 * the caller's. The profile and the pinning come from the shared claim helper.
 */
async function claimStep(world: S6AHostWorld, round: QueryJobRef, session: S6ASession): Promise<void> {
  const answer = await claimWithSecretaryProfile(world, round, session, nextId(`claim-${session.label}`));
  expect(answer, JSON.stringify(answer)).toMatchObject({ status: 'committed' });
}

/** `queries/prepare` of a claimed round; the row's one private prepare wrapper (route only). */
async function prepareStep(world: S6AHostWorld, round: QueryJobRef): Promise<PreparedQueryExecution> {
  const { run } = await readQuery(world.ag2b, round);
  const answer = await world.post('queries/prepare', plain(S6A_SCOPE, {
    queryRunRef: run.ref, requestId: nextId('prepare'),
  }));
  const prepared = answer.body as ReadResult<PreparedQueryExecution>;
  if (prepared.status !== 'ready') throw new Error(`S6A: the prepare was not ready: ${JSON.stringify(prepared)}`);
  return prepared.value;
}

/**
 * `queries/start` of a prepared round, under the published secretary profile's
 * consumer. Not awaited where a gate holds the Kernel: the route answers only
 * after the held step goes on.
 */
async function startStep(world: S6AHostWorld, session: S6ASession, prepared: PreparedQueryExecution): Promise<unknown> {
  const consumerId = (await claimProfile(world, S6A_SECRETARY_PROFILE_ID))['consumerId'];
  return await world.post('queries/start', plain(S6A_SCOPE, {
    prepared, consumerId, requestId: nextId(`start-${session.label}`),
  })).then(answer => answer.body, () => undefined);
}

/** One plain Query on the line whose one model call reports `inputTokens` (`null` = it reports no usage). */
async function runQueryWithUsage(
  world: S6AHostWorld, session: S6ASession, inputTokens: number | null,
): Promise<Awaited<ReturnType<S6AHostWorld['occupy']>>> {
  await world.scripted.script(session, [{ kind: 'text', text: `S6A usage ${inputTokens ?? 'none'}`,
    ...(inputTokens === null ? {} : { usage: usageOf(inputTokens) }) }]);
  const refs = await world.occupy(session);
  await world.finishQuery(refs);
  return refs;
}

/** A semantic answer body: the v2 answer format's JSON, as the scripted model writes it. */
function answerBodyOf(body: string): string {
  return JSON.stringify({ schemaVersion: 1, body, ideas: [], goalCardDrafts: [] });
}

/** The routing rounds of one request view (the view exposes the round's kind, not its reason). */
const routingRounds = (view: RequestCoreViewV1) => view.rounds.filter(round => round.kind === 'routing');

/**
 * A secretary round that ends too long starts the automatic handoff (6B-2 L10, `book-6b.md` §3.2 item 1), whose
 * first commit is its accept. A row that judges picks over a line that is still too long holds that accept for the
 * whole row (the state between the round's end and the handoff) and lets it go at the row's end.
 */
function holdAutomaticHandoff(label: string): CommitHold {
  return commitBarrier.hold(byIdentityPrefix('handoff.accept:'), `the automatic handoff accept of ${label}`);
}

/**
 * The bounded public wait for a request's one round to end with the answer its
 * scripted reply carries: the Host reaches the end on its own.
 */
async function waitRoundEnded(
  world: S6AHostWorld, requestRoot: QueryJobRef, round: QueryJobRef, answer: string,
): Promise<RequestCoreViewV1> {
  const view = await world.waitForRequest(requestRoot, current => current.rounds[0]?.status === 'ended',
    `the round ${round.queryJobId} ends`);
  expect(view.rounds[0]).toMatchObject({ ref: round, status: 'ended', answer });
  return view;
}

describe.each(BACKENDS)('R-01b secretary selection usage (%s)', backend => {
  it('orders by ran-this-goal then known-not-too-long, and opens a line when nobody is free', async () => {
    const world = remember(await openS6AHostWorld({ backend, secretaryBudget: { contextWindowTokens: WINDOW_TOKENS },
      extraHostOptions: { requestDriver: 'on' } }));
    // Both pointers present: a Secretary round is the ordinary one, whose answer this row
    // scripts, not the initial-planning branch.
    await ensureProjectPointers(world);
    // C's too-long round starts the automatic handoff; its accept is held, so C keeps no successor in this row.
    const handoffOfC = holdAutomaticHandoff('c');
    // C: 500,000 = too long for this window; it never becomes a candidate. Its measured
    // input comes from its own entered round (0.8 × 625,000 = 500,000 is the threshold).
    const c = await world.createSecretary('c', { at: '2026-10-23T09:30:00.000Z' });
    await world.scripted.script(c, [{ kind: 'text', text: answerBodyOf('S6A C goal-1 answer'),
      usage: usageOf(500_000) }]);
    const cRound = await submitOrThrow(world, { goalId: S6A_GOAL_1.goalId, text: 'S6A C goal-1 round' });
    expect(cRound).toMatchObject({ assignment: 'assigned', secretary: c.ref });
    await waitRoundEnded(world, cRound.requestRoot, cRound.round, 'S6A C goal-1 answer');
    expect(await world.scripted.requests(c)).toHaveLength(1);
    // B: 80,000 known, never ran goal 1, created first (the oldest activity).
    const b = await world.createSecretary('b', { at: '2026-10-23T08:00:00.000Z' });
    await runQueryWithUsage(world, b, 80_000);
    // A: 100,000 known, created at 10:00; it runs a goal-1 round whose reply reports no
    // usage, so its last known input stays 100,000.
    const a = await world.createSecretary('a', { at: '2026-10-23T10:00:00.000Z' });
    await runQueryWithUsage(world, a, 100_000);
    await world.scripted.script(a, [{ kind: 'text', text: answerBodyOf('S6A A goal-1 answer') }]);
    const aRound = await submitOrThrow(world, { goalId: S6A_GOAL_1.goalId, text: 'S6A A goal-1 round' });
    expect(aRound).toMatchObject({ assignment: 'assigned', secretary: a.ref });
    await waitRoundEnded(world, aRound.requestRoot, aRound.round, 'S6A A goal-1 answer');
    // D: no measured input at all, created at 11:00 — later than A, so only key (2) can put
    // A before it. A person routes the next request's round to D, and the round enters on D:
    // that is D's "ran this goal", with no measured input.
    const d = await world.createSecretary('d', { at: '2026-10-23T11:00:00.000Z' });
    await world.scripted.script(d, [{ kind: 'text', text: answerBodyOf('S6A D goal-1 answer') }]);
    // A's claim of the picked round is held, so the round is still A's queued round when
    // the person routes it.
    const heldOnA = world.gates.beforeClaim(a);
    const routedRound = await submitOrThrow(world, { goalId: S6A_GOAL_1.goalId, text: 'S6A D goal-1 round' });
    // A is the only secretary that has run goal 1, so the submit picks it before the route.
    expect(routedRound).toMatchObject({ assignment: 'assigned', secretary: a.ref });
    await heldOnA.reached;
    expect(await world.route({ commandId: nextId('route-d'), round: routedRound.round, to: d }))
      .toMatchObject({ status: 'routed', routingRound: expect.any(Object) });
    // The held claim on A goes on; the round runs on D, the request's owner now.
    heldOnA.release();
    await waitRoundEnded(world, routedRound.requestRoot, routedRound.round, 'S6A D goal-1 answer');
    expect(await world.scripted.requests(d)).toHaveLength(1);

    // Every candidate is idle and not too long: A (ran goal 1, known not too long) before
    // D (ran goal 1, no usage) by key (2); B never ran goal 1, so key (1) puts it last.
    // The claim gate holds A's claim of the assigned round, so A's line stays busy.
    await world.scripted.script(a, [{ kind: 'text', text: answerBodyOf('S6A A pick 1 answer') }]);
    const firstGate = world.gates.beforeClaim(a);
    const first = await submitOrThrow(world, { goalId: S6A_GOAL_1.goalId, text: 'S6A R-01b pick 1' });
    expect(first).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: a.ref,
      created: false, waitReason: null });
    await firstGate.reached;
    const firstView = await world.readRequest(first.requestRoot);
    expect(firstView).toMatchObject({ assignment: 'assigned', owner: a.ref, ownerState: 'owned', waitReason: null });
    expect(firstView.rounds).toHaveLength(1);
    expect(firstView.rounds[0]).toMatchObject({ kind: 'request', status: 'queued', assignedSession: a.ref });

    // A is busy (its round waits): D (ran goal 1, no usage) before B (never ran goal 1,
    // 80,000 known) — key (1) outranks key (2). D's claim gate holds its line busy.
    await world.scripted.script(d, [{ kind: 'text', text: answerBodyOf('S6A D pick 2 answer') }]);
    const secondGate = world.gates.beforeClaim(d);
    const second = await submitOrThrow(world, { goalId: S6A_GOAL_1.goalId, text: 'S6A R-01b pick 2' });
    expect(second).toMatchObject({ assignment: 'assigned', secretary: d.ref, created: false });
    await secondGate.reached;
    expect((await world.readRequest(second.requestRoot)).owner).toEqual(d.ref);

    // A and D are busy and C is too long: B is the only idle candidate left. B's claim gate
    // holds its line busy as well.
    await world.scripted.script(b, [{ kind: 'text', text: answerBodyOf('S6A B pick 3 answer') }]);
    const thirdGate = world.gates.beforeClaim(b);
    const third = await submitOrThrow(world, { goalId: S6A_GOAL_1.goalId, text: 'S6A R-01b pick 3' });
    expect(third).toMatchObject({ assignment: 'assigned', secretary: b.ref, created: false });
    await thirdGate.reached;

    // Every line busy or too long, and the open cap does not hold (no cap set): a new
    // project-scope secretary line takes it. The line's Session exists before the submit's
    // intake commit, so the reply is scripted while that commit is held and the new round
    // has its answer before the Host can run it.
    const intake = commitBarrier.hold(byIdentityPrefix('request.submit:'), 'the opened line intake');
    const fourthPosted = world.submit({ commandId: nextId('submit'), goalId: S6A_GOAL_1.goalId,
      text: 'S6A R-01b pick 4', continues: null, recipient: null });
    await intake.reached;
    const known = [a.ref.sessionId, b.ref.sessionId, c.ref.sessionId, d.ref.sessionId];
    const openedCards = (await world.listSessions()).filter(card => !known.includes(card.record.ref.sessionId));
    expect(openedCards).toHaveLength(1);
    const openedCard = openedCards[0]!;
    const openedLine: S6ASession = { label: 'opened-line',
      ref: { projectId: openedCard.record.ref.projectId, sessionId: openedCard.record.ref.sessionId },
      aggregateRef: openedCard.record.ref, role: openedCard.record.role, createdAt: openedCard.record.createdAt };
    await world.scripted.script(openedLine, [{ kind: 'text', text: answerBodyOf('S6A opened line answer') }]);
    intake.release();
    const fourth = queuedOrThrow(await fourthPosted);
    expect(fourth).toMatchObject({ status: 'queued', assignment: 'assigned', created: true, waitReason: null });
    if (fourth.assignment !== 'assigned') throw new Error('S6A: the fourth submit is not assigned');
    expect(fourth.secretary.sessionId).toBe(openedLine.ref.sessionId);
    expect(known).not.toContain(fourth.secretary.sessionId);
    expect((await world.readSession(fourth.secretary)).record.role)
      .toEqual({ kind: 'legacy_template', templateId: 'platform-secretary', templateRevision: 's3.1' });
    expect((await world.readRequest(fourth.requestRoot)).owner).toEqual(fourth.secretary);
    // C is never picked anywhere in the row: its 500,000 makes it too long, not merely busy.
    expect([first, second, third].map(pick => pick.assignment === 'assigned' ? pick.secretary.sessionId : null))
      .not.toContain(c.ref.sessionId);

    // The three held claims are let go now: each held line's round runs to its answer, and
    // the opened line's round runs the same way.
    firstGate.release();
    secondGate.release();
    thirdGate.release();
    await waitRoundEnded(world, first.requestRoot, first.round, 'S6A A pick 1 answer');
    await waitRoundEnded(world, second.requestRoot, second.round, 'S6A D pick 2 answer');
    await waitRoundEnded(world, third.requestRoot, third.round, 'S6A B pick 3 answer');
    await waitRoundEnded(world, fourth.requestRoot, fourth.round, 'S6A opened line answer');
    expect(await world.scripted.requests(a)).toHaveLength(3);
    expect(await world.scripted.requests(b)).toHaveLength(2);
    expect(await world.scripted.requests(d)).toHaveLength(2);
    handoffOfC.release();
  }, 120_000);

  it('reads a Run whose last model request reported no usage as its last known input', async () => {
    const world = remember(await openS6AHostWorld({ backend,
      secretaryBudget: { contextWindowTokens: WINDOW_TOKENS },
      extraHostOptions: { requestDriver: 'on', secretaryOpenCap: 1 } }));
    await ensureProjectPointers(world);
    const p = await world.createSecretary('p');
    // P's too-long round starts the automatic handoff; its accept is held, so P keeps no successor in this row.
    const handoffOfP = holdAutomaticHandoff('p');
    // One Run, two model requests: the second-to-last reported 500,000, the last none. A
    // round whose reply calls a real tool asks the model again, so the Run has two requests.
    // Both replies are scripted before the submit; the Host's driver runs the round.
    await world.scripted.script(p, [
      { kind: 'calls', calls: [{ callId: 's6a-r1b-read', name: 'read', args: { path: 'src/module.ts' } }],
        usage: usageOf(500_000) },
      { kind: 'text', text: answerBodyOf('S6A second-request answer') },
    ]);
    const round = await submitOrThrow(world, { goalId: S6A_GOAL_1.goalId, text: 'S6A two-request round' });
    expect(round).toMatchObject({ assignment: 'assigned', secretary: p.ref });
    await waitRoundEnded(world, round.requestRoot, round.round, 'S6A second-request answer');
    expect(await world.scripted.requests(p)).toHaveLength(2);

    // The run's last known input is 500,000, so the only line is too long and the cap is
    // reached: the request waits unassigned instead of opening a second line.
    const submitted = await submitOrThrow(world, { goalId: S6A_GOAL_1.goalId, text: 'S6A last-known usage' });
    expect(submitted).toMatchObject({ status: 'queued', assignment: 'unassigned', secretary: null,
      created: false, waitReason: 'secretary_open_cap' });
    const view = await world.readRequest(submitted.requestRoot);
    expect(view).toMatchObject({ assignment: 'unassigned', owner: null, ownerState: 'waiting',
      waitReason: 'secretary_open_cap', processing: true });
    expect(view.rounds).toHaveLength(1);
    expect(view.rounds[0]).toMatchObject({ kind: 'request', status: 'queued', assignedSession: null });
    handoffOfP.release();
  }, 120_000);

  it('counts a measured input many runs old, after runs that report none', async () => {
    const world = remember(await openS6AHostWorld({ backend,
      secretaryBudget: { contextWindowTokens: WINDOW_TOKENS },
      extraHostOptions: { requestDriver: 'on', secretaryOpenCap: 1 } }));
    await ensureProjectPointers(world);
    const q = await world.createSecretary('q');
    // Q's too-long round starts the automatic handoff; its accept is held, so Q stays live and keeps no successor.
    const handoffOfQ = holdAutomaticHandoff('q');
    await world.scripted.script(q, [{ kind: 'text', text: answerBodyOf('S6A old-usage answer'),
      usage: usageOf(500_000) }]);
    const round = await submitOrThrow(world, { goalId: S6A_GOAL_1.goalId, text: 'S6A old-usage round' });
    expect(round).toMatchObject({ assignment: 'assigned', secretary: q.ref });
    await waitRoundEnded(world, round.requestRoot, round.round, 'S6A old-usage answer');
    for (let index = 0; index < 3; index += 1) await world.finishQuery(await world.occupy(q));
    // Only the first Run was answered from the line's own script; the three later Runs
    // report no usage, and the selection still reads the 500,000 behind them.
    expect(await world.scripted.requests(q)).toHaveLength(1);

    const submitted = await submitOrThrow(world, { goalId: S6A_GOAL_1.goalId, text: 'S6A old usage' });
    expect(submitted).toMatchObject({ status: 'queued', assignment: 'unassigned', secretary: null,
      created: false, waitReason: 'secretary_open_cap' });
    const view = await world.readRequest(submitted.requestRoot);
    expect(view).toMatchObject({ assignment: 'unassigned', owner: null, ownerState: 'waiting',
      waitReason: 'secretary_open_cap' });
    expect(view.rounds[0]).toMatchObject({ kind: 'request', status: 'queued', assignedSession: null });
    handoffOfQ.release();
  }, 120_000);
});

describe.each(BACKENDS)('the too-long basis on the real store (%s)', backend => {
  const openBasisWorld = async (label: string) => {
    const world = remember(await openS6AHostWorld({ backend, secretaryBudget: { contextWindowTokens: WINDOW_TOKENS } }));
    return { world, session: await world.createSecretary(label) };
  };
  const expectBasis = async (session: S6ASession, expected: {
    tooLong: boolean; lastInputTokens: number | null; run: QueryRunRef | null; requestIndex: number | null;
  }) => {
    const watch: WatermarkWatch = { read: undefined };
    const basis = await basisOf(wrappedBasis(latestBackend(), watch), session.ref);
    expect(watch.read).not.toBeNull();
    expect(basis).toEqual({ threshold: 500_000, ...expected, readThrough: watch.read });
  };

  it.each([
    { usage: 500_000, tooLong: true },
    { usage: 499_999, tooLong: false },
  ])('reads a $usage input as tooLong=$tooLong and names its run, request and watermark', async ({ usage, tooLong }) => {
    const { world, session } = await openBasisWorld(`basis-${usage}`);
    const refs = await runQueryWithUsage(world, session, usage);
    const query = await readQuery(world.ag2b, refs.queryJobRef);
    expect(executionStateOf(query).requests.map(request => request.inputTokens)).toEqual([usage]);
    await expectBasis(session, { tooLong, lastInputTokens: usage, run: query.run.ref, requestIndex: 0 });
  });

  it('reads a run whose only request reports no usage as null usage plus the real watermark', async () => {
    const { world, session } = await openBasisWorld('basis-no-usage');
    const refs = await runQueryWithUsage(world, session, null);
    const query = await readQuery(world.ag2b, refs.queryJobRef);
    expect(executionStateOf(query).requests.map(request => request.inputTokens)).toEqual([null]);
    await expectBasis(session, { tooLong: false, lastInputTokens: null, run: null, requestIndex: null });
  });

  it('keeps the watermark of a non-empty ledger that holds no QueryRun for the Session', async () => {
    const { session } = await openBasisWorld('basis-no-query');
    // The Session exists and the ledger has its commits, but this line has run no Query.
    await expectBasis(session, { tooLong: false, lastInputTokens: null, run: null, requestIndex: null });
  });

  it('returns a null watermark only for an empty ledger', async () => {
    const store = await openEmptyLedger(backend);
    try {
      const basis = await basisOf(store.records, { projectId: S6A_SCOPE.projectId, sessionId: 's-no-ledger' });
      expect(basis).toEqual({ tooLong: false, threshold: 500_000, lastInputTokens: null, run: null,
        requestIndex: null, readThrough: null });
    } finally {
      await store.close();
    }
  });

  it('reads the newest generation first and, inside it, the last request first', async () => {
    const world = remember(await openS6AHostWorld({ backend, secretaryBudget: { contextWindowTokens: WINDOW_TOKENS },
      extraHostOptions: { requestDriver: 'on' } }));
    await ensureProjectPointers(world);
    const session = await world.createSecretary('basis-order');
    const older = await runQueryWithUsage(world, session, 300_000);
    // A request round runs a model round per reply: 480,000 on the tool-calling request, 500,000 on the last one.
    await world.scripted.script(session, [
      { kind: 'calls', calls: [{ callId: 's6b2-basis-read', name: 'read', args: { path: 'src/module.ts' } }],
        usage: usageOf(480_000) },
      { kind: 'text', text: answerBodyOf('S6B2 basis second request'), usage: usageOf(500_000) },
    ]);
    const round = await submitOrThrow(world, { goalId: S6A_GOAL_1.goalId, text: 'S6B2 basis order round' });
    expect(round).toMatchObject({ assignment: 'assigned', secretary: session.ref });
    await waitRoundEnded(world, round.requestRoot, round.round, 'S6B2 basis second request');
    const olderRead = await readQuery(world.ag2b, older.queryJobRef);
    const newerRead = await readQuery(world.ag2b, round.round);
    expect(executionStateOf(newerRead).requests.map(request => request.inputTokens)).toEqual([480_000, 500_000]);
    expect(executionStateOf(newerRead).sessionGeneration)
      .toBeGreaterThan(executionStateOf(olderRead).sessionGeneration);

    const watch: WatermarkWatch = { read: undefined };
    const basis = await basisOf(wrappedBasis(latestBackend(), watch), session.ref);
    expect(watch.read).not.toBeNull();
    // An oldest-first read would name 300,000; a first-request-first read would name 480,000.
    expect(basis).toEqual({ tooLong: true, threshold: 500_000, lastInputTokens: 500_000,
      run: newerRead.run.ref, requestIndex: 1, readThrough: watch.read });
  });

  it.each([
    { mode: 'throw' as const, what: 'throws' },
    { mode: 'failed_page' as const, what: 'answers a failed page' },
    { mode: 'damaged' as const, what: 'returns an undecodable QueryRun' },
  ])('rejects unavailable when the ordered read $what, never "not too long"', async ({ mode }) => {
    const world = remember(await openS6AHostWorld({ backend, secretaryBudget: { contextWindowTokens: WINDOW_TOKENS } }));
    const session = await world.createSecretary(`basis-${mode}`);
    if (mode === 'damaged') await runQueryWithUsage(world, session, 100_000);
    const watch: WatermarkWatch = { read: undefined };
    const read = await readSecretaryHandoffBasis(wrappedBasis(latestBackend(), watch, mode), S6A_SCOPE,
      session.ref, WINDOW_TOKENS);
    expect(read).toMatchObject({ status: 'rejected', code: 'unavailable' });
  });
});

describe('R-01b secretary selection after a restart (sqlite)', () => {
  it('keeps an unassigned request waiting across a restart, then drains it once when B frees up (SQLite only)',
    async () => {
      // Driver off in the old Host: its two lines are taken by rounds the test advances
      // itself through the public Query steps, and the restart's driver takes over.
      const world = remember(await openS6AHostWorld({ backend: 'sqlite', extraHostOptions: { secretaryOpenCap: 2 } }));
      // Both pointers present: the round the restart's driver runs on B is the ordinary
      // secretary round, whose answer this row scripts.
      await ensureProjectPointers(world);
      // S0's own round runs into a real tool call that gets no result: the line is busy
      // because a model run holds it, not because its last input would be too long.
      const s0 = await world.createSecretary('s0');
      await world.scripted.script(s0, [{ kind: 'calls', calls: [{ callId: 's6a-s0-list', name: 'list_files',
        args: { prefix: '.' } }] }]);
      const s0Round = await submitOrThrow(world, { goalId: S6A_GOAL_1.goalId, text: 'S6A S0 goal-1 round' });
      expect(s0Round).toMatchObject({ assignment: 'assigned', secretary: s0.ref, created: false });
      const tool = await world.gates.toolCall(s0, 'list_files');
      await claimStep(world, s0Round.round, s0);
      const preparedS0 = await prepareStep(world, s0Round.round);
      const startingS0 = startStep(world, s0, preparedS0);
      await tool.reached;
      // The Kernel started the call and the call has no result: S0 is occupied.
      expect(await world.scripted.requests(s0)).toHaveLength(1);
      expect((await world.readRequest(s0Round.requestRoot)).rounds[0])
        .toMatchObject({ status: 'running', session: s0.ref, answer: null });

      // B's own round: claimed, prepared and started, held at the Kernel entry, so the start
      // commit landed and the Kernel was not entered. That takes the second line.
      const b = await world.createSecretary('b');
      await world.scripted.script(b, [
        { kind: 'text', text: answerBodyOf('S6A B goal-1 answer') },
        { kind: 'text', text: answerBodyOf('S6A drained answer') },
      ]);
      const bRound = await submitOrThrow(world, { goalId: S6A_GOAL_1.goalId, text: 'S6A B goal-1 round' });
      expect(bRound).toMatchObject({ assignment: 'assigned', secretary: b.ref, created: false });
      const entry = await world.gates.beforeKernel(b);
      await claimStep(world, bRound.round, b);
      const preparedB = await prepareStep(world, bRound.round);
      const startingB = startStep(world, b, preparedB);
      await entry.reached;
      expect((await world.readRequest(bRound.requestRoot)).rounds[0])
        .toMatchObject({ status: 'running', session: b.ref, answer: null });
      expect(await world.scripted.requests(b)).toHaveLength(0);

      // Both lines are busy and the open cap leaves no line to open: the waiting request
      // stays unassigned.
      const submitted = await submitOrThrow(world, { goalId: S6A_GOAL_1.goalId, text: 'S6A unassigned request' });
      expect(submitted).toMatchObject({ status: 'queued', assignment: 'unassigned', secretary: null,
        created: false, waitReason: 'secretary_open_cap' });
      const waiting = await world.readRequest(submitted.requestRoot);
      expect(waiting).toMatchObject({ assignment: 'unassigned', owner: null, ownerState: 'waiting',
        waitReason: 'secretary_open_cap' });
      expect(waiting.rounds).toHaveLength(1);
      expect(waiting.rounds[0]).toMatchObject({ kind: 'request', status: 'queued', assignedSession: null });

      // Nothing of the old Host runs on but the two held steps: the tool call and the Kernel
      // entry. B's round keeps its line: the restart's driver claims the new attempt at the
      // Host's start, so that claim is held from before the crash and the row can read the
      // waiting request while both lines are busy.
      const newClaim = commitBarrier.hold(queryStepCommitOn('claimed', b.ref), 'the claim of B new attempt');
      await world.crash({ extraHostOptions: { requestDriver: 'on', secretaryOpenCap: 2 } });

      // S0's tool call had no result when the Host was abandoned: the start-up reconcile
      // proves the Run has no terminal (QRR-05), reads it `unknown`, and the attempt keeps
      // the line occupied — so the waiting request still finds no free line.
      const recovered = await world.readRequest(s0Round.requestRoot);
      expect(recovered.rounds).toHaveLength(1);
      expect(recovered.rounds[0]).toMatchObject({ ref: s0Round.round, status: 'unknown', answer: null });
      expect((await world.readSession(s0)).record.occupancy).not.toBeNull();
      // B's start committed and the Kernel was never entered: the reconcile leaves the round
      // for a new attempt (QRR-02), and the new Host's driver has claimed it (held above).
      await newClaim.reached;
      const stillWaiting = await world.readRequest(submitted.requestRoot);
      expect(stillWaiting).toMatchObject({ assignment: 'unassigned', owner: null, ownerState: 'waiting',
        waitReason: 'secretary_open_cap' });
      expect(stillWaiting.rounds).toHaveLength(1);
      expect(stillWaiting.rounds[0]).toMatchObject({ kind: 'request', status: 'queued', assignedSession: null });
      expect(routingRounds(stillWaiting)).toHaveLength(0);

      // The claim is let go: B's round runs to its answer, and the drain hands the waiting
      // request to the line that just became free — once.
      newClaim.release();
      const bEnded = await world.waitForRequest(bRound.requestRoot,
        current => current.rounds.every(current => current.status === 'ended'), 'B goal-1 round ends');
      expect(bEnded.rounds[0]).toMatchObject({ ref: bRound.round, status: 'ended', answer: 'S6A B goal-1 answer',
        session: b.ref });
      const assigned = await world.waitForRequest(submitted.requestRoot,
        view => view.assignment === 'assigned' && view.owner?.sessionId === b.ref.sessionId,
        'the drain assigns the waiting request to B once B is free');
      expect(assigned).toMatchObject({ assignment: 'assigned', owner: b.ref, ownerState: 'owned', waitReason: null });
      expect(routingRounds(assigned)).toHaveLength(1);
      // The queued round keeps the assignment it was written with; the routing round carries the owner.
      expect(assigned.rounds[0]).toMatchObject({ kind: 'request', assignedSession: null });
      const drained = await world.waitForRequest(submitted.requestRoot,
        view => view.rounds[0]?.status === 'ended', 'the drained round runs on B');
      expect(drained.rounds[0]).toMatchObject({ ref: submitted.round, kind: 'request', status: 'ended',
        answer: 'S6A drained answer', assignedSession: null, session: b.ref, absorbedInto: null });
      void startingS0;
      void startingB;
    }, 180_000);

  it('runs one execution round for both inputs when it restarts between assigned and the claim (SQLite only)',
    async () => {
      const world = remember(await openS6AHostWorld({ backend: 'sqlite',
        extraHostOptions: { requestDriver: 'on', secretaryOpenCap: 2 } }));
      // The project's two pointers through their governance: the merged round is the ordinary
      // secretary round (not the initial-coordination branch), so its scripted answer is valid.
      await ensureProjectPointers(world);
      const s0 = await world.createSecretary('s0');
      const b = await world.createSecretary('b');
      // The two plain Queries are the only work besides the request; both are full lines, so
      // the two inputs wait unassigned.
      const s0Query = await world.occupy(s0);
      const bQuery = await world.occupy(b);

      const first = await submitOrThrow(world, { goalId: S6A_GOAL_1.goalId, text: 'S6A two-input request' });
      expect(first).toMatchObject({ assignment: 'unassigned', secretary: null, created: false,
        waitReason: 'secretary_open_cap' });
      const second = await submitOrThrow(world, { goalId: null, text: 'S6A second input',
        continues: first.round });
      expect(second).toMatchObject({ status: 'queued', assignment: 'unassigned', secretary: null,
        waitReason: 'secretary_open_cap' });
      expect(second.requestRoot).toEqual(first.requestRoot);
      expect((await world.readRequest(first.requestRoot)).rounds.map(round => round.status))
        .toEqual(['queued', 'queued']);

      // Gate (a) holds the claim of the drained round on B: the `assigned` routing round is
      // committed and B has not claimed the round yet.
      const claim = world.gates.beforeClaim(b);
      await world.finishQuery(bQuery);
      await claim.reached;
      const assignedView = await world.readRequest(first.requestRoot);
      expect(assignedView).toMatchObject({ assignment: 'assigned', owner: b.ref, waitReason: null });
      expect(routingRounds(assignedView)).toHaveLength(1);
      const inputs = assignedView.rounds.filter(round => round.kind !== 'routing');
      expect(inputs).toHaveLength(2);
      expect(inputs.map(round => round.status)).toEqual(['queued', 'queued']);

      // The exception's premise: the old Host has nothing else left to run. S0's plain Query is
      // finished through the public route, so a public read shows S0 idle; the row's one request
      // is owned by B with no waiting reason, and no other line was opened.
      await world.finishQuery(s0Query);
      const idleS0 = await world.readSession(s0);
      expect(idleS0.record.occupancy).toBeNull();
      expect(idleS0.record.health).toBe('available');
      expect((await world.readSession(b)).record.occupancy).toBeNull();
      expect(await world.listSessions()).toHaveLength(2);
      expect((await world.readRequest(first.requestRoot)).assignment).toBe('assigned');

      // The replies the merged round may consume; one more than the single round needs, so a
      // second execution round would show as a second served request rather than as a failure.
      await world.scripted.script(b, [
        { kind: 'text', text: answerBodyOf('S6A merged answer') },
        { kind: 'text', text: answerBodyOf('S6A second answer') },
      ]);
      // The old Host's one unfinished step is the claim held at gate (a); with S0 idle and the
      // request owned by B, the abandoned Host has nothing else it could still write.
      await world.crash({ extraHostOptions: { requestDriver: 'on', secretaryOpenCap: 2 } });

      const merged = await world.waitForRequest(first.requestRoot,
        view => view.rounds.filter(round => round.kind !== 'routing')
          .every(round => round.status === 'ended') && view.rounds.some(round => round.answer !== null),
        'the merged round ends on B');
      // One `assigned` routing round: the start-up scan read the owner and handed the oldest
      // pending round to B's driver instead of writing a second `assigned` round.
      expect(routingRounds(merged)).toHaveLength(1);
      const mergedInputs = merged.rounds.filter(round => round.kind !== 'routing');
      expect(mergedInputs).toHaveLength(2);
      const execution = mergedInputs.find(round => round.absorbedInto === null);
      const absorbed = mergedInputs.find(round => round.absorbedInto !== null);
      if (execution === undefined || absorbed === undefined) {
        throw new Error('S6A: the batch shape is not one plus one');
      }
      expect(execution.answer).not.toBeNull();
      expect(execution.session).toEqual(b.ref);
      expect(execution.closeCode).toBeNull();
      expect(absorbed.absorbedInto).toEqual(execution.ref);
      expect(absorbed.session).toBeNull();
      // One model run served the whole batch: the two inputs were one execution round, not two.
      expect(await world.scripted.requests(b)).toHaveLength(1);
      // The held claim of the abandoned Host is let go only here, after every read of the new
      // Host: with the old Host's driver on, a line that still had something to run could write
      // after the crash.
      claim.release();
    }, 180_000);
});
