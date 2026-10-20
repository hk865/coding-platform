/** S5 round-2 group C driver over the shared S5 decision fixture (R2C01-R2C08). */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { DecisionApplicationReceiptV1 } from '../../src/contracts/core/session-message.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { CheckProcessObservation, TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { RegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createDecisionMessageService } from '../../src/core/work-graph/communication/decision-service.js';
import { createDecisionSourceFacts } from '../../src/core/work-graph/communication/decision-source-facts.js';
import { createMessageWriteOwner, createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { SessionMailboxDependencies } from '../../src/core/work-graph/model/communication-contracts.js';
import type { GoalSettingsPort, MessageDutiesFactsPort } from '../../src/core/work-graph/model/decision-contracts.js';
import type { PlanTaskPort } from '../../src/core/work-graph/model/plan-contracts.js';
import { decodeGoalSettingsChangedEvent } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { setGoalControlFromHost } from '../../src/core/work-graph/tasks/goal-control.js';
import { readGoalPhase } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { committed, decoded, goalAt, keyOf, owners, pin, ready } from './S5-application-support.js';
import { createGoalExecutedFilesReader } from '../../src/core/work-graph/tasks/goal-executed-files-reader.js';
import {
  GOAL_A, GOAL_B, GOAL_C, MODULE_M, OPERATOR, PLAN_A1, PLAN_A2, PLAN_B1, PROJECT_ID, T,
  WORKSPACE, WORKSPACE_ID, WORKSPACE_REVISION, WORKSPACE_SCOPE,
  conflictSourceOf, goalBasisOf, type S5DecisionFixture,
} from './S5-decision-fixture.js';

export function assembleS5R2C(f: S5DecisionFixture) {
  const real = owners(f);
  const faults = { goalAPhase: false, goalCSettings: false, phaseHits: 0, settingsHits: 0 };
  const readsReached = { goalAPhase: 0, goalCSettings: 0 };
  const plans: PlanTaskPort = { ...real.plans, async queryTaskGraph(ctx, input) {
    if (keyOf(input.goalRef) === keyOf(GOAL_A)) readsReached.goalAPhase += 1;
    if (faults.goalAPhase && keyOf(input.goalRef) === keyOf(GOAL_A)) {
      faults.phaseHits += 1;
      return { status: 'rejected', code: 'unavailable', reason: 'R2C02: Goal A task graph unavailable during retry' };
    }
    return real.plans.queryTaskGraph(ctx, input);
  } };
  const settings: GoalSettingsPort = { ...real.settings, async readGoalSettings(ctx, input) {
    if (keyOf(input.goalRef) === keyOf(GOAL_C)) readsReached.goalCSettings += 1;
    if (faults.goalCSettings && keyOf(input.goalRef) === keyOf(GOAL_C)) {
      faults.settingsHits += 1;
      return { status: 'rejected', code: 'unavailable', reason: 'R2C04: Goal C settings unavailable during retry' };
    }
    return real.settings.readGoalSettings(ctx, input);
  } };
  const roles = createRoleConfigurationService({ records: f.records, now: f.now, eventId: f.newId });
  const { authority } = createMaterialRecordReaders(f.records);
  const materials = createMaterialService({ bodies: f.bodies, authority, now: f.now });
  const sessions = createSessionDirectory({ records: f.records, lookups: f.records });
  const executions = createRunStateReader({ records: f.records });
  const duties = ({
    async readMessageDutiesFacts(_ctx, input) {
      if (input.roleBinding.templateId !== f.runRA.roleBinding.templateId
        || input.roleBinding.templateRevision !== f.runRA.roleBinding.templateRevision) {
        return { status: 'rejected', code: 'unsupported', reason: 'no exact duties mapping exists for this Role binding' };
      }
      return { status: 'ready', value: { duties: [...f.duties], readOnlyCopy: false, independentReview: false, guards: [] } };
    },
  } satisfies MessageDutiesFactsPort);
  const mailbox: SessionMailboxDependencies = { records: f.records, sessions, executions, roles, materials,
    systemActor: f.operatorActor, now: f.now, newId: f.newId, duties };
  // Match create-platform.ts:628: both the message owner and Workflow receive
  // the real source reader WITH the real Plan service, including its retry seam.
  const sources = createDecisionSourceFacts({ records: f.records, plans });
  // Lead: as create-platform.ts composes the Workflow port: the decision-message owner plus the mailbox send.
  const messageMailbox = createSessionMailbox(mailbox);
  const decisions = { ...createDecisionMessageService({ records: f.records, now: f.now, newId: f.newId,
    operatorActor: f.operatorActor, messages: messageMailbox, materials,
    messageWrites: createMessageWriteOwner(mailbox), sources }),
    sendUserMessage: messageMailbox.sendUserMessage.bind(messageMailbox) };

  // Copied from src/composition/create-platform.ts:633-643. Recover only the
  // identity/fingerprint saved in the formal event at the returned commit cursor.
  const applicationReceipt = async (_ctx: CoreCallContext, cursor: CommitCursor):
    Promise<DecisionApplicationReceiptV1 | null> => {
    let located: Awaited<ReturnType<typeof f.records.eventAt>>;
    try { located = await f.records.eventAt(cursor); } catch { return null; }
    if (located.status !== 'ready') return null;
    try {
      const parsed = JSON.parse(located.value.event.json) as { identityKey?: unknown; fingerprint?: unknown };
      if (typeof parsed.identityKey !== 'string' || parsed.identityKey.length === 0
        || typeof parsed.fingerprint !== 'string' || parsed.fingerprint.length === 0) return null;
      return { identityKey: parsed.identityKey, fingerprint: parsed.fingerprint, cursor };
    } catch { return null; }
  };

  const sourceRoot = join(f.base.directory, 's5r2-c-verification');
  const configuration: TrustedCheckConfiguration = {
    configurationRevision: 's5r2-c-checks-1', workspace: WORKSPACE, executor: OPERATOR,
    permissionRevision: 's5r2-c-permission-1', sourceAccess: 'verification_workspace',
    processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: 's5r2-c-static', kind: 'static', command: 'echo R2C08_OK', cwd: '.',
      timeoutMs: 60_000, taskIds: 'all' }],
  };
  const workspaceHost: WorkspaceHostBindings = {
    async resolveRoot(workspace) {
      if (keyOf(workspace) !== keyOf(WORKSPACE)) {
        return { status: 'rejected', code: 'forbidden', reason: 'R2C08 only binds P/W' };
      }
      return { status: 'ready', value: { root: sourceRoot, workspaceRevision: WORKSPACE_REVISION } };
    },
    async authorize(ctx, workspace) {
      if (ctx.projectId !== PROJECT_ID || ctx.workspaceId !== WORKSPACE_ID
        || ctx.principal.kind !== 'host' || keyOf(ctx.principal.actor) !== keyOf(OPERATOR)
        || keyOf(workspace) !== keyOf(WORKSPACE)) {
        return { status: 'rejected', code: 'forbidden', reason: 'R2C08 requires the fixture operator in P/W' };
      }
      return { status: 'ready', value: { subjectKey: 'host:operator',
        permissionRevision: configuration.permissionRevision, allowsRead: () => true } };
    },
  };
  const evidence = createEvidenceService({ records: f.records, materials, executions, workspaceHost,
    source: new VerificationWorkspaceReader(), configuration, now: f.now, newId: f.newId });
  const tasks = createGoalService({ records: f.records, now: f.now, eventId: f.newId }).tasks;
  let runtimeCalls = 0;
  const unexpectedRuntime = async (): Promise<never> => {
    runtimeCalls += 1;
    throw new Error('R2C decision coordination must never call the Runtime/model');
  };
  const runtime: RuntimeExecutionPort = {
    capabilities: unexpectedRuntime, createSession: unexpectedRuntime, readSessionHistory: unexpectedRuntime,
    readExecutionHistory: unexpectedRuntime, readTaskExecutionHistory: unexpectedRuntime,
    prepareExecution: unexpectedRuntime, startRun: unexpectedRuntime, observeRun: unexpectedRuntime,
  };
  const checks: RegisteredCheckRunner = { runRegisteredCheck: async () => {
    throw new Error('R2C uses formal evidence entries with controlled process observations, not a process runner');
  } };
  const workflow = createWorkflow({ tasks, plans, sessions,
    claims: createTaskClaimService({ records: f.records, now: f.now, newId: f.newId, roles }),
    executions, runtime, evidence, checks, sourceAuthority: createSourceAuthorityReader({ authority }),
    goalSettings: settings, decisionMessages: decisions, decisionReads: real.reads,
    decisionDuties: duties, goalExecutedFiles: createGoalExecutedFilesReader({ records: f.records }),
    applicationReceipt, now: f.now });
  const resolveDecision = workflow.resolveDecision;
  if (resolveDecision === undefined) throw new Error('createWorkflow must provide resolveDecision');
  return { f, plans, settings, decisions, sources, reads: real.reads, tasks, evidence, executions,
    sourceRoot, faults, readsReached, resolveDecision, runtimeCalls: () => runtimeCalls };
}

