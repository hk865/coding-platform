/**
 * Slice 3 exact task-input owner (spec §3.4 / §3.5).
 *
 * The frozen check order is implemented literally:
 *   synchronously clone ctx/request (keep the original AbortSignal)
 *   -> shape/scope
 *   -> bind the principal (work_run: canonical Run/task/claim/plan;
 *      query_run: canonical QueryJob/QueryRun/Goal/workspace; host: fixed scope)
 *   -> exact Plan/Task (a work_run request may name its claim Plan or the Goal's
 *      active Plan with a `carried_unchanged` verdict; the declarations always
 *      come from the claim Plan's execution definition)
 *   -> read the Plan's declarations (legacy `inputRequirements` + DAG edges)
 *   -> targeted upstream facts (artifact provenance, gate rounds, Message, Workspace)
 *   -> pure declaration guard (`state/context-input.ts:declaredInputProblem`)
 *   -> ONLY here build the same-scope internal Host historical material reader
 *   -> `MaterialPort.openArtifact(..., usage: 'historical_explanation')`
 *   -> re-check the whole canonical ArtifactRef, digest and sizeBytes
 *   -> return the complete selection.
 *
 * The shared pure guard `state/context-input.ts:declaredInputProblem` owns the
 * G-INPUT checks; the material bridge is constructed only after it passes.
 */
import type { ArtifactOwnerRunRef, ArtifactRef, ArtifactRecord } from '../../../contracts/artifact.js';
import { artifactBodyDigest, artifactBodySize } from '../../../contracts/artifact.js';
import type { CoreCallContext, CorePrincipal, MaterialReader } from '../../../contracts/core/call-context.js';
import type { CoreError, CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  InputArtifactProvenanceV1, InputDeclarationV1, InputSelectionV1,
  SelectedInputSourceV1, TaskInputPageRequestV1, TaskInputPageV1,
} from '../../../contracts/graph-context.js';
import type { GoalRef, GoalSnapshot, WorkspaceRef } from '../../../contracts/ledger.js';
import { sameArtifactOwnerRunRef } from '../../../contracts/material-access.js';
import type { PlanRevisionRef, PlanRevisionSnapshot, TaskInputRequirementV2 } from '../../../contracts/plan.js';
import type { QueryJobRef, QueryJobSnapshot, QueryRunRef, QueryRunSnapshot } from '../../../contracts/query-job.js';
import type { MaterialOrigin } from '../../record-store/body-ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { materialOwnerFromOrigin } from '../materials/applicability.js';
import { createMaterialRecordReaders } from '../materials/record-readers.js';
import type { MaterialAuthorityReads } from '../materials/record-ports.js';
import { decodeQueryJobSnapshot } from '../queries/query-record-codecs.js';
import { decodeSessionMessageRecord, sessionMessageRefKey } from '../sessions/message-record-codecs.js';
import type { RoundSnapshot } from '../../../contracts/verification.js';
import { roundOrdinalOf } from '../state/verification-machine.js';
import { declaredInputProblem } from '../state/context-input.js';
import type { TaskContextInputDependencies, TaskContextInputPort } from '../model/context-input-contracts.js';
import { readEntryPlanVerdict } from './entry-plan-reader.js';
import { isBasisUnsupported, planTaskFacts } from './plan-task-basis.js';
import {
  readBatch, readCanonicalTaskFacts, readGateRoundChain, readGoalScope, readPlan, readRunRoundChain,
} from './plan-readers.js';

export type { TaskContextInputPort } from '../model/context-input-contracts.js';
export type { TaskContextInputDependencies } from '../model/context-input-contracts.js';

// --------------------------------------------------------------------------
// Local shapes
// --------------------------------------------------------------------------

type Records = GoalRecordTransactionPort & RecordLookupPort;

type BoundContext = {
  goalRef: GoalRef;
  goal: GoalSnapshot;
  workspaceRef: WorkspaceRef;
  workspaceRevision: number;
  plan: PlanRevisionSnapshot;
  run: RunSnapshot | null;
};

type PendingSelection = {
  selection: InputSelectionV1;
  /** A selected Artifact whose physical read still has to go through the bridge. */
  pending: { ref: ArtifactRef; provenance: InputArtifactProvenanceV1 } | null;
};

type RawBodyOutcome =
  | { status: 'ready'; origin: MaterialOrigin; storedRef: ArtifactRef }
  | { status: 'unavailable'; errorCode: CoreError; reason: string };

type ReadCaches = {
  raw: Map<string, RawBodyOutcome>;
  opened: Map<string, ReadResult<ArtifactRecord>>;
};

type PageCursor = {
  v: 1;
  projectId: string;
  workspaceId: string;
  consumer: TaskTriple;
  planRef: PlanRevisionRef;
  declarationId: string;
  candidateKey: string | null;
  source: SelectedInputSourceV1;
  offset: number;
};

const CURSOR_PREFIX = 's3ip1.';
const MAX_PAGE_BYTES = 4096;

function rejection(code: CoreError, reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}

function cancelledRejection(): CoreRejection {
  return rejection('cancelled', 'the task-input read was cancelled before any store or material IO');
}

function newCaches(): ReadCaches {
  return { raw: new Map(), opened: new Map() };
}

// --------------------------------------------------------------------------
// Synchronous clone (original AbortSignal kept)
// --------------------------------------------------------------------------

function clonePrincipal(principal: CorePrincipal): CorePrincipal {
  if (principal.kind === 'host') return { kind: 'host', actor: { ...principal.actor } };
  if (principal.kind === 'work_run') {
    return {
      kind: 'work_run', runRef: { ...principal.runRef }, roleBinding: { ...principal.roleBinding },
      ...(principal.agentPrincipal === undefined ? {} : { agentPrincipal: structuredClone(principal.agentPrincipal) }),
    };
  }
  return { kind: 'query_run', queryRunRef: { ...principal.queryRunRef }, initiator: { ...principal.initiator } };
}

function cloneReader(reader: MaterialReader): MaterialReader {
  if (reader.kind === 'host') {
    return {
      kind: 'host', projectId: reader.projectId,
      ...(reader.workspaceId === undefined ? {} : { workspaceId: reader.workspaceId }),
      actor: { ...reader.actor },
    };
  }
  return { kind: 'run', requester: structuredClone(reader.requester) };
}

function cloneContext(ctx: CoreCallContext): CoreCallContext {
  return {
    projectId: ctx.projectId,
    ...(ctx.workspaceId === undefined ? {} : { workspaceId: ctx.workspaceId }),
    principal: clonePrincipal(ctx.principal),
    materialReader: cloneReader(ctx.materialReader),
    signal: ctx.signal,
  };
}

