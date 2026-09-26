/**
 * W2 Agent whiteboard domain fixture.
 *
 * It composes the REAL B2 execution fixture (real RecordStore, Goal/Plan/
 * Session services, real Kernel store mapping, formal TaskClaim and the real
 * `authorizeRuntimeEntry -> beginRuntimeEntry -> recordExecutionEntered`
 * writer) and then layers the W2 read/admission dependencies over the SAME
 * Store. The Agent Run/claim/Session/Lease are always produced by the formal
 * services; nothing is hand-seeded as an "admitted" receipt.
 *
 * The Plan service under test is the ordinary `createPlanService`, only with the
 * optional `delegatedWrites` dependency present. Host writes and reads are the
 * unchanged public `PlanTaskPort`. The W2 admission helpers are Stage-1
 * `unsupported`, so the target assertions in the test file are expected RED at
 * that seam, never green via a fabricated admission.
 *
 * Kernel note: the B2 fixture supplies an explicit test Kernel binding
 * (`KernelExecutionBinding`). These domain tests therefore prove only that the
 * WorkGraph domain writer accepted and persisted the entered Run/Session/Lease;
 * they do NOT claim real Kernel consumption. The single real
 * prepare -> entered -> tool -> Plan combination test remains owned by the
 * later composition root, and the SQLite test reuses the same binding.
 *
 * Two independent goals/runs are entered (`claim` and `secondClaim`) so the
 * cross-Run identity scenarios are exercised on real formal facts.
 */
import { expect } from 'vitest';
import {
  createB2ExecutionFixture, B2_AT, B2_HOST,
  type B2ExecutionFixture,
} from './B2-execution-fixture.js';
import {
  type ClaimFixtureKind, type TaskClaimFixture, type Records,
} from './task-claim-fixture.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../src/contracts/core/identity.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { RoleBindingRefV1, RunSnapshot, TaskLeaseSnapshot } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialAccessResolver } from '../../src/core/work-graph/materials/applicability.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import type { PlanProposal, PlanWriteProvenanceV1 } from '../../src/core/work-graph/tasks/plan-contracts.js';
import type { PlanTaskPort } from '../../src/core/work-graph/tasks/plan-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/tasks/contracts.js';
import type {
  AuthorizeConfiguration, KernelExecutionBinding,
} from '../../src/core/work-graph/tasks/execution-entry-contracts.js';
import type { PlanDelegatedWriteDependencies } from '../../src/core/work-graph/tasks/plan-write-admission.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/tasks/execution-read-contracts.js';
import {
  decodePlanRevisionSnapshot, encodePlanProposal, encodePlanProposalRecordedEvent,
} from '../../src/core/work-graph/tasks/plan-record-codecs.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';

export type W2PlanDraftV2 = Extract<PlanRevisionDraft, { schemaVersion: 2 }>;
export type W2Records = Records;

/** The scoped Agent attribution id the production branch will derive. */
export function agentActorIdFor(sessionRef: SessionRef): string {
  return 'session:' + sha256Hex(canonicalJson(sessionRef as unknown as JsonValue));
}
function goalRefOf(claim: TaskClaim): GoalRef {
  return { aggregateType: 'Goal', projectId: claim.task.projectId, goalId: claim.task.goalId };
}

export type W2AgentProposeRequest = GraphWrite<{
  goalRef: GoalRef; basedOn: PlanRevisionRef | null; draft: PlanRevisionDraft;
  reason: { text: string; sources: [] };
}>;
export type W2AgentApplyRequest = GraphWrite<{
  proposalRef: PlanProposal['ref']; expectedProposalRevision: number; decisionRefs: [];
}>;

