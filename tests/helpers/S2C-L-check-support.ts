/**
 * Group L (slice 2C) real Evidence/completion support for 2C-10 (LE3).
 *
 * This builds the real `EvidencePort` and the real Task completion owner over
 * the SAME records as the line fixture, through the public services only:
 *  - the project CompletionPolicy is installed and activated with the real
 *    `createProjectBootstrapServices`;
 *  - a checkable Goal/Plan (schemaVersion 2, a `static` verification
 *    requirement) is created through `createGoalService`/`createPlanService`;
 *  - a real workspace root is served through the real `WorkspaceHostBindings`
 *    shape the composition root uses;
 *  - `openVerification`, `beginCheck`, `recordCheckResult` and
 *    `finalizeChecks` come from the real `createEvidenceService` (no registered
 *    process check is ever run in this sandbox: the observation is a hand-built
 *    Host observation, which is exactly what the port accepts);
 *  - `completeTask` is the real Goal owner's completion path.
 *
 * Only the workspace root path and the trusted check configuration are test
 * data; no record is written directly.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type {
  CheckExecutionTicket, CheckProcessObservation, RoundSnapshot, TrustedCheckConfiguration, VerificationRoundRef,
} from '../../src/contracts/verification.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import type { EvidencePort, FinalizedChecks } from '../../src/core/work-graph/model/evidence-contracts.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import type { TaskClaimFixture } from './task-claim-fixture.js';
import type { RunSupport } from './S2C-L-runs-support.js';

const AT = '2026-09-24T00:00:00.000Z';
export const S2C_L_CHECK_ID = 's2c-l-static-check';
const POLICY_ID = 's2c-l-static-policy';
const CONFIGURATION_REVISION = 's2c-l-checks-config-1';
const PERMISSION_REVISION = 's2c-l-permission-1';

export type LineCheckSupport = {
  readonly checkId: string;
  /** Install + activate the project CompletionPolicy the checkable Plan pins. */
  installPolicy(): Promise<void>;
  /** Add a schemaVersion-2 Goal/Plan with one `static` verification requirement. */
  addCheckableGoal(goalId: string, tasks: readonly { taskId: string; title: string }[]): Promise<{ goalRef: GoalRef; planRef: PlanRevisionRef; tasks: Record<string, TaskTriple> }>;
  openRound(subjectRunRef: RunRef, subject: TaskTriple, planRef: PlanRevisionRef, gateSubject?: 'goal' | 'stage' | 'module'): Promise<RoundSnapshot>;
  beginFirstCheck(round: RoundSnapshot): Promise<{ ticket: CheckExecutionTicket; round: RoundSnapshot }>;
  recordPass(roundRef: VerificationRoundRef, checkId: string, invocationId: string): Promise<RoundSnapshot>;
  /** 2C-03: record a `cancelled` observation so the round finalizes INCONCLUSIVE (`round_inconclusive`). */
  recordCancelled(roundRef: VerificationRoundRef, checkId: string, invocationId: string): Promise<RoundSnapshot>;
  finalize(roundRef: VerificationRoundRef): Promise<FinalizedChecks>;
  completeTask(planRef: PlanRevisionRef, task: TaskTriple, roundRef: VerificationRoundRef): Promise<void>;
  workspaceRoot(): string;
  close(): Promise<void>;
};

