/**
 * Wiring 1 CU givens (wiring-1-SPEC §0 takes precedence).
 *
 * openDutyMaintenanceFixture [DU09]: real scope/governance, two installed pinned
 * RoleSpecs, two responsible Sessions, two formally satisfied Tasks and terminal
 * closes at t0; returns an uncalled maintenance service at t1.
 * assemblerWithFacts [GC03, GC04, AN08]: the real assembler with typed graph-fact
 * doubles, an unbound Work claim and a Query over the same Goal/Plan/Run sources.
 * startRefusalWorkflow [WF01, WF02]: an uncalled perform/start continuation;
 * startRun alone returns the supplied refusal, every other owner call throws.
 *
 * DU09 keeps S1-workflow-archive-fixture's r4c-claim-project/workspace IDs.
 * Its responsible RoleSpec Sessions do not need to be the legacy-template Run
 * producers: responsibility and execution are separate facts. Both Tasks are
 * completed by the real evidence/completion owners, never cancelled or patched.
 * All other fixtures use p/w. No new WP1 production symbol is imported here.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { PromptSetV1 } from '../../src/contracts/prompts/prompt-set.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { GoalRef, GoalSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import type { ContextExtensionsV1 } from '../../src/contracts/graph-context.js';
import { roleSpecContentDigest, type RoleSpecContentV1 } from '../../src/contracts/role-spec.js';
import type { RoleSpecResolutionV1 } from '../../src/contracts/role-spec-materials.js';
import type { CheckProcessObservation } from '../../src/contracts/verification.js';
import type { SessionAnomalyAnchorRef } from '../../src/contracts/session-anomaly.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import { DEFAULT_SESSION_ARCHIVE_POLICY, type WorkflowDependencies, type WorkflowHostConfiguration,
  type WorkflowPort } from '../../src/business/workflow/ports.js';
import { createSessionMaintenanceService, type SessionMaintenancePort } from '../../src/business/workflow/session-maintenance.js';
import { createSessionArchiveService } from '../../src/business/workflow/session-archive.js';
import { createContextAssembler, type ContextAssembler } from '../../src/core/agent-runtime/context-assembler.js';
import type { PrepareTaskExecutionRequest, ResolvedRuntimeConfiguration } from '../../src/core/agent-runtime/execution-contracts.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { RoleConfigurationPort } from '../../src/core/work-graph/model/configuration-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { GraphContextFactsV1 } from '../../src/core/work-graph/model/graph-context-contracts.js';
import type { QueryPreparationFacts } from '../../src/core/work-graph/queries/contracts.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createSessionResponsibilityBasisReader } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createSessionResponsibilityService } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS, sessionResponsibilityChangedEventFromEvent } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS, sessionAnomalyRefKey } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createB2ExecutionFixture, completeWork, type B2ExecutionFixture } from './S1-workflow-archive-fixture.js';
import { createScriptedModel } from './B2-runtime-fixture.js';

const T0 = '2026-10-08T00:00:00.000Z';
const T1 = '2026-10-09T00:00:00.000Z';

function readValue<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`CU setup read: ${JSON.stringify(result)}`);
  return result.value;
}
function writeValue<T>(result: WriteResult<T>): T {
  if (result.status !== 'committed') throw new Error(`CU setup write: ${JSON.stringify(result)}`);
  return result.value;
}
function forbidden(): never { throw new Error('unexpected CU fixture port call'); }

type DutyMaintenanceFixture = {
  b2: B2ExecutionFixture;
  ctx: CoreCallContext;
  scope: WorkspaceScope;
  t0: string;
  t1: string;
  goalRef: GoalRef;
  plan: PlanRevisionSnapshot;
  S1: SessionRef;
  S2: SessionRef;
  roles: { R1: Extract<RoleConfigurationRef, { kind: 'role_spec' }>; R2: Extract<RoleConfigurationRef, { kind: 'role_spec' }> };
  tasks: { S1: TaskClaim['task']; S2: TaskClaim['task'] };
  claims: readonly TaskClaim[];
  configuration: WorkflowHostConfiguration;
  readRoleSpec: RoleConfigurationPort['readRoleSpec'];
  maintenance: SessionMaintenancePort;
  /** Late injection solves the resolver's dependency on this fixture's real reader/configuration. */
  withSessionDuty(sessionDuty: WorkflowDependencies['sessionDuty']): SessionMaintenancePort;
  readSession(ref: SessionRef): ReturnType<B2ExecutionFixture['base']['sessionsPort']['readSession']>;
  lifecycle(ref: SessionRef): Promise<SessionRecord['lifecycle']>;
  readFacts(ref: SessionRef): ReturnType<ReturnType<typeof createSessionFactsService>['readSessionFacts']>;
  terminalClose(ref: SessionRef): Promise<Extract<ReturnType<typeof sessionResponsibilityChangedEventFromEvent>, { status: 'decoded' }>['value']>;
  readGraph(): ReturnType<B2ExecutionFixture['base']['plans']['queryTaskGraph']>;
  close(): Promise<void>;
};