export type W2WhiteboardFixture = {
  kind: ClaimFixtureKind;
  base: TaskClaimFixture;
  b2: B2ExecutionFixture;
  records: W2Records;
  ctxHost: CoreCallContext;
  ctxWork: CoreCallContext;
  ctxWorkSecond: CoreCallContext;
  plans: PlanTaskPort;
  delegatedWrites: PlanDelegatedWriteDependencies;
  host: { enabled: boolean; calls: number };
  claim: TaskClaim;
  secondClaim: TaskClaim;
  run: RunSnapshot;
  secondRun: RunSnapshot;
  goalRef: GoalRef;
  goal2Ref: GoalRef;
  planRef: PlanRevisionRef;
  plan2Ref: PlanRevisionRef;
  plan: PlanRevisionSnapshot;
  roleBinding: RoleBindingRefV1;
  readExecution(claim?: TaskClaim): Promise<TaskExecutionRecord>;
  readRun(claim?: TaskClaim): Promise<RunSnapshot>;
  readSession(claim?: TaskClaim): Promise<SessionRecord>;
  readLease(claim?: TaskClaim): Promise<TaskLeaseSnapshot | null>;
  readPlanSnapshot(ref: PlanRevisionRef): Promise<PlanRevisionSnapshot>;
  sessionPin(claim?: TaskClaim): Promise<VersionPin>;
  goalPin(goalRef?: GoalRef): Promise<VersionPin>;
  callerPins(goalRef?: GoalRef, planRef?: PlanRevisionRef): Promise<VersionPin[]>;
  /** A complete v2 future draft equal to `plan` plus caller overrides. */
  futureDraftFor(plan: PlanRevisionSnapshot, planId: string,
    mutate?: (draft: W2PlanDraftV2) => W2PlanDraftV2): W2PlanDraftV2;
  futureDraft(planId: string, mutate?: (draft: W2PlanDraftV2) => W2PlanDraftV2): W2PlanDraftV2;
  buildAgentProposeRequest(goalRef: GoalRef, planRef: PlanRevisionRef, draft: PlanRevisionDraft,
    basedOn: PlanRevisionRef | null, overrides?: { requestId?: string; expected?: readonly VersionPin[] }): Promise<W2AgentProposeRequest>;
  proposeAsWorkRun(draft: PlanRevisionDraft, basedOn: PlanRevisionRef | null,
    overrides?: { requestId?: string; expected?: readonly VersionPin[] }): Promise<WriteResult<PlanProposal>>;
  proposeAsSecondWorkRun(draft: PlanRevisionDraft, basedOn: PlanRevisionRef | null,
    overrides?: { requestId?: string; expected?: readonly VersionPin[] }): Promise<WriteResult<PlanProposal>>;
  applyAsWorkRun(proposalRef: PlanProposal['ref'], expectedProposalRevision: number,
    overrides?: { requestId?: string; expected?: readonly VersionPin[] }): Promise<WriteResult<PlanRevisionSnapshot>>;
  proposeAsHost(draft: PlanRevisionDraft, basedOn: PlanRevisionRef | null,
    overrides?: { requestId?: string; expected?: readonly VersionPin[] }): Promise<WriteResult<PlanProposal>>;
  applyAsHost(proposalRef: PlanProposal['ref'], expectedProposalRevision: number,
    overrides?: { requestId?: string; expected?: readonly VersionPin[] }): Promise<WriteResult<PlanRevisionSnapshot>>;
  /** Seed a real candidate record + event with an Agent submission source. */
  seedAgentCandidate(input: {
    claim?: TaskClaim; goalRef?: GoalRef; draft: PlanRevisionDraft; basedOn: PlanRevisionRef;
    proposalId: string; provenance?: Partial<PlanWriteProvenanceV1>;
  }): Promise<PlanProposal>;
  provenanceFor(claim?: TaskClaim, overrides?: Partial<PlanWriteProvenanceV1>): Promise<PlanWriteProvenanceV1>;
  finishRun(): Promise<void>;
  close(): Promise<void>;
};