export type S5R2C = ReturnType<typeof assembleS5R2C>;

export async function readConflict(x: S5R2C, aRevision = 7, bRevision = 7, aPlan = PLAN_A1) {
  const read = ready(await x.reads.queryGoalConflicts(x.f.ctx, { workspace: WORKSPACE_SCOPE }));
  expect(read.cards).toHaveLength(1);
  expect(read.labels).toEqual([]);
  const card = read.cards[0];
  if (card === undefined) throw new Error('missing A/B conflict card');
  const expected = conflictSourceOf([
    { goalRef: GOAL_A, activePlanRef: aPlan }, { goalRef: GOAL_B, activePlanRef: PLAN_B1 },
  ], [pin(GOAL_A, aRevision), pin(GOAL_B, bRevision), pin(aPlan, 1), pin(PLAN_B1, 1)]);
  expect(card).toMatchObject({ cardKey: expected.key, state: 'waiting_answer', readOnly: false,
    source: { kind: 'goal_conflict', key: expected.key } });
  expect([...card.source.pins].sort((a, b) => keyOf(a.ref).localeCompare(keyOf(b.ref))))
    .toEqual([...expected.pins].sort((a, b) => keyOf(a.ref).localeCompare(keyOf(b.ref))));
  const a = await goalAt(x.f.records, GOAL_A);
  const b = await goalAt(x.f.records, GOAL_B);
  expect(card.source.goalBases).toEqual([goalBasisOf(a), goalBasisOf(b)]);
  expect(card.options).toEqual([
    { id: 'wait', label: '等前一个目标', effect: 'apply' },
    { id: 'order', label: '调整顺序', effect: 'apply' },
    { id: 'parallel', label: '接受风险并行', effect: 'apply' },
  ]);
  return card;
}

