/**
 * Independent R3a acceptance suite maintained by the main Agent.
 * Installed from the pre-implementation staged fixture on 2026-09-23.
 * Real SQLite/legacy consumers; implementation self-checks are separate.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStateLedger } from '../../src/data/state-ledger/sqlite-ledger.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { InMemoryLedger } from '../../src/data/state-ledger/in-memory-ledger.js';
import { GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { ControlEngineImpl } from '../../src/control/control-engine/control-engine.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { buildBootstrapCommand } from '../../src/contracts/bootstrap.js';
import { commandIdentityKey } from '../../src/contracts/command-event.js';
import type { CreateGoalCommand } from '../../src/contracts/command-event.js';
import type { AggregateRef, GoalSnapshot, LedgerCommitReceipt, StateLedger, VersionedRef } from '../../src/contracts/ledger.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ControlEngine } from '../../src/contracts/modules.js';
import { buildApplyPlanCommand } from '../../src/contracts/commands/plan.js';
import { HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1 } from '../../src/fixtures/plan-fixtures.js';
import { buildInstallCommand, buildActivateCommand, COMPLETION_POLICY_FIXTURE_V1, ARCHITECTURE_BASELINE_FIXTURE_V1 } from '../../src/fixtures/governance-fixtures.js';
import { architectureBaselinePinFor, completionPolicyPinFor } from '../../src/contracts/governance.js';
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1, buildBootstrapLedgerCommit } from '../contract-support/fixtures/bootstrap-fixture-v1.js';
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand, buildGoalCreateLedgerCommit } from '../contract-support/fixtures/goal-fixtures.js';
// Exact imports follow the frozen R3a public contract.
import type { GoalRecordTransactionPort, StoreCommitReceipt } from '../../src/core/record-store/ports.js';
import type { GraphWrite, CreateGoalInput } from '../../src/core/work-graph/tasks/contracts.js';

const at = '2026-09-23T10:00:00.000Z';
const alpha = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;
const beta = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[1]!;
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function databasePath() {
  const directory = await mkdtemp(join(tmpdir(), 'r3a-goal-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'ledger.sqlite');
}
function observer(path: string) {
  const db = new DatabaseSync(path);
  cleanup.push(() => db.close());
  return db;
}
function boot() {
  return buildBootstrapLedgerCommit(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: 'r3a-bootstrap', correlationId: 'r3a-bootstrap', submittedAt: at,
  }), { eventIds: ['r3a-p-a', 'r3a-p-b', 'r3a-w-a', 'r3a-w-b'], occurredAt: at });
}
function goal(id: string, scope = alpha, requestId = 'request-' + id) {
  const command = buildCreateGoalCommand({ ...scope, goalId: id }, {
    commandId: 'command-' + id, correlationId: 'correlation-' + id, submittedAt: at, idempotencyKey: requestId,
  });
  return { command, batch: buildGoalCreateLedgerCommit(command, { eventId: 'created-' + scope.projectId + '-' + id,
    occurredAt: at, projectRevision: 1, workspaceRevision: 1 }) };
}
function committed(receipt: LedgerCommitReceipt) {
  expect(receipt.status).toBe('committed');
  if (receipt.status !== 'committed') throw Error('Expected committed receipt');
  return receipt;
}
function physical(db: DatabaseSync) {
  // These four tables/column formats are the explicit R3a compatibility contract.
  return {
    events: db.prepare('SELECT id,event_json FROM events ORDER BY id').all(),
    snapshots: db.prepare('SELECT ref_key,snapshot_json FROM snapshots ORDER BY ref_key').all(),
    idempotency: db.prepare('SELECT * FROM idempotency ORDER BY identity_key').all(),
    claims: db.prepare('SELECT * FROM identity_claims ORDER BY claim_key').all(),
  };
}
function bumpRevision(db: DatabaseSync, ref: AggregateRef) {
  // A storage-level concurrency seam, not a fabricated domain event. It changes
  // only the persisted version so CAS/replay cannot silently reread newer data.
  const key = canonicalJson(ref);
  const row = db.prepare('SELECT snapshot_json FROM snapshots WHERE ref_key=?').get(key);
  if (!row) throw Error('Cannot advance a missing fixture record');
  const snapshot = JSON.parse(String(row['snapshot_json'])) as { revision: number };
  snapshot.revision++;
  db.prepare('UPDATE snapshots SET snapshot_json=? WHERE ref_key=?').run(JSON.stringify(snapshot), key);
  return snapshot.revision;
}
const sqlString = (value: string) => "'" + value.replaceAll("'", "''") + "'";

describe('R3a stable SQLite compatibility seam', () => {
  it.each(['snapshot', 'idempotency'] as const)('rolls back a Goal transaction failing at %s after earlier writes really occurred', async stage => {
    const path = await databasePath(), ledger = new SqliteStateLedger({ path });
    cleanup.push(() => ledger.close());
    committed(await ledger.commit(boot()));
    committed(await ledger.commit(goal('already-durable').batch));
    const input = goal('rollback-' + stage), db = observer(path), before = physical(db);
    const key = canonicalJson(input.batch.snapshots[0]!.ref);
    const identityKey = 'goal-create:' + commandIdentityKey(input.command.identity);
    const eventId = input.batch.events[0]!.eventId;
    const eventPresent = `EXISTS(SELECT 1 FROM events WHERE json_extract(event_json,'$.eventId')=${sqlString(eventId)})`;
    const snapshotPresent = `EXISTS(SELECT 1 FROM snapshots WHERE ref_key=${sqlString(key)})`;
    const marker = 'r3a-' + stage + '-after-prior-write';
    db.exec(stage === 'snapshot'
      ? `CREATE TRIGGER r3a_fail_goal BEFORE INSERT ON snapshots WHEN NEW.ref_key=${sqlString(key)} BEGIN
          SELECT CASE WHEN ${eventPresent} THEN RAISE(ABORT,${sqlString(marker)}) ELSE RAISE(ABORT,'r3a_wrong_write_order') END;
        END;`
      : `CREATE TRIGGER r3a_fail_goal BEFORE INSERT ON idempotency WHEN NEW.identity_key=${sqlString(identityKey)} BEGIN
          SELECT CASE WHEN ${eventPresent} AND ${snapshotPresent} THEN RAISE(ABORT,${sqlString(marker)}) ELSE RAISE(ABORT,'r3a_wrong_write_order') END;
        END;`);
    // Legacy exceptions still propagate. A pre-write hook cannot satisfy the
    // trigger's assertion that event (and then snapshot) already exists inside TX.
    await expect(ledger.commit(input.batch)).rejects.toThrow(marker);
    expect(physical(db)).toEqual(before);
    expect(await ledger.load(input.batch.snapshots[0]!.ref)).toMatchObject({ status: 'not_found' });
    db.exec('DROP TRIGGER r3a_fail_goal');
    const accepted = committed(await ledger.commit(input.batch));
    expect(accepted.replayed).toBe(false);
    expect(await ledger.commit(input.batch)).toEqual({ ...accepted, replayed: true });
    expect(Number(db.prepare("SELECT COUNT(*) AS n FROM events WHERE json_extract(event_json,'$.eventId')=?").get(eventId)!['n'])).toBe(1);
  });

  it('requires a complete exact read set for a new raw identity and an event-consistent Goal fold', async () => {
    const path = await databasePath(), ledger = new SqliteStateLedger({ path }); cleanup.push(() => ledger.close());
    committed(await ledger.commit(boot()));
    const db = observer(path), before = physical(db);
    const mutations: Array<(batch: ReturnType<typeof goal>['batch']) => void> = [
      batch => { batch.expectedVersions = batch.expectedVersions.filter(pin => pin.ref.aggregateType !== 'Project'); },
      batch => { batch.expectedVersions = batch.expectedVersions.filter(pin => pin.ref.aggregateType !== 'Workspace'); },
      batch => { batch.expectedVersions = batch.expectedVersions.filter(pin => pin.ref.aggregateType !== 'Goal'); },
      batch => { batch.expectedVersions.push(structuredClone(batch.expectedVersions[0]!)); },
      batch => { batch.expectedVersions[0] = { ref: { aggregateType: 'Project', projectId: beta.projectId }, revision: 1 }; },
      batch => { batch.snapshots[0]!.objective = 'Does not equal the GoalCreated event'; },
    ];
    for (const [i, mutate] of mutations.entries()) {
      const input = goal('invalid-read-set-' + i); mutate(input.batch);
      expect(await ledger.commit(input.batch)).toMatchObject({ status: 'rejected', code: 'invalid_commit' });
      expect(physical(db)).toEqual(before);
    }
  });

  it.each(['Project', 'Workspace'] as const)('checks the persisted %s guard in the commit transaction and returns its actual conflict version', async kind => {
    const path = await databasePath(), ledger = new SqliteStateLedger({ path }); cleanup.push(() => ledger.close());
    committed(await ledger.commit(boot()));
    const input = goal('scope-conflict-' + kind), db = observer(path);
    const pin = input.batch.expectedVersions.find(entry => entry.ref.aggregateType === kind)!;
    const revision = bumpRevision(db, pin.ref), before = physical(db);
    expect(await ledger.commit(input.batch)).toMatchObject({ status: 'rejected', code: 'revision_conflict', currentVersions: [{ ref: pin.ref, revision }] });
    expect(physical(db)).toEqual(before);
    pin.revision = revision;
    expect(committed(await ledger.commit(input.batch)).replayed).toBe(false);
  });

  it('keeps complete project scope in Goal and idempotency keys, and replays the original receipt after later commits/restart', async () => {
    const path = await databasePath(); let ledger = new SqliteStateLedger({ path }); cleanup.push(() => ledger.close());
    committed(await ledger.commit(boot()));
    const a = goal('shared-goal', alpha, 'shared-request'), b = goal('shared-goal', beta, 'shared-request');
    const original = committed(await ledger.commit(a.batch));
    const foreign = committed(await ledger.commit(b.batch));
    expect(foreign.replayed).toBe(false); expect(foreign.commitCursor).not.toBe(original.commitCursor);
    expect(await ledger.load(a.batch.snapshots[0]!.ref)).toMatchObject({ status: 'found', snapshot: a.batch.snapshots[0] });
    expect(await ledger.load(b.batch.snapshots[0]!.ref)).toMatchObject({ status: 'found', snapshot: b.batch.snapshots[0] });
    const before = await ledger.events({ afterCursor: null, limit: 100 });
    const retry = structuredClone(a.batch);
    retry.events[0]!.eventId = 'fresh-retry-event'; retry.events[0]!.occurredAt = '2026-09-24T00:00:00.000Z';
    retry.events[0]!.payload.objective = retry.snapshots[0]!.objective = 'Same raw fingerprint intentionally preserved';
    for (const pin of retry.expectedVersions) if (pin.ref.aggregateType !== 'Goal') pin.revision = 999;
    expect(await ledger.commit(retry)).toEqual({ ...original, replayed: true });
    expect(await ledger.events({ afterCursor: null, limit: 100 })).toEqual(before);
    await ledger.close(); ledger = new SqliteStateLedger({ path });
    expect(await ledger.commit(retry)).toEqual({ ...original, replayed: true });
    expect(await ledger.events({ afterCursor: null, limit: 100 })).toEqual(before);
    const mismatch = goal('shared-goal', alpha, 'shared-request'); mismatch.command.payload.objective = 'Different submitted content';
    const changed = buildGoalCreateLedgerCommit(mismatch.command, { eventId: 'changed-fingerprint', occurredAt: at, projectRevision: 1, workspaceRevision: 1 });
    expect(await ledger.commit(changed)).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  });
});

/**
 * Test-only integration seam, not a proposed production factory/constructor.
 * Each call must own one real SQLite backend for `path`; records and legacy ledger
 * must share it. A second call with the same path opens a distinct real connection.
 * control is the real existing governance/plan path over that same backend.
 * Do not register this suite with a Store double or a records→StateLedger wrapper.
 */
