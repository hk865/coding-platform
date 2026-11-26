// The driver's own checks (P6I third round, lead 11-27), each against a fake Host that answers the public routes the
// code reads.
// Run: `node --test scripts/acceptance/test/driver.test.mjs`.
// Nothing here starts a Host or calls a model; the driver's real run stays `run.mjs`.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Budget, scopeKey } from '../lib/budget.mjs';
import { lastChangeCandidate } from '../scenarios/e08.mjs';

const A = { projectId: 'p', workspaceId: 'wa' };
const B = { projectId: 'p', workspaceId: 'wb' };
const RUN = { aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'wb', queryJobId: 'j1', runId: 'r1' };
// The same Run as a claim request may name it: the platform keeps the claim's own field order (`query-execution.ts:1311`).
const RUN_REORDERED = { runId: 'r1', queryJobId: 'j1', workspaceId: 'wb', projectId: 'p', aggregateType: 'QueryRun' };
const answered = value => ({ status: 'ready', value });
const page = items => answered({ items, nextCursor: null });

/**
 * One Host with workspaces A and B. Session s1 lives in A; `world.occupancy` is its card's occupancy and `world.run` the
 * QueryRun its Job reads in B (`queries/read`). `world.reads` counts the reads per route.
 */
function fakeWorld() {
  const world = { occupancy: null, run: null, reads: {} };
  const answer = (route, scope, input) => {
    switch (route) {
      case 'sessions/find': return page(scope.workspaceId !== 'wa' ? [] : [{ record: { ref: { ...A, sessionId: 's1' }, occupancy: world.occupancy } }]);
      case 'sessions/queries': return page([]);
      case 'goals/list': return answered({ goals: [] });
      case 'queries/read':
        if (scope.workspaceId !== 'wb' || input.queryJobId !== 'j1') return { status: 'not_found' };
        return answered({ job: { ref: { aggregateType: 'QueryJob', ...B, queryJobId: 'j1' }, job: { closeReason: world.run.closeReason ?? null } },
          run: world.run });
      default: throw new Error(`the fake Host does not answer ${route}`);
    }
  };
  world.host = { name: 'W', dir: '/w', client: {
    quietGet: async () => ({ workspaces: [{ scope: A }, { scope: B }] }),
    quiet: async (route, scope, input) => { world.reads[route] = (world.reads[route] ?? 0) + 1; return answer(route, scope, input); },
  } };
  return world;
}

const snapshot = (status, phase, requests = [], ref = RUN) => ({ ref, revision: 3, run: { status, outcome: null,
  executionState: { phase, admissionWait: null, requests } } });
const execution = ref => ({ kind: 'execution', executionRef: ref });

function metered(world) {
  const notes = [];
  const budget = new Budget({ total: 1e9, perScenario: 1e9 }, { note: text => notes.push(text), modelCall: () => {} });
  budget.watch(world.host);
  budget.own(A, 'E05');
  budget.own(B, 'E05');
  return { budget, notes };
}

test('r3 #1: a Query the Session runs in another workspace is found whatever field order its occupancy ref has', async () => {
  const world = fakeWorld();
  world.occupancy = execution(RUN_REORDERED);
  world.run = snapshot('running', 'claimed');
  const { budget } = metered(world);
  await budget.read();
  assert.equal(budget.stop, null);
  assert.deepEqual(budget.inFlight({}).items.map(item => item.ref), [RUN]);
});

test('r3 #1: the drain of either workspace counts that Query, and counts it once', async () => {
  const world = fakeWorld();
  world.occupancy = execution(RUN);
  world.run = snapshot('running', 'claimed');
  const { budget } = metered(world);
  await budget.read();
  const ofRun = budget.inFlight({ scopes: [scopeKey(B)] });
  assert.equal(ofRun.queries, 1);
  assert.deepEqual(ofRun.items.map(item => [item.ref, item.runScope]), [[RUN, B]]);
  assert.equal(budget.inFlight({ scopes: [scopeKey(A)] }).queries, 1);
  assert.equal(budget.inFlight({ scopes: [scopeKey(A), scopeKey(B)] }).queries, 1);
});