export async function controlA(x: S5R2C, action: 'pause' | 'resume', revision: number, requestId: string) {
  const current = await goalAt(x.f.records, GOAL_A);
  expect(current.revision).toBe(revision);
  const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: PROJECT_ID, goalId: GOAL_A.goalId };
  const phase = await readGoalPhase(x.f.records, phaseRef);
  if (phase.status !== 'ready') throw new Error(`Goal A phase: ${JSON.stringify(phase)}`);
  expect(phase.snapshot).toBeNull();
  const result = committed(await setGoalControlFromHost({ records: x.f.records, now: x.f.now, eventId: x.f.newId }, x.f.ctx, {
    input: { goalRef: GOAL_A, control: action, reason: null },
    meta: { requestId, expected: [pin(GOAL_A, revision), pin(phaseRef, 0)] },
  }));
  expect(result).toMatchObject({ replayed: false, value: { ref: GOAL_A, revision: revision + 1,
    desiredState: action === 'pause' ? 'paused' : 'active', desiredStateRevision: revision + 1 } });
  expect(goalBasisOf(result.value)).toEqual(goalBasisOf(current));
  return result;
}

export async function settingsEvent(x: S5R2C, cursor: CommitCursor) {
  const read = await x.f.records.eventAt(cursor);
  expect(read.status).toBe('ready');
  if (read.status !== 'ready') throw new Error(`settings event read: ${JSON.stringify(read)}`);
  const located = read.value;
  expect(located.event.eventType).toBe('GoalSettingsChanged');
  const event = decoded(decodeGoalSettingsChangedEvent(located.event));
  expect(await x.f.records.lookupCommit({ identityKey: event.identityKey, fingerprint: event.fingerprint }))
    .toMatchObject({ status: 'ready', value: { cursor, eventIds: [located.event.eventId] } });
  return event;
}

/** S5 allocation counters and the actual owner Store, never write-call counts. */
export async function observeC(x: S5R2C) {
  return { store: await x.f.storeSnapshot(), allocations: { ...x.f.allocationCounts }, runtimeCalls: x.runtimeCalls() };
}