// --------------------------------------------------------------------------
// Shape/scope checks
// --------------------------------------------------------------------------

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function taskTripleProblem(value: unknown, field: string): string | null {
  if (typeof value !== 'object' || value === null) return `${field} must be a TaskTriple`;
  const task = value as Record<string, unknown>;
  if (!nonEmptyString(task['projectId']) || !nonEmptyString(task['goalId']) || !nonEmptyString(task['taskId'])) {
    return `${field} must be a complete TaskTriple`;
  }
  return null;
}

function planRefProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'planRef must be a PlanRevisionRef';
  const ref = value as Record<string, unknown>;
  if (ref['aggregateType'] !== 'PlanRevision' || !nonEmptyString(ref['projectId']) || !nonEmptyString(ref['planId'])) {
    return 'planRef must be a complete PlanRevisionRef';
  }
  return null;
}

function inputRequestShapeProblem(request: { consumer: TaskTriple; planRef: PlanRevisionRef;
  declarationId?: string; candidateKey?: string }): string | null {
  return taskTripleProblem(request.consumer, 'consumer') ?? planRefProblem(request.planRef)
    ?? (request.declarationId !== undefined && !nonEmptyString(request.declarationId)
      ? 'declarationId must be a non-empty string' : null)
    ?? (request.candidateKey !== undefined && !nonEmptyString(request.candidateKey)
      ? 'candidateKey must be a non-empty string' : null);
}

function pageRequestShapeProblem(request: TaskInputPageRequestV1): string | null {
  return taskTripleProblem(request.consumer, 'consumer') ?? planRefProblem(request.planRef)
    ?? (!nonEmptyString(request.declarationId) ? 'declarationId must be a non-empty string' : null)
    ?? (!(request.afterCursor === null || nonEmptyString(request.afterCursor))
      ? 'afterCursor must be null or a non-empty string' : null)
    ?? (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1 || request.maxBytes > MAX_PAGE_BYTES
      ? `maxBytes must be a safe integer in 1..${String(MAX_PAGE_BYTES)}` : null)
    ?? (request.candidateKey !== undefined && !nonEmptyString(request.candidateKey)
      ? 'candidateKey must be a non-empty string' : null);
}

function sameTaskTriple(left: TaskTriple, right: TaskTriple): boolean {
  return left.projectId === right.projectId && left.goalId === right.goalId && left.taskId === right.taskId;
}

function planRefKey(ref: PlanRevisionRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

function samePlanRef(left: PlanRevisionRef, right: PlanRevisionRef): boolean {
  return planRefKey(left) === planRefKey(right);
}

function sameFullArtifactRef(left: ArtifactRef, right: ArtifactRef): boolean {
  // The legacy exactness rule compares the WHOLE canonical ArtifactRef, including `source`.
  return canonicalJson(left as unknown as JsonValue) === canonicalJson(right as unknown as JsonValue);
}

// --------------------------------------------------------------------------
// Principal binding
// --------------------------------------------------------------------------

async function loadCanonicalRun(
  authority: MaterialAuthorityReads, ref: RunRef,
): Promise<{ status: 'ready'; run: RunSnapshot } | CoreRejection> {
  const loaded = await authority.load(ref);
  if (loaded.status === 'not_found') return rejection('not_found', `Run ${ref.runId} does not exist`);
  if (loaded.status !== 'found') return rejection('unavailable', loaded.reason);
  const snapshot = loaded.snapshot;
  if (snapshot.ref.aggregateType !== 'Run' || !sameArtifactOwnerRunRef(snapshot.ref, ref)) {
    return rejection('forbidden', 'the canonical Run load did not return the requested full ref');
  }
  return { status: 'ready', run: snapshot as RunSnapshot };
}

async function loadCanonicalQueryRun(
  authority: MaterialAuthorityReads, ref: QueryRunRef,
): Promise<{ status: 'ready'; run: QueryRunSnapshot } | CoreRejection> {
  const loaded = await authority.load(ref);
  if (loaded.status === 'not_found') return rejection('not_found', `QueryRun ${ref.runId} does not exist`);
  if (loaded.status !== 'found') return rejection('unavailable', loaded.reason);
  const snapshot = loaded.snapshot;
  if (snapshot.ref.aggregateType !== 'QueryRun' || !sameArtifactOwnerRunRef(snapshot.ref, ref)) {
    return rejection('forbidden', 'the canonical QueryRun load did not return the requested full ref');
  }
  return { status: 'ready', run: snapshot as QueryRunSnapshot };
}

async function readQueryJob(
  records: Records, ref: QueryJobRef,
): Promise<{ status: 'ready'; job: QueryJobSnapshot } | CoreRejection> {
  const key = canonicalJson(ref as unknown as JsonValue);
  const read = await readBatch(records, [key]);
  if (read.status !== 'ready') return read;
  const record = read.batch.present.get(key);
  if (record === undefined) return rejection('not_found', `QueryJob ${ref.queryJobId} does not exist`);
  const decoded = decodeQueryJobSnapshot(record);
  if (decoded.status !== 'decoded') {
    return rejection('unavailable', `QueryJob ${ref.queryJobId} is corrupt: ${decoded.reason}`);
  }
  return { status: 'ready', job: decoded.value };
}

async function bindContext(
  deps: TaskContextInputDependencies, authority: MaterialAuthorityReads, ctx: CoreCallContext,
  request: { consumer: TaskTriple; planRef: PlanRevisionRef },
): Promise<{ status: 'ready'; value: BoundContext } | CoreRejection> {
  const consumer = request.consumer;
  const principal = ctx.principal;
  let goalRef: GoalRef;
  let run: RunSnapshot | null = null;

  if (principal.kind === 'host') {
    goalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId: consumer.goalId };
  } else if (principal.kind === 'work_run') {
    const loaded = await loadCanonicalRun(authority, principal.runRef);
    if (loaded.status !== 'ready') return loaded;
    run = loaded.run;
    if (run.ref.projectId !== ctx.projectId || run.ref.goalId !== consumer.goalId
      || !sameTaskTriple(run.task, consumer)) {
      return rejection('forbidden', 'the canonical Run does not belong to the requested consumer Task');
    }
    if (ctx.workspaceId !== undefined && run.workspaceSnapshot.workspaceId !== ctx.workspaceId) {
      return rejection('forbidden', 'the canonical Run workspace does not match the call scope');
    }
    goalRef = { aggregateType: 'Goal', projectId: run.ref.projectId, goalId: run.ref.goalId };
  } else {
    const loaded = await loadCanonicalQueryRun(authority, principal.queryRunRef);
    if (loaded.status !== 'ready') return loaded;
    const queryRun = loaded.run;
    if (queryRun.ref.projectId !== ctx.projectId
      || (ctx.workspaceId !== undefined && queryRun.ref.workspaceId !== ctx.workspaceId)) {
      return rejection('forbidden', 'the canonical QueryRun does not match the call scope');
    }
    const jobRead = await readQueryJob(deps.records, queryRun.run.queryJobRef);
    if (jobRead.status !== 'ready') return jobRead;
    const job = jobRead.job;
    if (job.job.goalId === null) return rejection('forbidden', 'the canonical QueryJob names no Goal');
    if (job.job.projectId !== ctx.projectId || job.job.workspaceId !== queryRun.ref.workspaceId) {
      return rejection('forbidden', 'the canonical QueryJob does not match the QueryRun scope');
    }
    if (job.job.goalId !== consumer.goalId || consumer.projectId !== job.job.projectId) {
      return rejection('forbidden', 'the consumer Task does not belong to the canonical Query Goal');
    }
    goalRef = { aggregateType: 'Goal', projectId: job.job.projectId, goalId: job.job.goalId };
  }

  const goalScope = await readGoalScope(deps.records, goalRef);
  if (goalScope.status !== 'ready') return goalScope;
  if (ctx.workspaceId !== undefined && goalScope.goal.workspaceRef.workspaceId !== ctx.workspaceId) {
    return rejection('forbidden', 'the Goal workspace does not match the call scope');
  }

  const planRead = await readPlan(deps.records, request.planRef);
  if (planRead.status !== 'ready') return planRead;
  const plan = planRead.plan;
  if (plan.ref.projectId !== request.planRef.projectId || plan.ref.planId !== request.planRef.planId
    || plan.goalRef.projectId !== goalRef.projectId || plan.goalRef.goalId !== goalRef.goalId) {
    return rejection('forbidden', 'the requested Plan does not belong to the consumer Goal');
  }
  if (!plan.tasks.some(task => task.taskId === consumer.taskId)) {
    return rejection('not_found', `the Plan has no Task ${consumer.taskId}`);
  }

  // Exact Plan/Task: the declarations ALWAYS come from the claim Plan's
  // execution definition. A work_run caller may request its own claim Plan, or
  // the Goal's active Plan admitted by `readEntryPlanVerdict` as carrying the
  // claim definition unchanged; any other Plan is `forbidden`.
  let declarationPlan = plan;
  if (run !== null && !samePlanRef(run.planRef, request.planRef)) {
    if (goalScope.goal.activePlanRevision === null
      || !samePlanRef(request.planRef, goalScope.goal.activePlanRevision)) {
      return rejection('forbidden', 'the requested Plan is neither the Run claim Plan nor the Goal active Plan');
    }
    const claimPlanRead = await readPlan(deps.records, run.planRef);
    if (claimPlanRead.status !== 'ready') return claimPlanRead;
    const claimPlan = claimPlanRead.plan;
    if (claimPlan.ref.projectId !== goalRef.projectId || claimPlan.goalRef.goalId !== goalRef.goalId
      || !claimPlan.tasks.some(task => task.taskId === consumer.taskId)) {
      return rejection('forbidden', 'the Run claim Plan does not define the consumer Task in this Goal');
    }
    const verdictRead = await readEntryPlanVerdict(deps.records, {
      goalRef, taskId: consumer.taskId, claimPlan, activePlanRef: goalScope.goal.activePlanRevision,
    });
    if (verdictRead.status !== 'ready') return verdictRead;
    if (verdictRead.verdict.kind === 'unavailable') return rejection('incomplete', verdictRead.verdict.reason);
    if (verdictRead.verdict.kind !== 'carried_unchanged') {
      return rejection('forbidden', verdictRead.verdict.kind === 'changed'
        ? verdictRead.verdict.reason
        : 'the Goal active Plan does not carry the claim execution definition unchanged');
    }
    declarationPlan = claimPlan;
  }

  return {
    status: 'ready',
    value: {
      goalRef, goal: goalScope.goal, workspaceRef: goalScope.goal.workspaceRef,
      workspaceRevision: goalScope.workspaceRevision, plan: declarationPlan, run,
    },
  };
}

