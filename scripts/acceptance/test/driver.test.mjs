// The driver's own checks (P6I third round, lead 11-27), each against a fake Host that answers the public routes the
// code reads.
// Run: `node --test scripts/acceptance/test/driver.test.mjs`.
// Nothing here starts a Host or calls a model; the driver's real run stays `run.mjs`.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Budget, BudgetStop, scopeKey } from '../lib/budget.mjs';
import { Report } from '../lib/report.mjs';
import { confirmCard, failureHeadBeforeAdoption, Record, profilePin, reverifyCard, workflowBeat } from '../lib/flows.mjs';
import { cellOut, rowOf } from '../run.mjs';
import { isUsableHead, lastChangeCandidate, waitChangeCandidate } from '../scenarios/e08.mjs';
import iteration, { afterChangeRound, iterateOnEndedSeed, judgeWhatChanged, requestHasNoGoalOf } from '../scenarios/iter.mjs';

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
  const last = await lastChangeCandidate(e08Project({ candidate: HEAD }), goalRef, requestRoot, { deadline: Infinity });
  assert.deepEqual(last.candidate, HEAD);
});

test('P6L3 E08: past the hard limit E08 does not take a candidate written later', async () => {
  const last = await lastChangeCandidate(e08Project({ candidate: HEAD }), goalRef, requestRoot, { deadline: 0 });
  assert.equal(last.candidate, null, 'E08 keeps its original hard deadline');
  assert.match(last.text, /超时/);
});

test('P6L3 E08b: the close-out takes the same usable head as the wait, including one already accepted', async () => {
  const accepted = { head: { ref: { proposalId: 'pr1' }, revision: 2, status: 'accepted' }, status: 'closed' };
  const last = await lastChangeCandidate(e08Project({ candidate: accepted }), goalRef, requestRoot,
    { deadline: 0, isUsable: isUsableHead, acceptLate: true });
  assert.deepEqual(last.candidate, accepted);
});

test('r3 #3: only an empty head goes to the round: one that never entered is the platform\'s', async () => {
  const jobRef = { aggregateType: 'QueryJob', ...A, queryJobId: 'c1' };
  const runRef = { aggregateType: 'QueryRun', ...A, queryJobId: 'c1', runId: 'c1r' };
  const round = { view: { ref: jobRef, runRef, kind: 'plan', absorbedInto: null },
    read: { job: { ref: jobRef, job: { status: 'closed', answerRefs: [], closeReason: { code: 'not_entered', message: 'prepare refused' } } },
      run: { ref: runRef, run: { status: 'closed', outcome: 'not_entered', executionState: null } } } };
  const last = await lastChangeCandidate(e08Project({ candidate: { head: null, status: 'none' }, round }), goalRef, requestRoot,
    { deadline: Infinity });
  assert.equal(last.owner, 'platform');
  assert.match(last.text, /没进入 Kernel/);
});

// ------------------------------------------------------------------------------------------------
// P6J: the fourth-round judgements (E05, E06, C-216, intervention, waiting) and the evidence fields.

import { committedRelease, continuationObject, DUPLICATE_PATHS, e05Evidence, judgeOverlap, judgeTemporary, samePairPaths } from '../scenarios/e05.mjs';
import { continuationHasLine, e06Prerequisite, e06Takeover, handOffToRunningWork } from '../scenarios/e06.mjs';
import { baselineSelectionOf, candidatePathsOf, judgeObservedStart, memberCreationEvidence, observeExistingProject } from '../cells/attached.mjs';
import { coversPath, longGoalStop, pageGoalRef, PLAN_QUESTIONS_ANSWER, waitGoal, WaitTimeout } from '../lib/flows.mjs';
import { claimableVerdict, finalizeWaiting, judgeSecond, openWaitForDisconnect, replyFirstVerdict, secondQuestionOf, secondQuestionRound, secondStepOf, secondWaitRound,
  transferWait } from '../scenarios/wait.mjs';
import { adoptedEvidence, candidateRow, CHANGE_WAIT_MS, changeCandidateAtClose, followChangeRounds, roundEvidence,
  roundLog } from '../scenarios/e08.mjs';
import { closeWithoutCandidate } from '../scenarios/e08b.mjs';
import { adoptionEvidence, closeWithWait, closingEvidence, coveredTaskIds, planEvidence, waitOldGoalClosed } from '../scenarios/e12.mjs';
import { chainEvidenceOf, chainFactsOf } from '../scenarios/e09.mjs';
import { endingOf, messagePoint, planningOf, timelinePoint } from '../scenarios/int.mjs';
import * as INTMOD from '../scenarios/int.mjs';

const run = (taskId, runId, startedAt, endedAt = null, attemptId = `a-${runId}`) => ({ run: { ref: { runId }, task: { taskId },
  startedAt, endedAt, attemptId, plan: { planRevision: 1 } }, outbox: { claim: { sessionRef: { sessionId: `s-${runId}` } } } });

test('P6J E05: two runs on different lines that overlap pass', () => {
  const verdict = judgeOverlap({ pair: { note: 'overlap 60 s' }, usersRuns: [], ordersRuns: [], gates: [] });
  assert.equal(verdict.status, 'pass');
  assert.match(verdict.note, /overlap 60 s/);
});

test('P6J E05: a module gate that blocked the later Task makes the serial run uncovered, with the gate', () => {
  const users = run('t-users', 'u1', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z');
  const orders = run('t-orders', 'o1', '2026-01-01T10:06:00Z', '2026-01-01T10:10:00Z');
  const verdict = judgeOverlap({ pair: null, usersRuns: [users], ordersRuns: [orders],
    gates: [{ moduleId: 'm1', since: 'c1', waiting: { taskId: 't-orders' }, waitingAttempt: 'none',
      running: [{ task: { taskId: 't-users' }, run: { runId: 'u1' } }], release: null }] });
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'entry-missing');
  assert.match(verdict.note, /门 m1/);
  assert.match(verdict.note, /缺门满足时刻/);
});

test('P6J E05: a released gate names its release time', () => {
  const users = run('t-users', 'u1', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z');
  const orders = run('t-orders', 'o1', '2026-01-01T10:16:00Z', '2026-01-01T10:20:00Z');
  const verdict = judgeOverlap({ pair: null, usersRuns: [users], ordersRuns: [orders],
    gates: [{ moduleId: 'm1', since: 'c1', waiting: { taskId: 't-orders' }, waitingAttempt: 'none',
      running: [{ task: { taskId: 't-users' }, run: { runId: 'u1' } }], release: { at: '2026-01-01T10:15:00Z' } }] });
  assert.equal(verdict.status, 'uncovered');
  assert.match(verdict.note, /人放行于 2026-01-01T10:15:00Z/);
});

test('P6J E05: serial runs with no blocking gate fail, with both spans', () => {
  const users = run('t-users', 'u1', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z');
  const orders = run('t-orders', 'o1', '2026-01-01T10:06:00Z', '2026-01-01T10:10:00Z');
  const verdict = judgeOverlap({ pair: null, usersRuns: [users], ordersRuns: [orders], gates: [],
    claimable: { both: true, atStart: { 't-users': true, 't-orders': true } } });
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.note, /u1/);
  assert.match(verdict.note, /o1/);
  const unknown = judgeOverlap({ pair: null, usersRuns: [users], ordersRuns: [orders], gates: [], claimable: { both: null } });
  assert.equal(unknown.status, 'uncovered');
  assert.equal(unknown.code, 'entry-missing');
  // P6J3: one "no" reading is not the whole window; it names the missing evidence instead of "no chance".
  const none = judgeOverlap({ pair: null, usersRuns: [users], ordersRuns: [orders], gates: [], claimable: { both: false } });
  assert.equal(none.status, 'uncovered');
  assert.equal(none.code, 'entry-missing');
  assert.match(none.note, /不能证明整个冲突时段/);
});

test('P6J E05: a gate opened before the first Attempt (waitingAttempt none) is matched, and a release before the earlier Run ended is a missed chance', () => {
  const users = run('t-users', 'u1', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z');
  const orders = run('t-orders', 'o1', '2026-01-01T10:06:00Z', '2026-01-01T10:10:00Z');
  const verdict = judgeOverlap({ pair: null, usersRuns: [users], ordersRuns: [orders],
    gates: [{ moduleId: 'm1', planRevision: 1, since: 'c1', waiting: { taskId: 't-orders' }, waitingAttempt: 'none',
      running: [{ task: { taskId: 't-users' }, run: { runId: 'u1' } }], release: { at: '2026-01-01T10:02:00Z' } }] });
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.note, /门 m1/);
  assert.match(verdict.note, /10:02/);
});

test('P6J E05: a gate released only after the earlier Run ended used up the chance', () => {
  const users = run('t-users', 'u1', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z');
  const orders = run('t-orders', 'o1', '2026-01-01T10:06:00Z', '2026-01-01T10:10:00Z');
  const verdict = judgeOverlap({ pair: null, usersRuns: [users], ordersRuns: [orders],
    gates: [{ moduleId: 'm1', planRevision: 1, since: 'c1', waiting: { taskId: 't-orders' }, waitingAttempt: 'none',
      running: [{ task: { taskId: 't-users' }, run: { runId: 'u1' } }], release: { at: '2026-01-01T10:05:30Z' } }] });
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'not-run');
});

test('P6J E05: a failed gate read is not an empty gate list', () => {
  const users = run('t-users', 'u1', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z');
  const orders = run('t-orders', 'o1', '2026-01-01T10:06:00Z', '2026-01-01T10:10:00Z');
  const verdict = judgeOverlap({ pair: null, usersRuns: [users], ordersRuns: [orders], gates: [], gaps: ['goals/overlap-gates: rejected unavailable'] });
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'entry-missing');
  assert.match(verdict.note, /overlap-gates/);
});

test('P6J E05: a failed gate read does not hide a claimable sample that proves the serial run', () => {
  const users = run('t-users', 'u1', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z');
  const orders = run('t-orders', 'o1', '2026-01-01T10:06:00Z', '2026-01-01T10:10:00Z');
  const verdict = judgeOverlap({ pair: null, usersRuns: [users], ordersRuns: [orders], gates: [],
    gaps: ['goals/overlap-gates: rejected unavailable'],
    claimable: { both: false, atStart: { 't-users': true, 't-orders': false },
      samples: [{ at: '2026-01-01T10:02:00Z', 't-users': false, 't-orders': true }] } });
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.note, /10:02/);
  assert.doesNotMatch(verdict.note, /读不全/);
});

test('P6J E05: a later-Task claimable sample while the earlier Run runs is a real missed opportunity', () => {
  const users = run('t-users', 'u1', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z');
  const orders = run('t-orders', 'o1', '2026-01-01T10:06:00Z', '2026-01-01T10:10:00Z');
  const verdict = judgeOverlap({ pair: null, usersRuns: [users], ordersRuns: [orders], gates: [],
    claimable: { both: false, atStart: { 't-users': true, 't-orders': false },
      samples: [{ at: '2026-01-01T10:02:00Z', 't-users': false, 't-orders': true }] } });
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.note, /10:02/);
});

test('P6J E05: a gate for plan revision 2 matches a Run whose plan snapshot says revision 2', () => {
  const users = run('t-users', 'u1', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z');
  const orders = run('t-orders', 'o1', '2026-01-01T10:06:00Z', '2026-01-01T10:10:00Z');
  users.run.plan = { planRevision: 2 };
  orders.run.plan = { planRevision: 2 };
  const verdict = judgeOverlap({ pair: null, usersRuns: [users], ordersRuns: [orders],
    gates: [{ moduleId: 'm1', planRevision: 2, since: 'c1', waiting: { taskId: 't-orders' }, waitingAttempt: 'none',
      running: [{ task: { taskId: 't-users' }, run: { runId: 'u1' } }], release: { at: '2026-01-01T10:02:00Z' } }] });
  assert.equal(verdict.status, 'fail');
});

test('P6J E05: a claimable sample after the earlier Run ended is not an opportunity', () => {
  const users = run('t-users', 'u1', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z');
  const orders = run('t-orders', 'o1', '2026-01-01T10:06:00Z', '2026-01-01T10:10:00Z');
  const verdict = judgeOverlap({ pair: null, usersRuns: [users], ordersRuns: [orders], gates: [],
    claimable: { both: false, atStart: { 't-users': true, 't-orders': false },
      samples: [{ at: '2026-01-01T10:05:30Z', 't-users': false, 't-orders': true }] } });
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'entry-missing');
  assert.match(verdict.note, /不能证明整个冲突时段/);
});

test('P6J E05: the duplicate pass is exactly the two expected paths, and only committed releases count', () => {
  assert.equal(samePairPaths([DUPLICATE_PATHS[1], DUPLICATE_PATHS[0]], DUPLICATE_PATHS), true);
  assert.equal(samePairPaths(['src/a.js', 'src/b.js'], DUPLICATE_PATHS), false);
  assert.equal(committedRelease({ status: 'released' }), true);
  assert.equal(committedRelease({ status: 'committed' }), true);
  assert.equal(committedRelease({ status: 'rejected', code: 'invalid' }), false);
});

test('P6J E05: a temporary file is only what the work record explicitly names, and it must be taken back', () => {
  const taken = judgeTemporary({ temporary: ['src/scratch.js'], written: ['src/scratch.js'], gaps: [], exists: () => false });
  assert.equal(taken.status, 'pass');
  const left = judgeTemporary({ temporary: ['src/scratch.js'], written: ['src/scratch.js'], gaps: [], exists: () => true });
  assert.equal(left.status, 'fail');
  // A planned-outside shared file that was only written is not a temporary file.
  const onlyWritten = judgeTemporary({ written: ['src/shared.js'], gaps: [], exists: () => true });
  assert.equal(onlyWritten.status, 'uncovered');
  assert.equal(onlyWritten.code, 'not-run');
  const gap = judgeTemporary({ written: [], gaps: ['executions/history r1: unavailable'], exists: () => false });
  assert.equal(gap.status, 'uncovered');
  assert.equal(gap.code, 'env-unavailable');
});

test('P6J E06: only Runs that actually started and their work lines are the continuation object', () => {
  assert.equal(continuationObject({ project: { root: '/p' }, goalRef: { goalId: 'g' }, runs: [], module: {} }), null);
  const unstarted = { run: { ref: { runId: 'r0' }, task: { taskId: 't' }, startedAt: null }, outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's0' } } } };
  assert.equal(continuationObject({ project: { root: '/p' }, goalRef: { goalId: 'g' }, runs: [unstarted], module: {} }), null);
  const started = { run: { ref: { runId: 'r1' }, task: { taskId: 't' }, startedAt: '2026-01-01T10:00:00Z' },
    outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's1' } } } };
  const kept = continuationObject({ project: { root: '/p' }, goalRef: { goalId: 'g' }, runs: [unstarted, started], module: {} });
  assert.equal(kept.project.root, '/p');
  assert.deepEqual(kept.lines, [{ projectId: 'p', sessionId: 's1' }]);
  assert.equal(continuationHasLine(kept, { sessionId: 's1' }), true);
  assert.equal(continuationHasLine(kept, { sessionId: 's-new' }), false);
  assert.equal(e06Prerequisite(undefined, true).missing, 'continuation');
  assert.equal(e06Prerequisite(kept, false).missing, 'settled');
  assert.equal(e06Prerequisite(kept, true).ok, true);
});

test('P6J E06: settled first, then the chainSessions head, and only its running Work gets the handoff', async () => {
  const old = { projectId: 'p', sessionId: 's-e05' };
  const e05 = { project: { scope: A, root: '/p' }, goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g5' }, lines: [old] };
  const rows = [
    { key: { projectId: 'p', sessionId: 's-head' }, chainSessions: [old, { projectId: 'p', sessionId: 's-head' }], status: { markers: [] } },
    { key: { projectId: 'p', sessionId: 's-other' }, chainSessions: [{ projectId: 'p', sessionId: 's-other' }] },
  ];
  const runs = [
    { run: { ref: { runId: 'r-run' }, status: 'running', startedAt: '2026-01-01T00:00:00Z' },
      outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's-head' } } } },
    { run: { ref: { runId: 'r-idle' }, status: 'running', startedAt: null },
      outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's-head' } } } },
    { run: { ref: { runId: 'r-other' }, status: 'running', startedAt: '2026-01-01T00:01:00Z' },
      outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's-other' } } } },
  ];
  const reads = [];
  const writes = [];
  const owned = [];
  e05.project.host = { client: {
    read: async route => {
      reads.push(route);
      if (route === 'lines/list') return answered({ rows });
      if (route === 'executions/list') return answered({ items: runs, nextCursor: null });
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async (route, scope, input) => {
      writes.push({ route, input });
      return { status: 'committed', value: { ref: { messageId: 'm1' }, revision: 1 }, sendStatus: 'sent' };
    },
  } };
  const ctx = { hosts: { 'w-accept': e05.project.host }, budget: { own: (...args) => owned.push(args) },
    units: new Map([['E05', { facts: { settled: true } }]]) };
  const rec = new Record({ id: 'E06', rows: ['C-219'], checks: [{ id: 'handoff', rows: ['C-219'], text: '换手' }] });
  const taken = await e06Takeover(ctx, rec, e05, true);
  assert.equal(taken.ok, true);
  assert.equal(taken.line.key.sessionId, 's-head');
  assert.deepEqual(reads, ['lines/list']);
  assert.equal(owned.length, 1);
  assert.equal(owned[0][1], 'E06');
  const sent = await handOffToRunningWork(taken.project, taken.line.key, runs, 'please hand off', { goalRef: e05.goalRef });
  assert.equal(sent.ok, true);
  assert.equal(sent.work.run.ref.runId, 'r-run');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].route, 'messages/send');
  assert.deepEqual(writes[0].input.recipient, { projectId: 'p', sessionId: 's-head' });
  // settled is checked before any line or execution is read, and nothing is transferred.
  reads.length = 0;
  owned.length = 0;
  const notSettled = await e06Takeover(ctx, rec, e05, false);
  assert.equal(notSettled.ok, false);
  assert.equal(notSettled.missing, 'settled');
  assert.match(notSettled.text, /不接管、不转移用量归属/);
  assert.deepEqual(reads, []);
  assert.deepEqual(owned, []);
});

test('P6J C-216: a path covers the root, the file itself or a directory, never a name prefix', () => {
  assert.equal(coversPath('.', 'src/store.js'), true);
  assert.equal(coversPath('src/store.js', 'src/store.js'), true);
  assert.equal(coversPath('src', 'src/store.js'), true);
  assert.equal(coversPath('src-other', 'src/store.js'), false);
  assert.equal(coversPath('src/store.js', 'src/store.test.js'), false);
  const observed = { current: { captureRef: { captureId: 'c1' }, observedAt: '2026-01-01T00:00:00Z' } };
  const observation = { status: 'ready', value: observed };
  assert.equal(judgeObservedStart({ observation, adoptedPaths: ['.'], seedFiles: ['src/store.js'] }).ok, true);
  assert.equal(judgeObservedStart({ observation, adoptedPaths: [], seedFiles: ['src/store.js'] }).ok, false);
  assert.equal(judgeObservedStart({ observation: { status: 'ready', value: { current: null } }, adoptedPaths: ['src'], seedFiles: ['src/store.js'] }).ok, false);
  const failed = judgeObservedStart({ observation: { status: 'rejected', code: 'unavailable' }, adoptedPaths: ['.'], seedFiles: ['src/store.js'] });
  assert.equal(failed.ok, false);
  assert.equal(failed.observationRead, 'rejected');
  assert.deepEqual(baselineSelectionOf({ aggregateType: 'ArchitectureBaselineRevision', baselineId: 'b1' }),
    { selection: { kind: 'revision', ref: { aggregateType: 'ArchitectureBaselineRevision', baselineId: 'b1' } } });
});

test('P6J C-216: the candidate version is the adopted baseline id, not a nonexistent catalog ref', () => {
  const round = { answer: JSON.stringify({ setup: { architecture: { baselineId: 'baseline-7',
    catalog: { modules: [{ paths: ['src'] }, { paths: ['test'] }] } } } }) };
  const candidate = candidatePathsOf(round);
  assert.equal(candidate.version, 'baseline-7');
  assert.equal(candidate.modules, 2);
  assert.deepEqual(candidate.paths, ['src', 'test']);
});

test('P6J C-216: the pre-adoption observation is read before adopt, and the adopted version by its pinned ref', async () => {
  const pin = { aggregateType: 'ArchitectureBaselineRevision', baselineId: 'b-adopted' };
  const round = { ref: { aggregateType: 'QueryJob', projectId: 'p', queryJobId: 'q1' }, status: 'ended', closeCode: null,
    answer: JSON.stringify({ setup: { architecture: { baselineId: 'b-current', catalog: { modules: [{ paths: ['src'] }] } } } }),
    goalCardDrafts: [{ index: 0 }], ideas: [] };
  const calls = [];
  const command = async (route, scope, input) => {
    calls.push({ route, input });
    if (route === 'requests/submit') return { status: 'queued', requestRoot: { aggregateType: 'Request', projectId: 'p', requestId: 'rq1' },
      secretary: { projectId: 'p', sessionId: 's-sec' } };
    if (route === 'goals/confirm-draft') return { status: 'committed', value: { binding: { goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g1' },
      goalRevision: 1, answerRef: { aggregateType: 'Answer', projectId: 'p', goalId: 'g1', answerId: 'a1' }, draftIndex: 0, answerDigest: 'd1' } } };
    if (route === 'initialization/adopt') return { status: 'committed', receipt: { plan: { aggregateType: 'Plan', projectId: 'p', goalId: 'g1', planId: 'p1' } } };
    throw new Error(`the fake Host does not answer command ${route}`);
  };
  const read = async (route, scope, input) => {
    calls.push({ route, input });
    if (route === 'requests/read') return answered({ rounds: [round] });
    if (route === 'goals/list') return answered({ goals: [] });
    if (route === 'goals/read') return answered({ goal: { revision: 1, settings: { autonomy: 'auto' } } });
    if (route === 'architecture/observation-state') return answered({ current: { observedAt: '2026-01-01T00:00:00Z', captureRef: { captureId: 'c1' } } });
    if (route === 'tasks/query') return answered({ plan: { effectiveArchitectureBaseline: { ref: pin } } });
    if (route === 'architecture/read') return answered({ catalog: { catalog: { modules: [{ paths: ['src'] }, { paths: ['test'] }] } } });
    throw new Error(`the fake Host does not answer read ${route}`);
  };
  const project = { scope: A, host: { client: { command, read } } };
  const rec = new Record({ id: 'C-216', rows: ['C-216'], checks: [{ id: 'observed-start', rows: ['C-216'], text: '采用前观察' }] });
  const ctx = { budget: { tick: async () => {} }, report: { current: rec } };
  const observed = await observeExistingProject(ctx, project, 'take over the existing project', rec);
  const observationAt = calls.findIndex(entry => entry.route === 'architecture/observation-state');
  const adoptAt = calls.findIndex(entry => entry.route === 'initialization/adopt');
  assert.ok(observationAt >= 0, 'the observation was read');
  assert.ok(adoptAt >= 0, 'the adoption was attempted');
  assert.ok(observationAt < adoptAt, 'the observation is read before initialization/adopt');
  const versionRead = calls.find(entry => entry.route === 'architecture/read');
  assert.deepEqual(versionRead.input, baselineSelectionOf(pin));
  assert.notDeepEqual(versionRead.input.selection.ref, { kind: 'current' });
  assert.deepEqual(observed.baselineRef, pin);
  assert.deepEqual(observed.started.plan, { aggregateType: 'Plan', projectId: 'p', goalId: 'g1', planId: 'p1' });
});

// ---- P6L C-222: the member a secretary or adviser round built for the adopted Task (diagnosis C-222 row;
// `run-7d2-p6l.md` item 3). A failed segment is a named gap, never an inferred result.

const C222_GOAL = { aggregateType: 'Goal', projectId: 'p', goalId: 'g' };
const C222_PLAN = { aggregateType: 'Plan', projectId: 'p', goalId: 'g', planId: 'p-adopted' };
const C222_TASK = { projectId: 'p', goalId: 'g', taskId: 't-shapes' };
const c222Session = sessionId => ({ projectId: 'p', workspaceId: 'wa', sessionId });
const c222Job = queryJobId => ({ aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'wa', queryJobId });
const c222Run = queryJobId => ({ aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'wa', queryJobId, runId: `run-${queryJobId}` });
const c222Spec = artifactId => ({ aggregateType: 'Artifact', projectId: 'p', workspaceId: 'wa', artifactId });
const c222Message = messageId => ({ aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId });
const C222_REQUEST = c222Job('root');

function c222Routes({ readChild, unknown = false } = {}) {
  const secretaryRound = { ref: c222Job('q-secretary'), kind: 'request', status: 'answered', ideas: [], selectedIdea: null,
    closeCode: null, session: c222Session('s-secretary'), runRef: c222Run('q-secretary'), answer: '{}' };
  const binding = (jobId, kernel, specs, intent) => ({ job: { ref: c222Job(jobId), job: { status: 'answered', intent } },
    run: { ref: c222Run(jobId), run: { status: 'closed', executionState: { history: { kernel },
      requests: [{ requestId: `req-${jobId}`, prompt: { toolSpecsRef: c222Spec(specs) } }] } } } });
  const created = { status: 'created', session: c222Session('s-child'),
    operation: { aggregateType: 'CoreOperation', projectId: 'p', operationId: 'op-created' } };
  const records = [
    event('assistant.message_completed', { message: { messageId: 'm-model', content: [] }, toolCalls: [
      { callId: 'c-created', name: 'create_member', arguments: { duty: 'executor', scope: { kind: 'task', task: C222_TASK }, reason: 'needs an executor' } },
      { callId: 'c-other', name: 'create_member', arguments: { duty: 'executor', scope: { kind: 'task', task: { ...C222_TASK, taskId: 't-other' } }, reason: 'another task' } },
      { callId: 'c-wrong-goal', name: 'create_member', arguments: { duty: 'executor', scope: { kind: 'task', task: { ...C222_TASK, goalId: 'g2' } }, reason: 'a same taskId under another goal' } }] }, 'k-sec', 't-sec'),
    event('tool.completed', { callId: 'c-created', result: { status: 'success',
      output: [{ kind: 'json', value: created }], effects: { changedPaths: [] } } }, 'k-sec', 't-sec'),
    event('tool.completed', { callId: 'c-other', result: { status: 'success', output: [{ kind: 'json',
      value: { status: 'reused', session: c222Session('s-other'), operation: { aggregateType: 'CoreOperation', projectId: 'p', operationId: 'op-other' } } }],
      effects: { changedPaths: [] } } }, 'k-sec', 't-sec'),
    event('tool.completed', { callId: 'c-wrong-goal', result: { status: 'success', output: [{ kind: 'json',
      value: { status: 'created', session: c222Session('s-wrong'), operation: { aggregateType: 'CoreOperation', projectId: 'p', operationId: 'op-wrong' } } }],
      effects: { changedPaths: [] } } }, 'k-sec', 't-sec')];
  return {
    'tasks/query': input => { assert.deepEqual(input.planRef, C222_PLAN, 'the Task is read from the adoption receipt');
      return answered({ plan: { ref: C222_PLAN }, tasks: [
        { ref: { ...C222_TASK, taskId: 't-shapes' }, definition: { taskKind: 'work', scope: { kind: 'goal' } }, execution: { runId: 'r-work' }, effectivePhase: 'ready' },
        { ref: { ...C222_TASK, taskId: 't-gate' }, definition: { taskKind: 'gate', scope: { kind: 'goal' } }, execution: null, effectivePhase: 'ready' }] }); },
    'requests/read': () => answered({ requestRoot: C222_REQUEST, rounds: [secretaryRound] }),
    'lines/list': () => answered({ rows: [{ key: c222Session('s-secretary'), duty: 'secretary', name: {} },
      { key: c222Session('s-adviser'), duty: 'adviser', name: {} }, { key: c222Session('s-child'), duty: 'executor', name: {} },
      { key: c222Session('s-wrong'), duty: 'executor', name: {} },
      ...(unknown ? [{ key: c222Session('s-unknown'), duty: 'unknown', name: {} }] : [])] }),
    'sessions/queries': input => input.sessionRef.sessionId === 's-adviser'
      ? page([{ ref: c222Run('q-adviser'), run: { status: 'closed' } }])
      : input.sessionRef.sessionId === 's-unknown' && unknown ? page([{ ref: c222Run('q-unknown'), run: { status: 'closed' } }]) : page([]),
    'queries/read': input => input.queryJobId === 'q-secretary'
      ? answered(binding('q-secretary', { runId: 'k-sec', turnId: 't-sec' }, 'spec-sec', { goalId: 'g', execution: { kind: 'request' } }))
      : input.queryJobId === 'q-adviser'
        ? answered(binding('q-adviser', { runId: 'k-adv', turnId: 't-adv' }, 'spec-adv',
          { goalId: 'g', execution: { kind: 'intervention_planning', sourceMessageRef: c222Message('m-suggest') } }))
        : input.queryJobId === 'q-unknown'
          ? answered(binding('q-unknown', { runId: 'k-unk', turnId: 't-unk' }, 'spec-unk',
            { goalId: 'g', execution: { kind: 'intervention_planning', sourceMessageRef: c222Message('m-unknown') } }))
          : { status: 'not_found' },
    'materials/open': input => input.ref.artifactId === 'spec-sec'
      ? answered({ body: JSON.stringify([{ name: 'read_file' }, { name: 'create_member' }]), ref: input.ref })
      : input.ref.artifactId === 'spec-adv' ? answered({ body: JSON.stringify([{ name: 'create_member' }]), ref: input.ref })
        : input.ref.artifactId === 'spec-unk' ? answered({ body: JSON.stringify([{ name: 'create_member' }]), ref: input.ref }) : { status: 'not_found' },
    'sessions/history': input => input.sessionRef.sessionId === 's-secretary'
      ? page(records.map(record => ({ body: { text: JSON.stringify(record) } }))) : page([]),
    'messages/view': () => answered({ message: { taskRef: C222_TASK } }),
    'sessions/read': readChild ?? (input => input.sessionId === 's-child'
      ? answered({ record: { secretaryCreated: true, revision: 1 } }) : { status: 'not_found' }),
    'sessions/operation': input => answered({ ref: input, revision: 1, phase: 'completed', failure: null,
      action: { kind: 'member_create', input: { caller: { kind: 'secretary_query', sessionRef: c222Session('s-secretary') },
        scope: { task: C222_TASK } }, progress: { stage: 'created', decision: 'created', outcome: 'created', lastRefusal: null } } }),
    'executions/list': () => page([{ run: { ref: { runId: 'r-work' }, status: 'completed', task: { ...C222_TASK, taskId: 't-shapes' } },
      outbox: { claim: { sessionRef: c222Session('s-child') } } }]),
  };
}

const c222CommittedAnswers = () => [{ at: '2026-01-01T10:00:00Z', answer: { answer: { status: 'committed' } },
  card: { cardKey: 'member:op-created', taskRef: C222_TASK, actions: ['answer'], options: [{ id: 'approve', effect: 'apply' }],
    senderSessionRef: c222Session('s-secretary'), requestRef: C222_REQUEST, state: 'answered',
    source: { kind: 'member_creation', key: 'member:op-created',
      pins: [{ ref: { aggregateType: 'CoreOperation', projectId: 'p', operationId: 'op-created' }, revision: 1 }] } } },
{ at: '2026-01-01T10:00:01Z', answer: { answer: { status: 'committed' } },
  card: { cardKey: 'member:op-host', taskRef: C222_TASK, actions: ['answer'], options: [{ id: 'approve', effect: 'apply' }],
    senderSessionRef: null, requestRef: null, state: 'answered',
    source: { kind: 'member_creation', key: 'member:op-host',
      pins: [{ ref: { aggregateType: 'CoreOperation', projectId: 'p', operationId: 'op-host' }, revision: 1 }] } } }];
test('P6L C-222: the adopted Task\'s grant, call, raw result, member card and created child line are kept', async () => {
  const project = e05Project(c222Routes());
  const evidence = await memberCreationEvidence(project, { goalRef: C222_GOAL, planRef: C222_PLAN,
    requestRoot: C222_REQUEST, committedAnswers: c222CommittedAnswers() });
  assert.deepEqual([evidence.planRef, evidence.tasks.map(task => task.taskId)], [C222_PLAN, ['t-shapes', 't-gate']],
    'the real Task comes from the adoption receipt\'s plan');
  const secretary = evidence.rounds.find(round => round.source === 'secretary-request');
  const forTask = secretary.memberCalls.filter(call => call.forTask);
  assert.deepEqual([secretary.tools.includes('create_member'), forTask.length, forTask[0].taskRef.taskId,
    forTask[0].result.status, forTask[0].result.session.sessionId,
    secretary.memberCalls.find(call => call.callId === 'c-other').forTask], [true, 1, 't-shapes', 'created', 's-child', false],
  'the secretary round holds the frozen grant and only its call for the adopted Task counts, raw result kept');
  const adviser = evidence.rounds.find(round => round.source === 'adviser-planning');
  assert.deepEqual([adviser.tools.includes('create_member'), adviser.memberCalls.length, adviser.relatedTaskIds],
    [true, 0, ['t-shapes']], 'the adviser planning round\'s grant is read and the letter names the real Task');
  assert.deepEqual([evidence.memberCards[0].cardKey, evidence.memberCards[0].operationRef.operationId],
    ['member:op-created', 'op-created']);
  assert.deepEqual([evidence.memberCards[0].senderSessionRef, evidence.memberCards[0].requestRef,
    evidence.memberCards[0].state, evidence.memberCards[0].initiatedBy],
  [c222Session('s-secretary'), C222_REQUEST, 'answered', 's-secretary'],
  'the card keeps its own sender, request and state, so who initiated the member is answerable');
  assert.deepEqual([evidence.memberCards[1].senderSessionRef, evidence.memberCards[1].requestRef,
    evidence.memberCards[1].state, evidence.memberCards[1].initiatedBy], [null, null, 'answered', 'platform'],
  'no sender is written null and named as the platform');
  const wrong = secretary.memberCalls.find(call => call.callId === 'c-wrong-goal');
  assert.equal(wrong.forTask, false, 'a same taskId under another goal is not the adopted Task');
  assert.deepEqual([evidence.createdLines.length, evidence.createdLines[0].secretaryCreated,
    evidence.createdLines[0].workRuns, evidence.createdLines[0].claimMatches, evidence.gaps],
  [1, true, ['r-work'], true, []], 'only the matched operation child is kept; the Work claim is kept, with no gap');
  const createdOp = evidence.operations.find(entry => entry.ref.operationId === 'op-created');
  assert.deepEqual([createdOp.caller?.kind, createdOp.task?.taskId, createdOp.progress?.stage, createdOp.failure],
    ['secretary_query', 't-shapes', 'created', null], 'the created operation keeps its caller, Task and progress');
  assert.ok(evidence.operations.some(entry => entry.ref.operationId === 'op-host'),
    'the card-pinned operation is read too, so a needs_decision creation is covered');
  const rec = new Record({ id: 'C-222', rows: ['C-222'], checks: [
    { id: 'created', rows: ['C-222'], text: '秘书建出执行者' }, { id: 'started', rows: ['C-222'], text: '领取并做完' }] });
  rec.facts.c222 = evidence;
  const saved = savedScenario(rec, { id: 'C-222', rows: ['C-222'] });
  assert.deepEqual([saved.facts.c222.createdLines[0].secretaryCreated, saved.facts.c222.createdLines[0].claimMatches,
    saved.facts.c222.rounds.find(round => round.source === 'secretary-request').memberCalls[0].result.status],
  [true, true, 'created']);
});
test('P6L C-222: an unreadable child line names the gap and leaves the original cell result unchanged', async () => {
  const project = e05Project(c222Routes({ readChild: () => ({ status: 'rejected', code: 'unavailable', reason: 'line store down' }) }));
  const rec = new Record({ id: 'C-222', rows: ['C-222'], checks: [
    { id: 'created', rows: ['C-222'], text: '秘书建出执行者' }, { id: 'started', rows: ['C-222'], text: '领取并做完' }] });
  rec.check('created', false, '原来的判据结果');
  const evidence = await memberCreationEvidence(project, { goalRef: C222_GOAL, planRef: C222_PLAN,
    requestRoot: C222_REQUEST, committedAnswers: c222CommittedAnswers() });
  assert.ok(evidence.gaps.some(gap => /sessions\/read s-child/.test(gap)), evidence.gaps.join('；'));
  assert.equal(evidence.createdLines[0].secretaryCreated, null, 'an unreadable marker is not inferred as false');
  assert.deepEqual([evidence.createdLines[0].recordRead.status, evidence.createdLines[0].recordRead.reason],
    ['rejected', 'line store down']);
  assert.deepEqual([rec.results.get('created').status, rec.results.get('created').note], ['fail', '原来的判据结果'],
    'the cell result is not rewritten by the evidence');
});

test('P6L C-222: a duty-unknown line is scanned and named as a gap, with the cell result unchanged', async () => {
  const project = e05Project(c222Routes({ unknown: true }));
  const rec = new Record({ id: 'C-222', rows: ['C-222'], checks: [
    { id: 'created', rows: ['C-222'], text: '秘书建出执行者' }, { id: 'started', rows: ['C-222'], text: '领取并做完' }] });
  rec.check('created', true, '原来的判据结果');
  const evidence = await memberCreationEvidence(project, { goalRef: C222_GOAL, planRef: C222_PLAN,
    requestRoot: C222_REQUEST, committedAnswers: c222CommittedAnswers() });
  assert.ok(evidence.rounds.some(round => round.duty === 'unknown' && round.source === 'adviser-planning'
    && round.roundRef.queryJobId === 'q-unknown'), 'the unknown-duty line\'s planning round is scanned');
  assert.ok(evidence.gaps.some(gap => /duty unknown/.test(gap) && /s-unknown/.test(gap)),
    `the failed role read is a named gap: ${evidence.gaps.join('；')}`);
  assert.deepEqual([rec.results.get('created').status, rec.results.get('created').note], ['pass', '原来的判据结果'],
    'the evidence does not rewrite the cell');
});

test('P6J intervention: the page target is the line name Goal, else the selected Goal', () => {
  const project = { scope: { projectId: 'p' } };
  assert.deepEqual(pageGoalRef(project, { name: { goalRef: { goalId: 'own' } } }, { goalId: 'sel' }),
    { aggregateType: 'Goal', projectId: 'p', goalId: 'own' });
  assert.deepEqual(pageGoalRef(project, { name: { goalRef: null } }, { goalId: 'sel' }),
    { aggregateType: 'Goal', projectId: 'p', goalId: 'sel' });
  assert.equal(pageGoalRef(project, { name: { goalRef: null } }, null), null);
});

test('P6J intervention: the whole-Goal wait keeps its real stop reason', () => {
  assert.equal(longGoalStop(null, 'stalled: no change for 32 min').stoppedFor, 'stalled: no change for 32 min');
  assert.equal(longGoalStop(null, null).phase, null);
  assert.deepEqual(longGoalStop({ display: { phase: 'NEEDS_DECISION' }, stoppedFor: 'the platform stopped: no_new_basis' }, null),
    { phase: 'NEEDS_DECISION', stoppedFor: 'the platform stopped: no_new_basis' });
});

test('P6J waiting: the independent README question is found beside the chain', () => {
  const sends = [
    { ref: { messageId: 'first' }, args: { waitAfterSend: true, text: 'num.js?' } },
    { ref: { messageId: 'readme' }, args: { waitAfterSend: true, text: 'README 的标题' } },
    { ref: { messageId: 'other' }, args: { waitAfterSend: false, text: 'README' } },
  ];
  assert.equal(secondQuestionOf(sends, [{ messageId: 'first' }]).ref.messageId, 'readme');
  assert.equal(secondQuestionOf(sends.slice(0, 1), [{ messageId: 'first' }]), null);
});

test('P6J waiting: reply-first is judged on the actual acceptance', () => {
  const replied = { response: { respondedAt: '2026-01-01T10:00:00Z' }, expiredAt: null,
    acceptedInputs: [{ part: 'response', consumesWait: true }] };
  assert.equal(replyFirstVerdict(replied).status, 'pass');
  assert.equal(replyFirstVerdict({ response: null, expiredAt: null }).status, 'uncovered');
  assert.equal(replyFirstVerdict({ response: { respondedAt: '2026-01-01T10:02:00Z' }, expiredAt: '2026-01-01T10:01:00Z' }).status, 'uncovered');
  assert.equal(replyFirstVerdict({ response: { respondedAt: '2026-01-01T10:00:00Z' }, expiredAt: '2026-01-01T10:01:00Z',
    acceptedInputs: [{ part: 'expiry', consumesWait: true }] }).status, 'fail');
});

test('P6J waiting: the second question is re-read and one action follows its real state', () => {
  const replied = { status: 'responded', response: { respondedAt: '2026-01-01T10:00:00Z' }, expiredAt: null, acceptedInputs: [] };
  assert.equal(secondStepOf({ message: replied, hasReceiver: true }).kind, 'reply-first');
  assert.equal(secondStepOf({ message: null, readFailure: 'messages/read: rejected' }).kind, 'gap');
  assert.equal(secondStepOf({ message: replied, readFailure: 'messages/read: rejected' }).kind, 'gap');
  const acceptedReply = { ...replied, acceptedInputs: [{ part: 'response', consumesWait: true, acceptedAt: '2026-01-01T10:00:01Z' }] };
  assert.equal(secondStepOf({ message: acceptedReply, hasReceiver: true }).verdict.status, 'pass');
  assert.equal(secondStepOf({ message: acceptedReply, hasReceiver: true }).kind, 'reply-first');
  const closed = { status: 'responded', response: { respondedAt: '2026-01-01T10:00:00Z' }, waitCancelledAt: '2026-01-01T10:00:00Z', acceptedInputs: [] };
  assert.equal(secondStepOf({ message: closed, hasReceiver: true }).kind, 'closed');
  const open = { status: 'pending', response: null, expiredAt: null, acceptedInputs: [] };
  assert.equal(secondStepOf({ message: open, hasReceiver: true }).kind, 'transfer');
  assert.equal(secondStepOf({ message: open, hasReceiver: false }).kind, 'no-receiver');
});

test('P6J waiting: only an open wait with a recipient and no expiry is a disconnect object', () => {
  const base = { state: { state: 'open' }, recipient: { sessionId: 'far' }, expiredAt: null };
  assert.equal(openWaitForDisconnect([{ ...base, messageRef: { messageId: 'a' } }]).messageRef.messageId, 'a');
  assert.equal(openWaitForDisconnect([{ ...base, messageRef: { messageId: 'b' }, state: { state: 'answered' } }]), null);
  assert.equal(openWaitForDisconnect([{ ...base, messageRef: { messageId: 'c' }, state: { state: 'consumed' } }]), null);
  assert.equal(openWaitForDisconnect([{ ...base, messageRef: { messageId: 'd' }, state: { state: 'withdrawn' } }]), null);
  assert.equal(openWaitForDisconnect([{ ...base, messageRef: { messageId: 'e' } }].map(entry => ({ ...entry, recipient: undefined }))), null);
  assert.equal(openWaitForDisconnect([{ ...base, messageRef: { messageId: 'f' }, expiredAt: '2026-01-01T00:00:00Z' }]), null);
});

test('P6J intervention: a failed planning Query read stays a gap, not "no planning"', async () => {
  const project = { scope: A, host: { client: { read: async (route) => {
    if (route === 'lines/list') return answered({ rows: [{ key: { projectId: 'p', sessionId: 's1' } }] });
    if (route === 'sessions/queries') return answered({ items: [{ ref: { aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'w', queryJobId: 'intervention-planning-1' } }], nextCursor: null });
    if (route === 'queries/read') return { status: 'rejected', code: 'unavailable', reason: 'store down' };
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const gaps = [];
  const found = await planningOf(project, { messageId: 'm1' }, gaps);
  assert.equal(found, null);
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /queries\/read intervention-planning-1/);
});

test('P6J waiting: only an open wait with a recipient is a disconnect object', () => {
  const waits = [{ messageRef: { messageId: 'a' }, state: { state: 'open' }, recipient: { sessionId: 'far' } },
    { messageRef: { messageId: 'b' }, state: { state: 'answered' }, recipient: { sessionId: 'far' } },
    { messageRef: { messageId: 'c' }, state: { state: 'open' } }];
  assert.equal(openWaitForDisconnect(waits).messageRef.messageId, 'a');
  assert.equal(openWaitForDisconnect(waits.slice(1)), null);
});

/** A project whose `sessions/history` answers the records given, whose `queries/read` answers the bindings, and whose
 * `materials/open` answers the tool-specs bodies by artifact id. */
function historyProject(records, bindings = {}, materials = {}) {
  return { scope: A, host: { client: { read: async (route, _scope, input) => {
    if (route === 'sessions/history') return answered({ items: records.map(record => ({ body: { text: JSON.stringify(record) } })), nextCursor: null });
    if (route === 'queries/read') {
      const binding = bindings[input?.queryJobId];
      return binding === undefined ? { status: 'rejected', code: 'unavailable' } : answered(binding);
    }
    if (route === 'materials/open') {
      const body = materials[input?.ref?.artifactId];
      return body === undefined ? { status: 'not_found' } : answered({ body, ref: input.ref });
    }
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
}

const event = (type, payload, runId = 'r1', turnId = 't1') => ({ recordType: 'agent.event',
  payload: { event: { type, payload, meta: { runId, turnId, occurredAt: '2026-01-01T10:00:00Z' } } } });

test('P6J3 E08: a round\'s tools are the frozen tool specs of its own model request, not the permission projection', async () => {
  // The platform QueryRun id (`r1`) is not the Kernel run/turn id; only `queries/read` names the history to scan.
  const records = [
    event('assistant.message_completed', { message: { messageId: 'm1', content: [{ kind: 'text', text: 'plan' }] },
      toolCalls: [{ callId: 'c1', name: 'submit_plan_round', arguments: { phase: 'x' } }] }, 'krun-1', 'kturn-1'),
    event('tool.completed', { callId: 'c1', result: { status: 'error', error: { code: 'invalid', message: 'phase is platform-filled' } } }, 'krun-1', 'kturn-1'),
  ];
  const view = { rounds: [{ ref: { queryJobId: 'q1' }, kind: 'plan', status: 'ended', ideas: [{ title: 'a' }, { title: 'b' }],
    selectedIdea: null, closeCode: null, session: { projectId: 'p', sessionId: 's1' }, runRef: { runId: 'r1' } }] };
  // The body the send layer stored is the request's frozen tool table; `entry.permissions.tools` is the Host grant and
  // names `write_file`, which this request never sent. Only the body's names may be recorded.
  const specs = [{ name: 'read_file' }, { name: 'submit_plan_round' }];
  const binding = { job: { ref: { queryJobId: 'q1' } }, run: { ref: { runId: 'r1', queryJobId: 'q1' }, run: { status: 'ended',
    executionState: { history: { kernel: { runId: 'krun-1', turnId: 'kturn-1' } },
      entry: { permissions: { tools: ['write_file', 'submit_plan_round'] } },
      requests: [{ requestId: 'req1', prompt: { toolSpecsRef: { aggregateType: 'Artifact', projectId: 'p', workspaceId: 'wa', artifactId: 'spec1' } } }] } } } };
  const [round] = await roundEvidence(historyProject(records, { q1: binding }, { spec1: JSON.stringify(specs) }), view);
  assert.equal(round.kind, 'plan');
  assert.equal(round.ideas, 2);
  assert.deepEqual(round.kernel, { runId: 'krun-1', turnId: 'kturn-1' });
  assert.deepEqual(round.tools, ['read_file', 'submit_plan_round']);
  assert.equal(round.tools.includes('write_file'), false, 'the permission projection is not the frozen request');
  assert.equal(round.toolsGap, null);
  assert.equal(round.read.queries, 'ready');
  assert.equal(round.read.history, 'ready');
  assert.deepEqual(round.calls.map(call => call.name), ['submit_plan_round']);
  assert.equal(round.refusals[0].code, 'invalid');
});

test('P6J3 E08: a missing or unreadable toolSpecsRef is a named gap, never the permission table', async () => {
  const view = { rounds: [{ ref: { queryJobId: 'q1' }, kind: 'plan', status: 'ended', ideas: [],
    selectedIdea: null, closeCode: null, session: { projectId: 'p', sessionId: 's1' }, runRef: { runId: 'r1' } }] };
  const base = { job: { ref: { queryJobId: 'q1' } }, run: { ref: { runId: 'r1', queryJobId: 'q1' }, run: { status: 'ended',
    executionState: { history: { kernel: { runId: 'krun-1', turnId: 'kturn-1' } },
      entry: { permissions: { tools: ['write_file', 'submit_plan_round'] } } } } } };
  const gaps = [];
  const [noRequests] = await roundEvidence(historyProject([], { q1: base }), view, gaps);
  assert.equal(noRequests.tools, null);
  assert.match(noRequests.toolsGap, /requests/);
  assert.ok(!(noRequests.tools ?? []).includes('write_file'));
  assert.ok(gaps.some(gap => /requests/.test(gap)));
  const failed = { ...base, run: { ...base.run, run: { ...base.run.run, executionState: { ...base.run.run.executionState,
    requests: [{ requestId: 'req1', prompt: { toolSpecsRef: { aggregateType: 'Artifact', artifactId: 'spec-gone' } } }] } } } };
  const failedGaps = [];
  const [unreadable] = await roundEvidence({ scope: A, host: { client: { read: async (route) => {
    if (route === 'queries/read') return answered(failed);
    if (route === 'materials/open') return { status: 'rejected', code: 'unavailable', reason: 'store down' };
    if (route === 'sessions/history') return answered({ items: [], nextCursor: null });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } }, view, failedGaps);
  assert.equal(unreadable.tools, null);
  assert.match(unreadable.toolsGap, /materials\/open|store down|unavailable/);
  assert.ok(!(unreadable.tools ?? []).includes('write_file'));
  assert.ok(failedGaps.some(gap => /materials\/open/.test(gap)));
});

test('P6J E08 evidence: a failed plans/proposal read is not a readable candidate with no task', async () => {
  const project = { scope: A, host: { client: { read: async (route) => {
    if (route === 'plans/request-candidate') return answered({ head: { ref: { proposalId: 'pr1' }, revision: 2 }, status: 'candidate' });
    if (route === 'plans/proposal') return { status: 'rejected', code: 'unavailable', reason: 'store down' };
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const row = await candidateRow(project, { goalId: 'g' }, { queryJobId: 'q' }, 't-sub');
  assert.equal(row.readable, false);
  assert.equal(row.candidateReadable, true);
  assert.match(row.proposalRead, /rejected|unavailable/);
  assert.equal(row.task, null);
});

test('P6J E08b/E12 evidence: the adopted version keeps its disposition record and execution', async () => {
  const reads = [];
  const project = { scope: A, host: { client: { read: async (route, _scope, input) => {
    reads.push({ route, input });
    if (route === 'tasks/query') return answered({ tasks: [
      { ref: { taskId: 't-sub' }, definition: { taskKind: 'work', scope: { kind: 'goal' } }, disposition: 'cancelled', effectivePhase: 'cancelled', execution: null },
      { ref: { taskId: 't-div' }, definition: { taskKind: 'work', scope: { kind: 'goal' } }, disposition: 'active', effectivePhase: 'satisfied', execution: { runId: 'r9' } },
    ], plan: { dispositionRecord: { entries: [{ taskId: 't-sub', to: 'cancelled' }] } } });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const evidence = await adoptedEvidence(project, { goalId: 'g' }, { planId: 'p2' });
  // P6J4 (quick check row 7): the read names the adopted version itself, never the Goal's current plan.
  assert.deepEqual(reads.map(entry => entry.input.planRef), [{ planId: 'p2' }]);
  assert.equal(evidence.readable, true);
  assert.equal(evidence.tasks.find(task => task.taskId === 't-div').execution.runId, 'r9');
  assert.equal(evidence.dispositionRecord.entries[0].to, 'cancelled');
});

test('P6J E12: a gate covers the work tasks in its scope, and the plan row keeps execution', () => {
  const tasks = [
    { ref: { taskId: 'w-goal' }, definition: { taskKind: 'work', scope: { kind: 'goal' } } },
    { ref: { taskId: 'w-stage' }, definition: { taskKind: 'work', scope: { kind: 'stage', stageId: 's1' } } },
    { ref: { taskId: 'w-other' }, definition: { taskKind: 'work', scope: { kind: 'stage', stageId: 's2' } } },
    { ref: { taskId: 'g-stage' }, definition: { taskKind: 'gate', scope: { kind: 'stage', stageId: 's1' } }, effectivePhase: 'pending' },
    { ref: { taskId: 'g-goal' }, definition: { taskKind: 'gate', scope: { kind: 'goal' } }, effectivePhase: 'pending' },
  ];
  assert.deepEqual(coveredTaskIds(tasks, tasks[3]), ['w-stage']);
  assert.deepEqual(coveredTaskIds(tasks, tasks[4]), ['w-goal', 'w-stage', 'w-other']);
  const rows = planEvidence({ planId: 'p1' })([{ ref: { taskId: 'w-stage' }, definition: { taskKind: 'work', scope: { kind: 'stage', stageId: 's1' } },
    execution: { runId: 'r1' }, effectivePhase: 'satisfied' }]);
  assert.equal(rows.readable, true);
  assert.equal(rows.planRef.planId, 'p1');
  assert.equal(rows.tasks[0].execution.runId, 'r1');
});

test('P6J E12: the closing read still returns the adopted plan evidence when the wait stopped', async () => {
  const project = { scope: A, host: { client: { read: async () => answered({ tasks: [
    { ref: { taskId: 'w' }, definition: { taskKind: 'work', scope: { kind: 'goal' } }, execution: { runId: 'r1' }, effectivePhase: 'satisfied' },
  ] }) } } };
  const evidence = await closingEvidence(project, { goalId: 'g' }, { planId: 'p1' });
  assert.equal(evidence.readable, true);
  assert.equal(evidence.planRef.planId, 'p1');
  assert.equal(evidence.tasks[0].execution.runId, 'r1');
  const failed = { scope: A, host: { client: { read: async () => ({ status: 'rejected', code: 'unavailable' }) } } };
  assert.equal((await closingEvidence(failed, { goalId: 'g' }, { planId: 'p1' })).readable, false);
});

test('P6J E09 evidence: the chain object keeps send, acceptance, wake, query and completion time', () => {
  const facts = chainFactsOf({
    report: { ref: { messageId: 'm1' }, result: { name: 'send_session_message', args: { needsReply: true } } },
    view: { delivery: { delivery: 'delivered', deliveredTo: { executionRef: { aggregateType: 'Run', runId: 'r1' } } } },
    message: { acceptedInputs: [{ part: 'message' }] },
    received: [{ line: 's1', runId: 'r2', turnId: 't2', final: 'explained' }],
    queries: [{ line: 's1', runId: 'r2', queryRef: { queryJobId: 'q2' }, status: 'answered', phase: 'settled' }],
    goalCompletedObservedAt: '2026-01-01T10:05:00Z',
  });
  assert.equal(facts.report.tool, 'send_session_message');
  assert.equal(facts.accepted.delivery, 'delivered');
  assert.equal(facts.received[0].final, true);
  assert.equal(facts.queries[0].queryRef.queryJobId, 'q2');
  assert.equal(facts.goalCompletedObservedAt, '2026-01-01T10:05:00Z');
  assert.equal(facts.report.recipient, null);
  assert.equal(facts.accepted.readable, true);
  const stopped = chainFactsOf({ report: { ref: { messageId: 'm1' }, result: { name: 'send_session_message', args: {} } },
    view: null, message: null, received: [], queries: [], goalCompletedObservedAt: null });
  assert.equal(stopped.goalCompletedObservedAt, null);
  assert.equal(stopped.accepted.readable, false);
  assert.deepEqual(stopped.accepted.acceptedInputs, []);
});

test('P6J E08 evidence: a failed candidate read is not "no candidate"', async () => {
  const project = { scope: A, host: { client: { read: async () => ({ status: 'rejected', code: 'unavailable', reason: 'store down' }) } } };
  const row = await candidateRow(project, { goalId: 'g' }, { queryJobId: 'q' }, 't-sub');
  assert.equal(row.readable, false);
  assert.equal(row.code, 'unavailable');
  assert.equal(row.task, null);
});

// ------------------------------------------------------------------------------------------------
// P6L: E08b's final round (diagnosis E08b row; run sheet 这一轮做什么 item 2). Every row drives the production
// helper the scenario uses, against a fake Host that answers the public routes it reads.

const q = queryJobId => ({ aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'wa', queryJobId });
const qr = queryJobId => ({ aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'wa', queryJobId, runId: `${queryJobId}-run` });
const changedRound = (queryJobId, { answer = '{"kind":"plan"}', ideas = [], selectedIdea = null, status = 'ended',
  kind = 'plan', closeCode = null } = {}) => ({ ref: q(queryJobId), runRef: qr(queryJobId), kind, status, closeCode,
  absorbedInto: null, answer, ideas: ideas.map((title, index) => ({ index, title })), selectedIdea });

/** E08b's change request: `requests/read` answers `views` in order (the last one repeats), the candidate answers
 * `candidates`, and `queries/read`/`materials/open`/`sessions/history` answer by their keys. Reads and commands are
 * recorded, so a row can count exactly how often a route was used. */
function changeHost({ views, candidates, bindings = {}, materials = {}, records = [], cards = [], onRead = () => {} }) {
  const reads = [];
  const commands = [];
  let viewAt = 0;
  let candidateAt = 0;
  const read = async (route, _scope, input) => {
    reads.push({ route, input });
    onRead(route);
    switch (route) {
      case 'decisions/queue': return answered({ waitingAnswer: cards, capabilities: [] });
      case 'messages/read': return answered({ revision: 3 });
      case 'requests/read': {
        const view = views[Math.min(viewAt, views.length - 1)];
        viewAt += 1;
        return view === undefined ? { status: 'not_found' } : answered(view);
      }
      case 'plans/request-candidate': {
        const value = candidates[Math.min(candidateAt, candidates.length - 1)];
        candidateAt += 1;
        return value === undefined ? { status: 'not_found' } : answered(value);
      }
      case 'plans/proposal': return answered({});
      case 'queries/read': {
        const binding = bindings[input?.queryJobId];
        return binding === undefined ? { status: 'rejected', code: 'unavailable' } : answered(binding);
      }
      case 'sessions/history': return answered({ items: records.map(record => ({ body: { text: JSON.stringify(record) } })), nextCursor: null });
      case 'materials/open': {
        const body = materials[input?.ref?.artifactId];
        return body === undefined ? { status: 'not_found' } : answered({ body, ref: input.ref });
      }
      default: throw new Error(`the fake Host does not answer ${route}`);
    }
  };
  const host = { client: {
    read,
    command: async (route, _scope, input) => { commands.push({ route, input }); return { status: 'queued' }; },
    write: async (route, _scope, input) => { commands.push({ route, input }); return { status: 'ready', value: {} }; },
  } };
  return { project: { scope: A, host }, reads, commands };
}

/** The wait's own budget, as the driver gives it: nothing in flight, and `tick` is a no-op. */
function changeCtx(rec) {
  return { budget: { tick: async () => {}, inFlight: () => ({ queries: 0, items: [] }) }, report: { current: rec } };
}

const changeRecord = () => {
  const rec = new Record({ id: 'E08b', rows: ['C-210'], checks: ['sub-running', 'stop-delivered', 'safe-point-end', 'adopt-after-end']
    .map(id => ({ id, rows: ['C-210'], text: id })) });
  rec.facts.userCommand = [];
  return rec;
};
const followState = () => ({ rounds: [], seen: new Set(), gaps: [], selected: null, asked: 0 });
/** Lets every pending promise of a fake-Host chain run before the mocked clock moves again. */
const flushAll = async () => { for (let i = 0; i < 50; i += 1) await new Promise(resolve => setImmediate(resolve)); };

test('P6L E08b #1: a round that appears only after the card answer is appended by roundRef with its answer, tools, calls and refusals', async () => {
  const first = changedRound('q1', { ideas: ['a'] });
  const second = { ...changedRound('q2', { answer: '{"kind":"plan","round":2}' }), session: { projectId: 'p', sessionId: 's-q2' } };
  const records = [
    event('assistant.message_completed', { message: { messageId: 'm2', content: [{ kind: 'text', text: 'round 2' }] },
      toolCalls: [{ callId: 'c2', name: 'submit_plan_round', arguments: {} }] }, 'k-q2', 't-q2'),
    event('tool.completed', { callId: 'c2', result: { status: 'error', error: { code: 'invalid', message: 'nope' } } }, 'k-q2', 't-q2'),
  ];
  const bindings = { q1: { job: { ref: q('q1') }, run: { ref: qr('q1'), run: { status: 'closed', executionState: { requests: [] } } } },
    q2: { job: { ref: q('q2') }, run: { ref: qr('q2'), run: { status: 'closed', executionState: {
      history: { kernel: { runId: 'k-q2', turnId: 't-q2' } },
      requests: [{ requestId: 'req-q2', prompt: { toolSpecsRef: { aggregateType: 'Artifact', projectId: 'p', workspaceId: 'wa', artifactId: 'spec2' } } }],
    } } } } };
  const materials = { spec2: JSON.stringify([{ name: 'submit_plan_round' }, { name: 'request_stop' }]) };
  const { project } = changeHost({ views: [{ rounds: [first] }, { rounds: [first, second] }],
    candidates: [{ head: null, status: 'closed' }], bindings, materials, records });
  const rec = changeRecord();
  const state = followState();
  // The card is answered between the two reads; only the second read sees the round it started.
  await followChangeRounds(changeCtx(rec), project, requestRoot, rec, state, { check: 'adopt-after-end' });
  await followChangeRounds(changeCtx(rec), project, requestRoot, rec, state, { check: 'adopt-after-end' });
  assert.equal(state.rounds.length, 2, 'the round that appeared after the card answer is appended once');
  assert.deepEqual(state.rounds[1].roundRef, second.ref);
  assert.equal(state.rounds[1].answer, second.answer);
  assert.deepEqual(state.rounds[1].tools, ['submit_plan_round', 'request_stop']);
  assert.deepEqual(state.rounds[1].calls.map(call => call.name), ['submit_plan_round']);
  assert.equal(state.rounds[1].refusals[0].code, 'invalid');
});

test('P6L E08b #2: select-idea is called once for the newest answered round with 2–3 ideas, never otherwise', async () => {
  const older = { ...changedRound('q-old', { ideas: ['a', 'b', 'c'] }), session: { projectId: 'p', sessionId: 's' } };
  const newest = changedRound('q-new', { ideas: ['x', 'y'] });
  const selected = { ...newest, selectedIdea: { index: 0 } };
  const { project, commands } = changeHost({ views: [{ rounds: [older, newest] }, { rounds: [older, selected] }],
    candidates: [{ head: null, status: 'closed' }] });
  const rec = changeRecord();
  const state = followState();
  await followChangeRounds(changeCtx(rec), project, requestRoot, rec, state, { check: 'adopt-after-end' });
  // A second sync over the same selection must not select a second time.
  await followChangeRounds(changeCtx(rec), project, requestRoot, rec, state, { check: 'adopt-after-end' });
  const picks = commands.filter(entry => entry.route === 'requests/select-idea');
  assert.equal(picks.length, 1, 'exactly one selection');
  assert.deepEqual(picks[0].input.round, newest.ref, 'the newest answered round, not the older 3-idea one');
  assert.equal(picks[0].input.index, 0);
  assert.deepEqual(state.selected, { round: newest.ref, index: 0, status: 'queued' });

  for (const [name, rounds] of [
    ['already selected', [{ ...newest, selectedIdea: { index: 1 } }]],
    ['one idea', [{ ...newest, ideas: [{ index: 0, title: 'x' }] }]],
    ['four ideas', [{ ...newest, ideas: ['a', 'b', 'c', 'd'].map((title, index) => ({ index, title })) }]],
    ['only an older answered round has 2–3', [older, changedRound('q-new-1', { ideas: ['x'] })]],
  ]) {
    const caseHost = changeHost({ views: [{ rounds }], candidates: [{ head: null, status: 'closed' }] });
    const caseState = followState();
    await followChangeRounds(changeCtx(changeRecord()), caseHost.project, requestRoot, changeRecord(), caseState, { check: 'adopt-after-end' });
    assert.equal(caseHost.commands.filter(entry => entry.route === 'requests/select-idea').length, 0, name);
  }
});

test('P6L E08b #3: a new human question is answered through the existing entry, within its count limit', async () => {
  const question = id => changedRound(id, { answer: '{"kind":"needs_decision"}' });
  const { project, commands } = changeHost({ views: [
    { rounds: [question('q1')] },
    { rounds: [question('q1'), question('q2')] },
    { rounds: [question('q1'), question('q2'), question('q3')] },
  ], candidates: [{ head: null, status: 'closed' }] });
  const rec = changeRecord();
  const state = followState();
  await followChangeRounds(changeCtx(rec), project, requestRoot, rec, state, { check: 'adopt-after-end', pollMs: 1 });
  const asks = commands.filter(entry => entry.route === 'requests/submit');
  assert.equal(asks.length, 2, 'the existing cap of two answers holds across the follow');
  assert.ok(asks.every(entry => entry.input.text === PLAN_QUESTIONS_ANSWER && entry.input.continues === requestRoot));
  assert.equal(state.asked, 2);
  assert.equal(rec.facts.userCommand.filter(text => text === PLAN_QUESTIONS_ANSWER).length, 2);
});

test('P6L E08b #3b: a new question whose wait times out is a gap and leaves the three cells not-run', async t => {
  // P6LO #3b: a controllable clock. The reads before the answer take 101 ms of it; the answer is confirmed queued first,
  // then the clock is moved until the wait for the new round runs out.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-01-01T10:00:00Z') });
  const question = changedRound('q1', { status: 'running', answer: '{"kind":"needs_decision"}' });
  const { project, commands } = changeHost({ views: [{ rounds: [question] }, { rounds: [question] }],
    candidates: [{ head: null, status: 'closed' }], onRead: route => { if (route === 'queries/read') t.mock.timers.tick(101); } });
  const rec = changeRecord();
  const state = followState();
  let returned = 'pending';
  followChangeRounds(changeCtx(rec), project, requestRoot, rec, state, { check: 'adopt-after-end', timeoutMs: 60_000 })
    .then(value => { returned = value; }, error => { returned = error; });
  await flushAll();
  assert.deepEqual(commands.filter(entry => entry.route === 'requests/submit').map(entry => entry.input.text),
    [PLAN_QUESTIONS_ANSWER], 'the one answer is queued through the existing entry before the clock moves');
  for (let i = 0; i < 20 && returned === 'pending'; i += 1) { t.mock.timers.tick(10_000); await flushAll(); }
  assert.ok(returned !== 'pending' && returned !== null && !(returned instanceof Error), 'the follow returns the current view instead of throwing');
  assert.equal(state.asked, 1, 'the answer that timed out still counts against the cap');
  assert.ok(state.gaps.some(gap => /超时|timed out/.test(gap)), `the timeout is a named gap: ${state.gaps.join('；')}`);
  rec.facts.e08b = { rounds: state.rounds, evidenceGaps: state.gaps };
  await closeWithoutCandidate(rec, project, goalRef, requestRoot, 't-sub', 'seen');
  for (const id of ['stop-delivered', 'safe-point-end', 'adopt-after-end']) {
    assert.equal(rec.results.get(id).status, 'uncovered', id);
    assert.equal(rec.results.get(id).code, 'not-run', id);
  }
});

test('P6L E08b #4: an adoptable head read within the deadline goes back to the original adoption flow', async () => {
  const HEAD_B = { head: { ref: { proposalId: 'pr1' }, revision: 2 }, status: 'candidate' };
  const closed = changedRound('q2', { closeCode: 'invalid_answer' });
  const { project } = changeHost({ views: [{ rounds: [closed] }], candidates: [{ head: null, status: 'closed' }, HEAD_B] });
  const rec = changeRecord();
  const waited = await changeCandidateAtClose(changeCtx(rec), project, goalRef, requestRoot, rec,
    { timeoutMs: CHANGE_WAIT_MS, done: value => value?.head != null && value.status === 'candidate' });
  assert.deepEqual(waited.candidate, HEAD_B, 'the head read at close-out goes back to the caller unchanged');
  assert.deepEqual(waited.last.candidate, HEAD_B);
});

test('P6LO E08: a candidate read back only after the hard limit is not taken, in the poll or at the final read', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-01-01T10:00:00Z') });
  // The poll: no candidate before the limit; the 10 s sleep crosses it; the next beat reads p2.
  const { project } = changeHost({ views: [{ rounds: [changedRound('q1', { status: 'running' })] }],
    candidates: [{ head: null, status: 'none' }, HEAD] });
  const rec = changeRecord();
  let result = 'pending';
  waitChangeCandidate(changeCtx(rec), project, goalRef, requestRoot, rec, { deadline: Date.now() + 5_000 })
    .then(value => { result = value; }, error => { result = error; });
  for (let i = 0; i < 5 && result === 'pending'; i += 1) { await flushAll(); t.mock.timers.tick(10_000); }
  await flushAll();
  assert.equal(result, null, 'the late candidate is not taken by the poll');
  // The final read: sent before the limit, answered after it.
  const deadline = Date.now() + 1_000;
  const slow = { scope: A, host: { client: { read: async route => {
    if (route !== 'plans/request-candidate') throw new Error(`the fake Host does not answer ${route}`);
    t.mock.timers.tick(2_000);
    return answered(HEAD);
  } } } };
  const last = await lastChangeCandidate(slow, goalRef, requestRoot, { deadline });
  assert.equal(last.candidate, null, 'a read answered after the limit is late');
  assert.match(last.text, /超时/);
});

const decisionCard = key => ({ cardKey: key, actions: ['answer'], options: [{ id: 'yes', effect: 'apply' }],
  source: { kind: 'decision', key, pins: [] } });

test('P6LO B4: a refused card answer ends the beat: the second card waits for the next beat, and the follow is not run', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-01-01T10:00:00Z') });
  const { project, commands } = changeHost({ views: [{ rounds: [changedRound('q1', { status: 'running' })] }],
    candidates: [{ head: null, status: 'none' }], cards: [decisionCard('c1'), decisionCard('c2')] });
  const rec = changeRecord();
  let follows = 0;
  let result = 'pending';
  waitChangeCandidate(changeCtx(rec), project, goalRef, requestRoot, rec, { deadline: Date.now() + 5_000,
    onPoll: async view => { follows += 1; return view; } }).then(value => { result = value; }, error => { result = error; });
  await flushAll();
  assert.equal(commands.filter(entry => entry.route === 'decisions/answer').length, 1, 'one write attempt in the first beat');
  assert.equal(follows, 0, 'the beat that wrote does not follow the rounds too');
  for (let i = 0; i < 5 && result === 'pending'; i += 1) { t.mock.timers.tick(10_000); await flushAll(); }
  assert.equal(result, null);
  assert.equal(commands.filter(entry => entry.route === 'decisions/answer').length, 1, 'nothing is written past the deadline');
});

test('P6LO B4: a message card whose letter read comes back past the deadline is not answered', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-01-01T10:00:00Z') });
  const letter = { cardKey: 'm1', actions: ['answer'], options: [{ id: 'yes', effect: 'apply' }],
    source: { kind: 'message', key: JSON.stringify({ messageRef: { messageId: 'm1' } }), pins: [] } };
  const { project, commands } = changeHost({ views: [{ rounds: [changedRound('q1', { status: 'running' })] }],
    candidates: [{ head: null, status: 'none' }], cards: [letter],
    onRead: route => { if (route === 'messages/read') t.mock.timers.tick(2_000); } });
  const rec = changeRecord();
  let result = 'pending';
  waitChangeCandidate(changeCtx(rec), project, goalRef, requestRoot, rec, { deadline: Date.now() + 1_000 })
    .then(value => { result = value; }, error => { result = error; });
  for (let i = 0; i < 5 && result === 'pending'; i += 1) { await flushAll(); t.mock.timers.tick(10_000); }
  await flushAll();
  assert.equal(result, null);
  assert.equal(commands.filter(entry => entry.route === 'decisions/answer').length, 0, 'the write is checked against the deadline');
});

test('P6L3 B4: the candidate wait uses the caller deadline and an already accepted head is usable both in the wait and at close-out', async () => {
  const accepted = { head: { ref: { proposalId: 'pr1' }, revision: 2, status: 'accepted' }, status: 'closed' };
  const { project, commands } = changeHost({ views: [{ rounds: [changedRound('q1', { ideas: ['a', 'b'] })] }],
    candidates: [accepted] });
  const rec = changeRecord();
  const waited = await changeCandidateAtClose(changeCtx(rec), project, goalRef, requestRoot, rec,
    { deadline: Date.now() + 500 });
  assert.deepEqual(waited.candidate, accepted, 'the same usable head condition as the polling wait');
  assert.equal(waited.last, null, 'the wait itself took the accepted head, not only the close-out read');
  assert.equal(commands.filter(entry => entry.route === 'requests/select-idea').length, 0);
  const past = changeHost({ views: [{ rounds: [changedRound('q1', { ideas: ['a', 'b'] })] }],
    candidates: [{ head: null, status: 'closed' }] });
  const late = await changeCandidateAtClose(changeCtx(rec), past.project, goalRef, requestRoot, rec,
    { deadline: Date.now() - 1, onPoll: async view => view });
  assert.equal(late.candidate, null);
  assert.equal(past.commands.length, 0, 'no action is taken past the caller deadline');
});

test('P6L3 B4: one follow call with once performs at most one action', async () => {
  const question = id => changedRound(id, { answer: '{"kind":"needs_decision"}' });
  const { project, commands } = changeHost({ views: [{ rounds: [question('q1'), question('q2')] },
    { rounds: [question('q1'), question('q2')] }], candidates: [{ head: null, status: 'closed' }] });
  const rec = changeRecord();
  const state = followState();
  await followChangeRounds(changeCtx(rec), project, requestRoot, rec, state,
    { check: 'adopt-after-end', timeoutMs: 100, pollMs: 1, once: true });
  assert.equal(commands.filter(entry => entry.route === 'requests/submit').length, 1, 'one answer, then the call returns');
  assert.equal(state.asked, 1);
});

test('P6LO B5: once the answer is queued one follow layer keeps a failed re-read as a gap and ends when the new round is visible', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-01-01T10:00:00Z') });
  const question = changedRound('q1', { answer: '{"kind":"needs_decision"}' });
  const running = changedRound('q2', { status: 'running', answer: null });
  const { project, commands } = changeHost({ views: [{ rounds: [question] }, undefined, { rounds: [question, running] }],
    candidates: [{ head: null, status: 'closed' }] });
  const rec = changeRecord();
  const state = followState();
  const start = Date.now();
  let returned = 'pending';
  followChangeRounds(changeCtx(rec), project, requestRoot, rec, state, { check: 'adopt-after-end', deadline: start + 30 * 60_000 })
    .then(value => { returned = value; }, error => { returned = error; });
  for (let i = 0; i < 200 && returned === 'pending'; i += 1) { await flushAll(); t.mock.timers.tick(10_000); }
  await flushAll();
  assert.ok(returned !== null && !(returned instanceof Error), String(returned));
  assert.ok(Date.now() - start <= 60_000, `the follow ends when q2 is visible, not when it settles (${(Date.now() - start) / 1000} s)`);
  assert.equal(commands.filter(entry => entry.route === 'requests/submit').length, 1);
  assert.equal(state.asked, 1);
  assert.ok(state.askedRounds.has(`p/wa/q1`), 'the round counts as answered once the answer is queued');
  assert.ok(state.gaps.some(gap => /继续跟同一个根/.test(gap)), `the failed re-read is a gap: ${state.gaps.join('；')}`);
  assert.ok(state.rounds.some(round => round.roundRef.queryJobId === 'q2'), 'the visible new round is recorded');
});

test('P6L3 B5: an older round already in the request is not mistaken for the new round', async () => {
  const older = changedRound('q-old', { answer: '{"kind":"plan"}', ideas: ['only'] });
  const question = changedRound('q2', { answer: '{"kind":"needs_decision"}' });
  const newRound = changedRound('q3', { ideas: [] });
  const { project, commands } = changeHost({ views: [
    { rounds: [older, question] }, { rounds: [older, question] }, null, { rounds: [older, question, newRound] }],
  candidates: [{ head: null, status: 'closed' }] });
  const rec = changeRecord();
  const state = followState();
  await followChangeRounds(changeCtx(rec), project, requestRoot, rec, state,
    { check: 'adopt-after-end', pollMs: 1, timeoutMs: 60_000 });
  assert.equal(commands.filter(entry => entry.route === 'requests/submit').length, 1);
  assert.ok(state.rounds.some(round => round.roundRef.queryJobId === 'q3'),
    'the older q-old round does not end the follow before q3 appears');
});

test('P6L3 B5: after the card answer a failed re-read is a gap and the follow keeps the same root to the new round', async () => {
  const question = changedRound('q1', { answer: '{"kind":"needs_decision"}' });
  const newRound = changedRound('q2', { ideas: [] });
  const { project, commands } = changeHost({ views: [
    { rounds: [question] }, { rounds: [question] }, null, { rounds: [question, newRound] }],
  candidates: [{ head: null, status: 'closed' }] });
  const rec = changeRecord();
  const state = followState();
  await followChangeRounds(changeCtx(rec), project, requestRoot, rec, state,
    { check: 'adopt-after-end', pollMs: 1, timeoutMs: 60_000 });
  assert.equal(commands.filter(entry => entry.route === 'requests/submit').length, 1, 'the same round is answered once');
  assert.ok(state.rounds.some(round => round.roundRef.queryJobId === 'q2'), 'the new round is appended after the failed read');
  assert.ok(state.gaps.some(gap => /继续跟同一个根/.test(gap)), `the failed re-read is a named gap: ${state.gaps.join('；')}`);
});

test('P6L E08b #5: no head keeps the last round and the final candidate read, with the three cells not-run', async () => {
  const last = changedRound('q2', { closeCode: 'invalid_answer' });
  const binding = { job: { ref: q('q2'), job: { status: 'closed', answerRefs: ['a1'], closeReason: null } },
    run: { ref: qr('q2'), run: { status: 'closed', outcome: 'answered', executionState: { history: null, requests: [], phase: 'settled' } } } };
  const { project, reads } = changeHost({ views: [{ rounds: [last] }], candidates: [{ head: null, status: 'closed' }],
    bindings: { q2: binding } });
  const rec = changeRecord();
  const state = followState();
  await followChangeRounds(changeCtx(rec), project, requestRoot, rec, state, { check: 'adopt-after-end' });
  rec.facts.e08b = { rounds: state.rounds, evidenceGaps: state.gaps };
  const waited = await changeCandidateAtClose(changeCtx(rec), project, goalRef, requestRoot, rec,
    { timeoutMs: CHANGE_WAIT_MS, done: value => value?.head != null });
  assert.equal(waited.candidate, null);
  await closeWithoutCandidate(rec, project, goalRef, requestRoot, 't-sub', 'seen');
  assert.equal(rec.facts.e08b.rounds.length, 1);
  assert.equal(rec.facts.e08b.rounds.at(-1).roundRef.queryJobId, 'q2', 'the last round stays');
  assert.equal(rec.facts.e08b.candidate.readable, true);
  assert.equal(rec.facts.e08b.candidate.status, 'closed', 'the final candidate read is kept');
  for (const id of ['stop-delivered', 'safe-point-end', 'adopt-after-end']) {
    assert.equal(rec.results.get(id).status, 'uncovered', id);
    assert.equal(rec.results.get(id).code, 'not-run', id);
  }
  assert.ok(reads.filter(entry => entry.route === 'plans/request-candidate').length >= 3, 'wait, close-out re-read and final row');
});

test('P6L E08b #6: the rounds log line names the real queryJobId, not "?"', async () => {
  const view = { rounds: [changedRound('q1', { ideas: ['a', 'b'] })] };
  const binding = { job: { ref: q('q1') }, run: { ref: qr('q1'), run: { status: 'closed', executionState: { requests: [] } } } };
  const rows = await roundEvidence(historyProject([], { q1: binding }, {}), view);
  assert.equal(roundLog(rows), 'q1:plan/ideas 2');
  assert.equal(roundLog(rows).includes('?'), false);
});


test('P6J waiting: one shared transfer re-reads, archives the sender with wait.transfer once', async () => {
  const calls = [];
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', taskId: 't-wait', runId: 'r-wait' };
  const letterRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm1' };
  const to = { projectId: 'p', sessionId: 's2' };
  const project = { scope: A, host: { client: {
    read: async (route, _scope, input) => {
      calls.push({ route, input });
      if (route === 'messages/read') return answered({ status: 'pending', response: null, expiredAt: null,
        acceptedInputs: [], deadline: '2026-01-01T10:00:00Z' });
      if (route === 'sessions/read') return answered({ record: { revision: 4, lifecycle: 'active' } });
      if (route === 'sessions/facts') return answered({ waits: [{ messageRef: letterRef, originalRun: runRef,
        state: { state: 'open' }, deadline: '2026-01-01T10:00:00Z' }] });
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async (route, _scope, input) => { calls.push({ route, input }); return { status: 'ready', value: { state: 'archived' } }; },
    command: async () => { throw new Error('a live sender line needs no standalone waits/dispose'); },
  } } };
  const outcome = await transferWait(project, { ref: letterRef, line: { projectId: 'p', sessionId: 's1' } },
    { deadline: '2026-01-01T10:00:00Z' }, { key: to });
  assert.equal(outcome.kind, 'transfer');
  const archives = calls.filter(call => call.route === 'sessions/archive-line');
  assert.equal(archives.length, 1);
  assert.deepEqual(archives[0].input.wait, { kind: 'transfer', runRef, messageRef: letterRef, to });
  assert.equal(calls.some(call => call.route === 'waits/dispose'), false);
});

const waitingLetter = (overrides = {}) => ({ status: 'pending', response: null, expiredAt: null, acceptedInputs: [],
  deadline: '2026-01-01T10:30:00Z', recipient: { projectId: 'p', sessionId: 's-secretary' }, ...overrides });
const waitingSend = text => ({ ref: { projectId: 'p', sessionId: 's-member', messageId: `m-${text}` }, line: { projectId: 'p', sessionId: 's-member' },
  args: { waitAfterSend: true, text } });
const waitingReceiver = sessionId => ({ key: { projectId: 'p', sessionId } });

test('P6J3 waiting: every round locks the README question and re-selects the receiver before transferring', async () => {
  const calls = [];
  let archivable = false;
  const readme = waitingSend('README 的标题要不要改成中文？');
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', taskId: 't-wait', runId: 'r-wait' };
  const letterRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: readme.ref.messageId };
  const project = { scope: A, host: { client: {
    read: async route => {
      calls.push(route);
      if (route === 'messages/read') return answered(waitingLetter());
      if (route === 'sessions/read') return archivable ? answered({ record: { revision: 4, lifecycle: 'active' } })
        : { status: 'rejected', code: 'unavailable', reason: 'session store down' };
      if (route === 'sessions/facts') return answered({ waits: [{ messageRef: letterRef, originalRun: runRef,
        state: { state: 'open' }, deadline: '2026-01-01T10:30:00Z' }] });
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async (route, scope, input) => { calls.push({ route, input }); return { status: 'ready', value: { state: 'archived' } }; },
    command: async () => { throw new Error('a live sender line needs no standalone waits/dispose'); },
  } } };
  const fallback = waitingSend('num.js 还有别的导出吗？');
  // README has not appeared: the fallback second question is not read and its sender is not archived.
  assert.equal(await secondQuestionRound(project, { sends: [fallback], chainRefs: [], receiverOf: async () => waitingReceiver('s-r0') }), null);
  assert.deepEqual(calls, []);
  const picked = [];
  const first = await secondQuestionRound(project, { sends: [fallback, readme], chainRefs: [], prior: null,
    receiverOf: async () => { picked.push('s-r1'); return waitingReceiver('s-r1'); } });
  assert.equal(first.outcome.kind, 'gap');
  assert.equal(first.attempted, false);
  // The next round re-selects the qualified receiver; the earlier line is not the one the wait moves to.
  archivable = true;
  const second = await secondQuestionRound(project, { sends: [fallback, readme], chainRefs: [], prior: first,
    receiverOf: async () => { picked.push('s-r2'); return waitingReceiver('s-r2'); } });
  assert.equal(second.outcome.kind, 'transfer');
  assert.deepEqual(picked, ['s-r1', 's-r2']);
  const movedTo = calls.filter(entry => entry.route === 'sessions/archive-line').map(entry => entry.input.wait.to.sessionId);
  assert.deepEqual(movedTo, ['s-r2']);
});

test('P6J3 waiting: a reply that wins before the chain closes is judged reply-first on its acceptance', async () => {
  const responded = waitingLetter({ status: 'responded', response: { respondedAt: '2026-01-01T10:00:00Z' },
    acceptedInputs: [{ part: 'response', consumesWait: true, acceptedAt: '2026-01-01T10:00:01Z' }] });
  const calls = [];
  const project = { scope: A, host: { client: {
    read: async route => { calls.push(route);
      if (route === 'messages/read') return answered(responded);
      if (route === 'sessions/read') return answered({ record: { revision: 4 } });
      throw new Error(`the fake Host does not answer ${route}`); },
    write: async route => { calls.push(route); return { status: 'ready', value: { state: 'archived' } }; },
    command: async route => { calls.push(route); return { status: 'committed' }; },
  } } };
  const readme = waitingSend('README 的标题要不要改成中文？');
  const round = await secondQuestionRound(project, { sends: [readme], chainRefs: [], prior: null,
    receiverOf: async () => waitingReceiver('s-r1') });
  assert.equal(round.outcome.kind, 'reply-first');
  assert.equal(round.outcome.verdict.status, 'pass');
  assert.equal(round.attempted, false);
  assert.equal(calls.some(route => route === 'sessions/archive-line'), false);
  const rec = new Record({ id: 'waiting', rows: ['C-187'], checks: [
    { id: 'reply-first', rows: ['C-187'], text: '回复抢先' }, { id: 'transfer', rows: ['C-224'], text: '转交' }] });
  judgeSecond(rec, { outcome: round.outcome, secondText: '第二个问题 m-README', secondMsg: round.outcome.message });
  assert.equal(rec.results.get('reply-first').status, 'pass');
  assert.equal(rec.results.get('transfer').status, 'uncovered');
  assert.equal(rec.results.get('transfer').code, 'not-run');
});

test('P6J3 waiting: an archive refused because the reply landed re-reads the same letter', async () => {
  const calls = [];
  const answeredLetter = waitingLetter({ status: 'responded', response: { respondedAt: '2026-01-01T10:00:00Z' },
    acceptedInputs: [{ part: 'response', consumesWait: true, acceptedAt: '2026-01-01T10:00:01Z' }] });
  let letter = waitingLetter();
  const readme = waitingSend('README 的标题要不要改成中文？');
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', taskId: 't-wait', runId: 'r-wait' };
  const letterRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: readme.ref.messageId };
  const project = { scope: A, host: { client: {
    read: async route => {
      calls.push(route);
      if (route === 'messages/read') return answered(letter);
      if (route === 'sessions/read') return answered({ record: { revision: 4, lifecycle: 'active' } });
      if (route === 'sessions/facts') return answered({ waits: [{ messageRef: letterRef, originalRun: runRef,
        state: { state: 'open' }, deadline: '2026-01-01T10:30:00Z' }] });
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async (route, scope, input) => {
      calls.push({ route, input });
      if (route === 'sessions/archive-line') { letter = answeredLetter;
        return { status: 'rejected', code: 'invalid', reason: 'the wait is already answered' }; }
      throw new Error(`the fake Host does not answer ${route}`);
    },
    command: async () => { throw new Error('a live sender line needs no standalone waits/dispose'); },
  } } };
  const round = await secondQuestionRound(project, { sends: [readme], chainRefs: [], prior: null,
    receiverOf: async () => waitingReceiver('s-r2') });
  assert.equal(round.outcome.kind, 'reply-first');
  assert.equal(round.outcome.verdict.status, 'pass');
  assert.equal(round.attempt.kind, 'transfer-refused');
  assert.equal(round.attempt.archived.code, 'invalid', 'the refusal is kept raw');
  // The round's read, the transfer's own read, and the re-read after the refusal (P6LO B9: no read after the archive).
  assert.ok(calls.filter(route => route === 'messages/read').length >= 3);
});

test('P6L waiting: the archive request carries wait.transfer with the original wait Run, letter and receiving line', async () => {
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', taskId: 't-wait', runId: 'r-wait' };
  const letterRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm-readme' };
  const to = { projectId: 'p', sessionId: 's-other' };
  const calls = [];
  const project = { scope: A, host: { client: {
    read: async (route, _scope, input) => {
      calls.push({ route, input });
      if (route === 'messages/read') return answered(waitingLetter({ messageId: input.messageId }));
      if (route === 'sessions/read') return answered({ record: { revision: 4, lifecycle: 'active' } });
      if (route === 'sessions/facts') return answered({ waits: [{ messageRef: letterRef, originalRun: runRef,
        state: { state: 'open' }, deadline: '2026-01-01T10:30:00Z' }] });
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async (route, _scope, input) => { calls.push({ route, input }); return { status: 'ready', value: { state: 'archived' } }; },
    command: async () => { throw new Error('a live sender line needs no standalone waits/dispose'); },
  } } };
  const send = { ref: letterRef, line: { projectId: 'p', sessionId: 's-member' }, args: { waitAfterSend: true, text: 'README' } };
  const outcome = await transferWait(project, send, { deadline: '2026-01-01T10:30:00Z' }, { key: to });
  assert.equal(outcome.kind, 'transfer');
  const archive = calls.find(call => call.route === 'sessions/archive-line');
  assert.deepEqual(archive.input.wait, { kind: 'transfer', runRef, messageRef: letterRef, to });
  assert.equal(calls.some(call => call.route === 'waits/dispose'), false);
});

test('P6L waiting: a rejected archive keeps the first refusal raw and re-reads the same letter', async () => {
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', taskId: 't-wait', runId: 'r-wait' };
  const letterRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm-readme' };
  const to = { projectId: 'p', sessionId: 's-other' };
  const refused = { status: 'rejected', code: 'invalid', reason: 'archive_wait_disposal_required: the Session is waiting for a continuation reply' };
  const replied = waitingLetter({ status: 'responded', response: { respondedAt: '2026-01-01T10:00:10Z' },
    acceptedInputs: [{ part: 'response', consumesWait: true, acceptedAt: '2026-01-01T10:00:11Z' }] });
  let letter = waitingLetter();
  const reads = [];
  const writes = [];
  const project = { scope: A, host: { client: {
    read: async (route, _scope, input) => {
      if (route === 'messages/read') { reads.push(input.messageId); return answered(letter); }
      if (route === 'sessions/read') return answered({ record: { revision: 4, lifecycle: 'active' } });
      if (route === 'sessions/facts') return answered({ waits: [{ messageRef: letterRef, originalRun: runRef,
        state: { state: 'open' }, deadline: '2026-01-01T10:30:00Z' }] });
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async (route, _scope, input) => { writes.push({ route, input }); letter = replied; return refused; },
    command: async () => { throw new Error('a live sender line needs no standalone waits/dispose'); },
  } } };
  const send = { ref: letterRef, line: { projectId: 'p', sessionId: 's-member' }, args: { waitAfterSend: true, text: 'README' } };
  const round = await secondWaitRound(project, send, { receiverOf: async () => ({ key: to }) });
  assert.equal(round.kind, 'reply-first');
  assert.equal(round.attempt.kind, 'transfer-refused');
  assert.deepEqual(round.attempt.archived, refused, 'the first refusal is kept raw');
  assert.deepEqual(round.attempt.archived.value, undefined);
  const archive = writes.find(call => call.route === 'sessions/archive-line');
  assert.deepEqual(archive.input.wait, { kind: 'transfer', runRef, messageRef: letterRef, to });
  assert.ok(reads.length >= 3 && reads.every(messageId => messageId === letterRef.messageId), 'the same letter is re-read');
});

test('P6L waiting: expiry before the reply keeps "reply first" out of both cells', () => {
  const letter = waitingLetter({ status: 'responded', expiredAt: '2026-01-01T10:01:00Z',
    response: { respondedAt: '2026-01-01T10:01:00.128Z' },
    acceptedInputs: [{ part: 'expiry', consumesWait: true, acceptedAt: '2026-01-01T10:01:00.200Z' }] });
  const verdict = replyFirstVerdict(letter);
  assert.equal(verdict.status, 'uncovered');
  assert.doesNotMatch(verdict.note, /回复先到/);
  const rec = new Record({ id: 'waiting', rows: ['C-187'], checks: [
    { id: 'reply-first', rows: ['C-187'], text: '回复抢先' }, { id: 'transfer', rows: ['C-224'], text: '转交' }] });
  judgeSecond(rec, { outcome: { kind: 'reply-first', message: letter, verdict }, secondText: '第二个问题' });
  for (const id of ['reply-first', 'transfer']) {
    const cell = rec.results.get(id);
    assert.equal(cell.status, 'uncovered', id);
    assert.doesNotMatch(cell.note, /回复先到/, id);
  }
  assert.match(rec.results.get('transfer').note, /先到期/);
});

test('P6L waiting: a reply before expiry that the response consumed makes reply-first pass from one letter', async () => {
  const letter = waitingLetter({ status: 'responded', expiredAt: '2026-01-01T10:10:00Z',
    response: { respondedAt: '2026-01-01T10:05:00Z' },
    acceptedInputs: [{ part: 'response', consumesWait: true, acceptedAt: '2026-01-01T10:05:01Z' }] });
  const project = { scope: A, host: { client: {
    read: async route => { if (route === 'messages/read') return answered(letter); throw new Error(`the fake Host does not answer ${route}`); },
    write: async () => { throw new Error('nothing may be archived'); },
    command: async () => { throw new Error('nothing may be transferred'); },
  } } };
  const rec = new Record({ id: 'waiting', rows: ['C-187'], checks: [
    { id: 'reply-first', rows: ['C-187'], text: '回复抢先' }, { id: 'transfer', rows: ['C-224'], text: '转交' }] });
  const readme = waitingSend('README 的标题要不要改成中文？');
  await WAIT.closeSecondQuestion(quietCtx(rec), project, rec, { chain: { second: null }, secondSend: readme,
    seenOpen: '轮询到', receiverOf: async () => waitingReceiver('s-r9') });
  assert.equal(rec.results.get('reply-first').status, 'pass');
  assert.match(rec.results.get('reply-first').note, /10:05:00Z/);
});

test('P6L waiting: a reply after a refused archive keeps the first refusal in both cells', () => {
  const letter = waitingLetter({ status: 'responded', response: { respondedAt: '2026-01-01T10:00:10Z' },
    acceptedInputs: [{ part: 'response', consumesWait: true, acceptedAt: '2026-01-01T10:00:11Z' }] });
  const attempt = { kind: 'transfer-refused',
    note: 'sessions/archive-line → s-member: rejected invalid the Session is waiting for a continuation reply',
    archived: { status: 'rejected', code: 'invalid', reason: 'the Session is waiting for a continuation reply' } };
  const rec = new Record({ id: 'waiting', rows: ['C-187'], checks: [
    { id: 'reply-first', rows: ['C-187'], text: '回复抢先' }, { id: 'transfer', rows: ['C-224'], text: '转交' }] });
  judgeSecond(rec, { outcome: { kind: 'reply-first', message: letter, verdict: replyFirstVerdict(letter) },
    attempt, secondText: '第二个问题' });
  for (const id of ['reply-first', 'transfer']) {
    assert.match(rec.results.get(id).note, /sessions\/archive-line → s-member: rejected invalid/, `${id} keeps the first refusal`);
  }
});

test('P6L3 B9: the final letter and sender line pass a transfer whose first archive receipt was still pending', () => {
  const deadline = '2026-01-01T10:30:00Z';
  const secondMsg = waitingLetter({ deadline });
  const moved = waitingLetter({ deadline, replyHandler: { sessionRef: { projectId: 'p', sessionId: 's-other' }, changedAt: deadline },
    archiveWaitDisposition: { kind: 'transfer', runRef: { runId: 'r' }, archiveSessionRef: { projectId: 'p', sessionId: 's-member' },
      archiveRequestId: 'a1', recordedAt: deadline } });
  const base = { kind: 'transfer', sender: { projectId: 'p', sessionId: 's-member' },
    to: { projectId: 'p', sessionId: 's-other' }, moved, deadline,
    senderRecord: { record: { lifecycle: 'archived' } } };
  const final = { message: moved, senderRecord: { record: { lifecycle: 'archived' } } };
  const checks = [{ id: 'reply-first', rows: ['C-187'], text: '回复抢先' }, { id: 'transfer', rows: ['C-224'], text: '转交' }];
  const pending = new Record({ id: 'waiting', rows: ['C-224'], checks });
  judgeSecond(pending, { final, outcome: { ...base, archived: { status: 'ready', value: { state: 'pending' } } },
    secondText: '第二个问题', secondMsg });
  const cell = pending.results.get('transfer');
  assert.equal(cell.status, 'pass', 'the final letter and sender line decide, not the first receipt');
  assert.match(cell.note, /pending/, 'the raw first receipt is kept');
  const archived = new Record({ id: 'waiting', rows: ['C-224'], checks });
  judgeSecond(archived, { final, outcome: { ...base, archived: { status: 'ready', value: { state: 'archived' } } },
    secondText: '第二个问题', secondMsg });
  assert.equal(archived.results.get('transfer').status, 'pass');
});

test('P6J intervention: a timeline read that fails keeps the gap instead of a clean point', async () => {
  const project = { scope: A, host: { client: { read: async () => ({ status: 'rejected', code: 'unavailable', reason: 'store down' }) } } };
  const point = await messagePoint(project, { messageId: 'm1' }, { projectId: 'p', sessionId: 's1' }, { runId: 'r1' });
  assert.equal(point.deliveredTo, null);
  assert.equal(point.gaps.length, 3);
  assert.ok(point.gaps.every(gap => /rejected/.test(gap)));
});

test('P6J item 6: the evidence facts are written into result.json and the attached notes', () => {
  const rec = new Record({ id: 'E05', rows: ['C-182'], checks: [{ id: 'overlap', rows: ['C-182'], text: '两个 Run 的真实重叠' }] });
  rec.pass('overlap', 'overlap 60 s');
  rec.facts.e05 = { roundGaps: ['verification/round r2: 读不到'], readGaps: ['tasks/query: rejected'], temporaryPaths: ['src/scratch.js'] };
  const ctx = { runId: 'run1', facts: { tree: 't', sourceDiffHash: null, docsVersion: null, os: 'linux', node: 'v1', kernelAdapter: 'k1' },
    cfg: { authorization: { text: 'auth' } } };
  const row = rowOf(ctx, { id: 'E05', rows: ['C-182'] }, rec, null, null);
  const dir = mkdtempSync(join(tmpdir(), 'dsh-report-'));
  const report = new Report(dir);
  report.rows = [row];
  report.attached = [cellOut({ id: 'C-216' }, rec)];
  report.writeAll({ date: '2026-01-01', runId: 'run1', tree: 't', dirty: false,
    startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:01:00Z', authorization: 'auth' });
  const saved = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
  assert.deepEqual(saved.scenarios[0].facts.e05.readGaps, ['tasks/query: rejected']);
  assert.deepEqual(saved.scenarios[0].facts.e05.roundGaps, ['verification/round r2: 读不到']);
  const notes = readFileSync(join(dir, 'checks/notes.md'), 'utf8');
  assert.match(notes, /temporaryPaths/);
  assert.match(notes, /src\/scratch\.js/);
});


/** P6J3: a fake Host for E05's evidence collector; every route not named answers `not_found`. */
function e05Host(routes = {}) {
  const calls = [];
  const table = { 'goals/overlap-gates': () => answered({ gates: [] }), ...routes };
  const read = async (route, scope, input) => {
    calls.push({ route, input });
    return table[route] === undefined ? { status: 'not_found' } : table[route](input, calls);
  };
  return { calls, host: { client: { read,
    write: async (route, scope, input) => { calls.push({ route, kind: 'write', input }); return { status: 'committed' }; },
    command: async (route, scope, input) => { calls.push({ route, kind: 'command', input }); return { status: 'ready' }; } } } };
}
const e05Project = (routes, root = '/nonexistent-e05') => ({ scope: A, root, ...e05Host(routes) });
const e05Run = (taskId, runId, startedAt, endedAt = null, attemptId = `a-${runId}`) => ({
  run: { ref: { runId }, task: { taskId }, startedAt, endedAt, attemptId, plan: { planRevision: 1 } },
  outbox: { claim: { sessionRef: { projectId: 'p', sessionId: `s-${runId}` }, claimedAt: startedAt } },
});
const historyPage = records => () => page(records.map(record => ({ body: { text: JSON.stringify(record) } })));
const historyFor = (runId, records) => input => input.runRef?.runId === runId ? historyPage(records)() : page([]);
const reportRef = artifactId => ({ aggregateType: 'Artifact', projectId: 'p', workspaceId: 'wa', artifactId });
const roundHead = (runId, roundId, checks, reverify = null) => ({
  roundRef: { aggregateType: 'VerificationRound', projectId: 'p', workspaceId: 'wa', goalId: 'g', taskId: 't-users', runId, roundId },
  status: 'finalized', outcome: 'FAIL', checks, gaps: [],
  chain: { ordinal: 1, predecessorRoundRef: null, predecessorRevision: null, supersededEvidenceIds: [],
    basisDigests: [], autoCount: 0, reverify },
});
const verificationPage = heads => input => {
  const head = heads[input.subjectRunRef?.runId];
  return head === undefined ? { status: 'not_found' } : answered(head);
};

test('P6J3 E05: the execution list shows two lines overlapping, so the overlap passes', async () => {
  const project = e05Project({ 'executions/list': () => page([
    e05Run('t-users', 'u1', '2026-01-01T10:00:00Z', '2026-01-01T10:10:00Z'),
    e05Run('t-orders', 'o1', '2026-01-01T10:05:00Z', '2026-01-01T10:15:00Z')]) });
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' } });
  assert.equal(evidence.overlap.verdict.status, 'pass');
  assert.match(evidence.overlap.verdict.note, /u1/);
  assert.match(evidence.overlap.verdict.note, /o1/);
});

const serialRuns = () => page([
  e05Run('t-users', 'u1', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z'),
  e05Run('t-orders', 'o1', '2026-01-01T10:06:00Z', '2026-01-01T10:10:00Z')]);
const coveringGate = () => ({ moduleId: 'm1', planRevision: 1, since: 'c1', waiting: { taskId: 't-orders' },
  waitingAttempt: 'none', running: [{ task: { taskId: 't-users' }, run: { runId: 'u1' } }],
  release: { at: '2026-01-01T10:05:30Z' } });

test('P6J3 E05: a gate released only after the conflicting Run ended covers the whole window', async () => {
  const project = e05Project({ 'executions/list': serialRuns, 'goals/overlap-gates': () => answered({ gates: [coveringGate()] }) });
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' } });
  assert.equal(evidence.overlap.verdict.status, 'uncovered');
  assert.equal(evidence.overlap.verdict.code, 'not-run');
  assert.match(evidence.overlap.verdict.note, /门 m1/);
  assert.match(evidence.overlap.verdict.note, /10:05:30/);
  assert.match(evidence.overlap.verdict.note, /用尽/);
});

test('P6J3 E05: a claimable sample inside the conflict window is a missed chance even with a gate', async () => {
  const project = e05Project({ 'executions/list': serialRuns, 'goals/overlap-gates': () => answered({ gates: [coveringGate()] }) });
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' },
    claimable: { both: false, atStart: { 't-users': true, 't-orders': false },
      samples: [{ at: '2026-01-01T10:02:00Z', 't-users': false, 't-orders': true }] } });
  assert.equal(evidence.overlap.verdict.status, 'fail');
  assert.match(evidence.overlap.verdict.note, /10:02/);
});

test('P6J3 E05: a conflict Run without an end time is a gap, never "the gate used up the chance"', async () => {
  const project = e05Project({ 'executions/list': () => page([
    e05Run('t-users', 'u1', '2099-01-01T10:00:00Z', null),
    e05Run('t-orders', 'o1', '2099-01-01T10:06:00Z', '2099-01-01T10:10:00Z')]),
  'goals/overlap-gates': () => answered({ gates: [{ ...coveringGate(), release: { at: '2099-01-01T10:05:30Z' } }] }) });
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' } });
  assert.equal(evidence.overlap.verdict.status, 'uncovered');
  assert.equal(evidence.overlap.verdict.code, 'entry-missing');
  assert.match(evidence.overlap.verdict.note, /结束时刻/);
  assert.doesNotMatch(evidence.overlap.verdict.note, /用尽|耗尽/);
});

test('P6J3 E05: sparse no samples do not prove the whole window had no chance', async () => {
  const project = e05Project({ 'executions/list': serialRuns, 'goals/overlap-gates': () => answered({ gates: [] }) });
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' },
    claimable: { both: false, atStart: { 't-users': false, 't-orders': false },
      samples: [{ at: '2026-01-01T10:02:00Z', 't-users': false, 't-orders': false }] } });
  assert.equal(evidence.overlap.verdict.status, 'uncovered');
  assert.equal(evidence.overlap.verdict.code, 'entry-missing');
  assert.match(evidence.overlap.verdict.note, /稀疏|不能证明|缺/);
  assert.doesNotMatch(evidence.overlap.verdict.note, /机会不存在/);
});

test('P6J3 E05: a delete result is not also a write, and a delete without a write is insufficient', async () => {
  const records = [
    event('assistant.message_completed', { message: { messageId: 'm1', content: [] }, toolCalls: [
      { callId: 'c1', name: 'write_file', arguments: { path: 'src/scratch.js' } },
      { callId: 'c2', name: 'delete_file', arguments: { path: 'src/scratch.js' } },
      { callId: 'c3', name: 'delete_file', arguments: { path: 'src/gone.js' } }] }, 'k1', 't1'),
    event('tool.completed', { callId: 'c1', result: { status: 'success', output: [{ kind: 'json', value: { ok: true } }],
      effects: { changedPaths: ['src/scratch.js'] } } }, 'k1', 't1'),
    event('tool.completed', { callId: 'c2', result: { status: 'success', output: [{ kind: 'json', value: { ok: true } }],
      effects: { changedPaths: ['src/scratch.js'] } } }, 'k1', 't1'),
    event('tool.completed', { callId: 'c3', result: { status: 'success', output: [{ kind: 'json', value: { ok: true } }],
      effects: { changedPaths: ['src/gone.js'] } } }, 'k1', 't1'),
  ];
  const project = e05Project({ 'executions/list': serialRuns, 'executions/history': historyFor('u1', records) });
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' }, planDraft: { tasks: [] } });
  assert.deepEqual(evidence.temporaryPaths, ['src/scratch.js']);
  assert.equal(evidence.writtenPaths.includes('src/gone.js'), false, 'a delete-named result is never a write');
  assert.equal(evidence.writtenPaths.filter(path => path === 'src/scratch.js').length, 1);
  assert.ok(evidence.insufficient.some(entry => entry.path === 'src/gone.js'));
  assert.equal(evidence.temporary.status, 'uncovered');
  assert.equal(evidence.temporary.code, 'entry-missing');
  assert.match(evidence.temporary.note, /证据不足/);
});

test('P6J3 E05: a text that happens to say deleted is not a delete operation', async () => {
  const records = [
    event('assistant.message_completed', { message: { messageId: 'm1', content: [] },
      toolCalls: [{ callId: 'c1', name: 'project_source', arguments: { duplicates: true } }] }, 'k1', 't1'),
    event('tool.completed', { callId: 'c1', result: { status: 'success',
      output: [{ kind: 'text', text: '已删除 src/scratch.js' }], effects: { changedPaths: ['src/scratch.js'] } } }, 'k1', 't1'),
  ];
  const project = e05Project({ 'executions/list': serialRuns, 'executions/history': historyFor('u1', records) });
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' }, planDraft: { tasks: [] } });
  assert.deepEqual(evidence.temporaryPaths, []);
  assert.equal(evidence.temporary.status, 'uncovered');
  assert.equal(evidence.temporary.code, 'entry-missing');
  assert.match(evidence.temporary.note, /证据不足/);
});

const failingChecks = () => [
  { checkId: 'c-pass', outcome: 'PASS', phase: 'finished', reportRef: reportRef('art-pass') },
  { checkId: 'c-exit', outcome: 'FAIL', phase: 'finished', reportRef: reportRef('art-exit') },
  { checkId: 'c-signal', outcome: 'FAIL', phase: 'finished', reportRef: reportRef('art-signal') },
  { checkId: 'c-not-started', outcome: 'INCONCLUSIVE', phase: 'finished', reportRef: reportRef('art-not-started') },
];
const reportBodies = {
  'art-exit': { observation: { kind: 'executed', exitCode: 2, signal: null, timedOut: false, cancelled: false } },
  'art-signal': { observation: { kind: 'executed', exitCode: null, signal: 'SIGTERM', timedOut: false, cancelled: false } },
  'art-not-started': { observation: { kind: 'not_started', reason: 'sandbox_unavailable' } },
};
const materialsPage = (bodies = reportBodies) => input => {
  const body = bodies[input.ref?.artifactId];
  return body === undefined ? { status: 'not_found' } : answered({ body: JSON.stringify(body), ref: input.ref });
};

test('P6J3 E05: every failing check records its report exit/signal/non-start, and every round keeps chain.reverify', async () => {
  const reverify = { requestedBy: { kind: 'person', id: 'p1' }, actorClass: 'person', failureClass: 'check_failed',
    requestedAt: '2026-01-01T10:20:00Z', basis: { digest: 'd1' }, exemption: 'none', sourceChanged: false, newInputRefs: [], reason: null };
  const head = roundHead('u1', 'r1', failingChecks(), reverify);
  head.chain.rounds = [{ roundRef: head.roundRef }];
  const project = e05Project({ 'executions/list': serialRuns, 'verification/round': verificationPage({ u1: head }),
    'materials/open': materialsPage() });
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' }, planDraft: { tasks: [] } });
  const round = evidence.facts.rounds['t-users'][0].rounds[0];
  assert.deepEqual(round.reverify, reverify);
  assert.deepEqual(round.reports.map(report => report.checkId), ['c-exit', 'c-signal', 'c-not-started']);
  const byId = Object.fromEntries(round.reports.map(report => [report.checkId, report]));
  assert.equal(byId['c-exit'].exitCode, 2);
  assert.equal(byId['c-signal'].signal, 'SIGTERM');
  assert.equal(byId['c-not-started'].notStarted, 'sandbox_unavailable');
  assert.equal(evidence.facts.roundGaps.length, 0);
});

test('P6J3 E05: a report read that fails is a gap, not a silent check', async () => {
  const head = roundHead('u1', 'r1', [failingChecks()[1]]);
  head.chain.rounds = [{ roundRef: head.roundRef }];
  const project = e05Project({ 'executions/list': serialRuns, 'verification/round': verificationPage({ u1: head }),
    'materials/open': () => ({ status: 'rejected', code: 'unavailable', reason: 'store down' }) });
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' }, planDraft: { tasks: [] } });
  const report = evidence.facts.rounds['t-users'][0].rounds[0].reports[0];
  assert.match(report.unreadable, /rejected|unavailable|store down/);
  assert.ok(evidence.facts.roundGaps.some(gap => /materials\/open/.test(gap)));
});

test('P6J3 E05: a failing check without a reportRef is a named gap, not a silent skip', async () => {
  const head = roundHead('u1', 'r1', [{ checkId: 'c-no-report', outcome: 'FAIL', phase: 'finished', reportRef: null }]);
  head.chain.rounds = [{ roundRef: head.roundRef }];
  const project = e05Project({ 'executions/list': serialRuns, 'verification/round': verificationPage({ u1: head }),
    'materials/open': materialsPage() });
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' }, planDraft: { tasks: [] } });
  const round = evidence.facts.rounds['t-users'][0].rounds[0];
  assert.deepEqual(round.reports, []);
  assert.ok(evidence.facts.roundGaps.some(gap => /c-no-report/.test(gap) && /reportRef/.test(gap)));
});

test('P6J3 E05: the report chain writes the report facts, chain.reverify and temporary evidence to disk', async () => {
  const reverify = { requestedBy: { kind: 'platform' }, actorClass: 'platform', failureClass: 'check_failed',
    requestedAt: '2026-01-01T10:20:00Z', basis: { digest: 'd2' }, exemption: 'none', sourceChanged: false, newInputRefs: [], reason: 'retry' };
  const head = roundHead('u1', 'r1', failingChecks(), reverify);
  head.chain.rounds = [{ roundRef: head.roundRef }];
  const records = [
    event('assistant.message_completed', { message: { messageId: 'm1', content: [] }, toolCalls: [
      { callId: 'c1', name: 'write_file', arguments: { path: 'src/scratch.js' } },
      { callId: 'c2', name: 'delete_file', arguments: { path: 'src/scratch.js' } }] }, 'k1', 't1'),
    event('tool.completed', { callId: 'c1', result: { status: 'success', output: [{ kind: 'json', value: { ok: true } }],
      effects: { changedPaths: ['src/scratch.js'] } } }, 'k1', 't1'),
    event('tool.completed', { callId: 'c2', result: { status: 'success', output: [{ kind: 'json', value: { ok: true } }],
      effects: { changedPaths: ['src/scratch.js'] } } }, 'k1', 't1'),
  ];
  const root = mkdtempSync(join(tmpdir(), 'dsh-e05-'));
  const project = e05Project({ 'executions/list': serialRuns, 'verification/round': verificationPage({ u1: head }),
    'executions/history': historyFor('u1', records), 'materials/open': materialsPage() }, root);
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' }, planDraft: { tasks: [] } });
  const rec = new Record({ id: 'E05', rows: ['C-182'], checks: [{ id: 'overlap', rows: ['C-182'], text: '两个 Run 的重叠' }] });
  rec.fail('overlap', evidence.overlap.verdict.note);
  rec.facts.e05 = evidence.facts;
  rec.note(evidence.note);
  const ctx = { runId: 'run1', facts: { tree: 't', sourceDiffHash: null, docsVersion: null, os: 'linux', node: 'v1', kernelAdapter: 'k1' },
    cfg: { authorization: { text: 'auth' } } };
  const row = rowOf(ctx, { id: 'E05', rows: ['C-182'] }, rec, null, null);
  const dir = mkdtempSync(join(tmpdir(), 'dsh-report-'));
  const report = new Report(dir);
  report.rows = [row];
  report.rowNotes.E05 = rec.notes;
  report.writeAll({ date: '2026-01-01', runId: 'run1', tree: 't', dirty: false,
    startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:01:00Z', authorization: 'auth' });
  const saved = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
  const e05 = saved.scenarios[0].facts.e05;
  assert.deepEqual(e05.rounds['t-users'][0].rounds[0].reverify, reverify);
  const reports = e05.rounds['t-users'][0].rounds[0].reports;
  assert.equal(reports.find(report => report.checkId === 'c-exit').exitCode, 2);
  assert.equal(reports.find(report => report.checkId === 'c-signal').signal, 'SIGTERM');
  assert.equal(reports.find(report => report.checkId === 'c-not-started').notStarted, 'sandbox_unavailable');
  assert.deepEqual(e05.temporaryPaths, ['src/scratch.js']);
  const notes = readFileSync(join(dir, 'checks/notes.md'), 'utf8');
  assert.match(notes, /src\/scratch\.js/);
  assert.match(notes, /临时件/);
});

// ------------------------------------------------------------------------------------------------
// P6J3: intervention's found round, E12's two adopted-plan reads and stalled close, E09's chain.

test('P6J3 intervention: a failed read of another planning Query keeps the round found for this message', async () => {
  const project = { scope: A, host: { client: { read: async (route, _scope, input) => {
    if (route === 'lines/list') return answered({ rows: [{ key: { projectId: 'p', sessionId: 's1' } }] });
    if (route === 'sessions/queries') return answered({ items: [
      { ref: { aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'wa', queryJobId: 'intervention-planning-bad' }, run: { status: 'answered' } },
      { ref: { aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'wa', queryJobId: 'intervention-planning-good' }, run: { status: 'answered' } },
    ], nextCursor: null });
    if (route === 'queries/read' && input.queryJobId === 'intervention-planning-bad') return { status: 'rejected', code: 'unavailable', reason: 'store down' };
    if (route === 'queries/read') return answered({ job: { job: { queryJobId: 'intervention-planning-good',
      intent: { execution: { sourceMessageRef: { messageId: 'm1' } } } } }, run: { run: { status: 'answered' } } });
    if (route === 'decisions/queue') return answered({ waitingAnswer: [{ cardKey: 'cand-1', state: 'waiting',
      source: { kind: 'candidate' }, requestRef: { queryJobId: 'intervention-planning-good' } }], history: [] });
    if (route === 'messages/read') return answered({ status: 'pending', withdrawnAt: null });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const seen = await endingOf(project, { messageId: 'm1' }, { goalId: 'g' });
  assert.equal(seen.missing, undefined, 'a read failure on another Query must not cover the found one');
  assert.equal(seen.candidate.cardKey, 'cand-1');
  assert.equal(seen.job.job.job.queryJobId, 'intervention-planning-good');
  assert.ok(seen.readGaps.some(gap => /intervention-planning-bad/.test(gap)), 'the failed read stays named');
});

test('P6J3 intervention: each moment records availability, occupancy, the archive request and pending controls', async () => {
  let reject = false;
  const project = { scope: A, host: { client: { read: async route => {
    if (reject) return { status: 'rejected', code: 'unavailable', reason: 'store down' };
    switch (route) {
      case 'messages/view': return answered({ message: { acceptedInputs: [{ part: 'message' }] },
        delivery: { deliveredTo: { executionRef: { aggregateType: 'Run', runId: 'r1' } } }, disposition: { kind: 'delivered' } });
      case 'sessions/read': return answered({ record: { lifecycle: 'active', health: null, archiveRequest: { requestId: 'a1' } } });
      case 'executions/read': return answered({ run: { status: 'running', controlState: 'running', controlInputs: [], lastEventSeq: 5 } });
      case 'executions/list': return answered({ items: [{ run: { ref: { runId: 'r1' }, status: 'running', task: { taskId: 't1' },
        startedAt: '2026-01-01T10:00:00Z' }, outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's1' } } } }], nextCursor: null });
      case 'tasks/query': return answered({ tasks: [{ ref: { taskId: 't1' }, execution: { runId: 'r1', status: 'running' } }] });
      case 'lines/list': return answered({ rows: [{ key: { projectId: 'p', sessionId: 's1' },
        status: { own: 'working', attention: null, markers: [{ kind: 'archiving', archiveRequestId: 'a1' }] },
        controls: [{ kind: 'pause', availability: 'available', reasonCode: null, route: 'controls/submit' }] }] });
      default: throw new Error(`the fake Host does not answer ${route}`);
    }
  } } } };
  const timeline = { line: 's1', runRef: { runId: 'r1' } };
  const points = [
    await timelinePoint(project, timeline, 'before-pause', null, { goalId: 'g' }),
    await timelinePoint(project, timeline, 'after-resume', { messageId: 'm1' }, { goalId: 'g' }),
    await timelinePoint(project, timeline, 'before-cleanup', { messageId: 'm1' }, { goalId: 'g' }),
  ];
  for (const point of points) {
    assert.equal(point.availability.own, 'working');
    assert.equal(point.occupancy.running[0].runId, 'r1');
    assert.equal(point.occupancy.executionCard.runId, 'r1');
    assert.equal(point.archiveRequest.record.requestId, 'a1');
    assert.equal(point.pendingControls.controls[0].kind, 'pause');
  }
  reject = true;
  const failed = await messagePoint(project, { messageId: 'm1' }, { projectId: 'p', sessionId: 's1' }, { runId: 'r1' }, { goalId: 'g' });
  assert.equal(failed.availability, null);
  assert.equal(failed.occupancy, null);
  assert.equal(failed.archiveRequest, null);
  assert.equal(failed.pendingControls, null);
  assert.ok(failed.gaps.some(gap => /lines\/list/.test(gap)));
  assert.ok(failed.gaps.some(gap => /executions\/list/.test(gap)));
});

test('P6J3 E12: a timed-out wait still reports the adopted plan and its execution', async () => {
  const project = { scope: A, host: { client: { read: async () => answered({ tasks: [
    { ref: { taskId: 'w' }, definition: { taskKind: 'work', scope: { kind: 'goal' } },
      execution: { runId: 'r1' }, effectivePhase: 'ready' }] }) } } };
  const created = { plan: { aggregateType: 'Plan', planId: 'p-adopted' } };
  const closed = await closeWithWait(project, { goalId: 'g' }, created.plan, async () => { throw new WaitTimeout('90 分钟没有完成'); });
  assert.equal(closed.done, null);
  assert.equal(closed.final.stall, '90 分钟没有完成');
  assert.equal(closed.final.readable, true);
  assert.equal(closed.final.planRef.planId, 'p-adopted');
  assert.equal(closed.final.tasks[0].execution.runId, 'r1');
});

test('P6J3 E12: both reads pin the adopted plan ref from creation, not the current plan', async () => {
  const calls = [];
  const project = { scope: A, host: { client: { read: async (route, _scope, input) => {
    calls.push({ route, input });
    if (route === 'tasks/query') return answered({ plan: { ref: { planId: 'p-current' } }, tasks: [
      { ref: { taskId: 'w' }, definition: { taskKind: 'work', scope: { kind: 'goal' } }, execution: { runId: 'r1' }, effectivePhase: 'ready' }] });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const created = { plan: { aggregateType: 'Plan', planId: 'p-adopted' } };
  const adopted = await adoptionEvidence(project, { goalId: 'g' }, created);
  assert.deepEqual(adopted.evidence.planRef, created.plan);
  assert.deepEqual(calls.at(-1).input.planRef, created.plan);
  const closed = await closeWithWait(project, { goalId: 'g' }, created.plan, async () => { throw new WaitTimeout('timeout'); });
  assert.deepEqual(closed.final.planRef, created.plan);
  assert.deepEqual(calls.at(-1).input.planRef, created.plan);
});
// P6L E12: the old Goal's wait is attributed to `completion-chain` and keeps one same-version row pair (diagnosis
// E12 row, `run-7d2-p6l.md` item 4); `reads-quiet` never absorbs that timeout.
const E12_OLD_GOAL = { aggregateType: 'Goal', projectId: 'p', goalId: 'g-old' };
const E12_OLD_PLAN = { aggregateType: 'Plan', projectId: 'p', goalId: 'g-old', planId: 'p-old' };
const e12OldTasks = () => [
  { ref: { taskId: 'w' }, definition: { taskKind: 'work', scope: { kind: 'goal' } }, execution: { runId: 'r1' }, effectivePhase: 'ready' },
  { ref: { taskId: 'gate-1' }, definition: { taskKind: 'gate', scope: { kind: 'goal' } }, execution: null, effectivePhase: 'ready' }];
function e12OldProject({ phase = 'RUNNING', tasks = null } = {}) {
  return { scope: A, host: { client: { read: async (route, _scope, input) => {
    if (route === 'tasks/query') {
      assert.deepEqual(input.planRef, E12_OLD_PLAN, 'the old Goal read is pinned to the adoption receipt');
      return tasks === null ? answered({ plan: { ref: E12_OLD_PLAN }, tasks: e12OldTasks() }) : tasks;
    }
    if (route === 'goals/display') return answered({ display: { phase, causes: [] }, sourceCursor: 'c1' });
    if (route === 'decisions/queue') return answered({ waitingAnswer: [], answeredPendingApplication: [], capabilities: [] });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
}
const e12OldChecks = () => [{ id: 'reads-quiet', rows: ['C-36'], text: '读前后没有新执行' },
  { id: 'completion-chain', rows: ['C-104'], text: '从 Goal 完成走到检查轮证据' }, { id: 'restart-state', rows: ['C-145'], text: '重启后读回原 Goal' }];
const e12WaitCtx = rec => ({ budget: { tick: async () => {}, inFlight: () => ({ items: [], queries: 0, runs: 0 }) },
  report: { current: rec } });
test('P6L E12: the old Goal timing out fails completion-chain and leaves reads-quiet not-run', async () => {
  const rec = new Record({ id: 'E12', rows: ['C-104'], checks: e12OldChecks() });
  const closed = await waitOldGoalClosed(e12WaitCtx(rec), e12OldProject(), rec,
    { goalRef: E12_OLD_GOAL, planRef: E12_OLD_PLAN, timeoutMs: -1 });
  assert.equal(closed.done, null);
  const verdict = rec.results.get('completion-chain');
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.note, /timed out|completion-chain/);
  assert.equal(rec.results.has('reads-quiet'), false, 'the graph read never started, so it cannot own the timeout');
  rec.finish();
  assert.deepEqual(['reads-quiet', 'restart-state'].map(id => [rec.results.get(id).status, rec.results.get(id).code]),
    [['uncovered', 'not-run'], ['uncovered', 'not-run']]);
  assert.match(rec.facts.e12OldGoal.final.stall, /timed out/);
});
test('P6L E12: the adoption and closing rows keep the same plan version, scope, coverage and execution', async () => {
  const rec = new Record({ id: 'E12', rows: ['C-104'], checks: e12OldChecks() });
  const closed = await waitOldGoalClosed(e12WaitCtx(rec), e12OldProject({ phase: 'COMPLETED' }), rec,
    { goalRef: E12_OLD_GOAL, planRef: E12_OLD_PLAN });
  const at = rec.facts.e12OldGoal.atAdoption;
  const final = rec.facts.e12OldGoal.final;
  assert.deepEqual([closed.done === null, at.readable, final.readable, at.planRef, final.planRef],
    [false, true, true, E12_OLD_PLAN, E12_OLD_PLAN]);
  const fields = row => ({ taskId: row.taskId, taskKind: row.taskKind, scope: row.scope,
    coveredTaskIds: row.coveredTaskIds, execution: row.execution, effectivePhase: row.effectivePhase });
  assert.deepEqual(at.tasks.map(fields), final.tasks.map(fields));
  assert.deepEqual(at.tasks.find(row => row.taskId === 'w').execution, { runId: 'r1' });
  assert.deepEqual(at.tasks.find(row => row.taskId === 'gate-1').coveredTaskIds, ['w']);
  const saved = savedScenario(rec, { id: 'E12', rows: ['C-104'] });
  assert.deepEqual([saved.facts.e12OldGoal.atAdoption.planRef, saved.facts.e12OldGoal.final.tasks.map(row => row.scope)],
    [E12_OLD_PLAN, [{ kind: 'goal' }, { kind: 'goal' }]]);
});
test('P6L E12: a failed old-Goal task read is kept as the gap, with no fabricated execution', async () => {
  const rejected = { status: 'rejected', code: 'unavailable', reason: 'task store down' };
  const rec = new Record({ id: 'E12', rows: ['C-104'], checks: e12OldChecks() });
  await waitOldGoalClosed(e12WaitCtx(rec), e12OldProject({ tasks: rejected }), rec,
    { goalRef: E12_OLD_GOAL, planRef: E12_OLD_PLAN, timeoutMs: -1 });
  const at = rec.facts.e12OldGoal.atAdoption;
  const final = rec.facts.e12OldGoal.final;
  for (const row of [at, final]) {
    assert.deepEqual([row.readable, row.status, row.code, row.reason, row.planRef],
      [false, 'rejected', 'unavailable', 'task store down', E12_OLD_PLAN]);
    assert.equal('tasks' in row, false, 'a failed row read is a gap, never an empty task list');
  }
  rec.finish();
  assert.deepEqual([rec.results.get('completion-chain').status, rec.results.get('reads-quiet').status,
    rec.results.get('reads-quiet').code], ['fail', 'uncovered', 'not-run']);
});
// P6J4 E09 (quick check row 7): `sessions/queries` lists QueryRun snapshots (`session-facts-contracts.ts:95-96`) and
// `queries/read` takes only a complete QueryJobRef (`query-job-service.ts:1033-1036`); the fake answers both that way.
const E09_LETTER = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm1' };
// The letter's own planning Query id, computed by hand from the platform rule (`query-job.ts:193-203`): sha256 over the
// canonical JSON of the ref (keys sorted).
const E09_PLANNING_ID = `intervention-planning-${createHash('sha256')
  .update('{"aggregateType":"SessionMessage","messageId":"m1","projectId":"p","workspaceId":"wa"}').digest('hex')}`;
const queryJobRef = queryJobId => ({ aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'wa', queryJobId });
const queryRunRef = (queryJobId, runId) => ({ aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'wa', queryJobId, runId });
/** One stored Query as `queries/read` answers it: its Job (with the frozen source) and its QueryRun. */
const storedQuery = (queryJobId, { source, line = null, entered = false, kernel = null, status = 'running' }) => ({
  job: { ref: queryJobRef(queryJobId), job: { queryJobId, status, submittedAt: '2026-01-01T10:00:00Z', assignedSession: null, enteredSession: null,
    intent: { execution: { kind: 'intervention_planning', sourceMessageRef: source } } } },
  run: { ref: queryRunRef(queryJobId, `${queryJobId}-run`), run: { queryJobRef: queryJobRef(queryJobId), status, startedAt: entered ? '2026-01-01T10:00:05Z' : null,
    executionState: line === null ? null : { phase: entered ? 'entered' : 'claimed', sessionRef: { projectId: 'p', sessionId: line },
      entry: entered ? { kernel } : null, history: entered ? { kernel } : null } } },
});
/** A Host whose Query reads behave like the platform's: a QueryRun ref given to `queries/read` is refused. */
function e09Host(stored, { onLine = [], view = null, unreadable = [] } = {}) {
  const calls = [];
  const read = async (route, _scope, input) => {
    calls.push({ route, input });
    if (route === 'messages/view') return view ?? answered({ message: { acceptedInputs: [{ part: 'message' }], status: 'responded' },
      delivery: { delivery: 'delivered', deliveredTo: { executionRef: { aggregateType: 'Run', runId: 'r1' } } } });
    if (route === 'sessions/queries') return answered({ items: onLine.map(id => stored[id].run).map(run => ({ ...run, revision: 1, schemaVersion: 1 })), nextCursor: null });
    if (route === 'queries/read') {
      if (input?.aggregateType !== 'QueryJob' || typeof input.queryJobId !== 'string') return { status: 'rejected', code: 'invalid', reason: 'readQueryJob requires a complete QueryJobRef' };
      if (unreadable.includes(input.queryJobId)) return { status: 'rejected', code: 'unavailable', reason: 'store down' };
      return stored[input.queryJobId] === undefined ? { status: 'not_found' } : answered(stored[input.queryJobId]);
    }
    throw new Error(`the fake Host does not answer ${route}`);
  };
  return { calls, project: { scope: A, host: { client: { read } } } };
}

test('P6J4 E09: each Query is read by its exact Job ref, and only this letter\'s Queries on the recipient line are its wakes', async () => {
  const kernel = { runId: 'krun-1', turnId: 'kturn-1' };
  const stored = {
    'q-claim': storedQuery('q-claim', { source: E09_LETTER, line: 's1', entered: true, kernel }),
    'q-other': storedQuery('q-other', { source: { ...E09_LETTER, messageId: 'm-other' }, line: 's1', entered: true, kernel: { runId: 'krun-9', turnId: 'kturn-9' } }),
    [E09_PLANNING_ID]: storedQuery(E09_PLANNING_ID, { source: E09_LETTER, status: 'pending' }),
  };
  const { calls, project } = e09Host(stored, { onLine: ['q-claim', 'q-other'] });
  const received = [{ line: 's1', runId: 'krun-1', turnId: 'kturn-1', final: 'explained' }];
  const gaps = [];
  const { facts } = await chainEvidenceOf(project, { report: { ref: E09_LETTER, result: { name: 'send_session_message', args: {} } },
    recipient: 's1', received, rows: [{ key: { projectId: 'p', sessionId: 's1' } }], gaps });
  assert.ok(calls.filter(call => call.route === 'queries/read').every(call => call.input.aggregateType === 'QueryJob'), 'only Job refs are read');
  assert.deepEqual(facts.wakes.map(wake => wake.queryRef.queryJobId).sort(), [E09_PLANNING_ID, 'q-claim'].sort(), 'the unrelated Query is not a wake');
  const unclaimed = facts.wakes.find(wake => wake.queryRef.queryJobId === E09_PLANNING_ID);
  assert.equal(unclaimed.line, null);
  assert.equal(unclaimed.entered, false);
  assert.equal(unclaimed.submittedAt, '2026-01-01T10:00:00Z');
  const claimed = facts.wakes.find(wake => wake.queryRef.queryJobId === 'q-claim');
  assert.equal(claimed.entered, true);
  assert.deepEqual(facts.queries.map(query => query.queryRef.queryJobId), ['q-claim']);
  assert.equal(facts.queries[0].turnId, 'kturn-1', 'the platform runId is not the Kernel turn');
  assert.deepEqual(facts.gaps, []);
  assert.deepEqual(gaps, []);
});

test('P6J4 E09: a Query of the recipient line that cannot be read is a gap in the chain itself', async () => {
  const stored = { 'q-down': storedQuery('q-down', { source: E09_LETTER, line: 's1' }) };
  const { project } = e09Host(stored, { onLine: ['q-down'], unreadable: ['q-down'] });
  const gaps = [];
  const { facts } = await chainEvidenceOf(project, { report: { ref: E09_LETTER, result: { name: 'send_session_message', args: {} } },
    recipient: 's1', received: [], rows: [{ key: { projectId: 'p', sessionId: 's1' } }], gaps });
  assert.ok(facts.gaps.some(gap => /queries\/read q-down: rejected unavailable/.test(gap)), 'the chain names the failed read');
  assert.ok(gaps.some(gap => /q-down/.test(gap)), 'and so does the caller');
  assert.deepEqual(facts.wakes, []);
});

test('P6J4b E09: an ask_copy Query claimed on the letter\'s frozen read-only copy is this letter\'s wake', async () => {
  // `consultation.ts:538`: the copy question's Query is claimed on the derived child line, not on the recipient.
  const consultationId = `consultation-${createHash('sha256')
    .update('{"aggregateType":"SessionMessage","messageId":"m1","projectId":"p","workspaceId":"wa"}').digest('hex')}`;
  const kernel = { runId: 'krun-c', turnId: 'kturn-c' };
  const copyQuery = storedQuery(consultationId, { source: null, line: 's-copy', entered: true, kernel });
  copyQuery.job.job.intent.execution = { kind: 'semantic_query', consultation: { messageRef: E09_LETTER, recipient: { projectId: 'p', sessionId: 's1' },
    derivation: { childSessionRef: { projectId: 'p', sessionId: 's-copy' }, sourceSessionRef: { projectId: 'p', sessionId: 's1' } } } };
  const view = answered({ message: { acceptedInputs: [], status: 'pending', answeredBy: 'copy',
    consultationDerivation: { childSessionRef: { projectId: 'p', sessionId: 's-copy' } } }, delivery: { delivery: 'queued', deliveredTo: null } });
  const { calls, project } = e09Host({ [consultationId]: copyQuery }, { view, onLine: [] });
  const { facts } = await chainEvidenceOf(project, { report: { ref: E09_LETTER, result: { name: 'ask_copy', args: {} } },
    recipient: 's1', received: [], rows: [{ key: { projectId: 'p', sessionId: 's1' } }] });
  assert.deepEqual(facts.wakes.map(wake => [wake.queryRef.queryJobId, wake.line, wake.entered]), [[consultationId, 's-copy', true]]);
  assert.ok(calls.some(call => call.route === 'sessions/queries' && call.input.sessionRef.sessionId === 's-copy'), 'the copy line\'s Queries are read too');
});

test('P6J4b E09: the polls keep their own read gaps, and zero rounds with a failed read is unreadable, not "not handled yet"', async () => {
  let historyReads = 0;
  const stored = { [E09_PLANNING_ID]: storedQuery(E09_PLANNING_ID, { source: E09_LETTER, status: 'pending' }) };
  const base = e09Host(stored, { onLine: [] }).project.host.client.read;
  const project = { scope: A, host: { client: { read: async (route, scope, input) => {
    if (route === 'sessions/history') {
      historyReads += 1;
      return historyReads === 1 ? answered({ items: [], nextCursor: null }) : { status: 'rejected', code: 'unavailable', reason: 'history store down' };
    }
    if (route === 'executions/list') return answered({ items: [], nextCursor: null });
    return base(route, scope, input);
  } } } };
  const rec = new Record({ id: 'E09', rows: ['C-211'], checks: [{ id: 'adviser-explains', rows: ['C-211'], text: '参谋解释' }] });
  const adviserRows = [{ key: { projectId: 'p', sessionId: 's1' }, duty: 'adviser' }];
  // The letter's own wake is still pending, so the zero-round first read is followed; the later reads fail.
  const followed = await E09.followReceived(quietCtx(rec), project, { report: { ref: E09_LETTER, result: { name: 'send_session_message', args: {} } },
    recipient: 's1', adviserRows, goalRef: { goalId: 'g' }, waitMs: 30, everyMs: 5 });
  assert.ok(historyReads >= 2, 'followed while the wake was in flight');
  assert.deepEqual(followed.received, []);
  assert.ok(followed.gaps.some(gap => /sessions\/history s1/.test(gap) && /history store down/.test(gap)), 'the last poll\'s gap is kept');
  const verdict = E09.adviserExplainsVerdict({ reportRef: E09_LETTER, recipient: 's1', received: followed.received, explained: undefined,
    copy: null, readGaps: followed.gaps, copyNamesBoth: false });
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'env-unavailable');
  assert.doesNotMatch(verdict.note, /还没处理/);
  const complete = E09.adviserExplainsVerdict({ reportRef: E09_LETTER, recipient: 's1', received: [], explained: undefined, copy: null, readGaps: [], copyNamesBoth: false });
  assert.equal(complete.code, 'not-run');
});

test('P6J3 E09: a failed acceptance re-read clears delivery and deliveredTo instead of the old snapshot', async () => {
  const { project } = e09Host({}, { view: { status: 'rejected', code: 'unavailable', reason: 'store down' } });
  const stale = { delivery: { delivery: 'delivered', deliveredTo: { executionRef: { aggregateType: 'Run', runId: 'r-old' } } } };
  const { facts, acceptedReadable } = await chainEvidenceOf(project, { report: { ref: E09_LETTER,
    result: { name: 'send_session_message', args: {} }, view: stale }, recipient: 's1', received: [], rows: [{ key: { projectId: 'p', sessionId: 's1' } }] });
  assert.equal(acceptedReadable, false);
  assert.equal(facts.accepted.delivery, null);
  assert.equal(facts.accepted.deliveredTo, null);
  assert.deepEqual(facts.accepted.acceptedInputs, []);
  assert.equal(facts.accepted.readable, false);
  // P6J4: the failed re-read is written into the chain, not only into the caller's list.
  assert.ok(facts.gaps.some(gap => /messages\/view m1: rejected unavailable/.test(gap)));
});

// ------------------------------------------------------------------------------------------------
// P6J4: the rows Sol's third quick check left open. Each cell drives the production code through a fake Host; the
// namespace imports keep this file loadable on a tree that lacks a new export (that cell alone goes red there).

import * as E05 from '../scenarios/e05.mjs';
import * as E06 from '../scenarios/e06.mjs';
import * as E09 from '../scenarios/e09.mjs';
import * as E12 from '../scenarios/e12.mjs';
import * as INT from '../scenarios/int.mjs';
import * as WAIT from '../scenarios/wait.mjs';

test('P6L2 E09: the first case keeps both assignment texts and the plan revision, without inferring a lost conflict', () => {
  const plan = (revision, assignments) => ({
    ref: { aggregateType: 'PlanRevision', projectId: 'p', planId: 'g9-plan' }, planRevision: revision, assignments });
  const conflicting = E09.firstCaseJudgement(plan(3, [
    { taskId: 'a', instruction: '在 src/api.js 实现 parseDate(text)，返回 Date 对象；发现接口冲突先上报参谋，由我决定。' },
    { taskId: 'b', instruction: '在 src/report.js 实现 monthOf(text)，用 parseDate，但需要它返回 {y, m, d}；发现接口冲突先上报参谋，由我决定。' }]));
  assert.equal(conflicting.status, 'fail', 'the criterion is unchanged: a first plan that keeps the conflict still fails when no executor reported');
  assert.equal(conflicting.facts.planRevision, 3);
  assert.deepEqual(conflicting.facts.assignments.map(entry => entry.taskId), ['a', 'b']);
  assert.match(conflicting.facts.assignments[0].instruction, /Date 对象/);
  assert.match(conflicting.facts.assignments[1].instruction, /\{y, m, d\}/);
  const unified = E09.firstCaseJudgement(plan(4, [
    { taskId: 'a', instruction: '在 src/api.js 实现并导出 parseDate(text)，返回 Date 对象。' },
    { taskId: 'b', instruction: '在 src/report.js 实现 monthOf(text)，用 parseDate，它返回 Date 对象。' }]));
  assert.equal(unified.status, 'uncovered');
  assert.equal(unified.code, 'not-run');
  assert.equal('conflictLostAtRevision' in unified.facts, false, 'no unified-interface inference is written');
  assert.doesNotMatch(unified.note, /统一|丢失/);
  assert.deepEqual(unified.facts.assignments.map(entry => entry.instruction), [
    '在 src/api.js 实现并导出 parseDate(text)，返回 Date 对象。',
    '在 src/report.js 实现 monthOf(text)，用 parseDate，它返回 Date 对象。']);
});

const REPORT_CTX = { runId: 'run1', facts: { tree: 't', sourceDiffHash: null, docsVersion: null, os: 'linux', node: 'v1', kernelAdapter: 'k1' },
  cfg: { authorization: { text: 'auth' } } };
/** The unit's record written the production way (`rowOf` → `Report.writeAll`), read back from `result.json`. */
function savedScenario(rec, def) {
  const dir = mkdtempSync(join(tmpdir(), 'p6j4-report-'));
  const report = new Report(dir);
  report.rows = [rowOf(REPORT_CTX, def, rec, null, null)];
  report.rowNotes[def.id] = rec.notes;
  report.writeAll({ date: '2026-01-01', runId: 'run1', tree: 't', dirty: false,
    startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:01:00Z', authorization: 'auth' });
  return JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')).scenarios[0];
}
const eventAt = (at, type, payload, runId, turnId) => ({ recordType: 'agent.event',
  payload: { event: { type, payload, meta: { runId, turnId, occurredAt: at } } } });
const quietCtx = rec => ({ budget: { tick: async () => {} }, report: { current: rec } });

// ---- E05 overlap (quick check row 1)

test('P6J4 E05: both claimable before the start, but a module gate held the second Task until the first Run ended, is not a fail', async () => {
  const project = e05Project({ 'executions/list': serialRuns, 'goals/overlap-gates': () => answered({ gates: [coveringGate()] }) });
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' },
    claimable: { both: true, atStart: { 't-users': true, 't-orders': true }, samples: [] } });
  assert.equal(evidence.overlap.verdict.status, 'uncovered');
  assert.equal(evidence.overlap.verdict.code, 'not-run');
  assert.match(evidence.overlap.verdict.note, /门 m1/);
  assert.match(evidence.overlap.verdict.note, /用尽/);
});

test('P6J4 E05: with no gate at all, both claimable before the start still proves the missed chance', async () => {
  const project = e05Project({ 'executions/list': serialRuns, 'goals/overlap-gates': () => answered({ gates: [] }) });
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' },
    claimable: { both: true, atStart: { 't-users': true, 't-orders': true }, samples: [] } });
  assert.equal(evidence.overlap.verdict.status, 'fail');
  // A gate list that could not be read cannot confirm there was no gate: the start-time reading does not decide then.
  const blind = e05Project({ 'executions/list': serialRuns, 'goals/overlap-gates': () => ({ status: 'rejected', code: 'unavailable' }) });
  const unread = await e05Evidence({ project: blind, goalRef: { goalId: 'g' },
    claimable: { both: true, atStart: { 't-users': true, 't-orders': true }, samples: [] } });
  assert.equal(unread.overlap.verdict.status, 'uncovered');
  assert.equal(unread.overlap.verdict.code, 'entry-missing');
});

/** A rework Run: a new Attempt whose Run names the Run whose lease it took (`contracts/dispatch.ts:292`). */
const reworkRun = (taskId, runId, startedAt, endedAt, previousRunId) => {
  const item = e05Run(taskId, runId, startedAt, endedAt);
  item.run.previousRun = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: previousRunId };
  return item;
};
const reworkRuns = () => page([
  e05Run('t-users', 'u1', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z'),
  e05Run('t-orders', 'o1', '2026-01-01T10:06:00Z', '2026-01-01T10:10:00Z'),
  reworkRun('t-users', 'u2', '2026-01-01T10:11:00Z', '2026-01-01T10:20:00Z', 'u1'),
  reworkRun('t-orders', 'o2', '2026-01-01T10:21:00Z', '2026-01-01T10:30:00Z', 'o1')]);
// The real rework gate: opened while t-orders still had its old Attempt (a-o1, `workflow.ts:2573`); the claim it held
// back made a new Attempt, whose Run o2 names o1 as `previousRun`.
const reworkGate = (extra = {}) => ({ ref: { aggregateType: 'ModuleOverlapGate', projectId: 'p', goalId: 'g', taskId: 't-orders', moduleId: 'm1' },
  moduleId: 'm1', planRevision: 1, since: 'c9', basisDigest: 'b-rework', waiting: { taskId: 't-orders' }, waitingAttempt: 'a-o1',
  running: [{ task: { taskId: 't-users' }, run: { runId: 'u2' } }], release: null, ...extra });

test('P6J4 E05: a running sample is aligned with the gate\'s own Runs, so a rework Run the gate held back is judged', async () => {
  // The first Runs were serial without a gate; the gate came on the rework and held t-orders' new Attempt (o2) behind
  // t-users' rework Run (u2). The sample read wholly inside u2 shows t-orders claimable before o2 started.
  const project = e05Project({ 'executions/list': reworkRuns, 'goals/overlap-gates': () => answered({ gates: [reworkGate()] }) });
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' },
    claimable: { both: false, atStart: { 't-users': true, 't-orders': false },
      samples: [{ at: '2026-01-01T10:15:00Z', until: '2026-01-01T10:15:01Z', 't-users': false, 't-orders': true }] } });
  assert.equal(evidence.overlap.verdict.status, 'fail');
  assert.match(evidence.overlap.verdict.note, /10:15/);
  assert.match(evidence.overlap.verdict.note, /u2/);
  assert.match(evidence.overlap.verdict.note, /o2/);
});

test('P6J4b E05: a gate naming the old Attempt holds back its successor by previousRun; no successor is a named gap', async () => {
  // Released while u2 still ran, o2 waited until u2 ended: a missed chance, judged on o2, not on the old Run o1.
  const released = e05Project({ 'executions/list': reworkRuns,
    'goals/overlap-gates': () => answered({ gates: [reworkGate({ release: { at: '2026-01-01T10:12:00Z' } })] }) });
  const missed = (await e05Evidence({ project: released, goalRef: { goalId: 'g' } })).overlap.verdict;
  assert.equal(missed.status, 'fail');
  assert.match(missed.note, /被拦的 o2/);
  // The old Attempt's Run has no successor in what was read: the gate cannot be attributed.
  const noSuccessor = () => page([
    e05Run('t-users', 'u1', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z'),
    e05Run('t-orders', 'o1', '2026-01-01T10:06:00Z', '2026-01-01T10:10:00Z'),
    reworkRun('t-users', 'u2', '2026-01-01T10:11:00Z', '2026-01-01T10:20:00Z', 'u1')]);
  const unmatched = e05Project({ 'executions/list': noSuccessor,
    'goals/overlap-gates': () => answered({ gates: [reworkGate({ release: { at: '2026-01-01T10:12:00Z' } })] }) });
  const gap = (await e05Evidence({ project: unmatched, goalRef: { goalId: 'g' } })).overlap.verdict;
  assert.equal(gap.status, 'uncovered');
  assert.equal(gap.code, 'entry-missing');
  assert.match(gap.note, /previousRun/);
});

test('P6J4b E05: each gate record is judged on its own; a later rework gate released early still fails', async () => {
  // The first-claim gate (basis b-first) used its chance up; the same ref reopened for the rework (basis b-rework) was
  // released while u2 still ran. Both records are kept and judged one by one.
  const first = { ...reworkGate(), basisDigest: 'b-first', waitingAttempt: 'none', running: [{ task: { taskId: 't-users' }, run: { runId: 'u1' } }],
    release: { at: '2026-01-01T10:05:30Z' } };
  const rework = reworkGate({ release: { at: '2026-01-01T10:12:00Z' } });
  const project = e05Project({ 'executions/list': reworkRuns, 'goals/overlap-gates': () => answered({ gates: [first, rework] }) });
  const verdict = (await e05Evidence({ project, goalRef: { goalId: 'g' } })).overlap.verdict;
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.note, /10:12/);
});

test('P6J4b E05: the run keeps one record per gate ref and basis, each with its own release', async () => {
  const seen = { gates: new Map(), firstSeen: new Map(), released: new Map() };
  const releases = [];
  const release = async gate => { releases.push(gate.basisDigest); return { status: 'released' }; };
  const t0 = Date.parse('2026-01-01T10:00:00Z');
  const first = { ...reworkGate(), basisDigest: 'b-first', revision: 1 };
  await E05.observeGates(seen, [first], { now: t0, release });
  await E05.observeGates(seen, [{ ...first, revision: 2, release: { at: '2026-01-01T10:05:30Z' } }], { now: t0 + 60_000, release });
  // The same ref reopened with a new basis: a second record, not an overwrite of the first one's release.
  await E05.observeGates(seen, [reworkGate({ revision: 3 })], { now: t0 + 120_000, release });
  await E05.observeGates(seen, [reworkGate({ revision: 3 })], { now: t0 + 120_000 + 11 * 60_000, release });
  const kept = [...seen.gates.values()];
  assert.deepEqual(kept.map(gate => gate.basisDigest), ['b-first', 'b-rework']);
  assert.equal(kept[0].release.at, '2026-01-01T10:05:30Z', 'the first record keeps its own release');
  assert.equal(kept[1].release, null);
  assert.deepEqual(releases, ['b-rework'], 'only the record nobody satisfied for 10 minutes gets the person\'s release');
});

test('P6J4b E05: a sample whose reading straddles the conflict Run\'s end proves nothing', async () => {
  // u1 ends at 10:05:00; the reading began at 10:04:59 and ended at 10:05:01, so "claimable" may be after u1 ended.
  const project = e05Project({ 'executions/list': serialRuns, 'goals/overlap-gates': () => answered({ gates: [] }) });
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' },
    claimable: { both: false, atStart: { 't-users': true, 't-orders': false },
      samples: [{ at: '2026-01-01T10:04:59Z', until: '2026-01-01T10:05:01Z', 't-users': false, 't-orders': true }] } });
  assert.equal(evidence.overlap.verdict.status, 'uncovered');
  assert.equal(evidence.overlap.verdict.code, 'entry-missing');
});

// ---- E05 temporary files from the real tool replies (quick check row 1)

test('P6J4 E05: the real edit and shell replies, in the order they were recorded, name a temporary file and its removal', async () => {
  // Kernel `edit` (mode create) writes; `shell` reports only changed paths, so only its command's `rm` names the delete.
  // The Runs are listed with t-orders first, but the write came first in time.
  const users = [
    eventAt('2026-01-01T10:02:00Z', 'assistant.message_completed', { message: { messageId: 'm1', content: [] }, toolCalls: [
      { callId: 'c1', name: 'edit', arguments: { mode: 'create', path: 'src/tmp-probe.js', newText: 'console.log(1)\n' } }] }, 'k1', 't1'),
    eventAt('2026-01-01T10:02:01Z', 'tool.completed', { callId: 'c1', result: { status: 'success', output: [{ kind: 'text', text: '--- a/src/tmp-probe.js' },
      { kind: 'json', value: { path: 'src/tmp-probe.js', oldRevision: null, newRevision: 'r', changedBytes: 15 } }],
    effects: { sideEffect: 'applied', changedPaths: ['src/tmp-probe.js'] } } }, 'k1', 't1'),
  ];
  const orders = [
    eventAt('2026-01-01T10:07:00Z', 'assistant.message_completed', { message: { messageId: 'm2', content: [] }, toolCalls: [
      { callId: 'c2', name: 'shell', arguments: { command: 'node src/tmp-probe.js && rm -f src/tmp-probe.js' } }] }, 'k2', 't2'),
    eventAt('2026-01-01T10:07:01Z', 'tool.completed', { callId: 'c2', result: { status: 'success',
      output: [{ kind: 'text', text: '1\n' }], effects: { sideEffect: 'applied', changedPaths: ['src/tmp-probe.js'] } } }, 'k2', 't2'),
  ];
  const listed = () => page([e05Run('t-orders', 'o1', '2026-01-01T10:06:00Z', '2026-01-01T10:10:00Z'),
    e05Run('t-users', 'u1', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z')]);
  const histories = input => (input.runRef?.runId === 'u1' ? historyPage(users)() : input.runRef?.runId === 'o1' ? historyPage(orders)() : page([]));
  const project = e05Project({ 'executions/list': listed, 'executions/history': histories }, mkdtempSync(join(tmpdir(), 'p6j4-e05-')));
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' }, planDraft: { tasks: [] } });
  assert.deepEqual(evidence.temporaryPaths, ['src/tmp-probe.js']);
  assert.deepEqual(evidence.writtenPaths, ['src/tmp-probe.js'], 'the shell delete is not also a write');
  assert.deepEqual(evidence.insufficient, []);
  assert.equal(evidence.temporary.status, 'pass');
});

test('P6J4 E05: a shell change no recognizable delete follows, gone at the end, is a named gap, not "no temporary file"', async () => {
  const records = [
    eventAt('2026-01-01T10:02:00Z', 'assistant.message_completed', { message: { messageId: 'm1', content: [] }, toolCalls: [
      { callId: 'c1', name: 'shell', arguments: { command: 'printf x > scratch.txt' } },
      { callId: 'c2', name: 'shell', arguments: { command: 'git clean -fd' } }] }, 'k1', 't1'),
    eventAt('2026-01-01T10:02:01Z', 'tool.completed', { callId: 'c1', result: { status: 'success', output: [],
      effects: { changedPaths: ['scratch.txt'] } } }, 'k1', 't1'),
    eventAt('2026-01-01T10:02:02Z', 'tool.completed', { callId: 'c2', result: { status: 'success', output: [],
      effects: { changedPaths: ['scratch.txt'] } } }, 'k1', 't1'),
  ];
  const project = e05Project({ 'executions/list': serialRuns, 'executions/history': historyFor('u1', records) }, mkdtempSync(join(tmpdir(), 'p6j4-e05-')));
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' }, planDraft: { tasks: [] } });
  assert.deepEqual(evidence.temporaryPaths, []);
  assert.ok(evidence.insufficient.some(entry => entry.path === 'scratch.txt'));
  assert.equal(evidence.temporary.status, 'uncovered');
  assert.equal(evidence.temporary.code, 'entry-missing');
});

/** One Run's history: `edit` creates `path`, then one `shell` call with `command` reports `path` changed. */
const editThenShell = (path, command) => [
  eventAt('2026-01-01T10:02:00Z', 'assistant.message_completed', { message: { messageId: 'm1', content: [] }, toolCalls: [
    { callId: 'c1', name: 'edit', arguments: { mode: 'create', path, newText: 'x\n' } },
    { callId: 'c2', name: 'shell', arguments: { command } }] }, 'k1', 't1'),
  eventAt('2026-01-01T10:02:01Z', 'tool.completed', { callId: 'c1', result: { status: 'success', output: [], effects: { changedPaths: [path] } } }, 'k1', 't1'),
  eventAt('2026-01-01T10:02:02Z', 'tool.completed', { callId: 'c2', result: { status: 'success', output: [], effects: { changedPaths: [path] } } }, 'k1', 't1'),
];

test('P6J4b E05: an rm inside quotes is text, not a delete, so a file written that way is never a false fail', async () => {
  const root = mkdtempSync(join(tmpdir(), 'p6j4b-e05-'));
  writeFileSync(join(root, 'tmp.js'), 'note; rm tmp.js; ok');
  const records = editThenShell('tmp.js', "printf '%s' 'note; rm tmp.js; ok' > tmp.js");
  const project = e05Project({ 'executions/list': serialRuns, 'executions/history': historyFor('u1', records) }, root);
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' }, planDraft: { tasks: [] } });
  assert.deepEqual(evidence.temporaryPaths, []);
  assert.notEqual(evidence.temporary.status, 'fail');
  assert.deepEqual(E05.shellCommands("printf '%s' 'note; rm tmp.js; ok' > tmp.js").map(words => words[0].text), ['printf']);
  // A top-level rm still counts, and a command this reading cannot follow names no delete at all.
  assert.equal(E05.shellDeletes({ command: "node a.js && rm -f 'tmp dir'/x.js" })('tmp dir/x.js'), true);
  assert.equal(E05.shellDeletes({ command: 'echo "$(rm tmp.js)"' })('tmp.js'), false);
  assert.equal(E05.shellDeletes({ command: 'rm a.js > out.log' })('out.log'), false, 'a redirection target is not an operand');
});

test('P6J4b E05: a recognized delete of a file still there at the end, never written again, is a gap, not a fail', async () => {
  const root = mkdtempSync(join(tmpdir(), 'p6j4b-e05-'));
  writeFileSync(join(root, 'scratch.js'), 'x\n');
  const project = e05Project({ 'executions/list': serialRuns, 'executions/history': historyFor('u1', editThenShell('scratch.js', 'rm scratch.js')) }, root);
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' }, planDraft: { tasks: [] } });
  assert.equal(evidence.temporary.status, 'uncovered');
  assert.equal(evidence.temporary.code, 'entry-missing');
  assert.ok(evidence.insufficient.some(entry => entry.path === 'scratch.js' && /还在/.test(entry.why)));
});

// ---- E05 evidence written by the production entry (quick check row 6)

test('P6J4 E05: an older round the Host refuses is a named gap in result.json, written by the production entry', async () => {
  const head = roundHead('u1', 'r2', failingChecks());
  const older = { ...head.roundRef, roundId: 'r1' };
  head.chain.rounds = [{ roundRef: older }, { roundRef: head.roundRef }];
  const rounds = input => (input.roundRef !== undefined ? { status: 'rejected', code: 'unavailable', reason: 'round store down' }
    : verificationPage({ u1: head })(input));
  const project = e05Project({ 'executions/list': serialRuns, 'verification/round': rounds, 'materials/open': materialsPage() });
  const evidence = await e05Evidence({ project, goalRef: { goalId: 'g' }, planDraft: { tasks: [] } });
  const rec = new Record({ id: 'E05', rows: ['C-182'], checks: [{ id: 'overlap', rows: ['C-182'], text: '重叠' }] });
  rec.uncover('overlap', 'entry-missing', evidence.overlap.verdict.note);
  E05.recordE05Evidence(rec, evidence);
  const saved = savedScenario(rec, { id: 'E05', rows: ['C-182'] });
  assert.ok(saved.facts.e05.roundGaps.some(gap => /r1/.test(gap) && /u1/.test(gap) && /unavailable/.test(gap) && /round store down/.test(gap)),
    `the older round's refusal is in result.json: ${JSON.stringify(saved.facts.e05.roundGaps)}`);
  assert.equal(saved.facts.e05.rounds['t-users'][0].rounds.length, 1, 'only the head round was readable');
});

// ---- P6L: the seed's failed re-verification and a refused model-written candidate (diagnosis E05, next-run item 1)

test('P6L E05: a failed seed re-verification keeps its check, exit, paths and error in facts', async () => {
  const head = roundHead('s1', 'r1', [{ checkId: 'c-only-readme', outcome: 'FAIL', phase: 'finished',
    reportRef: reportRef('art-only-readme') }]);
  head.chain.rounds = [{ roundRef: head.roundRef }];
  const project = e05Project({
    'tasks/query': () => answered({ tasks: [{ ref: { taskId: 't1' }, definition: { taskKind: 'work' } }] }),
    'executions/list': () => page([e05Run('t1', 's1', '2026-01-01T10:00:00Z', '2026-01-01T10:10:00Z')]),
    'verification/round': verificationPage({ s1: head }),
    'materials/open': () => answered({ ref: reportRef('art-only-readme'), body: JSON.stringify({ observation: {
      kind: 'executed', exitCode: 1, signal: null, timedOut: false, cancelled: false,
      stdout: { text: ' M README.md\n?? src/users.js\n', totalBytes: 31, truncated: false },
      stderr: { text: 'the workspace changed more than README.md', totalBytes: 38, truncated: false },
      effects: { workspaceRevision: 'w1', changedPaths: ['README.md', 'src/users.js'] } } }) }),
  });
  const facts = await E05.seedEvidence(project, { goalId: 'g-seed' });
  const rec = new Record({ id: 'E05', rows: ['C-182'], checks: [{ id: 'overlap', rows: ['C-182'], text: '两个 Run 的重叠' }] });
  rec.facts.seed = facts;
  const saved = savedScenario(rec, { id: 'E05', rows: ['C-182'] });
  const failure = saved.facts.seed.failures[0];
  assert.equal(failure.taskId, 't1');
  assert.equal(failure.reports[0].checkId, 'c-only-readme');
  assert.equal(failure.reports[0].exitCode, 1);
  assert.deepEqual(failure.reports[0].paths, ['README.md', 'src/users.js']);
  assert.equal(failure.reports[0].stderr.text, 'the workspace changed more than README.md');
  assert.equal(failure.reports[0].stdout.truncated, false);
  assert.equal(failure.reports[0].stdout.text, ' M README.md\n?? src/users.js\n');
});

test('P6L E05: a refused model-written candidate keeps author, entry, its checks and the raw receipt, then stops not-run', async () => {
  const candidate = {
    cardKey: 'candidate:prop1',
    source: { kind: 'candidate', pins: [
      { ref: { aggregateType: 'Goal', projectId: 'p', goalId: 'g5' }, revision: 3 },
      { ref: { aggregateType: 'PlanProposal', projectId: 'p', workspaceId: 'wa', proposalId: 'prop1' }, revision: 2 }] },
    actions: ['answer', 'adopt', 'abandon'], options: [],
  };
  const proposal = {
    basedOn: { aggregateType: 'PlanRevision', projectId: 'p', planId: 'g5-plan' },
    draft: { planId: 'g5-plan', planRevision: 2 },
    checks: [{ checkId: 'c-only-readme', command: 'git status --porcelain', cwd: '.', timeoutMs: 1000 }],
    requestRef: { aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'wa', queryJobId: 'q1' },
  };
  const project = { scope: A, host: { client: {
    read: async route => {
      if (route === 'goals/display') return answered({ display: { phase: 'RUNNING' } });
      if (route === 'decisions/queue') return answered({ waitingAnswer: [candidate], answeredPendingApplication: [] });
      if (route === 'plans/proposal') return answered(proposal);
      return { status: 'not_found' };
    },
    write: async route => route === 'plans/apply'
      ? { status: 'invalid', code: 'invalid', reason: 'the candidate does not install the check c-only-readme (the installed one differs)' }
      : { status: 'committed' },
  } } };
  const rec = new Record({ id: 'E05', rows: ['C-182'], checks: [{ id: 'overlap', rows: ['C-182'], text: '重叠' }] });
  const ctx = { budget: { tick: async () => {} }, report: { current: rec } };
  const stop = await waitGoal(ctx, project, { goalId: 'g5' }, { timeoutMs: 1, rec, adoptCandidates: true, check: null })
    .then(() => null, error => error);
  assert.equal(stop.code, 'not-run');
  const refused = rec.facts.refusedAdoptions[0];
  assert.equal(refused.author, null, 'a Host-written candidate has no submittedBy');
  assert.deepEqual(refused.entry, { requestRef: proposal.requestRef, sourceMessageRef: null, sourcePart: null },
    'the entry it was submitted through is the request root');
  assert.deepEqual(refused.checks, proposal.checks);
  assert.ok(rec.notes.some(note => note.includes('c-only-readme')),
    `the note names the real checkId, not an id that is not there: ${rec.notes.join('；')}`);
  assert.equal(refused.receipt.status, 'invalid');
  assert.equal(refused.receipt.code, 'invalid');
  assert.match(refused.receipt.reason, /c-only-readme/);
  assert.match(refused.receipt.text, /the installed one differs/);
  assert.ok(rec.notes.some(note => /候选由模型写/.test(note) && /不自造检查 ID/.test(note)),
    `the note says the driver-authored branch does not apply: ${rec.notes.join(' | ')}`);
  rec.finish(stop);
  assert.deepEqual(rec.checks().map(check => [check.status, check.code]), [['uncovered', 'not-run']]);
});

test('P6L E05: a refused seed adoption still keeps the failing seed round before the stop propagates', async () => {
  const candidate = {
    cardKey: 'candidate:prop-seed',
    source: { kind: 'candidate', pins: [
      { ref: { aggregateType: 'Goal', projectId: 'p', goalId: 'g-seed' }, revision: 3 },
      { ref: { aggregateType: 'PlanProposal', projectId: 'p', workspaceId: 'wa', proposalId: 'prop-seed' }, revision: 2 }] },
    actions: ['answer', 'adopt', 'abandon'], options: [],
  };
  const proposal = {
    basedOn: { aggregateType: 'PlanRevision', projectId: 'p', planId: 'g-seed-plan' },
    draft: { planId: 'g-seed-plan', planRevision: 2 },
    checks: [{ id: 'c-only-readme', command: 'git status --porcelain', cwd: '.', timeoutMs: 1000 }],
    submittedBy: { schemaVersion: 1, runRef: { aggregateType: 'Run', projectId: 'p', workspaceId: 'wa', goalId: 'g-seed', runId: 'r-author' },
      sessionRef: { projectId: 'p', workspaceId: 'wa', sessionId: 's-author' } },
    requestRef: { aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'wa', queryJobId: 'q1' },
    sourceMessageRef: { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm1' },
    sourcePart: 'decision_answer',
  };
  const head = roundHead('r-seed', 'round-seed', [{ checkId: 'c-only-readme', outcome: 'FAIL', phase: 'finished',
    reportRef: reportRef('art-only-readme') }]);
  head.chain.rounds = [{ roundRef: head.roundRef }];
  const project = e05Project({
    'goals/display': () => answered({ display: { phase: 'RUNNING' } }),
    'decisions/queue': () => answered({ waitingAnswer: [candidate], answeredPendingApplication: [] }),
    'plans/proposal': () => answered(proposal),
    'tasks/query': () => answered({ tasks: [{ ref: { taskId: 't1' }, definition: { taskKind: 'work' } }] }),
    'executions/list': () => page([e05Run('t1', 'r-seed', '2026-01-01T10:00:00Z', '2026-01-01T10:10:00Z')]),
    'verification/round': verificationPage({ 'r-seed': head }),
    'materials/open': () => answered({ ref: reportRef('art-only-readme'), body: JSON.stringify({ observation: {
      kind: 'executed', exitCode: 1, signal: null, timedOut: false, cancelled: false,
      stdout: { text: ' M README.md\n?? src/users.js\n', totalBytes: 31, truncated: false },
      stderr: { text: 'the workspace changed more than README.md', totalBytes: 38, truncated: false },
      effects: { workspaceRevision: 'w1', changedPaths: ['README.md', 'src/users.js'] } } }) }),
  });
  project.host.client.write = async route => route === 'plans/apply'
    ? { status: 'invalid', code: 'invalid', reason: 'the candidate does not install the check c-only-readme' }
    : { status: 'committed' };
  const rec = new Record({ id: 'E05', rows: ['C-182'], checks: [{ id: 'overlap', rows: ['C-182'], text: '重叠' }] });
  const ctx = { budget: { tick: async () => {} }, report: { current: rec } };
  const stop = await E05.seedRound(ctx, project, { goalRef: { goalId: 'g-seed' } }, rec)
    .then(() => null, error => error);
  assert.equal(stop.code, 'not-run', 'the original refusal still stops the preparation');
  const failure = rec.facts.seed.failures[0];
  assert.deepEqual([failure.taskId, failure.reports[0].checkId, failure.reports[0].exitCode,
    failure.reports[0].paths, failure.reports[0].stderr?.text],
  ['t1', 'c-only-readme', 1, ['README.md', 'src/users.js'], 'the workspace changed more than README.md'],
  'the failing seed round is in facts before the stop');
  assert.ok(rec.notes.some(note => /候选由模型写/.test(note)), 'the refusal note stays');
  assert.ok(rec.notes.some(note => /种子任务 t1/.test(note)), 'the failing round is also noted');
});

// ---- E06: the continuation object and the takeover (quick check row 4)

const e05Started = (runId, sessionId, startedAt = '2026-01-01T10:00:00Z') => ({ run: { ref: { runId },
  task: { projectId: 'p', goalId: 'g5', taskId: 't-users' }, startedAt, endedAt: null },
outbox: { claim: { sessionRef: { projectId: 'p', sessionId } } } });
const e05WorkTasks = () => [{ ref: { taskId: 't-users' }, definition: { taskKind: 'work' } },
  { ref: { taskId: 'gate' }, definition: { taskKind: 'gate' } }];

test('P6J4 E06: E05 stopped for a person still publishes its object, and a drained E05 with no chained head moves nothing', async () => {
  const reads = [];
  const owned = [];
  const host = { client: { read: async route => {
    reads.push(route);
    if (route === 'lines/list') return answered({ rows: [{ key: { projectId: 'p', sessionId: 's-unrelated' }, chainSessions: [{ projectId: 'p', sessionId: 's-unrelated' }] }] });
    throw new Error(`the fake Host does not answer ${route}`);
  } } };
  const ctx = { shared: {}, hosts: { 'w-accept': host }, budget: { own: (...args) => owned.push(args) } };
  const e05Rec = new Record({ id: 'E05', rows: ['C-182'], checks: [{ id: 'overlap', rows: ['C-182'], text: '重叠' }] });
  const unstarted = e05Started('r0', 's-never');
  unstarted.run.startedAt = null;
  E05.publishContinuation(ctx, e05Rec, { project: { scope: A, root: '/p', host }, goalRef: { goalId: 'g5' },
    runs: [e05Started('r1', 's-e05'), unstarted], module: { ref: { moduleId: 'm1' } }, tasks: e05WorkTasks(),
    stoppedFor: 'the platform stopped: no_new_basis on t-users' });
  assert.deepEqual(ctx.shared.e05?.lines, [{ projectId: 'p', sessionId: 's-e05' }], 'published although the Goal stopped for a person');
  const rec = new Record({ id: 'E06', rows: ['C-219'], checks: [{ id: 'handoff', rows: ['C-219'], text: '换手' }] });
  const taken = await e06Takeover(ctx, rec, ctx.shared.e05, true);
  assert.equal(taken.ok, false);
  assert.equal(taken.missing, 'line');
  assert.deepEqual(owned, [], 'no usage attribution moves without a chained line head');
  assert.deepEqual(rec.projects, []);
  assert.deepEqual(reads, ['lines/list']);
});

test('P6L E06: only a formal E05 Goal Work Run on a claimed line publishes the continuation', () => {
  const runOn = (runId, goalId, taskId, sessionId) => {
    const item = e05Started(runId, sessionId);
    item.run.task = { projectId: 'p', goalId, taskId };
    return item;
  };
  const rec = new Record({ id: 'E05', rows: ['C-182'], checks: [{ id: 'overlap', rows: ['C-182'], text: '重叠' }] });
  const ctx = { shared: {} };
  const project = { scope: A, root: '/p' };
  const noWork = E05.publishContinuation(ctx, rec, { project, goalRef: { goalId: 'g5' }, module: {}, tasks: e05WorkTasks(),
    runs: [runOn('r-gate', 'g5', 'gate', 's-gate'), runOn('r-seed', 'g-seed', 't1', 's-seed')] });
  assert.equal(noWork, null, 'a gate Run or another Goal\'s Run is not a formal started Work line');
  assert.equal(ctx.shared.e05, undefined);
  const work = E05.publishContinuation(ctx, rec, { project, goalRef: { goalId: 'g5' }, module: {}, tasks: e05WorkTasks(),
    runs: [runOn('r-gate', 'g5', 'gate', 's-gate'), runOn('r-seed', 'g-seed', 't1', 's-seed'),
      runOn('r-work', 'g5', 't-users', 's-work')] });
  assert.deepEqual(work.lines, [{ projectId: 'p', sessionId: 's-work' }]);
  assert.deepEqual(ctx.shared.e05.lines, [{ projectId: 'p', sessionId: 's-work' }]);
  assert.throws(() => E05.publishContinuation(ctx, rec, { project, goalRef: { goalId: 'g5' }, module: {}, runs: [] }),
    TypeError, 'tasks is required; a missing list is not silently treated as no formal Work');
});

test('P6J4 E06: the handoff goes to the live Work on E05\'s chain, not to the line the restart resumed on', async () => {
  const e05 = { lines: [{ projectId: 'p', sessionId: 's-e05' }] };
  const goalRef = { aggregateType: 'Goal', projectId: 'p', goalId: 'g6' };
  let runs = [
    { run: { ref: { runId: 'r-resumed' }, status: 'running', startedAt: '2026-01-01T10:00:00Z' }, outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's-new' } } } },
    { run: { ref: { runId: 'r-chain' }, status: 'running', startedAt: '2026-01-01T10:01:00Z' }, outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's-head' } } } },
  ];
  const sends = [];
  const project = { scope: A, host: { client: {
    read: async route => {
      if (route === 'executions/list') return answered({ items: runs, nextCursor: null });
      if (route === 'lines/list') return answered({ rows: [
        { key: { projectId: 'p', sessionId: 's-new' }, chainSessions: [{ projectId: 'p', sessionId: 's-new' }] },
        { key: { projectId: 'p', sessionId: 's-head' }, chainSessions: [{ projectId: 'p', sessionId: 's-e05' }, { projectId: 'p', sessionId: 's-head' }] }] });
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async (route, _scope, input) => { sends.push({ route, input }); return { status: 'committed', value: { ref: { messageId: 'm-h' }, revision: 1 }, sendStatus: 'sent' }; },
  } } };
  const handed = await E06.handOffOnContinuation(project, e05, goalRef, 'please hand off');
  assert.equal(handed.ok, true);
  assert.equal(handed.work.run.ref.runId, 'r-chain');
  assert.equal(handed.row.key.sessionId, 's-head');
  assert.deepEqual(sends.map(entry => [entry.route, entry.input.recipient.sessionId, entry.input.goalRef?.goalId]), [['messages/send', 's-head', 'g6']]);
  // Only an unchained line is working: nothing is sent, and the facts name what ran where.
  runs = runs.slice(0, 1);
  sends.length = 0;
  const none = await E06.handOffOnContinuation(project, e05, goalRef, 'please hand off');
  assert.equal(none.ok, false);
  assert.equal(none.missing, 'work');
  assert.deepEqual(none.live, ['r-resumed@s-new']);
  assert.deepEqual(sends, []);
});

test('P6J4b E06: a line list that fails at the handoff is an environment gap, never a broken step', async () => {
  const sends = [];
  const project = { scope: A, host: { client: {
    read: async route => {
      if (route === 'executions/list') return answered({ items: [{ run: { ref: { runId: 'r-chain' }, status: 'running', startedAt: '2026-01-01T10:01:00Z' },
        outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's-head' } } } }], nextCursor: null });
      if (route === 'lines/list') return { status: 'rejected', code: 'unavailable', reason: 'line store down' };
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async (route, _scope, input) => { sends.push({ route, input }); return { status: 'committed', value: { ref: { messageId: 'm' } }, sendStatus: 'sent' }; },
  } } };
  const rec = new Record({ id: 'E06', rows: ['C-219'], checks: [{ id: 'handoff', rows: ['C-219'], text: '换手' }, { id: 'archive', rows: ['C-219'], text: '归档' }] });
  const step = await E06.handoffStep(quietCtx(rec), project, rec, { e05: { lines: [{ projectId: 'p', sessionId: 's-e05' }] },
    goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g6' }, resumedSessionId: 's-head' });
  assert.equal(rec.results.get('handoff').status, 'uncovered');
  assert.equal(rec.results.get('handoff').code, 'env-unavailable');
  assert.match(rec.results.get('handoff').note, /line store down/);
  assert.equal(step.chain, null);
  assert.equal(step.workLine, null, 'no trusted line ref for the later archive');
  assert.ok(step.lineGaps.some(gap => /lines\/list/.test(gap)));
  assert.deepEqual(sends, []);
});

// ---- E06: the brief of the Run that resumed after the restart (P6K, diagnosis "E06 简报")

const e06Task = { projectId: 'p', goalId: 'g6', taskId: 't1' };
/** The crashed first Run and the Run that resumed its Task; the storage index list ends with the crashed one. */
const e06Run = (runId, sessionId) => ({ run: { ref: { aggregateType: 'Run', projectId: 'p', goalId: 'g6', runId },
  task: e06Task, status: runId === 'r-resumed' ? 'running' : 'ended' },
outbox: { claim: { sessionRef: { projectId: 'p', sessionId } } } });
const e06Brief = (over = {}) => ({ schemaVersion: 1, runRef: { runId: 'r-resumed' }, task: e06Task,
  mode: 'resume_after_interruption',
  previous: { runRef: { runId: 'r-crashed' }, sessionRef: { projectId: 'p', sessionId: 's1' } }, ...over });
const e06BriefProject = (answer, reads = [], runs = [e06Run('r-resumed', 's1'), e06Run('r-crashed', 's1')]) => ({ scope: A, host: { client: { read: async (route, _scope, input) => {
  reads.push({ route, input });
  if (route === 'executions/list') return page(runs);
  if (route === 'executions/brief') return answer(input.runRef.runId);
  throw new Error(`the fake Host does not answer ${route}`);
} } } });
const e06Record = () => new Record({ id: 'E06', rows: ['C-135'],
  checks: [{ id: 'same-task-new-run', rows: ['C-135'], text: '同一 Task 新开 Run' }] });
/** The real `executions/brief` answer: `{brief, digest}` inside the ready value (`runtime.ts:687`). */
const e06Answered = brief => answered({ brief, digest: 'digest-1' });

test('P6K E06: the brief answer is unpacked from its ready value to the brief and its digest', async () => {
  const brief = e06Brief();
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g6', runId: 'r-resumed' };
  const reads = [];
  const project = e06BriefProject(() => e06Answered(brief), reads);
  const read = await E06.readBrief(project, runRef);
  assert.deepEqual(read.brief, brief, 'value.brief is the ContinuationBriefV1, not the whole value');
  assert.equal(read.digest, 'digest-1');
  assert.equal(read.body.status, 'ready');
  assert.deepEqual(reads, [{ route: 'executions/brief', input: { runRef } }], 'the complete RunRef is sent as it came');
});

test('P6K E06: the same-task new Run reads the resumed Run\'s brief, never the crashed Run the list ends with', async () => {
  const reads = [];
  const brief = e06Brief();
  const project = e06BriefProject(runId => (runId === 'r-resumed' ? e06Answered(brief) : { status: 'not_found' }), reads);
  const rec = e06Record();
  await E06.judgeSameTaskNewRun(project, rec, { first: e06Run('r-crashed', 's1'), resumed: e06Run('r-resumed', 's1') });
  assert.deepEqual(reads, [{ route: 'executions/brief',
    input: { runRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g6', runId: 'r-resumed' } } }],
  'the complete RunRef of the resumed Run is read, not the list\'s last (crashed) Run');
  assert.equal(rec.results.get('same-task-new-run').status, 'pass', rec.results.get('same-task-new-run').note);
});

test('P6K E06: the first new Run after the restart boundary is selected from a shuffled list, even when already finished', async () => {
  const first = e06Run('r-crashed', 's1');
  const boundary = '2026-01-01T10:00:30Z';
  const timed = (runId, status, startedAt, endedAt = null, task = e06Task, sessionId = 's1') => ({
    run: { ref: { aggregateType: 'Run', projectId: 'p', goalId: 'g6', runId }, task, status, startedAt, endedAt },
    outbox: { claim: { sessionRef: { projectId: 'p', sessionId } } } });
  const finished = timed('r-finished', 'ended', '2026-01-01T10:00:31Z', '2026-01-01T10:00:40Z');
  const rework = timed('r-rework', 'running', '2026-01-01T10:01:00Z');
  const other = timed('r-other', 'running', '2026-01-01T10:00:32Z', null, { ...e06Task, taskId: 't-other' }, 's-other');
  const before = timed('r-before', 'ended', '2026-01-01T09:59:00Z', '2026-01-01T09:59:30Z');
  // Storage-index order, not time order: the later rework comes first and the finished run after it.
  const shuffled = [rework, other, before, finished, first];
  const selected = E06.resumedRunOf(shuffled, first, boundary);
  assert.equal(selected?.run.ref.runId, 'r-finished',
    'the finished r2 after the boundary is first; the later rework r3, another Task and a pre-boundary Run do not steal it');
  assert.equal(selected.run.status, 'ended');
  const reads = [];
  const rec = e06Record();
  const project = e06BriefProject(runId => (runId === 'r-finished' ? e06Answered(e06Brief()) : { status: 'not_found' }), reads, shuffled);
  await E06.judgeSameTaskNewRun(project, rec, { first, resumed: selected, boundary });
  assert.deepEqual(reads.map(read => read.input.runRef.runId), ['r-finished'], 'the brief read is the selected finished Run, not r3');
  assert.equal(rec.results.get('same-task-new-run').status, 'pass', rec.results.get('same-task-new-run').note);
});

test('P6K E06: a resumed Run on another line fails even when the brief names the interrupted line', async () => {
  const first = e06Run('r-crashed', 's1');
  const resumed = e06Run('r-resumed', 's2');
  const rec = e06Record();
  await E06.judgeSameTaskNewRun(e06BriefProject(() => e06Answered(e06Brief())), rec, { first, resumed });
  const result = rec.results.get('same-task-new-run');
  assert.equal(result.status, 'fail', result.note);
  assert.match(result.note, /线不同/);
  assert.match(result.note, /接续 Run 在 s2，中断的 Run 在 s1/);
});

test('P6K E06: a resumed Run on another Task than the interrupted Run fails as a Task difference', async () => {
  const runs = [e06Run('r-resumed', 's1'), e06Run('r-crashed', 's1')];
  runs[0] = { ...runs[0], run: { ...runs[0].run, task: { ...e06Task, taskId: 't-other' } } };
  const rec = e06Record();
  const project = e06BriefProject(runId => e06Answered(e06Brief({ task: runs[0].run.task })), [], runs);
  await E06.judgeSameTaskNewRun(project, rec, { first: runs[1], resumed: runs[0] });
  const result = rec.results.get('same-task-new-run');
  assert.equal(result.status, 'fail', result.note);
  assert.match(result.note, /Task 不同/);
});

test('P6K E06: no resumed Run and failed reads are uncovered; a contrary task, line, mode or previous Run fails', async () => {
  const first = e06Run('r-crashed', 's1');
  const resumed = e06Run('r-resumed', 's1');
  const judge = async (answer, pair = { first, resumed }) => {
    const rec = e06Record();
    await E06.judgeSameTaskNewRun(e06BriefProject(answer), rec, pair);
    return rec.results.get('same-task-new-run');
  };
  const none = await judge(() => e06Answered(e06Brief()), { first, resumed: null });
  assert.equal(none.status, 'uncovered');
  assert.equal(none.code, 'not-run');
  assert.match(none.note, /没有接续 Run/);
  const task = await judge(() => e06Answered(e06Brief({ task: { ...e06Task, taskId: 't-other' } })));
  assert.equal(task.status, 'fail', task.note);
  assert.match(task.note, /Task 不同/);
  const line = await judge(() => e06Answered(e06Brief({ previous: { runRef: { runId: 'r-crashed' },
    sessionRef: { projectId: 'p', sessionId: 's-other' } } })));
  assert.equal(line.status, 'fail', line.note);
  assert.match(line.note, /brief\.previous 的线不是中断的线/);
  const mode = await judge(() => e06Answered(e06Brief({ mode: 'rework' })));
  assert.equal(mode.status, 'fail', mode.note);
  assert.match(mode.note, /不是 resume_after_interruption \/ previous 不是中断的 Run/);
  const previous = await judge(() => e06Answered(e06Brief({ previous: { runRef: { runId: 'r-before' },
    sessionRef: { projectId: 'p', sessionId: 's1' } } })));
  assert.equal(previous.status, 'fail', previous.note);
  assert.match(previous.note, /不是 resume_after_interruption \/ previous 不是中断的 Run/);
  const missing = await judge(() => ({ status: 'not_found' }));
  assert.equal(missing.status, 'uncovered');
  assert.equal(missing.code, 'entry-missing');
  assert.match(missing.note, /brief 读失败/);
  const failed = await judge(() => ({ status: 'rejected', code: 'unavailable', reason: 'brief store down' }));
  assert.equal(failed.status, 'uncovered');
  assert.equal(failed.code, 'env-unavailable');
  assert.match(failed.note, /brief store down/);
});

test('P6K E06: ready(null) is its own gap, apart from a failed brief read', async () => {
  const first = e06Run('r-crashed', 's1');
  const resumed = e06Run('r-resumed', 's1');
  const judge = async answer => {
    const rec = e06Record();
    await E06.judgeSameTaskNewRun(e06BriefProject(answer), rec, { first, resumed });
    return rec.results.get('same-task-new-run');
  };
  const empty = await judge(() => answered(null));
  assert.equal(empty.status, 'uncovered');
  assert.equal(empty.code, 'not-run', 'HTTP 200 with value:null is not a failed read');
  assert.match(empty.note, /ready\/null/);
  assert.match(empty.note, /不是读失败/);
  const missing = await judge(() => ({ status: 'not_found' }));
  const failed = await judge(() => ({ status: 'rejected', code: 'unavailable', reason: 'brief store down' }));
  assert.notEqual(empty.code, missing.code);
  assert.notEqual(empty.note, missing.note);
  assert.notEqual(empty.code, failed.code);
  assert.notEqual(empty.note, failed.note);
});

// ---- waiting (quick check row 5)

const SECRETARY = { projectId: 'p', sessionId: 's-secretary' };
const MEMBER = { projectId: 'p', sessionId: 's-member' };
const FIRST_REF = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm-first' };
const README_REF = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm-readme' };
/** The member's two waiting sends as its line history records them (the tool result carries the saved message's ref). */
const memberHistory = () => [
  eventAt('2026-01-01T10:00:00Z', 'assistant.message_completed', { message: { messageId: 'a1', content: [] }, toolCalls: [
    { callId: 'c1', name: 'send_session_message', arguments: { waitAfterSend: true, needsReply: true, text: 'num.js 现在有哪些导出函数？' } },
    { callId: 'c2', name: 'send_session_message', arguments: { waitAfterSend: true, needsReply: true, text: 'README 的标题要不要改成中文？' } }] }, 'k1', 't1'),
  eventAt('2026-01-01T10:00:01Z', 'tool.completed', { callId: 'c1', result: { status: 'success', output: [{ kind: 'json', value: { message: { ref: FIRST_REF } } }] } }, 'k1', 't1'),
  eventAt('2026-01-01T10:00:02Z', 'tool.completed', { callId: 'c2', result: { status: 'success', output: [{ kind: 'json', value: { message: { ref: README_REF } } }] } }, 'k1', 't1'),
].map(record => ({ body: { text: JSON.stringify(record) } }));
const lineCard = (sessionId, extra = {}) => ({ record: { ref: { projectId: 'p', sessionId }, revision: 3, workspaceId: 'wa', lifecycle: 'active', health: 'available',
  archiveRequest: null, provenance: { kind: 'created' }, ...extra } });

test('P6J4 waiting: the chain\'s own poll transfers the open README wait once, to a line whose card is an eligible reply target', async () => {
  const calls = [];
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', taskId: 't-wait', runId: 'r-wait' };
  const letters = {
    'm-first': waitingLetter({ status: 'responded', response: { respondedAt: '2026-01-01T10:01:00Z' },
      acceptedInputs: [{ part: 'response', consumesWait: true, acceptedAt: '2026-01-01T10:01:01Z' }] }),
    'm-readme': waitingLetter(),
  };
  const cards = { 's-member': lineCard('s-member'), 's-archiving': lineCard('s-archiving', { archiveRequest: { requestId: 'ar1' } }),
    's-retired': lineCard('s-retired', { lifecycle: 'archived' }), 's-ok': lineCard('s-ok') };
  const project = { scope: A, host: { client: {
    read: async (route, _scope, input) => {
      calls.push({ route, input });
      if (route === 'sessions/history') return answered({ items: input.sessionRef.sessionId === 's-member' ? memberHistory() : [], nextCursor: null });
      if (route === 'messages/read') return answered(letters[input.messageId]);
      if (route === 'sessions/facts') return answered({ waits: [{ messageRef: README_REF, originalRun: runRef,
        state: { state: 'open' }, deadline: waitingLetter().deadline }] });
      if (route === 'tasks/query') return answered({ tasks: [{ ref: { taskId: 't-wait' }, disposition: 'active', effectivePhase: 'satisfied' }] });
      // The archiving and the retired line still look fine on the line list; only their cards tell.
      if (route === 'lines/list') return answered({ rows: ['s-member', 's-secretary', 's-archiving', 's-retired', 's-ok']
        .map(sessionId => ({ key: { projectId: 'p', sessionId }, status: { own: 'idle' } })) });
      if (route === 'sessions/read') return answered(cards[input.sessionId]);
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async (route, _scope, input) => { calls.push({ route, input }); return { status: 'ready', value: { state: 'archived' } }; },
    command: async () => { throw new Error('a live sender line needs no standalone waits/dispose'); },
  } } };
  const memberLines = async () => [MEMBER];
  const receiverOf = WAIT.receiverFor(project, { memberLines, secretary: SECRETARY });
  const chain = await WAIT.followChain(quietCtx(null), project, { memberLines, first: { messageRef: FIRST_REF }, goalRef: { goalId: 'g' },
    windowEnd: Date.now() + 60_000, receiverOf });
  assert.equal(chain.ended, 'chain-over');
  assert.equal(chain.transfer?.kind, 'transfer', 'the poll itself transferred the open wait');
  assert.deepEqual(calls.filter(call => call.route === 'sessions/archive-line').map(call => call.input.wait.to.sessionId), ['s-ok']);
  assert.ok(calls.some(call => call.route === 'sessions/read' && call.input.sessionId === 's-archiving'), 'the card was read, not the list status');
});

test('P6J4 waiting: the last round after the chain re-reads the same letter even after an attempt, and judges the reply', async () => {
  const calls = [];
  const replied = waitingLetter({ status: 'responded', response: { respondedAt: '2026-01-01T10:05:00Z' },
    acceptedInputs: [{ part: 'response', consumesWait: true, acceptedAt: '2026-01-01T10:05:01Z' }] });
  const project = { scope: A, host: { client: {
    read: async route => {
      calls.push(route);
      if (route === 'messages/read') return answered(replied);
      // P6LO B9: the earlier attempt gets the close-out read of the sending line too.
      if (route === 'sessions/read') return answered({ record: { revision: 1, lifecycle: 'active' } });
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async route => { calls.push(route); return { status: 'ready', value: { state: 'archived' } }; },
    command: async route => { calls.push(route); return { status: 'committed' }; },
  } } };
  const readme = waitingSend('README 的标题要不要改成中文？');
  const refused = { kind: 'transfer-refused', note: 'waits/dispose transfer → s-r2：rejected invalid the wait is already answered' };
  const prior = { send: readme, outcome: refused, attempted: true, attempt: refused, firstSeenAt: '2026-01-01T10:00:00Z',
    firstValue: waitingLetter(), value: waitingLetter(), gaps: [] };
  const rec = new Record({ id: 'waiting', rows: ['C-187'], checks: [
    { id: 'reply-first', rows: ['C-187'], text: '回复抢先' }, { id: 'transfer', rows: ['C-224'], text: '转交' }] });
  await WAIT.closeSecondQuestion(quietCtx(rec), project, rec, { chain: { second: prior }, secondSend: readme, seenOpen: '轮询到',
    receiverOf: async () => waitingReceiver('s-r9') });
  assert.equal(rec.results.get('reply-first').status, 'pass');
  assert.ok(calls.includes('messages/read'), 'the letter was read again');
  assert.equal(calls.some(route => route === 'sessions/archive-line' || route === 'waits/dispose'), false, 'no second transfer');
});

const WAIT_CHECKS = () => new Record({ id: 'waiting', rows: ['C-187'], checks: [
  { id: 'reply-first', rows: ['C-187'], text: '回复抢先' }, { id: 'transfer', rows: ['C-224'], text: '转交' }] });

test('P6J4b waiting: a last read that fails after a refused transfer is a gap; the refusal stays only as evidence', async () => {
  const project = { scope: A, host: { client: { read: async route => {
    if (route === 'messages/read') return { status: 'rejected', code: 'unavailable', reason: 'mail store down' };
    if (route === 'sessions/read') return answered({ record: { revision: 1, lifecycle: 'active' } });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const readme = waitingSend('README 的标题要不要改成中文？');
  const refused = { kind: 'transfer-refused', note: 'waits/dispose transfer → s-r2：rejected invalid' };
  const prior = { send: readme, outcome: refused, attempted: true, attempt: refused, firstSeenAt: '2026-01-01T10:00:00Z',
    firstValue: waitingLetter(), value: waitingLetter(), gaps: [] };
  const rec = WAIT_CHECKS();
  await WAIT.closeSecondQuestion(quietCtx(rec), project, rec, { chain: { second: prior }, secondSend: readme, seenOpen: '轮询到',
    receiverOf: async () => waitingReceiver('s-r9') });
  for (const id of ['reply-first', 'transfer']) {
    assert.equal(rec.results.get(id).status, 'uncovered');
    assert.equal(rec.results.get(id).code, 'env-unavailable', `${id} is the read gap, not the old refusal`);
    assert.match(rec.results.get(id).note, /unavailable/);
  }
  assert.match(rec.results.get('transfer').note, /首次归档回执.*rejected invalid/);
});

test('P6J4b waiting: a reply read whose acceptance keeps failing to read is a gap, not a reply-first fail', async () => {
  let reads = 0;
  const repliedUnaccepted = waitingLetter({ status: 'responded', response: { respondedAt: '2026-01-01T10:05:00Z' }, acceptedInputs: [] });
  const project = { scope: A, host: { client: { read: async route => {
    if (route !== 'messages/read') throw new Error(`the fake Host does not answer ${route}`);
    reads += 1;
    return reads === 1 ? answered(repliedUnaccepted) : { status: 'rejected', code: 'unavailable', reason: 'mail store down' };
  } } } };
  // The acceptance poll is given no time (`acceptanceMs: -1`): one read, then its result. A second tick means the poll
  // kept waiting instead (the cell stops it there).
  let ticks = 0;
  const rec = WAIT_CHECKS();
  const ctx = { budget: { tick: async () => { ticks += 1; if (ticks > 1) throw new Error('the acceptance poll did not take its short wait'); } }, report: { current: rec } };
  const readme = waitingSend('README 的标题要不要改成中文？');
  await WAIT.closeSecondQuestion(ctx, project, rec, { chain: { second: null }, secondSend: readme, seenOpen: '轮询到',
    receiverOf: async () => waitingReceiver('s-r9'), acceptanceMs: -1 });
  assert.equal(rec.results.get('reply-first').status, 'uncovered');
  assert.equal(rec.results.get('reply-first').code, 'env-unavailable');
  assert.match(rec.results.get('reply-first').note, /接受记录读不到/);
  // With every read answering and still no consuming acceptance, the same poll is a real `fail`.
  const complete = { scope: A, host: { client: { read: async () => answered(repliedUnaccepted) } } };
  const judged = WAIT_CHECKS();
  const settled = await WAIT.consumingAcceptance(quietCtx(judged), complete, readme.ref, { timeoutMs: -1 });
  assert.deepEqual(settled, { consumed: null, gap: null });
});

test('P6J4b waiting: a line list or card that fails while choosing the receiver is a gap, not "no eligible line"', async () => {
  const project = { scope: A, host: { client: {
    read: async (route, _scope, input) => {
      if (route === 'messages/read') return answered(waitingLetter());
      if (route === 'lines/list') return answered({ rows: [{ key: { projectId: 'p', sessionId: 's-other' } }] });
      if (route === 'sessions/read') return { status: 'rejected', code: 'unavailable', reason: `card store down for ${input.sessionId}` };
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async () => { throw new Error('nothing may be archived'); },
    command: async () => { throw new Error('nothing may be transferred'); },
  } } };
  const receiverOf = WAIT.receiverFor(project, { memberLines: async () => [MEMBER], secretary: SECRETARY });
  const readme = waitingSend('README 的标题要不要改成中文？');
  const round = await secondQuestionRound(project, { sends: [readme], chainRefs: [], prior: null, receiverOf });
  assert.equal(round.outcome.kind, 'gap');
  assert.match(round.outcome.note, /sessions\/read s-other/);
  const rec = WAIT_CHECKS();
  judgeSecond(rec, { outcome: round.outcome, attempt: round.attempt, secondText: '第二个问题', secondMsg: waitingLetter() });
  assert.equal(rec.results.get('transfer').code, 'env-unavailable');
});

test('P6J4 waiting: only a wait still open on the re-read just before the archive is the disconnect object', async () => {
  const open = { messageRef: { messageId: 'w1' }, state: { state: 'open' }, recipient: { projectId: 'p', sessionId: 'far' }, expiredAt: null };
  let factsReads = 0;
  let second = { ...open, state: { state: 'answered' } };
  const project = { scope: A, host: { client: { read: async route => {
    if (route !== 'sessions/facts') throw new Error(`the fake Host does not answer ${route}`);
    factsReads += 1;
    return answered({ waits: [factsReads === 1 ? open : second] });
  } } } };
  const gone = await WAIT.disconnectTarget(project, [MEMBER]);
  assert.equal(gone.target, null);
  assert.equal(gone.code, 'not-run');
  assert.match(gone.note, /w1/);
  assert.equal(factsReads, 2, 'read once to find it and once more right before the archive');
  factsReads = 0;
  second = open;
  const kept = await WAIT.disconnectTarget(project, [MEMBER]);
  assert.equal(kept.target.messageRef.messageId, 'w1');
  assert.deepEqual(kept.holder, MEMBER);
});

// ---- intervention (quick check rows 2 and 7)

const LONG_GOAL = { aggregateType: 'Goal', projectId: 'p', goalId: 'g-long' };

test('P6J4 intervention: the idle-line send carries the Goal the line\'s page shows', async () => {
  const sends = [];
  let rows = [{ key: { projectId: 'p', sessionId: 's1' }, name: { goalRef: { goalId: 'g-own' } } }];
  const project = { scope: A, host: { client: {
    read: async route => {
      if (route === 'executions/list') return answered({ items: [{ run: { ref: { runId: 'r1' }, task: { taskId: 't1' }, status: 'ended' },
        outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's1' } } } }], nextCursor: null });
      if (route === 'lines/list') return answered({ rows });
      if (route === 'sessions/facts') return answered({ latestWork: { task: { projectId: 'p', goalId: 'g-long', taskId: 't1' } } });
      if (route === 'tasks/query') return answered({ tasks: [{ ref: { taskId: 't1' }, disposition: 'active', effectivePhase: 'satisfied' }] });
      if (route === 'sessions/read') return answered({ availability: 'idle', links: [],
        record: { occupancy: null, lifecycle: 'active', health: 'available' } });
      if (route === 'sessions/queries') return answered({ items: [], nextCursor: null });
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async (route, _scope, input) => { sends.push({ route, input }); return { status: 'committed', value: { ref: { messageId: `m-${sends.length}` }, revision: 1 }, sendStatus: 'sent' }; },
  } } };
  const rec = new Record({ id: 'intervention', rows: ['C-199'], checks: [{ id: 'planning-when-idle', rows: ['C-199'], text: '空闲规划' }] });
  const watch = { idle: null, claim: null, interventions: [] };
  await INT.idleWatchStep(project, LONG_GOAL, watch, 'ACTIVE', rec);
  assert.deepEqual(sends.map(entry => entry.route), ['messages/send']);
  assert.equal(sends[0].input.entry, 'person_intervention');
  assert.deepEqual(sends[0].input.goalRef, { aggregateType: 'Goal', projectId: 'p', goalId: 'g-own' }, 'the line name\'s own Goal');
  assert.equal(watch.idle.line, 's1');
  assert.equal(watch.interventions.length, 1);
  // A line with no Goal in its name shows the page's selected Goal (the long Goal here).
  rows = [{ key: { projectId: 'p', sessionId: 's1' }, name: { goalRef: null } }];
  await INT.idleWatchStep(project, LONG_GOAL, { idle: null, claim: null, interventions: [] }, 'ACTIVE', rec);
  assert.deepEqual(sends[1].input.goalRef, LONG_GOAL);
});

test('P6K intervention: the idle planning probe waits while the line runs a Query, then sends with its own goal and occupancy', async () => {
  const queryJobId = 'intervention-planning-busy';
  const sends = [];
  let queryStatus = 'running';
  const project = { scope: A, host: { client: {
    read: async (route) => {
      if (route === 'executions/list') return answered({ items: [{ run: { ref: { runId: 'r1' }, task: { taskId: 't1' }, status: 'ended' },
        outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's1' } } } }], nextCursor: null });
      if (route === 'lines/list') return answered({ rows: [{ key: { projectId: 'p', sessionId: 's1' }, name: { goalRef: { goalId: 'g-own' } } }] });
      if (route === 'sessions/facts') return answered({ latestWork: { task: { projectId: 'p', goalId: 'g-long', taskId: 't1' } } });
      if (route === 'tasks/query') return answered({ tasks: [{ ref: { taskId: 't1' }, disposition: 'active', effectivePhase: 'satisfied' }] });
      if (route === 'sessions/read') return answered({ availability: 'idle', links: [],
        record: { occupancy: null, lifecycle: 'active', health: 'available' } });
      if (route === 'sessions/queries') return answered({ items: [{ ref: queryRunRef(queryJobId, 'q-run'), run: { status: queryStatus } }], nextCursor: null });
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async (route, _scope, input) => {
      sends.push({ route, input });
      return { status: 'committed', value: { ref: { messageId: `m-${sends.length}` }, revision: 1 }, sendStatus: 'sent' };
    },
  } } };
  const rec = new Record({ id: 'intervention', rows: ['C-199'], checks: [{ id: 'planning-when-idle', rows: ['C-199'], text: '空闲规划' }] });
  const watch = { idle: null, claim: null, interventions: [] };
  await INT.idleWatchStep(project, LONG_GOAL, watch, 'ACTIVE', rec);
  assert.deepEqual(sends, [], 'a line still running a Query is not sent the idle probe');
  assert.equal(watch.idle, null);
  assert.equal(watch.busy.planning.line, 's1');
  assert.equal(watch.busy.planning.task, 'g-long/t1 active/satisfied');
  assert.deepEqual(watch.busy.planning.goalRef, { aggregateType: 'Goal', projectId: 'p', goalId: 'g-own' });
  assert.ok(watch.busy.planning.at);
  assert.match(watch.busy.planning.why, new RegExp(queryJobId));
  assert.match(watch.busy.planning.why, /running/);
  // The Query ends: the next pass sends the same probe, recording the Goal, task and occupancy at the send.
  queryStatus = 'answered';
  await INT.idleWatchStep(project, LONG_GOAL, watch, 'ACTIVE', rec);
  assert.deepEqual(sends.map(entry => entry.route), ['messages/send']);
  assert.equal(watch.idle.line, 's1');
  assert.equal(watch.idle.work, 'g-long/t1 active/satisfied');
  assert.deepEqual(watch.idle.goalRef, { aggregateType: 'Goal', projectId: 'p', goalId: 'g-own' });
  assert.equal(watch.idle.occupancy, '空闲');
});

test('P6K intervention: the claim probe waits for the line\'s own Run to end, with the wait recorded', async () => {
  const sends = [];
  let runStatus = 'running';
  const project = { scope: A, host: { client: {
    read: async (route) => {
      if (route === 'executions/list') return answered({ items: [{ run: { ref: { runId: 'r-busy' }, task: { taskId: 't1' }, status: runStatus },
        outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's1' } } } }], nextCursor: null });
      if (route === 'lines/list') return answered({ rows: [{ key: { projectId: 'p', sessionId: 's1' }, name: { goalRef: null } }] });
      if (route === 'sessions/facts') return answered({ latestWork: { task: { projectId: 'p', goalId: 'g-long', taskId: 't1' } } });
      if (route === 'tasks/query') return answered({ tasks: [{ ref: { taskId: 't1' }, disposition: 'active', effectivePhase: 'ready' }] });
      if (route === 'sessions/read') return answered({ availability: 'idle', links: [],
        record: { occupancy: null, lifecycle: 'active', health: 'available' } });
      if (route === 'sessions/queries') return answered({ items: [], nextCursor: null });
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async (route, _scope, input) => {
      sends.push({ route, input });
      return { status: 'committed', value: { ref: { messageId: `m-${sends.length}` }, revision: 1 }, sendStatus: 'sent' };
    },
  } } };
  const rec = new Record({ id: 'intervention', rows: ['C-199'], checks: [{ id: 'claim-once', rows: ['C-199'], text: '领一次' }] });
  const watch = { idle: null, claim: null, interventions: [] };
  await INT.idleWatchStep(project, LONG_GOAL, watch, 'ACTIVE', rec);
  assert.deepEqual(sends, [], 'a line whose own Work Run has not ended is not sent the claim probe');
  assert.equal(watch.claim, null);
  assert.equal(watch.busy.claim.line, 's1');
  assert.equal(watch.busy.claim.task, 'g-long/t1 active/ready');
  assert.deepEqual(watch.busy.claim.goalRef, LONG_GOAL, 'a line with no Goal in its name shows the page\'s selected Goal');
  assert.ok(watch.busy.claim.at);
  assert.match(watch.busy.claim.why, /r-busy/);
  assert.match(watch.busy.claim.why, /running/);
  // The Run ends: the next pass sends the claim probe and records the Goal, task and occupancy at the send.
  runStatus = 'ended';
  await INT.idleWatchStep(project, LONG_GOAL, watch, 'ACTIVE', rec);
  assert.deepEqual(sends.map(entry => entry.route), ['messages/send']);
  assert.equal(sends[0].input.entry, 'person_intervention');
  assert.equal(watch.claim.line, 's1');
  assert.equal(watch.claim.work, 'g-long/t1 active/ready');
  assert.deepEqual(watch.claim.goalRef, LONG_GOAL);
  assert.equal(watch.claim.occupancy, '空闲');
});

test('P6K intervention: a send-time sessions/read holding the line stops both probes, and the wait names the holder', async () => {
  const held = { kind: 'execution', executionRef: { aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'wa', queryJobId: 'j-hold', runId: 'qr-hold' } };
  const cases = [
    { branch: 'planning', availability: 'busy', occupancy: held, phase: 'satisfied' },
    { branch: 'claim', availability: 'busy', occupancy: held, phase: 'ready' },
  ];
  for (const entry of cases) {
    const sends = [];
    const project = { scope: A, host: { client: {
      read: async (route) => {
        if (route === 'executions/list') return page([{ run: { ref: { runId: 'r1' }, task: { taskId: 't1' }, status: 'ended' },
          outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's1' } } } }]);
        if (route === 'lines/list') return answered({ rows: [{ key: { projectId: 'p', sessionId: 's1' }, name: { goalRef: null } }] });
        if (route === 'sessions/facts') return answered({ latestWork: { task: { projectId: 'p', goalId: 'g-long', taskId: 't1' } } });
        if (route === 'tasks/query') return answered({ tasks: [{ ref: { taskId: 't1' }, disposition: 'active', effectivePhase: entry.phase }] });
        if (route === 'sessions/read') return answered({ availability: entry.availability, links: [],
          record: { occupancy: entry.occupancy, lifecycle: 'active', health: 'available' } });
        if (route === 'sessions/queries') return page([]);
        throw new Error(`the fake Host does not answer ${route}`);
      },
      write: async (route, _scope, input) => { sends.push({ route, input }); return { status: 'committed', value: { ref: { messageId: 'm1' }, revision: 1 }, sendStatus: 'sent' }; },
    } } };
    const rec = new Record({ id: 'intervention', rows: ['C-199'], checks: [{ id: 'planning-when-idle', rows: ['C-199'], text: '空闲规划' }] });
    const watch = { idle: null, claim: null, interventions: [] };
    await INT.idleWatchStep(project, LONG_GOAL, watch, 'ACTIVE', rec);
    assert.deepEqual(sends, [], `${entry.branch}: a send-time availability/occupancy on the line stops the send`);
    assert.equal(watch.idle, null);
    assert.equal(watch.claim, null);
    const slot = watch.busy[entry.branch];
    assert.ok(slot, `${entry.branch}: the branch records its wait`);
    assert.equal(slot.line, 's1');
    assert.equal(slot.availability, entry.availability);
    assert.match(slot.why, /availability busy/, 'the wait names the availability');
    assert.match(slot.why, /execution/, 'the wait names the occupancy kind');
    assert.match(slot.why, /QueryRun/);
    assert.match(slot.why, /qr-hold/, 'the wait names the occupancy ref');
  }
});

test('P6K intervention: a failed sessions/queries page stops the send, stays a gap, and the final note names the read', async () => {
  const sends = [];
  const project = { scope: A, host: { client: {
    read: async (route) => {
      if (route === 'executions/list') return page([{ run: { ref: { runId: 'r1' }, task: { taskId: 't1' }, status: 'ended' },
        outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's1' } } } }]);
      if (route === 'lines/list') return answered({ rows: [{ key: { projectId: 'p', sessionId: 's1' }, name: { goalRef: null } }] });
      if (route === 'sessions/facts') return answered({ latestWork: { task: { projectId: 'p', goalId: 'g-long', taskId: 't1' } } });
      if (route === 'tasks/query') return answered({ tasks: [{ ref: { taskId: 't1' }, disposition: 'active', effectivePhase: 'satisfied' }] });
      if (route === 'sessions/read') return answered({ availability: 'idle', links: [],
        record: { occupancy: null, lifecycle: 'active', health: 'available' } });
      if (route === 'sessions/queries') return { status: 'rejected', code: 'unavailable', reason: 'the Query list is down' };
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async (route, _scope, input) => { sends.push({ route, input }); return { status: 'committed', value: { ref: { messageId: 'm1' }, revision: 1 }, sendStatus: 'sent' }; },
  } } };
  const rec = new Record({ id: 'intervention', rows: ['C-199'], checks: [{ id: 'planning-when-idle', rows: ['C-199'], text: '空闲规划' }] });
  const watch = { idle: null, claim: null, interventions: [] };
  await INT.idleWatchStep(project, LONG_GOAL, watch, 'ACTIVE', rec);
  assert.deepEqual(sends, [], 'a Query page that does not answer is not an empty list');
  assert.equal(watch.idle, null);
  assert.match(watch.busy.planning.why, /读失败/);
  assert.match(watch.busy.planning.why, /sessions\/queries/);
  assert.match(watch.busy.planning.why, /the Query list is down/);
  await INT.judgeIdleIntervention(quietCtx(rec), project, rec, null, LONG_GOAL, watch.busy.planning);
  const note = rec.results.get('planning-when-idle').note;
  assert.match(note, /sessions\/queries/, 'the timeout note names the failed read');
  assert.match(note, /读失败/);
});

test('P6K intervention: the idle letter keeps one first-observed point beside its send snapshot', async () => {
  const idleRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm-idle' };
  const workRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g-long', taskId: 't1', runId: 'r-work' };
  const queryJobId = 'intervention-planning-idle';
  let disposition = 'offerable';
  let failTasks = false;
  const project = { scope: A, host: { client: {
    read: async (route, _scope, input) => {
      if (route === 'messages/read') return answered({ status: 'pending', withdrawnAt: null });
      if (route === 'messages/view') return answered({ message: { goalRef: LONG_GOAL, acceptedInputs: [{ part: 'message', executionRef: workRef, acceptedAt: '2026-01-01T10:01:00Z' }] },
        delivery: { deliveredTo: { executionRef: workRef, acceptedAt: '2026-01-01T10:01:00Z' } }, disposition: { kind: disposition } });
      if (route === 'sessions/facts') return answered({ latestWork: { task: { projectId: 'p', goalId: 'g-long', taskId: 't1' } } });
      if (route === 'sessions/read') return answered({ availability: 'busy', links: [], record: { occupancy: { kind: 'execution', executionRef: workRef },
        lifecycle: 'active', health: 'available' } });
      if (route === 'executions/list') return page([{ run: { ref: { runId: 'r-work' }, task: { taskId: 't1' }, status: 'running' },
        outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's1' } } } }]);
      if (route === 'tasks/query') {
        if (failTasks) return { status: 'rejected', code: 'unavailable', reason: 'task store down' };
        return answered({ tasks: [{ ref: { taskId: 't1' }, disposition: 'active', effectivePhase: 'verifying', execution: { runId: 'r-work' } }] });
      }
      if (route === 'lines/list') return answered({ rows: [{ key: { projectId: 'p', sessionId: 's1' }, status: { own: 'working', markers: [] }, controls: [] }] });
      if (route === 'sessions/queries') return page([{ ref: queryRunRef(queryJobId, 'q-run'), run: { queryJobRef: queryJobRef(queryJobId), status: 'running' } }]);
      if (route === 'queries/read') return answered({ job: { job: { queryJobId, intent: { execution: { sourceMessageRef: idleRef } } } },
        run: { ref: queryRunRef(queryJobId, 'q-run'), run: { status: 'running' } } });
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async () => { throw new Error('no send in this pass'); },
  } } };
  const rec = new Record({ id: 'intervention', rows: ['C-199'], checks: [{ id: 'planning-when-idle', rows: ['C-199'], text: '空闲规划' }] });
  const watch = { idle: { messageRef: idleRef, line: 's1', phase: 'ACTIVE', work: 'g-long/t1 active/verifying',
    goalRef: LONG_GOAL, occupancy: '空闲', at: '2026-01-01T10:00:00Z', refused: null }, claim: null, interventions: [] };
  // Paused: the send-time watch returns after the point, so this pass is evidence only.
  await INT.idleWatchStep(project, LONG_GOAL, watch, 'PAUSED', rec);
  const point = watch.idle.point;
  assert.ok(point, 'the idle letter gets its evidence point');
  assert.deepEqual(point.goalRef, LONG_GOAL, 'the actual Goal');
  assert.equal(point.tasks[0].effectivePhase, 'verifying', 'the Task state');
  assert.equal(point.sessionCard.availability, 'busy', 'the line availability');
  assert.equal(point.sessionCard.occupancy.executionRef.runId, 'r-work', 'the line occupancy');
  assert.equal(point.occupancy.running[0].runId, 'r-work', 'the Work Run');
  assert.equal(point.planning.job.job.job.queryJobId, queryJobId, 'the Query the letter opened');
  assert.deepEqual(point.gaps, []);
  assert.equal(watch.idle.goalRef, LONG_GOAL, 'the send snapshot stays beside the point');
  assert.equal(watch.idle.work, 'g-long/t1 active/verifying');
  assert.equal(watch.idle.occupancy, '空闲');
  assert.equal(watch.idle.at, '2026-01-01T10:00:00Z');
  // One point only: a later pass does not replace it.
  disposition = 'answered';
  await INT.idleWatchStep(project, LONG_GOAL, watch, 'PAUSED', rec);
  assert.equal(watch.idle.point, point, 'the first point is kept, not read again');
  // A field that cannot be read is a gap in the point, not a throw.
  failTasks = true;
  const gapWatch = { ...watch, idle: { ...watch.idle, point: undefined } };
  await INT.idleWatchStep(project, LONG_GOAL, gapWatch, 'PAUSED', rec);
  assert.ok(gapWatch.idle.point, 'the rest of the point is still taken');
  assert.ok(gapWatch.idle.point.gaps.some(gap => /tasks\/query/.test(gap) && /unavailable/.test(gap)), gapWatch.idle.point.gaps.join('；'));
});

test('P6K intervention: the idle point uses the Goal the letter names while the line\'s latest Work differs', async () => {
  const sends = [];
  const pageGoal = { aggregateType: 'Goal', projectId: 'p', goalId: 'g-page' };
  const workRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g-long', taskId: 't1', runId: 'r1' };
  const project = { scope: A, host: { client: {
    read: async (route) => {
      if (route === 'messages/read') return answered({ status: 'pending', withdrawnAt: null });
      if (route === 'messages/view') return answered({ message: { goalRef: pageGoal, acceptedInputs: [{ part: 'message', executionRef: workRef }] },
        delivery: { deliveredTo: { executionRef: workRef } }, disposition: { kind: 'delivered' } });
      if (route === 'executions/list') return page([{ run: { ref: { runId: 'r1' }, task: { taskId: 't1' }, status: 'ended' },
        outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's1' } } } }]);
      // The line's latest Work is another Goal; the platform prefers the Goal the letter names, so the point follows it.
      if (route === 'sessions/facts') return answered({ latestWork: { task: { projectId: 'p', goalId: 'g-long', taskId: 't1' } } });
      if (route === 'tasks/query') return answered({ tasks: [{ ref: { taskId: 't1' }, disposition: 'active', effectivePhase: 'satisfied', execution: { runId: 'r1' } }] });
      if (route === 'sessions/read') return answered({ availability: 'idle', links: [],
        record: { occupancy: null, lifecycle: 'active', health: 'available' } });
      if (route === 'lines/list') return answered({ rows: [{ key: { projectId: 'p', sessionId: 's1' }, name: { goalRef: pageGoal },
        status: { own: 'idle', markers: [] }, controls: [] }] });
      if (route === 'sessions/queries') return page([]);
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async (route, _scope, input) => { sends.push({ route, input }); return { status: 'committed', value: { ref: { messageId: 'm1' }, revision: 1 }, sendStatus: 'sent' }; },
  } } };
  const rec = new Record({ id: 'intervention', rows: ['C-199'], checks: [{ id: 'planning-when-idle', rows: ['C-199'], text: '空闲规划' }] });
  const watch = { idle: null, claim: null, interventions: [] };
  await INT.idleWatchStep(project, LONG_GOAL, watch, 'ACTIVE', rec);
  assert.deepEqual(sends.map(entry => entry.route), ['messages/send']);
  assert.deepEqual(sends[0].input.goalRef, pageGoal, 'the send still carries the page Goal');
  assert.deepEqual(watch.idle.goalRef, pageGoal, 'the send snapshot keeps the page Goal');
  // The evidence point is taken on a later pass: the letter names g-page, the line's latestWork is g-long.
  await INT.idleWatchStep(project, LONG_GOAL, watch, 'PAUSED', rec);
  const point = watch.idle.point;
  assert.ok(point, 'the idle letter gets its evidence point');
  assert.equal(point.goalRef.goalId, 'g-page', 'the point uses the Goal the letter names, not latestWork');
  assert.deepEqual(point.goalRef, pageGoal);
  assert.equal(point.tasks[0].ref.taskId, 't1', 'the point\'s Task is read for the named Goal');
  assert.deepEqual(point.gaps, []);
  assert.deepEqual(watch.idle.goalRef, pageGoal, 'the send snapshot stays beside the point');
});

test('P6K intervention: the claim letter records its first-observed point instead of only the message view', async () => {
  const claimRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm-claim' };
  const workRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g-long', taskId: 't1', runId: 'r-new' };
  let failExecutions = false;
  const project = { scope: A, host: { client: {
    read: async (route) => {
      if (route === 'messages/view') return answered({ message: { acceptedInputs: [{ part: 'message', executionRef: workRef, acceptedAt: '2026-01-01T10:02:00Z' }] },
        delivery: { deliveredTo: { executionRef: workRef, acceptedAt: '2026-01-01T10:02:00Z' } }, disposition: { kind: 'delivered' } });
      if (route === 'sessions/read') return answered({ availability: 'busy', links: [], record: { occupancy: { kind: 'execution', executionRef: workRef },
        lifecycle: 'active', health: 'available' } });
      if (route === 'executions/list') {
        if (failExecutions) return { status: 'rejected', code: 'unavailable', reason: 'run store down' };
        return page([{ run: { ref: { runId: 'r-old' }, task: { taskId: 't1' }, status: 'ended' },
          outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's1' } } } },
        { run: { ref: { runId: 'r-new' }, task: { taskId: 't1' }, status: 'running',
          consumedWait: { kind: 'intervention', messageRef: claimRef } }, outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's1' } } } }]);
      }
      if (route === 'tasks/query') return answered({ tasks: [{ ref: { taskId: 't1' }, disposition: 'active', effectivePhase: 'ready', execution: { runId: 'r-new' } }] });
      if (route === 'lines/list') return answered({ rows: [{ key: { projectId: 'p', sessionId: 's1' }, status: { own: 'working', markers: [] }, controls: [] }] });
      if (route === 'sessions/queries') return page([]);
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async () => { throw new Error('no send in this pass'); },
  } } };
  const rec = new Record({ id: 'intervention', rows: ['C-199'], checks: [{ id: 'claim-once', rows: ['C-199'], text: '领一次' }] });
  const claim = { messageRef: claimRef, line: 's1', taskId: 't1', work: 'g-long/t1 active/ready', goalRef: LONG_GOAL,
    occupancy: '空闲', at: '2026-01-01T10:00:00Z', before: new Set(['r-old']), snap: null, refused: null };
  const watch = { idle: null, claim, interventions: [] };
  await INT.idleWatchStep(project, LONG_GOAL, watch, 'PAUSED', rec);
  const snap = watch.claim.snap;
  assert.ok(snap, 'the accepted letter gets its snapshot');
  assert.ok(snap.point, 'the snapshot records the point, not only the message view');
  assert.deepEqual(snap.point.goalRef, LONG_GOAL, 'the actual Goal');
  assert.equal(snap.point.tasks[0].disposition, 'active', 'the Task state');
  assert.equal(snap.point.sessionCard.availability, 'busy', 'the line availability');
  assert.equal(snap.point.sessionCard.occupancy.executionRef.runId, 'r-new', 'the line occupancy');
  assert.equal(snap.point.occupancy.running[0].runId, 'r-new', 'the Work Run');
  assert.equal(snap.point.deliveredTo.executionRef.runId, 'r-new', 'attribution: deliveredTo');
  assert.equal(snap.point.acceptedInputs[0].executionRef.runId, 'r-new', 'attribution: acceptedInputs');
  assert.deepEqual(snap.runs.map(item => item.run.ref.runId), ['r-new']);
  assert.equal(snap.point.planning, null, 'the claim branch opened no planning Query');
  assert.equal(claim.goalRef, LONG_GOAL, 'the send snapshot stays beside the point');
  assert.equal(claim.work, 'g-long/t1 active/ready');
  assert.equal(claim.at, '2026-01-01T10:00:00Z');
  // A field that cannot be read is a gap in the point, not a throw.
  failExecutions = true;
  const gapClaim = { ...claim, snap: null };
  const gapWatch = { idle: null, claim: gapClaim, interventions: [] };
  await INT.idleWatchStep(project, LONG_GOAL, gapWatch, 'PAUSED', rec);
  assert.ok(gapWatch.claim.snap.point, 'the delivered letter still gets its point');
  assert.ok(gapWatch.claim.snap.point.gaps.some(gap => /executions\/list/.test(gap) && /unavailable/.test(gap)),
    gapWatch.claim.snap.point.gaps.join('；'));
});

test('P6K intervention: a starting Run whose consumedWait names the still-offerable letter keeps the point', async () => {
  const claimRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm-claim-starting' };
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g-long', taskId: 't1', runId: 'r-new' };
  const project = { scope: A, host: { client: {
    read: async (route) => {
      // The letter is not delivered yet: the Run it opened is only starting, and the association is its consumedWait.
      if (route === 'messages/view') return answered({ message: { acceptedInputs: [] }, delivery: { deliveredTo: null },
        disposition: { kind: 'offerable' } });
      if (route === 'sessions/read') return answered({ availability: 'busy', links: [],
        record: { occupancy: { kind: 'execution', executionRef: runRef }, lifecycle: 'active', health: 'available' } });
      if (route === 'executions/list') return page([{ run: { ref: { runId: 'r-new' }, task: { taskId: 't1' }, status: 'starting',
        consumedWait: { kind: 'intervention', messageRef: claimRef } }, outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's1' } } } }]);
      if (route === 'tasks/query') return answered({ tasks: [{ ref: { taskId: 't1' }, disposition: 'active', effectivePhase: 'ready',
        execution: { runId: 'r-new' } }] });
      if (route === 'lines/list') return answered({ rows: [{ key: { projectId: 'p', sessionId: 's1' }, status: { own: 'working', markers: [] }, controls: [] }] });
      if (route === 'sessions/queries') return page([]);
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async () => { throw new Error('no send in this pass'); },
  } } };
  const rec = new Record({ id: 'intervention', rows: ['C-199'], checks: [{ id: 'claim-once', rows: ['C-199'], text: '领一次' }] });
  const claim = { messageRef: claimRef, line: 's1', taskId: 't1', work: 'g-long/t1 active/ready', goalRef: LONG_GOAL,
    occupancy: '空闲', at: '2026-01-01T10:00:00Z', before: new Set(), snap: null, refused: null };
  const watch = { idle: null, claim, interventions: [] };
  await INT.idleWatchStep(project, LONG_GOAL, watch, 'PAUSED', rec);
  const snap = watch.claim.snap;
  assert.ok(snap, 'the first association keeps the point before delivery or a settled disposition');
  assert.equal(snap.point.disposition?.kind, 'offerable', 'the letter is still offerable');
  assert.equal(snap.point.deliveredTo, null, 'delivery has not happened yet');
  assert.deepEqual(snap.point.goalRef, LONG_GOAL, 'the Goal comes from the corresponding Run');
  assert.deepEqual(snap.runs.map(item => item.run.ref.runId), ['r-new'], 'the Run that consumed this letter');
  const verdict = INT.claimVerdict(snap);
  assert.equal(verdict.status, 'pass', verdict.text);
});

test('P6K intervention: the evidence point and the claim verdict share one executions read; a failed read is a gap, not a culprit', async () => {
  const claimRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm-claim-shared' };
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g-long', taskId: 't1', runId: 'r-new' };
  let reads = 0;
  let failReads = false;
  const project = { scope: A, host: { client: {
    read: async (route) => {
      if (route === 'messages/view') return answered({ message: { acceptedInputs: [{ part: 'message', executionRef: runRef }] },
        delivery: { deliveredTo: { executionRef: runRef } }, disposition: { kind: 'delivered' } });
      if (route === 'sessions/read') return answered({ availability: 'busy', links: [],
        record: { occupancy: { kind: 'execution', executionRef: runRef }, lifecycle: 'active', health: 'available' } });
      if (route === 'executions/list') {
        reads += 1;
        if (failReads || reads > 1) return { status: 'rejected', code: 'unavailable', reason: 'run store down' };
        return page([{ run: { ref: { runId: 'r-old' }, task: { taskId: 't1' }, status: 'ended' },
          outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's1' } } } },
        { run: { ref: { runId: 'r-new' }, task: { taskId: 't1' }, status: 'starting',
          consumedWait: { kind: 'intervention', messageRef: claimRef } }, outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's1' } } } }]);
      }
      if (route === 'tasks/query') return answered({ tasks: [{ ref: { taskId: 't1' }, disposition: 'active', effectivePhase: 'ready',
        execution: { runId: 'r-new' } }] });
      if (route === 'lines/list') return answered({ rows: [{ key: { projectId: 'p', sessionId: 's1' }, status: { own: 'working', markers: [] }, controls: [] }] });
      if (route === 'sessions/queries') return page([]);
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async () => { throw new Error('no send in this pass'); },
  } } };
  const rec = new Record({ id: 'intervention', rows: ['C-199'], checks: [{ id: 'claim-once', rows: ['C-199'], text: '领一次' }] });
  const claim = { messageRef: claimRef, line: 's1', taskId: 't1', work: 'g-long/t1 active/ready', goalRef: LONG_GOAL,
    occupancy: '空闲', at: '2026-01-01T10:00:00Z', before: new Set(['r-old']), snap: null, refused: null };
  const watch = { idle: null, claim, interventions: [] };
  await INT.idleWatchStep(project, LONG_GOAL, watch, 'PAUSED', rec);
  const snap = watch.claim.snap;
  assert.ok(snap, 'the delivered letter gets its snapshot');
  assert.equal(reads, 1, 'one executions read serves both the point and the verdict');
  assert.deepEqual(snap.runs.map(item => item.run.ref.runId), ['r-new'], 'the snapshot keeps the Run the one read returned');
  assert.equal(snap.point.occupancy.running[0].runId, 'r-new');
  // The single read fails: the point keeps its gap and the snapshot marks its runs unavailable instead of empty.
  failReads = true;
  const failClaim = { ...claim, snap: null };
  const failWatch = { idle: null, claim: failClaim, interventions: [] };
  await INT.idleWatchStep(project, LONG_GOAL, failWatch, 'PAUSED', rec);
  const failSnap = failWatch.claim.snap;
  assert.ok(failSnap, 'a failed read still leaves the point');
  assert.equal(failSnap.runs, null, 'the snapshot runs are unavailable, not an empty list');
  assert.ok(failSnap.point.gaps.some(gap => /executions\/list/.test(gap) && /unavailable/.test(gap)),
    failSnap.point.gaps.join('；'));
  const verdict = INT.claimVerdict({ runs: null });
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'env-unavailable');
  assert.doesNotMatch(verdict.text, /目标循环先领了/);
});

test('P6K intervention: an idle cell whose probe never went out names the busy line in its note', async () => {
  const checks = [{ id: 'planning-when-idle', rows: ['C-199'], text: '空闲规划' }];
  const rec = new Record({ id: 'intervention', rows: ['C-199'], checks });
  const busy = { line: 's1', at: '2026-01-01T10:00:00Z', task: 'g-long/t1 active/verifying',
    why: 'Query intervention-planning-busy（running）', goalRef: LONG_GOAL };
  // No probe was sent, so judging it reads nothing (`idle === null` returns at once).
  const project = { scope: A, host: { client: { read: async () => { throw new Error('nothing is read when no probe was sent'); } } } };
  await INT.judgeIdleIntervention(quietCtx(rec), project, rec, null, LONG_GOAL, busy);
  const cell = rec.results.get('planning-when-idle');
  assert.equal(cell.status, 'uncovered');
  assert.equal(cell.code, 'not-run');
  assert.match(cell.note, /线在忙/);
  assert.match(cell.note, /intervention-planning-busy/);
  assert.match(cell.note, /s1/);
  // Without a recorded wait the old sentence still says no such moment occurred.
  const old = new Record({ id: 'intervention', rows: ['C-199'], checks });
  await INT.judgeIdleIntervention(quietCtx(old), project, old, null, LONG_GOAL);
  assert.match(old.results.get('planning-when-idle').note, /没有出现/);
});

test('P6J4 intervention: the whole-Goal wait timing out keeps its stop and the idle cell is still judged on its message', async () => {
  const idleRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm-idle' };
  const planning = 'intervention-planning-idle';
  const project = { scope: A, host: { client: { read: async (route, _scope, input) => {
    if (route === 'lines/list') return answered({ rows: [{ key: { projectId: 'p', sessionId: 's1' } }] });
    if (route === 'sessions/queries') return answered({ items: [{ ref: queryRunRef(planning, 'run-idle'),
      run: { queryJobRef: queryJobRef(planning), status: 'answered' } }], nextCursor: null });
    if (route === 'queries/read') {
      if (input?.aggregateType !== 'QueryJob') return { status: 'rejected', code: 'invalid', reason: 'readQueryJob requires a complete QueryJobRef' };
      return answered({ job: { job: { queryJobId: planning, intent: { execution: { sourceMessageRef: idleRef } } } },
        run: { ref: queryRunRef(planning, 'run-idle'), run: { status: 'answered' } } });
    }
    if (route === 'decisions/queue') return answered({ waitingAnswer: [{ cardKey: 'cand-idle', state: 'waiting', source: { kind: 'candidate' },
      requestRef: { queryJobId: planning } }], history: [] });
    if (route === 'messages/read') return answered({ status: 'pending', withdrawnAt: null });
    if (route === 'goals/display') return answered({ display: { phase: 'ACTIVE' } });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const rec = new Record({ id: 'intervention', rows: ['C-199'], checks: [{ id: 'planning-when-idle', rows: ['C-199'], text: '空闲规划' }] });
  const watch = { idle: { messageRef: idleRef, line: 's1', phase: 'ACTIVE', work: 'g-long/t1 active/satisfied',
    goalRef: LONG_GOAL, occupancy: '空闲', at: '2026-01-01T10:00:00Z', refused: null },
    claim: null, interventions: [], stopped: false };
  const busyEnd = await INT.afterLongWait(quietCtx(rec), project, rec, { goalRef: LONG_GOAL, watch,
    wait: async () => { throw new WaitTimeout('timed out after 150 min waiting for g-long to reach COMPLETED'); } });
  assert.equal(busyEnd, null);
  assert.match(rec.facts.longGoal.stoppedFor, /timed out after 150 min/);
  assert.equal(watch.stopped, true);
  assert.equal(rec.results.get('planning-when-idle')?.status, 'pass', 'judged on the idle message after the timeout');
  const note = rec.results.get('planning-when-idle').note;
  assert.match(note, /cand-idle/);
  assert.match(note, /目标 g-long/, 'the note names the Goal the message was sent for');
  assert.match(note, /发信时线的占用 空闲/, 'the note keeps the occupancy read at the send');
  assert.match(note, /QueryRun run-idle/, 'the note names the QueryRun that handled it');
});

test('P6L intervention: a busy line that delivers the paused letter after resume passes', () => {
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g-long', taskId: 't1', runId: 'r1' };
  const premise = INTMOD.pausePremiseOf({ work: { readable: true, task: { taskId: 't1' }, unfinished: true,
    text: 'g-long/t1 active/running' }, busy: { busy: true, why: '未结束的 Work Run r1（running）' }, run: { run: { task: { taskId: 't1' } } } });
  assert.equal(premise.ok, true);
  const verdict = INTMOD.pausedVerdict({ premise, whilePaused: 'offerable', afterResume: 'delivered',
    view: { disposition: { kind: 'delivered' }, delivery: { deliveredTo: { executionRef: runRef } } },
    planning: null, planningGaps: [], resumeCommitted: true });
  assert.equal(verdict.status, 'pass');
  assert.match(verdict.note, /Run r1/);
});

test('P6L2 intervention: a letter the paused Goal already delivered into Work fails', () => {
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g-long', taskId: 't1', runId: 'r1' };
  const premise = INTMOD.pausePremiseOf({ work: { readable: true, task: { taskId: 't1' }, unfinished: true,
    text: 'g-long/t1 active/running' }, busy: { busy: true, why: '未结束的 Work Run r1（running）' }, run: { run: { task: { taskId: 't1' } } } });
  const verdict = INTMOD.pausedVerdict({ premise, whilePaused: 'delivered', afterResume: 'delivered',
    whilePausedInto: runRef,
    view: { disposition: { kind: 'delivered' }, delivery: { deliveredTo: { executionRef: runRef } } },
    planning: null, planningGaps: [], resumeCommitted: true });
  assert.equal(verdict.status, 'fail', 'delivered while paused contradicts "paused only queues" (MVP-BEHAVIOR.md:378)');
  assert.match(verdict.note, /暂停中.*送进 Work/);
});

test('P6L intervention: a line whose busy reads fail is an environment gap, never a proven busy premise', async () => {
  const project = { scope: A, host: { client: { read: async route => route === 'sessions/read'
    ? { status: 'rejected', code: 'unavailable', reason: 'line store down' }
    : { status: 'rejected', code: 'unavailable', reason: 'query store down' } } } };
  const sessionRef = { projectId: 'p', sessionId: 's1' };
  const busy = await INTMOD.lineBusy(project, [], sessionRef);
  assert.equal(busy.readable, false, 'the two failed reads are not a busy reading');
  assert.equal(busy.gaps.length, 2);
  const premise = INTMOD.pausePremiseOf({ work: { readable: true, task: { taskId: 't1' }, unfinished: true,
    text: 'g-long/t1 active/running' }, busy, run: { run: { task: { taskId: 't1' } } } });
  assert.equal(premise.ok, false);
  assert.equal(premise.code, 'env-unavailable');
  assert.match(premise.missing, /sessions\/read s1/, 'the failed read is named');
  const verdict = INTMOD.pausedVerdict({ premise, whilePaused: 'offerable', afterResume: null, view: null,
    planning: null, planningGaps: [], resumeCommitted: true });
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'env-unavailable');
});

test('P6L intervention: an idle line at pause is uncovered with the missing work named, never a false failure', () => {
  const noTask = INTMOD.pausePremiseOf({ work: { readable: true, task: null, unfinished: false, text: '没有 latestWork' },
    busy: { busy: false, why: null }, run: null });
  assert.equal(noTask.ok, false);
  assert.equal(noTask.code, 'not-run');
  assert.match(noTask.missing, /没有当前工作/);
  const noRun = INTMOD.pausePremiseOf({ work: { readable: true, task: { taskId: 't1' }, unfinished: true, text: 'g-long/t1 active/pending' },
    busy: { busy: false, why: null }, run: null });
  assert.equal(noRun.ok, false);
  assert.equal(noRun.code, 'not-run');
  assert.match(noRun.missing, /没有在跑的 Run/);
  const verdict = INTMOD.pausedVerdict({ premise: noTask, whilePaused: 'offerable', afterResume: 'delivered',
    view: null, planning: null, planningGaps: [], resumeCommitted: true });
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'not-run');
  assert.match(verdict.note, /没有当前工作/);
});

test('P6L intervention: a proven-busy line whose paused letter times out still fails', () => {
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g-long', taskId: 't1', runId: 'r1' };
  const premise = INTMOD.pausePremiseOf({ work: { readable: true, task: { taskId: 't1' }, unfinished: true,
    text: 'g-long/t1 active/running' }, busy: { busy: true, why: '未结束的 Work Run r1（running）' }, run: { run: { task: { taskId: 't1' } } } });
  const verdict = INTMOD.pausedVerdict({ premise, whilePaused: 'offerable', afterResume: 'offerable', ended: 'deadline',
    view: { disposition: { kind: 'offerable' }, delivery: { deliveredTo: null } }, planning: null, planningGaps: [], resumeCommitted: true });
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.note, /30 分钟/);
});

test('P6L intervention: an unreadable current-work read names the gap and keeps the cell result', () => {
  const rec = new Record({ id: 'intervention', rows: ['C-197'], checks: [
    { id: 'paused-queues', rows: ['C-197'], text: '暂停时干预只排队' }] });
  rec.uncover('paused-queues', 'not-run', '原来的判据结果');
  const before = { ...rec.results.get('paused-queues') };
  const premise = INTMOD.pausePremiseOf({ work: { readable: false, text: 'sessions/facts 没有回答' },
    busy: { busy: true, why: '未结束的 Work Run r1（running）' }, run: { run: { task: { taskId: 't1' } } } });
  assert.equal(premise.ok, false);
  assert.equal(premise.code, 'env-unavailable');
  assert.match(premise.missing, /sessions\/facts/);
  const verdict = INTMOD.pausedVerdict({ premise, whilePaused: 'offerable', afterResume: null, view: null,
    planning: null, planningGaps: [], resumeCommitted: true });
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'env-unavailable');
  assert.match(verdict.note, /sessions\/facts/);
  assert.deepEqual(rec.results.get('paused-queues'), before, 'the helper judges nothing, the original result stays');
});

test('P6J4 intervention: the three moments read the same letter, line and Run, with the SessionCard and each control intent\'s state', async () => {
  // The platform's real shape (`control-intent-machine.ts:181-190`): pause and resume move `controlState.intentRef`;
  // only a steer is appended to `controlInputs`. The resume replaces the pause pointer, so the moment before the
  // resume notes it (`rememberControls`) and the later moments still read the pause's own state.
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g-long', taskId: 't1', runId: 'r1' };
  const letter = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm-paused' };
  const intent = intentId => ({ aggregateType: 'ControlIntent', projectId: 'p', workspaceId: 'wa', intentId });
  const pointer = (intentId, desiredState) => ({ intentRef: intent(intentId), desiredState });
  const moments = {
    'before-pause': { availability: 'busy', pointer: undefined, inputs: [], states: {} },
    'while-paused': { availability: 'busy', pointer: pointer('ci-pause', 'paused'), inputs: [], states: { 'ci-pause': 'applied' } },
    'after-resume': { availability: 'busy', pointer: pointer('ci-resume', 'running'), inputs: ['ci-steer'],
      states: { 'ci-pause': 'applied', 'ci-resume': 'queued', 'ci-steer': 'queued' } },
    'before-cleanup': { availability: 'idle', pointer: pointer('ci-resume', 'running'), inputs: ['ci-steer'],
      states: { 'ci-pause': 'applied', 'ci-resume': 'applied', 'ci-steer': 'applied' } },
  };
  const kinds = { 'ci-pause': 'pause', 'ci-resume': 'resume', 'ci-steer': 'steer' };
  let now = 'before-pause';
  const calls = [];
  const project = { scope: A, host: { client: { read: async (route, _scope, input) => {
    calls.push({ route, input, now });
    const moment = moments[now];
    switch (route) {
      case 'messages/view': return answered({ message: { acceptedInputs: [] }, delivery: { deliveredTo: null }, disposition: { kind: 'queued' } });
      case 'sessions/read': return answered({ availability: moment.availability, links: [], record: { lifecycle: 'active', health: 'available',
        occupancy: moment.availability === 'busy' ? { kind: 'execution', executionRef: runRef } : null } });
      case 'executions/read': return answered({ run: { status: 'running', lastEventSeq: 7, controlInputs: moment.inputs.map(intent),
        ...(moment.pointer === undefined ? {} : { controlState: moment.pointer }) } });
      case 'controls/read': {
        const status = moment.states[input.intentId];
        if (status === undefined) return { status: 'not_found' };
        return answered({ ref: input, kind: kinds[input.intentId], status, requestedAt: '2026-01-01T10:00:00Z',
          ...(status === 'queued' ? {} : { observation: { kind: `${kinds[input.intentId]}d`, observedAt: '2026-01-01T10:01:00Z' } }) });
      }
      case 'lines/list': return answered({ rows: [{ key: { projectId: 'p', sessionId: 's1' }, status: { own: 'working', markers: [] }, controls: [] }] });
      case 'executions/list': return answered({ items: [], nextCursor: null });
      case 'tasks/query': return answered({ tasks: [] });
      default: throw new Error(`the fake Host does not answer ${route}`);
    }
  } } } };
  const timeline = { line: 's1', runRef, gaps: [] };
  const points = [];
  now = 'before-pause';
  points.push(await timelinePoint(project, timeline, 'before-pause', null, LONG_GOAL));
  now = 'while-paused';
  await INT.rememberControls(project, timeline);
  for (const [name, ref] of [['after-resume', letter], ['before-cleanup', letter]]) {
    now = name;
    points.push(await timelinePoint(project, timeline, name, ref, LONG_GOAL));
  }
  assert.ok(calls.filter(call => call.route === 'sessions/read').every(call => call.input.sessionId === 's1'), 'the same line each time');
  assert.ok(calls.filter(call => call.route === 'executions/read').every(call => call.input.runId === 'r1'), 'the same Run each time');
  assert.ok(calls.filter(call => call.route === 'messages/view').every(call => call.input.messageId === 'm-paused'), 'the same letter each time');
  assert.deepEqual(points.map(point => point.sessionCard?.availability), ['busy', 'busy', 'idle']);
  assert.equal(points[0].sessionCard?.occupancy?.executionRef?.runId, 'r1');
  const states = point => Object.fromEntries((point.controlIntents ?? []).map(entry => [entry.kind, entry.status]));
  assert.deepEqual(points.map(states), [{}, { pause: 'applied', resume: 'queued', steer: 'queued' }, { pause: 'applied', resume: 'applied', steer: 'applied' }]);
  assert.equal(points[2].controlIntents.find(entry => entry.kind === 'resume').observation.kind, 'resumed');
  // Each intent is read once per moment.
  const afterResumeReads = calls.filter(call => call.route === 'controls/read' && call.now === 'after-resume').map(call => call.input.intentId);
  assert.deepEqual([...afterResumeReads].sort(), ['ci-pause', 'ci-resume', 'ci-steer']);
});

// ---- P6K waiting: the extra evidence fields (diagnosis "只能等第六次" waiting row). Evidence only: no check is judged.

const WAIT_GOAL = { aggregateType: 'Goal', projectId: 'p', goalId: 'g-wait' };
const WAIT_MEMBER = { projectId: 'p', sessionId: 's-member' };
const waitRun = (runId, fields = {}) => ({ run: { ref: { runId }, task: { taskId: 't-wait' }, status: 'ended', outcome: 'completed',
  startedAt: '2026-01-01T10:00:35Z', endedAt: '2026-01-01T10:00:00Z', ...fields },
  outbox: { claim: { claimedAt: '2026-01-01T10:00:30Z', sessionRef: { projectId: 'p', sessionId: 's-member' } } } });

test('P6K waiting: the evidence names expiredAt, the interjection\'s final answer and end, the satisfying Run, continuations and accepted inputs', async () => {
  const tasks = [{ ref: { taskId: 't-wait' }, disposition: 'active', effectivePhase: 'satisfied', execution: { runId: 'r-sat' },
    reduction: { revision: 3, phase: 'satisfied', reducedAt: '2026-01-01T10:09:00Z' } }];
  const runs = [
    waitRun('r-int', { endedAt: '2026-01-01T10:05:00Z',
      consumedWait: { kind: 'intervention', messageRef: { messageId: 'm-interject' } } }),
    waitRun('r-next', { outcome: 'yielded', endedAt: '2026-01-01T10:06:00Z', requeueRef: { runId: 'r-next' },
      continuation: { kind: 'wait', messageRef: { messageId: 'm-first' } } }),
    waitRun('r-sat', { endedAt: '2026-01-01T10:07:00Z' }),
  ];
  const history = [
    eventAt('2026-01-01T10:03:00Z', 'assistant.message_completed', { message: { messageId: 'a-old', content: '旧回答' } }, 'r-int', 't0'),
    eventAt('2026-01-01T10:03:01Z', 'run.completed', { finalMessageId: 'a-old' }, 'r-int', 't0'),
    eventAt('2026-01-01T10:04:00Z', 'assistant.message_completed', { message: { messageId: 'a-int', content: '插话的处理：继续等秘书回答' } }, 'r-int', 't1'),
    eventAt('2026-01-01T10:04:01Z', 'run.completed', { finalMessageId: 'a-int' }, 'r-int', 't1'),
  ].map(record => ({ body: { text: JSON.stringify(record) } }));
  const project = { scope: A, host: { client: { read: async (route) => {
    if (route === 'executions/list') return page(runs);
    if (route === 'executions/history') return page(history);
    if (route === 'tasks/query') return answered({ tasks });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const rec = new Record({ id: 'waiting', rows: ['C-170'], checks: [{ id: 'expiry-once', rows: ['C-171'], text: '到期' }] });
  const letter = { expiredAt: '2026-01-01T10:02:00Z',
    acceptedInputs: [{ part: 'expiry', consumesWait: false, acceptedAt: '2026-01-01T10:02:05Z' }] };
  const latest = { expiredAt: '2026-01-01T10:02:00Z',
    acceptedInputs: [{ part: 'expiry', consumesWait: true, acceptedAt: '2026-01-01T10:09:00Z' }] };
  const evidence = await WAIT.waitingEvidence(project, rec, { goalRef: WAIT_GOAL, wait: { messageRef: { messageId: 'm-first' } },
    taskId: 't-wait', interjectRunId: 'r-int', letter, chainLetter: latest });
  assert.equal(evidence.expiredAt, '2026-01-01T10:02:00Z');
  assert.equal(evidence.interject.runId, 'r-int');
  assert.equal(evidence.interject.endedAt, '2026-01-01T10:05:00Z');
  assert.equal(evidence.interject.final, '插话的处理：继续等秘书回答', 'the last turn with a final answer, not the first');
  assert.equal(evidence.satisfiedAt, '2026-01-01T10:09:00Z', 'the satisfied reduction\'s reducedAt, not a Run endedAt');
  assert.equal(evidence.satisfiedRunId, 'r-sat');
  assert.equal(evidence.satisfiedRunEndedAt, '2026-01-01T10:07:00Z', 'the satisfying Run\'s endedAt stays separate');
  assert.deepEqual(evidence.claimable, { window: null, verdict: '无法确认可领取' }, 'no moment taken: never claims a Run was claimable');
  assert.deepEqual(evidence.continuations.map(entry => entry.runId), ['r-int', 'r-next']);
  assert.equal(evidence.continuations[1].claim, 's-member');
  assert.equal(evidence.continuations[0].claimedAt, '2026-01-01T10:00:30Z');
  assert.equal(evidence.continuations[0].startedAt, '2026-01-01T10:00:35Z');
  assert.equal(evidence.continuations[1].requeueRef.runId, 'r-next');
  assert.deepEqual(evidence.acceptedInputs, [{ part: 'expiry', consumesWait: true, acceptedAt: '2026-01-01T10:09:00Z' }]);
  assert.deepEqual(rec.facts.waitingEvidence, evidence);
  assert.equal(rec.results.size, 0, 'only evidence: no check is judged');
  const note = rec.notes.at(-1);
  assert.match(note, /窗口 expiredAt 2026-01-01T10:02:00Z–satisfiedAt 2026-01-01T10:09:00Z/);
  for (const text of ['2026-01-01T10:02:00Z', '插话的处理：继续等秘书回答', '2026-01-01T10:05:00Z', '2026-01-01T10:09:00Z',
    '2026-01-01T10:07:00Z', 'r-int', 'r-next', 'r-sat', 'expiry/true@2026-01-01T10:09:00Z', '2026-01-01T10:00:30Z',
    '到期窗口证据：观察时缺失', '判定：无法确认可领取',
    '2026-01-01T10:00:35Z']) assert.ok(note.includes(text), `${text} in ${note}`);
});

test('P6K waiting: with no successful chain read the last previously known acceptance is kept', async () => {
  const runs = [waitRun('r-next', { endedAt: '2026-01-01T10:06:00Z' })];
  const project = { scope: A, host: { client: { read: async (route) => {
    if (route === 'executions/list') return page(runs);
    if (route === 'tasks/query') return answered({ tasks: [{ ref: { taskId: 't-wait' }, disposition: 'active', effectivePhase: 'ready' }] });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const rec = new Record({ id: 'waiting', rows: ['C-170'], checks: [] });
  const older = { expiredAt: '2026-01-01T10:02:00Z', acceptedInputs: [] };
  const lastLetter = { expiredAt: '2026-01-01T10:02:00Z', acceptedInputs: [{ part: 'expiry', consumesWait: true,
    acceptedAt: '2026-01-01T10:09:00Z', executionRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g-wait', taskId: 't-wait', runId: 'r-next' } }] };
  const evidence = await WAIT.waitingEvidence(project, rec, { goalRef: WAIT_GOAL, wait: { messageRef: { messageId: 'm-first' } },
    taskId: 't-wait', letter: older, chainLetter: null, lastLetter });
  assert.equal(evidence.acceptedInputs.length, 1, 'the previously known acceptance, not the older expired re-read');
  assert.equal(evidence.acceptedInputs[0].part, 'expiry');
  assert.equal(evidence.acceptedInputs[0].executionRef?.runId, 'r-next');
  assert.ok(evidence.gaps.some(gap => /追链没有成功读到的原信/.test(gap)), evidence.gaps.join('；'));
});

test('P6K waiting: the satisfying moment is the satisfied reduction\'s reducedAt and a missing reduction is a gap', async () => {
  const runs = [waitRun('r-sat', { endedAt: '2026-01-01T10:07:00Z' })];
  let reduction = { revision: 3, phase: 'satisfied', reducedAt: '2026-01-01T10:09:00Z' };
  const project = { scope: A, host: { client: { read: async (route) => {
    if (route === 'executions/list') return page(runs);
    if (route === 'tasks/query') return answered({ tasks: [{ ref: { taskId: 't-wait' }, disposition: 'active',
      effectivePhase: 'satisfied', ...(reduction === null ? {} : { reduction }), execution: { runId: 'r-sat' } }] });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const rec = new Record({ id: 'waiting', rows: ['C-170'], checks: [] });
  const args = { goalRef: WAIT_GOAL, wait: { messageRef: { messageId: 'm-first' } }, taskId: 't-wait',
    letter: { expiredAt: '2026-01-01T10:02:00Z', acceptedInputs: [] } };
  const evidence = await WAIT.waitingEvidence(project, rec, args);
  assert.equal(evidence.satisfiedAt, '2026-01-01T10:09:00Z', 'reduction.reducedAt, not the Run endedAt');
  assert.equal(evidence.satisfiedRunId, 'r-sat');
  assert.equal(evidence.satisfiedRunEndedAt, '2026-01-01T10:07:00Z', 'the Run endedAt is kept apart');
  assert.match(rec.notes.at(-1), /满足时刻 2026-01-01T10:09:00Z/);
  reduction = null;
  const missing = await WAIT.waitingEvidence(project, rec, args);
  assert.equal(missing.satisfiedAt, null, 'never derived from the Run endedAt');
  assert.ok(missing.gaps.includes('Task t-wait 的归约证据缺失'), missing.gaps.join('；'));
  assert.match(rec.notes.at(-1), /归约证据缺失/);
});

test('P6K waiting: the expiry window point names the letter, Run, Task eligibility and line occupancy, with its verdict', async () => {
  const runs = [waitRun('r-yield', { outcome: 'yielded', endedAt: '2026-01-01T10:06:00Z' })];
  let task = { ref: { taskId: 't-wait' }, disposition: 'active', effectivePhase: 'ready', execution: { runId: 'r-yield' },
    eligibility: { eligible: true, reasons: [] } };
  let card = { availability: 'idle', links: [], record: { lifecycle: 'active', health: 'available', occupancy: null } };
  const project = { scope: A, host: { client: { read: async (route) => {
    if (route === 'executions/list') return page(runs);
    if (route === 'tasks/query') return answered({ tasks: [task] });
    if (route === 'sessions/read') return answered(card);
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const rec = new Record({ id: 'waiting', rows: ['C-170'], checks: [] });
  const letter = { expiredAt: '2026-01-01T10:02:00Z', acceptedInputs: [] };
  const take = async () => {
    const window = await WAIT.expiryWindow(project, { goalRef: WAIT_GOAL, messageRef: { messageId: 'm-first' },
      expiredAt: letter.expiredAt, runId: 'r-yield', taskId: 't-wait', line: WAIT_MEMBER });
    const evidence = await WAIT.waitingEvidence(project, rec, { goalRef: WAIT_GOAL, wait: { messageRef: { messageId: 'm-first' } },
      taskId: 't-wait', letter, window });
    return { window, evidence };
  };
  // Task unsatisfied and the line free: the moment keeps its evidence, but eligibility is only the Task-state check.
  const free = await take();
  assert.deepEqual(free.window.gaps, []);
  assert.equal(free.window.letter.messageId, 'm-first');
  assert.equal(free.window.letter.expiredAt, '2026-01-01T10:02:00Z');
  assert.match(free.window.letter.observedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    'the moment it was observed is kept apart from expiredAt');
  assert.deepEqual(free.window.run, { runId: 'r-yield', status: 'ended', endedAt: '2026-01-01T10:06:00Z' });
  assert.deepEqual(free.window.task, { disposition: 'active', effectivePhase: 'ready', eligibility: { eligible: true, reasons: [] } });
  assert.deepEqual(free.window.line, { sessionId: 's-member', availability: 'idle', occupancy: null });
  assert.equal(free.evidence.claimable.window, free.window);
  assert.match(free.evidence.claimable.verdict, /观察时无法确认可领取/);
  assert.doesNotMatch(free.evidence.claimable.verdict, /可领取窗口存在/);
  assert.match(free.evidence.claimable.verdict, /Task 状态资格/);
  assert.match(free.evidence.claimable.verdict, /领取暂缓|占用/);
  assert.match(rec.notes.at(-1), /到期窗口证据：原信 m-first/);
  assert.match(rec.notes.at(-1), /判定：观察时无法确认可领取/);
  assert.doesNotMatch(rec.notes.at(-1), /可领取窗口存在/);
  // Task already satisfied: the platform skips it.
  task = { ...task, effectivePhase: 'satisfied' };
  const satisfied = await take();
  assert.match(satisfied.evidence.claimable.verdict, /满足/);
  assert.match(satisfied.evidence.claimable.verdict, /平台会跳过/);
  // Ready and unsatisfied, but the platform's own eligibility says skip: the verdict names the reasons.
  task = { ...task, effectivePhase: 'ready',
    eligibility: { eligible: false, reasons: [{ code: 'gate-unmet' }, { code: 'run-active' }] } };
  const ineligible = await take();
  assert.match(ineligible.evidence.claimable.verdict, /平台会跳过/);
  assert.match(ineligible.evidence.claimable.verdict, /eligibility false/);
  assert.match(ineligible.evidence.claimable.verdict, /gate-unmet/);
  assert.match(ineligible.evidence.claimable.verdict, /run-active/);
  assert.deepEqual(ineligible.window.task.eligibility, { eligible: false, reasons: [{ code: 'gate-unmet' }, { code: 'run-active' }] },
    'the window facts keep the row\'s eligibility and reasons');
  assert.match(rec.notes.at(-1), /平台会跳过（eligibility false：gate-unmet, run-active）/);
  assert.doesNotMatch(ineligible.evidence.claimable.verdict, /可领取窗口存在/);
  // A line held by a Run: the verdict names the holder.
  task = { ...task, effectivePhase: 'ready', eligibility: { eligible: true, reasons: [] } };
  card = { availability: 'busy', links: [], record: { lifecycle: 'active', health: 'available',
    occupancy: { kind: 'execution', executionRef: { aggregateType: 'Run', runId: 'r-holder' } } } };
  const busy = await take();
  assert.match(busy.evidence.claimable.verdict, /线 s-member 被/);
  assert.match(busy.evidence.claimable.verdict, /r-holder/);
  // A read that fails is a gap, and the moment then claims nothing.
  card = null;
  const missing = await take();
  assert.ok(missing.window.gaps.some(gap => /sessions\/read s-member/.test(gap)), missing.window.gaps.join('；'));
  assert.equal(missing.evidence.claimable.verdict, '无法确认可领取');
});

test('P6K waiting: the final acceptedInputs come from the last successfully read letter and keep executionRef', async () => {
  const runs = [waitRun('r-next', { endedAt: '2026-01-01T10:06:00Z' })];
  const project = { scope: A, host: { client: { read: async (route) => {
    if (route === 'executions/list') return page(runs);
    if (route === 'tasks/query') return answered({ tasks: [{ ref: { taskId: 't-wait' }, disposition: 'active', effectivePhase: 'ready' }] });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const rec = new Record({ id: 'waiting', rows: ['C-170'], checks: [] });
  const older = { expiredAt: '2026-01-01T10:02:00Z',
    acceptedInputs: [{ part: 'response', consumesWait: false, acceptedAt: '2026-01-01T10:02:05Z' }] };
  const chainLetter = { expiredAt: '2026-01-01T10:02:00Z', acceptedInputs: [{ part: 'expiry', consumesWait: true,
    acceptedAt: '2026-01-01T10:09:00Z', executionRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g-wait', taskId: 't-wait', runId: 'r-next' } }] };
  const evidence = await WAIT.waitingEvidence(project, rec, { goalRef: WAIT_GOAL, wait: { messageRef: { messageId: 'm-first' } },
    taskId: 't-wait', letter: older, chainLetter });
  assert.equal(evidence.acceptedInputs.length, 1, 'the older re-read never wins over the chain\'s last read');
  assert.equal(evidence.acceptedInputs[0].part, 'expiry');
  assert.equal(evidence.acceptedInputs[0].executionRef?.runId, 'r-next', 'the attribution ref survives');
});

test('P6K waiting: finalizeWaiting records the empty tasks/query gap and produces the real consumes verdict', async () => {
  const project = { scope: A, host: { client: { read: async (route) => {
    if (route === 'executions/list') return page([]);
    if (route === 'tasks/query') return null;
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const rec = new Record({ id: 'waiting', rows: ['C-170'], checks: [{ id: 'consumes', rows: ['C-171'], text: '消费' }] });
  const chain = { chain: [{ acceptedInputs: [{ part: 'expiry', consumesWait: true, acceptedAt: '2026-01-01T10:09:00Z' }] }],
    chainRefs: [{ messageId: 'm-first' }] };
  await WAIT.finalizeWaiting(project, rec, { goalRef: WAIT_GOAL, wait: { messageRef: { messageId: 'm-first' } },
    taskId: 't-wait', interjectRunId: null, letter: { expiredAt: '2026-01-01T10:02:00Z', acceptedInputs: [] },
    chainLetter: chain.chain[0], chain, memberLines: async () => [] });
  assert.ok(rec.facts.waitingEvidence.gaps.includes('tasks/query 没有回答'), rec.facts.waitingEvidence.gaps.join('；'));
  assert.match(rec.notes.at(-1), /tasks\/query 没有回答/);
  assert.equal(rec.results.get('consumes')?.status, 'pass', 'the real consumes check ran after the evidence gap');
  assert.match(rec.results.get('consumes')?.note ?? '', /只认一次真实接受消费等待/);
});

test('P6K waiting: a rejected executions/list is a gap in the note, never a throw or a judged check', async () => {
  const project = { scope: A, host: { client: { read: async (route) => {
    if (route === 'executions/list') return { status: 'rejected', code: 'unavailable', reason: 'transport: down' };
    if (route === 'tasks/query') return answered({ tasks: [
      { ref: { taskId: 't-wait' }, disposition: 'active', effectivePhase: 'ready' }] });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const rec = new Record({ id: 'waiting', rows: ['C-170'], checks: [{ id: 'expiry-once', rows: ['C-171'], text: '到期' }] });
  const evidence = await WAIT.waitingEvidence(project, rec, { goalRef: WAIT_GOAL, wait: { messageRef: { messageId: 'm-first' } },
    taskId: 't-wait', interjectRunId: null, letter: { expiredAt: null, acceptedInputs: [] } });
  assert.equal(rec.results.size, 0, 'a read gap never judges a check');
  assert.deepEqual(evidence.continuations, []);
  assert.ok(evidence.gaps.some(gap => /executions\/list/.test(gap) && /transport: down/.test(gap)), evidence.gaps.join('；'));
  assert.match(rec.notes.at(-1), /读缺口：.*executions\/list/);
});

// ---- E12: the close the scene takes, recorded once (quick check row 7)

const E12_NEW_GOAL = { aggregateType: 'Goal', projectId: 'p', goalId: 'g-new' };
const E12_CREATED = { plan: { aggregateType: 'Plan', projectId: 'p', goalId: 'g-new', planId: 'p-adopted' }, applied: { status: 'committed' } };
const E12_FLOW = `plan-adopted:${E12_NEW_GOAL.goalId}:${E12_CREATED.plan.planId}`;
const E12_CURRENT = { schemaVersion: 1, goalRef: E12_NEW_GOAL, flowId: E12_FLOW, sessionHint: null, kind: 'select_work' };
/** The auto-started Goal driver `workflow/driver-read` returns; `current` is the Host's first `WorkflowAdvanceInput`
 *  (`host.ts:2989-3002`), the plan-adopted Goal-level `select_work`. */
const E12_AUTO = { goalRef: E12_NEW_GOAL, flowId: E12_FLOW, taskId: null, siblings: [], state: 'running',
  current: E12_CURRENT, last: null, messages: [], reason: null };
const E12_TASKS = [{ ref: { taskId: 'w' }, definition: { taskKind: 'work', scope: { kind: 'goal' } },
  execution: { runId: 'r1' }, effectivePhase: 'ready' }];
const e12Run = (runId, startedAt = '2026-01-01T10:00:00Z') => ({ run: { ref: { aggregateType: 'Run', projectId: 'p', workspaceId: 'wa', runId }, startedAt } });
/** One QueryRunSnapshot as `sessions/queries` returns it; `goalId` is the request round's effective Goal
 *  (`run.executionState.prepared.requestEffectiveGoalId`, `query-job.ts:725`). */
const e12Query = (queryJobId, goalId, startedAt = '2999-01-01T10:00:00Z') => ({
  ref: { aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'wa', queryJobId, runId: `run-${queryJobId}` },
  run: { status: 'ended', startedAt, executionState: { prepared: { requestEffectiveGoalId: goalId }, requests: [] } },
});
/** One `lines/list` row; only the head ref and the name's Goal drive the replay's attribution (`work-line.ts:119`). */
const e12Line = (sessionId, goalRef = null) => ({ key: { projectId: 'p', workspaceId: 'wa', sessionId }, name: { goalRef } });
const E12_PIN = { ok: true, answer: null, ids: [] };

/** A Host answering only the reads `adoptAndClose` makes; `starts` records every driver-start input, `counts` the
 *  bootstrap reads. `bootstrap` replaces the success body (a rejection or `null` is a failed read). */
function e12Host({ auto = E12_AUTO, autoRead = null, starts, profiles = [], runs = () => [e12Run('r1')],
  lines = () => [], queries = () => [], bootstrap = undefined, counts = {}, start = () => answered(auto) } = {}) {
  return { scope: A, host: { client: {
    read: async (route, _scope, input) => {
      switch (route) {
        case 'tasks/query': return answered({ plan: { ref: { planId: 'p-current' } }, tasks: E12_TASKS });
        case 'executions/list': return answered({ items: runs(), nextCursor: null });
        case 'lines/list': return answered({ rows: lines() });
        case 'sessions/queries': return answered({ items: queries(input.sessionRef), nextCursor: null });
        case 'workflow/driver-read': return autoRead ?? (auto === null
          ? { status: 'rejected', code: 'unavailable', reason: 'no driver record' } : answered(auto));
        case 'workflow/driver-start': starts.push(input); return start(input);
        default: throw new Error(`the fake Host does not answer ${route}`);
      }
    },
    get: async () => {
      counts.bootstrap = (counts.bootstrap ?? 0) + 1;
      return bootstrap === undefined ? { execution: { queryProfiles: profiles.map(id => ({ id, scope: A })) } } : bootstrap;
    },
  } } };
}

async function replayOf(project, options = {}) {
  const { pin = E12_PIN, ...rest } = options;
  const rec = new Record({ id: 'E12', rows: ['C-220'], checks: [{ id: 'replay', rows: ['C-147'], text: '重放' }] });
  await E12.adoptAndClose(quietCtx(rec), project, rec, { newGoal: E12_NEW_GOAL, created: E12_CREATED, pin,
    wait: async () => { throw new WaitTimeout('stalled: no change for 32 min, nothing in flight'); }, ...rest });
  return { rec, replay: rec.results.get('replay') };
}

test('P6J4 E12: a timed-out wait goes through the scene\'s close, and result.json keeps the adopted plan\'s closing read', async () => {
  const newGoal = E12_NEW_GOAL;
  const created = E12_CREATED;
  const reads = [];
  const project = { scope: A, host: { client: {
    read: async (route, _scope, input) => {
      reads.push({ route, input });
      if (route === 'tasks/query') return answered({ plan: { ref: { planId: 'p-current' } }, tasks: E12_TASKS });
      if (route === 'executions/list') return answered({ items: [e12Run('r1')], nextCursor: null });
      if (route === 'lines/list') return answered({ rows: [] });
      if (route === 'workflow/driver-read') return answered(E12_AUTO);
      if (route === 'workflow/driver-start') return answered(E12_AUTO);
      throw new Error(`the fake Host does not answer ${route}`);
    },
    get: async () => ({ execution: { queryProfiles: [] } }),
  } } };
  const rec = new Record({ id: 'E12', rows: ['C-220'], checks: [{ id: 'replay', rows: ['C-220'], text: '重放' }] });
  const pin = await profilePin(project.host, project.scope);
  const out = await E12.adoptAndClose(quietCtx(rec), project, rec, { newGoal, created, pin,
    wait: async () => { throw new WaitTimeout('stalled: no change for 32 min, nothing in flight'); } });
  assert.equal(out.closed.done, null);
  assert.deepEqual(reads.filter(entry => entry.route === 'tasks/query').map(entry => entry.input.planRef), [created.plan, created.plan]);
  assert.equal(rec.results.get('replay').status, 'pass');
  const saved = savedScenario(rec, { id: 'E12', rows: ['C-220'] });
  assert.match(saved.facts.e12.final.stall, /stalled/);
  assert.deepEqual(saved.facts.e12.final.planRef, created.plan);
  assert.equal(saved.facts.e12.final.tasks[0].execution.runId, 'r1');
  assert.deepEqual(saved.facts.e12.atAdoption.planRef, created.plan);
});

// ---- P6K E12 replay: the original start seed, never a fresh flowId.

test('P6K E12: the replay sends the rebuilt plan-adopted start and starts nothing else', async () => {
  const starts = [];
  const project = e12Host({ starts });
  const { rec, replay } = await replayOf(project);
  assert.deepEqual(starts[0].advance, E12_CURRENT, 'the advance is the rebuilt Goal-level select_work, not a copy of current');
  assert.equal(starts.length, 1, 'one replay start, not two');
  assert.equal(replay.status, 'pass');
  assert.equal(replay.note.includes(E12_FLOW), true);
  assert.deepEqual(rec.facts.e12.replay.runs.before, ['r1']);
  assert.deepEqual(rec.facts.e12.replay.runs.after, ['r1']);
});

test('P6K E12: the replay uses the profile ids pinned before adoption, not the ones read later', async () => {
  const starts = [];
  const project = e12Host({ starts, profiles: ['later-profile'] });
  const { rec } = await replayOf(project, { pin: { ok: true, answer: null, ids: ['pinned-1', 'pinned-2'] } });
  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0].queryProfileIds, ['pinned-1', 'pinned-2']);
  assert.equal(rec.facts.e12.replay.status, 'ready');
});

test('P6K E12: a failed bootstrap read sends no replay and keeps the answer', async () => {
  const starts = [];
  const counts = {};
  const answer = { status: 'rejected', code: 'unavailable', reason: 'no bootstrap' };
  const project = e12Host({ starts, counts, bootstrap: answer });
  const pin = await profilePin(project.host, project.scope);
  assert.equal(pin.ok, false, 'a failed read is not an empty profile list');
  const { replay } = await replayOf(project, { pin });
  assert.equal(starts.length, 0, 'no pinned seed, no replay');
  assert.equal(replay.status, 'uncovered');
  assert.equal(replay.code, 'env-unavailable');
  assert.ok(replay.note.includes(JSON.stringify(answer)), `the original answer stays verbatim: ${replay.note}`);
  assert.equal(counts.bootstrap, 1, 'the bootstrap is read once, before adoption');
});

test('P6K E12: a null bootstrap read also sends no replay', async () => {
  const starts = [];
  const project = e12Host({ starts, bootstrap: null });
  const pin = await profilePin(project.host, project.scope);
  assert.equal(pin.ok, false);
  const { replay } = await replayOf(project, { pin });
  assert.equal(starts.length, 0);
  assert.equal(replay.status, 'uncovered');
  assert.match(replay.note, /null/, 'the empty answer stays in the note');
});

test('P6K E12: a genuinely empty profile list is sent as an empty list, not omitted', async () => {
  const starts = [];
  const counts = {};
  const project = e12Host({ starts, counts, profiles: [] });
  const pin = await profilePin(project.host, project.scope);
  assert.equal(pin.ok, true);
  assert.deepEqual(pin.ids, []);
  const { replay } = await replayOf(project, { pin });
  assert.equal(starts.length, 1);
  assert.ok('queryProfileIds' in starts[0], 'the seed keeps the field even when it is empty');
  assert.deepEqual(starts[0].queryProfileIds, []);
  assert.equal(counts.bootstrap, 1, 'the pinned ids are used as is, never read again at send time');
  assert.equal(replay.status, 'pass');
});

test('P6K E12: a driver-read on another flow is uncovered, naming what could not be verified', async () => {
  const starts = [];
  const project = e12Host({ starts, auto: { ...E12_AUTO, flowId: 'flow-auto', current: { ...E12_CURRENT, flowId: 'flow-auto' } } });
  const { replay } = await replayOf(project);
  assert.equal(starts.length, 0, 'no first-start seed, no replay');
  assert.equal(replay.status, 'uncovered');
  assert.match(replay.note, /flowId 是 flow-auto，不是首启的 plan-adopted:g-new:p-adopted/);
});

test('P6K E12: a driver-read whose current already moved to perform still sends the rebuilt start once', async () => {
  const starts = [];
  const project = e12Host({ starts, auto: { ...E12_AUTO, current: { ...E12_CURRENT, kind: 'perform', taskId: 'w' } } });
  const { rec, replay } = await replayOf(project);
  assert.equal(starts.length, 1, 'current moving on is evidence, not a gate: the rebuilt start is still sent once');
  assert.deepEqual(starts[0].advance, E12_CURRENT, 'the rebuilt Goal-level select_work, not the observed current');
  assert.equal(replay.status, 'pass');
  assert.equal(replay.note.includes(E12_FLOW), true);
  assert.equal(rec.facts.e12.replay.auto.current.kind, 'perform', 'the observed current stays in the evidence');
});

test('P6K E12: a driver-read with no current still sends the rebuilt start once and passes on the flowId window', async () => {
  const starts = [];
  const project = e12Host({ auto: { ...E12_AUTO, current: null }, starts });
  const { rec, replay } = await replayOf(project);
  assert.equal(starts.length, 1, 'a cleared current is not a missing first start');
  assert.deepEqual(starts[0].advance, E12_CURRENT);
  assert.equal(replay.status, 'pass');
  assert.equal(replay.note.includes(E12_FLOW), true);
  assert.equal(rec.facts.e12.replay.auto.current, null, 'the cleared current stays in the evidence');
  assert.match(replay.note, /2 秒观察窗里没有多出/, 'the verdict rests on the flowId and the observation window');
});

test('P6K E12: a busy replay is uncovered, never a pass', async () => {
  const starts = [];
  const project = e12Host({ starts,
    start: () => ({ status: 'rejected', code: 'busy', reason: 'another collaboration advancement is already active for this Goal' }) });
  const { replay } = await replayOf(project);
  assert.equal(starts.length, 1);
  assert.equal(replay.status, 'uncovered');
  assert.match(replay.note, /目标已自动运行，C-147 重放未覆盖/);
  assert.match(replay.note, /busy/);
});

test('P6K E12: a replay the driver refuses for another reason fails, not uncovered', async () => {
  const starts = [];
  const project = e12Host({ starts,
    start: () => ({ status: 'rejected', code: 'invalid', reason: 'driver start requires a complete WorkflowAdvanceInput' }) });
  const { replay } = await replayOf(project);
  assert.equal(starts.length, 1);
  assert.equal(replay.status, 'fail');
  assert.match(replay.note, /invalid/);
  assert.match(replay.note, /complete WorkflowAdvanceInput/);
});

test('P6K E12: a replay that shows a new Run in the window is uncovered as ambiguous, never a fail', async () => {
  const starts = [];
  let runs = [e12Run('r1')];
  const project = e12Host({ starts, runs: () => runs,
    start: () => { runs = [...runs, e12Run('r2', '2999-01-01T10:00:00Z')]; return answered(E12_AUTO); } });
  const { rec, replay } = await replayOf(project);
  assert.equal(starts.length, 1);
  assert.equal(replay.status, 'uncovered');
  assert.equal(replay.code, 'not-run');
  assert.match(replay.note, /无法归因/);
  assert.match(replay.note, /分不清是自然推进还是这次重放引起/);
  assert.deepEqual(rec.facts.e12.replay.runs.added, ['r2']);
});

test('P6K E12: an archived line replaced by a new one in the window is uncovered by ref identity', async () => {
  const starts = [];
  const lineA = e12Line('s-a', E12_NEW_GOAL);
  const lineB = e12Line('s-b', E12_NEW_GOAL);
  let rows = [lineA];
  let bySession = { 's-a': [e12Query('q-old', null, '2026-01-01T10:00:00Z')] };
  const project = e12Host({ starts, lines: () => rows, queries: sessionRef => bySession[sessionRef.sessionId] ?? [],
    start: () => {
      rows = [lineB];
      bySession = { 's-b': [e12Query('q-new', null)] };
      return answered(E12_AUTO);
    } });
  const { rec, replay } = await replayOf(project);
  assert.equal(starts.length, 1);
  assert.equal(rec.facts.e12.replay.queries.before, 1);
  assert.equal(rec.facts.e12.replay.queries.after, 1, 'the workspace-wide count is unchanged');
  assert.equal(replay.status, 'uncovered', 'q-old is gone and q-new is new; the count alone would pass');
  assert.equal(replay.code, 'not-run');
  assert.match(replay.note, /q-new|Query/);
});

test('P6K E12: a new Query provably on another Goal is not charged to this replay', async () => {
  const starts = [];
  const other = { aggregateType: 'Goal', projectId: 'p', goalId: 'g-other' };
  const lineOther = e12Line('s-other', null);
  let rows = [];
  let bySession = {};
  const project = e12Host({ starts, lines: () => rows, queries: sessionRef => bySession[sessionRef.sessionId] ?? [],
    start: () => {
      rows = [lineOther];
      bySession = { 's-other': [e12Query('q-other', 'g-other')] };
      return answered(E12_AUTO);
    } });
  const { replay } = await replayOf(project);
  assert.equal(replay.status, 'pass', 'the only new Query belongs to another Goal, so it is not evidence about this replay');
  assert.match(replay.note, /没有多出 Work Run 或 Query/);
});

test('P6K E12: a new Query whose Goal cannot be attributed is uncovered', async () => {
  const starts = [];
  const lineUnknown = e12Line('s-unknown', null);
  let rows = [];
  let bySession = {};
  const project = e12Host({ starts, lines: () => rows, queries: sessionRef => bySession[sessionRef.sessionId] ?? [],
    start: () => {
      rows = [lineUnknown];
      bySession = { 's-unknown': [e12Query('q-unknown', null)] };
      return answered(E12_AUTO);
    } });
  const { replay } = await replayOf(project);
  assert.equal(replay.status, 'uncovered');
  assert.equal(replay.code, 'not-run');
  assert.match(replay.note, /无法归因/);
});

test('P6K E12: a transport-unavailable replay is uncovered and keeps the original answer', async () => {
  const starts = [];
  const answer = { status: 'rejected', code: 'unavailable', reason: 'transport: fetch failed' };
  const project = e12Host({ starts, start: () => answer });
  const { replay } = await replayOf(project);
  assert.equal(starts.length, 1);
  assert.equal(replay.status, 'uncovered');
  assert.equal(replay.code, 'env-unavailable');
  assert.match(replay.note, /目标已自动运行，C-147 重放未覆盖/);
  assert.ok(replay.note.includes(JSON.stringify(answer)), `the original answer stays verbatim: ${replay.note}`);
});

test('P6K E12: an empty driver-start body is uncovered and keeps the answer', async () => {
  const starts = [];
  const project = e12Host({ starts, start: () => null });
  const { replay } = await replayOf(project);
  assert.equal(starts.length, 1);
  assert.equal(replay.status, 'uncovered', 'no formal refusal arrived');
  assert.equal(replay.code, 'env-unavailable');
  assert.match(replay.note, /driver-start 回 null/);
});

test('P6K E12: a ready answer with no snapshot is uncovered, not a failed replay', async () => {
  const starts = [];
  const project = e12Host({ starts, start: () => answered(null) });
  const { replay } = await replayOf(project);
  assert.equal(starts.length, 1);
  assert.equal(replay.status, 'uncovered');
  assert.equal(replay.code, 'env-unavailable');
  assert.ok(replay.note.includes(JSON.stringify(answered(null))), `the original answer stays verbatim: ${replay.note}`);
});

test('P6K E12: an unparsed driver-start answer is uncovered, not a failed replay', async () => {
  const starts = [];
  const answer = { status: 'unparsed', text: 'not json' };
  const project = e12Host({ starts, start: () => answer });
  const { replay } = await replayOf(project);
  assert.equal(starts.length, 1);
  assert.equal(replay.status, 'uncovered');
  assert.equal(replay.code, 'env-unavailable');
  assert.ok(replay.note.includes(JSON.stringify(answer)), `the original answer stays verbatim: ${replay.note}`);
});

test('P6K E12: a failed driver-read never claims the Goal runs itself', async () => {
  const starts = [];
  const project = e12Host({ starts, autoRead: { status: 'not_found' } });
  const { replay } = await replayOf(project);
  assert.equal(starts.length, 0);
  assert.equal(replay.status, 'uncovered');
  assert.match(replay.note, /C-147 重放未覆盖；workflow\/driver-read not_found/);
  assert.doesNotMatch(replay.note, /已自动运行/);
});

// ------------------------------------------------------------------------------------------------
// P6K: the iteration change round is judged on the candidate chain and the saved plan `summary`
// (`p6r5-diagnosis.md` "iteration 的 C-213"), never on a word search across the whole answer.

const iterProposalRef = (proposalId, workspaceId = 'w') => ({ aggregateType: 'PlanProposal', projectId: 'p',
  workspaceId, proposalId });
const iterRound = (answer, queryJobId = 'q-iter') => ({ ref: { aggregateType: 'QueryJob', projectId: 'p',
  workspaceId: 'w', queryJobId }, answer: typeof answer === 'string' ? answer : JSON.stringify(answer) });
const iterCandidate = (proposalId, { previous = null, revision = 2, workspaceId = 'w' } = {}) => ({
  head: { ref: iterProposalRef(proposalId, workspaceId), revision }, status: 'candidate', previous });
const iterPlanAnswer = summary => ({ schemaVersion: 2, kind: 'plan', summary });
const iterPrevious = (proposalId, workspaceId = 'w') => ({ proposalRef: iterProposalRef(proposalId, workspaceId), revision: 1 });
const judgeChanged = (summary, { secondId = 'second', previous } = {}) => judgeWhatChanged(iterCandidate('first'),
  iterCandidate(secondId, { previous: previous === undefined ? iterPrevious('first') : previous }),
  iterRound(iterPlanAnswer(summary)));

test('P6K iteration: no second candidate fails, naming what is missing', () => {
  const verdict = judgeWhatChanged(iterCandidate('first'), { head: null, status: 'closed', previous: null },
    iterRound(iterPlanAnswer('改了口令。')));
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.note, /第二个候选/);
});

test('P6K iteration: a second candidate whose ID never changed fails', () => {
  const verdict = judgeWhatChanged(iterCandidate('same'), iterCandidate('same', { previous: iterPrevious('same') }),
    iterRound(iterPlanAnswer('改了参数解析。')));
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.note, /没变/);
});

test('P6K iteration: a missing previous fails on "previous", not on the summary', () => {
  const verdict = judgeWhatChanged(iterCandidate('first'), iterCandidate('second'),
    iterRound(iterPlanAnswer('参数解析现直接读取 process.argv。')));
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.note, /previous/);
});

test('P6K iteration: a previous that names another proposal fails', () => {
  const verdict = judgeChanged('参数解析现直接读取 process.argv。', { previous: iterPrevious('other') });
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.note, /previous/);
});

test('P6K iteration: a previous with the right proposalId in another workspace still fails', () => {
  const verdict = judgeChanged('参数解析现直接读取 process.argv。', { previous: iterPrevious('first', 'elsewhere') });
  assert.equal(verdict.status, 'fail', 'the whole ref is compared, not just its proposalId');
  assert.match(verdict.note, /previous/);
});

test('P6K iteration: a summary naming the change passes without the old four words', () => {
  const summary = '参数解析现直接读取 process.argv，不再引入解析库。';
  assert.doesNotMatch(summary, /改了|改动|变更|changed/);
  const verdict = judgeChanged(summary);
  assert.equal(verdict.status, 'pass');
  assert.match(verdict.note, /process\.argv/);
});

test('P6K iteration: a summary that only names argv passes too', () => {
  assert.equal(judgeChanged('现在直接读 process.argv。').status, 'pass');
});

// P6K3 (review row 8): both English tables are whole-word. `unchangedFlag` is not the negation `unchanged`, and
// `argvBackup` is not the topic word `argv`; the old substring match turned this pass into an uncover and this
// uncover into a pass.
test('P6K iteration: unchangedFlag is not a negation and process.argv is a whole-word topic, so the summary passes', () => {
  const verdict = judgeChanged('Removed unchangedFlag and switched to process.argv.');
  assert.equal(verdict.status, 'pass');
  assert.match(verdict.note, /process\.argv/);
});

test('P6K iteration: argvBackup is not argv, so the summary stays uncovered with the original in notes', () => {
  const summary = 'argvBackup.';
  const verdict = judgeChanged(summary);
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'not-run');
  assert.match(verdict.note, /摘要没说明改动/);
  assert.ok(verdict.notes.join('\n').includes(JSON.stringify(summary)), `${summary} stays in notes`);
});

test('P6K iteration: a change verb alone is enough to pass', () => {
  assert.equal(judgeChanged('这一版改了入口。').status, 'pass');
  assert.equal(judgeChanged('changed the entry point; everything else stays.').status, 'pass');
  // The ruled negation list is blunt: `不变` anywhere wins, even beside a named change.
  const mixed = judgeChanged('这一版改了入口，其余不变。');
  assert.equal(mixed.status, 'uncovered');
  assert.match(mixed.note, /否定或原样/);
});

test('P6K iteration: a negation or unchanged summary never passes, and the original stays in notes', () => {
  for (const summary of ['这一版未改，已提交。', '没改', '不变', '原样', 'unchanged', 'no change']) {
    const verdict = judgeChanged(summary);
    assert.equal(verdict.status, 'uncovered', `${summary} is a negation or an unchanged statement`);
    assert.equal(verdict.code, 'not-run');
    assert.match(verdict.note, /否定或原样/);
    assert.ok(verdict.notes.join('\n').includes(JSON.stringify(summary)), `${summary} stays in notes`);
  }
});

test('P6K iteration: the English change verb is a whole word, so "exchanged" does not pass', () => {
  const verdict = judgeChanged('The values were exchanged between the two files.');
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'not-run');
  assert.match(verdict.notes.join('\n'), /exchanged/);
});

test('P6K iteration: a summary with none of the listed words stays uncovered; no synonym is guessed', () => {
  const summary = '入口现在只取 Node 提供的原始参数数组，第三方包已移除。';
  assert.doesNotMatch(summary, /改|变更|argv|解析|依赖|库|changed?/i);
  const verdict = judgeChanged(summary);
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'not-run');
  assert.match(verdict.note, /摘要没说明改动/);
  assert.ok(verdict.notes.join('\n').includes(JSON.stringify(summary)));
});

test('P6K iteration: a summary that does not say what changed is uncovered, with the original in notes', () => {
  const verdict = judgeChanged('已提交。');
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'not-run');
  assert.match(verdict.note, /摘要没说明改动，原文见 notes，需人读/);
  assert.equal(verdict.notes.length, 1, 'one line for this change round');
  const notes = verdict.notes.join('\n');
  assert.match(notes, /已提交。/);
  assert.match(notes, /q-iter/);
  assert.match(notes, /"proposalId":"first"/);
  assert.match(notes, /"proposalId":"second"/);
});

test('P6K iteration: a change word in the plan body never makes a silent summary pass', () => {
  const round = iterRound({ schemaVersion: 2, kind: 'plan', summary: '已提交。',
    plan: { tasks: [{ text: '变更 count.js 的入口' }] } });
  const verdict = judgeWhatChanged(iterCandidate('first'), iterCandidate('second', { previous: iterPrevious('first') }), round);
  assert.equal(verdict.status, 'uncovered', 'the saved summary is read, not the whole answer');
  assert.match(verdict.note, /摘要没说明改动/);
});

test('P6K iteration: an answer that is not JSON is an entry gap, not a failure', () => {
  const verdict = judgeWhatChanged(iterCandidate('first'), iterCandidate('second', { previous: iterPrevious('first') }),
    iterRound('已提交。'));
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'entry-missing');
  assert.match(verdict.note, /证据缺口/);
  assert.match(verdict.note, /取不到 summary 原文/);
});

test('P6K iteration: a saved answer without a summary string is an entry gap', () => {
  const missing = judgeWhatChanged(iterCandidate('first'), iterCandidate('second', { previous: iterPrevious('first') }),
    iterRound({ schemaVersion: 2, kind: 'plan' }));
  assert.equal(missing.status, 'uncovered');
  assert.equal(missing.code, 'entry-missing');
  assert.match(missing.note, /证据缺口/);
  const notAString = judgeWhatChanged(iterCandidate('first'), iterCandidate('second', { previous: iterPrevious('first') }),
    iterRound({ schemaVersion: 2, kind: 'plan', summary: 3 }));
  assert.equal(notAString.code, 'entry-missing');
});

test('P6K iteration: a failed second read is an environment gap, never "no candidate"', () => {
  const verdict = judgeWhatChanged(iterCandidate('first'), null, iterRound(iterPlanAnswer('参数解析现直接读取 process.argv。')));
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'env-unavailable');
  assert.notEqual(verdict.status, 'fail');
});

test('P6K iteration: a missing first candidate is an evidence gap, not a failure', () => {
  const verdict = judgeWhatChanged({ head: null, status: 'closed', previous: null },
    iterCandidate('second', { previous: iterPrevious('first') }), iterRound(iterPlanAnswer('参数解析现直接读取 process.argv。')));
  assert.equal(verdict.status, 'uncovered');
  assert.equal(verdict.code, 'entry-missing');
  assert.match(verdict.note, /证据缺口/);
});

// P6K3 (review row "iteration · 无候选后继续解引用"): `plans/request-candidate` answers `ready({head:null,…})`; the
// steps after `what-changed`/`continues` used to read `second.head.ref` and throw. The real tail entry must write the
// four dependent checks uncovered and return without asking or reading anything else.
test('P6K iteration: a candidate read with no head skips the dependent steps instead of throwing', async () => {
  const project = { scope: A, host: { client: {
    command: async () => { throw new Error('no requests/ask may be sent without a candidate'); },
    read: async () => { throw new Error('no read may be made without a candidate'); },
  } } };
  const rec = new Record({ id: 'iteration', rows: [],
    checks: ['what-changed', 'continues', 'why', 'cards-ask', 'multi-round', 'per-request']
      .map(id => ({ id, rows: [], text: id })) });
  // The route's whole `{status:'ready', value:{head:null,…}}` answer; `candidateOf` hands the tail its `value`.
  const answer = { status: 'ready', value: { head: null, status: 'closed', previous: null } };
  const second = answer.value;
  const changed = judgeWhatChanged(iterCandidate('first'), second, iterRound(iterPlanAnswer('改了。')));
  rec.fail('what-changed', changed.note);
  rec.pass('continues', '同一请求 3 轮，秘书 Session s1');
  await afterChangeRound({}, project, rec, { goalRef: { goalId: 'g' }, root: { requestId: 'q' },
    iterRound: iterRound(iterPlanAnswer('改了。')), second });
  const checks = new Map(rec.checks().map(check => [check.id, check]));
  for (const id of ['why', 'cards-ask', 'multi-round', 'per-request']) {
    assert.equal(checks.get(id).status, 'uncovered', `${id} is uncovered`);
    assert.equal(checks.get(id).code, 'not-run');
    assert.match(checks.get(id).note, /second\.head 为空/);
  }
  assert.equal(checks.get('what-changed').status, 'fail', 'the verdict written before the tail stays');
  assert.equal(checks.get('continues').status, 'pass', 'the verdict written before the tail stays');
});

// ---- P6L2 (run sheet A1/B4/C/D): the broken tails, the R2 iteration route, and the fallback reverify.
test('P6L2 iteration: the change tail receives the run goal for the second request', async () => {
  const root = { aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'wa', queryJobId: 'root' };
  const whyRound = { ref: { ...root, queryJobId: 'why' }, status: 'ended', answer: 'why answered', session: null, ideas: [], goalCardDrafts: [] };
  const view = { rounds: [whyRound] };
  const candidates = [
    { head: { ref: { proposalId: 'first' }, revision: 1 }, status: 'candidate' },
    { head: { ref: { proposalId: 'second' }, revision: 1 }, status: 'candidate' },
    { status: 'stale' },
  ];
  let candidateAt = 0;
  const commands = [];
  const project = { scope: A, host: { client: {
    read: async route => {
      switch (route) {
        case 'requests/read': return answered(view);
        case 'plans/request-candidate': return answered(candidates[Math.min(candidateAt++, candidates.length - 1)]);
        case 'goals/read': return answered({ goal: { revision: 1 } });
        default: return { status: 'not_found' };
      }
    },
    command: async (route, _scope, input) => { commands.push({ route, input }); return { status: 'queued' }; },
    write: async (route, _scope, input) => { commands.push({ route, input }); return { status: 'committed', value: {} }; },
  } } };
  const rec = new Record({ id: 'iteration', rows: [], checks: ['why', 'cards-ask', 'multi-round', 'per-request'].map(id => ({ id, rows: [], text: id })) });
  rec.facts.userCommand = [];
  const second = { head: { ref: { proposalId: 'first' }, revision: 1 } };
  await afterChangeRound({ budget: { tick: async () => {}, inFlight: () => ({ queries: 0, items: [] }) }, report: { current: rec } },
    project, rec, { goalRef: { goalId: 'g-seed' }, root, iterRound: whyRound, second });
  assert.ok(commands.some(entry => entry.route === 'requests/ask'), 'the why ask went out');
  assert.ok(commands.some(entry => entry.route === 'requests/submit' && entry.input.goalId === 'g-seed'),
    'the second request used the run goal');
  assert.equal(rec.results.get('why').status, 'pass');
});

test('P6L2 iteration R2: the request has no goal of its own and only the ended seed Goal as its source', () => {
  assert.equal(requestHasNoGoalOf({ goalId: null, effectiveGoalId: null, source: { goalRef: { goalId: 'g-seed' } } }, 'g-seed'), true);
  assert.equal(requestHasNoGoalOf({ goalId: 'g-seed', effectiveGoalId: 'g-seed', source: null }, 'g-seed'), false,
    'a request still attached to the seed goal is not the R2 route');
  assert.equal(requestHasNoGoalOf({ goalId: null, effectiveGoalId: null, source: { goalRef: { goalId: 'g-other' } } }, 'g-seed'), false,
    'the source must be this seed goal');
  assert.equal(requestHasNoGoalOf({ goalId: null, effectiveGoalId: 'g-seed', source: { goalRef: { goalId: 'g-seed' } } }, 'g-seed'), false,
    'a request with an effective goal is still attached');
});

test('P6L2 iteration R2: selecting an idea confirms the Goal card through the one confirmCard, never a second copy', async () => {
  const commands = [];
  const newGoalRef = { aggregateType: 'Goal', projectId: 'p', workspaceId: 'wa', goalId: 'g-new' };
  const round = { ref: { aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'wa', queryJobId: 'q2' },
    goalCardDrafts: [{ index: 2, draft: { goalId: 'g-new' } }] };
  const rec = new Record({ id: 'iteration', rows: [], checks: [] });
  const ctx = { budget: { tick: async () => {} }, report: { current: rec } };
  const project = { scope: A, host: { client: {
    read: async route => (route === 'goals/list' ? answered({ goals: [] }) : { status: 'not_found' }),
    command: async (route, _scope, input) => { commands.push({ route, input });
      return { status: 'committed', value: { binding: { goalRef: newGoalRef, goalRevision: 1, answerRef: 'a' } } }; },
  } } };
  const confirmed = await confirmCard(ctx, project, round, rec);
  assert.deepEqual(confirmed.binding.goalRef, newGoalRef);
  assert.deepEqual(commands.map(entry => entry.route), ['goals/confirm-draft']);
  assert.deepEqual(commands[0].input.round, round.ref);
  assert.equal(commands[0].input.index, 2);
  const noCard = await confirmCard(ctx, { ...project, host: { client: { ...project.host.client,
    read: async () => answered({ goals: [] }) } } }, { ref: round.ref, goalCardDrafts: [] }, rec)
    .then(() => null, error => error);
  assert.equal(noCard?.code, 'not-run', 'a round without a Goal card is a named stop, never replaced by the seed goal');
});

test('P6L2 waiting: a window reading is named as the observation moment, never as the expiry moment', () => {
  const window = { letter: { observedAt: '2026-01-01T10:02:10Z', expiredAt: '2026-01-01T10:02:00Z' },
    run: { runId: 'r1', status: 'ended', endedAt: '2026-01-01T10:01:00Z' },
    task: { eligibility: { eligible: false, reasons: [{ code: 'not_ready' }] }, effectivePhase: 'pending', disposition: 'active' },
    line: { sessionId: 's1', availability: 'idle', occupancy: null }, gaps: [] };
  const verdict = claimableVerdict(window);
  assert.match(verdict, /观察时（2026-01-01T10:02:10Z）/);
  assert.doesNotMatch(verdict, /到期时刻/, 'an observation at 10:02:10 is not the state at the 10:02:00 expiry');
});

test('P6L2 waiting: the close-out returns the member waits and keeps the last known acceptance when the chain read failed', async () => {
  const letterRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm-wait' };
  const letter = { status: 'expired', expiredAt: '2026-01-01T10:02:00Z', deadline: '2026-01-01T10:02:00Z',
    acceptedInputs: [{ part: 'expiry', consumesWait: true, acceptedAt: '2026-01-01T10:02:01Z' }] };
  const records = [
    event('assistant.message_completed', { message: { messageId: 'a1', content: [{ kind: 'text', text: '' }] },
      toolCalls: [{ callId: 'c1', name: 'send_session_message', arguments: { waitAfterSend: true } }] }, 'k', 't'),
    event('tool.completed', { callId: 'c1', result: { status: 'success', output: [{ kind: 'json', value: { message: { ref: letterRef } } }] } }, 'k', 't'),
  ];
  const project = { scope: A, host: { client: { read: async route => {
    switch (route) {
      case 'sessions/history': return answered({ items: records.map(record => ({ body: { text: JSON.stringify(record) } })), nextCursor: null });
      case 'messages/read': return answered(letter);
      case 'executions/list': return page([]);
      case 'tasks/query': return answered({ tasks: [] });
      default: return { status: 'not_found' };
    }
  } } } };
  const rec = new Record({ id: 'waiting', rows: [], checks: [{ id: 'consumes', rows: [], text: 'consumes' }] });
  const out = await finalizeWaiting(project, rec, { goalRef: { goalId: 'g' }, wait: { messageRef: letterRef, deadline: letter.deadline },
    taskId: 't-wait', chain: { chain: [null], chainRefs: [letterRef] }, memberLines: async () => [{ projectId: 'p', sessionId: 's1' }],
    chainLetter: null, lastLetter: letter, letter });
  assert.equal(out.memberWaits.length, 1, 'the member waits are returned to the caller');
  assert.deepEqual(out.memberWaits[0].ref, letterRef);
  assert.equal(out.evidence.acceptedInputs.length, 1, 'the last known acceptance is not dropped');
  assert.ok(out.evidence.gaps.some(gap => /沿用此前最后一次已知的读数/.test(gap)), out.evidence.gaps.join('；'));
});

// ---- P6L2 A3/A4: E06's restart cell follows the interrupted Session, and a paged list that failed cannot be judged.
const e06RestartRun = (runId, taskId, sessionId, startedAt) => ({ run: { ref: { runId }, task: { taskId, goalId: 'g' },
  status: 'running', startedAt, outcome: null }, outbox: { claim: { sessionRef: { projectId: 'p', sessionId } } } });

test('P6L2 E06: restart-running reads the interrupted Session continuation, not another Task live Work', () => {
  const interrupted = { run: { ref: { runId: 'r-old' }, task: { taskId: 't-a', goalId: 'g' } } };
  const runs = [e06RestartRun('r-b', 't-b', 's2', '2026-01-01T10:05:01Z'), e06RestartRun('r-a', 't-a', 's1', '2026-01-01T10:05:02Z')];
  const continued = E06.continuedRunOnSession(runs, interrupted, '2026-01-01T10:05:00Z', 's1');
  assert.equal(continued?.run.ref.runId, 'r-a', 'the original Session s1 continues, although r-b is listed first');
  assert.equal(E06.continuedRunOnSession(runs, interrupted, '2026-01-01T10:05:00Z', 's3'), null);
  assert.equal(E06.continuedRunOnSession([runs[1]], interrupted, '2026-01-01T10:05:03Z', 's1'), null,
    'a Run that started before the restart boundary is not the continuation');
});

test('P6L2 E06: a paged executions list with a failed page leaves same-task-new-run uncovered before any brief read', async () => {
  let briefReads = 0;
  const project = { scope: A, host: { client: { read: async route => {
    if (route === 'executions/brief') { briefReads += 1; return answered({ brief: {} }); }
    throw new Error(`no read expected, got ${route}`);
  } } } };
  const rec = new Record({ id: 'E06', rows: ['C-135'], checks: [{ id: 'same-task-new-run', rows: ['C-135'], text: '接续' }] });
  const first = { run: { ref: { runId: 'r-old' }, task: { taskId: 't-a', goalId: 'g' } }, outbox: { claim: { sessionRef: { sessionId: 's1' } } } };
  const resumed = { run: { ref: { runId: 'r-new' }, task: { taskId: 't-a', goalId: 'g' } }, outbox: { claim: { sessionRef: { sessionId: 's1' } } } };
  await E06.judgeSameTaskNewRun(project, rec, { first, resumed, boundary: '2026-01-01T10:05:00Z',
    readGaps: ['executions/list: unavailable'] });
  assert.equal(rec.results.get('same-task-new-run').status, 'uncovered');
  assert.equal(rec.results.get('same-task-new-run').code, 'env-unavailable');
  assert.match(rec.results.get('same-task-new-run').note, /读不全/);
  assert.equal(briefReads, 0, 'no brief is read from an incomplete list');
});

// ---- P6L2 A5: E12's window is attributed by the Query's own record and ordered against the send boundary.
test('P6L2 E12: a plain Query on a line named another Goal is not excluded by that display name', async () => {
  const starts = [];
  const lineOther = e12Line('s-other', { aggregateType: 'Goal', projectId: 'p', goalId: 'g-other' });
  let rows = [];
  let bySession = {};
  const project = e12Host({ starts, lines: () => rows, queries: sessionRef => bySession[sessionRef.sessionId] ?? [],
    start: () => {
      rows = [lineOther];
      bySession = { 's-other': [e12Query('q-plain', null)] };
      return answered(E12_AUTO);
    } });
  const { replay } = await replayOf(project);
  assert.equal(replay.status, 'uncovered', 'the line name is display data, not the Query own attribution');
  assert.equal(replay.code, 'not-run');
  assert.match(replay.note, /无法归因|q-plain/);
});

test('P6L2 E12: a Run that started before the replay send is not charged to the observation window', async () => {
  const starts = [];
  let calls = 0;
  const project = e12Host({ starts, runs: () => {
    calls += 1;
    return calls === 1 ? [e12Run('r1')] : [e12Run('r1'), e12Run('r-natural', '2026-01-01T10:00:00Z')];
  } });
  const { rec, replay } = await replayOf(project);
  assert.equal(replay.status, 'pass', 'r-natural started before the send, so the window is empty');
  assert.deepEqual(rec.facts.e12.replay.runs.added, []);
});

test('P6L2 intervention: a same-line new Run that does not name the letter does not lock the first-seen point', () => {
  const letter = { messageRef: { messageId: 'm1' }, line: 's1', taskId: 't1', before: new Set(['r0']), at: '2026-01-01T10:00:00Z' };
  const point = { deliveredTo: null, acceptedInputs: [], planning: null };
  const unrelated = [{ run: { ref: { runId: 'r1' }, task: { taskId: 't1' }, startedAt: '2026-01-01T10:00:01Z',
    consumedWait: null } , outbox: { claim: { sessionRef: { sessionId: 's1' } } } }];
  assert.equal(INTMOD.associatedWith(letter, point, unrelated), false, 'a Run on the same line and Task is not this letter');
  const claiming = [{ run: { ref: { runId: 'r1' }, task: { taskId: 't1' }, startedAt: '2026-01-01T10:00:01Z',
    consumedWait: { kind: 'intervention', messageRef: { messageId: 'm1' } } }, outbox: { claim: { sessionRef: { sessionId: 's1' } } } }];
  assert.equal(INTMOD.associatedWith(letter, point, claiming), true, 'the same messageRef claim does lock it');
});

test('P6L2 intervention: the pause premise needs an unfinished Task and a running Run of that same Task', () => {
  const task = { projectId: 'p', goalId: 'g', taskId: 't1' };
  const work = { readable: true, task, unfinished: false, text: 'g/t1 active/satisfied' };
  const finished = INTMOD.pausePremiseOf({ work, busy: { busy: true, why: 'busy' },
    run: { run: { task } } });
  assert.equal(finished.ok, false);
  assert.equal(finished.code, 'not-run');
  assert.match(finished.missing, /已经完成/);
  const other = INTMOD.pausePremiseOf({ work: { ...work, unfinished: true }, busy: { busy: true, why: 'busy' },
    run: { run: { task: { projectId: 'p', goalId: 'g', taskId: 't2' } } } });
  assert.equal(other.ok, false);
  assert.match(other.missing, /另一个 Task/);
  const noResume = INTMOD.pausedVerdict({ premise: { ok: true }, whilePaused: 'offerable', afterResume: null,
    view: null, planning: null, planningGaps: [], resumeCommitted: false });
  assert.equal(noResume.status, 'uncovered');
  assert.equal(noResume.code, 'not-run');
  assert.match(noResume.note, /恢复没有提交/);
});

test('P6L3 B11: the pause premise compares the whole Task triple, so a same taskId under another Goal is not the Task', () => {
  const work = { readable: true, task: { projectId: 'p', goalId: 'g1', taskId: 't1' }, unfinished: true, text: 'g1/t1' };
  const busy = { busy: true, why: 'busy' };
  const otherGoal = INTMOD.pausePremiseOf({ work, busy,
    run: { run: { task: { projectId: 'p', goalId: 'g2', taskId: 't1' } } } });
  assert.equal(otherGoal.ok, false);
  assert.match(otherGoal.missing, /另一个 Task/);
  const noTaskId = INTMOD.pausePremiseOf({ work, busy, run: { run: { task: { projectId: 'p', goalId: 'g1' } } } });
  assert.equal(noTaskId.ok, false, 'a missing taskId cannot pass as the same Task');
  assert.match(noTaskId.missing, /另一个 Task/);
});

test('P6LO B12: a letter already in Work while paused fails paused-queues before a resume whose goal read breaks', async () => {
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', taskId: 't1', runId: 'r1' };
  const project = { scope: A, host: { client: {
    read: async route => {
      if (route === 'messages/view') return answered({ disposition: { kind: 'delivered' },
        delivery: { deliveredTo: { executionRef: runRef, acceptedAt: '2026-01-01T10:01:00Z' } } });
      if (route === 'goals/read') return { status: 'rejected', code: 'unavailable', reason: 'goal store down' };
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async route => { throw new Error(`nothing may be written: ${route}`); },
  } } };
  const rec = new Record({ id: 'intervention', rows: ['C-199', 'C-197'], checks: [
    { id: 'continue-no-planning', rows: ['C-199'], text: '不开规划' }, { id: 'paused-queues', rows: ['C-197'], text: '暂停只排队' }] });
  const ctx = { budget: { tick: async () => {} }, report: { current: rec } };
  const stop = await INTMOD.resumeAndJudge(ctx, project, rec, { goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' },
    letterRef: { messageId: 'm-paused' }, premise: { ok: true }, paused: { status: 'committed' }, phaseAtPause: 'RUNNING',
    timeline: { runRef: null, gaps: [], points: [] } }).then(() => null, error => error);
  assert.ok(stop !== null, 'the broken resume still stops the unit');
  assert.equal(rec.results.get('paused-queues')?.status, 'fail', `the proven violation is recorded: ${JSON.stringify([...rec.results])}`);
  assert.match(rec.results.get('paused-queues').note, /暂停中.*送进 Work/);
  assert.equal(rec.results.has('continue-no-planning'), false, 'the resume failure never judges another cell');
});

test('P6L3 B12: a pause violation is judged before the resume receipt is consulted', () => {
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', taskId: 't1', runId: 'r1' };
  const verdict = INTMOD.pausedVerdict({ premise: { ok: true }, whilePaused: 'delivered', whilePausedInto: runRef,
    afterResume: 'delivered', view: null, planning: null, planningGaps: [], resumeCommitted: false });
  assert.equal(verdict.status, 'fail', 'the pause violation does not wait for the resume receipt');
  assert.match(verdict.note, /暂停中.*送进 Work/);
});

test('P6L3 B10: each post-resume tick reads the same letter and its planning Query, and a visible planning branch ends the wait', async () => {
  const messageRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm1' };
  const planning = 'intervention-planning-resume';
  let ticks = 0;
  const project = { scope: A, host: { client: { read: async (route, _scope, input) => {
    if (route === 'messages/view') return answered({ disposition: { kind: 'offerable' }, delivery: { deliveredTo: null } });
    if (route === 'lines/list') return answered({ rows: [{ key: { projectId: 'p', sessionId: 's1' } }] });
    if (route === 'sessions/queries') return answered({ items: [{ ref: { ...q(planning), runId: 'run-resume' },
      run: { status: 'answered' } }], nextCursor: null });
    if (route === 'queries/read') return answered({ job: { job: { queryJobId: planning,
      intent: { execution: { sourceMessageRef: messageRef } } } }, run: { ref: { ...q(planning), runId: 'run-resume' }, run: { status: 'answered' } } });
    if (route === 'goals/display') return answered({ display: { phase: 'ACTIVE' } });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const ctx = { budget: { tick: async () => { ticks += 1; } } };
  const seen = await INTMOD.observeAfterResume(ctx, project, messageRef, { timeoutMs: 60_000, pollMs: 1 });
  assert.equal(seen.planning?.job?.job?.job?.queryJobId, planning, 'the planning branch is read on the tick, not after the wait');
  assert.equal(seen.view?.disposition?.kind, 'offerable');
  assert.equal(seen.stop, null);
});

test('P6L3 B10: a budget stop returns the readings kept so far, so the cell is judged before the run stops', async () => {
  const messageRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm1' };
  const project = { scope: A, host: { client: { read: async route => {
    if (route === 'messages/view') return answered({ disposition: { kind: 'offerable' }, delivery: { deliveredTo: null } });
    if (route === 'lines/list') return answered({ rows: [] });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const ctx = { budget: { tick: async () => { throw new BudgetStop('scenario', 'the scenario cap was reached'); } } };
  const seen = await INTMOD.observeAfterResume(ctx, project, messageRef, { timeoutMs: 60_000 });
  assert.ok(seen.stop instanceof BudgetStop);
  assert.equal(seen.view?.disposition?.kind, 'offerable', 'the last complete read is kept for the verdict');
  assert.equal(seen.planning, null);
});

/** The pause cell's verdict from what `observeAfterResume` kept, the way `resumeAndJudge` passes it. */
const verdictAfterResume = seen => INTMOD.pausedVerdict({ premise: { ok: true }, whilePaused: 'offerable',
  afterResume: seen.view?.disposition?.kind ?? null, view: seen.view, planning: seen.planning, planningGaps: seen.planningGaps,
  resumeCommitted: true, ended: seen.ended, viewGap: seen.viewGap });

test('P6LO B10: a budget stop right after a failed letter read keeps the earlier letter and is uncovered, not a timeout', async () => {
  const messageRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm1' };
  let views = 0;
  const project = { scope: A, host: { client: { read: async route => {
    if (route === 'messages/view') {
      views += 1;
      return views === 1 ? answered({ disposition: { kind: 'offerable' }, delivery: { deliveredTo: null } })
        : { status: 'rejected', code: 'unavailable', reason: 'mail store down' };
    }
    if (route === 'lines/list') return answered({ rows: [] });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  let ticks = 0;
  const ctx = { budget: { tick: async () => { ticks += 1; if (ticks >= 2) throw new BudgetStop('scenario', 'the scenario cap was reached'); } } };
  const seen = await INTMOD.observeAfterResume(ctx, project, messageRef, { timeoutMs: 60_000, pollMs: 1 });
  assert.equal(seen.view?.disposition?.kind, 'offerable', 'the letter read before the failed read is kept');
  const verdict = verdictAfterResume(seen);
  assert.equal(verdict.status, 'uncovered', verdict.note);
  assert.doesNotMatch(verdict.note, /超时/);
  // A budget stop with every read complete and the letter still queued is not the 30-minute timeout either.
  views = 0;
  const stopped = await INTMOD.observeAfterResume({ budget: { tick: async () => { throw new BudgetStop('scenario', 'cap'); } } },
    project, messageRef, { timeoutMs: 60_000, pollMs: 1 });
  assert.equal(verdictAfterResume(stopped).status, 'uncovered', verdictAfterResume(stopped).note);
});

test('P6LO B10: a letter still queued when the 30 minutes really ran out fails', async () => {
  const messageRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm1' };
  const project = { scope: A, host: { client: { read: async route => {
    if (route === 'messages/view') return answered({ disposition: { kind: 'offerable' }, delivery: { deliveredTo: null } });
    if (route === 'lines/list') return answered({ rows: [] });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const seen = await INTMOD.observeAfterResume({ budget: { tick: async () => {} } }, project, messageRef, { timeoutMs: 0 });
  const verdict = verdictAfterResume(seen);
  assert.equal(verdict.status, 'fail', verdict.note);
  assert.match(verdict.note, /30 分钟/);
});

test('P6L2 E05: an empty changedPaths writes "path evidence in the output", never "no path"', async () => {
  const head = roundHead('s2', 'r2', [{ checkId: 'c-empty', outcome: 'FAIL', phase: 'finished', reportRef: reportRef('art-empty') }]);
  head.chain.rounds = [{ roundRef: head.roundRef }];
  const project = e05Project({
    'tasks/query': () => answered({ tasks: [{ ref: { taskId: 't2' }, definition: { taskKind: 'work' } }] }),
    'executions/list': () => page([e05Run('t2', 's2', '2026-01-01T10:00:00Z', '2026-01-01T10:10:00Z')]),
    'verification/round': verificationPage({ s2: head }),
    'materials/open': () => answered({ ref: reportRef('art-empty'), body: JSON.stringify({ observation: {
      kind: 'executed', exitCode: 1, signal: null, timedOut: false, cancelled: false,
      stdout: { text: ' M README.md\n', totalBytes: 12, truncated: true },
      stderr: { text: '', totalBytes: 0, truncated: false },
      effects: { workspaceRevision: 'w2', changedPaths: [] } } }) }),
  });
  const facts = await E05.seedEvidence(project, { goalId: 'g-seed' });
  const rec = new Record({ id: 'E05', rows: [], checks: [] });
  E05.recordSeedEvidence(rec, facts);
  const note = rec.notes.join('\n');
  assert.match(note, /路径证据见输出/);
  assert.doesNotMatch(note, /路径无/);
  assert.match(note, /stdout 截断 true 原文 " M README\.md\\n"/);
});

test('P6L2 E09: two different interfaces are not called "unified", and no revision is filled in', () => {
  const plan = { ref: { planId: 'p1' }, planRevision: 1, assignments: [
    { taskId: 't-a', instruction: '实现 parseDate，返回类型待定' },
    { taskId: 't-b', instruction: '实现 parseDate 返回 Date' } ] };
  const judged = E09.firstCaseJudgement(plan);
  assert.equal(judged.status, 'uncovered');
  assert.equal('conflictLostAtRevision' in judged.facts, false, 'the revision where a conflict was lost is not inferred');
  assert.doesNotMatch(judged.note, /统一|丢失/);
  assert.deepEqual(judged.facts.assignments.map(entry => entry.taskId), ['t-a', 't-b']);
  assert.equal(judged.facts.planRevision, 1);
});

// ---- P6L2 B3/B5: E08b's rounds refresh in place, follow the answer's new round, and select one per round.
test('P6L2 E08b: the same roundRef is refreshed in place at close-out, never frozen at first sight', async () => {
  const running = changedRound('q1', { status: 'running', answer: null });
  const ended = { ...running, status: 'ended', answer: '{"kind":"plan","round":2}' };
  const { project } = changeHost({ views: [{ rounds: [running] }, { rounds: [ended] }],
    candidates: [{ head: null, status: 'closed' }] });
  const rec = changeRecord();
  const state = followState();
  await followChangeRounds(changeCtx(rec), project, requestRoot, rec, state, { check: 'adopt-after-end', timeoutMs: 0 });
  assert.equal(state.rounds.length, 1);
  assert.equal(state.rounds[0].answer, null);
  await followChangeRounds(changeCtx(rec), project, requestRoot, rec, state, { check: 'adopt-after-end', timeoutMs: 0 });
  assert.equal(state.rounds.length, 1, 'the same round is one row');
  assert.equal(state.rounds[0].answer, '{"kind":"plan","round":2}', 'the close-out re-read updates the row');
});

test('P6L2 E08b: after a card answer the follow keeps reading until the new round appears', async () => {
  const question = changedRound('q1', { answer: '{"kind":"needs_decision"}' });
  const ideas = changedRound('q2', { ideas: ['a', 'b'] });
  const selected = { ...ideas, selectedIdea: { round: ideas.ref, index: 0 } };
  const { project, commands } = changeHost({ views: [
    { rounds: [question] }, { rounds: [question] }, { rounds: [question, ideas] }, { rounds: [question, selected] },
  ], candidates: [{ head: null, status: 'closed' }] });
  const rec = changeRecord();
  const state = followState();
  await followChangeRounds(changeCtx(rec), project, requestRoot, rec, state, { check: 'adopt-after-end', timeoutMs: 60_000 });
  assert.equal(commands.filter(entry => entry.route === 'requests/submit').length, 1, 'the card was answered once');
  const picks = commands.filter(entry => entry.route === 'requests/select-idea');
  assert.equal(picks.length, 1, 'the new round was selected once');
  assert.deepEqual(picks[0].input.round, ideas.ref);
  assert.equal(state.rounds.length, 2, 'both rounds are recorded');
});

test('P6L2 E08b: each newest answered round gets its own selection, deduped by selectedIdea.round', async () => {
  const first = changedRound('q1', { ideas: ['a', 'b'] });
  const second = changedRound('q2', { ideas: ['x', 'y'] });
  const firstSelected = { ...first, selectedIdea: { round: first.ref, index: 0 } };
  const secondSelected = { ...second, selectedIdea: { round: second.ref, index: 0 } };
  const { project, commands } = changeHost({ views: [
    { rounds: [first] }, { rounds: [firstSelected, second] }, { rounds: [firstSelected, secondSelected] },
  ], candidates: [{ head: null, status: 'closed' }] });
  const rec = changeRecord();
  const state = followState();
  await followChangeRounds(changeCtx(rec), project, requestRoot, rec, state, { check: 'adopt-after-end', timeoutMs: 60_000 });
  const picks = commands.filter(entry => entry.route === 'requests/select-idea');
  assert.deepEqual(picks.map(entry => entry.input.round.queryJobId), ['q1', 'q2']);
  assert.equal(picks.length, 2, 'the second newest unselected round is selected too');
  assert.equal(state.rounds.length, 2);
});

// ---- P6L2 D: reverifyCard is a fallback only, judged by the chain head identity.
const BEAT_1 = { last: { value: { state: 'waiting', receipt: null } } };
const BEAT_2 = { state: 'waiting', last: { status: 'ready', value: { state: 'waiting', receipt: { receiptId: 'beat-2' }, next: null } } };
const reverifyCardFixture = (rounds, writeAnswer = () => ({ status: 'committed', value: { state: 'requested' } }),
  beats = [BEAT_2]) => {
  const writes = [];
  const reads = [];
  let at = 0;
  let beatAt = 0;
  const project = { scope: A, host: { client: {
    read: async (route, _scope, input) => {
      reads.push({ route, input });
      if (route === 'workflow/driver-read') {
        const beat = beats[Math.min(beatAt, beats.length - 1)];
        beatAt += 1;
        return beat === null ? { status: 'rejected', code: 'unavailable' } : answered(beat);
      }
      const value = rounds[Math.min(at, rounds.length - 1)];
      at += 1;
      return value === null ? { status: 'rejected', code: 'unavailable' } : answered(value);
    },
    write: async (route, _scope, input) => { writes.push({ route, input }); return writeAnswer(); },
  } } };
  const card = { taskRef: { taskId: 't-shapes' }, runRef: { runId: 'r-work' },
    source: { kind: 'candidate', pins: [{ ref: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' }, revision: 1 }] } };
  return { project, writes, reads, card };
};
const roundAt = (roundId, status, failing = []) => ({ roundRef: { roundId }, revision: 4, status, failingCheckIds: failing });
const REVERIFY_BEFORE = { readable: true, goalId: 'g', beat: { readable: true, beat: JSON.stringify(BEAT_1.last) },
  heads: [{ runId: 'r-work', taskId: 't-shapes', roundId: 'round-1', revision: 3 }] };
const REVERIFY_REVERIFY = reverifyCard;
const FAILURE_HEAD = failureHeadBeforeAdoption;

test('P6L2 D: a successor round, even finalized, is never clicked', async () => {
  const { project, writes, card } = reverifyCardFixture([roundAt('round-2', 'finalized', ['c1'])]);
  const rec = new Record({ id: 'E05', rows: [], checks: [] });
  const result = await REVERIFY_REVERIFY(project, card, ['p1'], rec, REVERIFY_BEFORE, Date.now() + 60_000);
  assert.equal(result, false);
  assert.equal(writes.length, 0);
  assert.match(rec.notes.at(-1), /后继/);
});

test('P6L2 D: the same finalized head with failing checks is clicked once on its own revision', async () => {
  const { project, writes, card } = reverifyCardFixture([roundAt('round-1', 'finalized', ['c1', 'c2'])]);
  const rec = new Record({ id: 'E05', rows: [], checks: [] });
  const result = await REVERIFY_REVERIFY(project, card, ['p1'], rec, REVERIFY_BEFORE, Date.now() + 60_000);
  assert.equal(result, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].input.predecessorRoundRef, { roundId: 'round-1' });
});

test('P6L2 D: an open head is not clicked', async () => {
  const { project, writes, card } = reverifyCardFixture([roundAt('round-1', 'open', ['c1'])]);
  const rec = new Record({ id: 'E05', rows: [], checks: [] });
  assert.equal(await REVERIFY_REVERIFY(project, card, ['p1'], rec, REVERIFY_BEFORE, Date.now() + 60_000), false);
  assert.equal(writes.length, 0);
});

test('P6L2 D: a head from another Goal is never used for this card', async () => {
  const { project, writes, card } = reverifyCardFixture([roundAt('round-1', 'finalized', ['c1'])]);
  const other = { ...card, source: { ...card.source, pins: [{ ref: { aggregateType: 'Goal', projectId: 'p', goalId: 'g2' }, revision: 1 }] } };
  const rec = new Record({ id: 'E05', rows: [], checks: [] });
  assert.equal(await REVERIFY_REVERIFY(project, other, ['p1'], rec, REVERIFY_BEFORE, Date.now() + 60_000), null);
  assert.equal(writes.length, 0);
  assert.match(rec.notes.at(-1), /属于目标 g/);
});

test('P6L2 D: a revision conflict re-reads once and never re-sends a different pin', async () => {
  const { project, writes, card } = reverifyCardFixture([roundAt('round-1', 'finalized', ['c1']), roundAt('round-1', 'finalized', ['c1'])],
    () => ({ status: 'invalid', code: 'revision_conflict', reason: 'the round moved' }));
  const rec = new Record({ id: 'E05', rows: [], checks: [] });
  assert.equal(await REVERIFY_REVERIFY(project, card, ['p1'], rec, REVERIFY_BEFORE, Date.now() + 60_000), false);
  assert.equal(writes.length, 1, 'no second send with another pin');
  assert.match(rec.notes.join('\n'), /不换 pin 重发/);
});

test('P6L3 D: the pre-adoption heads are recorded by Run, and an empty affectedTaskIds takes the only failed work Task', async () => {
  const runA = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'ra' };
  const runB = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'rb' };
  const tasks = { tasks: [
    { ref: { projectId: 'p', goalId: 'g', taskId: 'a' }, definition: { taskKind: 'work' },
      failure: { runRef: runA, round: { roundRef: { roundId: 'ra' }, revision: 2 } } },
    { ref: { projectId: 'p', goalId: 'g', taskId: 'b' }, definition: { taskKind: 'work' },
      failure: { runRef: runB, round: { roundRef: { roundId: 'rb' }, revision: 5 } } }] };
  const project = { scope: A, host: { client: { read: async route => (route === 'plans/proposal'
    ? answered({ reason: { affectedTaskIds: ['a', 'b'] } }) : answered(tasks)) } } };
  const picked = await FAILURE_HEAD(project, { goalId: 'g' }, { proposalId: 'p1' });
  assert.deepEqual(picked.heads.map(head => [head.taskId, head.runId, head.roundId, head.revision]),
    [['a', 'ra', 'ra', 2], ['b', 'rb', 'rb', 5]]);
  const empty = { scope: A, host: { client: { read: async route => (route === 'plans/proposal'
    ? answered({ reason: { affectedTaskIds: [] } }) : answered({ tasks: [tasks.tasks[0]] })) } } };
  const unique = await FAILURE_HEAD(empty, { goalId: 'g' }, { proposalId: 'p1' });
  assert.deepEqual(unique.heads.map(head => [head.taskId, head.runId]), [['a', 'ra']],
    'empty affectedTaskIds takes the one failed work Task');
});

test('P6L3 D: the stop card picks its own Run head from the recorded map, not the first affected Task', async () => {
  const { project, writes, card } = reverifyCardFixture([roundAt('rb', 'finalized', ['c1'])]);
  const rec = new Record({ id: 'E05', rows: [], checks: [] });
  const before = { ...REVERIFY_BEFORE, heads: [
    { runId: 'ra', taskId: 'a', roundId: 'ra', revision: 2 }, { runId: 'r-work', taskId: 'b', roundId: 'rb', revision: 5 }] };
  const selected = { ...card, runRef: { runId: 'r-work' } };
  assert.equal(await REVERIFY_REVERIFY(project, selected, ['p1'], rec, before, Date.now() + 60_000), true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].input.predecessorRoundRef, { roundId: 'rb' });
});

test('P6L3 D: the pre-adoption Workflow beat is the public last, kept for the stop card', async () => {
  const project = { scope: A, host: { client: { read: async route => (route === 'workflow/driver-read'
    ? answered(BEAT_1) : { status: 'not_found' }) } } };
  const beat = await workflowBeat(project, { projectId: 'p', goalId: 'g' });
  assert.equal(beat.readable, true);
  assert.equal(beat.beat, JSON.stringify(BEAT_1.last));
});

test('P6L3 D: the chain head is read only after workflow/driver-read shows this beat advanced', async () => {
  const { project, writes, reads, card } = reverifyCardFixture([roundAt('round-1', 'finalized', ['c1'])]);
  const rec = new Record({ id: 'E05', rows: [], checks: [] });
  assert.equal(await REVERIFY_REVERIFY(project, card, ['p1'], rec, REVERIFY_BEFORE, Date.now() + 60_000), true);
  assert.equal(writes.length, 1);
  assert.deepEqual(reads.map(entry => entry.route), ['workflow/driver-read', 'verification/round']);
});

test('P6L3 D: an unchanged last inside the window is no proof: the card keeps watching, never clicked', async () => {
  const { project, writes, card } = reverifyCardFixture([roundAt('round-1', 'finalized', ['c1'])],
    () => ({ status: 'committed', value: { state: 'requested' } }), [BEAT_1, BEAT_1]);
  const rec = new Record({ id: 'E05', rows: [], checks: [] });
  assert.equal(await REVERIFY_REVERIFY(project, card, ['p1'], rec, REVERIFY_BEFORE, Date.now() + 60_000), 'watching');
  assert.equal(writes.length, 0);
});

// ---- P6LO D: the fallback never clicks before the platform's own reverify had its chance.
const SNAP_REVERIFY_QUEUED = { state: 'running', last: { status: 'ready', value: { state: 'advance', receipt: null,
  next: { kind: 'perform', operation: { kind: 'reverify_round' } } } } };
const SNAP_REJECTED = { state: 'failed', last: { status: 'rejected', code: 'unavailable', reason: 'store down' } };
const SNAP_SETTLED = { state: 'waiting', last: { status: 'ready', value: { state: 'waiting', receipt: { receiptId: 'after' }, next: null } } };

test('P6LO D: a last that only queued the automatic reverify, or a rejected last, is no proof: the card keeps watching', async () => {
  // A driver stopped right after publishing the advance never ran the queued reverify either.
  for (const snap of [SNAP_REVERIFY_QUEUED, { ...SNAP_REVERIFY_QUEUED, state: 'stopped' }, SNAP_REJECTED]) {
    const { project, writes, card } = reverifyCardFixture([roundAt('round-1', 'finalized', ['c1'])], undefined, [snap]);
    const rec = new Record({ id: 'E05', rows: [], checks: [] });
    assert.equal(await REVERIFY_REVERIFY(project, card, ['p1'], rec, REVERIFY_BEFORE, Date.now() + 60_000), 'watching',
      snap.last.status);
    assert.equal(writes.length, 0, `${snap.last.status}: never clicked before the selection is proven over`);
  }
});

test('P6LO D: past the card deadline the read is a gap, never a click, even when it shows a settled selection', async () => {
  const { project, writes, card } = reverifyCardFixture([roundAt('round-1', 'finalized', ['c1'])], undefined, [SNAP_SETTLED]);
  const rec = new Record({ id: 'E05', rows: [], checks: [] });
  assert.equal(await REVERIFY_REVERIFY(project, card, ['p1'], rec, REVERIFY_BEFORE, Date.now() - 1), null);
  assert.equal(writes.length, 0);
  assert.match(rec.notes.at(-1), /未覆盖/);
});

test('P6LO D: a settled selection after adoption with the same failing head is the one proof that lets the card be clicked', async () => {
  const { project, writes, card } = reverifyCardFixture([roundAt('round-1', 'finalized', ['c1'])], undefined, [SNAP_SETTLED]);
  const rec = new Record({ id: 'E05', rows: [], checks: [] });
  assert.equal(await REVERIFY_REVERIFY(project, card, ['p1'], rec, REVERIFY_BEFORE, Date.now() + 60_000), true);
  assert.equal(writes.length, 1);
});

test('P6LO D: waitGoal gives a stop card one deadline after the adoption, records the gap once and never reopens it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-01-01T10:00:00Z') });
  const goalPin = { ref: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' }, revision: 1 };
  const candidate = { cardKey: 'candidate:p1', actions: ['adopt'], options: [],
    source: { kind: 'candidate', pins: [goalPin, { ref: { aggregateType: 'PlanProposal', projectId: 'p', proposalId: 'p1' }, revision: 2 }] } };
  const stop = { cardKey: 'cause:t1', actions: [], options: [], taskRef: { taskId: 't1' }, runRef: { runId: 'r-work' },
    source: { kind: 'goal_cause', key: JSON.stringify({ code: 'no_new_basis' }), pins: [goalPin] } };
  const failed = { tasks: [{ ref: { taskId: 't1' }, definition: { taskKind: 'work' },
    failure: { runRef: { runId: 'r-work' }, round: { roundRef: { roundId: 'round-1' }, revision: 3, status: 'finalized' } } }] };
  let queues = 0;
  const reads = [];
  const writes = [];
  const project = { scope: A, host: { client: {
    read: async route => {
      reads.push(route);
      switch (route) {
        case 'goals/display': return answered({ display: { phase: 'RUNNING', cause: null } });
        case 'decisions/queue': queues += 1;
          return answered({ waitingAnswer: [queues === 1 ? candidate : stop], answeredPendingApplication: [], capabilities: [] });
        case 'tasks/query': return answered(failed);
        case 'plans/proposal': return answered({ reason: { affectedTaskIds: [] } });
        case 'workflow/driver-read': return answered(SNAP_REVERIFY_QUEUED);
        case 'verification/round': return answered(roundAt('round-1', 'finalized', ['c1']));
        default: return { status: 'not_found' };
      }
    },
    write: async route => { writes.push(route); return { status: 'committed', value: { state: 'requested' } }; },
  } } };
  const rec = new Record({ id: 'E05', rows: [], checks: [] });
  const ctx = { budget: { tick: async () => {}, inFlight: () => ({ queries: 0, runs: 0, items: [] }) }, report: { current: rec } };
  let ended = null;
  waitGoal(ctx, project, { goalId: 'g' }, { timeoutMs: 8 * 60_000, rec, adoptCandidates: true, check: null })
    .then(() => { ended = 'done'; }, error => { ended = error; });
  const flush = async () => { for (let i = 0; i < 50; i += 1) await new Promise(resolve => setImmediate(resolve)); };
  const start = Date.now();
  let watchedAtFour = null;
  for (let step = 0; step < 120 && ended === null; step += 1) {
    await flush();
    if (watchedAtFour === null && Date.now() - start >= 4 * 60_000) watchedAtFour = reads.filter(route => route === 'verification/round').length;
    t.mock.timers.tick(5_000);
  }
  await flush();
  assert.notEqual(ended, null, 'the wait ended on its own timeout');
  assert.deepEqual(writes, ['plans/apply'], 'adopted once, never clicked the reverify');
  const gaps = rec.notes.filter(note => /reverify card t1/.test(note) && /未覆盖/.test(note));
  assert.equal(gaps.length, 1, `one gap for the card: ${rec.notes.join(' | ')}`);
  assert.equal(reads.filter(route => route === 'verification/round').length, watchedAtFour,
    'after its one deadline the card is not observed again');
});

test('P6LO D: with no affectedTaskIds the failed work Tasks are counted before their heads, so two failures give no head', async () => {
  const tasks = { tasks: [
    { ref: { taskId: 't1' }, definition: { taskKind: 'work' }, failure: { runRef: { runId: 'r1' }, round: null } },
    { ref: { taskId: 't2' }, definition: { taskKind: 'work' },
      failure: { runRef: { runId: 'r2' }, round: { roundRef: { roundId: 'rd2' }, revision: 1, status: 'finalized' } } }] };
  const project = { scope: A, host: { client: { read: async route => (route === 'plans/proposal'
    ? answered({ reason: { affectedTaskIds: [] } }) : answered(tasks)) } } };
  const picked = await FAILURE_HEAD(project, { goalId: 'g' }, { proposalId: 'p1' });
  assert.equal(picked.readable, false, 't1 failed in execution too: t2 is not the only failed work Task');
  assert.deepEqual(picked.failed, ['t1', 't2']);
});

test('P6L2 D: before adoption the failed Task is located by the candidate affectedTaskIds, else the only failed work Task', async () => {
  const runA = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'ra' };
  const runB = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'rb' };
  const tasks = { tasks: [
    { ref: { taskId: 'a' }, definition: { taskKind: 'work' }, failure: { runRef: runA, round: { roundRef: { roundId: 'ra' }, revision: 2 } } },
    { ref: { taskId: 'b' }, definition: { taskKind: 'work' }, failure: { runRef: runB, round: { roundRef: { roundId: 'rb' }, revision: 5 } } },
    { ref: { taskId: 'gate' }, definition: { taskKind: 'gate' }, failure: { round: { roundRef: { roundId: 'rg' }, revision: 1 } } }] };
  const project = { scope: A, host: { client: { read: async route => (route === 'plans/proposal'
    ? answered({ reason: { affectedTaskIds: ['b'] } }) : answered(tasks)) } } };
  const picked = await FAILURE_HEAD(project, { goalId: 'g' }, { proposalId: 'p1' });
  assert.deepEqual([picked.readable, picked.goalId, picked.heads.length, picked.heads[0].taskId, picked.heads[0].roundId],
    [true, 'g', 1, 'b', 'rb']);
  const one = { tasks: [tasks.tasks[0] ] };
  const single = { scope: A, host: { client: { read: async route => (route === 'plans/proposal'
    ? answered({}) : answered(one)) } } };
  assert.deepEqual((await FAILURE_HEAD(single, { goalId: 'g' }, { proposalId: 'p1' })).heads.map(head => head.taskId), ['a']);
});

test('P6L2 waiting B8: an open responsibility of the sending line gets its disposal in the same archive request', async () => {
  const calls = [];
  const letterRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: 'm1' };
  const taskRef = { projectId: 'p', goalId: 'g', taskId: 't-wait' };
  const sender = { projectId: 'p', sessionId: 's1' };
  const project = { scope: A, host: { client: {
    read: async (route, _scope, input) => {
      calls.push({ route, input });
      if (route === 'messages/read') return answered({ status: 'pending', response: null, expiredAt: null,
        acceptedInputs: [], deadline: '2026-01-01T10:00:00Z', recipient: { projectId: 'p', sessionId: 's2' } });
      if (route === 'sessions/read') return answered({ record: { revision: 4, lifecycle: 'archived' },
        links: [{ ref: { relation: 'responsible', target: { kind: 'task', ref: taskRef } }, until: null }] });
      if (route === 'sessions/facts') return answered({ waits: [{ messageRef: letterRef, originalRun: { runId: 'r' },
        state: { state: 'open' }, deadline: '2026-01-01T10:00:00Z' }] });
      if (route === 'tasks/query') return answered({ tasks: [{ ref: taskRef, disposition: 'active', effectivePhase: 'ready' }] });
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async (route, _scope, input) => { calls.push({ route, input }); return { status: 'ready', value: { state: 'archived' } }; },
  } } };
  const outcome = await transferWait(project, { ref: letterRef, line: sender }, { deadline: '2026-01-01T10:00:00Z' },
    { key: { projectId: 'p', sessionId: 's2' } });
  assert.equal(outcome.kind, 'transfer');
  const archive = calls.find(call => call.route === 'sessions/archive-line');
  assert.deepEqual(archive.input.tasks, [{ target: { kind: 'task', ref: taskRef }, disposition: { kind: 'drop' } }]);
  assert.equal(archive.input.wait.kind, 'transfer');
});

test('P6L2 waiting B9: a transfer the final letter does not show as moved is uncovered, not a pass', () => {
  const deadline = '2026-01-01T10:30:00Z';
  const secondMsg = waitingLetter({ deadline });
  const moved = waitingLetter({ deadline }); // no replyHandler / archiveWaitDisposition
  const rec = new Record({ id: 'waiting', rows: ['C-224'], checks: [{ id: 'transfer', rows: ['C-224'], text: '转交' },
    { id: 'reply-first', rows: ['C-187'], text: '回复抢先' }] });
  judgeSecond(rec, { outcome: { kind: 'transfer', sender: { projectId: 'p', sessionId: 's-member' },
    to: { projectId: 'p', sessionId: 's-other' }, moved, archived: { status: 'ready', value: { state: 'archived' } },
    senderRecord: { record: { lifecycle: 'archived' } } }, secondText: '第二个问题', secondMsg,
  final: { message: moved, senderRecord: { record: { lifecycle: 'archived' } } } });
  assert.equal(rec.results.get('transfer').status, 'uncovered');
  assert.match(rec.results.get('transfer').note, /handler 无|归档处置 无/);
});

test('P6L3 B9: a real transfer is judged on the letter re-read after the archive', async () => {
  const deadline = '2026-01-01T10:30:00Z';
  const readme = waitingSend('README 的标题要不要改成中文？');
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', taskId: 't-wait', runId: 'r-wait' };
  const letterRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: readme.ref.messageId };
  let archived = false;
  const project = { scope: A, host: { client: {
    read: async (route, _scope, input) => {
      if (route === 'messages/read') return answered(archived
        ? waitingLetter({ deadline, messageId: input.messageId,
          replyHandler: { sessionRef: { projectId: 'p', sessionId: 's-other' } },
          archiveWaitDisposition: { kind: 'transfer' } })
        : waitingLetter({ deadline, messageId: input.messageId }));
      if (route === 'sessions/read') return answered({ record: { revision: archived ? 2 : 1, lifecycle: archived ? 'archived' : 'active' } });
      if (route === 'sessions/facts') return answered({ waits: [{ messageRef: letterRef, originalRun: runRef,
        state: { state: 'open' }, deadline }] });
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async route => { if (route === 'sessions/archive-line') { archived = true; return { status: 'ready', value: { state: 'archived' } }; }
      throw new Error(`the fake Host does not answer ${route}`); },
    command: async () => { throw new Error('a live sender line needs no standalone waits/dispose'); },
  } } };
  const rec = new Record({ id: 'waiting', rows: ['C-224'], checks: [{ id: 'transfer', rows: ['C-224'], text: '转交' },
    { id: 'reply-first', rows: ['C-187'], text: '回复抢先' }] });
  await WAIT.closeSecondQuestion(quietCtx(rec), project, rec, { chain: { second: null }, secondSend: readme, seenOpen: '轮询到',
    receiverOf: async () => waitingReceiver('s-other') });
  assert.equal(rec.results.get('transfer').status, 'pass', rec.results.get('transfer').note);
  assert.equal(rec.results.get('reply-first').status, 'uncovered');
});

test('P6L3 B9: the close-out judges the transfer on the final letter and sender line, not the first pending receipt', () => {
  const deadline = '2026-01-01T10:30:00Z';
  const first = waitingLetter({ deadline });
  const moved = waitingLetter({ deadline, replyHandler: { sessionRef: { projectId: 'p', sessionId: 's-other' } },
    archiveWaitDisposition: { kind: 'transfer' } });
  const rec = new Record({ id: 'waiting', rows: ['C-224'], checks: [{ id: 'transfer', rows: ['C-224'], text: '转交' },
    { id: 'reply-first', rows: ['C-187'], text: '回复抢先' }] });
  judgeSecond(rec, { outcome: { kind: 'transfer', sender: { projectId: 'p', sessionId: 's-member' },
    to: { projectId: 'p', sessionId: 's-other' }, moved: first, deadline, archived: { status: 'ready', value: { state: 'pending' } },
    senderRecord: { record: { lifecycle: 'active' } } }, secondText: '第二个问题', secondMsg: moved,
  final: { message: moved, senderRecord: { record: { lifecycle: 'archived' } } } });
  assert.equal(rec.results.get('transfer').status, 'pass', rec.results.get('transfer').note);
  assert.match(rec.results.get('transfer').note, /s-other/);
});

test('P6L3 B9: the close-out transfer uses the earlier attempt\'s intended receiver', () => {
  const deadline = '2026-01-01T10:30:00Z';
  const moved = waitingLetter({ deadline, replyHandler: { sessionRef: { projectId: 'p', sessionId: 's-other' } },
    archiveWaitDisposition: { kind: 'transfer' } });
  const rec = new Record({ id: 'waiting', rows: ['C-224'], checks: [{ id: 'transfer', rows: ['C-224'], text: '转交' },
    { id: 'reply-first', rows: ['C-187'], text: '回复抢先' }] });
  const attempt = { kind: 'transfer-refused', to: { projectId: 'p', sessionId: 's-other' },
    note: '归档被拒', archived: { status: 'rejected', code: 'invalid' } };
  judgeSecond(rec, { outcome: { kind: 'transfer', sender: { projectId: 'p', sessionId: 's-member' }, message: moved, deadline },
    attempt, secondText: '第二个问题', secondMsg: moved,
  final: { message: moved, senderRecord: { record: { lifecycle: 'archived' } } } });
  assert.equal(rec.results.get('transfer').status, 'pass', rec.results.get('transfer').note);
  assert.match(rec.results.get('transfer').note, /s-other/);
});

test('P6L3 B9: a first refused receipt does not stop the final transfer evidence from deciding', () => {
  const deadline = '2026-01-01T10:30:00Z';
  const moved = waitingLetter({ deadline, replyHandler: { sessionRef: { projectId: 'p', sessionId: 's-other' } },
    archiveWaitDisposition: { kind: 'transfer' } });
  const rec = new Record({ id: 'waiting', rows: ['C-224'], checks: [{ id: 'transfer', rows: ['C-224'], text: '转交' },
    { id: 'reply-first', rows: ['C-187'], text: '回复抢先' }] });
  judgeSecond(rec, { outcome: { kind: 'transfer-refused', sender: { projectId: 'p', sessionId: 's-member' },
    to: { projectId: 'p', sessionId: 's-other' }, archived: { status: 'rejected', code: 'archive_disposal_required' },
    moved: waitingLetter({ deadline }), deadline, note: '归档被拒' }, secondText: '第二个问题', secondMsg: moved,
  final: { message: moved, senderRecord: { record: { lifecycle: 'archived' } } } });
  assert.equal(rec.results.get('transfer').status, 'pass', rec.results.get('transfer').note);
  assert.match(rec.results.get('transfer').note, /归档被拒/);
});

// ---- P6LO B9: the transfer is judged only on the final letter and sending line, against the deadline before the archive.
const B9_CHECKS = [{ id: 'transfer', rows: ['C-224'], text: '转交' }, { id: 'reply-first', rows: ['C-187'], text: '回复抢先' }];
const movedLetter = (overrides = {}) => waitingLetter({ replyHandler: { sessionRef: { projectId: 'p', sessionId: 's-other' } },
  archiveWaitDisposition: { kind: 'transfer' }, ...overrides });
const committedTransfer = { kind: 'transfer', sender: { projectId: 'p', sessionId: 's-member' }, to: { projectId: 'p', sessionId: 's-other' },
  deadline: '2026-01-01T10:30:00Z', moved: movedLetter(), archived: { status: 'ready', value: { state: 'archived' } },
  senderRecord: { record: { lifecycle: 'archived' } } };

test('P6LO B9: a final letter read that fails is uncovered, never judged on the letter read before', () => {
  const rec = new Record({ id: 'waiting', rows: ['C-224'], checks: B9_CHECKS });
  judgeSecond(rec, { outcome: committedTransfer, secondText: '第二个问题', secondMsg: movedLetter(),
    final: { message: null, messageGap: 'messages/read m: rejected unavailable', senderRecord: { record: { lifecycle: 'archived' } } } });
  assert.equal(rec.results.get('transfer').status, 'uncovered', rec.results.get('transfer').note);
  assert.equal(rec.results.get('transfer').code, 'env-unavailable');
});

test('P6LO B9: a transfer that changed the deadline fails against the deadline read before the archive', () => {
  const rec = new Record({ id: 'waiting', rows: ['C-224'], checks: B9_CHECKS });
  const final = movedLetter({ deadline: '2026-01-01T10:45:00Z' });
  // closeSecondQuestion passes the final letter as secondMsg too; it must not be the deadline it is compared with.
  judgeSecond(rec, { outcome: committedTransfer, secondText: '第二个问题', secondMsg: final,
    final: { message: final, senderRecord: { record: { lifecycle: 'archived' } } } });
  assert.equal(rec.results.get('transfer').status, 'fail', rec.results.get('transfer').note);
  assert.match(rec.results.get('transfer').note, /10:30:00Z → 2026-01-01T10:45:00Z/);
});

test('P6LO B9: a partial first receipt and a failed middle read still let the final letter and line decide, with the inner rejection noted', () => {
  const rec = new Record({ id: 'waiting', rows: ['C-224'], checks: B9_CHECKS });
  const partial = { ...committedTransfer, kind: 'transfer-refused', note: '归档发信线 s-member：ready partial',
    archived: { status: 'ready', value: { state: 'partial', rejection: { code: 'unavailable', reason: 'the wait disposal failed' } } } };
  judgeSecond(rec, { outcome: { kind: 'gap', note: 'messages/read 没有回答' }, attempt: partial, secondText: '第二个问题',
    secondMsg: movedLetter(), final: { message: movedLetter(), senderRecord: { record: { lifecycle: 'archived' } } } });
  assert.equal(rec.results.get('transfer').status, 'pass', rec.results.get('transfer').note);
  assert.match(rec.results.get('transfer').note, /the wait disposal failed/);
});

test('P6LO B9: a reply after a proven transfer is not judged as reply-first, and the close-out reads the transfer', async () => {
  const deadline = '2026-01-01T10:30:00Z';
  const readme = waitingSend('README 的标题要不要改成中文？');
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', taskId: 't-wait', runId: 'r-wait' };
  const letterRef = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'wa', messageId: readme.ref.messageId };
  let archived = false;
  const project = { scope: A, host: { client: {
    read: async (route, _scope, input) => {
      if (route === 'messages/read') return answered(archived
        ? movedLetter({ deadline, messageId: input.messageId, status: 'responded', response: { respondedAt: '2026-01-01T10:05:00Z' },
          acceptedInputs: [{ part: 'response', consumesWait: true, acceptedAt: '2026-01-01T10:05:01Z' }] })
        : waitingLetter({ deadline, messageId: input.messageId }));
      if (route === 'sessions/read') return answered({ record: { revision: archived ? 2 : 1, lifecycle: archived ? 'archived' : 'active' } });
      if (route === 'sessions/facts') return answered({ waits: [{ messageRef: letterRef, originalRun: runRef, state: { state: 'open' }, deadline }] });
      throw new Error(`the fake Host does not answer ${route}`);
    },
    write: async route => {
      if (route !== 'sessions/archive-line') throw new Error(`the fake Host does not answer ${route}`);
      archived = true;
      return { status: 'ready', value: { state: 'partial', rejection: { code: 'unavailable', reason: 'the requeue failed' } } };
    },
    command: async () => { throw new Error('a live sender line needs no standalone waits/dispose'); },
  } } };
  const rec = new Record({ id: 'waiting', rows: ['C-224'], checks: B9_CHECKS });
  await WAIT.closeSecondQuestion(quietCtx(rec), project, rec, { chain: { second: null }, secondSend: readme, seenOpen: '轮询到',
    receiverOf: async () => waitingReceiver('s-other') });
  assert.equal(rec.results.get('transfer').status, 'pass', rec.results.get('transfer').note);
  assert.equal(rec.results.get('reply-first').status, 'uncovered', rec.results.get('reply-first').note);
  assert.equal(rec.results.get('reply-first').code, 'not-run');
});

test('P6LO A6: with no locked snapshot a close-out that finds the claim but cannot read the planning Query is uncovered, not a pass', async () => {
  const project = { scope: A, host: { client: { read: async route => {
    if (route === 'messages/view') return answered({ message: { goalRef: null, taskRef: null }, delivery: null, disposition: { kind: 'offerable' } });
    if (route === 'executions/list') return page([{ run: { ref: { runId: 'r1' }, status: 'running',
      task: { projectId: 'p', goalId: LONG_GOAL.goalId, taskId: 't1' }, consumedWait: { kind: 'intervention', messageRef: { messageId: 'm1' } } },
    outbox: { claim: { sessionRef: { projectId: 'p', sessionId: 's1' } } } }]);
    if (route === 'lines/list') return { status: 'rejected', code: 'unavailable', reason: 'line store down' };
    if (route === 'sessions/read') return answered({ record: { revision: 1 }, links: [] });
    if (route === 'tasks/query') return answered({ tasks: [] });
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const claim = { messageRef: { messageId: 'm1' }, line: 's1', taskId: 't1', before: new Set(['r0']), at: '2026-01-01T10:00:00Z' };
  const final = await INTMOD.claimSnapshot(project, LONG_GOAL, claim, { unassociated: true });
  const verdict = INTMOD.claimVerdict(final, '空闲线');
  assert.equal(verdict.status, 'uncovered', verdict.text);
  assert.equal(verdict.code, 'env-unavailable');
  assert.match(verdict.text, /lines\/list/);
});

test('P6L3 A6: a close-out with both reads failed keeps the gap; a complete read with no association fails', async () => {
  const project = { scope: A, host: { client: { read: async route => {
    if (route === 'messages/view') return { status: 'rejected', code: 'unavailable', reason: 'mail store down' };
    if (route === 'executions/list') return { status: 'rejected', code: 'unavailable', reason: 'run store down' };
    if (route === 'sessions/read') return answered({ record: { revision: 1 }, links: [] });
    if (route === 'lines/list') return answered({ rows: [] });
    if (route === 'tasks/query') return answered({ tasks: [] });
    if (route === 'sessions/queries') return page([]);
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const claim = { messageRef: { messageId: 'm1' }, line: 's1', taskId: 't1', before: new Set(['r0']),
    at: '2026-01-01T10:00:00Z' };
  const final = await INTMOD.claimSnapshot(project, LONG_GOAL, claim, { unassociated: true });
  assert.equal(final.associated, false);
  assert.ok(final.gaps.some(gap => /messages\/view/.test(gap)));
  assert.ok(final.gaps.some(gap => /executions\/list/.test(gap)));
  const complete = { scope: A, host: { client: { read: async route => {
    if (route === 'messages/view') return answered({ message: { goalRef: null, taskRef: null }, delivery: null });
    if (route === 'executions/list') return page([]);
    if (route === 'sessions/read') return answered({ record: { revision: 1 }, links: [] });
    if (route === 'lines/list') return answered({ rows: [] });
    if (route === 'tasks/query') return answered({ tasks: [] });
    if (route === 'sessions/queries') return page([]);
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const none = await INTMOD.claimSnapshot(complete, LONG_GOAL, claim, { unassociated: true });
  assert.equal(none.associated, false);
  assert.deepEqual(none.gaps, []);
  const verdict = INTMOD.claimVerdict(none, '空闲线');
  assert.equal(verdict.status, 'fail', 'a complete read that shows no association fails');
});

test('P6L2 A6: a failed executions read with no same-letter association never locks the point', async () => {
  const project = { scope: A, host: { client: { read: async route => {
    if (route === 'messages/view') return answered({ message: { goalRef: null, taskRef: null }, delivery: null });
    if (route === 'lines/list') return answered({ rows: [] });
    if (route === 'sessions/read') return answered({ record: { revision: 1 }, links: [] });
    if (route === 'sessions/queries') return page([]);
    if (route === 'executions/list') return { status: 'rejected', code: 'unavailable', reason: 'store down' };
    throw new Error(`the fake Host does not answer ${route}`);
  } } } };
  const claim = { messageRef: { messageId: 'm1' }, line: 's1', taskId: 't1', before: new Set(['r0']),
    at: '2026-01-01T10:00:00Z' };
  assert.equal(await INTMOD.claimSnapshot(project, null, claim), null, 'the failed read is a gap, not a claim');
});

test('P6L2 B12: a letter delivered while paused fails even when the post-resume read is missing', () => {
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', taskId: 't1', runId: 'r1' };
  const verdict = INTMOD.pausedVerdict({ premise: { ok: true }, whilePaused: 'delivered', whilePausedInto: runRef,
    afterResume: null, view: null, planning: null, planningGaps: [], resumeCommitted: true });
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.note, /暂停中.*送进 Work/);
});

test('P6L2 D: revision_conflict with a moved head records the successor and never re-sends', async () => {
  const { project, writes, card } = reverifyCardFixture(
    [roundAt('round-1', 'finalized', ['c1']), roundAt('round-2', 'finalized', ['c1'])],
    () => ({ status: 'invalid', code: 'revision_conflict', reason: 'the round moved' }));
  const rec = new Record({ id: 'E05', rows: [], checks: [] });
  assert.equal(await REVERIFY_REVERIFY(project, card, ['p1'], rec, REVERIFY_BEFORE, Date.now() + 60_000), false);
  assert.equal(writes.length, 1);
  assert.match(rec.notes.join('\n'), /平台已开新一轮/);
});

// ---- P6LC (INT2 supplementary ruling C4 item 3 and the last line of item 2; I-4 as corrected there): the R2 iteration
// after the seed Goal ended, end to end against a fake Host that keeps the platform's own request rules.
const R2_SEED = { aggregateType: 'Goal', projectId: 'p', workspaceId: 'wa', goalId: 'g-seed' };
const R2_NEW = { ...R2_SEED, goalId: 'g-new' };
const R2_PLAN = '参数解析改为直接读 process.argv，不引入依赖';

/**
 * The Host side of the R2 iteration as INT2 C4 has it. A request sent on the ended seed Goal opens root `root` with no
 * goal of its own and the seed as its source; the second request (`other`) keeps the goal it names. Selecting an idea of
 * `root` gives the card round; `goals/confirm-draft` binds `g-new`, adds the closed attribution round (`not_entered`,
 * `request-rounds.ts:120-136`) and, unless `queuesPlan` is false, queues the planning round itself (C4 item 2). A
 * follow-up must carry `goalId` null or the root's own goal, else it is refused (`request-service.ts:959`). A root's plan
 * turn numbered `asks[root]` asks the person instead of writing a candidate. Every call is logged in order.
 */
function r2IterationHost({ ideas = 2, queuesPlan = true, asks = { root: 1, other: 0 } } = {}) {
  const calls = [];
  const roots = new Map();
  const candidates = new Map();
  let rounds = 0;
  const job = queryJobId => ({ aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'wa', queryJobId });
  const addRound = (root, fields) => root.rounds.push({ ref: job(`${root.id}-r${++rounds}`), status: 'ended', input: '',
    answer: null, ideas: [], goalCardDrafts: [], session: { sessionId: 's1' }, closeCode: null, ...fields });
  const rootOf = ref => [...roots.values()].find(root => root.rounds.some(round => round.ref.queryJobId === ref.queryJobId));
  const planTurn = root => {
    if (root.turns++ === asks[root.id]) return addRound(root, { answer: JSON.stringify({ schemaVersion: 2, kind: 'needs_decision' }) });
    addRound(root, { answer: JSON.stringify({ schemaVersion: 2, kind: 'plan', summary: R2_PLAN }) });
    const key = `${root.effectiveGoalId}/${root.id}`;
    const head = candidates.get(key)?.head;
    candidates.set(key, { head: { ref: { proposalId: `${root.id}-p${rounds}` }, revision: 1 }, status: 'candidate',
      previous: head === undefined ? null : { proposalRef: head.ref, revision: head.revision } });
  };
  const reads = {
    'requests/read': ({ requestRoot }) => {
      const root = roots.get(requestRoot.queryJobId);
      return { requestRoot: root.ref, goalId: root.goalId, effectiveGoalId: root.effectiveGoalId, source: root.source, rounds: root.rounds };
    },
    'plans/request-candidate': ({ goalRef, requestRef }) => candidates.get(`${goalRef.goalId}/${requestRef.queryJobId}`)
      ?? { head: null, status: 'none', previous: null },
    'goals/list': () => ({ goals: [] }),
    'goals/read': () => ({ goal: { revision: 3 } }),
  };
  const commands = {
    'requests/submit': input => {
      if (input.continues === null) {
        const id = roots.size === 0 ? 'root' : 'other';
        const onSeed = input.goalId === R2_SEED.goalId;
        const goalId = onSeed ? null : input.goalId;
        const root = { id, ref: job(id), goalId, effectiveGoalId: goalId, turns: 0, rounds: [],
          source: onSeed ? { goalRef: R2_SEED, messageRef: null } : null };
        roots.set(id, root);
        addRound(root, { input: input.text, answer: '思路', ideas: Array.from({ length: id === 'root' ? ideas : 2 }, (_, index) => ({ title: `思路${index + 1}` })) });
        return { status: 'queued', requestRoot: root.ref };
      }
      const root = roots.get(input.continues.queryJobId);
      if (input.goalId !== null && input.goalId !== root.goalId) {
        return { status: 'invalid', code: 'invalid', reason: 'goalId must be null or the request goal' };
      }
      planTurn(root);
      return { status: 'queued', requestRoot: root.ref };
    },
    'requests/select-idea': ({ round, index }) => {
      const root = rootOf(round);
      if (root.goalId === null) {
        addRound(root, { input: `已选第 ${index + 1} 个思路`, answer: '目标卡', goalCardDrafts: [{ index: 0, draft: { title: 'CLI' }, confirmedGoalRef: null }] });
      } else planTurn(root);
      return { status: 'queued' };
    },
    'goals/confirm-draft': ({ round }) => {
      const root = rootOf(round);
      root.effectiveGoalId = R2_NEW.goalId;
      addRound(root, { closeCode: 'not_entered', session: null });
      if (queuesPlan) planTurn(root);
      return { status: 'committed', value: { binding: { goalRef: R2_NEW, goalRevision: 1, answerRef: 'a', requestRef: root.ref } } };
    },
    'requests/ask': input => {
      addRound(rootOf(input.round), { input: input.text, answer: '选它是因为 process.argv 不引入依赖', session: null });
      return { status: 'queued' };
    },
  };
  const host = { client: {
    read: async (route, _scope, input) => { calls.push({ kind: 'read', route, input }); return answered(reads[route](input)); },
    command: async (route, _scope, input) => { calls.push({ kind: 'command', route, input }); return commands[route](input); },
    write: async (route, _scope, input, pins) => {
      calls.push({ kind: 'write', route, input, pins });
      for (const [key, value] of candidates) {
        if (value.head.ref.proposalId !== input.proposalRef.proposalId) candidates.set(key, { ...value, status: 'stale' });
      }
      return { status: 'committed', value: {} };
    },
  } };
  return { host, calls };
}

/** One R2 iteration run on the fake Host: the record, the calls, and the stop it threw (null when it ran through). */
async function runR2Iteration(options) {
  const { host, calls } = r2IterationHost(options);
  const rec = new Record(iteration);
  rec.facts.userCommand = [];
  const ctx = { budget: { tick: async () => {}, inFlight: () => ({ items: [] }) }, report: { current: rec } };
  const stop = await iterateOnEndedSeed(ctx, { scope: A, host }, rec, R2_SEED).then(() => null, error => error);
  return { rec, calls, stop };
}

const afterConfirm = calls => calls.slice(calls.findIndex(call => call.route === 'goals/confirm-draft') + 1);

test('P6LC item 1: every follow-up on a request root sends goalId null like the UI; reads, apply and the second request keep the new Goal', async () => {
  const { rec, calls, stop } = await runR2Iteration();
  assert.equal(stop, null);
  const submits = calls.filter(call => call.route === 'requests/submit');
  assert.deepEqual(submits.filter(call => call.input.continues !== null).map(call => [call.input.continues.queryJobId, call.input.goalId]),
    [['root', null], ['root', null], ['other', null]], 'the change, the answer to its question, the answer on the second request');
  assert.deepEqual(submits.filter(call => call.input.continues === null).map(call => call.input.goalId), ['g-seed', 'g-new']);
  assert.ok(calls.filter(call => call.route === 'plans/request-candidate').every(call => call.input.goalRef.goalId === 'g-new'));
  assert.deepEqual(calls.find(call => call.route === 'plans/apply').pins.map(pin => pin.ref.goalId), ['g-new']);
  for (const id of ['continues', 'what-changed', 'per-request']) assert.equal(rec.results.get(id)?.status, 'pass', id);
});

test('P6LC item 2: after the confirm the driver sends nothing and only waits for the (new Goal, root) candidate', async () => {
  const { rec, calls, stop } = await runR2Iteration();
  assert.equal(stop, null);
  const after = afterConfirm(calls);
  const firstRead = after.findIndex(call => call.route === 'plans/request-candidate');
  assert.deepEqual(after.slice(0, firstRead).filter(call => call.kind !== 'read').map(call => call.route), [],
    'the platform queues the planning round itself; the person sends no "按已选思路出首案"');
  assert.deepEqual([after[firstRead].input.goalRef, after[firstRead].input.requestRef.queryJobId], [R2_NEW, 'root']);
  assert.equal(rec.results.get('candidate')?.status, 'pass');
});

test('P6LC item 2: no planning round after the confirm fails the candidate at once and stops not-run, still sending nothing', async () => {
  const { rec, calls, stop } = await runR2Iteration({ queuesPlan: false });
  assert.equal(stop?.code, 'not-run');
  assert.equal(rec.results.get('candidate')?.status, 'fail');
  assert.match(rec.results.get('candidate').note, /closed without a candidate: not_entered/);
  assert.deepEqual(afterConfirm(calls).filter(call => call.kind !== 'read').map(call => call.route), []);
  assert.equal(rec.results.has('what-changed'), false, 'nothing after the candidate is judged');
});

test('P6LO C4: a planning round that asks first after the confirm is answered inside the same 20 minutes, then the candidate is awaited', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-01-01T10:00:00Z') });
  const start = Date.now();
  let result = null;
  const running = runR2Iteration({ asks: { root: 0, other: 0 } }).then(value => { result = value; });
  for (let i = 0; i < 300 && result === null; i += 1) { await flushAll(); t.mock.timers.tick(10_000); }
  await running;
  const { rec, calls, stop } = result;
  assert.equal(stop, null, String(stop?.message));
  assert.equal(rec.results.get('candidate')?.status, 'pass', rec.results.get('candidate')?.note);
  const answers = afterConfirm(calls).filter(call => call.route === 'requests/submit' && call.input.text === PLAN_QUESTIONS_ANSWER);
  assert.deepEqual([answers[0].input.continues.queryJobId, answers[0].input.goalId], ['root', null],
    'answered on the same root through the shared entry, goalId null like the UI');
  assert.ok(Date.now() - start < 20 * 60_000, 'inside the original 20 minutes');
});

import { waitCandidate } from '../lib/flows.mjs';

test('P6LO C4: answering the questions never stretches the candidate wait past its own limit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-01-01T10:00:00Z') });
  const asked = changedRound('q1', { answer: '{"kind":"needs_decision"}' });
  const { project, commands } = changeHost({ views: [{ rounds: [asked] },
    { rounds: [asked, changedRound('q2', { status: 'running', answer: null })] }], candidates: [{ head: null, status: 'none' }] });
  const rec = changeRecord();
  const start = Date.now();
  let result = 'pending';
  let endedAt = null;
  waitCandidate(changeCtx(rec), project, goalRef, requestRoot, 'the request candidate',
    { timeoutMs: 20 * 60_000, check: null, questionsRec: rec })
    .then(value => { result = value; }, error => { result = error; }).finally(() => { endedAt = Date.now(); });
  for (let i = 0; i < 400 && result === 'pending'; i += 1) { await flushAll(); t.mock.timers.tick(10_000); }
  await flushAll();
  assert.ok(result instanceof Error, `the wait ends on its own limit: ${result}`);
  assert.equal(commands.filter(entry => entry.route === 'requests/submit').length, 1);
  // One 10 s poll past the limit at most, as every `waitFor`.
  assert.ok(endedAt - start <= 20 * 60_000 + 10_000, `${(endedAt - start) / 60_000} min`);
});

test('P6LC item 3: the rest of I-4 holds: the seed Goal on the first request, R2 judged on the view, both Goals in the facts', async () => {
  const { rec, calls } = await runR2Iteration();
  const first = calls.find(call => call.route === 'requests/submit');
  assert.deepEqual([first.input.goalId, first.input.continues], ['g-seed', null]);
  for (const id of ['ideas', 'request-goal', 'select']) assert.equal(rec.results.get(id)?.status, 'pass', id);
  assert.deepEqual([rec.facts.seedGoal, rec.facts.newGoal], [R2_SEED, R2_NEW]);
  assert.match(rec.notes.join('\n'), /种子目标完成后 R2 另开新目标/);

  const short = await runR2Iteration({ ideas: 1 });
  assert.equal(short.stop?.code, 'not-run');
  assert.match(short.stop.message, /fewer than two ideas/);
  assert.deepEqual(['ideas', 'request-goal'].map(id => short.rec.results.get(id)?.status), ['fail', 'pass']);
  assert.equal(short.calls.some(call => call.route === 'requests/select-idea'), false, 'one idea is never selected');
});
