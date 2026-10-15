/**
 * R2C08 bootstrap: copy of the frozen S5-goal-settings-support.ts, changing
 * only the factory name and the pre-adoption policy/requirement kind to static.
 * S5's original test-kind requirement cannot be covered by the production
 * RegisteredCommandCheck (static | dynamic). Like R3e-evidence-fixture.ts,
 * this checkpoint pins a static policy BEFORE real PA1/PB1/PC1 adoption.
 * P/W, A/B/C@7, PA1/PB1, M/N, actors, clocks and all real entry paths stay the
 * same. R2C01-R2C07 use the original frozen fixture. No persisted PA1, evidence,
 * TaskReduction or GoalPhase is overwritten to make completion possible.
 */
/**
 * Goal-settings variant of the repaired S5-decision-fixture bootstrap.
 * The shared helper has no pre-adoption hook and must not be edited by fx4.
 * Its code is copied here so records, schema registration, snapshots, bodies,
 * and Session admission retain the same contracts. It adopts the real M/N
 * catalog before Plan adoption (the shared fixture has a legacy baseline).
 * For SS11/SS12/SS15 B's checkpoint differs: B@5 -> real PB1 adoption@6 ->
 * real RB claim -> real pause@7. The other rows retain active B@7.
 * A/C still adopt@7. All later controls/settings/answers use production owners;
 * no active@7 record is overwritten with a paused snapshot at the same version.
 */
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { artifactBodyDigest, type ArtifactRef } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, VersionPin } from '../../src/contracts/core/identity.js';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { SessionMessageRef, DecisionMessageMetadataV1, UserMessageResponseV1 } from '../../src/contracts/core/session-message.js';
import type { DecisionOptionV1, DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunSnapshot, RoleBindingRefV1, SourceRefV1, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { GoalRef, GoalSnapshot, ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { QueryJobIntentV1, QueryJobRef } from '../../src/contracts/query-job.js';
import type { GoalSettingsV1, WorkspaceDecisionSettingsV1 } from '../../src/contracts/goal-decisions.js';
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import { SESSION_MAILBOX_TOOL_NAMES, USER_DECISION_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import type { EncodedDomainEvent, EncodedRecord, RecordBackendSchemas, RecordGuard, StoreCommitReceipt, UniqueClaimChange } from '../../src/core/record-store/ports.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { decodeGoalSnapshot, encodeGoalSnapshot, encodeProjectSnapshot, encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_RECORD_SCHEMAS, encodePlanProposal, encodePlanProposalRecordedEvent, encodePlanRevisionSnapshot } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import type { SubmitQueryJobInput } from '../../src/core/work-graph/queries/contracts.js';
import {
  SESSION_MESSAGE_RECORD_SCHEMAS, SESSION_MESSAGE_CONTENT_TYPE,
  S5_USER_MESSAGE_BY_GOAL, S5_MESSAGE_BY_WORKSPACE_STATUS, S5_DECISION_ANSWER_BY_SOURCE,
  encodeSessionMessageRecord, encodeSessionMessageSentEvent, encodeSessionMessageRespondedEvent,
} from '../../src/core/work-graph/sessions/message-record-codecs.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { DECISION_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import { S5_PLAN_PROPOSAL_BY_REQUEST } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { S5_QUERY_JOB_BY_GOAL } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { createSessionDirectory, kernelSessionClaimKey } from '../../src/core/work-graph/sessions/session-directory.js';
import { SESSION_RECORD_SCHEMAS, decodeSessionRecord, plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { ROLE_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/role-record-codecs.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { TASK_CLAIM_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { setGoalControlFromHost } from '../../src/core/work-graph/tasks/goal-control.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/model/session-contracts.js';
import type { RoleSpecResolutionV1 } from '../../src/contracts/role-spec-materials.js';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import type {
  AuthorizeConfiguration, ExecutionEntryPort, KernelExecutionBinding, TaskEntryPermit,
  TaskResultObservation,
} from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { createExecutionEntryService, MANIFEST_CONTENT_TYPE } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createB2ExecutionFixture, type B2ExecutionFixture } from './B2-execution-fixture.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { DecisionApplicationReceiptV1 } from '../../src/contracts/core/session-message.js';
import type { CheckProcessObservation, TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import type { RegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import type { GoalSettingsPort } from '../../src/core/work-graph/model/decision-contracts.js';
import type { PlanTaskPort } from '../../src/core/work-graph/model/plan-contracts.js';
import type { SessionMailboxDependencies } from '../../src/core/work-graph/model/communication-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { createDecisionMessageService } from '../../src/core/work-graph/communication/decision-service.js';
import { createDecisionSourceFacts } from '../../src/core/work-graph/communication/decision-source-facts.js';
import { createMessageWriteOwner, createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import type { MessageDutiesFactsPort } from '../../src/core/work-graph/model/decision-contracts.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { decodeGoalSettingsChangedEvent } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createExecutedFilesStub } from './executed-files-stub.js';
import { readGoalPhase } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import { committed, decoded, goalAt, keyOf, owners, pin, ready } from './S5-application-support.js';
import { PLAN_A1, PLAN_A2, conflictSourceOf } from './S5-decision-fixture.js';

import {
  T, GOAL_REVISION, MESSAGE_REVISION, WORKSPACE_REVISION, PROJECT_ID, WORKSPACE_ID,
  OPERATOR, DUTIES, PROJECT, WORKSPACE, WORKSPACE_SCOPE, GOAL_A, GOAL_B, GOAL_C, GOAL_ORDER,
  PLAN_B1, PLAN_B2, PLAN_B2_Q2, MODULE_M, MODULE_N, MODULE_PATHS, FILE_M,
  CANDIDATE_U1, createS5Allocations, observeRecords, messageSourceOf, goalBasisOf,
  type S5FixtureKind, type S5DecisionFixtureOptions, type S5DecisionFixture, type S5ReopenedFixture,
  type S5Base, type S5QuerySeed, type S5RecordCounts, type S5Records, type S5StoreSnapshot,
} from './S5-decision-fixture.js';

function goalSettings(order: number, autonomy: GoalSettingsV1['autonomy'] = 'after_plan_confirmation'): GoalSettingsV1 {
  return { schemaVersion: 1, autonomy, order, waitForGoalRef: null, parallelRisks: [] };
}

function goalSnapshot(ref: GoalRef, order: number, activePlanRevision: PlanRevisionRef | null): GoalSnapshot {
  return {
    ref, workspaceRef: WORKSPACE, objective: `Deliver Goal ${ref.goalId}`,
    desiredState: 'active', desiredStateRevision: 1, desiredStateRequestedBy: null,
    activePlanRevision, revision: GOAL_REVISION, settings: goalSettings(order),
  };
}

function workTask(taskId: string, title: string, scope: RuntimeTask['scope']): RuntimeTask {
  return { taskId, title, requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope };
}

function planDraft(planId: string, goalId: string, stages: PlanRevisionDraft['stages'], tasks: RuntimeTask[]): PlanRevisionDraft {
  const gate: RuntimeTask = { taskId: `${goalId.toLowerCase()}-gate`, title: `Goal ${goalId} gate`,
    requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } };
  const allTasks = [...tasks, gate];
  return {
    schemaVersion: 1, planId, planRevision: 1, goalId, stages, tasks: allTasks,
    assignments: tasks.map(task => ({ taskId: task.taskId, role: 'builder', instruction: `Execute ${task.taskId}` })),
    obligations: [{ obligationId: `${planId}-obligation`, title: `Deliver ${planId}`, requirementLevel: 'required',
      taskIds: allTasks.map(task => task.taskId),
      verificationRequirements: [{ requirementId: `${planId}-check`, requirementLevel: 'required', kind: 'static', description: 'Registered static checks pass' }] }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
  };
}

/** No changed/traced Task, no removed Task/gate/assignment, no new obligation. */
function futureDraft(source: PlanRevisionDraft, target: PlanRevisionRef, taskId: string): PlanRevisionDraft {
  const draft = structuredClone(source);
  const task = workTask(taskId, `Future work for ${target.planId}`,
    { kind: 'module', stageId: 'stage-b', moduleRef: MODULE_M.moduleId });
  return { ...draft, schemaVersion: 2, planId: target.planId, planRevision: source.planRevision + 1,
    tasks: [...draft.tasks, task],
    assignments: [...(draft.assignments ?? []), { taskId, role: 'builder', instruction: `Execute ${taskId}` }],
    obligations: draft.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds, taskId] })) };
}

function candidate(proposalId: string, goalRef: GoalRef, basedOn: PlanRevisionRef | null,
  requestRef: QueryJobRef | null, draft: PlanRevisionDraft): Extract<PlanProposal, { kind: 'candidate_v2' }> {
  return {
    kind: 'candidate_v2', ref: { aggregateType: 'PlanProposal', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, proposalId },
    revision: 1, schemaVersion: 2, goalRef, basedOn, draft,
    reason: { text: `Candidate ${proposalId}`, sources: [] },
    status: 'candidate', issues: [], requestRef,
  };
}

/** The unique request-head claim of SPEC §2.4 line 270. */
function requestHeadClaim(goalRef: GoalRef, requestRef: QueryJobRef, owner: string): UniqueClaimChange {
  return { claimKey: `s5-request-candidate:${canonicalJson({ goalRef, requestRef })}`, expectedOwner: null, nextOwner: owner };
}

function proposalRefKey(proposal: PlanProposal): string {
  return canonicalJson(proposal.ref);
}

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

const additionalSchemas: RecordBackendSchemas[] = [QUERY_JOB_RECORD_SCHEMAS, SESSION_MESSAGE_RECORD_SCHEMAS,
  DECISION_RECORD_SCHEMAS, COMPLETION_RECORD_SCHEMAS, EVIDENCE_RECORD_SCHEMAS, ARCHITECTURE_CATALOG_SCHEMAS];

// These test-only indexes enumerate every registered aggregate on the SAME
// physical store, including rows created later by a tested owner. No fixed ref
// list can hide a stray newly allocated record. The B2 schema sets are read here
// only to build indexes; B2 remains responsible for registering their codecs.
const snapshotTypes = [...new Set([
  materialRecordSchemas(), PLAN_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS, PLAN_GOVERNANCE_RECORD_SCHEMAS,
  SESSION_RECORD_SCHEMAS, ROLE_RECORD_SCHEMAS, TASK_CLAIM_RECORD_SCHEMAS, MODEL_REQUEST_RECORD_SCHEMAS,
  ...additionalSchemas,
].flatMap(schemas => schemas.records.map(schema => schema.aggregateType)))].sort();
const snapshotIndex = (aggregateType: string) => `s5-fixture-all-${aggregateType}`;

export async function openS5R2CompletionFixture(kind: S5FixtureKind, pausedB = false,
  fixtureOptions: S5DecisionFixtureOptions = {}): Promise<S5DecisionFixture> {
  const operatorActor: Extract<ActorRef, { kind: 'human' | 'system' }> = fixtureOptions.operatorActor ?? OPERATOR;
  const fixtureDuties: readonly PlatformDutyV1[] = fixtureOptions.duties ?? DUTIES;
  const b2 = await createB2ExecutionFixture(kind, {
    records: additionalSchemas.flatMap(schemas => [...schemas.records]),
    events: additionalSchemas.flatMap(schemas => [...schemas.events]),
    lookups: [...additionalSchemas.flatMap(schemas => [...(schemas.lookups ?? [])]),
      ...snapshotTypes.map(aggregateType => ({ name: snapshotIndex(aggregateType), aggregateType, paths: ['ref.aggregateType'] }))],
  });
  const directory = b2.base.directory;
  const base: S5Base = { scope: WORKSPACE_SCOPE, projectRef: PROJECT, workspaceRef: WORKSPACE, directory };

  let activeRecords: S5Records = b2.base.records;
  const counts: S5RecordCounts = { commits: 0, lookupCommits: 0, eventAt: 0, lookups: 0 };
  // Remember every attempted slot, including failed/released/newly allocated
  // slots. Owners below and test-built owners all use this stable forwarding
  // port. The values are NOT inferred from successful calls: snapshot reads
  // their actual owners from the backend.
  const knownClaimKeys = new Set<string>();
  const forwarded: S5Records = {
    readMany: keys => activeRecords.readMany(keys),
    lookupCommit: input => activeRecords.lookupCommit(input),
    eventAt: cursor => activeRecords.eventAt(cursor),
    lookup: request => activeRecords.lookup(request),
    commit: input => {
      for (const claim of input.claims) knownClaimKeys.add(claim.claimKey);
      return activeRecords.commit(input);
    },
  };
  const observed = observeRecords(forwarded, counts);
  const records = observed.records;
  const allocations = createS5Allocations();
  const { allocationCounts, newId, now } = allocations;
  const bodyPath = join(directory, 's5-bodies.sqlite');
  let bodies: RawArtifactStorePort;
  let closeBodies: () => Promise<void>;
  if (kind === 'sqlite') {
    const store = createSqliteRawArtifactStore(bodyPath);
    bodies = allocations.observeBodies(store);
    closeBodies = () => store.close();
  } else {
    bodies = allocations.observeBodies(new RawArtifactBodyStore());
    closeBodies = async () => undefined;
  }

  const ctx: CoreCallContext = {
    projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
    principal: { kind: 'host', actor: { ...operatorActor } },
    materialReader: { kind: 'host', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, actor: { ...operatorActor } },
    signal: new AbortController().signal,
  };

  let seedSeq = 0;
  let eventSeq = 0;
  const eventId = () => `s5-event-${++eventSeq}`;

  async function seedCommit(recordsToWrite: readonly EncodedRecord[],
    options: { guards?: readonly RecordGuard[]; events?: readonly EncodedDomainEvent[]; claims?: readonly UniqueClaimChange[] } = {}): Promise<StoreCommitReceipt> {
    const sequence = ++seedSeq;
    const explicit = new Set((options.guards ?? []).map(guard => guard.refKey));
    const guards: RecordGuard[] = [...(options.guards ?? []),
      ...recordsToWrite.filter(record => !explicit.has(record.refKey)).map(record => ({ refKey: record.refKey, expectedRevision: null }))];
    // The Store requires at least one event per commit (the receipt cursor). A
    // trusted scope-seed event is the same benign carrier the accepted fixtures use.
    const events: EncodedDomainEvent[] = options.events !== undefined && options.events.length > 0
      ? [...options.events]
      : [{ eventId: `s5-seed-event-${sequence}`, eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: T,
          json: JSON.stringify({ eventId: `s5-seed-event-${sequence}`, eventType: 'TrustedScopeSeeded', schemaVersion: 1,
            occurredAt: T, records: recordsToWrite }) }];
    const result = await records.commit({
      identityKey: `s5-seed-${sequence}`, fingerprint: `s5-seed-fingerprint-${sequence}`,
      guards, records: [...recordsToWrite], claims: [...(options.claims ?? [])],
      indexGuards: [], indexChanges: [], events,
    });
    if (result.status !== 'committed') throw new Error(`S5 fixture seed commit failed: ${JSON.stringify(result)}`);
    return result;
  }

  // ---- Project + Workspace (revision 3, decisionSettings) -------------------
  const decisionSettings: WorkspaceDecisionSettingsV1 = { schemaVersion: 1, noticeSeen: {} };
  const project: ProjectSnapshot = { ref: PROJECT, revision: 1 };
  const workspace: WorkspaceSnapshot = { ref: WORKSPACE, revision: WORKSPACE_REVISION, decisionSettings };
  await seedCommit([encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace)]);

  // Trusted installation checkpoint, using the registered governance codecs
  // and the same digest shape as task-claim-fixture. The initial Plan owner
  // below must resolve REAL matching governance, rather than dangling pins.
  const policyFixture = { schemaVersion: 1, identity: { policyId: 's5-policy' }, revision: 1,
    content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } };
  const policyRef = { aggregateType: 'CompletionPolicyRevision', projectId: PROJECT_ID, policyId: 's5-policy', revision: 1 } as const;
  function encodeGovernance<TSnapshot extends { ref: Record<string, string | number>; revision: number }>(snapshot: TSnapshot): EncodedRecord {
    return { refKey: canonicalJson(snapshot.ref), schemaId: `${snapshot.ref.aggregateType}Snapshot@1`,
      revision: snapshot.revision, json: JSON.stringify(snapshot) };
  }
  const governance = [
    encodeGovernance({ ref: policyRef, revision: 1, schemaVersion: 1, policyId: policyRef.policyId, contentRevision: 1,
      contentDigest: sha256Hex(canonicalJson(policyFixture)), content: policyFixture.content }),
    encodeGovernance({ ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: PROJECT_ID }, projectId: PROJECT_ID,
      revision: 1, activeRevision: policyRef }),
  ];
  await seedCommit(governance);
  const catalog = await createArchitectureCatalogService({ records }).adoptInitialArchitecture(ctx, {
    input: { baselineId: 's5-baseline', description: 'S5 architecture baseline', constraints: [],
      catalog: { requireDag: true, dependencies: [], modules: [
        { ref: MODULE_M, name: 'M', responsibility: 'Module M work', paths: [...MODULE_PATHS.M], interfaces: [] },
        { ref: MODULE_N, name: 'N', responsibility: 'Module N work', paths: [...MODULE_PATHS.N], interfaces: [] },
      ] } },
    meta: { requestId: 's5-ss-adopt-catalog', expected: [
      { ref: PROJECT, revision: 1 }, { ref: WORKSPACE, revision: WORKSPACE_REVISION },
    ] },
  });
  if (catalog.status !== 'committed') throw new Error(`S5 catalog adoption failed: ${JSON.stringify(catalog)}`);

  // Trusted pre-adoption checkpoints: @6 normally, B@5 for the paused rows.
  // Real adoption and (for those rows) real pause finish the histories at @7.
  const initialGoals = [goalSnapshot(GOAL_A, GOAL_ORDER.A, null), goalSnapshot(GOAL_B, GOAL_ORDER.B, null),
    goalSnapshot(GOAL_C, GOAL_ORDER.C, null)].map(goal => ({ ...goal, revision: pausedB && goal.ref.goalId === GOAL_B.goalId ? 5 : 6 }));
  await seedCommit(initialGoals.map(encodeGoalSnapshot));

  // ---- Accepted Plan pointers PA1/PB1/PC1 (revision 1, planRevision 1) ------
  const planADraft = planDraft('PA1', GOAL_A.goalId, [{ stageId: 'stage-a', title: 'Module M stage' }],
    [workTask('a-work', 'Plan module M work', { kind: 'module', stageId: 'stage-a', moduleRef: MODULE_M.moduleId })]);
  const planBDraft = planDraft('PB1', GOAL_B.goalId, [{ stageId: 'stage-b', title: 'Module M stage' }],
    [workTask('b-work', 'Goal B first work', { kind: 'module', stageId: 'stage-b', moduleRef: MODULE_M.moduleId }),
      workTask('b-work-2', 'Goal B second work', { kind: 'goal' })]);
  const planCDraft = planDraft('PC1', GOAL_C.goalId, [{ stageId: 'stage-c', title: 'Module N stage' }],
    [workTask('c-work', 'Plan module N work', { kind: 'module', stageId: 'stage-c', moduleRef: MODULE_N.moduleId })]);
  const plans = createPlanService({ records, now, eventId });
  async function adoptInitial(goalRef: GoalRef, draft: PlanRevisionDraft): Promise<PlanRevisionSnapshot> {
    const proposed = await plans.proposePlan(ctx, { input: { goalRef, basedOn: null, draft,
      reason: { text: `Initial ${draft.planId}`, sources: [] } },
      meta: { requestId: `s5-propose-${draft.planId}`, expected: [{ ref: goalRef, revision: pausedB && goalRef.goalId === GOAL_B.goalId ? 5 : 6 }] } });
    if (proposed.status !== 'committed' || proposed.value.issues.length !== 0) {
      throw new Error(`S5 initial proposal failed: ${JSON.stringify(proposed)}`);
    }
    const accepted = await plans.applyPlanChange(ctx, { input: { proposalRef: proposed.value.ref,
      expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
      meta: { requestId: `s5-adopt-${draft.planId}`, expected: [{ ref: goalRef, revision: pausedB && goalRef.goalId === GOAL_B.goalId ? 5 : 6 }] } });
    if (accepted.status !== 'committed') throw new Error(`S5 initial adoption failed: ${JSON.stringify(accepted)}`);
    return accepted.value;
  }
  async function readGoalSnapshot(ref: GoalRef): Promise<GoalSnapshot> {
    const read = await records.readMany([canonicalJson(ref)]);
    if (read.status !== 'ready') throw new Error(`S5 Goal read failed: ${JSON.stringify(read)}`);
    const record = read.value.records[0];
    if (record === undefined) throw new Error('S5 Goal checkpoint is missing');
    const decoded = decodeGoalSnapshot(record);
    if (decoded.status !== 'decoded') throw new Error(`S5 Goal decode failed: ${decoded.reason}`);
    return decoded.value;
  }
  const planA1 = await adoptInitial(GOAL_A, planADraft);
  const planB1 = await adoptInitial(GOAL_B, planBDraft);
  const planC1 = await adoptInitial(GOAL_C, planCDraft);
  const goalA = await readGoalSnapshot(GOAL_A);
  let goalB = await readGoalSnapshot(GOAL_B);
  const goalC = await readGoalSnapshot(GOAL_C);

  // ---- real Sessions S / second --------------------------------------------
  const sessionsPort: SessionDirectoryPort = createSessionDirectory({ records, lookups: records });
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 's5-kernel', storeKey: 's5-kernel-store', workspace: WORKSPACE_SCOPE, databasePath: join(directory, 's5-kernel.sqlite'),
  }] });
  const sessionRole: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
  // SessionDirectory has no injected clock (it calls new Date internally).
  // Keep its real owner facts; all injectable fixture clocks and observations
  // are T. Tests requiring exact Session creation instants need a Date clock
  // seam in their own setup, not a forged SessionRecord here.
  async function createS5Session(requestId: string, role: RoleConfigurationRef = sessionRole): Promise<SessionRef> {
    const admitted = await sessionsPort.admitSessionCreation(ctx, { meta: { requestId: `admit-${requestId}`, expected: [] },
      input: { workspace: WORKSPACE_SCOPE, kernelStore: { adapterId: 's5-kernel', storeKey: 's5-kernel-store' }, role,
        recommendedRefs: [], initialLinks: [] } });
    if (admitted.status !== 'committed') throw new Error(`S5 session admission failed: ${JSON.stringify(admitted)}`);
    const kernelSessionId = `s5-kernel-session-${requestId}`;
    await kernelStores.withStore('s5-kernel', store => store.create(
      { sessionId: kernelSessionId, recordId: `s5-kernel-record-${requestId}`, createdAt: T }, { signal: ctx.signal }));
    const registered = await sessionsPort.recordSessionCreated(ctx, { meta: { requestId: `register-${requestId}`, expected: [] },
      input: { operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: 's5-kernel', kernelSessionId, historyCursor: null, observedAt: T } });
    if (registered.status !== 'committed') throw new Error(`S5 session registration failed: ${JSON.stringify(registered)}`);
    return { projectId: registered.value.ref.projectId, sessionId: registered.value.ref.sessionId };
  }
  const sessionS = await createS5Session('session-s');
  const sessionSecond = await createS5Session('session-second');

  // ---- real claim + execution entry: running Run RA, claimed Run RB ---------
  const reads = createRunStateReader({ records });
  const roles = createRoleConfigurationService({ records, now, eventId });
  const claimService = createTaskClaimService({ records, roles, now, newId });
  const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 's5-binding', templateId: 'builder',
    templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
  const budget: TaskBudgetV1 = { tokenBudget: 100000, deadline: null };
  const s5Host = {
    configurationRevision: 's5-host-config-1',
    permissions: { policyRevision: 'legacy-template',
      tools: ['read', ...SESSION_MAILBOX_TOOL_NAMES, ...USER_DECISION_TOOL_NAMES] as string[], writeScope: [] as string[] },
    hostTemplate: { templateId: 'builder', revision: '1', digest: artifactBodyDigest('s5 trusted builder template') },
  };
  const authorizeConfiguration: AuthorizeConfiguration = async (callCtx, input) => {
    if (callCtx.projectId !== PROJECT_ID || callCtx.workspaceId !== WORKSPACE_ID
      || input.configurationRevision !== s5Host.configurationRevision
      || canonicalJson(input.sessionRole) !== canonicalJson(sessionRole)) {
      return { status: 'rejected', code: 'forbidden', reason: 'the S5 fixture Host binding does not authorize this configuration' };
    }
    return { status: 'ready', value: { configurationRevision: s5Host.configurationRevision,
      permissions: structuredClone(input.permissions), hostTemplate: structuredClone(input.hostTemplate) } };
  };
  const entry: ExecutionEntryPort = createExecutionEntryService({ records, reads, roles,
    bodies: { read: ref => bodies.read(ref) }, authorizeConfiguration, now, eventId, newId });

  async function claimRun(input: { requestId: string; goalRef: GoalRef; planRef: PlanRevisionRef; taskId: string; sessionRef: SessionRef;
    roleBinding?: RoleBindingRefV1; budget?: TaskBudgetV1 }): Promise<TaskClaim> {
    const goal = await readGoalSnapshot(input.goalRef);
    const card = await sessionsPort.readSession(ctx, input.sessionRef);
    if (card.status !== 'ready') throw new Error(`S5 claim session read failed: ${JSON.stringify(card)}`);
    const request: GraphWrite<ClaimTaskInput> = { input: {
      goalRef: input.goalRef, planRef: input.planRef, taskId: input.taskId, sessionRef: input.sessionRef,
      roleBinding: input.roleBinding ?? roleBinding, budget: input.budget ?? budget,
    }, meta: { requestId: input.requestId, expected: [
      { ref: input.goalRef, revision: goal.revision },
      { ref: WORKSPACE, revision: WORKSPACE_REVISION },
      { ref: plainSessionRefToAggregate(input.sessionRef), revision: card.value.record.revision },
    ] } };
    const claimed = await claimService.claimTask(ctx, request);
    if (claimed.status !== 'committed') throw new Error(`S5 claim failed: ${JSON.stringify(claimed)}`);
    return claimed.value;
  }

  async function readExecution(claim: TaskClaim) {
    const read = await reads.readExecution(ctx, claim.runRef);
    if (read.status !== 'ready') throw new Error(`S5 run read failed: ${JSON.stringify(read)}`);
    return read.value;
  }

  async function runPin(claim: TaskClaim): Promise<VersionPin> {
    const current = await readExecution(claim);
    return { ref: claim.runRef, revision: current.run.revision };
  }

  async function buildPrepared(claim: TaskClaim): Promise<{ prepared: PreparedTaskExecution; permit: TaskEntryPermit }> {
    const target = await readExecution(claim);
    const input = 'S5 decision fixture prepared manifest input';
    const inputDigest = artifactBodyDigest(input);
    const permissions = structuredClone(s5Host.permissions);
    const roleFacts = await roles.resolveRoleBindingFacts(ctx, { roleBinding: target.run.roleBinding, declaredPermissions: permissions });
    if (roleFacts.result.status !== 'ready') throw new Error(`S5 fixture role facts failed: ${JSON.stringify(roleFacts)}`);
    const role: RoleSpecResolutionV1 = roleFacts.result.value;
    const workspaceSnapshot = { workspaceId: claim.workspaceId, revision: WORKSPACE_REVISION };
    const manifest: PreparedTaskManifestV1 = {
      schemaVersion: 1, kind: 'task_execution', claim, role, hostTemplate: structuredClone(s5Host.hostTemplate),
      roleBinding: target.run.roleBinding, hostConfigurationRevision: s5Host.configurationRevision,
      sessionRole: target.session.role, workspaceSnapshot, permissions, budget: target.run.budget,
      selectedTaskInputs: [], materialBasis: null, materialAccessRefs: [], additionalMaterialRefs: [], deliveryRefs: [],
      sourceRefs: [], input, inputDigest,
    };
    const manifestJson = JSON.stringify(manifest);
    const stored = await bodies.put({ body: manifestJson, contentType: MANIFEST_CONTENT_TYPE,
      sourceRefs: [{ kind: 'workspace', refId: claim.workspaceId, revision: String(workspaceSnapshot.revision) }],
      origin: { kind: 'run', owner: claim.runRef }, requestedAt: T });
    if (stored.status !== 'ready') throw new Error(`S5 manifest store failed: ${JSON.stringify(stored)}`);
    const envelope: TaskEnvelopeV1 = {
      schemaVersion: 1, envelopeId: 's5-envelope-1', projectId: claim.task.projectId, workspaceId: claim.workspaceId,
      goalId: claim.task.goalId, taskId: claim.task.taskId, runRef: claim.runRef, attemptRef: claim.attemptRef,
      planRef: claim.planRef, roleBinding: target.run.roleBinding, workspaceSnapshot, permissions, budget: target.run.budget,
      sourceRefs: [], bundleRef: stored.value.ref,
    };
    const inputBinding: PreparedTaskExecution['inputBinding'] = { schemaVersion: 1, inputDigest,
      manifestDigest: artifactBodyDigest(manifestJson), materialAccessRefs: [], additionalMaterialRefs: [], deliveryRefs: [] };
    const permit: TaskEntryPermit = { claim, consumerId: 's5-runtime', entryGeneration: 1, authorizationRevision: 1, inputDigest };
    return { prepared: { kind: 'task', claim, envelope, inputBinding }, permit };
  }

  async function enterClaim(claim: TaskClaim): Promise<RunSnapshot> {
    const target = await readExecution(claim);
    const kernel: KernelExecutionBinding = { adapterId: target.session.kernel.adapterId,
      kernelSessionId: target.session.kernel.kernelSessionId, runId: 's5-kernel-run', turnId: 's5-kernel-turn' };
    const { prepared, permit } = await buildPrepared(claim);
    const authorized = await entry.authorizeRuntimeEntry(ctx, { input: { prepared, consumerId: permit.consumerId },
      meta: { requestId: `s5-authorize-${claim.task.taskId}`, expected: [await runPin(claim)] } });
    if (authorized.status !== 'committed') throw new Error(`S5 authorize failed: ${JSON.stringify(authorized)}`);
    const begun = await entry.beginRuntimeEntry(ctx, { input: { permit: authorized.value, kernel },
      meta: { requestId: `s5-begin-${claim.task.taskId}`, expected: [await runPin(claim)] } });
    if (begun.status !== 'committed') throw new Error(`S5 begin failed: ${JSON.stringify(begun)}`);
    const entered = await entry.recordExecutionEntered(ctx, { input: {
      permit: { ...authorized.value, authorizationRevision: begun.value.authorization.revision },
      enteredAt: T, kernelSource: { ...kernel, position: 3 },
      history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null },
    }, meta: { requestId: `s5-entered-${claim.task.taskId}`, expected: [await runPin(claim)] } });
    if (entered.status !== 'committed') throw new Error(`S5 entered failed: ${JSON.stringify(entered)}`);
    return entered.value;
  }

  async function settleRun(claim: TaskClaim): Promise<RunSnapshot> {
    const current = await readExecution(claim);
    const authorization = current.run.executionAuthorization;
    const history = current.run.executionHistory;
    if (current.run.status !== 'running' || authorization === undefined || !('schemaVersion' in authorization) || authorization.schemaVersion !== 2
      || authorization.phase !== 'entered' || history === undefined || history === null) {
      throw new Error('S5 settleRun requires an entered running Run with its saved authorization/history');
    }
    const position = history.observedThroughPosition + 1;
    const source = { ...history.kernel, position };
    const input: TaskResultObservation = {
      claim, entry: { consumerId: authorization.consumerId, entryGeneration: authorization.generation },
      event: { schemaVersion: 1, eventType: 'run_completed', eventId: `s5-runtime-completed-${claim.runRef.runId}`,
        runRef: claim.runRef, sequence: current.run.lastEventSeq + 1, occurredAt: T,
        payload: { kind: 'completed', exitCode: 0 } },
      kernelSource: source,
      completedHistoryBoundary: { source, cursor: `s5-completed-${claim.runRef.runId}-${position}` },
      history: { kernel: history.kernel, startPosition: history.startPosition,
        observedThroughPosition: position, endPosition: position },
    };
    const settled = await entry.recordRunResult(ctx, { input, meta: {
      requestId: `s5-settle-${claim.runRef.runId}`, expected: [{ ref: claim.runRef, revision: current.run.revision }] } });
    if (settled.status !== 'committed') throw new Error(`S5 Run settlement failed: ${JSON.stringify(settled)}`);
    const after = await readExecution(claim);
    if (after.run.status !== 'ended' || after.run.outcome !== 'completed'
      || after.session.occupancy !== null || after.outbox.status !== 'settled' || after.attempt.status !== 'ended') {
      throw new Error('S5 Run settlement did not release its Session/Attempt/outbox');
    }
    return settled.value;
  }

  const claimRA = await claimRun({ requestId: 's5-claim-ra', goalRef: GOAL_B, planRef: PLAN_B1, taskId: 'b-work', sessionRef: sessionS });
  const runRA = await enterClaim(claimRA);
  const claimRB = await claimRun({ requestId: 's5-claim-rb', goalRef: GOAL_B, planRef: PLAN_B1, taskId: 'b-work-2', sessionRef: sessionSecond });
  const runRB = (await readExecution(claimRB)).run;
  if (pausedB) {
    const paused = await setGoalControlFromHost({ records, now, eventId }, ctx, {
      input: { goalRef: GOAL_B, control: 'pause', reason: null },
      meta: { requestId: 's5-ss-pause-at-seven', expected: [
        { ref: GOAL_B, revision: 6 },
        { ref: { aggregateType: 'GoalPhase', projectId: PROJECT_ID, goalId: GOAL_B.goalId }, revision: 0 },
      ] },
    });
    if (paused.status !== 'committed' || paused.value.revision !== 7 || paused.value.desiredState !== 'paused'
      || paused.value.desiredStateRevision !== 7) {
      throw new Error(`S5 paused Goal setup failed: ${JSON.stringify(paused)}`);
    }
    goalB = await readGoalSnapshot(GOAL_B);
  }

  // ---- two real root QueryJobs Q1/Q2 on Goal B -----------------------------
  const queryJobs = createQueryJobService({ records, now, eventId });
  function queryIntent(queryJobId: string, question: string): QueryJobIntentV1 {
    return { schemaVersion: 1, intentId: queryJobId, projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
      goalId: GOAL_B.goalId, question, focusTaskRefs: [], budget: { maxTokens: null, deadline: null },
      multiTurn: { maxRounds: 1 }, correlationId: `s5-${queryJobId}` };
  }
  async function seedQueryJob(input: { requestId: string; queryJobId: string; runId: string; intent: QueryJobIntentV1 }): Promise<S5QuerySeed> {
    const ref: QueryJobRef = { aggregateType: 'QueryJob', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, queryJobId: input.queryJobId };
    const runRef = { aggregateType: 'QueryRun' as const, projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
      queryJobId: input.queryJobId, runId: input.runId };
    const submit: GraphWrite<SubmitQueryJobInput> = { input: { queryJobId: input.queryJobId, runId: input.runId, intent: input.intent },
      meta: { requestId: input.requestId, expected: [
        { ref: PROJECT, revision: 1 }, { ref: WORKSPACE, revision: WORKSPACE_REVISION }, { ref: GOAL_B, revision: GOAL_REVISION },
        { ref, revision: 0 }, { ref: runRef, revision: 0 },
      ] } };
    const committed = await queryJobs.submitQueryJob(ctx, submit);
    if (committed.status !== 'committed') throw new Error(`S5 query submit failed: ${JSON.stringify(committed)}`);
    return { ref, intent: input.intent };
  }
  const Q1 = await seedQueryJob({ requestId: 's5-submit-q1', queryJobId: 'Q1', runId: 'Q1-run', intent: queryIntent('Q1', 'What is the first question?') });
  const Q2 = await seedQueryJob({ requestId: 's5-submit-q2', queryJobId: 'Q2', runId: 'Q2-run', intent: queryIntent('Q2', 'What is the second question?') });

  // ---- candidate proposals U1/U2 with the unique request-head claim --------
  const U1 = candidate('U1', GOAL_B, PLAN_B1, Q1.ref, futureDraft(planBDraft, PLAN_B2, 'b-u1-future'));
  const U2 = candidate('U2', GOAL_B, PLAN_B1, Q2.ref, futureDraft(planBDraft, PLAN_B2_Q2, 'b-u2-future'));
  for (const proposal of [U1, U2]) {
    if (proposal.requestRef === undefined || proposal.requestRef === null) throw new Error('S5 request candidate has no request');
    const requestId = `s5-seed-${proposal.ref.proposalId}`;
    await seedCommit([encodePlanProposal(proposal)], {
      claims: [requestHeadClaim(GOAL_B, proposal.requestRef, proposalRefKey(proposal))],
      events: [encodePlanProposalRecordedEvent({
        eventId: `${requestId}-event`, eventType: 'PlanProposalRecorded', schemaVersion: 2,
        projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, aggregateType: 'PlanProposal',
        aggregateId: proposal.ref.proposalId, aggregateRevision: 1,
        causationId: requestId, correlationId: requestId, idempotencyKey: requestId,
        actor: operatorActor, occurredAt: T, payload: { proposal },
      })],
    });
  }

  // ---- DecisionMessage + answered decision message, with real bodies ------
  const userRecipient = { kind: 'user' as const, projectId: PROJECT_ID, workspaceId: WORKSPACE_ID };
  const messageSourceRef: SourceRefV1 = { kind: 'workspace', refId: WORKSPACE_ID, revision: String(WORKSPACE_REVISION) };
  const runSender = { kind: 'work_run' as const, sessionRef: sessionS, runRef: runRA.ref,
    roleBinding: runRA.roleBinding, generation: claimRA.generation };
  const hostSender = { kind: 'host' as const, actor: { ...operatorActor } };
  const decisionPins: readonly VersionPin[] = [
    { ref: GOAL_A, revision: GOAL_REVISION }, { ref: GOAL_B, revision: GOAL_REVISION },
    { ref: GOAL_C, revision: GOAL_REVISION }, { ref: CANDIDATE_U1, revision: 1 }, { ref: PLAN_B1, revision: 1 },
  ];
  const capturedBases = [goalBasisOf(goalA), goalBasisOf(goalB), goalBasisOf(goalC)];
  const options: DecisionOptionV1[] = [
    { id: 'accept', label: 'Accept', effect: 'apply' },
    { id: 'reject', label: 'Reject', effect: 'reject' },
  ];
  const objects: DecisionMessageMetadataV1['objects'] = [
    { kind: 'aggregate', pin: { ref: PLAN_B1, revision: 1 }, label: 'Plan B1' },
    { kind: 'file', workspace: WORKSPACE_SCOPE, path: FILE_M, digest: null, label: 'File M' },
  ];

  const decisionRef: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, messageId: 's5-decision-message' };
  const answeredRef: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, messageId: 's5-answered-message' };

  /**
   * SPEC §3.3 line 629: a message source's stored `key` is built by
   * `decisionSourceKey(...)` over the real natural identity (the full canonical
   * `SessionMessageRef`), never a literal, so the two fixture messages get two
   * different keys. `goalBases` is the answer-time captured content basis.
   * The message's own pin is separate answer-request CAS, never a source pin
   * (SPEC §2.3); both the question and its saved response capture only these
   * referenced objects.
   */
  function messageSource(ref: SessionMessageRef): DecisionSourceV1 {
    return messageSourceOf(ref, decisionPins, capturedBases);
  }

  const decisionMetadata: DecisionMessageMetadataV1 = { schemaVersion: 1, source: messageSource(decisionRef), objects,
    options, syntheticAnswer: false, forwardedFrom: null };
  const answeredMetadata: DecisionMessageMetadataV1 = { schemaVersion: 1, source: messageSource(answeredRef), objects,
    options, syntheticAnswer: false, forwardedFrom: null };

  async function putBody(text: string, messageRef: SessionMessageRef, part: 'message' | 'response', sender: unknown): Promise<ArtifactRef> {
    const envelope = { schemaVersion: 1, projectId: messageRef.projectId, workspaceId: messageRef.workspaceId,
      messageId: messageRef.messageId, part, sender, text };
    const stored = await bodies.put({ body: JSON.stringify(envelope), contentType: SESSION_MESSAGE_CONTENT_TYPE,
      sourceRefs: [messageSourceRef], origin: { kind: 'run', owner: runRA.ref }, requestedAt: T });
    if (stored.status !== 'ready') throw new Error(`S5 message body store failed: ${JSON.stringify(stored)}`);
    return stored.value.ref;
  }

  const decisionBodyRef = await putBody('The operator must choose how Goal B proceeds.', decisionRef, 'message', runSender);
  const decisionMessage: SessionMessage = {
    ref: decisionRef, schemaVersion: 1, revision: MESSAGE_REVISION, sender: runSender, recipient: userRecipient,
    bodyRef: decisionBodyRef, sourceRef: decisionBodyRef.source, createdAt: T, status: 'pending', readAt: null, response: null,
    goalRef: GOAL_B, decision: decisionMetadata, intent: 'decision_request', needsReply: true, waitAfterSend: true,
  };
  await seedCommit([encodeSessionMessageRecord(decisionMessage)], { events: [encodeSessionMessageSentEvent({
    eventId: 's5-decision-sent', eventType: 'SessionMessageSent', schemaVersion: 1, occurredAt: T,
    projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, requestId: 's5-decision-send', actor: runSender, message: decisionMessage })] });

  const answeredMessageBody = await putBody('The operator must choose how to update Goal B or adopt candidate U1.', answeredRef, 'message', runSender);
  const sentAnsweredMessage: SessionMessage = {
    ref: answeredRef, schemaVersion: 1, revision: MESSAGE_REVISION, sender: runSender, recipient: userRecipient,
    bodyRef: answeredMessageBody, sourceRef: answeredMessageBody.source, createdAt: T,
    status: 'pending', readAt: null, response: null, goalRef: GOAL_B, decision: answeredMetadata,
    intent: 'decision_request', needsReply: true, waitAfterSend: true,
  };
  await seedCommit([encodeSessionMessageRecord(sentAnsweredMessage)], { events: [encodeSessionMessageSentEvent({
    eventId: 's5-answered-sent', eventType: 'SessionMessageSent', schemaVersion: 1, occurredAt: T,
    projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, requestId: 's5-answered-send', actor: runSender, message: sentAnsweredMessage,
  })] });
  const userBody = { schemaVersion: 1 as const, kind: 'user_decision_response' as const, selection: { kind: 'option' as const, optionId: 'accept' }, text: '', annotations: [] };
  const answeredResponseBody = await putBody(canonicalJson(userBody), answeredRef, 'response', hostSender);
  const response: UserMessageResponseV1 = {
    sender: hostSender, bodyRef: answeredResponseBody, sourceRef: answeredResponseBody.source, respondedAt: T,
    decision: { selection: { kind: 'option', optionId: 'accept' }, source: messageSource(answeredRef),
      annotations: [], requiresApplication: true },
  };
  const answeredMessage: SessionMessage = {
    ...sentAnsweredMessage, revision: MESSAGE_REVISION + 1, status: 'responded', readAt: T, response, application: null,
  };
  // D9 / SPEC §2.3: this is the original question's response slot, not a synthetic answer.
  await seedCommit([encodeSessionMessageRecord(answeredMessage)], {
    guards: [{ refKey: canonicalJson(answeredRef), expectedRevision: MESSAGE_REVISION }], events: [
    encodeSessionMessageRespondedEvent({ eventId: 's5-answered-answer', eventType: 'SessionMessageResponded', schemaVersion: 1,
      occurredAt: T, projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, requestId: 's5-answered-answer-req', actor: hostSender, message: answeredMessage }),
  ] });

  // ---- lookup helpers over the (possibly reopened) active records ----------
  async function lookupRefs(index: string, values: readonly (string | number | boolean | null)[], limit = 50): Promise<string[]> {
    const page = await activeRecords.lookup({ index, values, limit });
    if (page.status !== 'ready') throw new Error(`S5 lookup ${index} failed: ${JSON.stringify(page)}`);
    return page.value.records.map(record => record.refKey);
  }

  /**
   * No backend exposes an unrestricted public enumeration. Records use the
   * registered per-aggregate indexes above (all pages); events use eventAt up
   * to the real readMany([]) watermark. SQLite additionally exposes the actual
   * claim/receipt tables via a READ-ONLY connection.
   *
   * Memory has neither claim enumeration nor receipt enumeration. Its slot
   * vocabulary is every attempted claim through the fixture's shared records
   * port, plus B2's pre-existing Session mapping slots, discovered from the
   * actual Session records. Each owner is read using Store's unique-conflict
   * result, NOT inferred from a call counter or an expected owner. The probe
   * also has ledgerHorizon:null: even if its sentinel were an actual owner, the
   * nonempty ledger rejects it before any write/receipt/event. These probes use
   * the underlying port so observation does not change diagnostic counters.
   * Build all tested owners over f.records; foreign B2 owners are not P/W
   * fixture writers. Receipt count is omitted on memory, never guessed.
   */
  async function storeSnapshot(): Promise<S5StoreSnapshot> {
    const before = await activeRecords.readMany([]);
    if (before.status !== 'ready') throw new Error(`S5 snapshot watermark failed: ${JSON.stringify(before)}`);
    const lastCursor = before.value.readThrough;
    if (lastCursor === null) throw new Error('S5 snapshot requires its seeded, nonempty ledger');
    const stored: EncodedRecord[] = [];
    for (const aggregateType of snapshotTypes) {
      let after: string | undefined;
      do {
        const page = await activeRecords.lookup({ index: snapshotIndex(aggregateType), values: [aggregateType],
          limit: 200, ...(after === undefined ? {} : { after }) });
        if (page.status !== 'ready') throw new Error(`S5 snapshot lookup failed: ${JSON.stringify(page)}`);
        stored.push(...page.value.records);
        after = page.value.next ?? undefined;
      } while (after !== undefined);
    }
    // The inherited B2 setup only creates Session-mapping unique slots; Work
    // claim exclusion lives in TaskLease records, not unique claims.
    for (const record of stored.filter(record => record.schemaId === 'SessionRecord@1')) {
      const decoded = decodeSessionRecord(record);
      if (decoded.status !== 'decoded') throw new Error(`S5 snapshot Session decode failed: ${decoded.reason}`);
      knownClaimKeys.add(kernelSessionClaimKey(decoded.value.kernel.adapterId, decoded.value.kernel.kernelSessionId));
    }
    let eventCount = 0;
    for (let seq = 1; seq <= seqOfCommitCursor(lastCursor); seq += 1) {
      const event = await activeRecords.eventAt(makeCommitCursor(seq));
      if (event.status !== 'ready') throw new Error(`S5 snapshot event ${seq} failed: ${JSON.stringify(event)}`);
      eventCount += 1;
    }
    const claims: S5StoreSnapshot['claims'] = [];
    let receiptCount: number | undefined;
    if (kind === 'sqlite') {
      const db = new DatabaseSync(b2.base.ledgerPath, { readOnly: true });
      try {
        for (const row of db.prepare('SELECT claim_key, owner_key FROM identity_claims ORDER BY claim_key').all()) {
          if (typeof row.claim_key !== 'string' || typeof row.owner_key !== 'string') throw new Error('S5 corrupt claim row');
          claims.push({ claimKey: row.claim_key, owner: row.owner_key });
        }
        const count = db.prepare('SELECT COUNT(*) AS count FROM idempotency').get();
        if (count === undefined || typeof count.count !== 'number') throw new Error('S5 receipt count unavailable');
        receiptCount = count.count;
      } finally {
        db.close();
      }
    } else {
      const sentinel = 's5-snapshot-owner-probe';
      for (const claimKey of [...knownClaimKeys].sort()) {
        const event = { eventId: 's5-snapshot-probe-event', eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: T };
        const probed = await activeRecords.commit({
          identityKey: `s5-snapshot-probe:${claimKey}`, fingerprint: 's5-snapshot-probe',
          guards: [], records: [], claims: [{ claimKey, expectedOwner: sentinel, nextOwner: sentinel }],
          events: [{ ...event, json: JSON.stringify(event) }], indexGuards: [], indexChanges: [], ledgerHorizon: null,
        });
        if (probed.status !== 'rejected') throw new Error('S5 snapshot probe must never commit');
        if (probed.code === 'unique_conflict') {
          const actual = probed.current.find(entry => entry.claimKey === claimKey);
          if (actual === undefined) throw new Error('S5 snapshot probe omitted its claim');
          if (actual.owner !== null) claims.push({ claimKey, owner: actual.owner });
        } else if (probed.code === 'revision_conflict' && probed.current.length === 0) {
          // All slot guards matched; only the deliberately empty horizon lost.
          claims.push({ claimKey, owner: sentinel });
        } else {
          throw new Error(`S5 snapshot claim probe failed: ${JSON.stringify(probed)}`);
        }
      }
    }
    const after = await activeRecords.readMany([]);
    if (after.status !== 'ready' || after.value.readThrough !== lastCursor) {
      throw new Error('S5 storeSnapshot requires a quiescent store; finish concurrent operations first');
    }
    const versions = stored.map(({ refKey, revision }) => ({ refKey, revision }))
      .sort((left, right) => left.refKey < right.refKey ? -1 : left.refKey > right.refKey ? 1 : 0);
    return { records: versions, recordCount: versions.length, eventCount, lastCursor,
      claims, claimCount: claims.length, ...(receiptCount === undefined ? {} : { receiptCount }) };
  }

  let secondary: Awaited<ReturnType<B2ExecutionFixture['base']['reopenService']>> | undefined;

  const fixture: S5DecisionFixture = {
    kind, b2, records, counts, bodies, base, ctx, workspace, allocationCounts, newId, now, storeSnapshot,
    goals: { A: { ref: GOAL_A, snapshot: goalA, order: GOAL_ORDER.A, autonomy: goalA.settings!.autonomy },
      // Part 1's old control constructor drops the new optional settings. Use
      // the consumption default here to avoid a setup TypeError; SS11/12/15
      // still assert the actual persisted order/autonomy after the first stub.
      B: { ref: GOAL_B, snapshot: goalB, order: GOAL_ORDER.B, autonomy: goalBasisOf(goalB).settings.autonomy },
      C: { ref: GOAL_C, snapshot: goalC, order: GOAL_ORDER.C, autonomy: goalC.settings!.autonomy } },
    plans: { A1: planA1, B1: planB1, C1: planC1 },
    sessionS, sessionSecond, claimRA, runRA, claimRB, runRB, duties: fixtureDuties, operatorActor,
    requests: { Q1, Q2 }, candidates: { U1, U2 }, messages: { decision: decisionMessage, answered: answeredMessage },
    seedCommit, seedGoalSnapshot: snapshot => seedCommit([encodeGoalSnapshot(snapshot)]),
    seedPlanRevisionSnapshot: snapshot => seedCommit([encodePlanRevisionSnapshot(snapshot)]),
    seedCandidateProposal: proposal => seedCommit([encodePlanProposal(proposal)]),
    claimRun, enterClaim, createS5Session, settleRun, settleRunRA: () => settleRun(claimRA), seedQueryJob, lookupRefs,
    messagesByWorkspaceStatus: status => lookupRefs(S5_MESSAGE_BY_WORKSPACE_STATUS, [PROJECT_ID, WORKSPACE_ID, status]),
    planProposalsByRequest: queryJobId => lookupRefs(S5_PLAN_PROPOSAL_BY_REQUEST, [PROJECT_ID, WORKSPACE_ID, GOAL_B.goalId, queryJobId]),
    userMessagesByGoal: goalId => lookupRefs(S5_USER_MESSAGE_BY_GOAL, [PROJECT_ID, WORKSPACE_ID, 'user', goalId]),
    decisionAnswersBySource: (sourceKind, key) => lookupRefs(S5_DECISION_ANSWER_BY_SOURCE, [PROJECT_ID, WORKSPACE_ID, sourceKind, key]),
    queryJobsByGoal: goalId => lookupRefs(S5_QUERY_JOB_BY_GOAL, [PROJECT_ID, WORKSPACE_ID, goalId]),
    async reopen(): Promise<S5ReopenedFixture> {
      if (kind !== 'sqlite') throw new Error('S5 fixture reopen is only meaningful for the SQLite backend');
      await b2.base.closeBackend();
      await secondary?.close();
      await closeBodies();
      secondary = await b2.base.reopenService();
      const opened = secondary;
      activeRecords = opened.records;
      const store = createSqliteRawArtifactStore(bodyPath);
      bodies = allocations.observeBodies(store);
      closeBodies = () => store.close();
      fixture.bodies = bodies;
      return {
        records, bodies, counts, allocationCounts, newId, now, storeSnapshot,
        lookupRefs: async (index, values, limit = 50) => {
          const page = await activeRecords.lookup({ index, values, limit });
          if (page.status !== 'ready') throw new Error(`S5 lookup ${index} failed: ${JSON.stringify(page)}`);
          return page.value.records.map(record => record.refKey);
        },
        close: async () => { await store.close(); await opened.close(); },
      };
    },
    async close() {
      await secondary?.close().catch(() => undefined);
      await closeBodies().catch(() => undefined);
      await b2.close();
    },
  };
  return fixture;
}

/** Real S5 owners; the only fault seams are the two named retry reads. */
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
    goalSettings: settings, decisionMessages: decisions, decisionReads: real.reads, decisionSources: sources,
    decisionDuties: duties, goalExecutedFiles: createExecutedFilesStub(), applicationReceipt, now: f.now });
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
