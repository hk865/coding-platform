/**
 * TP-143: the RunSnapshot codec rejects a V2 `entering` authorization without a
 * bound Kernel. A5 pure test: no fixture, backend or stored record.
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { ConsumedWaitV1, RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import { consumedWaitProblem } from '../../src/core/work-graph/tasks/claim-record-codecs.js';

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
  previousRun: null,
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

describe('the claim consumed wait', () => {
  const PROJECT = 'project-s7b-claim';
  const GOAL = 'goal-s7b-claim';
  const WORKSPACE = 'workspace-s7b-claim';
  const TASK = { projectId: PROJECT, goalId: GOAL };
  const MESSAGE: SessionMessageRef = {
    aggregateType: 'SessionMessage', projectId: PROJECT, workspaceId: WORKSPACE, messageId: 'message-s7b-claim',
  };
  const RUN_REF: RunRef = { aggregateType: 'Run', projectId: PROJECT, goalId: GOAL, runId: 'run-s7b-claim' };
  const RESPONSE: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'a'.repeat(64), sizeBytes: 1,
    source: { kind: 'workspace', refId: 'w', revision: '1' } };

  const ARMS: ReadonlyArray<{ arm: string; value: ConsumedWaitV1 }> = [
    { arm: 'wait_reply', value: { kind: 'wait_reply', originalRun: RUN_REF, messageRef: MESSAGE, responseRef: RESPONSE } },
    { arm: 'expiry', value: { kind: 'expiry', originalRun: RUN_REF, messageRef: MESSAGE, expiryInputId: 'expiry-s7b-claim' } },
    { arm: 'intervention', value: { kind: 'intervention', messageRef: MESSAGE } },
  ];

  it.each(ARMS)('the $arm arm scoped to the Task is a valid claim input', ({ value }) => {
    expect(consumedWaitProblem(value, TASK)).toBeNull();
  });

  it('rejects: a wait_reply messageRef outside the Task project', () => {
    const value: ConsumedWaitV1 = { kind: 'wait_reply', originalRun: RUN_REF,
      messageRef: { ...MESSAGE, projectId: 'project-s7b-other' }, responseRef: RESPONSE };
    expect(consumedWaitProblem(value, TASK))
      .toBe('ClaimTask.consumedWait.messageRef is outside the Task project');
  });
});