export function createLineCheckSupport(input: {
  base: TaskClaimFixture;
  records: TaskClaimFixture['records'];
  runs: RunSupport;
  ctx: CoreCallContext;
  addCheckableGoalInternal(goalId: string, tasks: readonly { taskId: string; title: string }[]): Promise<{ goalRef: GoalRef; planRef: PlanRevisionRef; tasks: Record<string, TaskTriple> }>;
}): LineCheckSupport {
  const { base, records, runs, ctx } = input;
  const scope = base.scope;
  const workspaceRef = base.workspaceRef as WorkspaceRef;
  let seq = 0;
  const eventId = () => `s2c-l-check-event-${++seq}`;
  const newId = () => `s2c-l-check-id-${++seq}`;
  let root: string | null = null;
  const bodies = runs.bodies;
  const authority = createMaterialRecordReaders(records).authority;
  const materials = createMaterialService({ bodies, authority, now: () => AT });
  const executions = createRunStateReader({ records });
  const configuration: TrustedCheckConfiguration = {
    configurationRevision: CONFIGURATION_REVISION,
    workspace: workspaceRef,
    executor: ctx.principal.kind === 'host' ? ctx.principal.actor : { kind: 'human', id: 's2c-l-check-host' },
    permissionRevision: PERMISSION_REVISION,
    sourceAccess: 'verification_workspace',
    processAccess: 'all_except_denied',
    deniedPrefixes: ['.git'],
    checks: [{ checkId: S2C_L_CHECK_ID, kind: 'static', command: 'echo S2C_L_CHECK_OK',
      cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };

  async function ensureRoot(): Promise<string> {
    if (root === null) {
      root = join(base.directory, 's2c-l-check-workspace');
      await mkdir(root, { recursive: true });
      await writeFile(join(root, 'input.txt'), 's2c-l verification source\n');
    }
    return root;
  }

  async function currentWorkspaceRevision(): Promise<number> {
    const read = await records.readMany([canonicalRefKey(workspaceRef)]);
    if (read.status !== 'ready') throw new Error(`S2C-L workspace read failed: ${JSON.stringify(read)}`);
    const record = read.value.records.find((entry) => entry.refKey === canonicalRefKey(workspaceRef));
    if (record === undefined) throw new Error('S2C-L workspace record is absent');
    return JSON.parse(record.json).revision as number;
  }

  const workspaceHost: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      if (requested.projectId !== scope.projectId || requested.workspaceId !== scope.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'S2C-L check workspace is not registered' };
      }
      return { status: 'ready', value: { root: await ensureRoot(), workspaceRevision: await currentWorkspaceRevision() } };
    },
    async authorize(authCtx, requested) {
      if (authCtx.principal.kind !== 'host' || requested.projectId !== scope.projectId
        || requested.workspaceId !== scope.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'S2C-L check Host does not authorize the source' };
      }
      return { status: 'ready', value: { subjectKey: `host:${authCtx.principal.actor.id}`,
        permissionRevision: PERMISSION_REVISION, allowsRead: () => true } };
    },
  };

  const evidence: EvidencePort = createEvidenceService({
    records, materials, executions, workspaceHost,
    source: new VerificationWorkspaceReader(), configuration, now: () => AT, newId,
  });

  async function installPolicy(): Promise<void> {
    const bootstrap = createProjectBootstrapServices({ records, now: () => AT, eventId });
    const projectRef = base.projectRef;
    const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: scope.projectId,
      policyId: POLICY_ID, revision: 1 };
    const installed = await bootstrap.completionPolicies.installCompletionPolicy(ctx, {
      meta: { requestId: `s2c-l-install-policy`, expected: [
        { ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
      input: { policyId: POLICY_ID, contentRevision: 1,
        content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } },
    });
    if (installed.status !== 'committed') throw new Error(`S2C-L policy install failed: ${JSON.stringify(installed)}`);
    const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: scope.projectId };
    const activated = await bootstrap.completionPolicies.activateCompletionPolicy(ctx, {
      meta: { requestId: `s2c-l-activate-policy`, expected: [
        { ref: projectRef, revision: 1 }, { ref: activeRef, revision: 1 }] },
      input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } },
    });
    if (activated.status !== 'committed') throw new Error(`S2C-L policy activation failed: ${JSON.stringify(activated)}`);
  }

  async function openRound(subjectRunRef: RunRef, subject: TaskTriple, planRef: PlanRevisionRef,
    gateSubject?: 'goal' | 'stage' | 'module'): Promise<RoundSnapshot> {
    const opened = await evidence.openVerification(ctx, { input: { subjectRunRef, subject, planRef,
      ...(gateSubject === undefined ? {} : { gateSubject }) },
      meta: { requestId: `s2c-l-open-${++seq}`, expected: [] } });
    if (opened.status !== 'committed') throw new Error(`S2C-L open verification failed: ${JSON.stringify(opened)}`);
    return opened.value;
  }

  async function readRound(roundRef: VerificationRoundRef): Promise<RoundSnapshot> {
    const read = await evidence.readVerification(ctx, roundRef);
    if (read.status !== 'ready') throw new Error(`S2C-L round read failed: ${JSON.stringify(read)}`);
    return read.value;
  }

  async function beginFirstCheck(round: RoundSnapshot): Promise<{ ticket: CheckExecutionTicket; round: RoundSnapshot }> {
    const check = round.checks[0];
    if (check === undefined) throw new Error('S2C-L round has no compiled check');
    const begun = await evidence.beginCheck(ctx, { input: { roundRef: round.ref, checkId: check.checkId },
      meta: { requestId: `s2c-l-begin-${++seq}`, expected: [{ ref: round.ref, revision: round.revision }] } });
    if (begun.status !== 'committed') throw new Error(`S2C-L begin check failed: ${JSON.stringify(begun)}`);
    return { ticket: begun.value, round: await readRound(round.ref) };
  }

  async function recordPass(roundRef: VerificationRoundRef, checkId: string, invocationId: string): Promise<RoundSnapshot> {
    return recordWith(roundRef, checkId, invocationId, { kind: 'executed', startedAt: AT, finishedAt: AT,
      exitCode: 0, signal: null, timedOut: false, cancelled: false,
      stdout: { text: 'S2C_L_CHECK_OK', totalBytes: 15, truncated: false },
      stderr: { text: '', totalBytes: 0, truncated: false },
      effects: { workspaceRevision: '1', changedPaths: [] }, sandboxProfileVersion: 's2c-l-check@1' });
  }

  async function recordCancelled(roundRef: VerificationRoundRef, checkId: string, invocationId: string): Promise<RoundSnapshot> {
    return recordWith(roundRef, checkId, invocationId, { kind: 'executed', startedAt: AT, finishedAt: AT,
      exitCode: null, signal: null, timedOut: false, cancelled: true,
      stdout: { text: '', totalBytes: 0, truncated: false },
      stderr: { text: '', totalBytes: 0, truncated: false },
      effects: { workspaceRevision: '1', changedPaths: [] }, sandboxProfileVersion: 's2c-l-check@1' });
  }

  async function recordWith(roundRef: VerificationRoundRef, checkId: string, invocationId: string,
    observation: CheckProcessObservation): Promise<RoundSnapshot> {
    const current = await readRound(roundRef);
    const recorded = await evidence.recordCheckResult(ctx, { input: { roundRef, checkId, invocationId, observation },
      meta: { requestId: `s2c-l-record-${++seq}`, expected: [{ ref: roundRef, revision: current.revision }] } });
    if (recorded.status !== 'committed') throw new Error(`S2C-L record check failed: ${JSON.stringify(recorded)}`);
    return recorded.value;
  }

  async function finalize(roundRef: VerificationRoundRef): Promise<FinalizedChecks> {
    const current = await readRound(roundRef);
    const finalized = await evidence.finalizeChecks(ctx, { input: { roundRef },
      meta: { requestId: `s2c-l-finalize-${++seq}`, expected: [{ ref: roundRef, revision: current.revision }] } });
    if (finalized.status !== 'committed') throw new Error(`S2C-L finalize failed: ${JSON.stringify(finalized)}`);
    return finalized.value;
  }

  async function completeTask(planRef: PlanRevisionRef, task: TaskTriple, roundRef: VerificationRoundRef): Promise<void> {
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId };
    const goalRead = await base.plans.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error(`S2C-L goal read failed: ${JSON.stringify(goalRead)}`);
    const reductionRef = { aggregateType: 'TaskReduction' as const, projectId: task.projectId,
      goalId: task.goalId, taskId: task.taskId };
    const completed = await base.goals.completeTask(ctx, { input: { taskRef: task, planRef, roundRef },
      meta: { requestId: `s2c-l-complete-${++seq}`, expected: [
        { ref: goalRef, revision: goalRead.value.goal.revision }, { ref: reductionRef, revision: 0 }] } });
    if (completed.status !== 'committed') throw new Error(`S2C-L complete task failed: ${JSON.stringify(completed)}`);
  }

  return {
    checkId: S2C_L_CHECK_ID,
    installPolicy,
    addCheckableGoal: (goalId, tasks) => input.addCheckableGoalInternal(goalId, tasks),
    openRound,
    beginFirstCheck,
    recordPass,
    recordCancelled,
    finalize,
    completeTask,
    workspaceRoot: () => root ?? '',
    close: async () => { if (root !== null) await rm(root, { recursive: true, force: true }); },
  };
}
