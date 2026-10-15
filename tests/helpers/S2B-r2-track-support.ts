/**
 * Round 2 (R3/R4/R7) track-read support.
 *
 * The bounded-read test needs more Runs than the page it reads, so
 * `seedRealTrackRuns` builds a small set of REAL Runs through the public
 * fixture flow (one per track work task). A page of two then discriminates
 * under a low injected `readRecordCap`: reading only the page's two Runs stays
 * inside the cap, while any reader that scanned the whole window would charge
 * at least one index read per Run and exceed it. Every assertion reads through
 * the public `readTrackBars`; expected values are hand literals.
 */
import { TRACK_WORK_TASK_IDS, type S2BTrackFixture } from './S2B-track-fixture.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { RunRef } from '../../src/contracts/dispatch.js';

const RUN_SCHEMA_ID = 'RunSnapshot@1';

/** The full 2026-10-14 UTC day, a quarter-aligned window. */
export const R2_DAY_FROM = '2026-10-14T00:00:00.000Z';
export const R2_DAY_TO = '2026-10-15T00:00:00.000Z';

/**
 * Creates `count` REAL Runs through the public fixture flow, one per track work
 * task, each ending 20 s after the previous from `2026-10-14T09:00:00.000Z`.
 * Returns the Run ids in `endedAt` order (the order `s2b-run-by-goal-ended`
 * emits them).
 */
export async function seedRealTrackRuns(fixture: S2BTrackFixture, count: number): Promise<string[]> {
  const baseMs = Date.parse('2026-10-14T09:00:00.000Z');
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const taskId = TRACK_WORK_TASK_IDS[index];
    if (taskId === undefined) throw new Error(`S2B-r2 real run seed has no task at index ${String(index)}`);
    const endedMs = baseMs + index * 20_000;
    const run = await fixture.runAndEnd(taskId, fixture.computeSessionRef(),
      new Date(endedMs - 10_000).toISOString(), new Date(endedMs).toISOString());
    ids.push(run.runId);
  }
  return ids;
}

/**
 * Commits one ended Run cloned from a real Run with the caller's `mutate`
 * applied, for the R5 classification cases no production flow can produce
 * (a V1 authorization, or a position record with no authorization). The clone
 * keeps the template's Plan/workspace/terminal shape.
 */
export async function seedRawRunVariant(
  fixture: S2BTrackFixture,
  input: { taskId: string; runId: string; startedAt: string; endedAt: string;
    mutate(body: Record<string, unknown>): void },
): Promise<RunRef> {
  const template = await fixture.runAndEnd('work-2', fixture.computeSessionRef(),
    '2026-10-14T06:00:00.000Z', '2026-10-14T06:10:00.000Z');
  const templateKey = canonicalJson(template as unknown as JsonValue);
  const read = await fixture.records.readMany([templateKey]);
  if (read.status !== 'ready') throw new Error(`S2B-r2 raw variant read failed: ${JSON.stringify(read)}`);
  const record = read.value.records.find((candidate) => candidate.refKey === templateKey);
  if (record === undefined) throw new Error('S2B-r2 raw variant template is missing');
  const body = JSON.parse(record.json) as Record<string, unknown>;
  const ref = { ...(body['ref'] as RunRef), runId: input.runId };
  body['ref'] = ref;
  body['task'] = { ...(body['task'] as Record<string, unknown>), taskId: input.taskId };
  body['attemptId'] = `${input.runId}-attempt`;
  body['revision'] = 1;
  body['startedAt'] = input.startedAt;
  body['endedAt'] = input.endedAt;
  delete body['requeueRef'];
  delete body['consumedWait'];
  delete body['controlState'];
  delete body['reconciliation'];
  delete body['continuation'];
  input.mutate(body);
  const refKey = canonicalJson(ref as unknown as JsonValue);
  const committed = await fixture.b2.base.commitRaw([
    { refKey, schemaId: RUN_SCHEMA_ID, revision: 1, json: JSON.stringify(body) },
  ]);
  if (committed.status !== 'committed') {
    throw new Error(`S2B-r2 raw variant commit failed: ${JSON.stringify(committed)}`);
  }
  return ref;
}
