/**
 * Slice 2B round 2, fix R5 (review item 5): the track reader uses the shared
 * `provenNotEnteredKernel`, which requires an ended Run with NO position record
 * and a V2 authorization. A V1 authorization, or a Run that has a position
 * record, must not be classified `not_entered`.
 *
 * The two states are seeded through the rule-§7 raw-commit seam because no
 * production flow emits them. Assertions read only the public `readTrackBars`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackBarsPageV1 } from '../../src/core/work-graph/views/track-read-model.js';
import { openS2BTrackFixture, type S2BTrackFixture } from '../helpers/S2B-track-fixture.js';
import { R2_DAY_FROM, R2_DAY_TO, seedRawRunVariant } from '../helpers/S2B-r2-track-support.js';

const opened: S2BTrackFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

async function open(kind: 'memory' | 'sqlite'): Promise<S2BTrackFixture> {
  const fixture = await openS2BTrackFixture(kind);
  opened.push(fixture);
  return fixture;
}

function ready(result: Awaited<ReturnType<S2BTrackFixture['readTrack']>>): TrackBarsPageV1 {
  if (result.status !== 'ready') throw new Error(`track read failed: ${JSON.stringify(result)}`);
  return result.value;
}

function runBarOf(page: TrackBarsPageV1, runId: string) {
  const bar = page.bars.find((candidate) => candidate.kind === 'run' && candidate.runRef.runId === runId);
  if (bar === undefined || bar.kind !== 'run') throw new Error(`no run bar for ${runId}`);
  return bar;
}

describe.each(['memory', 'sqlite'] as const)('S2B round 2 R5 never-entered predicate (%s)', (kind) => {
  it('2B-r2 R5 a V1 authorization does not prove non-entry', async () => {
    const f = await open(kind);
    const runRef = await seedRawRunVariant(f, {
      taskId: 'work-3', runId: 'r2-r5-v1',
      startedAt: '2026-10-14T11:00:00.000Z', endedAt: '2026-10-14T11:05:00.000Z',
      mutate: (body) => {
        body['executionAuthorization'] = { generation: 1, consumerId: 'r2-r5-v1', phase: 'authorized' };
        delete body['executionHistory'];
      },
    });

    const page = ready(await f.readTrack({ from: R2_DAY_FROM, to: R2_DAY_TO, limit: 100 }));
    const bar = runBarOf(page, runRef.runId);
    expect(bar.activity.status).toBe('unknown');
    expect(bar.activity.reason).toBe('no_recording_epoch');
    expect(bar.activity.error).toBe(false);
  });

  it('2B-r2 R5 a position record without authorization is not "never entered"', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T10:00:00.000Z');
    const runRef = await seedRawRunVariant(f, {
      taskId: 'work-3', runId: 'r2-r5-locator',
      startedAt: '2026-10-14T11:00:00.000Z', endedAt: '2026-10-14T11:05:00.000Z',
      mutate: (body) => { delete body['executionAuthorization']; },
    });

    const page = ready(await f.readTrack({ from: R2_DAY_FROM, to: R2_DAY_TO, limit: 100 }));
    const bar = runBarOf(page, runRef.runId);
    expect(bar.activity.status).toBe('unknown');
    expect(bar.activity.reason).toBe('not_recorded');
    expect(bar.activity.error).toBe(true);
  });

  it('2B-r2 R5 a V2 authorization carrying a Kernel identity does not prove non-entry', async () => {
    const f = await open(kind);
    const runRef = await seedRawRunVariant(f, {
      taskId: 'work-3', runId: 'r2-r5-v2-kernel',
      startedAt: '2026-10-14T11:00:00.000Z', endedAt: '2026-10-14T11:05:00.000Z',
      mutate: (body) => {
        const history = body['executionHistory'] as { kernel: unknown };
        body['executionAuthorization'] = {
          schemaVersion: 2, generation: 1, sessionGeneration: 1, revision: 1,
          consumerId: 'r2-r5-v2-kernel',
          inputDigest: '0000000000000000000000000000000000000000000000000000000000000000',
          phase: 'authorized', kernel: history.kernel,
        };
        delete body['executionHistory'];
      },
    });

    const page = ready(await f.readTrack({ from: R2_DAY_FROM, to: R2_DAY_TO, limit: 100 }));
    const bar = runBarOf(page, runRef.runId);
    expect(bar.activity.status).not.toBe('not_entered');
    expect(bar.activity.status).toBe('unknown');
    expect(bar.activity.reason).toBe('no_recording_epoch');
  });
});
