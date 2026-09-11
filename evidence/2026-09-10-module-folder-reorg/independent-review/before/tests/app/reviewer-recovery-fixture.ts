import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { independentReviewFixture } from './independent-review-fixture.js';
import { buildAcquireWriteLeaseCommand, buildReleaseLeaseCommand } from '../../src/contracts/commands/workspace.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { StateLedger } from '../../src/contracts/ledger.js';
import type { WorkspaceLeasePort } from '../../src/contracts/workspace-lease.js';
import type { WorkspaceCapabilityPort } from '../../src/contracts/workspace-capability.js';
import type { ReviewRequestResult, ReviewRequestView } from '../../src/contracts/reviewer-verification.js';

type Factory = Parameters<typeof independentReviewFixture>[1];
type Options = Parameters<typeof independentReviewFixture>[2];

/** Real HTTP/SQLite/runtime/material execution; only the remote model protocol
 * is substituted. A separate Control lease port creates the actual conflict. */
export async function reviewerRecoveryFixture(cleanup: Array<() => Promise<void>>, createApplication: Factory, options: Options = {}) {
  const f = await independentReviewFixture(cleanup, createApplication, options);
  const ledgerPath = join(f.data, 'projects', encodeURIComponent(f.scope.projectId), 'ledger.sqlite');
  const snapshots = <T = Record<string, unknown>>(type: string): T[] => {
    const db = new DatabaseSync(ledgerPath, { readOnly: true });
    try {
      return db.prepare("SELECT snapshot_json FROM snapshots WHERE json_extract(snapshot_json, '$.ref.aggregateType') = ? ORDER BY ref_key")
        .all(type).map(row => JSON.parse(row['snapshot_json'] as string) as T);
    } finally { db.close(); }
  };
  let releaseConflict: (() => Promise<void>) | undefined;
  const holdConflict = async () => {
    if (releaseConflict) throw Error('Conflict already held');
    // Browser tests compile with the UI's stricter settings. Load the current
    // build at runtime so this shared fixture does not pull every backend
    // implementation into that unrelated TypeScript program.
    const { SqliteStateLedger } = await import(new URL('../../dist/sqlite-ledger/sqlite-ledger.js', import.meta.url).href) as {
      SqliteStateLedger: new (options: { path: string }) => StateLedger & { close(): void };
    };
    const { WorkspaceLeaseEngineImpl } = await import(new URL('../../dist/control/workspace-lease.js', import.meta.url).href) as {
      WorkspaceLeaseEngineImpl: new (deps: { ledger: StateLedger; now(): string; eventId(): string; workspaceCapability: WorkspaceCapabilityPort }) => WorkspaceLeasePort;
    };
    const { ConfiguredWorkspaceCapabilityPolicy } = await import(new URL('../../dist/control/policies/workspace-capability.js', import.meta.url).href) as {
      ConfiguredWorkspaceCapabilityPolicy: new (support: { workspaceRead: boolean; workspaceWrite: boolean; maxWriteScope: null }) => WorkspaceCapabilityPort;
    };
    const ledger = new SqliteStateLedger({ path: ledgerPath });
    try {
      const loaded = await ledger.load({ aggregateType: 'Run', projectId: f.scope.projectId, goalId: f.scope.goalId, runId: f.runId });
      if (loaded.status !== 'found') throw Error('Producer canonical Run missing');
      const run = loaded.snapshot as RunSnapshot, envelope = run.envelope;
      if (!envelope) throw Error('Producer permissions missing');
      const workspace = await ledger.load({ aggregateType: 'Workspace', projectId: f.scope.projectId, workspaceId: f.scope.workspaceId });
      if (workspace.status !== 'found') throw Error('Workspace missing');
      const leaseId = 'recovery-conflict-' + randomUUID();
      const leasePort = () => new WorkspaceLeaseEngineImpl({ ledger, now: () => new Date().toISOString(), eventId: () => randomUUID(),
        workspaceCapability: new ConfiguredWorkspaceCapabilityPolicy({ workspaceRead: true, workspaceWrite: true, maxWriteScope: null }) });
      const acquired = await leasePort().acquireWriteLease(buildAcquireWriteLeaseCommand({ commandId: leaseId, correlationId: leaseId,
        actor: { kind: 'system', id: 'recovery-concurrent-writer' }, idempotencyKey: leaseId, ...f.scope,
        leaseId, scope: { schemaVersion: 1, projectId: f.scope.projectId, workspaceId: f.scope.workspaceId, kind: 'workspace',
          id: f.scope.workspaceId, revision: workspace.snapshot.revision },
        holder: { runRef: run.ref, attemptRef: envelope.attemptRef, roleBinding: envelope.roleBinding },
        declaredWriteScope: envelope.permissions.writeScope, expiresAt: null, submittedAt: new Date().toISOString() }));
      if (acquired.status !== 'committed') throw Error('Real conflict acquisition refused: ' + JSON.stringify(acquired));
      releaseConflict = async () => {
        const releaseId = randomUUID();
        const released = await leasePort().releaseLease(buildReleaseLeaseCommand({ commandId: releaseId, correlationId: releaseId,
          actor: { kind: 'system', id: 'recovery-concurrent-writer' }, idempotencyKey: releaseId, ...f.scope,
          leaseId, kind: 'write', holderRunRef: run.ref, submittedAt: new Date().toISOString() }));
        if (released.status !== 'committed') throw Error('Real conflict release refused: ' + JSON.stringify(released));
        releaseConflict = undefined;
        ledger.close();
      };
    } catch (error) { ledger.close(); throw error; }
  };
  cleanup.push(async () => { await releaseConflict?.(); });
  const poll = async <T>(read: () => Promise<T>, done: (value: T) => boolean, label: string): Promise<T> => {
    const deadline = Date.now() + 30000;
    for (;;) {
      const value = await read();
      if (done(value)) return value;
      if (Date.now() >= deadline) throw Error(label + ': ' + JSON.stringify(value));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };
  const waitForFailed = async (requestId = 'independent') => {
    const view = await poll(async () => (await f.read(requestId)).body,
      value => !!value.work && snapshots<RunSnapshot>('Run').some(run => run.ref.runId === value.work!.reviewerRunRef.runId && run.status === 'ended'),
      'Reviewer did not persist its terminal Run');
    const run = snapshots<RunSnapshot>('Run').find(run => run.ref.runId === view.work!.reviewerRunRef.runId)!;
    const record = (await f.state()).liveRuns.find(run => run.spec.runId === view.work!.reviewerRunRef.runId);
    if (run.outcome !== 'crashed' || record?.status !== 'failed' || f.reviewerRequests.length !== 0)
      throw Error('Conflict was not a known pre-start failure: ' + JSON.stringify({ run, record, requests: f.reviewerRequests.length }));
    return view;
  };
  const recoverInput = (requestId = 'recovery', previousRequestId = 'independent', reason = 'Explicitly authorize the Reviewer after the conflicting writer released its lease') =>
    ({ ...f.reviewScope, requestId, previousRequestId, allowExecute: true as const, reason });
  const recover = (requestId = 'recovery', previousRequestId = 'independent', reason?: string) =>
    f.post<ReviewRequestResult>('/api/real/verifications/reviews/recover', recoverInput(requestId, previousRequestId, reason));
  const settle = (requestId = 'recovery'): Promise<ReviewRequestView> => poll(async () => (await f.read(requestId)).body,
    value => ['settled', 'assessment_rejected', 'work_rejected'].includes(value.phase), 'Reviewer recovery did not settle');
  return { ...f, snapshots, holdConflict, releaseConflict: async () => { await releaseConflict?.(); }, waitForFailed, recoverInput, recover, settle };
}
