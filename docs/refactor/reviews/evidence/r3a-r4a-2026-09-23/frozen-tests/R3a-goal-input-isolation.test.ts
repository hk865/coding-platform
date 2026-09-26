/**
 * Independent R3a input-isolation regression.
 * This is a programmatic call with an extra non-JSON function property, not an
 * ordinary JSON request or an authorization-bypass test. The accepted command
 * fields must be owned before the first await, or the call must be explicitly
 * rejected before any write. A failed clone must not retain the caller's object.
 */
import { expect, it } from 'vitest';
import { buildBootstrapCommand } from '../../src/contracts/bootstrap.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import { GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { admitGoalCreation } from '../../src/core/work-graph/tasks/task-service.js';
import { InMemoryLedger } from '../../src/data/state-ledger/in-memory-ledger.js';
import {
  WORKSPACE_BOOTSTRAP_FIXTURE_V1,
  buildBootstrapLedgerCommit,
} from '../contract-support/fixtures/bootstrap-fixture-v1.js';
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
} from '../contract-support/fixtures/goal-fixtures.js';

it('owns accepted fields or rejects an extra non-JSON property before an async caller mutation can redirect Goal creation', async () => {
  const backend = createInMemoryRecordBackend({ schemas: GOAL_RECORD_SCHEMAS });
  const ledger = new InMemoryLedger({}, backend);
  const at = '2026-09-23T10:00:00.000Z';
  try {
    const boot = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
      commandId: 'isolation-bootstrap', correlationId: 'isolation-bootstrap', submittedAt: at,
    });
    expect(await ledger.commit(buildBootstrapLedgerCommit(boot, {
      eventIds: ['isolation-p-a', 'isolation-p-b', 'isolation-w-a', 'isolation-w-b'], occurredAt: at,
    }))).toMatchObject({ status: 'committed' });

    const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;
    const original = buildCreateGoalCommand({ ...scope, goalId: 'goal-at-call', objective: 'original objective' }, {
      commandId: 'isolation-create', correlationId: 'isolation-create',
      submittedAt: at, idempotencyKey: 'isolation-key',
    });
    const input = { ...original, extraCallback: () => undefined };
    const ref = (goalId: string): GoalRef => ({ aggregateType: 'Goal', projectId: scope.projectId, goalId });
    const originalKey = canonicalJson(ref(original.aggregateId));
    const redirectedKey = canonicalJson(ref('goal-mutated-after-call'));
    const before = structuredClone(backend.legacyAccess.state);

    let releaseLookup!: () => void;
    const lookupGate = new Promise<void>(resolve => { releaseLookup = resolve; });
    const readSets: string[][] = [];
    // Only the scheduling boundary is intercepted. Every result, read, schema
    // check and commit still goes through the real RecordStore port/backend.
    const records: GoalRecordTransactionPort = {
      ...backend.records,
      lookupCommit: async request => {
        await lookupGate;
        return backend.records.lookupCommit(request);
      },
      readMany: refs => {
        readSets.push([...refs]);
        return backend.records.readMany(refs);
      },
    };
    const pending = admitGoalCreation({ records, now: () => at, eventId: () => 'isolation-created' }, input);
    input.aggregateId = 'goal-mutated-after-call';
    releaseLookup();
    const result = await pending;

    expect.soft(readSets.flat(), 'an in-flight call must never switch to the mutated Goal ref').not.toContain(redirectedKey);
    const stored = await backend.records.readMany([originalKey, redirectedKey]);
    expect(stored.status).toBe('ready');
    if (stored.status !== 'ready') throw new Error('Goal verification read failed');
    expect.soft(stored.value.missing, 'the caller mutation must not create another Goal').toContain(redirectedKey);

    if (result.status === 'rejected') {
      // Rejecting an uncloneable programmatic input is permitted. A different
      // late failure, or a rejection after partial writes, is not a valid fix.
      expect(result.code).toBe('invalid');
      expect(result.reason.length).toBeGreaterThan(0);
      expect(backend.legacyAccess.state).toEqual(before);
    } else {
      expect(result.snapshot).toMatchObject({ ref: ref(original.aggregateId), objective: 'original objective' });
      expect(stored.value.records.map(record => record.refKey)).toEqual([originalKey]);
      expect(backend.legacyAccess.state.eventLog).toHaveLength(before.eventLog.length + 1);
      expect(backend.legacyAccess.state.idempotency.size).toBe(before.idempotency.size + 1);
    }
  } finally {
    await backend.close();
  }
});
