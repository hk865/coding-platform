/**
 * B2 external material admission into M2 local facts — independent target tests.
 *
 * The production entry service still refuses every external selected/additional
 * material as `unsupported` (Stage-1 skeleton). These tests assemble the REAL
 * chain first — real Goal/Plan/Session/claim, real MaterialPort bodies, a real
 * M1 grant, a real workspace source capture and the real M2 facts collector —
 * prove it through the ordinary `openArtifact(current)` / `readTaskInput` /
 * `openArtifactFacts` readers, and only then assert the B2 barrier behaviour.
 * At Stage 1 every material-chain case is therefore RED on the explicit
 * `unsupported` reason, never on an invalid fixture.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { MaterialBasisV1 } from '../../src/contracts/material-access.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createMaterialAccessResolver } from '../../src/core/work-graph/materials/applicability.js';
import type { MaterialReadFactsPort } from '../../src/core/work-graph/materials/contracts.js';
import type { GrantMaterialAccessInput } from '../../src/core/work-graph/materials/grant-contracts.js';
import { createMaterialGrantService } from '../../src/core/work-graph/materials/grant-service.js';
import { MATERIAL_GRANT_EVENT_SCHEMAS } from '../../src/core/work-graph/materials/grant-record-codecs.js';
import { createMaterialReadFactsService } from '../../src/core/work-graph/materials/material-facts-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { modelRequestPermitIdFor } from '../../src/core/work-graph/tasks/model-call-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/tasks/contracts.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createWorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import { createMaterialSourceProvider } from '../../src/core/workspace/material-source-provider.js';
import {
  B2_AT, createB2ExecutionFixture, type B2ExecutionFixture, type B2PortOverrides, type B2Ports,
  type B2PreparedOptions, type B2Records,
} from '../helpers/B2-execution-fixture.js';
import type { ClaimFixtureKind } from '../helpers/task-claim-fixture.js';

const fixtures: B2ExecutionFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

/** A test-only counter around the real facts port; it never changes a result. */
function countingFacts(inner: MaterialReadFactsPort) {
  const state = { calls: 0 };
  const port: MaterialReadFactsPort = {
    async openArtifactFacts(ctx, input) { state.calls += 1; return inner.openArtifactFacts(ctx, input); },
  };
  return { port, state };
}

/**
 * One real material chain over the B2 fixture's own temp workspace: real
 * producer Run, real stored bodies, a never-claimed consumer Task on a new
 * accepted Plan revision, a real M1 grant for the consumer, and the SAME
 * source/authority/index/bodies shared by the ordinary resolver, M2 facts and
 * the writer.
 */