// --------------------------------------------------------------------------
// Declarations
// --------------------------------------------------------------------------

function legacyRequirements(plan: PlanRevisionSnapshot): readonly TaskInputRequirementV2[] {
  return plan.schemaVersion === 2 ? plan.inputRequirements ?? [] : [];
}

function declarationsFor(plan: PlanRevisionSnapshot, consumer: TaskTriple): InputDeclarationV1[] {
  const declarations: InputDeclarationV1[] = [];
  for (const requirement of legacyRequirements(plan)) {
    if (requirement.consumerTaskId !== consumer.taskId) continue;
    declarations.push({
      declarationId: `legacy:${requirement.requirementId}`,
      consumer: { projectId: plan.goalRef.projectId, goalId: plan.goalRef.goalId, taskId: requirement.consumerTaskId },
      planRef: plan.ref,
      upstream: null,
      requires: { kind: 'artifact', label: requirement.requirementId },
      legacyArtifactRef: requirement.artifactRef,
    });
  }
  for (const edge of plan.executionDag.dependsOn) {
    if (edge.taskId !== consumer.taskId) continue;
    const declarationId = 'edge:' + sha256Hex(canonicalJson({
      planRef: plan.ref, consumerTaskId: edge.taskId, dependsOnId: edge.dependsOnId, requires: edge.requires,
    } as unknown as JsonValue));
    declarations.push({
      declarationId,
      consumer: { projectId: plan.goalRef.projectId, goalId: plan.goalRef.goalId, taskId: edge.taskId },
      planRef: plan.ref,
      upstream: { projectId: plan.goalRef.projectId, goalId: plan.goalRef.goalId, taskId: edge.dependsOnId },
      requires: edge.requires,
      legacyArtifactRef: null,
    });
  }
  return declarations;
}

// --------------------------------------------------------------------------
// Targeted legacy-artifact provenance
// --------------------------------------------------------------------------

async function readRawBody(
  deps: TaskContextInputDependencies, ref: ArtifactRef, caches: ReadCaches,
): Promise<RawBodyOutcome> {
  const key = canonicalJson(ref as unknown as JsonValue);
  const cached = caches.raw.get(key);
  if (cached !== undefined) return cached;
  let outcome: RawBodyOutcome;
  try {
    const stored = await deps.bodies.read(ref);
    if (stored.status === 'ready') {
      outcome = { status: 'ready', origin: stored.value.origin, storedRef: stored.value.ref };
    } else if (stored.code === 'not_found') {
      outcome = { status: 'unavailable', errorCode: 'not_found', reason: stored.reason };
    } else {
      outcome = { status: 'unavailable', errorCode: 'unavailable', reason: `${stored.code}: ${stored.reason}` };
    }
  } catch (error) {
    outcome = { status: 'unavailable', errorCode: 'unavailable',
      reason: error instanceof Error ? error.message : String(error) };
  }
  caches.raw.set(key, outcome);
  return outcome;
}