/** DU09. Call withSessionDuty(createSessionDutyResolver({readRoleSpec,configuration}))
 * after opening when the resolver needs the returned reader. Nothing calls it in setup.
 * This fixture owns Date-only fake timers (lifecycle has no injected clock); close restores them.
 */
export async function openDutyMaintenanceFixture(
  sessionDuty?: WorkflowDependencies['sessionDuty'],
): Promise<DutyMaintenanceFixture> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(T0));
  const schemas = [SESSION_LIFECYCLE_RECORD_SCHEMAS, SESSION_MESSAGE_RECORD_SCHEMAS,
    SESSION_ANOMALY_RECORD_SCHEMAS, QUERY_JOB_RECORD_SCHEMAS, CONTROL_RECORD_SCHEMAS,
    EVIDENCE_RECORD_SCHEMAS, COMPLETION_RECORD_SCHEMAS];
  let b2: B2ExecutionFixture | undefined;
  try {
    b2 = await createB2ExecutionFixture('memory', {
      records: schemas.flatMap(s => s.records), events: schemas.flatMap(s => s.events),
      lookups: schemas.flatMap(s => s.lookups ?? []),
    }, () => T0);
    const base = b2.base;
    const { ctx, scope, records } = base;
    if (ctx.principal.kind !== 'host') throw new Error('CU needs the fixture Host');
    const actor = ctx.principal.actor;
    let sequence = 0;
    const id = () => `wp1-cu-${++sequence}`;
    const roleService = createRoleConfigurationService({ records, now: () => T0, eventId: id });
    const install = async (roleId: string, secretary: boolean): Promise<Extract<RoleConfigurationRef, { kind: 'role_spec' }>> => {
      const content: RoleSpecContentV1 = {
        schemaVersion: 1, ...(secretary ? { platformDuty: 'secretary' as const } : {}),
        label: roleId, purpose: 'Own the assigned task', responsibility: ['execution'],
        requiredMaterials: [{ kind: 'contract', reason: 'Read the assigned Plan/Task' }], optionalMaterials: [],
        permissions: { tools: ['read'], writeScope: 'none' }, budget: { source: 'task-budget', scope: 'assigned-task' },
        requiredOutputs: [{ kind: 'implementation-result', reason: 'Report actual results' }],
        exit: { success: 'Report the result', stop: 'Report the blocker', handoff: 'Keep references' },
      };
      // role-memory-service.ts:317-345: trusted actor, canonical content digest;
      // ROLE_RECORD_SCHEMAS is already registered by the S1 base fixture.
      const installed = await roleService.installRoleSpec(ctx, {
        commandId: `install-${roleId}`, commandType: 'InstallRoleSpecRevision', schemaVersion: 1,
        identity: { projectId: scope.projectId, actor, idempotencyKey: `install-${roleId}` },
        correlationId: roleId, submittedAt: T0,
        payload: { roleId, revision: 1, content, contentDigest: roleSpecContentDigest(content, roleId, 1) },
      });
      if (installed.status !== 'committed') throw new Error(`CU role install: ${JSON.stringify(installed)}`);
      return { kind: 'role_spec', pin: { ref: installed.revisionRef, digest: installed.contentDigest } };
    };
    const R1 = await install('wp1-cu-r1', true);
    const R2 = await install('wp1-cu-r2', false);
    // Exact historical pins do not require activating a RoleSpec catalog.
    const S1 = await base.createSession('wp1-cu-s1', R1);
    const S2 = await base.createSession('wp1-cu-s2', R2);
    const configuration: WorkflowHostConfiguration = {
      consumerId: 'wp1-cu-consumer',
      bindings: [R1, R2].map((sessionRole, i) => ({ workspace: scope, sessionRole,
        roleBinding: { ...base.roleBinding, bindingId: `wp1-cu-work-${i + 1}` }, budget: base.budget })),
    };

    // Copy the public static-policy/new-Goal path in R3e-evidence-fixture:170-220.
    // Do not use that helper's older raw-seeded base or S1's cancellation shortcut.
    const bootstrap = createProjectBootstrapServices({ records, now: () => T0, eventId: id });
    const policy = writeValue(await bootstrap.completionPolicies.installCompletionPolicy(ctx, {
      input: { policyId: 'wp1-cu-policy', contentRevision: 1,
        content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } },
      meta: { requestId: 'wp1-cu-policy-install', expected: [
        { ref: base.projectRef, revision: 1 },
        { ref: { aggregateType: 'CompletionPolicyRevision', projectId: scope.projectId, policyId: 'wp1-cu-policy', revision: 1 }, revision: 0 },
      ] },
    }));
    writeValue(await bootstrap.completionPolicies.activateCompletionPolicy(ctx, {
      input: { target: { ref: policy.ref, digest: policy.contentDigest } },
      meta: { requestId: 'wp1-cu-policy-activate', expected: [{ ref: base.projectRef, revision: 1 },
        { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: scope.projectId }, revision: 1 }] },
    }));
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId: 'wp1-cu-goal' };
    writeValue(await base.goals.createGoal(ctx, {
      input: { goalId: goalRef.goalId, workspace: scope, objective: 'Two satisfied responsibilities at t0' },
      meta: { requestId: 'wp1-cu-goal', expected: [{ ref: base.projectRef, revision: 1 }, { ref: base.workspaceRef, revision: 1 }] },
    }));
    const taskIds = ['wp1-cu-task-1', 'wp1-cu-task-2'];
    const draft: PlanRevisionDraft = {
      schemaVersion: 2, planId: 'wp1-cu-plan', planRevision: 1, goalId: goalRef.goalId, stages: [],
      tasks: [...taskIds.map(taskId => ({ taskId, title: taskId, requirementLevel: 'required' as const,
        taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const } })),
      { taskId: 'wp1-cu-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
      assignments: taskIds.map(taskId => ({ taskId, role: 'builder', instruction: `Deliver ${taskId}` })),
      obligations: [{ obligationId: 'wp1-cu-obligation', title: 'Deliver both tasks', requirementLevel: 'required',
        taskIds: [...taskIds, 'wp1-cu-gate'], verificationRequirements: [{ requirementId: 'wp1-cu-static',
          requirementLevel: 'required', kind: 'static', description: 'Registered static check' }] }],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
    };
    const proposal = writeValue(await base.plans.proposePlan(ctx, {
      input: { goalRef, basedOn: null, draft, reason: { text: 'DU09 independent tasks', sources: [] } },
      meta: { requestId: 'wp1-cu-propose', expected: [{ ref: goalRef, revision: 1 }] },
    }));
    if (proposal.issues.length > 0) throw new Error(`CU plan issues: ${JSON.stringify(proposal.issues)}`);
    const plan = writeValue(await base.plans.applyPlanChange(ctx, {
      input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] },
      meta: { requestId: 'wp1-cu-apply', expected: [{ ref: goalRef, revision: 1 }] },
    }));
    const task1 = { projectId: scope.projectId, goalId: goalRef.goalId, taskId: taskIds[0]! };
    const task2 = { projectId: scope.projectId, goalId: goalRef.goalId, taskId: taskIds[1]! };
    const facts = createSessionFactsService({ records });
    const lifecycle = createSessionLifecycleService({ records, lookups: records, sessionFacts: facts });
    const responsibilities = createSessionResponsibilityService({ records, lookups: records,
      basis: createSessionResponsibilityBasisReader(records), now: () => T0 });
    const executions = createRunStateReader({ records });
    // Stable real source capture, outside the changing Kernel/ledger files.
    const root = join(base.directory, 'wp1-cu-verification');
    await mkdir(root);
    await writeFile(join(root, 'input.txt'), 'CU stable verification input\n');
    const workspaceHost: WorkspaceHostBindings = {
      async resolveRoot(workspace) {
        if (workspace.projectId !== scope.projectId || workspace.workspaceId !== scope.workspaceId) return forbidden();
        return { status: 'ready', value: { root, workspaceRevision: 1 } };
      },
      async authorize(authCtx, workspace) {
        if (authCtx.principal.kind !== 'host' || authCtx.projectId !== scope.projectId
          || authCtx.workspaceId !== scope.workspaceId || workspace.projectId !== scope.projectId
          || workspace.workspaceId !== scope.workspaceId) return forbidden();
        return { status: 'ready', value: { subjectKey: 'host:wp1-cu', permissionRevision: 'wp1-cu-permission', allowsRead: () => true } };
      },
    };
    const materials = createMaterialService({ bodies: b2.bodies,
      authority: createMaterialRecordReaders(records).authority, now: () => T0 });
    const evidence = createEvidenceService({ records, materials, executions, workspaceHost,
      source: new VerificationWorkspaceReader(), now: () => T0, newId: id,
      configuration: { configurationRevision: 'wp1-cu-checks', workspace: base.workspaceRef, executor: actor,
        permissionRevision: 'wp1-cu-permission', sourceAccess: 'verification_workspace', processAccess: 'all_except_denied',
        deniedPrefixes: ['.git'], checks: [{ checkId: 'wp1-cu-check', kind: 'static', command: 'echo CU_OK',
          cwd: '.', timeoutMs: 60000, taskIds: 'all' }] },
    });
    const claims: TaskClaim[] = [];
    for (const [session, task] of [[S1, task1], [S2, task2]] as const) {
      // session-lifecycle.ts:494-535 accepts the real same-Goal target and current Session pin.
      const link = writeValue(await lifecycle.linkSessionWork(ctx, {
        input: { sessionRef: session, target: { kind: 'task', ref: task }, relation: 'responsible', active: true },
        meta: { requestId: `link-${task.taskId}`, expected: [await base.sessionPin(session),
          { ref: { ...session, aggregateType: 'SessionWorkLink', target: { kind: 'task', ref: task }, relation: 'responsible' }, revision: 0 }] },
      }));
      const producer = await base.createSession(`producer-${task.taskId}`);
      const goal = readValue(await base.plans.queryGoal(ctx, goalRef)).goal;
      const claim = writeValue(await base.service.claimTask(ctx, {
        input: { goalRef, planRef: plan.ref, taskId: task.taskId, sessionRef: producer,
          roleBinding: base.roleBinding, budget: base.budget },
        meta: { requestId: `claim-${task.taskId}`, expected: [{ ref: goalRef, revision: goal.revision },
          { ref: base.workspaceRef, revision: 1 }, await base.sessionPin(producer)] },
      }));
      claims.push(claim);
      await completeWork(b2, claim); // claim -> prepare -> authorize -> enter -> recordRunResult.
      let round = writeValue(await evidence.openVerification(ctx, {
        input: { subjectRunRef: claim.runRef, subject: task, planRef: plan.ref },
        meta: { requestId: `open-${task.taskId}`, expected: [] },
      }));
      for (const check of round.checks) {
        const ticket = writeValue(await evidence.beginCheck(ctx, {
          input: { roundRef: round.ref, checkId: check.checkId },
          meta: { requestId: `begin-${task.taskId}-${check.checkId}`, expected: [{ ref: round.ref, revision: round.revision }] },
        }));
        round = readValue(await evidence.readVerification(ctx, round.ref));
        // Trusted process observation, exactly the R3e-completion.test.ts:43-82
        // owner boundary; no process/model runs and no Evidence/PASS is seeded.
        const observation: CheckProcessObservation = { kind: 'executed', startedAt: T0, finishedAt: T0,
          exitCode: 0, signal: null, timedOut: false, cancelled: false,
          stdout: { text: 'CU_OK\n', totalBytes: 6, truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
          effects: { workspaceRevision: 'wp1-cu-workspace-1', changedPaths: [] }, sandboxProfileVersion: 'bwrap-m3-v4' };
        round = writeValue(await evidence.recordCheckResult(ctx, {
          input: { roundRef: round.ref, checkId: check.checkId, invocationId: ticket.invocationId, observation },
          meta: { requestId: `record-${task.taskId}-${check.checkId}`, expected: [{ ref: round.ref, revision: round.revision }] },
        }));
      }
      const finalized = writeValue(await evidence.finalizeChecks(ctx, {
        input: { roundRef: round.ref },
        meta: { requestId: `finalize-${task.taskId}`, expected: [{ ref: round.ref, revision: round.revision }] },
      }));
      const currentGoal = readValue(await base.plans.queryGoal(ctx, goalRef)).goal;
      writeValue(await base.goals.completeTask(ctx, {
        input: { taskRef: task, planRef: plan.ref, roundRef: finalized.snapshot.ref },
        meta: { requestId: `complete-${task.taskId}`, expected: [{ ref: goalRef, revision: currentGoal.revision },
          { ref: { aggregateType: 'TaskReduction', ...task }, revision: 0 }] },
      }));
      // plan-readers.ts:1725-1727 supplies the reduction's reducedAt=t0;
      // session-responsibility-service.ts:775-842 requires BOTH Session/link pins.
      writeValue(await responsibilities.closeTerminalResponsibility(ctx, {
        input: { sessionRef: session, target: { kind: 'task', ref: task } },
        meta: { requestId: `terminal-${task.taskId}`, expected: [await base.sessionPin(session),
          { ref: link.ref, revision: link.revision }, { ref: goalRef, revision: currentGoal.revision }] },
      }));
    }
    vi.setSystemTime(new Date(T1));
    const readSession = (ref: SessionRef) => base.sessionsPort.readSession(ctx, ref);
    const withSessionDuty = (duty: WorkflowDependencies['sessionDuty']): SessionMaintenancePort => {
      const deps = { sessions: base.sessionsPort, plans: base.plans, claims: base.service, executions,
        sessionFacts: facts, sessionLifecycle: lifecycle, responsibilities,
        archivePolicy: DEFAULT_SESSION_ARCHIVE_POLICY, now: () => T1,
        ...(duty === undefined ? {} : { sessionDuty: duty }) };
      return createSessionMaintenanceService({ ...deps, archive: createSessionArchiveService(deps),
        records: { async eventAt(cursor) {
          const event = await records.eventAt(cursor);
          return event.status === 'ready' ? { status: 'ready', value: event.value }
            : { status: 'rejected', code: 'unavailable', reason: event.reason };
        } } });
    };
    const openedB2 = b2;
    return { b2, ctx, scope, t0: T0, t1: T1, goalRef, plan, S1, S2, roles: { R1, R2 },
      tasks: { S1: task1, S2: task2 }, claims, configuration,
      readRoleSpec: roleService.readRoleSpec.bind(roleService), maintenance: withSessionDuty(sessionDuty), withSessionDuty,
      readSession, lifecycle: async ref => readValue(await readSession(ref)).record.lifecycle,
      readFacts: ref => facts.readSessionFacts(ctx, ref),
      async terminalClose(ref) {
        const card = readValue(await readSession(ref));
        const link = card.links.find(candidate => candidate.ref.relation === 'responsible' && candidate.until !== null);
        if (link?.until == null) throw new Error('CU terminal close is absent');
        const event = await records.eventAt(link.until);
        if (event.status !== 'ready') throw new Error(`CU close event: ${JSON.stringify(event)}`);
        const decoded = sessionResponsibilityChangedEventFromEvent(event.value.event);
        if (decoded.status !== 'decoded') throw new Error(decoded.reason);
        return decoded.value;
      },
      readGraph: () => base.plans.queryTaskGraph(ctx, { goalRef }),
      async close() { try { await openedB2.close(); } finally { vi.useRealTimers(); } },
    };
  } catch (error) {
    try { await b2?.close(); } finally { vi.useRealTimers(); }
    throw error;
  }
}