export type R3aSqliteTestConnection = {
  records: GoalRecordTransactionPort;
  ledger: StateLedger;
  control: Pick<ControlEngine, 'install' | 'activate' | 'applyPlan'>;
  close(): Promise<void>;
};
type Connect = (path: string) => Promise<R3aSqliteTestConnection>;

// Every connect opens a distinct connection; records/ledger/control inside it share
// one backend. This counter survives reopen and differs from the Goal suite prefix.
let controlEventSequence = 0;
export async function connectR3aSqlite(path: string): Promise<R3aSqliteTestConnection> {
  const backend = createSqliteRecordBackend({ path, schemas: GOAL_RECORD_SCHEMAS });
  try {
    const ledger = new SqliteStateLedger({ path }, backend);
    const now = () => at;
    const eventId = () => 'r3a-control-event-' + ++controlEventSequence;
    const goals = createGoalService({ records: backend.records, now, eventId });
    const control = new ControlEngineImpl({ ledger, now, eventId, goalCommands: goals.legacyCommands });
    return { records: backend.records, ledger, control, close: () => ledger.close() };
  } catch (error) {
    await backend.close();
    throw error;
  }
}

type GoalWrite = GraphWrite<CreateGoalInput>;
function write(goalId: string, requestId: string, scope = alpha): GoalWrite {
  return { input: { goalId, workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId }, objective: ' \u00a0Cafe\u0301 original objective \u00a0' },
    meta: { requestId, expected: [] } };
}
function host(scope = alpha): CoreCallContext {
  // An explicit trusted test caller with authority only in this fixture's two
  // bootstrapped workspaces, not a claim that arbitrary model JSON grants access.
  const actor = scope.actor;
  if (actor.kind === 'agent') throw Error('This Host fixture has no agent creation grant');
  return { projectId: scope.projectId, workspaceId: scope.workspaceId,
    principal: { kind: 'host', actor: { ...actor } },
    materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: { ...actor } },
    signal: new AbortController().signal };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

