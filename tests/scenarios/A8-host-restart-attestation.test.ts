/**
 * A.2 step 6 closeout, lead decision LA-8 (docs/refactor/STATE-MACHINES-SPEC.md §6 RUN-22, §8 QRR-06, §6.1
 * contract (d), §12.10 step 4, §1.2): the two attestation owners, called directly. The idempotency fingerprint
 * of an attestation covers only the request (the target, the reason, the pin), not the Kernel facts the Host
 * entry reads before it (`kernelTurnOpen`, `inputsConfirmed`). So a retry under the same identity gets the
 * original receipt and writes nothing even when the Kernel now reads the other way, and the same identity with
 * another reason is `idempotency_conflict`. The Host entry's half (it asks for the receipt after the lease check
 * and before its admission; a Host without the lease still answers `busy`) is in A8-host-restart-entry.test.ts
 * (A8-2b) and A8-host-restart-lease.test.ts (Q-05, QRR-06).
 *
 * The target is made unknown by the real start-up reconcile (W-14 and Q-05, the Kernel store moved aside); that
 * Host then closes (HL-06), and the owner on a second connection to the same ledger stands in for the next Host
 * that holds the lease. Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { join } from 'node:path';
import type { TaskExecutionRecord } from '../../src/app/core-http-types.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { createSqliteRecordBackend, type SqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import { createQueryExecution } from '../../src/core/work-graph/queries/query-execution.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import {
  AG2B_AT, claimBusyQuery, createAG2bSession, seedAG2bWorkGraph, startAG2bHost, startBusyQuery,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  deferred, moveKernelAside, publicDirectory, readExecution, readQuery, tempDir, writeStaleLock,
} from '../helpers/A2-restart-fixture.js';
import { platformRecordSchemas } from '../state/invariants.js';
import { assertInvariantsAt, cleanupScenarios, hostCtx, type InvariantTarget } from './harness.js';
import { pausedRunOnClosedHostChecked } from './support/common.js';
import { ledgerEvents } from './support/restart.js';

afterEach(cleanupScenarios);

/** The Host instance the owners run under: it holds the lease (the Host that reconciled has closed). */
const OWNER_HOST = { hostInstanceId: 'a8-attestation-owner-host', lease: 'owned' as const };

/** A second connection to the scenario's ledger, closed by the caller. */
function ownerBackend(database: string): SqliteRecordBackend {
  // K3: the RUN-22 owner writes the UnknownCallReview record; the shared
  // platform set already registers its schemas (I-23), so add nothing twice.
  return createSqliteRecordBackend({ schemas: platformRecordSchemas(),
    path: join(database, 'ledger.sqlite') });
}

