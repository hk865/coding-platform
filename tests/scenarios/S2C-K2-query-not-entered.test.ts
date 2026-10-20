/**
 * Slice 2C row 2C-41 (LE4, L12, §0.2): an `entering → not_entered` QueryRun appears
 * in the line's `executions` section with the record's own phase and
 * `outcome: 'not_entered'`, and `startedAt` keeps the moment written at
 * `entering`; a Query closed before `entering` has `startedAt: null`. The
 * `not_entered` status is produced by the real start-up reconcile after a crash,
 * never written directly.
 *
 * Entry LE4: `openHostScenario`, `restart({ crash: true })`, the real
 * `queries/submit`, `queries/claim`, `queries/prepare`, `queries/start` routes and
 * `lines/page` (`executions`). Expected values are §0.2 and L12.
 */
import { afterEach, expect, it } from 'vitest';
import { cleanupScenarios, openHostScenario, performs } from './harness.js';
import {
  AG2B_CONSUMER_ID, AG2B_SCOPE, claimBusyQuery, createAG2bSession, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { claimQueryOn, moveKernelAside, readExecution } from '../helpers/A2-restart-fixture.js';
import { lineSection, ready } from '../helpers/S2C-K-scenario-support.js';
import { putKernelBack } from './support/common.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { LineExecutionItemV1, WorkLineSectionPageV1 } from '../../src/contracts/work-line.js';

afterEach(cleanupScenarios);

/** The Query execution item of one QueryRun in an `executions` section page. */
function queryItem(page: WorkLineSectionPageV1, queryRunId: string): Extract<LineExecutionItemV1, { kind: 'query' }> {
  if (page.section !== 'executions') throw new Error(`an executions page was expected, got ${page.section}`);
  const item = page.items.find((candidate): candidate is Extract<LineExecutionItemV1, { kind: 'query' }> =>
    candidate.kind === 'query' && candidate.queryRunRef.runId === queryRunId);
  if (item === undefined) throw new Error(`no query item ${queryRunId} in the executions section`);
  return item;
}

it('2C-41 a Query reconciled entering -> not_entered keeps the entering startedAt, and one closed before entering stays null', async () => {
  const h = await openHostScenario({ script: { replies: [{ kind: 'text', text: '2C-41: the Run completes and the boundary is written' }] } });
  // One completed Work Turn gives the session a completed history boundary (no check is run).
  await h.advance(h.select('s2c41-run', 'ag2b-work'), { stopBefore: performs('run_check') });
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const s1 = (await readExecution(h.host, runRef)).session;
  expect(s1.historyCursor, 'the completed Turn leaves a boundary').not.toBeNull();

  // Session A: a Query claimed and never prepared: it is closed `not_entered` from `claimed`, before entering.
  const sessionA = await createAG2bSession(h.host, 's2c41-a');
  const claimedOnly = await claimBusyQuery(h.host, sessionA, 's2c41a');
  // On S1: a Query whose begin committed (`entering`) while the Kernel boundary was unreadable.
  const entering = await claimQueryOn(h.host, s1, 's2c41b');
  expect(entering.claim).toMatchObject({ status: 'committed' });
  const prepared = await h.post<ReadResult<unknown>>('queries/prepare', plain(AG2B_SCOPE, { queryRunRef: entering.queryRunRef,
    requestId: 's2c41b-prepare' }));
  expect(prepared.status).toBe('ready');
  const aside = await moveKernelAside(h.database);
  const begun = await h.answer('queries/start', plain(AG2B_SCOPE, { prepared: (prepared as { value: unknown }).value,
    consumerId: AG2B_CONSUMER_ID, requestId: 's2c41b-start' }));
  expect(begun).toMatchObject({ status: 'rejected' });
  await putKernelBack(h.database, aside);

  // The crash and reconcile close both as `not_entered` (Q-01 / Q-02), never written directly.
  await h.restart({ crash: true });

  const pageA = ready(await lineSection(h, sessionA.sessionRef, 'executions', { limit: 10 }), 'lines/page A executions');
  const itemA = queryItem(pageA, claimedOnly.queryRunRef.runId);
  expect(itemA).toMatchObject({ phase: 'settled', outcome: 'not_entered', startedAt: null });

  const s1Key: SessionRef = { projectId: s1.ref.projectId, sessionId: s1.ref.sessionId };
  const pageS1 = ready(await lineSection(h, s1Key, 'executions', { limit: 10 }), 'lines/page S1 executions');
  const itemB = queryItem(pageS1, entering.queryRunRef.runId);
  expect(itemB).toMatchObject({ phase: 'settled', outcome: 'not_entered' });
  expect(itemB.startedAt, 'the entering moment is kept, not null').toEqual(expect.any(String));
  if (pageS1.section !== 'executions') throw new Error('an executions page was expected');
  expect(pageS1.scope).toBe('indexed');

  // The read is stable: the same section read again keeps the entering moment.
  const again = ready(await lineSection(h, s1Key, 'executions', { limit: 10 }), 'lines/page S1 again');
  expect(queryItem(again, entering.queryRunRef.runId).startedAt).toBe(itemB.startedAt);
}, 240_000);
