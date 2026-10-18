/**
 * K3 L27 (slice-K3-SPEC.md lines 708-711; K spec L4 lines 94-100): a RUN-25 Run
 * (`crashed` + `takeover_unresolved`) is closable with no TaskRequeue, the same
 * authorized shape as RUN-22. Before the fix the ending fell through to
 * `refused('not_closable_run')`, so the continuation opened a new Session
 * instead of closing the dangling Turn in the original Session.
 *
 * Entry: `RuntimeExecutionPort.closeOpenTurn` over the real Kernel store; the
 * platform records and the Host binding are trusted test doubles. No database
 * read verifies the result.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createKernelStoreRegistry, type KernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { K_AT, KernelSessionFixture, openTempKernelStore, type TempKernelStore } from '../helpers/K-session-support.js';

const P = 'k3r1-project', G = 'k3r1-goal', T = 'k3r1-task', W = 'k3r1-workspace';
const SESSION_ID = 'k3r1-session';
const ADAPTER = 'k3r1-kernel';
const SCOPE = { projectId: P, workspaceId: W };
const sessionRef: SessionRef = { projectId: P, sessionId: SESSION_ID };
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const ctx: CoreCallContext = { projectId: P, workspaceId: W, principal: { kind: 'host', actor: { kind: 'human', id: 'k3r1-op' } },
  materialReader: { kind: 'host', projectId: P, workspaceId: W, actor: { kind: 'human', id: 'k3r1-op' } },
  signal: new AbortController().signal };

const opened: TempKernelStore[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((item) => item.cleanup())); });

/** An `unavailable/kernel_turn_open` Work Session with one open Turn for `run-A`. */
async function openWorkSession(): Promise<{ fixture: KernelSessionFixture; databasePath: string }> {
  const temp = await openTempKernelStore('k3r1-');
  opened.push(temp);
  const fixture = await KernelSessionFixture.create(temp.store, SESSION_ID);
  await fixture.startTurn({ runId: 'run-A', turnId: 'turn-A', input: 'the dangling question' });
  await fixture.event('run.started', {});
  return { fixture, databasePath: temp.databasePath };
}

function sessionRecord(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    ref: { aggregateType: 'Session', projectId: P, sessionId: SESSION_ID }, revision: 3,
    kernel: { adapterId: ADAPTER, kernelSessionId: SESSION_ID },
    lifecycle: 'active', health: 'unavailable', healthConclusion: 'kernel_turn_open',
    role: { kind: 'role_spec', pin: { ref: { aggregateType: 'RoleSpecRevision', projectId: P, roleId: 'builder', revision: 1 }, digest: 'd' } },
    workspaceId: W, lastExecutionRef: runRef('run-A'), occupancy: null, historyCursor: null,
    createdAt: K_AT, archivedAt: null, ...over,
  } as unknown as SessionRecord;
}

/** RUN-25: `crashed` + `takeover_unresolved`, with no TaskRequeue (K3 L27). */
function run25(): TaskExecutionRecord {
  return {
    run: {
      ref: runRef('run-A'), revision: 4, schemaVersion: 1, task: { projectId: P, goalId: G, taskId: T }, attemptId: 'attempt-A',
      planRef: { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' },
      roleBinding: { schemaVersion: 1, bindingId: 'b', templateId: 't', templateRevision: '1', bindingVersion: 1, policyRevision: 'p' },
      budget: { tokenBudget: 1000, deadline: null }, workspaceSnapshot: { workspaceId: W, revision: 1 },
      status: 'ended', outcome: 'crashed', exitCode: null, lastEventSeq: 3, lastRuntimeEventId: 'rt', lastFactEventId: 'ev',
      envelope: null, startedAt: K_AT, endedAt: K_AT,
      executionHistory: { schemaVersion: 1, sessionRef, kernel: { adapterId: ADAPTER, kernelSessionId: SESSION_ID, runId: 'run-A', turnId: 'turn-A' },
        startPosition: 2, observedThroughPosition: 3, endPosition: null },
      reconciliation: { status: 'done', observation: { kind: 'takeover_unresolved', event: {} as never, lastPosition: 3,
        observedThroughPosition: 3, unresolvedToolCallIds: ['call-1'], proof: { kind: 'hl01_no_lock' },
        reviewRef: { aggregateType: 'UnknownCallReview', projectId: P, goalId: G, runId: 'run-A' } },
        basis: { kind: 'host_instance_takeover', hostInstanceId: 'h' }, recordedAt: K_AT },
    } as unknown as RunSnapshot,
    attempt: { ref: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId: 'attempt-A' } },
    outbox: { claim: { sessionRef } },
  } as unknown as TaskExecutionRecord;
}

function depsFor(input: { registry: KernelStoreRegistry; record: TaskExecutionRecord; session: SessionRecord }): RuntimeExecutionDependencies {
  return {
    executions: { readExecution: async () => ({ status: 'ready', value: input.record }) },
    sessions: { readSession: async () => ({ status: 'ready', value: { record: input.session, availability: 'idle', links: [], recommendationReasons: [] } }),
      findSessions: async () => ({ status: 'ready', value: { items: [], nextCursor: null, sourceCursor: {} as never } }) },
    kernelStores: input.registry,
    kernel,
    turnClosure: { recordSessionHealth: (async () => ({ status: 'observed' as const, session: input.session })) as never, lease: 'owned' as const },
    plans: { queryTaskGraph: async () => ({ status: 'not_found' }) },
    now: () => K_AT, newId: () => 'k3r1-id',
  } as unknown as RuntimeExecutionDependencies;
}

describe('K3 L27 RUN-25 closeOpenTurn', () => {
  it('K3 L27 closes a crashed + takeover_unresolved Turn with no TaskRequeue and reports the health owner available', async () => {
    const { databasePath } = await openWorkSession();
    const registry = await createKernelStoreRegistry({ entries: [{ adapterId: ADAPTER, storeKey: 'k3r1', workspace: SCOPE, databasePath }] });
    const runtime = createAgentRuntime(depsFor({ registry, record: run25(), session: sessionRecord() }));
    const close = runtime.port.closeOpenTurn;
    if (close === undefined) throw new Error('closeOpenTurn must be published when turnClosure is injected');
    expect(await close(ctx, { sessionRef, afterRunRef: runRef('run-A'), requeueRef: null }))
      .toEqual({ status: 'closed', health: 'available' });
  });
});