export function defineR3aGoalTaskSqliteSuite(connect: Connect) {
  let eventSequence = 0;
  async function open(path: string) { const connection = await connect(path); cleanup.push(() => connection.close()); return connection; }
  async function service(records: GoalRecordTransactionPort) {
    return createGoalService({ records, now: () => at, eventId: () => 'r3a-new-goal-' + ++eventSequence });
  }
  function forwarding(records: GoalRecordTransactionPort): GoalRecordTransactionPort {
    return { readMany: keys => records.readMany(keys), lookupCommit: input => records.lookupCommit(input),
      commit: input => records.commit(input), eventAt: cursor => records.eventAt(cursor) };
  }
  async function advanceGoal(c: R3aSqliteTestConnection, value: GoalSnapshot) {
    for (const [index, fixture] of [COMPLETION_POLICY_FIXTURE_V1, ARCHITECTURE_BASELINE_FIXTURE_V1].entries()) {
      const id = 'install-' + index;
      const command = buildInstallCommand(fixture, { projectId: value.ref.projectId, commandId: id, correlationId: id, idempotencyKey: id, submittedAt: at });
      expect(await c.control.install(command)).toMatchObject({ status: 'committed' });
      const pin = command.commandType === 'InstallCompletionPolicyRevision' ? completionPolicyPinFor(command) : architectureBaselinePinFor(command);
      expect(await c.control.activate(buildActivateCommand(pin, { projectId: value.ref.projectId, commandId: 'activate-' + id,
        correlationId: id, idempotencyKey: 'activate-' + id, expectedRevision: 1, submittedAt: at }))).toMatchObject({ status: 'committed' });
    }
    const plan = { ...structuredClone(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1), goalId: value.ref.goalId };
    expect(await c.control.applyPlan(buildApplyPlanCommand(plan, { projectId: value.ref.projectId, goalId: value.ref.goalId,
      actor: alpha.actor, commandId: 'apply-real-plan', correlationId: 'apply-real-plan', idempotencyKey: 'apply-real-plan',
      expectedRevision: value.revision, submittedAt: at }))).toMatchObject({ status: 'committed' });
  }

  describe('R3a GoalTaskPort over real shared SQLite records', () => {
    it('replays the original Goal@1/event/cursor before scope reads even after a real plan and scope versions advance', async () => {
      const path = await databasePath(), c = await open(path); committed(await c.ledger.commit(boot()));
      const s = await service(c.records), request = write('goal-id-is-not-request-id', 'stable-request');
      const first = await s.tasks.createGoal(host(), request);
      expect(first.status).toBe('committed'); if (first.status !== 'committed') throw Error('Expected Goal creation');
      expect(first.value).toMatchObject({ ref: { goalId: request.input.goalId }, revision: 1, objective: 'Café original objective', activePlanRevision: null });
      await advanceGoal(c, first.value);
      expect(await c.ledger.load(first.value.ref)).toMatchObject({ status: 'found', snapshot: { revision: 2, activePlanRevision: { aggregateType: 'PlanRevision' } } });
      const db = observer(path);
      bumpRevision(db, { aggregateType: 'Project', projectId: alpha.projectId }); bumpRevision(db, first.value.workspaceRef);
      const before = physical(db), seen: string[] = [];
      const instrumented = forwarding(c.records);
      instrumented.lookupCommit = async input => { seen.push('lookup'); return c.records.lookupCommit(input); };
      instrumented.eventAt = async cursor => { seen.push('eventAt'); expect(cursor).toBe(first.cursor); return c.records.eventAt(cursor); };
      instrumented.readMany = async () => { throw Error('Replay must not read current Goal/scope'); };
      instrumented.commit = async () => { throw Error('Replay must not submit again'); };
      const retry = await service(instrumented);
      request.meta.expected = [
        { ref: { aggregateType: 'Project', projectId: alpha.projectId }, revision: 1 },
        { ref: first.value.workspaceRef, revision: 1 }, { ref: first.value.ref, revision: 0 },
      ];
      expect(await retry.tasks.createGoal(host(), request)).toEqual({ ...first, replayed: true });
      expect(seen[0]).toBe('lookup'); expect(seen).toContain('eventAt'); expect(physical(db)).toEqual(before);
      // The old wire sees the original same eventIds/cursor too; commandId itself
      // belongs to the retry and is deliberately not asserted as the old commandId.
      const command: CreateGoalCommand = buildCreateGoalCommand({ ...alpha, goalId: request.input.goalId, objective: request.input.objective },
        { commandId: 'legacy-retry', correlationId: 'legacy-retry', idempotencyKey: request.meta.requestId, submittedAt: at });
      const originalEvent = await c.records.eventAt(first.cursor);
      if (originalEvent.status !== 'ready') throw Error('Expected original GoalCreated');
      expect(await retry.legacyCommands.submit(command)).toMatchObject({ status: 'committed', replayed: true,
        aggregateRevision: 1, eventIds: [originalEvent.value.event.eventId], commitCursor: first.cursor });
      expect(physical(db)).toEqual(before);
      expect(await retry.tasks.createGoal(host(), { ...request, input: { ...request.input, objective: '   ' } })).toMatchObject({ status: 'rejected', code: 'invalid' });
    });

    it.each(['Project', 'Workspace'] as const)('carries the observed %s version into the final transactional CAS', async kind => {
      const path = await databasePath(), c = await open(path); committed(await c.ledger.commit(boot()));
      const db = observer(path), read = deferred(), resume = deferred(), port = forwarding(c.records);
      let transaction: StoreCommitReceipt | undefined;
      port.readMany = async keys => { const result = await c.records.readMany(keys); read.resolve(); await resume.promise; return result; };
      port.commit = async input => { transaction = await c.records.commit(input); return transaction; };
      const s = await service(port), request = write('cas-' + kind, 'cas-request-' + kind);
      const pending = s.tasks.createGoal(host(), request);
      await read.promise;
      const changed: AggregateRef = kind === 'Project' ? { aggregateType: 'Project', projectId: alpha.projectId }
        : { aggregateType: 'Workspace', projectId: alpha.projectId, workspaceId: alpha.workspaceId };
      const revision = bumpRevision(db, changed), before = physical(db);
      resume.resolve();
      expect(await pending).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      expect(transaction).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      if (transaction?.status !== 'rejected' || transaction.code !== 'revision_conflict') throw Error('Expected transaction conflict');
      expect(transaction.current).toEqual(expect.arrayContaining([{ refKey: canonicalJson(changed), revision }]));
      expect(physical(db)).toEqual(before);
    });

    it('isolates reused local IDs across projects and rejects unrelated/duplicate pins before replay lookup', async () => {
      const path = await databasePath(), c = await open(path); committed(await c.ledger.commit(boot()));
      const s = await service(c.records), a = write('shared-goal', 'shared-request'), b = write('shared-goal', 'shared-request', beta);
      const first = await s.tasks.createGoal(host(), a), second = await s.tasks.createGoal(host(beta), b);
      expect(first).toMatchObject({ status: 'committed', replayed: false, value: { ref: { projectId: alpha.projectId } } });
      expect(second).toMatchObject({ status: 'committed', replayed: false, value: { ref: { projectId: beta.projectId } } });
      expect(await s.tasks.createGoal(host(), { ...a, input: { ...a.input, objective: 'Different request content' } }))
        .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
      const port = forwarding(c.records); port.lookupCommit = async () => { throw Error('Invalid scope/pins must fail before lookup'); };
      const guarded = await service(port), db = observer(path), before = physical(db);
      const pin: VersionedRef = { ref: { aggregateType: 'Project', projectId: alpha.projectId }, revision: 1 };
      for (const expected of [[pin, pin], [{ ...pin, ref: { aggregateType: 'Project' as const, projectId: beta.projectId } }],
        [{ ref: { aggregateType: 'Goal' as const, projectId: alpha.projectId, goalId: 'unrelated-goal' }, revision: 0 }]]) {
        expect(await guarded.tasks.createGoal(host(), { ...a, meta: { ...a.meta, expected } })).toMatchObject({ status: 'rejected', code: 'invalid' });
      }
      const wrongScope = await guarded.tasks.createGoal(host(beta), a);
      expect(wrongScope.status).toBe('rejected');
      if (wrongScope.status === 'rejected') expect(['invalid', 'forbidden']).toContain(wrongScope.code);
      const stalePin = write('explicitly-pinned-goal', 'explicitly-pinned-request');
      stalePin.meta.expected = [{ ...pin, revision: 99 }];
      expect(await s.tasks.createGoal(host(), stalePin)).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      expect(physical(db)).toEqual(before);
    });

    it.each(['same-request', 'different-request'] as const)('resolves two SQLite connections after both scope reads: %s', async mode => {
      const path = await databasePath(), left = await open(path); committed(await left.ledger.commit(boot()));
      const right = await open(path), bothRead = deferred(), release = deferred(); let reads = 0;
      const gated = (records: GoalRecordTransactionPort) => {
        const port = forwarding(records);
        port.readMany = async keys => {
          // The real store has finished its read transaction before this barrier.
          // No await is inserted into a SQLite write transaction.
          const result = await records.readMany(keys); if (++reads === 2) bothRead.resolve(); await release.promise; return result;
        };
        return port;
      };
      const a = await service(gated(left.records)), b = await service(gated(right.records));
      const pendingA = a.tasks.createGoal(host(), write('contended-goal', 'first-request'));
      const pendingB = b.tasks.createGoal(host(), write('contended-goal', mode === 'same-request' ? 'first-request' : 'second-request'));
      await bothRead.promise; release.resolve();
      const results = await Promise.all([pendingA, pendingB]);
      const accepted = results.filter(result => result.status === 'committed');
      if (mode === 'same-request') {
        expect(accepted).toHaveLength(2); expect(accepted.map(result => result.replayed).sort()).toEqual([false, true]);
        expect(accepted[0]!.value).toEqual(accepted[1]!.value); expect(accepted[0]!.cursor).toBe(accepted[1]!.cursor);
      } else {
        expect(accepted).toHaveLength(1); expect(results.find(result => result.status === 'rejected')).toMatchObject({ code: 'revision_conflict' });
      }
      const events = await left.ledger.events({ afterCursor: null, limit: 100 });
      expect(events.events.filter(({ event }) => event.eventType === 'GoalCreated' && event.aggregateId === 'contended-goal')).toHaveLength(1);
    });
  });
}

