/**
 * SMK3B-1, -2, -3 and -6 (the Host-restart interruption of an active Goal).
 *
 * The D-group Goal: the seeded Plan's required work t1 ended its Run and the round was opened with its check not
 * started (t1 verifying); t2 never started. A clean close then a start with the start-up position ask records the
 * Goal interruption; auto drives it without a record; off records it like ask; a stale lock (HL-03) records it
 * `unclean`. SQLite only (every row restarts the Host), public routes and reads only, scripted model replies only.
 */
import { afterEach, expect, it } from 'vitest';
import type { HostReconcileReportV1 } from '../../src/app/core-http-types.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { cleanupScenarios, openHostScenario, performs, waitFor, type HostScenario } from './harness.js';
import { editThenText, redrivePolicy } from './support/common.js';
import { queueOf } from './support/review-card-round.js';

afterEach(cleanupScenarios, 120_000);

const T1 = 't1';
const T2 = 't2';
const OFF = redrivePolicy(false);
const AUTO = redrivePolicy(true);

/** The one interruption entry of the D Goal's report. */
function entryOf(report: HostReconcileReportV1): NonNullable<HostReconcileReportV1['report']>['interruptedGoals'][number] {
  expect(report.report).toMatchObject({ interruptedGoals: expect.any(Array) });
  const entry = report.report!.interruptedGoals.find(candidate => candidate.goalRef.goalId === AG2B_GOAL_REF.goalId);
  expect(entry).toBeDefined();
  return entry!;
}

/** Drives t1 to the open round before its check starts (t1 verifying; t2 and the gate never started). */
async function dGoal(label: string): Promise<HostScenario> {
  const h = await openHostScenario({ workIds: [T1, T2], script: { replies: [...editThenText(label),
    { kind: 'text', text: `${label}: the person starts the work after the interruption` }] } });
  const driven = await h.advance(h.select(label, T1), { stopBefore: performs('run_check') });
  expect(driven.state, label).toBe('stopped');
  expect(await h.taskRow(T1)).toMatchObject({ effectivePhase: 'verifying' });
  expect(await h.taskRow(T2)).toMatchObject({ effectivePhase: 'pending' });
  return h;
}

/** The goal_cause card of the Goal interruption, or undefined. */
async function interruptionCard(h: HostScenario): Promise<unknown> {
  const read = await queueOf(h);
  return read.waitingAnswer.find(card => card.source.kind === 'goal_cause'
    && card.source.key.includes('interrupted_pending_resume'));
}

async function driverRead(h: HostScenario): Promise<string> {
  const body = await h.post<{ status: string }>('workflow/driver-read', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
  return body.status;
}

it('SMK3B-1 (ask): the restart records the Goal, lists it and its card, and a driver start clears it', async () => {
  const h = await dGoal('smk3b-1');
  const calls = h.modelCalls();
  const first = await h.restart();
  const entry = entryOf(first);
  expect(entry).toMatchObject({ status: 'recorded', close: 'clean' });
  expect(entry.taskIds).toEqual(expect.arrayContaining([T1, T2]));
  expect(first.report?.redriveGoals).toEqual([]);
  expect(await driverRead(h)).toBe('not_found');
  expect(h.modelCalls(), 'the reconcile calls no model').toBe(calls);
  const display = await h.goalDisplay();
  expect(display.phase).toBe('NEEDS_DECISION');
  expect(display.causes).toContainEqual(expect.objectContaining({ code: 'interrupted_pending_resume' }));
  expect(await interruptionCard(h)).toBeDefined();
  expect(display.cause).toMatchObject({ code: 'interrupted_pending_resume',
    interruption: { ref: { aggregateType: 'GoalInterruption', projectId: AG2B_SCOPE.projectId,
      goalId: AG2B_GOAL_REF.goalId }, revision: 1 } });
  const pin = (display.cause as { interruption?: unknown }).interruption;

  const second = await h.restart();
  expect(entryOf(second)).toMatchObject({ status: 'kept', close: 'clean' });
  const kept = await h.goalDisplay();
  expect(kept.cause).toMatchObject({ code: 'interrupted_pending_resume', interruption: pin });

  const started = h.modelCalls();
  expect((await h.post<{ status: string }>('workflow/driver-start', plain(AG2B_SCOPE,
    { advance: h.select('smk3b-1-driver'), queryProfileIds: [] }))).status).toBe('ready');
  await waitFor(async () => h.modelCalls(), calls => calls > started, 'the work to start after the driver start');
  expect((await h.goalDisplay()).causes).not.toContainEqual(expect.objectContaining({ code: 'interrupted_pending_resume' }));
}, 240_000);

it('SMK3B-2 (auto): the restart drives the Goal without a record and leaves no cause', async () => {
  const h = await dGoal('smk3b-2');
  const report = await h.restart({ automation: AUTO });
  expect(entryOf(report)).toMatchObject({ status: 'driven', close: 'clean' });
  expect(await driverRead(h)).toBe('ready');
  expect((await h.goalDisplay()).causes).not.toContainEqual(expect.objectContaining({ code: 'interrupted_pending_resume' }));
}, 240_000);

it('SMK3B-3 (off): the restart records the Goal and its card but starts no driver', async () => {
  const h = await dGoal('smk3b-3');
  const report = await h.restart({ automation: OFF });
  expect(entryOf(report)).toMatchObject({ status: 'recorded', close: 'clean' });
  expect(await driverRead(h)).toBe('not_found');
  const display = await h.goalDisplay();
  expect(display.phase).toBe('NEEDS_DECISION');
  expect(display.causes).toContainEqual(expect.objectContaining({ code: 'interrupted_pending_resume' }));
  expect(await interruptionCard(h)).toBeDefined();
}, 240_000);

it('SMK3B-6 (HL-03): the record and the Goal cause read the stale lock as unclean', async () => {
  const h = await dGoal('smk3b-6');
  const report = await h.restart({ staleLock: true });
  expect(entryOf(report)).toMatchObject({ status: 'recorded', close: 'unclean' });
  expect((await h.goalDisplay()).cause).toMatchObject({ code: 'interrupted_pending_resume', close: 'unclean' });
}, 240_000);