type AssemblerFactsOptions = {
  sources?: GraphContextFactsV1['sources'];
  extensions?: ContextExtensionsV1;
  /** The assembler's resident byte budget, not the model token budget. */
  budget?: number;
};
type AssemblerFactsFixture = {
  assembler: ContextAssembler;
  ctx: CoreCallContext;
  facts: GraphContextFactsV1;
  goal: GoalSnapshot;
  objective: string;
  workspace: WorkspaceSnapshot;
  workspaceRevision: number;
  taskInput: Parameters<ContextAssembler['assembleTask']>[1];
  queryInput: Parameters<ContextAssembler['assembleQuery']>[1];
  anomalyRow: ContextExtensionsV1['anomalies']['rows'][number];
  anomalyExtensions: ContextExtensionsV1;
  assembleTask(): ReturnType<ContextAssembler['assembleTask']>;
  assembleQuery(): ReturnType<ContextAssembler['assembleQuery']>;
  graphReads(): number;
};

function emptyExtensions(): ContextExtensionsV1 {
  return { notes: { availability: 'not_implemented', understanding: { rows: [], norms: [], normsOmitted: 0 }, general: [] },
    anomalies: { availability: 'not_implemented', rows: [] },
    footprint: { availability: 'not_implemented', rows: [] }, decisions: { availability: 'not_implemented', rows: [] },
    goalSettings: { availability: 'not_implemented', autonomy: null } };
}