function provenanceOf(origin: MaterialOrigin): InputArtifactProvenanceV1 | null {
  if (origin.kind === 'platform_operation') {
    return {
      kind: 'platform_operation', projectId: origin.projectId,
      ...(origin.workspaceId === undefined ? {} : { workspaceId: origin.workspaceId }),
      requestId: origin.requestId, actor: { ...origin.actor },
    };
  }
  const owner = materialOwnerFromOrigin(origin);
  return owner === null ? null : { kind: 'run', owner: structuredClone(owner) };
}

function platformOriginInScope(origin: Extract<MaterialOrigin, { kind: 'platform_operation' }>, ctx: CoreCallContext): boolean {
  if (origin.projectId !== ctx.projectId) return false;
  if (ctx.workspaceId !== undefined && ctx.workspaceId !== origin.workspaceId) return false;
  return true;
}

async function canonicalOwnerScope(
  authority: MaterialAuthorityReads, ctx: CoreCallContext, owner: ArtifactOwnerRunRef,
): Promise<{ status: 'ready'; upstream: TaskTriple | null } | CoreRejection> {
  const loaded = await authority.load(owner);
  if (loaded.status === 'not_found') return rejection('forbidden', 'the canonical material owner does not exist');
  if (loaded.status !== 'found') return rejection('forbidden', loaded.reason);
  const snapshot = loaded.snapshot;
  if (!sameArtifactOwnerRunRef(snapshot.ref as ArtifactOwnerRunRef, owner)) {
    return rejection('forbidden', 'the canonical owner load did not return the requested full ref');
  }
  if (owner.aggregateType === 'Run') {
    const run = snapshot as RunSnapshot;
    if (run.ref.projectId !== ctx.projectId
      || (ctx.workspaceId !== undefined && run.workspaceSnapshot.workspaceId !== ctx.workspaceId)) {
      return rejection('forbidden', 'the material owner is outside the trusted project/workspace scope');
    }
    return { status: 'ready', upstream: run.task };
  }
  const queryRun = snapshot as QueryRunSnapshot;
  if (queryRun.ref.projectId !== ctx.projectId
    || (ctx.workspaceId !== undefined && queryRun.ref.workspaceId !== ctx.workspaceId)) {
    return rejection('forbidden', 'the material owner is outside the trusted project/workspace scope');
  }
  return { status: 'ready', upstream: null };
}

// --------------------------------------------------------------------------
// Declaration resolution
// --------------------------------------------------------------------------

function selectionOf(
  declaration: InputDeclarationV1, state: InputSelectionV1['state'], source: SelectedInputSourceV1 | null,
  candidates: SelectedInputSourceV1[], reason: string | null, errorCode: CoreError | null,
): InputSelectionV1 {
  return { declaration, state, source, candidates, usage: 'historical_explanation', reason, errorCode };
}

function missingSelection(declaration: InputDeclarationV1, reason: string): PendingSelection {
  return { selection: selectionOf(declaration, 'missing', null, [], reason, null), pending: null };
}

function unavailableSelection(declaration: InputDeclarationV1, errorCode: CoreError, reason: string): PendingSelection {
  return { selection: selectionOf(declaration, 'unavailable', null, [], reason, errorCode), pending: null };
}

async function resolveLegacy(
  deps: TaskContextInputDependencies, authority: MaterialAuthorityReads, ctx: CoreCallContext,
  declaration: InputDeclarationV1, caches: ReadCaches,
): Promise<{ status: 'ready'; value: PendingSelection } | CoreRejection> {
  const ref = declaration.legacyArtifactRef;
  if (ref === null) return rejection('invalid', 'a legacy declaration requires a legacyArtifactRef');
  const raw = await readRawBody(deps, ref, caches);
  if (raw.status === 'unavailable') {
    return { status: 'ready', value: unavailableSelection(declaration, raw.errorCode, raw.reason) };
  }
  const provenance = provenanceOf(raw.origin);
  if (provenance === null) {
    return rejection('forbidden', 'the legacy material has no canonical owner or trusted origin');
  }
  let upstream: TaskTriple | null = null;
  if (raw.origin.kind === 'platform_operation') {
    if (!platformOriginInScope(raw.origin, ctx)) {
      return rejection('forbidden', 'the platform material belongs to another project/workspace');
    }
  } else {
    const owner = materialOwnerFromOrigin(raw.origin);
    if (owner === null) return rejection('forbidden', 'the legacy material has no canonical owner');
    const scope = await canonicalOwnerScope(authority, ctx, owner);
    if (scope.status !== 'ready') return scope;
    upstream = scope.upstream;
  }
  const resolved: InputDeclarationV1 = { ...declaration, upstream };
  return {
    status: 'ready',
    value: {
      selection: selectionOf(resolved, 'selected', { kind: 'artifact', ref, provenance }, [], null, null),
      pending: { ref, provenance },
    },
  };
}

function selectChainHead(rounds: readonly RoundSnapshot[]): RoundSnapshot {
  let head = rounds[0]!;
  for (const round of rounds) {
    if (roundOrdinalOf(round) > roundOrdinalOf(head)) head = round;
  }
  return head;
}

function samePlanPin(left: unknown, right: unknown): boolean {
  return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
}

