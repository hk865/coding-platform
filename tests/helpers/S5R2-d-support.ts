/** Group D driver over the shared S5 decision fixture (R2D ordering). */
import { expect } from 'vitest';
import {
  createCollaborationDriver, type CollaborationDriver, type CollaborationDriverDependencies,
  type CollaborationState,
} from '../../src/app/collaboration-driver.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { WorkflowPort } from '../../src/business/workflow/ports.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/model/session-contracts.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createInitializationBindingReader } from '../../src/core/work-graph/tasks/goal-confirm-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { until } from './change-stream-reader.js';
import { GOAL_A, GOAL_B, GOAL_C, WORKSPACE_SCOPE, type S5DecisionFixture } from './S5-decision-fixture.js';
import { committed, ready } from './S5-user-message-support.js';

// ---------------------------------------------------------------------------
// Driver-only doubles, following change-emitters.ts, with a REAL ordering seam.
// No cast weakens a port: unexpected runtime/Session/execution calls fail loudly.
// ---------------------------------------------------------------------------

async function unusedDriverPort(): Promise<never> {
  throw new Error('R2D ordering must not call an execution, Session, mailbox or control owner');
}

export function completedAdvance(): WorkflowAdvanceResult {
  return { status: 'ready', value: { state: 'completed', receipt: null, next: null, reason: 'script completed' } };
}

export function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let settled = false;
  const promise = new Promise<T>(resolve => { resolvePromise = resolve; });
  return { promise, settled: () => settled, resolve(value: T) {
    settled = true;
    resolvePromise(value);
  } };
}

export type RecordedAdvance = {
  input: WorkflowAdvanceInput;
  goalRef: GoalRef;
  kind: WorkflowAdvanceInput['kind'];
  taskId: string | null;
  signal: AbortSignal;
  orderCallsAtEntry: number;
};
export type AdvanceScript = (call: RecordedAdvance, index: number) => WorkflowAdvanceResult | Promise<WorkflowAdvanceResult>;

/** Reorder through the owner, then bind createWorkflow's actual ordering method. */
export async function orderedDriver(f: S5DecisionFixture, script: AdvanceScript,
  ordering: 'real' | 'reject' | 'throw' = 'real') {
  const goalSettings = createGoalSettingsService({ records: f.records, now: f.now, newId: f.newId,
    operatorActor: f.operatorActor });
  const reordered = committed(await goalSettings.reorderGoals(f.ctx, {
    input: { workspace: WORKSPACE_SCOPE, goalOrder: [GOAL_B, GOAL_A, GOAL_C] },
    meta: { requestId: 's5r2-d:driver-reorder', expected: [
      { ref: GOAL_B, revision: 7 }, { ref: GOAL_A, revision: 7 }, { ref: GOAL_C, revision: 7 },
    ] },
  }));
  expect(reordered.value.goals.map(goal => ({ ref: goal.ref, order: goal.settings?.order })))
    .toEqual([{ ref: GOAL_B, order: 0 }, { ref: GOAL_A, order: 1 }, { ref: GOAL_C, order: 2 }]);
  for (const [goalRef, order] of [[GOAL_B, 0], [GOAL_A, 1], [GOAL_C, 2]] as const) {
    expect(ready(await goalSettings.readGoalSettings(f.ctx, { goalRef })).settings.order).toBe(order);
  }
  const runtime: RuntimeExecutionPort = {
    capabilities: unusedDriverPort, createSession: unusedDriverPort, readSessionHistory: unusedDriverPort,
    readExecutionHistory: unusedDriverPort, readTaskExecutionHistory: unusedDriverPort,
    prepareExecution: unusedDriverPort, startRun: unusedDriverPort, observeRun: unusedDriverPort,
  };
  const sessions: SessionDirectoryPort = {
    admitSessionCreation: unusedDriverPort, recordSessionCreated: unusedDriverPort,
    getSessionOperation: unusedDriverPort, readSession: unusedDriverPort, findSessions: unusedDriverPort,
  };
  const realWorkflow = createWorkflow({
    tasks: createGoalService({ records: f.records, now: f.now, eventId: f.newId }).tasks,
    plans: createPlanService({ records: f.records, bindings: createInitializationBindingReader({ records: f.records }),
      now: f.now, eventId: f.newId }),
    sessions,
    claims: createTaskClaimService({ records: f.records, now: f.now, newId: f.newId,
      roles: createRoleConfigurationService({ records: f.records, now: f.now, eventId: f.newId }) }),
    executions: createRunStateReader({ records: f.records }), runtime,
    evidence: { openVerification: unusedDriverPort, readVerification: unusedDriverPort,
      beginCheck: unusedDriverPort, recordCheckResult: unusedDriverPort, finalizeChecks: unusedDriverPort },
    checks: { runRegisteredCheck: unusedDriverPort },
    sourceAuthority: createSourceAuthorityReader({ authority: createMaterialRecordReaders(f.records).authority }),
    goalSettings,
  });
  const calls: RecordedAdvance[] = [];
  const orderCalls: WorkflowAdvanceInput[][] = [];
  const orderResults: Awaited<ReturnType<NonNullable<WorkflowPort['orderGoalAdvances']>>>[] = [];
  const workflow: WorkflowPort = {
    handleGoalInput: unusedDriverPort,
    async orderGoalAdvances(ctx, input) {
      orderCalls.push(structuredClone(input.advances));
      const result = await realWorkflow.orderGoalAdvances(ctx, input);
      orderResults.push(structuredClone(result));
      if (ordering === 'reject') return { status: 'rejected', code: 'unsupported', reason: 'R2D09 ordering unavailable' };
      if (ordering === 'throw') throw new Error('R2D10 ordering failed');
      // Preserve the original advance references: this is the real Workflow result.
      return result;
    },
    async advanceWork(ctx, input) {
      const call: RecordedAdvance = {
        input: structuredClone(input), goalRef: structuredClone(input.goalRef), kind: input.kind,
        taskId: input.taskId ?? null, signal: ctx.signal, orderCallsAtEntry: orderCalls.length,
      };
      calls.push(call);
      return script(call, calls.length - 1);
    },
  };
  const dependencies: CollaborationDriverDependencies = {
    workflow, runtime, sessions, executions: { readExecution: unusedDriverPort },
    mailbox: { readMessage: unusedDriverPort, readOutbox: unusedDriverPort },
    controls: { submitControl: unusedDriverPort, readControl: unusedDriverPort }, profiles: [],
  };
  const driver = createCollaborationDriver(dependencies);
  return { driver, calls, orderCalls, orderResults,
    waitForCalls: (count: number) => until(() => calls.length >= count),
  };
}

export async function waitForDriverState(f: Pick<S5DecisionFixture, 'ctx'>, driver: CollaborationDriver,
  goalRef: GoalRef, wanted: CollaborationState): Promise<void> {
  const deadline = Date.now() + 3_000;
  for (;;) {
    const result = ready(await driver.read(f.ctx, { goalRef }));
    if (result.state === wanted) return;
    if (result.state === 'failed' || Date.now() > deadline) {
      throw new Error(`R2D expected ${goalRef.goalId} ${wanted}: ${JSON.stringify(result)}`);
    }
    // Poll the actual projection with a deadline; elapsed time is never evidence.
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
