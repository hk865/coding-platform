/**
 * TP-143: the RunSnapshot codec rejects a V2 `entering` authorization without a
 * bound Kernel. A5 pure test: no fixture, backend or stored record.
 */
import { describe, expect, it } from 'vitest';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';

const RUN_SNAPSHOT_SCHEMA_ID = 'RunSnapshot@1';
const runSchema = materialRecordSchemas().records.find(schema => schema.schemaId === RUN_SNAPSHOT_SCHEMA_ID);
if (runSchema === undefined) throw new Error('the RunSnapshot schema is not registered');

const RUN: RunSnapshot = {
  ref: { aggregateType: 'Run', projectId: 'project-1', goalId: 'goal-1', runId: 'run-1' },
  revision: 2,
  schemaVersion: 1,
  task: { projectId: 'project-1', goalId: 'goal-1', taskId: 'task-1' },
  attemptId: 'attempt-1',
  planRef: { aggregateType: 'PlanRevision', projectId: 'project-1', planId: 'plan-1' },
  roleBinding: { schemaVersion: 1, bindingId: 'binding-1', templateId: 'template-1',
    templateRevision: '1', bindingVersion: 1, policyRevision: 'policy-1' },
  budget: { tokenBudget: 1000, deadline: null },
  workspaceSnapshot: { workspaceId: 'workspace-1', revision: 1 },
  status: 'starting',
  outcome: null,
  exitCode: null,
  lastEventSeq: 0,
  lastRuntimeEventId: '',
  lastFactEventId: '',
  envelope: null,
  startedAt: null,
  endedAt: null,
  executionAuthorization: {
    schemaVersion: 2, generation: 1, sessionGeneration: 1, revision: 1,
    consumerId: 'runtime-a', inputDigest: 'a'.repeat(64), phase: 'entering', kernel: null,
  },
};

const RECORD = {
  refKey: canonicalJson(RUN.ref as unknown as JsonValue),
  schemaId: RUN_SNAPSHOT_SCHEMA_ID,
  revision: RUN.revision,
  json: JSON.stringify(RUN),
};

describe('RunSnapshot execution authorization codec', () => {
  it('rejects an entering V2 authorization without a bound Kernel', () => {
    expect(runSchema.validate(RECORD)).toEqual({ status: 'invalid',
      reason: 'Run executionAuthorization is malformed: executionAuthorization V2 phase entering requires a bound kernel' });
  });
});
