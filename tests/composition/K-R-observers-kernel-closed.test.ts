/**
 * Group R, finding 4 (spec L1, lines 43-46): a Kernel Turn that ended
 * `interrupted` while its platform Run is still live is an impossible state
 * under L4. When it happens anyway the Work and Query observers must WRITE
 * NOTHING and report it (`kernel_closed_without_platform_end`); they never
 * confirm a mailbox input, advance a locator, record an outcome or map it to an
 * answer.
 *
 * Entry (D13): a REAL live Run/Query built through the public flows (the
 * platform Workflow for Work; the Host's Query routes for Query), the real live
 * Kernel Turn closed through the public Kernel `closeOpenTurn`, then observed
 * through the real Runtime port (`platform.runtime.observeRun`, the Host's
 * public `queries/observe` route). The "writes nothing" assertions are boundary
 * instrumentation only: the harness's file write counts (the storage write
 * port). No Session/Run/requeue/platform record is fabricated and no database
 * read verifies a business result.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { closeOpenTurn, SqliteStores } from '../../vendor/coding-agent/dist/public-api.js';
import {
  AG2B_SCOPE, claimBusyQuery, createAG2bSession, plain, seedAG2bWorkGraph, startAG2bHost, startBusyQuery,
} from '../helpers/AG2b-collaboration-fixture.js';
import { deferred, post, publicDirectory, tempDir } from '../helpers/A2-restart-fixture.js';
import { cleanupScenarios, fileCounts, hostCtx, openPlatformScenario } from '../scenarios/harness.js';
import { NO_REDRIVE, readCall, textReply } from '../scenarios/support/common.js';

afterEach(cleanupScenarios);

/** Close the one real live Kernel Turn through the public seam (the Kernel store is the system boundary). */
async function closeTheLiveTurn(database: string): Promise<void> {
  const store = await SqliteStores.open(join(database, 'kernel.sqlite'));
  try {
    const signal = new AbortController().signal;
    const page = await store.list(null, 50, { signal });
    const active = page.sessions.find((session) => session.activeRunId !== null);
    if (active === undefined || active.activeRunId === null) throw new Error('no live Kernel Turn to close');
    const closed = await closeOpenTurn(store, { sessionId: active.sessionId, kernelRunId: active.activeRunId,
      expectedRevision: active.revision, at: '2026-10-06T00:01:00.000Z' });
    expect(closed, 'the live Turn must close through the public Kernel seam').toMatchObject({ status: 'closed' });
  } finally {
    await store.close();
  }
}

describe('D4 the observers report a Kernel-closed live Run without writing', () => {
  it('D4 (L1) the Work observer reports kernel_closed_without_platform_end and confirms no input or commit', async () => {
    const captured: { result: unknown } = { result: null };
    let before: ReturnType<typeof fileCounts> | null = null;
    let after: ReturnType<typeof fileCounts> | null = null;
    let scenario: Awaited<ReturnType<typeof openPlatformScenario>> | undefined;
    scenario = await openPlatformScenario({
      check: 'pass', automation: NO_REDRIVE,
      script: { replies: [readCall('krd4-work'), textReply('D4 work: never delivered')],
        duringReply: async (index) => {
          if (index !== 0 || scenario === undefined) return;
          const runRef = (await scenario.taskRow()).execution;
          if (runRef === null) throw new Error('the live Run must be selected while its Turn is open');
          await closeTheLiveTurn(scenario.database);
          before = fileCounts(scenario.database);
          captured.result = await scenario.platform.runtime.observeRun(hostCtx(), { runRef });
          after = fileCounts(scenario.database);
        } },
    });
    // The closed Turn ends the run; the drive settles `waiting` and never opens
    // the registered check (the observation already ran inside the live model
    // call), so no check process and no bubblewrap are needed.
    const driven = await scenario.advance(scenario.select('krd4-work'));
    expect(driven.state, JSON.stringify(driven.steps.map(step => [step.state, step.reason]))).toBe('waiting');
    expect(driven.receipts.map(receipt => receipt.kind)).not.toContain('run_check');

    expect(captured.result).toMatchObject({ status: 'rejected',
      reason: expect.stringContaining('kernel_closed_without_platform_end') });
    // The write port (the harness's file counts) is unchanged across the observation.
    expect(after).toEqual(before);
  }, 120_000);

  it('D4 (L1) the Query observer reports kernel_closed_without_platform_end instead of a silent ready', async () => {
    const root = await tempDir('krd4-query-ws-');
    const database = await tempDir('krd4-query-db-');
    const publicDir = await publicDirectory();
    const reached = deferred();
    const hold = deferred();
    const first = await startAG2bHost(publicDir, { root, database, queryReplies: [{ kind: 'text', text: 'D4 query: never delivered' }],
      queryBeforeReply: async () => { reached.resolve(); await hold.promise; } });
    let inFlight: Promise<unknown> = Promise.resolve();
    try {
      await seedAG2bWorkGraph(first);
      const session = await createAG2bSession(first, 'krd4-query-session');
      const refs = await claimBusyQuery(first, session, 'krd4');
      inFlight = startBusyQuery(first, refs, 'krd4').catch(() => undefined);
      await reached.promise;
      await closeTheLiveTurn(database);
      const before = fileCounts(database);
      const observed = await post(first, 'queries/observe', plain(AG2B_SCOPE, { queryRunRef: refs.queryRunRef }));
      const after = fileCounts(database);
      expect(observed).toMatchObject({ status: 'rejected',
        reason: expect.stringContaining('kernel_closed_without_platform_end') });
      expect(after).toEqual(before);
    } finally {
      hold.reject(new Error('D4 query cleanup'));
      await inFlight;
      await first.host.close().catch(() => undefined);
    }
  }, 120_000);
});
