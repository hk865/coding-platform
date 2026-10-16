/**
 * Slice 4C C2.2: the concrete `NoteRunTaskResolver` in `plan-readers.ts`.
 * One `readMany` of the trusted Run snapshot from `ctx.principal.runRef`.
 */
import { describe, expect, it } from 'vitest';
import { createNoteRunTaskResolver } from '../../src/core/work-graph/tasks/plan-readers.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';

const P = 'p';
const G = 'g';
const RUN: RunRef = { aggregateType: 'Run', projectId: P, goalId: G, runId: 'r1' };
const PLAN_REF = { aggregateType: 'PlanRevision' as const, projectId: P, planId: 'pl' };
const signal = (): AbortSignal => new AbortController().signal;

function workContext(): CoreCallContext {
  return { projectId: P, workspaceId: 'w',
    principal: { kind: 'work_run', runRef: { ...RUN },
      roleBinding: { schemaVersion: 1, bindingId: 'b', templateId: 'executor', templateRevision: '1',
        bindingVersion: 1, policyRevision: '1' } },
    materialReader: { kind: 'run', requester: { ...RUN } }, signal: signal() };
}

function hostContext(): CoreCallContext {
  return { projectId: P, workspaceId: 'w',
    principal: { kind: 'host', actor: { kind: 'human', id: 'u' } },
    materialReader: { kind: 'host', projectId: P, workspaceId: 'w', actor: { kind: 'human', id: 'u' } },
    signal: signal() };
}

function runJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ref: RUN, revision: 1, schemaVersion: 1, task: { projectId: P, goalId: G, taskId: 't1' },
    attemptId: 'a1', planRef: PLAN_REF, roleBinding: {}, budget: {}, workspaceSnapshot: {},
    status: 'running', outcome: null, exitCode: null, lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '',
    envelope: null, startedAt: null, endedAt: null, ...overrides,
  });
}

function recordsReturning(record: EncodedRecord | null): GoalRecordTransactionPort {
  const runKey = canonicalJson(RUN as never);
  return {
    async readMany() {
      return { status: 'ready', value: { records: record === null ? [] : [record], readThrough: null } };
    },
  } as unknown as GoalRecordTransactionPort;
}

const RUN_RECORD: EncodedRecord = { refKey: canonicalJson(RUN as never), schemaId: 'RunSnapshot@1', revision: 1, json: runJson() };

describe('S4C NoteRunTaskResolver', () => {
  it('GTN20 resolves a work Run in one readMany and returns goalId/taskId/planRef', async () => {
    let reads = 0;
    const base = recordsReturning(RUN_RECORD);
    const records = { async readMany(keys: readonly string[]) { reads += 1; return base.readMany(keys); } } as unknown as GoalRecordTransactionPort;
    const resolve = createNoteRunTaskResolver(records);
    const result = await resolve(workContext());
    expect(result).toEqual({ status: 'ready', value: { goalId: G, taskId: 't1', planRef: PLAN_REF } });
    expect(reads).toBe(1);
  });

  it('GTN21 a non-work principal, a missing Run and a damaged Run are unavailable', async () => {
    expect(await createNoteRunTaskResolver(recordsReturning(RUN_RECORD))(hostContext()))
      .toEqual({ status: 'rejected', code: 'unavailable', reason: 'the caller is not a work Run' });
    expect(await createNoteRunTaskResolver(recordsReturning(null))(workContext()))
      .toEqual({ status: 'rejected', code: 'unavailable', reason: 'the caller Run is missing' });
    const damaged = { ...RUN_RECORD, json: '{"broken":' };
    expect(await createNoteRunTaskResolver(recordsReturning(damaged))(workContext()))
      .toEqual({ status: 'rejected', code: 'unavailable', reason: 'the caller Run is not decodable' });
  });
});