async function resolveGate(
  deps: TaskContextInputDependencies, bound: BoundContext, declaration: InputDeclarationV1,
): Promise<{ status: 'ready'; value: PendingSelection } | CoreRejection> {
  const gate = declaration.upstream;
  if (gate === null) return { status: 'ready', value: missingSelection(declaration, 'no_gate_upstream') };

  // §3.4/§3.5: the head is the head of the upstream Task's CANONICAL current
  // execution, not the globally greatest ordinal of every round of that Task.
  const upstreamTask = bound.plan.tasks.find(task => task.taskId === gate.taskId);
  if (upstreamTask === undefined) {
    return { status: 'ready', value: missingSelection(declaration, 'no_applicable_round') };
  }
  const upstreamFacts = planTaskFacts(bound.plan);
  const upstreamBasis = upstreamFacts.basis.get(gate.taskId);
  if (upstreamBasis === undefined || isBasisUnsupported(upstreamBasis)) {
    return { status: 'ready', value: upstreamBasis === undefined
      ? missingSelection(declaration, 'no_applicable_round')
      : unavailableSelection(declaration, 'unavailable', upstreamBasis.reason) };
  }

  let rounds: RoundSnapshot[];
  if (upstreamTask.taskKind === 'gate') {
    const chain = await readGateRoundChain(deps.records, bound.workspaceRef.workspaceId, gate);
    if (chain.status !== 'ready') return chain;
    rounds = chain.rounds;
  } else {
    // The selected Run the existing completion/claim readers use, then the head
    // of THAT Run's chain (`readRunRoundChain`, spec §3.4).
    const factsRead = await readCanonicalTaskFacts(deps.records, bound.goalRef, bound.plan, gate.taskId);
    if (factsRead.status !== 'ready') return factsRead;
    const state = factsRead.value.byTaskId.get(gate.taskId);
    if (state === undefined || state.execution === null) {
      return { status: 'ready', value: missingSelection(declaration, 'no_applicable_round') };
    }
    const run = (factsRead.value.runsByTaskId.get(gate.taskId) ?? [])
      .find(candidate => candidate.ref.runId === state.execution!.runId);
    if (run === undefined) {
      return { status: 'ready', value: missingSelection(declaration, 'no_applicable_round') };
    }
    const chain = await readRunRoundChain(deps.records, run);
    if (chain.status !== 'ready') return chain;
    rounds = chain.rounds;
  }
  if (rounds.length === 0) {
    return { status: 'ready', value: missingSelection(declaration, 'no_applicable_round') };
  }
  const head = selectChainHead(rounds);

  // The head must have run under the consumer claim Plan's formal basis for the
  // upstream Task (plan/taskBasis/workspace/policies); a head outside it is not
  // an applicable round and never impersonates one.
  if (!samePlanRef(head.adoptedPlanRef, upstreamBasis) || !samePlanRef(head.taskBasisRef, upstreamBasis)
    || head.ref.workspaceId !== bound.workspaceRef.workspaceId
    || !samePlanPin(head.verificationPlan.pinnedCompletionPolicy, bound.plan.effectiveCompletionPolicy)
    || !samePlanPin(head.verificationPlan.pinnedArchitectureBaseline, bound.plan.effectiveArchitectureBaseline)) {
    return { status: 'ready', value: missingSelection(declaration, 'no_applicable_round') };
  }

  const label = declaration.requires.label;
  const check = head.checks.find(candidate => candidate.checkId === label && candidate.phase === 'finished');
  if (head.status !== 'finalized' || head.outcome !== 'PASS' || head.gaps.length > 0
    || check === undefined || check.outcome !== 'PASS') {
    return { status: 'ready', value: missingSelection(declaration, 'no_applicable_round') };
  }
  return {
    status: 'ready',
    value: {
      selection: selectionOf(declaration, 'selected', {
        kind: 'check', ref: head.ref, revision: head.revision, checkId: label, reportRef: check.reportRef,
      }, [], null, null),
      pending: null,
    },
  };
}

function resolveEnvironment(bound: BoundContext, declaration: InputDeclarationV1): PendingSelection {
  const label = declaration.requires.label;
  if (label !== 'workspace' && label !== bound.workspaceRef.workspaceId) {
    return missingSelection(declaration, 'unknown_environment_label');
  }
  return {
    selection: selectionOf(declaration, 'selected', {
      kind: 'environment', ref: bound.workspaceRef, revision: bound.workspaceRevision,
    }, [], null, null),
    pending: null,
  };
}

async function resolveDecision(
  deps: TaskContextInputDependencies, authority: MaterialAuthorityReads, ctx: CoreCallContext,
  bound: BoundContext, declaration: InputDeclarationV1,
): Promise<{ status: 'ready'; value: PendingSelection } | CoreRejection> {
  // C4: the capability comes FIRST. An absent dependency is explicitly
  // `unsupported`, never a fabricated applied decision.
  if (deps.decisionApplications === undefined) {
    return { status: 'ready', value: unavailableSelection(declaration, 'unsupported',
      'decision applications are not implemented and cannot be claimed as applied') };
  }
  const messageRef: SessionMessageRef = {
    aggregateType: 'SessionMessage', projectId: ctx.projectId,
    workspaceId: bound.workspaceRef.workspaceId, messageId: declaration.requires.label,
  };
  const key = sessionMessageRefKey(messageRef);
  const read = await readBatch(deps.records, [key]);
  if (read.status !== 'ready') return read;
  const record = read.batch.present.get(key);
  if (record === undefined) return { status: 'ready', value: missingSelection(declaration, 'decision_message_not_found') };
  const decoded = decodeSessionMessageRecord(record);
  if (decoded.status !== 'decoded') {
    return rejection('unavailable', `SessionMessage ${messageRef.messageId} is corrupt: ${decoded.reason}`);
  }
  const message = decoded.value;
  // §3.5 decision row: only an upstream-related formal Message is a candidate.
  // The sender must be an execution (Run) of the upstream Task.
  if (declaration.upstream === null || message.sender.kind !== 'work_run') {
    return { status: 'ready', value: missingSelection(declaration, 'decision_message_unrelated') };
  }
  const senderRun = await loadCanonicalRun(authority, message.sender.runRef);
  if (senderRun.status !== 'ready') {
    if (senderRun.code === 'not_found') {
      return { status: 'ready', value: missingSelection(declaration, 'decision_message_unrelated') };
    }
    return senderRun;
  }
  if (!sameTaskTriple(senderRun.run.task, declaration.upstream)) {
    return { status: 'ready', value: missingSelection(declaration, 'decision_message_unrelated') };
  }
  if (message.status !== 'responded' || message.response === null) {
    return { status: 'ready', value: missingSelection(declaration, 'decision_not_replied') };
  }
  const applications = await deps.decisionApplications(ctx, messageRef);
  if (applications.status === 'not_found') {
    return { status: 'ready', value: unavailableSelection(declaration, 'unavailable',
      'the decision applications could not be read') };
  }
  if (applications.status === 'not_ready') {
    return { status: 'ready', value: unavailableSelection(declaration, 'unavailable',
      'the decision applications are not ready') };
  }
  if (applications.status === 'rejected') {
    return { status: 'ready', value: unavailableSelection(declaration, applications.code, applications.reason) };
  }
  const applied = applications.value;
  if (applied === null || applied.length === 0) {
    return { status: 'ready', value: missingSelection(declaration, 'decision_not_applied') };
  }
  return {
    status: 'ready',
    value: {
      selection: selectionOf(declaration, 'selected', {
        kind: 'decision', ref: messageRef, revision: message.revision, application: applied,
      }, [], null, null),
      pending: null,
    },
  };
}