async function openChain(kind: ClaimFixtureKind = 'memory') {
  const additionalSchemas: RecordBackendSchemas = { records: [], events: [...MATERIAL_GRANT_EVENT_SCHEMAS] };
  const f = await createB2ExecutionFixture(kind, additionalSchemas);
  fixtures.push(f);
  const directory = f.base.directory;
  const projectId = f.base.scope.projectId;
  const workspaceId = f.base.scope.workspaceId;
  const goalRef = f.base.goalRef;
  const actor = { kind: 'human' as const, id: 'b2-material-operator' };
  const sourceSet = { kind: 'workspace_paths' as const, paths: ['src/input.txt'] };
  const requirementId = 'b2-selected-input';
  const consumerTaskId = 'b2-material-consumer';

  await mkdir(join(directory, 'src'), { recursive: true });
  await writeFile(join(directory, 'src/input.txt'), 'source version one');

  const sourceState: { available: boolean; beforeAuthorize?: (ctx: CoreCallContext) => void } = { available: true };
  const access = createWorkspaceAccessFactory({
    resolveRoot: async scope => {
      expect(scope).toMatchObject({ projectId, workspaceId });
      if (!sourceState.available) return { status: 'rejected', code: 'unavailable', reason: 'Host mount is unavailable' };
      return ({ status: 'ready', value: { root: directory, workspaceRevision: 1 } });
    },
    authorize: async ctx => {
      expect(ctx.principal).toEqual({ kind: 'host', actor });
      expect(ctx.materialReader).toEqual({ kind: 'host', projectId, workspaceId, actor });
      sourceState.beforeAuthorize?.(ctx);
      return { status: 'ready', value: { subjectKey: 'host:b2-material', permissionRevision: 'p1',
        allowsRead: path => path === 'src/input.txt' } };
    },
  });
  const source = createMaterialSourceProvider({
    access,
    contextForScope: (scope, signal) => ({
      projectId: scope.projectId, workspaceId: scope.workspaceId,
      principal: { kind: 'host', actor },
      materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor },
      signal,
    }),
  });

  const bodies = f.bodies;
  const reads = createMaterialRecordReaders(f.base.records);
  const materials = createMaterialService({ bodies, authority: reads.authority,
    grants: createMaterialAccessResolver(reads.authority, reads.index, source), now: () => B2_AT });
  let seq = 0;
  const grant = createMaterialGrantService({ records: f.base.records, authority: reads.authority,
    materials, source, now: () => B2_AT, eventId: () => `b2-mat-grant-event-${++seq}` });
  const rawPlans = createPlanService({ records: f.base.records, materials, now: () => B2_AT,
    eventId: () => `b2-mat-plan-event-${++seq}` });
  const rawFacts = createMaterialReadFactsService({ authority: reads.authority, index: reads.index, bodies,
    sourceApplicability: source, now: () => B2_AT });

  const producerCtx: CoreCallContext = { ...f.base.ctx,
    principal: { kind: 'work_run', runRef: f.claim.runRef, roleBinding: f.base.roleBinding },
    materialReader: { kind: 'run', requester: f.claim.runRef } };
  const put = async (body: string): Promise<ArtifactRef> => {
    const result = await materials.storeArtifact(producerCtx, { body, contentType: 'text/plain',
      sources: [{ kind: 'workspace', refId: workspaceId, revision: '1' }],
      origin: { kind: 'execution', ref: f.claim.runRef } });
    if (result.status !== 'stored') throw new Error('real material store failed: ' + JSON.stringify(result));
    return result.ref;
  };
  const selectedRef = await put('selected material body');
  const additionalRef = await put('additional material body');

  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: 'b2-material-plan', planRevision: f.base.plan.planRevision + 1, goalId: goalRef.goalId,
    stages: structuredClone(f.base.plan.stages),
    tasks: [...structuredClone(f.base.plan.tasks),
      { taskId: consumerTaskId, title: 'Consume shared material', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    assignments: [...structuredClone(f.base.plan.assignments ?? []),
      { taskId: consumerTaskId, role: 'builder', instruction: 'Consume shared material' }],
    obligations: f.base.plan.obligations.map(obligation => obligation.obligationId === 'obligation-1'
      ? { ...obligation, taskIds: [...obligation.taskIds, consumerTaskId] } : structuredClone(obligation)),
    taskHierarchy: structuredClone(f.base.plan.taskHierarchy),
    executionDag: structuredClone(f.base.plan.executionDag),
    taskRelations: [],
    inputRequirements: [{ requirementId, consumerTaskId, kind: 'artifact', artifactRef: selectedRef },
      { requirementId: 'another-task-input', consumerTaskId: f.base.tasks.second.taskId, kind: 'artifact', artifactRef: selectedRef }],
  };
  const proposed = await f.base.plans.proposePlan(f.base.ctx, {
    meta: { requestId: 'b2-mat-propose', expected: [await f.base.goalPin()] },
    input: { goalRef, basedOn: f.base.planRef, draft, reason: { text: 'B2 material consumer plan', sources: [] } } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
    throw new Error('B2 material plan proposal failed: ' + JSON.stringify(proposed));
  }
  const applied = await f.base.plans.applyPlanChange(f.base.ctx, {
    meta: { requestId: 'b2-mat-apply', expected: [await f.base.goalPin()] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error('B2 material plan adoption failed: ' + JSON.stringify(applied));
  const planRef = applied.value.ref;

  const claimed = await f.base.service.claimTask(f.base.ctx, await f.base.buildRequest({
    requestId: 'b2-mat-consumer-claim',
    input: { taskId: consumerTaskId, planRef, sessionRef: f.base.sessions.second } }));
  if (claimed.status !== 'committed') throw new Error('B2 material consumer claim failed: ' + JSON.stringify(claimed));
  const consumerClaim = claimed.value;

  const grantRequest: GraphWrite<GrantMaterialAccessInput> = {
    meta: { requestId: 'b2-mat-grant', expected: [await f.base.goalPin(), { ref: f.base.workspaceRef, revision: 1 }] },
    input: { goalRef, reader: consumerClaim.runRef, materials: [selectedRef, additionalRef], sourceSet,
      purpose: 'B2 material admission' } };
  const granted = await grant.grantMaterialAccess(f.base.ctx, grantRequest);
  if (granted.status !== 'committed') throw new Error('B2 material grant failed: ' + JSON.stringify(granted));
  const grantedSnapshot = granted.value;
  const basis: MaterialBasisV1 = grantedSnapshot.grant.basis;

  const consumerCtx = (overrides: Partial<CoreCallContext> = {}): CoreCallContext => ({
    projectId, workspaceId,
    principal: { kind: 'work_run', runRef: consumerClaim.runRef, roleBinding: f.base.roleBinding },
    materialReader: { kind: 'run', requester: consumerClaim.runRef, currentBasis: basis },
    signal: new AbortController().signal, ...overrides });

  const plans: typeof rawPlans = { ...rawPlans,
    async readTaskInput(ctx, input) {
      expect(ctx.principal).toEqual({ kind: 'work_run', runRef: consumerClaim.runRef, roleBinding: f.base.roleBinding });
      expect(ctx.materialReader).toEqual({ kind: 'run', requester: consumerClaim.runRef, currentBasis: basis });
      return rawPlans.readTaskInput(ctx, input);
    },
  };
  const factsReadRefs: string[] = [];
  const facts: MaterialReadFactsPort = {
    async openArtifactFacts(ctx, input) {
      expect(ctx.principal, 'B2 must narrow the Host write to the actual consumer reader').toEqual({
        kind: 'work_run', runRef: consumerClaim.runRef, roleBinding: f.base.roleBinding });
      expect(ctx.materialReader).toEqual({ kind: 'run', requester: consumerClaim.runRef, currentBasis: basis });
      expect(ctx.projectId).toBe(projectId); expect(ctx.workspaceId).toBe(workspaceId);
      expect(input.usage).toBe('current');
      const result = await rawFacts.openArtifactFacts(ctx, input);
      if (result.result.status === 'ready') factsReadRefs.push(canonicalJson(input.ref as unknown as JsonValue));
      return result;
    },
  };
  const kernel = await f.kernelFor(consumerClaim);
  expect(kernel.kernelSessionId).not.toBe(f.kernel.kernelSessionId);
  const observedHistory = (position = 3) => ({ ...f.observedHistory(position), kernel });
  const completedBoundary = (position = 4) => ({ ...f.completedBoundary(position), source: { ...kernel, position } });

  function buildPrepared(overrides: B2PreparedOptions = {}) {
    return f.buildPrepared({ claim: consumerClaim,
      selectedTaskInputs: [{ requirementId, ref: selectedRef }], materialBasis: basis,
      additionalMaterialRefs: [additionalRef], ...overrides });
  }
  function ports(overrides: B2PortOverrides = {}): B2Ports {
    return f.ports(undefined, { plans, materials, materialFacts: facts, ...overrides });
  }
  async function revoke(reason: string, requestId: string): Promise<void> {
    const result = await grant.revokeMaterialAccess(f.base.ctx, {
      meta: { requestId, expected: [{ ref: grantedSnapshot.ref, revision: 1 }] },
      input: { grantRef: grantedSnapshot.ref, reason } });
    if (result.status !== 'committed') throw new Error('real material revoke failed: ' + JSON.stringify(result));
  }
  const pin = () => f.pin(consumerClaim);
  const read = () => f.read(consumerClaim);

  const chain = { f, directory, projectId, workspaceId, goalRef, actor, source, sourceSet, materials, plans, facts, grant,
    factsReadRefs, kernel, observedHistory, completedBoundary, sourceState,
    bodies, readers: reads, selectedRef, additionalRef, consumerClaim, planRef, requirementId, consumerTaskId, basis,
    granted: grantedSnapshot, consumerCtx, buildPrepared, ports, revoke, pin, read };
  await proveRealChain(chain);
  return chain;
}
type Chain = Awaited<ReturnType<typeof openChain>>;

/** Proves the ordinary current and formal Plan selection before any B2 assertion. */
async function proveRealChain(c: Chain): Promise<void> {
  await expect(c.materials.openArtifact(c.consumerCtx(), { ref: c.selectedRef, usage: 'current' }))
    .resolves.toMatchObject({ status: 'ready',
      value: { ref: c.selectedRef, body: 'selected material body', applicability: 'current' } });
  await expect(c.materials.openArtifact(c.consumerCtx(), { ref: c.additionalRef, usage: 'current' }))
    .resolves.toMatchObject({ status: 'ready', value: { ref: c.additionalRef, body: 'additional material body' } });
  await expect(c.plans.readTaskInput(c.consumerCtx(), { goalRef: c.goalRef, planRef: c.planRef,
    taskId: c.consumerTaskId, requirementId: c.requirementId }))
    .resolves.toMatchObject({ status: 'ready', value: { ref: c.selectedRef } });
  await expect(c.facts.openArtifactFacts(c.consumerCtx(), { ref: c.selectedRef, usage: 'current' }))
    .resolves.toMatchObject({ result: { status: 'ready' } });
}

/** A transparent commit wrapper: the first target commit runs one real
 * revocation BEFORE the original PreparedCommit is passed through unchanged. */
function hookFirstCommit(records: B2Records, action: () => Promise<void>): { records: B2Records; fired: () => boolean } {
  let armed = true;
  const wrapped: B2Records = { ...records, async commit(batch) {
    if (armed) { armed = false; await action(); }
    return records.commit(batch);
  } };
  return { records: wrapped, fired: () => !armed };
}

function revokeAtTargetCommit(c: Chain, reason: string, requestId: string) {
  const start = c.factsReadRefs.length;
  return hookFirstCommit(c.f.base.records, async () => {
    const observed = c.factsReadRefs.slice(start);
    expect(observed, 'target barrier completed selected material current facts').toContain(canonicalJson(c.selectedRef as unknown as JsonValue));
    expect(observed, 'target barrier completed additional material current facts').toContain(canonicalJson(c.additionalRef as unknown as JsonValue));
    await c.revoke(reason, requestId);
  });
}

describe('B2 external material admission', () => {
  it('authorize -> fresh begin -> entered -> model issue -> fresh consume succeeds with new facts reads per barrier', async () => {
    const c = await openChain();
    const counted = countingFacts({ async openArtifactFacts(ctx, input) {
      expect(ctx.signal).toBe(c.f.base.ctx.signal);
      return c.facts.openArtifactFacts(ctx, input);
    } });
    const b2 = c.ports({ materialFacts: counted.port });
    const prepared = await c.buildPrepared();

    const beforeAuthorize = counted.state.calls;
    const materialReadsBefore = c.factsReadRefs.length;
    const authorized = await b2.entry.authorizeRuntimeEntry(c.f.base.ctx, {
      input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'b2-mat-authorize', expected: [await c.pin()] } });
    expect(authorized, `authorize material admission: ${JSON.stringify(authorized)}`).toMatchObject({ status: 'committed', replayed: false });
    if (authorized.status !== 'committed') throw Error('authorize did not commit');
    expect(counted.state.calls, 'authorize reads material facts').toBeGreaterThan(beforeAuthorize);

    const beforeBegin = counted.state.calls;
    const begun = await b2.entry.beginRuntimeEntry(c.f.base.ctx, {
      input: { permit: authorized.value, kernel: c.kernel },
      meta: { requestId: 'b2-mat-begin', expected: [await c.pin()] } });
    expect(begun, 'fresh begin material admission').toMatchObject({ status: 'committed', replayed: false });
    expect(counted.state.calls, 'fresh begin re-reads material facts').toBeGreaterThan(beforeBegin);

    const beginPermit = await c.f.currentPermit(c.consumerClaim);
    const beforeEntered = counted.state.calls;
    const entered = await b2.entry.recordExecutionEntered(c.f.base.ctx, {
      input: { permit: beginPermit, enteredAt: B2_AT, kernelSource: { ...c.kernel, position: 3 },
        history: c.observedHistory(3) },
      meta: { requestId: 'b2-mat-entered', expected: [await c.pin()] } });
    expect(entered).toMatchObject({ status: 'committed', value: { status: 'running' } });
    // The already-entered observation is not a fresh material barrier.
    expect(counted.state.calls, 'entered adds no material gate').toBe(beforeEntered);

    const issuedPermit = await c.f.currentPermit(c.consumerClaim);
    const actual = c.f.actualRequest({ prepared, permit: issuedPermit });
    const beforeIssue = counted.state.calls;
    const issued = await b2.model.authorizeModelRequest(c.f.base.ctx, {
      input: actual, meta: { requestId: 'b2-mat-issue', expected: [await c.pin()] } });
    expect(issued, 'model issue material admission').toMatchObject({ status: 'committed', replayed: false });
    if (issued.status !== 'committed') throw Error('model issue did not commit');
    expect(counted.state.calls, 'model issue re-reads material facts').toBeGreaterThan(beforeIssue);

    const beforeConsume = counted.state.calls;
    const consumed = await b2.model.recordModelRequestAttempt(c.f.base.ctx, {
      input: { request: actual, permitRef: issued.value.permitRef, attemptId: 'b2-mat-attempt', observedAt: B2_AT },
      meta: { requestId: 'b2-mat-consume',
        expected: [await c.pin(), { ref: issued.value.permitRef, revision: 1 }] } });
    expect(consumed, 'fresh consume material admission').toMatchObject({ status: 'committed', replayed: false });
    expect(counted.state.calls, 'fresh consume re-reads material facts').toBeGreaterThan(beforeConsume);

    const actualRefs = c.factsReadRefs.slice(materialReadsBefore);
    for (const ref of [c.selectedRef, c.additionalRef]) {
      expect(actualRefs.filter(key => key === canonicalJson(ref as unknown as JsonValue)).length).toBeGreaterThanOrEqual(4);
    }
    const state = await c.read();
    expect(state.run.status).toBe('running');
    expect(state.run.executionAuthorization).toMatchObject({ phase: 'entered' });
    const rows = await c.f.base.records.readMany([canonicalJson(issued.value.permitRef as unknown as JsonValue)]);
    expect(rows.status).toBe('ready');
    if (rows.status === 'ready') {
      expect(rows.value.records[0]?.revision).toBe(2);
      expect(JSON.parse(rows.value.records[0]!.json).permit.consumedByAttemptId).toBe('b2-mat-attempt');
    }
  });

  it('rejects a selection that is not the formal Plan requirement', async () => {
    const c = await openChain();
    const b2 = c.ports();
    const variants: Array<[string, B2PreparedOptions]> = [
      ['wrong consumer task', { selectedTaskInputs: [{ requirementId: 'another-task-input', ref: c.selectedRef }] }],
      ['unknown requirement', { selectedTaskInputs: [{ requirementId: 'no-such-requirement', ref: c.selectedRef }] }],
      ['mismatched full ref', { selectedTaskInputs: [{ requirementId: c.requirementId, ref: c.additionalRef }] }],
    ];
    for (const [label, override] of variants) {
      const prepared = await c.buildPrepared(override);
      const before = await c.read();
      const result = await b2.entry.authorizeRuntimeEntry(c.f.base.ctx, {
        input: { prepared, consumerId: 'runtime-a' },
        meta: { requestId: `b2-mat-invalid-${label}`, expected: [await c.pin()] } });
      expect(result, label).toMatchObject({ status: 'rejected' });
      expect((result as { code?: string }).code, label).not.toBe('unsupported');
      expect(await c.read()).toEqual(before);
    }

  });

  it('keeps missing facts explicit and executes the same current consumer without external materials', async () => {
    const c = await openChain();
    const before = await c.read();
    // External material without the facts dependency stays an explicit gap.
    const external = await c.buildPrepared();
    const noFacts = c.f.ports(undefined, { plans: c.plans, materials: c.materials });
    expect(await noFacts.entry.authorizeRuntimeEntry(c.f.base.ctx, {
      input: { prepared: external, consumerId: 'runtime-a' },
      meta: { requestId: 'b2-mat-missing-facts', expected: [await c.pin()] } }))
      .toMatchObject({ status: 'rejected', code: 'unsupported' });
    expect(await c.read()).toEqual(before);

    // A manifest with no external material keeps the old compatible path.
    const plain = await c.f.buildPrepared({ claim: c.consumerClaim });
    await c.f.enter({ prepared: plain, ports: noFacts });
    expect((await c.read()).run).toMatchObject({ status: 'running', executionAuthorization: { phase: 'entered' } });
  });

  // ---- 3. Each of the four fresh barriers re-reads and guards the material. ---
  it('authorize barrier: a real revoke after the facts read conflicts the original SQLite commit', async () => {
    const c = await openChain('sqlite');
    const prepared = await c.buildPrepared();
    const hook = revokeAtTargetCommit(c, 'withdraw authorize', 'b2-mat-revoke-authorize');
    const b2 = c.f.ports(hook.records, { plans: c.plans, materials: c.materials, materialFacts: c.facts });
    const result = await b2.entry.authorizeRuntimeEntry(c.f.base.ctx, {
      input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'b2-mat-hook-authorize', expected: [await c.pin()] } });
    expect(result, 'authorize barrier').toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(hook.fired()).toBe(true);
    expect((await c.read()).run.executionAuthorization).toBeUndefined();
  });

  it('fresh begin barrier: a real revoke after the facts read conflicts the original commit', async () => {
    const c = await openChain();
    const prepared = await c.buildPrepared();
    const admitted = await c.f.authorize({ prepared, ports: c.ports() });
    const hook = revokeAtTargetCommit(c, 'withdraw begin', 'b2-mat-revoke-begin');
    const b2 = c.f.ports(hook.records, { plans: c.plans, materials: c.materials, materialFacts: c.facts });
    const result = await b2.entry.beginRuntimeEntry(c.f.base.ctx, {
      input: { permit: admitted.permit, kernel: c.kernel },
      meta: { requestId: 'b2-mat-hook-begin', expected: [await c.pin()] } });
    expect(result, 'fresh begin barrier').toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(hook.fired()).toBe(true);
    expect((await c.read()).run.executionAuthorization).toMatchObject({ phase: 'authorized' });
  });

  it('model issue barrier: a real revoke after the facts read conflicts the original commit', async () => {
    const c = await openChain();
    const prepared = await c.buildPrepared();
    const admitted = await c.f.enter({ prepared, ports: c.ports() });
    const actual = c.f.actualRequest(admitted);
    const hook = revokeAtTargetCommit(c, 'withdraw issue', 'b2-mat-revoke-issue');
    const b2 = c.f.ports(hook.records, { plans: c.plans, materials: c.materials, materialFacts: c.facts });
    const result = await b2.model.authorizeModelRequest(c.f.base.ctx, {
      input: actual, meta: { requestId: 'b2-mat-hook-issue', expected: [await c.pin()] } });
    expect(result, 'model issue barrier').toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(hook.fired()).toBe(true);
    const permitRef = { aggregateType: 'ModelRequestPermit' as const, projectId: c.projectId,
      workspaceId: c.workspaceId,
      permitId: modelRequestPermitIdFor(actual.permit.claim.runRef, actual.requestId) };
    const rows = await c.f.base.records.readMany([canonicalJson(permitRef as unknown as JsonValue)]);
    expect(rows.status).toBe('ready');
    if (rows.status === 'ready') expect(rows.value.records).toHaveLength(0);
  });

  it('fresh consume barrier: a real revoke after the facts read conflicts the original commit', async () => {
    const c = await openChain();
    const prepared = await c.buildPrepared();
    const admitted = await c.f.enter({ prepared, ports: c.ports() });
    const actual = c.f.actualRequest(admitted);
    const issued = await c.ports().model.authorizeModelRequest(c.f.base.ctx, {
      input: actual, meta: { requestId: 'b2-mat-consume-issue', expected: [await c.pin()] } });
    expect(issued).toMatchObject({ status: 'committed' });
    if (issued.status !== 'committed') throw Error('issue did not commit');
    const hook = revokeAtTargetCommit(c, 'withdraw consume', 'b2-mat-revoke-consume');
    const b2 = c.f.ports(hook.records, { plans: c.plans, materials: c.materials, materialFacts: c.facts });
    const result = await b2.model.recordModelRequestAttempt(c.f.base.ctx, {
      input: { request: actual, permitRef: issued.value.permitRef, attemptId: 'b2-mat-hooked-attempt', observedAt: B2_AT },
      meta: { requestId: 'b2-mat-hook-consume',
        expected: [await c.pin(), { ref: issued.value.permitRef, revision: 1 }] } });
    expect(result, 'fresh consume barrier').toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(hook.fired()).toBe(true);
    const rows = await c.f.base.records.readMany([canonicalJson(issued.value.permitRef as unknown as JsonValue)]);
    expect(rows.status).toBe('ready');
    if (rows.status === 'ready') expect(rows.value.records[0]?.revision).toBe(1);
  });

  // ---- 4. Fresh barriers re-read the real current source/authorization. -------
  it('a real source change after authorize denies the fresh begin; a revoke after issue denies the fresh consume', async () => {
    const first = await openChain();
    const prepared = await first.buildPrepared();
    const admitted = await first.f.authorize({ prepared, ports: first.ports() });
    await writeFile(join(first.directory, 'src/input.txt'), 'source changed after authorize');
    const begin = await first.ports().entry.beginRuntimeEntry(first.f.base.ctx, {
      input: { permit: admitted.permit, kernel: first.kernel },
      meta: { requestId: 'b2-mat-source-changed-begin', expected: [await first.pin()] } });
    expect(begin, 'fresh begin re-reads the source').toMatchObject({ status: 'rejected', code: 'source_stale' });
    expect((await first.read()).run.executionAuthorization).toMatchObject({ phase: 'authorized' });

    const second = await openChain();
    const entered = await second.f.enter({ prepared: await second.buildPrepared(), ports: second.ports() });
    const actual = second.f.actualRequest(entered);
    const issued = await second.ports().model.authorizeModelRequest(second.f.base.ctx, {
      input: actual, meta: { requestId: 'b2-mat-revoke-after-issue', expected: [await second.pin()] } });
    expect(issued).toMatchObject({ status: 'committed' });
    if (issued.status !== 'committed') throw Error('issue did not commit');
    await second.revoke('withdraw after issue before consume', 'b2-mat-revoke-after-issue');
    const consume = await second.ports().model.recordModelRequestAttempt(second.f.base.ctx, {
      input: { request: actual, permitRef: issued.value.permitRef, attemptId: 'b2-mat-after-revoke', observedAt: B2_AT },
      meta: { requestId: 'b2-mat-consume-after-revoke',
        expected: [await second.pin(), { ref: issued.value.permitRef, revision: 1 }] } });
    expect(consume, 'fresh consume re-reads the current authorization').toMatchObject({ status: 'rejected' });
    expect((consume as { code?: string }).code).toBe('forbidden');
    const rows = await second.f.base.records.readMany([canonicalJson(issued.value.permitRef as unknown as JsonValue)]);
    expect(rows.status).toBe('ready');
    if (rows.status === 'ready') expect(rows.value.records[0]?.revision).toBe(1);
  });

  // ---- 5. mergeGuards rejects a mixed material/barrier version window. --------
  it('rejects a material facts window whose observed Run version conflicts with the barrier Run guard', async () => {
    const c = await openChain();
    const prepared = await c.buildPrepared();
    const pinned = await c.pin();
    const plain = await c.f.buildPrepared({ claim: c.consumerClaim });
    let advanced = false;
    const bumping: MaterialReadFactsPort = {
      async openArtifactFacts(ctx, input) {
        if (!advanced) {
          advanced = true;
          const receipt = await c.f.ports().entry.authorizeRuntimeEntry(c.f.base.ctx, {
            input: { prepared: plain, consumerId: 'competing-consumer' },
            meta: { requestId: 'b2-mat-competing-authorize', expected: [await c.pin()] } });
          expect(receipt, 'a real competing admission changes the observed Run version').toMatchObject({ status: 'committed' });
        }
        return c.facts.openArtifactFacts(ctx, input);
      },
    };
    const b2 = c.ports({ materialFacts: bumping });
    const result = await b2.entry.authorizeRuntimeEntry(c.f.base.ctx, {
      input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'b2-mat-merge-conflict', expected: [pinned] } });
    expect(result, 'mixed material/barrier window').toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  });

  // ---- 6. Replay restores receipts; observed entered/result are not gated. ----
  it('restores every original receipt after a later revocation and still denies fresh requests', async () => {
    const c = await openChain();
    const b2 = c.ports();
    const prepared = await c.buildPrepared();
    const authRequest = { input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'b2-mat-replay-authorize', expected: [await c.pin()] } };
    const authorized = await b2.entry.authorizeRuntimeEntry(c.f.base.ctx, authRequest);
    expect(authorized).toMatchObject({ status: 'committed', replayed: false });
    if (authorized.status !== 'committed') throw Error('authorize did not commit');
    const beginRequest = { input: { permit: authorized.value, kernel: c.kernel },
      meta: { requestId: 'b2-mat-replay-begin', expected: [await c.pin()] } };
    const begun = await b2.entry.beginRuntimeEntry(c.f.base.ctx, beginRequest);
    expect(begun).toMatchObject({ status: 'committed', replayed: false });
    if (begun.status !== 'committed') throw Error('begin did not commit');
    const enteredRequest = { input: { permit: await c.f.currentPermit(c.consumerClaim), enteredAt: B2_AT,
      kernelSource: { ...c.kernel, position: 3 }, history: c.observedHistory(3) },
      meta: { requestId: 'b2-mat-replay-entered', expected: [await c.pin()] } };
    const entered = await b2.entry.recordExecutionEntered(c.f.base.ctx, enteredRequest);
    expect(entered).toMatchObject({ status: 'committed' });
    if (entered.status !== 'committed') throw Error('entered did not commit');
    const actual = c.f.actualRequest({ prepared, permit: await c.f.currentPermit(c.consumerClaim) });
    const issueRequest = { input: actual, meta: { requestId: 'b2-mat-replay-issue', expected: [await c.pin()] } };
    const issued = await b2.model.authorizeModelRequest(c.f.base.ctx, issueRequest);
    expect(issued).toMatchObject({ status: 'committed', replayed: false });
    if (issued.status !== 'committed') throw Error('issue did not commit');
    const consumeRequest = { input: { request: actual, permitRef: issued.value.permitRef,
      attemptId: 'b2-mat-replay-attempt', observedAt: B2_AT },
      meta: { requestId: 'b2-mat-replay-consume',
        expected: [await c.pin(), { ref: issued.value.permitRef, revision: 1 }] } };
    const consumed = await b2.model.recordModelRequestAttempt(c.f.base.ctx, consumeRequest);
    expect(consumed).toMatchObject({ status: 'committed', replayed: false });
    if (consumed.status !== 'committed') throw Error('consume did not commit');

    await c.revoke('withdraw after all receipts', 'b2-mat-revoke-replay');

    expect(await b2.entry.authorizeRuntimeEntry(c.f.base.ctx, authRequest)).toEqual({ ...authorized, replayed: true });
    expect(await b2.entry.beginRuntimeEntry(c.f.base.ctx, beginRequest)).toEqual({ ...begun, replayed: true });
    expect(await b2.entry.recordExecutionEntered(c.f.base.ctx, enteredRequest)).toEqual({ ...entered, replayed: true });
    expect(await b2.model.authorizeModelRequest(c.f.base.ctx, issueRequest)).toEqual({ ...issued, replayed: true });
    expect(await b2.model.recordModelRequestAttempt(c.f.base.ctx, consumeRequest)).toEqual({ ...consumed, replayed: true });

    const fresh = await b2.model.authorizeModelRequest(c.f.base.ctx, {
      input: { ...actual, requestId: 'b2-mat-fresh-after-revoke' },
      meta: { requestId: 'b2-mat-fresh-request', expected: [await c.pin()] } });
    expect(fresh).toMatchObject({ status: 'rejected' });
    expect((fresh as { code?: string }).code, 'withdrawn grant keeps the concrete material error').toBe('forbidden');
  });

  it('does not put a new material gate on the already-entered observation or the observed result', async () => {
    const c = await openChain();
    const b2 = c.ports();
    const prepared = await c.buildPrepared();
    const admitted = await c.f.authorize({ prepared, ports: b2 });
    const begun = await b2.entry.beginRuntimeEntry(c.f.base.ctx, {
      input: { permit: admitted.permit, kernel: c.kernel },
      meta: { requestId: 'b2-mat-observe-begin', expected: [await c.pin()] } });
    expect(begun).toMatchObject({ status: 'committed' });
    await c.revoke('withdraw before entered observation', 'b2-mat-revoke-entered');
    const entered = await b2.entry.recordExecutionEntered(c.f.base.ctx, {
      input: { permit: await c.f.currentPermit(c.consumerClaim), enteredAt: B2_AT,
        kernelSource: { ...c.kernel, position: 3 }, history: c.observedHistory(3) },
      meta: { requestId: 'b2-mat-entered-after-revoke', expected: [await c.pin()] } });
    expect(entered, 'entered is an observed fact, not a fresh material gate')
      .toMatchObject({ status: 'committed', value: { status: 'running' } });
    const entryPermit = await c.f.currentPermit(c.consumerClaim);
    const observation = {
      claim: c.consumerClaim,
      entry: { consumerId: entryPermit.consumerId, entryGeneration: entryPermit.entryGeneration },
      event: { ...c.f.terminalEvent(), runRef: c.consumerClaim.runRef },
      kernelSource: { ...c.kernel, position: 4 },
      completedHistoryBoundary: c.completedBoundary(4),
      history: { ...c.observedHistory(4), endPosition: 4 } };
    const result = await b2.entry.recordRunResult(c.f.base.ctx, {
      input: observation, meta: { requestId: 'b2-mat-result-after-revoke', expected: [await c.pin()] } });
    expect(result, 'observed result reduction is not a fresh material gate')
      .toMatchObject({ status: 'committed', value: { status: 'ended' } });
  });

  // ---- 7. Cancellation/unavailable source keeps its concrete error. ----------
  it('keeps real Host source unavailability as source_stale without committing permission', async () => {
    const c = await openChain();
    const prepared = await c.buildPrepared();
    const before = await c.read();
    c.sourceState.available = false;
    await expect(c.facts.openArtifactFacts(c.consumerCtx(), { ref: c.selectedRef, usage: 'current' }))
      .resolves.toMatchObject({ result: { status: 'rejected', code: 'source_stale' }, guards: [] });
    const denied = await c.ports().entry.authorizeRuntimeEntry(c.f.base.ctx, {
      input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'b2-mat-source-unavailable', expected: [await c.pin()] } });
    expect(denied, 'real Host mount failure keeps the material source error')
      .toMatchObject({ status: 'rejected', code: 'source_stale' });
    expect(await c.read()).toEqual(before);
  });

  it('propagates the original signal through additional-only facts to real source capture', async () => {
    const c = await openChain();
    const prepared = await c.buildPrepared({ selectedTaskInputs: [] });
    const before = await c.read();
    const controller = new AbortController();
    let sawSource = false;
    c.sourceState.beforeAuthorize = ctx => {
      expect(ctx.signal).toBe(controller.signal);
      sawSource = true;
      controller.abort();
    };
    const cancelled = await c.ports().entry.authorizeRuntimeEntry(
      { ...c.f.base.ctx, signal: controller.signal },
      { input: { prepared, consumerId: 'runtime-a' },
        meta: { requestId: 'b2-mat-cancelled', expected: [await c.pin()] } });
    expect(cancelled, 'a cancelled original signal is not rewritten as forbidden')
      .toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(sawSource).toBe(true);
    expect(await c.read()).toEqual(before);
  });
});
