/**
 * L16: the Query activity the recovery write paths record, read through the public `activity/queries`
 * route.
 *
 * Every row starts from the real Host and the Host's own request driver, and reaches the recovery path
 * with public steps only: the scripted model, the fixture's gates, a crash that abandons the old Host
 * and a new Host on the same SQLite directory. The QueryRunRef each row reads is the one `queries/read`
 * returns; nothing here reads or writes the record store.
 *
 * - QRR-01: an attempt whose claim committed and whose prepared commit was held when the Host was
 *   abandoned is recovered by the next Host; the old attempt reads `not_entered`, never a zero tally.
 * - QRR-03: the Runtime's terminal observation is held at the store boundary while the Host is
 *   abandoned. The next Host's start-up reconcile books the Kernel's own terminal, so the round's
 *   activity is recorded once, in that commit, with the whole Turn's tally; releasing the old held
 *   commit afterwards replays or conflicts and never writes a second time.
 * - QRR-04: a Turn interrupted mid-model-request (every tool call has its result) is closed by the
 *   reconcile's observation bound; its activity is the tally of the records the reconcile already read
 *   and does not count through the Turn's end.
 * - QRR-06: a Turn whose tool call has no result reads `unknown`; the person's attestation closes it and
 *   writes the activity of the Turn the Host read, with the unresolved call still counted. The one
 *   QRR-06 write path no public step can reach (a missing/damaged Kernel store) is a write-plan row in
 *   `tests/work-graph/S6A-query-activity-read-recovery-pure.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';
import type { QueryActivityViewV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

// The frozen commit barrier (tests/helpers/S6A-commit-barrier.ts): the two `vi.mock`s every host-world
// file that uses the fixture's gates installs.
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

/** A semantic answer body: the v2 answer format's JSON, as the scripted model writes it. */
const answerText = (text: string): string =>
  JSON.stringify({ schemaVersion: 1, body: text, ideas: [], goalCardDrafts: [] });

function queued(result: RequestSubmitResultV1): { requestRoot: QueryJobRef; round: QueryJobRef } {
  if (result.status !== 'queued') throw new Error(`S6A: the request was not queued: ${JSON.stringify(result)}`);
  return { requestRoot: result.requestRoot, round: result.round };
}

/** The Query activity of one QueryRun through the public route; a refusal is named, never an empty read. */
async function readActivity(world: S6AHostWorld, queryRunRef: QueryRunRef): Promise<QueryActivityViewV1[]> {
  const posted = await world.post('activity/queries', { scope: S6A_SCOPE, input: { refs: [queryRunRef] } });
  if (posted.httpStatus !== 200) {
    throw new Error(`S6A: activity/queries answered ${posted.httpStatus}: ${JSON.stringify(posted.body)}`);
  }
  const body = posted.body as ReadResult<QueryActivityViewV1[]>;
  if (body.status !== 'ready') throw new Error(`S6A: activity/queries was not ready: ${JSON.stringify(body)}`);
  return body.value;
}

