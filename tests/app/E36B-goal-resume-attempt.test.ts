/**
 * E3-6B B1-4: a GOAL-29 resume continues a fan-out-paused Run through a `GOAL_FAN_OUT_ACTOR` TaskRequeue with
 * `goal_resume`; the continuation's run bar opens the next attempt and names the paused interruption. The A7-G4
 * Host world (a real pause, crash and resume) over HTTP; scripted model replies only.
 */
import { afterEach, expect, it } from 'vitest';
import type { SessionRef } from '../../src/app/core-http-types.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { TrackBarsPageV1 } from '../../src/core/work-graph/views/track-read-model.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution } from '../helpers/A2-restart-fixture.js';
import { cleanupScenarios, openHostScenario, type HostScenario } from '../scenarios/harness.js';
import { NO_REDRIVE, readCall, selectedRun } from '../scenarios/support/common.js';
import { goalControlled } from '../scenarios/support/control.js';

afterEach(cleanupScenarios);

it('E36B B1-4: a Goal-resume continuation is the next attempt and reports a paused goal_resume requeue', async () => {
  const RUN0 = 'e36b-resume-run0';
  let h: HostScenario | undefined;
  const scenario = await openHostScenario({ automation: NO_REDRIVE, check: 'pass', workIds: [RUN0, AG2B_WORK_TASK_ID],
    lineTaskIds: [RUN0], script: {
      replies: [readCall('e36b-resume-run0'), { kind: 'text', text: 'E36B: Run0 completed' },
        readCall('e36b-resume-paused'), { kind: 'text', text: 'E36B: the continuation answers' }],
      duringReply: async (index) => {
        if (index !== 2 || h === undefined) return;
        await goalControlled(h.host, 'pause', 'e36b-resume-pause');
      } } });
  h = scenario;
  await scenario.advance(scenario.select('e36b-resume-run0', RUN0));
  const run0 = await readExecution(scenario.host, await selectedRun(scenario, RUN0));
  const s1: SessionRef = { projectId: run0.session.ref.projectId, sessionId: run0.session.ref.sessionId };
  expect((await scenario.advance({ ...scenario.select('e36b-resume-run1', AG2B_WORK_TASK_ID), sessionHint: s1 })).state)
    .toBe('waiting');
  const pausedRef = await selectedRun(scenario);
  await scenario.restart({ crash: true });
  const resumed = await goalControlled(scenario.host, 'resume', 'e36b-resume-resume');
  expect(resumed.fanOut).toMatchObject({ control: 'resume', continuations: [
    { taskId: AG2B_WORK_TASK_ID, afterRunRef: pausedRef, outcome: 'requeued' }] });
  expect((await scenario.advance(scenario.select('e36b-resume-continue'))).state).toBe('completed');
  const continuedRef = await selectedRun(scenario);

  const track = await scenario.post<ReadResult<TrackBarsPageV1>>('activity/track', plain(AG2B_SCOPE, {
    goalRef: AG2B_GOAL_REF, from: '2026-01-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z', cursor: null, limit: 50 }));
  if (track.status !== 'ready') throw new Error(`activity/track was not ready: ${JSON.stringify(track)}`);
  const bars = track.value.bars.filter((bar) => bar.kind === 'run' && bar.taskId === AG2B_WORK_TASK_ID);
  const pausedBar = bars.find((bar) => bar.kind === 'run' && bar.runRef.runId === pausedRef.runId);
  const continuedBar = bars.find((bar) => bar.kind === 'run' && bar.runRef.runId === continuedRef.runId);
  expect(pausedBar).toMatchObject({ kind: 'run', attempt: { ordinal: 1 } });
  expect(continuedBar).toMatchObject({ kind: 'run', attempt: { ordinal: 2, requeue: {
    actorClass: 'system', goalResume: true, interruption: 'paused' } } });
}, 180_000);