async function resolveDeclaration(
  deps: TaskContextInputDependencies, authority: MaterialAuthorityReads, ctx: CoreCallContext,
  declaration: InputDeclarationV1, bound: BoundContext, caches: ReadCaches,
): Promise<{ status: 'ready'; value: PendingSelection } | CoreRejection> {
  if (declaration.legacyArtifactRef !== null) return resolveLegacy(deps, authority, ctx, declaration, caches);
  const requires = declaration.requires;
  if (requires.kind === 'artifact' || requires.kind === 'output-contract') {
    // No formal labeled-output publication exists in this baseline (T6): list
    // the upstream fact and stay missing instead of guessing an Artifact.
    return { status: 'ready', value: missingSelection(declaration, 'no_labeled_output') };
  }
  if (requires.kind === 'gate-result') return resolveGate(deps, bound, declaration);
  if (requires.kind === 'environment-revision') return { status: 'ready', value: resolveEnvironment(bound, declaration) };
  return resolveDecision(deps, authority, ctx, bound, declaration);
}

// --------------------------------------------------------------------------
// Pure G-INPUT declaration guard
// --------------------------------------------------------------------------

// The shared pure guard lives in `state/context-input.ts` (G-INPUT, spec §3.3)
// and is the single owner of the selected/missing/ambiguous/unavailable and
// scope/legacy-artifact-exactness rules; this owner only produces the
// selections it checks.

// --------------------------------------------------------------------------
// Internal Host historical material bridge
// --------------------------------------------------------------------------

function hostMaterialContext(deps: TaskContextInputDependencies, ctx: CoreCallContext): CoreCallContext {
  const workspaceId = ctx.workspaceId;
  return {
    projectId: ctx.projectId,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    principal: { kind: 'host', actor: { ...deps.hostActor } },
    materialReader: {
      kind: 'host', projectId: ctx.projectId,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      actor: { ...deps.hostActor },
    },
    signal: ctx.signal,
  };
}

/** Opens through the bridge, caching the raw material result for one read call. */
async function readOpenedArtifact(
  deps: TaskContextInputDependencies, ctx: CoreCallContext, ref: ArtifactRef, caches: ReadCaches,
): Promise<ReadResult<ArtifactRecord>> {
  const key = canonicalJson(ref as unknown as JsonValue);
  const cached = caches.opened.get(key);
  if (cached !== undefined) return cached;
  const result = await deps.materials.openArtifact(hostMaterialContext(deps, ctx), {
    ref, usage: 'historical_explanation',
  });
  caches.opened.set(key, result);
  return result;
}

async function finalizeMaterials(
  deps: TaskContextInputDependencies, ctx: CoreCallContext, pendingList: PendingSelection[], caches: ReadCaches,
): Promise<CoreRejection | null> {
  for (const item of pendingList) {
    if (item.pending === null) continue;
    const ref = item.pending.ref;
    const result = await readOpenedArtifact(deps, ctx, ref, caches);
    if (result.status === 'ready') {
      const record = result.value;
      if (!sameFullArtifactRef(record.ref, ref)
        || artifactBodyDigest(record.body) !== ref.digest
        || artifactBodySize(record.body) !== ref.sizeBytes) {
        item.selection = unavailableSelection(item.selection.declaration, 'unavailable',
          'the stored material does not match the declared content address').selection;
      } else {
        item.selection = selectionOf(item.selection.declaration, 'selected',
          { kind: 'artifact', ref, provenance: item.pending.provenance }, [], null, null);
      }
    } else if (result.status === 'not_found') {
      item.selection = unavailableSelection(item.selection.declaration, 'not_found',
        'the declared material body is missing').selection;
    } else if (result.status === 'rejected') {
      if (result.code === 'forbidden' || result.code === 'cancelled' || result.code === 'invalid'
        || result.code === 'revision_conflict') {
        return result;
      }
      item.selection = unavailableSelection(item.selection.declaration, result.code, result.reason).selection;
    } else {
      item.selection = unavailableSelection(item.selection.declaration, 'unavailable',
        'the material read did not become ready').selection;
    }
    item.pending = null;
  }
  return null;
}

// --------------------------------------------------------------------------
// Candidate keys and projection
// --------------------------------------------------------------------------

function candidateKeyOf(source: SelectedInputSourceV1): string {
  return sha256Hex(canonicalJson(source as unknown as JsonValue));
}

function candidateKeysOf(pendingList: readonly PendingSelection[]): string[] {
  const keys: string[] = [];
  for (const item of pendingList) {
    if (item.selection.source !== null) keys.push(candidateKeyOf(item.selection.source));
    for (const candidate of item.selection.candidates) keys.push(candidateKeyOf(candidate));
  }
  return keys;
}

function projectSelectedTaskInputs(pendingList: readonly PendingSelection[]): { requirementId: string; ref: ArtifactRef }[] {
  const rows: { requirementId: string; ref: ArtifactRef }[] = [];
  for (const item of pendingList) {
    const selection = item.selection;
    if (selection.state !== 'selected' || selection.source === null || selection.source.kind !== 'artifact') continue;
    const declarationId = selection.declaration.declarationId;
    const requirementId = declarationId.startsWith('legacy:') ? declarationId.slice('legacy:'.length) : declarationId;
    // Two declarations of one body stay two entries: no digest-based merging.
    rows.push({ requirementId, ref: selection.source.ref });
  }
  rows.sort((left, right) => (left.requirementId < right.requirementId ? -1
    : left.requirementId > right.requirementId ? 1 : 0));
  return rows;
}

// --------------------------------------------------------------------------
// UTF-8 paging
// --------------------------------------------------------------------------

function utf8LeadLength(byte: number): number | null {
  if (byte < 0x80) return 1;
  if (byte >= 0xc2 && byte <= 0xdf) return 2;
  if (byte >= 0xe0 && byte <= 0xef) return 3;
  if (byte >= 0xf0 && byte <= 0xf4) return 4;
  return null;
}

type SliceResult =
  | { status: 'ok'; body: string; nextOffset: number | null }
  | { status: 'capacity'; reason: string }
  | { status: 'invalid'; reason: string };

function sliceUtf8(body: string, offset: number, maxBytes: number): SliceResult {
  const bytes = Buffer.from(body, 'utf8');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length) {
    return { status: 'invalid', reason: 'the cursor byte offset is outside the stored body' };
  }
  let end = offset;
  while (end < bytes.length && end - offset < maxBytes) {
    const length = utf8LeadLength(bytes[end]!);
    if (length === null || end + length > bytes.length) {
      return { status: 'invalid', reason: 'the stored body is not valid UTF-8' };
    }
    if (end - offset + length > maxBytes) {
      if (end === offset) {
        return { status: 'capacity', reason: `maxBytes ${String(maxBytes)} is smaller than the next UTF-8 character` };
      }
      break;
    }
    end += length;
  }
  return { status: 'ok', body: bytes.subarray(offset, end).toString('utf8'), nextOffset: end >= bytes.length ? null : end };
}

// --------------------------------------------------------------------------
// Cursor
// --------------------------------------------------------------------------