describe('the Query activity of the recovery write paths', () => {
  it('QRR-01 (SQLite only): an attempt claimed and not prepared when the Host crashed reads not_entered',
    async () => {
      const world = remember(await openS6AHostWorld({ backend: 'sqlite', extraHostOptions: { requestDriver: 'on' } }));
      await ensureProjectPointers(world);
      const a = await world.createSecretary('a');
      await world.setResumeOnStartup(true);
      // The claim commit lands; the prepared commit is held, so the attempt is
      // claimed and has not entered the Kernel when the Host is abandoned.
      const prepared = world.gates.beforePrepared(a);
      const submitted = queued(await world.submit({ commandId: 'qrr01-submit', goalId: S6A_GOAL_1.goalId,
        text: 'QRR-01 request', recipient: a }));
      await prepared.reached;
      const claimed = await readQuery(world.ag2b, submitted.round);
      expect(claimed.run.run.executionState).toMatchObject({ phase: 'claimed' });
      // The claimed attempt's own ref: the restarted Host recovers it and starts a
      // new attempt on the same round, so the Job points at that one from here on.
      const old = claimed.run.ref;
      await world.crash({ extraHostOptions: { requestDriver: 'on' } });
      const activity = await readActivity(world, old);
      expect(activity).toHaveLength(1);
      expect(activity[0]).toMatchObject({
        queryRunRef: old,
        status: 'not_entered', reason: null, error: false,
        totals: { steps: 0, edits: 0, editsUnknown: 0 },
        recordedBy: null, sessionRef: a.ref,
      });
      // The held prepared commit of the abandoned Host stops blocking only after the read.
      prepared.release();
    }, 120_000);

  it('QRR-03 (SQLite only): the restart books the terminal observation once and the tally counts through the Turn end',
    async () => {
      const world = remember(await openS6AHostWorld({ backend: 'sqlite', extraHostOptions: { requestDriver: 'on' } }));
      await ensureProjectPointers(world);
      const a = await world.createSecretary('a');
      await world.scripted.script(a, [
        { kind: 'calls', calls: [{ callId: 'qrr03-list-1', name: 'list_files', args: { prefix: '.' } }] },
        { kind: 'calls', calls: [{ callId: 'qrr03-list-2', name: 'list_files', args: { prefix: '.' } }] },
        { kind: 'text', text: answerText('QRR-03 answer') },
      ]);
      // The Runtime ends the round by committing its terminal observation under this identity prefix.
      const terminal = commitBarrier.hold(byIdentityPrefix('r5b-query-execution:observed:'), 'QRR-03 terminal observation');
      const submitted = queued(await world.submit({ commandId: 'qrr03-submit', goalId: S6A_GOAL_1.goalId,
        text: 'QRR-03 request', recipient: a }));
      await terminal.reached;
      // The Host is abandoned with that commit still waiting; the next Host reconciles on the same directory.
      await world.crash({ extraHostOptions: { requestDriver: 'on' } });
      const settled = await readQuery(world.ag2b, submitted.round);
      expect(settled.job.job.status).toBe('answered');
      expect(settled.job.job.closeReason).toBeNull();
      expect(settled.run.run).toMatchObject({ status: 'answered', outcome: 'answered' });
      const before = await readActivity(world, settled.run.ref);
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({
        queryRunRef: settled.run.ref,
        status: 'counted', reason: null, error: false,
        totals: { steps: 2 }, countedThroughTurnEnd: true, unresolvedCalls: 0,
        recordedBy: 'query_end', sessionRef: a.ref, askedSessionRef: null, goalId: S6A_GOAL_1.goalId,
      });
      // The old held commit replays or conflicts when it is released. The view carries no revision, so the
      // second read and the QueryRun revision prove that nothing was written a second time.
      terminal.release();
      expect(await readActivity(world, settled.run.ref)).toEqual(before);
      expect((await readQuery(world.ag2b, submitted.round)).run).toEqual(settled.run);
    }, 120_000);

  it('QRR-04 (SQLite only): the reconcile observation bound counts the one booked tool and not the open Turn end',
    async () => {
      const world = remember(await openS6AHostWorld({ backend: 'sqlite', extraHostOptions: { requestDriver: 'on' } }));
      await ensureProjectPointers(world);
      const a = await world.createSecretary('a');
      await world.scripted.script(a, [
        { kind: 'calls', calls: [{ callId: 'qrr04-list-1', name: 'list_files', args: { prefix: '.' } }] },
        { kind: 'text', text: answerText('QRR-04 answer') },
      ]);
      const first = await world.gates.modelRequest(a);
      const second = await world.gates.modelRequest(a);
      const submitted = queued(await world.submit({ commandId: 'qrr04-submit', goalId: S6A_GOAL_1.goalId,
        text: 'QRR-04 request', recipient: a }));
      await first.reached;
      first.release();
      // The second model request arrives after the tool result was booked; the Host is abandoned there, so
      // the Kernel has no terminal for the Turn.
      await second.reached;
      await world.crash({ extraHostOptions: { requestDriver: 'on' } });
      const closed = await readQuery(world.ag2b, submitted.round);
      expect(closed.job.job.status).toBe('closed');
      expect(closed.job.job.closeReason).toMatchObject({ code: 'failed', message: 'host_interrupted' });
      expect(closed.run.run).toMatchObject({ status: 'closed', outcome: 'failed',
        executionState: { phase: 'settled' } });
      const activity = await readActivity(world, closed.run.ref);
      expect(activity).toHaveLength(1);
      expect(activity[0]).toMatchObject({
        queryRunRef: closed.run.ref,
        status: 'counted', reason: null, error: false,
        totals: { steps: 1 }, countedThroughTurnEnd: false, unresolvedCalls: 0,
        recordedBy: 'query_end', sessionRef: a.ref, askedSessionRef: null, goalId: S6A_GOAL_1.goalId,
      });
    }, 120_000);

  it('QRR-06 (SQLite only): the attestation records the tally of the Turn it read, unresolved call included',
    async () => {
      const world = remember(await openS6AHostWorld({ backend: 'sqlite', extraHostOptions: { requestDriver: 'on' } }));
      await ensureProjectPointers(world);
      const a = await world.createSecretary('a');
      await world.scripted.script(a, [
        { kind: 'calls', calls: [{ callId: 'qrr06-list-1', name: 'list_files', args: { prefix: '.' } }] },
      ]);
      const tool = await world.gates.toolCall(a, 'list_files');
      const submitted = queued(await world.submit({ commandId: 'qrr06-submit', goalId: S6A_GOAL_1.goalId,
        text: 'QRR-06 request', recipient: a }));
      await tool.reached;
      // The tool call is started and has no result: the restart proves the round took the Kernel but leaves
      // it unknown, waiting for the person.
      await world.crash({ extraHostOptions: { requestDriver: 'on' } });
      const unknown = await readQuery(world.ag2b, submitted.round);
      expect(unknown.run.run.executionState).toMatchObject({ phase: 'unknown' });
      expect(unknown.run.run.endedAt).toBeNull();
      const reason = 'the round was checked by hand';
      const attested = await world.post('queries/resolve-unknown', graphWrite(S6A_SCOPE, {
        queryRunRef: unknown.run.ref, reason,
      }, 'qrr06-attest', [{ ref: unknown.run.ref, revision: unknown.run.revision }]));
      if (attested.httpStatus !== 200) {
        throw new Error(`S6A: queries/resolve-unknown answered ${attested.httpStatus}: ${JSON.stringify(attested.body)}`);
      }
      expect(attested.body).toMatchObject({ status: 'committed' });
      const closed = await readQuery(world.ag2b, submitted.round);
      expect(closed.job.job.status).toBe('closed');
      expect(closed.job.job.closeReason).toMatchObject({ code: 'failed', message: reason });
      expect(closed.run.run).toMatchObject({ status: 'closed', outcome: 'failed' });
      const activity = await readActivity(world, closed.run.ref);
      expect(activity).toHaveLength(1);
      expect(activity[0]).toMatchObject({
        queryRunRef: closed.run.ref,
        status: 'counted', reason: null, error: false,
        totals: { steps: 1 }, countedThroughTurnEnd: false, unresolvedCalls: 1,
        recordedBy: 'query_end', sessionRef: a.ref, askedSessionRef: null, goalId: S6A_GOAL_1.goalId,
      });
      // The held tool stops blocking only after the reads it must not change.
      tool.release();
    }, 120_000);
});