/** R2C08: same formal completion path as A2-goal-control.test.ts:346-363. */
export async function completeA1(x: S5R2C) {
  const f = x.f;
  await mkdir(join(x.sourceRoot, 'src', 'm'), { recursive: true });
  await writeFile(join(x.sourceRoot, 'src', 'm', 'a.ts'), 'export const value = 1;\n');
  const session = await f.createS5Session('r2c08-a-session');
  const claim = await f.claimRun({ requestId: 'r2c08-claim', goalRef: GOAL_A, planRef: PLAN_A1,
    taskId: 'a-work', sessionRef: session });
  expect(await f.enterClaim(claim)).toMatchObject({ status: 'running', ref: claim.runRef });
  expect(await f.settleRun(claim)).toMatchObject({ status: 'ended', outcome: 'completed', ref: claim.runRef });
  const process: CheckProcessObservation = {
    kind: 'executed', startedAt: T, finishedAt: T, exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: 'R2C08_OK\n', totalBytes: 9, truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { workspaceRevision: 'r2c08-source-1', changedPaths: [] }, sandboxProfileVersion: 'bwrap-m3-v4',
  };
  for (const taskId of ['a-work', 'a-gate'] as const) {
    const subject = { projectId: PROJECT_ID, goalId: GOAL_A.goalId, taskId };
    let round = committed(await x.evidence.openVerification(f.ctx, {
      input: { subjectRunRef: claim.runRef, subject, planRef: PLAN_A1,
        ...(taskId === 'a-gate' ? { gateSubject: 'goal' as const } : {}) },
      meta: { requestId: `r2c08-open-${taskId}`, expected: [] },
    })).value;
    expect(round.checks.map(check => check.checkId)).toEqual(['s5r2-c-static']);
    const ticket = committed(await x.evidence.beginCheck(f.ctx, {
      input: { roundRef: round.ref, checkId: 's5r2-c-static' },
      meta: { requestId: `r2c08-begin-${taskId}`, expected: [pin(round.ref, round.revision)] },
    })).value;
    round = ready(await x.evidence.readVerification(f.ctx, round.ref));
    round = committed(await x.evidence.recordCheckResult(f.ctx, {
      input: { roundRef: round.ref, checkId: 's5r2-c-static', invocationId: ticket.invocationId, observation: process },
      meta: { requestId: `r2c08-record-${taskId}`, expected: [pin(round.ref, round.revision)] },
    })).value;
    const finalized = committed(await x.evidence.finalizeChecks(f.ctx, {
      input: { roundRef: round.ref }, meta: { requestId: `r2c08-finalize-${taskId}`, expected: [pin(round.ref, round.revision)] },
    })).value;
    expect(finalized).toMatchObject({ outcome: 'PASS', applicable: true });
    const completed = committed(await x.tasks.completeTask(f.ctx, {
      input: { taskRef: subject, planRef: PLAN_A1, roundRef: finalized.snapshot.ref },
      meta: { requestId: `r2c08-complete-${taskId}`, expected: [pin(GOAL_A, 7),
        pin({ aggregateType: 'TaskReduction', projectId: PROJECT_ID, goalId: GOAL_A.goalId, taskId }, 0)] },
    }));
    expect(completed).toMatchObject({ replayed: false, value: { revision: 1, planRef: PLAN_A1, phase: 'satisfied' } });
  }
  const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: PROJECT_ID, goalId: GOAL_A.goalId };
  const completion = committed(await x.tasks.completeGoal(f.ctx, {
    input: { goalRef: GOAL_A }, meta: { requestId: 'r2c08-complete-A', expected: [pin(GOAL_A, 7), pin(phaseRef, 0)] },
  }));
  expect(completion.value).toMatchObject({ ref: phaseRef, revision: 1, phase: 'COMPLETED', planRef: PLAN_A1 });
  return completion;
}

/** Retain every PA1 Task, assignment and obligation; add only untraced intent. */
export async function adoptA2(x: S5R2C) {
  const source = x.f.plans.A1;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: PLAN_A2.planId, planRevision: 2, goalId: GOAL_A.goalId,
    stages: structuredClone(source.stages),
    tasks: [...structuredClone(source.tasks), { taskId: 'a-future', title: 'Future module M intent',
      requirementLevel: 'optional', taskKind: 'work', disposition: 'active', phase: 'pending', executionIntent: 'plan_only',
      scope: { kind: 'module', stageId: 'stage-a', moduleRef: MODULE_M.moduleId } }],
    assignments: structuredClone(source.assignments ?? []), obligations: structuredClone(source.obligations),
    taskHierarchy: structuredClone(source.taskHierarchy), executionDag: structuredClone(source.executionDag),
    taskRelations: [], inputRequirements: [],
  };
  const proposal = committed(await x.plans.proposePlan(x.f.ctx, {
    input: { goalRef: GOAL_A, basedOn: PLAN_A1, draft, reason: { text: 'Add future intent after completing PA1', sources: [] } },
    meta: { requestId: 'r2c08-propose-PA2', expected: [pin(GOAL_A, 7)] },
  }));
  expect(proposal.value).toMatchObject({ revision: 1, issues: [] });
  const adopted = committed(await x.plans.applyPlanChange(x.f.ctx, {
    input: { proposalRef: proposal.value.ref, expectedProposalRevision: 1, decisionRefs: [] },
    meta: { requestId: 'r2c08-adopt-PA2', expected: [pin(GOAL_A, 7)] },
  }));
  expect(adopted.value).toMatchObject({ ref: PLAN_A2, revision: 1, planRevision: 2 });
  expect(await goalAt(x.f.records, GOAL_A)).toMatchObject({ revision: 8, desiredState: 'active', activePlanRevision: PLAN_A2 });
  return adopted;
}