function ownerIds(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}-${String(++next)}`;
}

it('RUN-22 (LA-8): the owner answers a same-identity attestation retry with the original receipt whatever the Kernel reads now; another reason is idempotency_conflict', async () => {
  const root = await tempDir('a8-attest-owner-ws-');
  const database = await tempDir('a8-attest-owner-db-');
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  const { runRef } = await pausedRunOnClosedHostChecked(root, database, publicDir, inv);
  await moveKernelAside(database);
  let unknown: TaskExecutionRecord | undefined;
  const restarted = await startAG2bHost(publicDir, { root, database });
  try {
    expect(restarted.host.reconcile).toMatchObject({ report: { runs: [{ ref: JSON.stringify(runRef), row: 'W-14',
      status: 'reconciled', reason: 'unknown' }] } });
    unknown = await readExecution(restarted, runRef);
  } finally {
    await restarted.host.close();
  }
  expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });

  const backend = ownerBackend(database);
  try {
    const records = backend.records;
    const reads = createRunStateReader({ records });
    const owner = createRunReconcileService({ records, reads, hostInstance: OWNER_HOST, now: () => AG2B_AT,
      eventId: ownerIds('a8-attest-owner-event') });
    const pin = [{ ref: runRef, revision: unknown.run.revision }];
    // K3 §5.3: the attestation now carries the owner's review draft.
    const attestWorkspace = { status: 'unavailable' as const, runBaselineKnown: false,
      reason: 'not_configured' as const, detail: 'a8-attestation-owner' };
    const incompleteDraft = { inventory: 'incomplete' as const, inventoryProblem: 'kernel_unreadable' as const,
      items: [], itemsOmitted: 0, workspace: attestWorkspace };
    const completeDraft = { inventory: 'complete' as const, inventoryProblem: null,
      items: [], itemsOmitted: 0, workspace: attestWorkspace };
    const attest = (reason: string, kernelTurnOpen: boolean, inputsConfirmed: boolean | null,
      review: typeof incompleteDraft | typeof completeDraft) => owner.resolveUnknownRun(hostCtx(),
      { input: { runRef, reason, kernelTurnOpen, inputsConfirmed, review }, meta: { requestId: 'a8-attest-owner', expected: pin } });
    const reason = 'checked the workspace by hand: nothing was written';

    // The facts one way: the Kernel unreadable, so the Turn counts as open and no input is confirmed (contract (d)).
    const committed = await attest(reason, true, null, incompleteDraft);
    expect(committed).toMatchObject({ status: 'committed', replayed: false, value: { status: 'ended', outcome: 'crashed' } });
    await assertInvariantsAt(inv, 'RUN-22 attested by the owner');
    const attested = await reads.readExecution(hostCtx(), runRef);
    expect(attested).toMatchObject({ status: 'ready', value: { session: { occupancy: null, health: 'unavailable',
      healthConclusion: 'kernel_turn_open' } } });
    const events = ledgerEvents(database);

    // The other way: the same identity with the Turn read as ended and the inputs confirmed gets the original receipt.
    expect(await attest(reason, false, true, completeDraft)).toEqual({ ...committed, replayed: true });
    // §1.2: the same identity with another reason.
    expect(await attest('another reason', true, null, incompleteDraft)).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(ledgerEvents(database), 'neither retry writes').toBe(events);
    expect(await reads.readExecution(hostCtx(), runRef)).toEqual(attested);
  } finally {
    await backend.close();
  }
}, 180_000);

it('QRR-06 (LA-8): the owner answers a same-identity QueryRun attestation retry with the original receipt whatever the Kernel reads now; another reason is idempotency_conflict', async () => {
  const root = await tempDir('a8-attest-owner-query-ws-');
  const database = await tempDir('a8-attest-owner-query-db-');
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  const reached = deferred();
  const hold = deferred();
  // The crashed Host keeps its model call held until the end (as Q-05 in A8-host-restart-lease.test.ts).
  const crashed = await startAG2bHost(publicDir, { root, database, queryReplies: [{ kind: 'text', text: 'never answered' }],
    queryBeforeReply: async () => { reached.resolve(); await hold.promise; } });
  let inFlight: Promise<unknown> = Promise.resolve();
  try {
    await seedAG2bWorkGraph(crashed);
    const session = await createAG2bSession(crashed, 'a8-attest-owner-query-session');
    const refs = await claimBusyQuery(crashed, session, 'a8-owner');
    inFlight = startBusyQuery(crashed, refs, 'a8-owner').catch(() => undefined);
    await reached.promise;
    await writeStaleLock(database);
    await moveKernelAside(database);
    let unknown: QueryJobRecord | undefined;
    const restarted = await startAG2bHost(publicDir, { root, database });
    try {
      expect(restarted.host.reconcile).toMatchObject({ report: { queries: [{ ref: JSON.stringify(refs.queryRunRef), row: 'Q-05',
        status: 'reconciled' }] } });
      unknown = await readQuery(restarted, refs.queryJobRef);
    } finally {
      await restarted.host.close();
    }
    expect(unknown.run.run.executionState).toMatchObject({ phase: 'unknown' });

    const backend = ownerBackend(database);
    const bodies = createSqliteRawArtifactStore(join(database, 'artifacts.sqlite'));
    try {
      const records = backend.records;
      const eventId = ownerIds('a8-attest-owner-query-event');
      const owner = createQueryExecution({ records, roles: createRoleConfigurationService({ records, now: () => AG2B_AT, eventId }),
        bodies, now: () => AG2B_AT, eventId, hostInstance: OWNER_HOST,
        authorizeConfiguration: async () => ({ status: 'rejected', code: 'unsupported', reason: 'an attestation authorizes no configuration' }) });
      const pin = [{ ref: refs.queryRunRef, revision: unknown.run.revision }];
      const attest = (reason: string, kernelTurnOpen: boolean, inputsConfirmed: boolean | null) => owner.resolveUnknownQueryRun!(hostCtx(),
        { input: { queryRunRef: refs.queryRunRef, reason, kernelTurnOpen, inputsConfirmed },
          meta: { requestId: 'a8-attest-owner-query', expected: pin } });
      const reason = 'the consultation was answered by hand';

      // The facts one way: the Kernel unreadable, so the Turn counts as open and no input is confirmed.
      const committed = await attest(reason, true, null);
      expect(committed).toMatchObject({ status: 'committed', replayed: false, value: {
        run: { run: { status: 'closed', outcome: 'failed', executionState: { phase: 'settled' } } },
        session: { occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' } } });
      await assertInvariantsAt(inv, 'QRR-06 attested by the owner');
      const events = ledgerEvents(database);

      // The other way: the same identity with the Turn read as ended and the inputs confirmed gets the original receipt.
      expect(await attest(reason, false, true)).toEqual({ ...committed, replayed: true });
      // §1.2: the same identity with another reason.
      expect(await attest('another reason', true, null)).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
      expect(ledgerEvents(database), 'neither retry writes').toBe(events);
    } finally {
      await bodies.close();
      await backend.close();
    }
  } finally {
    hold.reject(new Error('A8 attestation: the crashed Host never answers this request'));
    await inFlight;
    await crashed.host.close();
  }
}, 180_000);