/** GC03/GC04/AN08. Typed doubles follow S3-context-assembler.test.ts:207-291.
 * AN08 can pass {extensions: assemblerWithFacts().anomalyExtensions, budget:4096}.
 * This constructor does not assemble; assembleTask/assembleQuery are the actions.
 */
export function assemblerWithFacts(options: AssemblerFactsOptions = {}): AssemblerFactsFixture {
  const actor = { kind: 'human' as const, id: 'wp1-cu-operator' };
  const ctx: CoreCallContext = { projectId: 'p', workspaceId: 'w', principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: 'p', workspaceId: 'w', actor }, signal: new AbortController().signal };
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: 'p', goalId: 'g' };
  const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: 'p', planId: 'p1' };
  const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId: 'p', workspaceId: 'w' }, revision: 7 };
  const goal: GoalSnapshot = { ref: goalRef, workspaceRef: workspace.ref, objective: 'Ship A\n第二行',
    revision: 1, desiredState: 'active', desiredStateRevision: 1, desiredStateRequestedBy: null, activePlanRevision: planRef };
  const plan: PlanRevisionSnapshot = { schemaVersion: 2, ref: planRef, revision: 1, goalRef, planId: 'p1', planRevision: 1,
    acceptedAt: T0,
    effectiveCompletionPolicy: { ref: { aggregateType: 'CompletionPolicyRevision', projectId: 'p', policyId: 'policy', revision: 1 }, digest: sha256Hex('policy') },
    effectiveArchitectureBaseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: 'p', baselineId: 'baseline', revision: 1 }, digest: sha256Hex('baseline') },
    stages: [], tasks: [{ taskId: 't1', title: 'A', requirementLevel: 'required', taskKind: 'work', disposition: 'active',
      phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' }],
    assignments: [{ taskId: 't1', role: 'builder', instruction: 'Implement A' }],
    obligations: [{ obligationId: 'o1', title: 'Deliver A', requirementLevel: 'required', taskIds: ['t1'],
      verificationRequirements: [{ requirementId: 'v1', requirementLevel: 'required', kind: 'static', description: 'Check A' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
  const claim: TaskClaim = { task: { projectId: 'p', goalId: 'g', taskId: 't1' }, planRef, workspaceId: 'w',
    sessionRef: { projectId: 'p', sessionId: 's1' }, sessionRevision: 1, generation: 1,
    runRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r1' },
    attemptRef: { aggregateType: 'TaskAttempt', projectId: 'p', goalId: 'g', taskId: 't1', attemptId: 'a1' },
    outboxRef: { aggregateType: 'DispatchOutboxEntry', projectId: 'p', goalId: 'g', taskId: 't1', attemptId: 'a1' }, claimedAt: T0 };
  const execution: TaskExecutionRecord = {
    run: { ref: claim.runRef, revision: 1, schemaVersion: 1, task: claim.task, attemptId: 'a1', planRef,
      roleBinding: { schemaVersion: 1, bindingId: 'cu-builder', templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' },
      budget: { tokenBudget: 4096, deadline: null }, workspaceSnapshot: { workspaceId: 'w', revision: workspace.revision },
      status: 'starting', outcome: null, exitCode: null, lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '',
      envelope: null, startedAt: null, endedAt: null },
    attempt: { ref: claim.attemptRef, revision: 1, schemaVersion: 1, runId: 'r1', planRef,
      status: 'claimed', startedAt: null, endedAt: null, endOutcome: null },
    outbox: { ref: claim.outboxRef, revision: 1, schemaVersion: 1, status: 'pending', claim }, plan,
    session: { ref: { aggregateType: 'Session', ...claim.sessionRef }, revision: 1,
      kernel: { adapterId: 'cu-kernel', kernelSessionId: 'cu-kernel-s1' }, lifecycle: 'active', health: 'available',
      role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' }, workspaceId: 'w',
      lastExecutionRef: null, occupancy: null, historyCursor: null, createdAt: T0, archivedAt: null,
      provenance: { schemaVersion: 1, kind: 'new' } },
    lease: null, readThrough: null,
  };
  const facts: GraphContextFactsV1 = { goal, graph: null, architecture: null, executions: [], inputs: [], readThrough: null,
    extensions: options.extensions ?? emptyExtensions(),
    // Deliberately unsorted: GC03 must sort after replacing only the Goal digest.
    sources: options.sources ?? [
      { kind: 'record', ref: claim.runRef, revision: 1, digest: null },
      { kind: 'record', ref: planRef, revision: 1, digest: null },
      { kind: 'record', ref: goalRef, revision: 1, digest: null },
    ],
  };
  const configuration: ResolvedRuntimeConfiguration = {
    configurationRevision: 'cu-host@1', model: { configuration: { revision: 'cu-model@1', provider: 'scripted', model: 'cu', baseUrl: 'http://127.0.0.1' },
      client: createScriptedModel([]).client },
    budget: { contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: 4, maxToolCalls: 8,
      timeoutMs: null, perResponseTokens: 512 },
    hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex('cu-template') },
    tools: ['read'], writeScope: [], skills: { resourceRoot: 'resources/skills', enabledIds: [] },
    systemInstruction: 'Static executor guidance.', deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
    platformDuty: 'executor', contextResidentBytes: options.budget ?? 4096,
  };
  const role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }> = {
    status: 'absent', roleId: 'builder', reason: 'The fixture uses the trusted legacy template',
  };
  const taskInput: AssemblerFactsFixture['taskInput'] = { execution, role, configuration,
    permissions: { policyRevision: 'legacy-template', tools: ['read'], writeScope: [] },
    toolNames: ['read'],
    history: { callKind: 'work', hasCompletedCursor: false } };
  // S3-context-assembler.test.ts:551 supplies the same Query seam; retain a
  // complete typed record here so no cast masks a missing field in the double.
  const queryJobRef: QueryPreparationFacts['record']['job']['ref'] = {
    aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'w', queryJobId: 'cu-query',
  };
  const queryRunRef: QueryPreparationFacts['record']['run']['ref'] = {
    aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'w', queryJobId: 'cu-query', runId: 'cu-query-run',
  };
  const question = 'What remains for A?';
  const queryFacts: QueryPreparationFacts = {
    record: {
      job: { ref: queryJobRef, revision: 1, schemaVersion: 1,
        submission: { schemaVersion: 1, identityKey: 'cu-query-submit',
          fingerprint: sha256Hex('cu-query-submit'), eventId: 'cu-query-submit-event' },
        job: { schemaVersion: 1,
        queryJobId: 'cu-query', projectId: 'p', workspaceId: 'w', goalId: 'g', status: 'pending',
        runRef: queryRunRef, answerRefs: [], closeReason: null, submittedAt: T0, updatedAt: T0,
        intent: { schemaVersion: 1, intentId: 'cu-query-intent', projectId: 'p', workspaceId: 'w', goalId: 'g',
          question, focusTaskRefs: [], budget: { maxTokens: 4096, deadline: null }, multiTurn: { maxRounds: 1 },
          correlationId: 'cu-query', execution: { kind: 'semantic_query', roleBinding: execution.run.roleBinding,
            runtimeBudget: configuration.budget } } } },
      run: { ref: queryRunRef, revision: 2, schemaVersion: 1, run: { schemaVersion: 1, queryJobRef,
        runId: queryRunRef.runId, status: 'pending', startedAt: null, endedAt: null, outcome: null,
        executionState: { schemaVersion: 1, phase: 'claimed', sessionRef: { projectId: 'p', sessionId: 'sq' },
          sessionGeneration: 2, role: execution.session.role, roleBinding: execution.run.roleBinding, roleResolution: role,
          priorHistoryCursor: null, prepared: null, entry: null, history: null, requests: [] } } },
      session: { ...execution.session, ref: { aggregateType: 'Session', projectId: 'p', sessionId: 'sq' }, revision: 2,
        kernel: { adapterId: 'cu-kernel', kernelSessionId: 'cu-kernel-sq' }, lastExecutionRef: queryRunRef,
        occupancy: { kind: 'execution', executionRef: queryRunRef, generation: 2 } },
      answer: null,
    },
    goal, workspace, focusPlan: null, initiator: actor,
  };
  const queryInput: AssemblerFactsFixture['queryInput'] = { facts: queryFacts, role, configuration,
    permissions: { tools: ['read'], writeScope: [] }, question,
    toolNames: ['read'],
    history: { callKind: 'query', hasCompletedCursor: false } };
  let graphReads = 0;
  const assembler = createContextAssembler({
    executions: { readExecution: async () => forbidden() },
    roles: { resolveRoleBindingFacts: async () => forbidden() },
    materials: { storeArtifact: async () => forbidden(), openArtifact: async () => forbidden() },
    bodies: new RawArtifactBodyStore(),
    graphContext: { async readContextFacts() { graphReads++; return { status: 'ready', value: facts }; },
      lookGraph: async () => forbidden(), findGraph: async () => forbidden(), readAttentionFacts: async () => forbidden() },
  });
  const anchorRef: SessionAnomalyAnchorRef = { aggregateType: 'SessionAnomalyAnchor', projectId: 'p', goalId: 'g', runId: 'r1' };
  const anomalyRow: AssemblerFactsFixture['anomalyRow'] = {
    key: `anomaly:${sessionAnomalyRefKey(anchorRef)}`, node: { kind: 'task', ref: claim.task, planRef },
    text: '中断，待核对：任务 t1 的执行 r1 被归档中断，改动没撤销也没核对',
    sources: [{ kind: 'record', ref: anchorRef, revision: 1, digest: null }],
  };
  return { assembler, ctx, facts, goal, objective: goal.objective, workspace, workspaceRevision: execution.run.workspaceSnapshot.revision,
    taskInput, queryInput, anomalyRow, anomalyExtensions: { ...emptyExtensions(), anomalies: { availability: 'available', rows: [anomalyRow] } },
    assembleTask: () => assembler.assembleTask(ctx, taskInput), assembleQuery: () => assembler.assembleQuery(ctx, queryInput),
    graphReads: () => graphReads };
}

type StartRefusalFixture = {
  workflow: WorkflowPort;
  ctx: CoreCallContext;
  input: Extract<WorkflowAdvanceInput, { kind: 'perform' }>;
  prepared: PreparedTaskExecution;
  manifest: PreparedTaskManifestV1;
  base: { goalRef: GoalRef; flowId: string; sessionHint: SessionRef | null; actor: { kind: 'human'; id: string }; taskId: null };
  expectedPrepareRequest: PrepareTaskExecutionRequest;
  calls: { ctx: CoreCallContext; request: Parameters<WorkflowDependencies['runtime']['startRun']>[1] }[];
};

/** PC-1b: a minimal valid frozen set; this Runtime double never stores or reads its bodies. */
const PROMPT_TEXT_CONTENT_TYPE = 'application/vnd.coding-platform.prompt-text;version=1';
const promptTextRef = (body: string): ArtifactRef => ({
  kind: 'artifact', contentType: PROMPT_TEXT_CONTENT_TYPE,
  digest: sha256Hex(body), sizeBytes: Buffer.byteLength(body, 'utf8'),
  source: { kind: 'workspace', refId: 'p', revision: '1' },
});
const PROMPT_SET: PromptSetV1 = {
  schemaVersion: 1, modelId: 'cu-model', provider: 'deepseek', model: 'cu-scripted', packId: 'platform',
  reasoningReplay: 'current_run',
  sectionOrder: { work: ['role', 'goal', 'task', 'footprint', 'notes', 'reminders', 'inputs', 'unknown_call_review'] },
  templates: [],
  strings: { digest: sha256Hex('{}'), ref: promptTextRef('{}') },
  base: { templateId: 'base', version: 1, digest: sha256Hex(''), ref: promptTextRef('') },
  skills: [],
  toolNames: ['read'],
  tools: [],
};

/** WF01/WF02. workflow.ts:425-507 validates ctx/base but reads no owner before
 * performStep(start):1353. No optional maintenance ports are installed (1464).
 */
export async function startRefusalWorkflow(
  startResult: Awaited<ReturnType<WorkflowDependencies['runtime']['startRun']>>,
): Promise<StartRefusalFixture> {
  const f = assemblerWithFacts();
  const { claim } = f.taskInput.execution.outbox;
  // This is the explicitly requested Runtime double, so no manifest is stored
  // or admitted; its context binding is still the production assembler's.
  const assembled = await f.assembleTask();
  if (assembled.status !== 'ready') throw new Error(`CU assembler refused: ${JSON.stringify(assembled)}`);
  const inputText = assembled.value.input;
  const manifest: PreparedTaskManifestV1 = {
    schemaVersion: 1, kind: 'task_execution', claim, role: f.taskInput.role,
    hostTemplate: f.taskInput.configuration.hostTemplate,
    roleBinding: f.taskInput.execution.run.roleBinding,
    hostConfigurationRevision: f.taskInput.configuration.configurationRevision,
    sessionRole: f.taskInput.execution.session.role,
    workspaceSnapshot: f.taskInput.execution.run.workspaceSnapshot,
    permissions: f.taskInput.permissions, budget: f.taskInput.execution.run.budget,
    selectedTaskInputs: assembled.value.selectedTaskInputs,
    materialBasis: null, materialAccessRefs: [], additionalMaterialRefs: [],
    deliveryRefs: [], sourceRefs: [], contextAssembly: assembled.value.binding,
    takesSessionHistory: assembled.value.takesSessionHistory, promptSet: PROMPT_SET,
    ...(assembled.value.sessionBasis === undefined ? {} : { sessionBasis: assembled.value.sessionBasis }),
    input: inputText, inputDigest: sha256Hex(inputText),
  };
  const body = JSON.stringify(manifest);
  const prepared: PreparedTaskExecution = { kind: 'task', claim,
    envelope: { schemaVersion: 1, envelopeId: 'cu-envelope', projectId: 'p', workspaceId: 'w', goalId: 'g', taskId: 't1',
      runRef: claim.runRef, attemptRef: claim.attemptRef, planRef: claim.planRef,
      roleBinding: f.taskInput.execution.run.roleBinding, workspaceSnapshot: { workspaceId: 'w', revision: f.workspaceRevision },
      permissions: f.taskInput.permissions, budget: f.taskInput.execution.run.budget, sourceRefs: [],
      bundleRef: { kind: 'artifact', contentType: 'application/vnd.coding-platform.task-execution-manifest+json;version=1',
        digest: sha256Hex(body), sizeBytes: Buffer.byteLength(body),
        source: { kind: 'workspace', refId: 'w', revision: String(f.workspaceRevision) } } },
    inputBinding: { schemaVersion: 1, inputDigest: sha256Hex(inputText), manifestDigest: sha256Hex(body),
      materialAccessRefs: [], deliveryRefs: [] },
  };
  const actor = { kind: 'human' as const, id: 'wp1-cu-operator' };
  const base: StartRefusalFixture['base'] = { goalRef: f.goal.ref, flowId: 'cu-start-flow', sessionHint: null, actor, taskId: null };
  // Exact pure copy of requestIdFor/prepareStep (workflow.ts:89-119), with a
  // concrete JSON-shaped object, so no broad cast is needed.
  const expectedPrepareRequest = { runRef: claim.runRef, requestId: 'wf:' + sha256Hex(canonicalJson({
    schemaVersion: 1, flowId: base.flowId, actor: base.actor, goalRef: base.goalRef,
    kind: 'prepare', requestWithoutRequestId: { runRef: claim.runRef },
  })) };
  const calls: StartRefusalFixture['calls'] = [];
  const deps: WorkflowDependencies = {
    tasks: { createGoal: forbidden, completeTask: forbidden, completeGoal: forbidden, setGoalControl: forbidden },
    plans: { proposePlan: forbidden, applyPlanChange: forbidden, queryGoal: forbidden, readPlanProposal: forbidden,
      queryTaskGraph: forbidden, queryReadyTasks: forbidden },
    sessions: { admitSessionCreation: forbidden, recordSessionCreated: forbidden, readSession: forbidden,
      findSessions: forbidden, getSessionOperation: forbidden },
    claims: { claimTask: forbidden }, executions: { readExecution: forbidden },
    runtime: { createSession: forbidden, prepareExecution: forbidden, observeRun: forbidden,
      async startRun(ctx, request) { calls.push({ ctx, request }); return startResult; } },
    evidence: { openVerification: forbidden, readVerification: forbidden, beginCheck: forbidden,
      recordCheckResult: forbidden, finalizeChecks: forbidden },
    checks: { runRegisteredCheck: forbidden }, sourceAuthority: { load: forbidden, readQuerySubmission: forbidden },
  };
  const input: StartRefusalFixture['input'] = { schemaVersion: 1, goalRef: base.goalRef, flowId: base.flowId,
    sessionHint: base.sessionHint, kind: 'perform', operation: { kind: 'start',
      request: { prepared, consumerId: 'cu-consumer', requestId: 'cu-start-request' } } };
  return { workflow: createWorkflow(deps), ctx: f.ctx, input, prepared, manifest, base, expectedPrepareRequest, calls };
}