// Deliberately registered: copying this staged file runs the real Goal suite too.
defineR3aGoalTaskSqliteSuite(connectR3aSqlite);

describe('R3a independent transaction-time stored identity guard', () => {
  it.each(['sqlite', 'memory'] as const)('%s rejects a changed stored ref even when the numeric revision is unchanged', async adapter => {
    const memory = adapter === 'memory' ? createInMemoryRecordBackend({ schemas: GOAL_RECORD_SCHEMAS }) : null;
    const path = memory ? null : await databasePath();
    const sqlite = path ? createSqliteRecordBackend({ path, schemas: GOAL_RECORD_SCHEMAS }) : null;
    const backend = memory ?? sqlite!;
    const ledger = memory ? new InMemoryLedger(undefined, memory) : new SqliteStateLedger({ path: path! }, sqlite!);
    cleanup.push(() => backend.close());
    committed(await ledger.commit(boot()));
    const records = backend.records;
    const workspaceRef = { aggregateType: 'Workspace' as const, projectId: alpha.projectId, workspaceId: alpha.workspaceId };
    const key = canonicalJson(workspaceRef);
    const gate = deferred(), proceed = deferred();
    let actualCommit: StoreCommitReceipt | undefined;
    const instrumented: GoalRecordTransactionPort = {
      lookupCommit: input => records.lookupCommit(input),
      eventAt: cursor => records.eventAt(cursor),
      readMany: async keys => {
        const snapshot = await records.readMany(keys);
        gate.resolve();
        await proceed.promise;
        return snapshot;
      },
      commit: async input => { actualCommit = await records.commit(input); return actualCommit; },
    };
    const service = createGoalService({ records: instrumented, now: () => at, eventId: () => 'must-not-persist-corrupt-scope' });
    const pending = service.tasks.createGoal(host(), write('corrupt-scope-goal', 'corrupt-scope-request'));
    await gate.promise;
    // Corruption/legacy-write seam between the valid read and commit. The key
    // and numeric revision remain unchanged, but the body now names another
    // workspace; a numeric-only CAS must not treat this as the same record.
    if (memory) {
      const original = memory.legacyAccess.state.snapshots.get(key)!;
      memory.legacyAccess.state.snapshots.set(key, { ...original, ref: { ...workspaceRef, workspaceId: 'foreign-workspace' } } as typeof original);
    } else {
      const db = sqlite!.legacyAccess.connection;
      const row = db.prepare('SELECT snapshot_json FROM snapshots WHERE ref_key=?').get(key)!;
      const snapshot = JSON.parse(String(row['snapshot_json']));
      snapshot.ref.workspaceId = 'foreign-workspace';
      db.prepare('UPDATE snapshots SET snapshot_json=? WHERE ref_key=?').run(JSON.stringify(snapshot), key);
    }
    const eventsBefore = await ledger.events({ afterCursor: null, limit: 100 });
    proceed.resolve();
    const result = await pending;
    expect.soft(actualCommit).toMatchObject({ status: 'rejected', code: 'corrupt' });
    expect.soft(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect.soft(await ledger.load({ aggregateType: 'Goal', projectId: alpha.projectId, goalId: 'corrupt-scope-goal' })).toMatchObject({ status: 'not_found' });
    expect(await ledger.events({ afterCursor: null, limit: 100 })).toEqual(eventsBefore);
  });
});
