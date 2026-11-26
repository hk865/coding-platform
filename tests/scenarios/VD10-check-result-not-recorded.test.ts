/**
 * VD-10 (lead ruling 11-26; Astra's E05 review, astra-e05.md:71 and :80): a check that ran but whose result the
 * ledger refused on every attempt is interrupted by its own runner (`result_not_recorded`) instead of staying
 * `executing` until a Host restart. The Workflow finalizes the round INCONCLUSIVE and checks the Task again in an
 * automatic successor round, which counts like any automatic reverify (no exemption) and PASSes.
 *
 * A2 fault injection: the store refuses the result commit as many times as the runner tries it; every other write,
 * the interrupt included, reaches the store. Platform mode, scripted model replies only. Lead ruling 11-27 (FLK
 * review): the faults hit only the first round's first check, the round has a second check, and the cell counts the
 * attempts that reached the store, their request ids and the command's real runs.
 *
 * The race (lead ruling 11-27, FLK review): the last attempt is refused to the runner but lands after its last
 * read, so its interrupt meets a settled check; it reads the round once more and answers the booked result (no
 * `waiting`).
 */
import { afterEach, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import type { PreparedCommit } from '../../src/core/record-store/ports.js';
import { AG2B_WORK_TASK_ID, ag2bChecksConfiguration } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import {
  checkRevisionOf, cleanupScenarios, openPlatformScenario, performs, SCENARIO_OPERATOR, type PlatformScenario,
} from './harness.js';
import { editThenText } from './support/common.js';

vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

afterEach(async () => {
  commitBarrier.reset();
  await cleanupScenarios();
});

/** The runner's attempts at one result: the first record and two retries (VD-10). */
const RESULT_ATTEMPTS = 3;

const recordsCheckResult = (commit: PreparedCommit): boolean =>
  commit.events.some(event => event.eventType === 'VerificationCheckResultRecorded');

/** The work Task's rounds in chain order, from the last invariant read (`advance` reads after every step). */
function workChain(h: PlatformScenario): RoundSnapshot[] {
  return (h.lastWorld?.rounds ?? []).filter(round => round.subject.taskId === AG2B_WORK_TASK_ID)
    .sort((left, right) => (left.chain?.ordinal ?? 1) - (right.chain?.ordinal ?? 1));
}

/** Two checks in the round (lead ruling 11-27); every run of the first one's command leaves one mark in the workspace. */
const FIRST_CHECK = 'vd10-first';
const SECOND_CHECK = 'vd10-second';
/** Under `.cache`, which the round's source digest leaves out (`HOLD_CHECK_MARKER`, tests/scenarios/support/restart.ts:95). */
const FIRST_CHECK_RUNS = '.cache/vd10-first-runs';
const FIRST_CHECK_COMMAND = 'node -e "const fs=require(\'node:fs\');fs.mkdirSync(\'.cache\',{recursive:true});'
  + `fs.appendFileSync('${FIRST_CHECK_RUNS}','x')"`;

/** How many times the first check's command really ran (one mark per run; begin events are not runs). */
function firstCheckRuns(h: PlatformScenario): number {
  const marks = join(h.root, FIRST_CHECK_RUNS);
  return existsSync(marks) ? readFileSync(marks, 'utf8').length : 0;
}

/** The round a result commit writes (its event's `result`); null for any other commit. */
function resultRoundOf(commit: PreparedCommit): RoundSnapshot | null {
  const event = commit.events.find(candidate => candidate.eventType === 'VerificationCheckResultRecorded');
  return event === undefined ? null : (JSON.parse(event.json) as { result: RoundSnapshot }).result;
}

/** A result commit of the first round's first check: its one invocation there (C-04, never run again in its round). */
function firstCheckOfFirstRound(commit: PreparedCommit): boolean {
  const round = resultRoundOf(commit);
  return round !== null && (round.chain?.ordinal ?? 1) === 1
    && round.checks.find(check => check.checkId === FIRST_CHECK)?.phase === 'finished';
}

it('VD-10: a result refused on every attempt ends the check interrupted (result_not_recorded); the Task is checked again and PASSes', async () => {
  const h = await openPlatformScenario({ script: { replies: editThenText('vd10') } });
  const base = ag2bChecksConfiguration({ actor: SCENARIO_OPERATOR, revision: checkRevisionOf(2) });
  const check = base.checks[0]!;
  h.platform.registerCheckConfiguration({ configuration: { ...base, checks: [
    { ...check, checkId: FIRST_CHECK, command: FIRST_CHECK_COMMAND },
    { ...check, checkId: SECOND_CHECK, command: 'node -e "process.exit(0)"' }] } });
  // Only the first round's first check is refused, on every attempt; the watch sees each attempt reach the store.
  const attempts = commitBarrier.watch(firstCheckOfFirstRound);
  for (let attempt = 0; attempt < RESULT_ATTEMPTS; attempt += 1) commitBarrier.failCommitOnce(firstCheckOfFirstRound);

  const interrupted = await h.advance(h.select('vd10', AG2B_WORK_TASK_ID), { stopBefore: performs('reverify_round') });
  expect(interrupted.state).toBe('stopped');
  expect(interrupted.receipts.map(receipt => receipt.kind)).not.toContain('complete_task');
  const [round] = workChain(h);
  // §9.3 Workflow order (V6 "只补未执行"): the interrupted check does not hold the round's pending one; it runs next.
  expect(interrupted.steps.find(step => step.receipt?.kind === 'run_check')).toMatchObject({ state: 'advance',
    next: { kind: 'perform', operation: { kind: 'run_check', request: { input: { roundRef: round?.ref, checkId: SECOND_CHECK } } } } });
  expect(round).toMatchObject({ status: 'finalized', outcome: 'INCONCLUSIVE', gaps: [{ code: 'interrupted_check' }], checks: [
    { checkId: FIRST_CHECK, phase: 'interrupted', incompleteCause: 'result_not_recorded', outcome: null, reportRef: null },
    { checkId: SECOND_CHECK, phase: 'finished', outcome: 'PASS' }] });
  // Three attempts at the one invocation's result, under one request id (the record identity is H(actor, scope,
  // requestId)), and its command ran once.
  const invocationId = round?.checks[0]?.invocationId;
  expect(invocationId).toEqual(expect.any(String));
  expect(attempts.commits().map(commit => resultRoundOf(commit)?.checks[0]?.invocationId))
    .toEqual(Array(RESULT_ATTEMPTS).fill(invocationId));
  expect(new Set(attempts.commits().map(commit => commit.identityKey)).size).toBe(1);
  expect(firstCheckRuns(h), 'the first check\'s command ran once').toBe(1);
  expect(h.counts().checksBegun).toBe(2);

  if (interrupted.next === null) throw new Error('the Workflow stopped with no reverify step');
  const checkedAgain = await h.advance(interrupted.next);
  expect(checkedAgain.receipts.map(receipt => receipt.kind)).toContain('complete_task');
  expect(workChain(h)[1]).toMatchObject({ status: 'finalized', outcome: 'PASS',
    chain: { ordinal: 2, autoCount: 1, reverify: { exemption: 'none' } } });
  expect(firstCheckRuns(h)).toBe(2);
  expect(h.counts().checksBegun).toBe(4);
}, 120_000);

it('VD-10 race: the result lands after the runner\'s last read and before its interrupt; the refused interrupt reads the round once more and the Workflow gets the booked result', async () => {
  const h = await openPlatformScenario({ script: { replies: editThenText('vd10-race') } });
  // Attempts 1 and 2 fail; attempt 3 fails its caller as well, but the barrier keeps it. The runner reads the round
  // once more (still executing) and sends its interrupt; the kept result lands while that interrupt is held.
  for (let attempt = 1; attempt < RESULT_ATTEMPTS; attempt += 1) commitBarrier.failCommitOnce(recordsCheckResult);
  const third = commitBarrier.failCommitLandLater(recordsCheckResult);
  const interrupt = commitBarrier.hold(byIdentityPrefix('r3e-interrupt:'), 'the result_not_recorded interrupt');
  const toCheck = await h.advance(h.select('vd10-race', AG2B_WORK_TASK_ID), { stopBefore: performs('run_check') });
  if (toCheck.next === null) throw new Error('the Workflow stopped before run_check');
  const checked = h.advance(toCheck.next);
  await interrupt.reached;
  expect(await third.land()).toMatchObject({ status: 'committed', replayed: false });
  interrupt.release();

  const driven = await checked;
  expect(driven.steps[0], 'the Workflow advances on the booked result, it does not wait').toMatchObject({ state: 'advance',
    receipt: { kind: 'run_check', result: { status: 'ready', value: { checks: [{ phase: 'finished', outcome: 'PASS' }] } } } });
  expect(driven.receipts.map(receipt => receipt.kind)).toContain('complete_task');
  expect(workChain(h)).toMatchObject([{ status: 'finalized', outcome: 'PASS', checks: [{ phase: 'finished', outcome: 'PASS' }] }]);
  expect(h.counts().checksBegun).toBe(1);
}, 120_000);