function encodeCursor(cursor: PageCursor): string {
  return CURSOR_PREFIX + Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function cursorSourceProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'cursor source must be an object';
  const kind = (value as Record<string, unknown>)['kind'];
  if (kind !== 'artifact' && kind !== 'check' && kind !== 'environment' && kind !== 'decision') {
    return 'cursor source kind is not recognized';
  }
  return null;
}

function decodeCursor(raw: string): PageCursor | null {
  if (!raw.startsWith(CURSOR_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  if (value['v'] !== 1 || !nonEmptyString(value['projectId']) || !nonEmptyString(value['workspaceId'])
    || typeof value['offset'] !== 'number' || !Number.isSafeInteger(value['offset']) || value['offset'] < 0
    || !nonEmptyString(value['declarationId']) || cursorSourceProblem(value['source']) !== null
    || (value['candidateKey'] !== null && !nonEmptyString(value['candidateKey']))) {
    return null;
  }
  const consumer = value['consumer'];
  const planRef = value['planRef'];
  if (taskTripleProblem(consumer, 'cursor consumer') !== null || planRefProblem(planRef) !== null) return null;
  return {
    v: 1,
    projectId: value['projectId'] as string,
    workspaceId: value['workspaceId'] as string,
    consumer: consumer as TaskTriple,
    planRef: planRef as PlanRevisionRef,
    declarationId: value['declarationId'] as string,
    candidateKey: value['candidateKey'] as string | null,
    source: value['source'] as SelectedInputSourceV1,
    offset: value['offset'] as number,
  };
}

function cursorInScope(
  cursor: PageCursor, bound: BoundContext, request: TaskInputPageRequestV1,
): boolean {
  return cursor.projectId === bound.goalRef.projectId
    && cursor.workspaceId === bound.workspaceRef.workspaceId
    && sameTaskTriple(cursor.consumer, request.consumer)
    && samePlanRef(cursor.planRef, request.planRef)
    && cursor.declarationId === request.declarationId
    && cursor.candidateKey === (request.candidateKey ?? null);
}

function cursorSourceAllowed(cursor: PageCursor, resolvedTarget: PendingSelection): boolean {
  // The full canonical source (provenance included) the owner just resolved, so
  // an edited provenance in the caller-supplied cursor is never trusted.
  const selection = resolvedTarget.selection;
  return selection.state === 'selected' && selection.source !== null
    && canonicalJson(selection.source as unknown as JsonValue) === canonicalJson(cursor.source as unknown as JsonValue);
}

// --------------------------------------------------------------------------
// Requests
// --------------------------------------------------------------------------

type InputRequest = { consumer: TaskTriple; planRef: PlanRevisionRef; declarationId?: string; candidateKey?: string };

function cloneInputRequest(request: InputRequest): InputRequest {
  return {
    consumer: { ...request.consumer }, planRef: { ...request.planRef },
    ...(request.declarationId === undefined ? {} : { declarationId: request.declarationId }),
    ...(request.candidateKey === undefined ? {} : { candidateKey: request.candidateKey }),
  };
}

function clonePageRequest(request: TaskInputPageRequestV1): TaskInputPageRequestV1 {
  return {
    consumer: { ...request.consumer }, planRef: { ...request.planRef }, declarationId: request.declarationId,
    ...(request.candidateKey === undefined ? {} : { candidateKey: request.candidateKey }),
    afterCursor: request.afterCursor, maxBytes: request.maxBytes,
  };
}

function sourceSummary(source: SelectedInputSourceV1): string {
  return JSON.stringify(source);
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createTaskContextInputService(deps: TaskContextInputDependencies): TaskContextInputPort {
  const authority: MaterialAuthorityReads = createMaterialRecordReaders(deps.records).authority;

  async function readTaskInputs(
    ctx: CoreCallContext, request: { consumer: TaskTriple; planRef: PlanRevisionRef;
      declarationId?: string; candidateKey?: string },
  ): Promise<ReadResult<InputSelectionV1[]>> {
    const localCtx = cloneContext(ctx);
    const localRequest = cloneInputRequest(request);
    if (localCtx.signal.aborted) return cancelledRejection();
    const shapeProblem = inputRequestShapeProblem(localRequest);
    if (shapeProblem !== null) return rejection('invalid', shapeProblem);
    if (localRequest.consumer.projectId !== localCtx.projectId
      || localRequest.planRef.projectId !== localCtx.projectId) {
      return rejection('forbidden', 'the request scope does not match the trusted call context');
    }
    if (localRequest.candidateKey !== undefined && localRequest.declarationId === undefined) {
      return rejection('invalid', 'candidateKey requires an explicit declarationId');
    }

    const bound = await bindContext(deps, authority, localCtx, localRequest);
    if (bound.status !== 'ready') return bound;
    const allDeclarations = declarationsFor(bound.value.plan, localRequest.consumer);
    let targetDeclarations = allDeclarations;
    if (localRequest.declarationId !== undefined) {
      targetDeclarations = allDeclarations.filter(
        declaration => declaration.declarationId === localRequest.declarationId);
      if (targetDeclarations.length === 0) {
        return rejection('not_found', `the Plan declares no input ${localRequest.declarationId} for this consumer`);
      }
    }

    const caches = newCaches();
    const resolved: PendingSelection[] = [];
    for (const declaration of targetDeclarations) {
      const result = await resolveDeclaration(deps, authority, localCtx, declaration, bound.value, caches);
      if (result.status !== 'ready') return result;
      resolved.push(result.value);
    }

    if (localRequest.candidateKey !== undefined) {
      if (!candidateKeysOf(resolved).includes(localRequest.candidateKey)) {
        return rejection('forbidden', 'the candidateKey is not one of this declaration\'s current candidates');
      }
    }

    const scope = { projectId: bound.value.goalRef.projectId,
      workspaceId: bound.value.workspaceRef.workspaceId, goalId: bound.value.goalRef.goalId };
    for (const item of resolved) {
      const problem = declaredInputProblem({
        declaration: item.selection.declaration, selections: [item.selection],
        allowedDeclarations: allDeclarations, scope,
      });
      if (problem !== null) return problem;
    }

    // ONLY after the declaration guard passes: build the Host historical bridge.
    const materialProblem = await finalizeMaterials(deps, localCtx, resolved, caches);
    if (materialProblem !== null) return materialProblem;

    return { status: 'ready', value: resolved.map(item => item.selection) };
  }

  async function readTaskInputPage(
    ctx: CoreCallContext, request: TaskInputPageRequestV1,
  ): Promise<ReadResult<TaskInputPageV1>> {
    const localCtx = cloneContext(ctx);
    const localRequest = clonePageRequest(request);
    if (localCtx.signal.aborted) return cancelledRejection();
    const shapeProblem = pageRequestShapeProblem(localRequest);
    if (shapeProblem !== null) return rejection('invalid', shapeProblem);
    if (localRequest.consumer.projectId !== localCtx.projectId
      || localRequest.planRef.projectId !== localCtx.projectId) {
      return rejection('forbidden', 'the request scope does not match the trusted call context');
    }

    const bound = await bindContext(deps, authority, localCtx, localRequest);
    if (bound.status !== 'ready') return bound;
    const allDeclarations = declarationsFor(bound.value.plan, localRequest.consumer);
    const target = allDeclarations.find(declaration => declaration.declarationId === localRequest.declarationId);
    if (target === undefined) {
      return rejection('not_found', `the Plan declares no input ${localRequest.declarationId} for this consumer`);
    }

    // Decode and bind the cursor before resolving the target: a cursor minted for
    // another declaration is `invalid` and never opens that declaration's material.
    let cursor: PageCursor | null = null;
    if (localRequest.afterCursor !== null) {
      const decoded = decodeCursor(localRequest.afterCursor);
      if (decoded === null) return rejection('invalid', 'the input page cursor is not readable');
      if (decoded.declarationId !== localRequest.declarationId
        || !cursorInScope(decoded, bound.value, localRequest)) {
        return rejection('invalid', 'the input page cursor does not belong to this scope/plan/declaration');
      }
      cursor = decoded;
    }

    const caches = newCaches();
    const pendingList: PendingSelection[] = [];
    for (const declaration of allDeclarations) {
      const result = await resolveDeclaration(deps, authority, localCtx, declaration, bound.value, caches);
      if (result.status !== 'ready') return result;
      pendingList.push(result.value);
    }
    const targetItem = pendingList.find(item => item.selection.declaration.declarationId === target.declarationId)!;

    const scope = { projectId: bound.value.goalRef.projectId,
      workspaceId: bound.value.workspaceRef.workspaceId, goalId: bound.value.goalRef.goalId };
    if (cursor === null && localRequest.candidateKey !== undefined
      && !candidateKeysOf([targetItem]).includes(localRequest.candidateKey)) {
      return rejection('forbidden', 'the candidateKey is not one of this declaration\'s current candidates');
    }
    // G3.3: EVERY declaration whose material is opened passes the pure guard
    // first (as `readTaskInputs` does); the page never opens an unchecked one.
    for (const item of pendingList) {
      const problem = declaredInputProblem({
        declaration: item.selection.declaration, selections: [item.selection],
        allowedDeclarations: allDeclarations, scope,
      });
      if (problem !== null) return problem;
    }
    if (cursor !== null && !cursorSourceAllowed(cursor, targetItem)) {
      return rejection('revision_conflict', 'the declaration no longer allows the cursor\'s fixed source');
    }

    const materialProblem = await finalizeMaterials(deps, localCtx, pendingList, caches);
    if (materialProblem !== null) return materialProblem;
    const finalTarget = pendingList.find(item => item.selection.declaration.declarationId === target.declarationId)!;
    const selectedTaskInputs = projectSelectedTaskInputs(pendingList);

    const fixedDeclaration = finalTarget.selection.declaration;
    if (cursor === null) {
      const selection = finalTarget.selection;
      if (selection.state !== 'selected' || selection.source === null) {
        return { status: 'ready', value: { selection, body: null, nextCursor: null, selectedTaskInputs } };
      }
      if (selection.source.kind !== 'artifact') {
        return { status: 'ready', value: { selection, body: sourceSummary(selection.source), nextCursor: null, selectedTaskInputs } };
      }
      return await pageArtifactBody(deps, localCtx, bound.value, fixedDeclaration, selection, selection.source,
        0, localRequest, selectedTaskInputs, caches);
    }

    // Continuation: return the source/selection the owner just resolved, never
    // the caller-supplied cursor's own copy (spec §3.4, §3.3).
    const selection = finalTarget.selection;
    if (selection.state !== 'selected' || selection.source === null) {
      return { status: 'ready', value: { selection, body: null, nextCursor: null, selectedTaskInputs } };
    }
    if (selection.source.kind !== 'artifact') {
      return { status: 'ready', value: { selection, body: sourceSummary(selection.source), nextCursor: null, selectedTaskInputs } };
    }
    return await pageArtifactBody(deps, localCtx, bound.value, fixedDeclaration, selection, selection.source,
      cursor.offset, localRequest, selectedTaskInputs, caches);
  }

  async function pageArtifactBody(
    deps: TaskContextInputDependencies, ctx: CoreCallContext, bound: BoundContext,
    declaration: InputDeclarationV1, selection: InputSelectionV1, source: Extract<SelectedInputSourceV1, { kind: 'artifact' }>,
    offset: number, request: TaskInputPageRequestV1, selectedTaskInputs: { requirementId: string; ref: ArtifactRef }[],
    caches: ReadCaches,
  ): Promise<ReadResult<TaskInputPageV1>> {
    const opened = await readOpenedArtifact(deps, ctx, source.ref, caches);
    if (opened.status === 'rejected') {
      if (opened.code === 'forbidden' || opened.code === 'cancelled' || opened.code === 'invalid'
        || opened.code === 'revision_conflict') {
        return opened;
      }
      return { status: 'ready', value: {
        selection: unavailableSelection(declaration, opened.code, opened.reason).selection,
        body: null, nextCursor: null, selectedTaskInputs } };
    }
    if (opened.status !== 'ready') {
      return { status: 'ready', value: {
        selection: unavailableSelection(declaration, 'not_found', 'the declared material body is missing').selection,
        body: null, nextCursor: null, selectedTaskInputs } };
    }
    const record = opened.value;
    if (!sameFullArtifactRef(record.ref, source.ref)
      || artifactBodyDigest(record.body) !== source.ref.digest
      || artifactBodySize(record.body) !== source.ref.sizeBytes) {
      return { status: 'ready', value: {
        selection: unavailableSelection(declaration, 'unavailable',
          'the stored material does not match the declared content address').selection,
        body: null, nextCursor: null, selectedTaskInputs } };
    }
    const slice = sliceUtf8(record.body, offset, request.maxBytes);
    if (slice.status === 'capacity') return rejection('capacity', slice.reason);
    if (slice.status === 'invalid') return rejection('invalid', slice.reason);
    const nextCursor = slice.nextOffset === null ? null : encodeCursor({
      v: 1, projectId: bound.goalRef.projectId, workspaceId: bound.workspaceRef.workspaceId,
      consumer: { ...request.consumer }, planRef: { ...request.planRef },
      declarationId: declaration.declarationId, candidateKey: request.candidateKey ?? null,
      source, offset: slice.nextOffset,
    });
    return { status: 'ready', value: { selection, body: slice.body, nextCursor, selectedTaskInputs } };
  }

  return { readTaskInputs, readTaskInputPage };
}