export async function createW2WhiteboardFixture(kind: ClaimFixtureKind = 'memory'): Promise<W2WhiteboardFixture> {
  const b2 = await createB2ExecutionFixture(kind);
  const base = b2.base;
  let seq = 0;
  const now = () => B2_AT;
  const eventId = () => `w2-event-${++seq}`;
  const records = base.records;
  const reads = createRunStateReader({ records });
  const roles = createRoleConfigurationService({ records, now, eventId });

  // The same trusted Host configuration shape the B2 entry port re-checks. It is
  // a test double for an external callback, not a Store fact.
  const host = { enabled: true, calls: 0 };
  const configuration = { ...structuredClone(B2_HOST), permissions: {
    ...structuredClone(B2_HOST.permissions), tools: ['read', 'propose_future_plan', 'apply_future_plan'],
  } };
  const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
    host.calls++;
    const expectedRole = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
    if (!host.enabled || ctx.projectId !== base.scope.projectId || ctx.workspaceId !== base.scope.workspaceId
      || ![b2.claim.runRef, b2.secondClaim.runRef].some(ref => canonicalJson(ref) === canonicalJson(input.run.ref))
      || canonicalJson(input.run.roleBinding) !== canonicalJson(base.roleBinding)
      || canonicalJson(input.sessionRole) !== canonicalJson(expectedRole)
      || input.configurationRevision !== B2_HOST.configurationRevision
      || canonicalJson(input.permissions) !== canonicalJson(configuration.permissions)
      || canonicalJson(input.hostTemplate) !== canonicalJson(B2_HOST.hostTemplate)) {
      return { status: 'rejected', code: 'forbidden', reason: 'fixed test Host configuration does not authorize this request' };
    }
    return { status: 'ready', value: structuredClone(configuration) };
  };
  const delegatedWrites: PlanDelegatedWriteDependencies = {
    reads, roles, bodies: b2.bodies, authorizeConfiguration,
  };
  const plans = createPlanService({ records, now, eventId, delegatedWrites });

  const materialReads = createMaterialRecordReaders(records);
  const materials = createMaterialService({ bodies: b2.bodies, authority: materialReads.authority,
    grants: createMaterialAccessResolver(materialReads.authority, materialReads.index), now });
  const entry = createExecutionEntryService({ records, reads, roles, bodies: b2.bodies, materials,
    plans: base.plans, authorizeConfiguration, now, eventId, newId: () => `w2-entry-${++seq}` });
  const prepared = await b2.buildPrepared({ permissions: configuration.permissions });
  const entered = await b2.enter({ prepared, ports: { entry, model: b2.model } });
  const claim = b2.claim;
  const secondClaim = b2.secondClaim;
  const initial = await b2.read(claim);
  const run = initial.run;
  const secondFacts = await b2.read(secondClaim);
  // Enter the second independent Run through the SAME formal entry writer and W2 Host projection.
  // `b2.enter` hardcodes the first Run's Kernel identity slot, so the second Run
  // needs its own real Kernel binding; replicate the identical formal
  // authorize -> begin -> entered calls with that distinct binding.
  const preparedSecond = await b2.buildPrepared({ claim: secondClaim, permissions: configuration.permissions });
  const kernel2: KernelExecutionBinding = { adapterId: secondFacts.session.kernel.adapterId,
    kernelSessionId: secondFacts.session.kernel.kernelSessionId,
    runId: 'w2-second-kernel-run', turnId: 'w2-second-kernel-turn' };
  const authorize2 = await entry.authorizeRuntimeEntry(base.ctx, {
    input: { prepared: preparedSecond, consumerId: 'runtime-w2-second' },
    meta: { requestId: 'w2-second-authorize', expected: [await b2.secondRunPin()] } });
  if (authorize2.status !== 'committed') throw new Error(`W2 fixture second authorize failed: ${JSON.stringify(authorize2)}`);
  const begin2 = await entry.beginRuntimeEntry(base.ctx, {
    input: { permit: authorize2.value, kernel: kernel2 },
    meta: { requestId: 'w2-second-begin', expected: [await b2.secondRunPin()] } });
  if (begin2.status !== 'committed') throw new Error(`W2 fixture second begin failed: ${JSON.stringify(begin2)}`);
  const entered2 = await entry.recordExecutionEntered(base.ctx, {
    input: { permit: { ...authorize2.value, authorizationRevision: begin2.value.authorization.revision },
      enteredAt: B2_AT, kernelSource: { ...kernel2, position: 3 },
      history: { kernel: kernel2, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
    meta: { requestId: 'w2-second-entered', expected: [await b2.secondRunPin()] } });
  if (entered2.status !== 'committed') throw new Error(`W2 fixture second entered failed: ${JSON.stringify(entered2)}`);
  const secondInitial = await b2.read(secondClaim);
  const secondRun = secondInitial.run;

  function workCtxFor(claimRef: TaskClaim, roleBinding: RoleBindingRefV1): CoreCallContext {
    return {
      projectId: base.scope.projectId,
      workspaceId: claimRef.workspaceId,
      principal: { kind: 'work_run', runRef: claimRef.runRef, roleBinding },
      materialReader: { kind: 'run', requester: claimRef.runRef },
      signal: new AbortController().signal,
    };
  }
  const ctxHost = base.ctx;
  const ctxWork = workCtxFor(claim, run.roleBinding);
  const ctxWorkSecond = workCtxFor(secondClaim, secondRun.roleBinding);

  async function readExecution(target: TaskClaim = claim): Promise<TaskExecutionRecord> {
    const result = await reads.readExecution(ctxHost, target.runRef);
    if (result.status !== 'ready') throw new Error(`w2 fixture execution read failed: ${JSON.stringify(result)}`);
    return result.value;
  }
  async function readRun(target: TaskClaim = claim): Promise<RunSnapshot> {
    return (await readExecution(target)).run;
  }
  async function readSession(target: TaskClaim = claim): Promise<SessionRecord> {
    const card = await base.sessionsPort.readSession(ctxHost, target.sessionRef);
    if (card.status !== 'ready') throw new Error(`w2 fixture Session read failed: ${JSON.stringify(card)}`);
    return card.value.record;
  }
  async function readLease(target: TaskClaim = claim): Promise<TaskLeaseSnapshot | null> {
    return (await readExecution(target)).lease;
  }
  async function readRevision(refKey: string): Promise<number> {
    const read = await records.readMany([refKey]);
    if (read.status !== 'ready') throw new Error(`w2 fixture revision read failed: ${JSON.stringify(read)}`);
    const record = read.value.records.find(candidate => candidate.refKey === refKey);
    if (record === undefined) throw new Error(`w2 fixture record is absent: ${refKey}`);
    const parsed = JSON.parse(record.json) as { revision?: unknown };
    if (typeof parsed.revision !== 'number') throw new Error(`w2 fixture record has no revision: ${refKey}`);
    return parsed.revision;
  }
  async function readPlanSnapshot(ref: PlanRevisionRef): Promise<PlanRevisionSnapshot> {
    const key = canonicalJson(ref as unknown as JsonValue);
    const read = await records.readMany([key]);
    if (read.status !== 'ready') throw new Error(`w2 fixture Plan read failed: ${JSON.stringify(read)}`);
    const record = read.value.records.find(candidate => candidate.refKey === key);
    if (record === undefined) throw new Error(`w2 fixture Plan record is absent: ${key}`);
    const decoded = decodePlanRevisionSnapshot(record);
    if (decoded.status !== 'decoded') throw new Error(`w2 fixture Plan decode failed: ${decoded.reason}`);
    return decoded.value;
  }
  async function sessionPin(target: TaskClaim = claim): Promise<VersionPin> {
    return { ref: plainSessionRefToAggregate(target.sessionRef), revision: (await readSession(target)).revision };
  }
  async function goalPin(goalRef: GoalRef = base.goalRef): Promise<VersionPin> {
    const read = await base.plans.queryGoal(ctxHost, goalRef);
    if (read.status !== 'ready') throw new Error(`w2 fixture Goal read failed: ${JSON.stringify(read)}`);
    return { ref: goalRef, revision: read.value.goal.revision };
  }
  async function callerPins(goalRef: GoalRef = base.goalRef,
    planRef: PlanRevisionRef = base.planRef): Promise<VersionPin[]> {
    return [
      { ref: base.projectRef, revision: await readRevision(canonicalJson(base.projectRef as unknown as JsonValue)) },
      { ref: base.workspaceRef, revision: await readRevision(canonicalJson(base.workspaceRef as unknown as JsonValue)) },
      await goalPin(goalRef),
      { ref: planRef, revision: 1 },
    ];
  }
  function futureDraftFor(plan: PlanRevisionSnapshot, planId: string,
    mutate?: (draft: W2PlanDraftV2) => W2PlanDraftV2): W2PlanDraftV2 {
    const draft: W2PlanDraftV2 = {
      schemaVersion: 2, planId, planRevision: plan.planRevision + 1, goalId: plan.goalRef.goalId,
      stages: structuredClone(plan.stages), tasks: structuredClone(plan.tasks),
      assignments: structuredClone(plan.assignments ?? []), obligations: structuredClone(plan.obligations),
      taskHierarchy: structuredClone(plan.taskHierarchy), executionDag: structuredClone(plan.executionDag),
      taskRelations: [], inputRequirements: [],
    };
    return mutate === undefined ? draft : mutate(draft);
  }
  function futureDraft(planId: string, mutate?: (draft: W2PlanDraftV2) => W2PlanDraftV2): W2PlanDraftV2 {
    return futureDraftFor(base.plan, planId, mutate);
  }
  async function buildAgentProposeRequest(goalRef: GoalRef, planRef: PlanRevisionRef, draft: PlanRevisionDraft,
    basedOn: PlanRevisionRef | null,
    overrides: { requestId?: string; expected?: readonly VersionPin[] } = {}): Promise<W2AgentProposeRequest> {
    return { input: { goalRef, basedOn, draft, reason: { text: 'W2 Agent whiteboard change', sources: [] } },
      meta: { requestId: overrides.requestId ?? `w2-agent-propose-${++seq}`,
        expected: overrides.expected ?? await callerPins(goalRef, planRef) } };
  }
  async function proposeAsWorkRun(draft: PlanRevisionDraft, basedOn: PlanRevisionRef | null,
    overrides: { requestId?: string; expected?: readonly VersionPin[] } = {}): Promise<WriteResult<PlanProposal>> {
    return plans.proposePlan(ctxWork, await buildAgentProposeRequest(base.goalRef, basedOn ?? base.planRef, draft, basedOn, overrides));
  }
  async function proposeAsSecondWorkRun(draft: PlanRevisionDraft, basedOn: PlanRevisionRef | null,
    overrides: { requestId?: string; expected?: readonly VersionPin[] } = {}): Promise<WriteResult<PlanProposal>> {
    return plans.proposePlan(ctxWorkSecond,
      await buildAgentProposeRequest(goal2Ref, secondClaim.planRef, draft, basedOn, overrides));
  }
  async function applyAsWorkRun(proposalRef: PlanProposal['ref'], expectedProposalRevision: number,
    overrides: { requestId?: string; expected?: readonly VersionPin[] } = {}): Promise<WriteResult<PlanRevisionSnapshot>> {
    return plans.applyPlanChange(ctxWork, { input: { proposalRef, expectedProposalRevision, decisionRefs: [] },
      meta: { requestId: overrides.requestId ?? `w2-agent-apply-${++seq}`,
        expected: overrides.expected ?? await callerPins() } });
  }
  async function proposeAsHost(draft: PlanRevisionDraft, basedOn: PlanRevisionRef | null,
    overrides: { requestId?: string; expected?: readonly VersionPin[] } = {}): Promise<WriteResult<PlanProposal>> {
    return plans.proposePlan(ctxHost, await buildAgentProposeRequest(base.goalRef, basedOn ?? base.planRef, draft, basedOn, overrides));
  }
  async function applyAsHost(proposalRef: PlanProposal['ref'], expectedProposalRevision: number,
    overrides: { requestId?: string; expected?: readonly VersionPin[] } = {}): Promise<WriteResult<PlanRevisionSnapshot>> {
    return plans.applyPlanChange(ctxHost, { input: { proposalRef, expectedProposalRevision, decisionRefs: [] },
      meta: { requestId: overrides.requestId ?? `w2-host-apply-${++seq}`,
        expected: overrides.expected ?? await callerPins() } });
  }
  async function provenanceFor(target: TaskClaim = claim,
    overrides: Partial<PlanWriteProvenanceV1> = {}): Promise<PlanWriteProvenanceV1> {
    const facts = await readExecution(target);
    const auth = facts.run.executionAuthorization;
    if (auth === undefined || !('schemaVersion' in auth) || auth.schemaVersion !== 2) {
      throw new Error('w2 fixture provenance requires the formal V2 entry binding');
    }
    return { schemaVersion: 1, runRef: target.runRef, sessionRef: target.sessionRef,
      roleBinding: facts.run.roleBinding, sessionGeneration: auth.sessionGeneration,
      entryGeneration: auth.generation, authorizationRevision: auth.revision,
      configurationRevision: B2_HOST.configurationRevision, ...overrides };
  }
  async function seedAgentCandidate(input: {
    claim?: TaskClaim; goalRef?: GoalRef; draft: PlanRevisionDraft; basedOn: PlanRevisionRef;
    proposalId: string; provenance?: Partial<PlanWriteProvenanceV1>;
  }): Promise<PlanProposal> {
    const target = input.claim ?? claim;
    const candidateGoal = input.goalRef ?? base.goalRef;
    const provenance = await provenanceFor(target, input.provenance);
    const ref = { aggregateType: 'PlanProposal' as const, projectId: base.scope.projectId,
      workspaceId: base.scope.workspaceId, proposalId: input.proposalId };
    const candidate: Extract<PlanProposal, { kind: 'candidate_v2' }> = {
      kind: 'candidate_v2', ref, revision: 1, schemaVersion: 2, goalRef: candidateGoal,
      basedOn: input.basedOn, draft: input.draft, reason: { text: 'W2 seeded Agent candidate', sources: [] },
      status: 'candidate', issues: [], submittedBy: provenance,
    };
    const event = {
      eventId: `w2-seed-proposal-${++seq}`, eventType: 'PlanProposalRecorded' as const, schemaVersion: 2 as const,
      projectId: base.scope.projectId, workspaceId: base.scope.workspaceId,
      aggregateType: 'PlanProposal' as const, aggregateId: input.proposalId, aggregateRevision: 1,
      causationId: `w2-seed-command-${seq}`, correlationId: `w2-seed-correlation-${seq}`,
      idempotencyKey: `w2-seed-proposal-${input.proposalId}`,
      actor: { kind: 'agent' as const, id: agentActorIdFor(target.sessionRef), runRef: target.runRef },
      occurredAt: B2_AT, payload: { proposal: candidate },
    };
    const committed = await records.commit({
      identityKey: `w2-seed-proposal-${input.proposalId}`, fingerprint: `w2-seed-proposal-${input.proposalId}-v1`,
      guards: [{ refKey: canonicalJson(ref as unknown as JsonValue), expectedRevision: null }],
      records: [encodePlanProposal(candidate)], events: [encodePlanProposalRecordedEvent(event)],
      claims: [], indexGuards: [], indexChanges: [] });
    if (committed.status !== 'committed') throw new Error(`w2 seed candidate failed: ${JSON.stringify(committed)}`);
    return candidate;
  }
  const goal2Ref = goalRefOf(secondClaim);

  // Prove the fixture's own preconditions before any target assertion can run.
  expect(entered, 'W2 fixture first entered Run prerequisite').toBeTruthy();
  expect(run.status, 'W2 fixture first Run is running').toBe('running');
  const auth = run.executionAuthorization;
  expect(auth && 'schemaVersion' in auth && auth.schemaVersion === 2 && auth.phase,
    'W2 fixture first V2 entered prerequisite').toBe('entered');
  expect(secondRun.status, 'W2 fixture second Run is running').toBe('running');
  const auth2 = secondRun.executionAuthorization;
  expect(auth2 && 'schemaVersion' in auth2 && auth2.schemaVersion === 2 && auth2.phase,
    'W2 fixture second V2 entered prerequisite').toBe('entered');
  expect(initial.session.lifecycle, 'W2 fixture Session active prerequisite').toBe('active');
  expect(initial.session.health, 'W2 fixture Session available prerequisite').toBe('available');
  expect(initial.lease, 'W2 fixture Lease exists').not.toBeNull();
  expect(initial.lease!.release, 'W2 fixture Lease unreleased prerequisite').toBeUndefined();
  expect(run.envelope?.permissions.tools).toEqual(configuration.permissions.tools);
  expect(secondRun.envelope?.permissions.tools).toEqual(configuration.permissions.tools);
  const roleFacts = await roles.resolveRoleBindingFacts(ctxHost, { roleBinding: run.roleBinding, declaredPermissions: configuration.permissions });
  expect(roleFacts.result, 'real verified absent matrix uses the exact trusted legacy template').toMatchObject({ status: 'ready', value: { status: 'absent' } });

  return {
    kind, base, b2, records, ctxHost, ctxWork, ctxWorkSecond, plans, delegatedWrites, host,
    claim, secondClaim, run, secondRun, goalRef: base.goalRef, goal2Ref,
    planRef: base.planRef, plan2Ref: secondClaim.planRef, plan: base.plan,
    roleBinding: base.roleBinding,
    readExecution, readRun, readSession, readLease, readPlanSnapshot,
    sessionPin, goalPin, callerPins,
    futureDraftFor, futureDraft, buildAgentProposeRequest,
    proposeAsWorkRun, proposeAsSecondWorkRun, applyAsWorkRun, proposeAsHost, applyAsHost,
    seedAgentCandidate, provenanceFor,
    async finishRun() {
      const result = await entry.recordRunResult(ctxHost, { input: b2.terminalObservation(entered),
        meta: { requestId: 'w2-formal-terminal', expected: [await b2.runPin()] } });
      expect(result, 'formal terminal prerequisite').toMatchObject({ status: 'committed', value: { status: 'ended' } });
    },
    close: () => base.close(),
  };
}