test('r3 #2: a cross-workspace Run that ended after its Session let go is still read, counted, the hold lifted, then dropped', async () => {
  const world = fakeWorld();
  const request = { requestId: 'q1', usageStatus: 'unknown', reservedInput: 100, reservedOutput: 20 };
  world.occupancy = execution(RUN);
  world.run = snapshot('running', 'started', [request]);
  const { budget } = metered(world);
  await budget.read();
  assert.equal(budget.held, true, 'an unknown usage of a running Query holds the meter');
  // The Run ends (a Host close cut its request) and the Session's occupancy moves on.
  world.occupancy = null;
  world.run = { ...snapshot('closed', 'settled', [request]), closeReason: { code: 'interrupted' } };
  await budget.read();
  assert.equal(budget.stop, null, 'the hold is lifted at the next reading, not after 30 minutes');
  assert.equal(budget.used().spent, 120, 'counted at its reservation');
  const reads = world.reads['queries/read'];
  await budget.read();
  assert.equal(world.reads['queries/read'], reads, 'once its terminal usage is counted the ref is dropped');
});

test('r3 #2: a tracked Run its Job replaced by a new attempt stops the meter with that reason', async () => {
  const world = fakeWorld();
  world.occupancy = execution(RUN);
  world.run = snapshot('running', 'started');
  const { budget } = metered(world);
  await budget.read();
  world.occupancy = null;
  world.run = snapshot('pending', null, [], { ...RUN, runId: 'r2' });
  await budget.read();
  assert.equal(budget.stop?.cap, 'meter');
  assert.match(budget.stop.message, /r1.*new attempt/);
});

/** E08's project: `plans/request-candidate` answers `candidate`; the change request's last round reads `round`. */
function e08Project({ candidate, round = null }) {
  const read = async (route, _scope, input) => {
    if (route === 'plans/request-candidate') return answered(candidate);
    if (route === 'requests/read') return answered({ rounds: round === null ? [] : [round.view] });
    if (route === 'queries/read' && round !== null && input.queryJobId === round.view.ref.queryJobId) return answered(round.read);
    throw new Error(`the fake Host does not answer ${route}`);
  };
  return { scope: A, host: { client: { read } } };
}
const HEAD = { head: { ref: { proposalId: 'pr1' }, revision: 2 }, status: 'candidate' };
const goalRef = { projectId: 'p', goalId: 'g1' };
const requestRoot = { aggregateType: 'QueryJob', ...A, queryJobId: 'root' };

test('r3 #3: an adoptable candidate the last re-read finds goes back to the caller', async () => {
  const last = await lastChangeCandidate(e08Project({ candidate: HEAD }), goalRef, requestRoot, { pastDeadline: false });
  assert.deepEqual(last.candidate, HEAD);
});

test('r3 #3: past the hard limit it is a timeout, written with the state read', async () => {
  const last = await lastChangeCandidate(e08Project({ candidate: HEAD }), goalRef, requestRoot, { pastDeadline: true });
  assert.equal(last.candidate ?? null, null);
  assert.match(last.text, /超时/);
  assert.match(last.text, /candidate/);
});

test('r3 #3: only an empty head goes to the round: one that never entered is the platform\'s', async () => {
  const jobRef = { aggregateType: 'QueryJob', ...A, queryJobId: 'c1' };
  const runRef = { aggregateType: 'QueryRun', ...A, queryJobId: 'c1', runId: 'c1r' };
  const round = { view: { ref: jobRef, runRef, kind: 'plan', absorbedInto: null },
    read: { job: { ref: jobRef, job: { status: 'closed', answerRefs: [], closeReason: { code: 'not_entered', message: 'prepare refused' } } },
      run: { ref: runRef, run: { status: 'closed', outcome: 'not_entered', executionState: null } } } };
  const last = await lastChangeCandidate(e08Project({ candidate: { head: null, status: 'none' }, round }), goalRef, requestRoot,
    { pastDeadline: false });
  assert.equal(last.owner, 'platform');
  assert.match(last.text, /没进入 Kernel/);
});
