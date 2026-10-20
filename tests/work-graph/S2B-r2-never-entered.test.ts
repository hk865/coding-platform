/**
 * Slice 2B round-2 R5: the one exact L7 "never entered" predicate. A position
 * record never proves non-entry, and an active
 * `starting`/`running` Run is always incomplete in the executed-files read.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RunExecutionHistoryV1 } from '../../src/contracts/core/execution-history.js';
import { openS2BActivityFixture, type S2BActivityFixture } from '../helpers/S2B-activity-fixture.js';
import {
  activityGoalExecutedFiles, authorizeOnlyRun, seedActivityRun,
} from '../helpers/S2B-r2-activity-support.js';

const opened: S2BActivityFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

async function open(kind: 'memory' | 'sqlite'): Promise<S2BActivityFixture> {
  const fixture = await openS2BActivityFixture(kind);
  opened.push(fixture);
  return fixture;
}

describe.each(['memory', 'sqlite'] as const)('S2B round-2 never-entered predicate (%s)', (kind) => {
  it('R5 a position record does not prove non-entry even under an authorized phase', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const history: RunExecutionHistoryV1 = {
      schemaVersion: 1, sessionRef: f.b2.base.sessions.second,
      kernel: { adapterId: 's2b-r2-adapter', kernelSessionId: 's2b-r2-kernel', runId: 's2b-r2-kernel-run',
        turnId: 's2b-r2-kernel-turn' },
      startPosition: 1, observedThroughPosition: 2, endPosition: null,
    };
    const run = await seedActivityRun(f, {
      taskId: 'work-1', runId: 's2b-r2-history-authorized', status: 'ended', outcome: 'failed',
      startedAt: '2026-10-14T09:00:00.000Z', endedAt: '2026-10-14T09:10:00.000Z',
      authorization: { schemaVersion: 2, generation: 1, sessionGeneration: 1, revision: 1,
        consumerId: 's2b-r2-v2-consumer', inputDigest: 'a'.repeat(64), phase: 'authorized', kernel: null },
      history,
    });

    const result = await f.readModelWith(f.records).readRunActivities(f.ctx, { runRefs: [run] });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.value[0]).toMatchObject({ status: 'unknown', reason: 'not_recorded', error: true });
    expect(result.value[0]?.status).not.toBe('not_entered');
  });

  it('R5 an authorized active (starting) Run makes the executed-files read incomplete', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const run = await authorizeOnlyRun(f, 'work-1', f.b2.base.sessions.second);

    const result = await activityGoalExecutedFiles(f).readGoalExecutedFiles(f.ctx, { goalRef: f.goalRef });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.value.availability).toBe('available');
    expect(result.value.possiblyIncomplete).toBe(true);
    expect(result.value.files).toEqual([]);
    expect(run.runId).toBeTruthy();
  });
});
