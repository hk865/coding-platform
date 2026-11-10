/**
 * UI1 `verification/round` read through the real route and the real Host
 * (brief §1, §2, §5; lead ruling §12-16, 11-06).
 *
 * Each row names the literal it expects and the production change that must
 * turn it red. The world comes from the real R3e evidence fixture: its Goal,
 * adopted Plan, claimed/ended Run and rounds are produced through public
 * owners. The route rows use a real `createTargetPlatform` over the same
 * records; the HTTP group starts a real Host on the fixture's SQLite ledger.
 *
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CORE_ROUTE_SPECS, createPlatformCoreRouteBindings, dispatchCoreRoute,
  parseCoreRouteRequest } from '../../src/app/core-routes.js';
import type { CoreRouteSuffix } from '../../src/app/core-http-types.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { CheckProcessObservation, RegisteredCommandCheck, RoundSnapshot,
  VerificationRoundRef } from '../../src/contracts/verification.js';
import type { FinalizedChecks } from '../../src/core/work-graph/model/evidence-contracts.js';
import { corePost, readPageToken } from '../helpers/AG2b-collaboration-fixture.js';
import { cleanupRestart, publicDirectory } from '../helpers/A2-restart-fixture.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';
import { openMemoryPlatform } from '../helpers/K3-review-card-fixture.js';
import { createR3eEvidenceFixture, R3E_GATE_TASK_ID, R3E_HOST,
  type R3eEvidenceFixture } from '../helpers/R3e-evidence-fixture.js';
import { EXPECTED_ROUTE_ROWS } from '../helpers/S6B3-route-suffixes.js';
import { linkHostStore } from '../helpers/KLS1B-host-store.js';

const ROUND_ROUTE = 'verification/round' as CoreRouteSuffix;
const KINDS = ['memory', 'sqlite'] as const;
const SIX_GATE_TASK = 'r3e-six-gate';
type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;

type RoundCheckView = {
  checkId: string; phase: string; outcome: string | null; incompleteCause: string | null;
  reportRef: ArtifactRef | null; command: string; reason: string | null;
};
type RoundView = {
  roundRef: VerificationRoundRef; revision: number; status: string; displayStatus: string;
  outcome: string | null; checks: RoundCheckView[];
  failingCheckIds: string[]; gaps: { code: string; message: string }[];
  chain: { ordinal: number; predecessorRoundRef: VerificationRoundRef | null; length: number; isHead: boolean;
    rounds: { ordinal: number; roundRef: VerificationRoundRef; status: string; displayStatus: string;
      outcome: string | null; counts: Record<string, number>;
      failingCheckIds: string[] }[] };
  delivery: {
    requirements: { obligationId: string; requirementId: string; state: string;
      checks: { checkId: string; outcome: string | null; reportRef: ArtifactRef | null }[] }[];
    summary: { obligations: number; requirements: number; pass: number; fail: number; inconclusive: number;
      pending: number; missing: number; rounds: number };
  };
};
type ReadBody = { status: string; code?: string; reason?: string; value?: RoundView };
type ReadResultBody = { status: string; code?: string; reason?: string; value?: { body?: string } };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function checks(count: number): RegisteredCommandCheck[] {
  return Array.from({ length: count }, (_, index) => ({
    checkId: `r3e-check-${index + 1}`, kind: 'static' as const, command: 'echo R3E_CHECK_OK',
    cwd: '.', timeoutMs: 60_000, taskIds: 'all' as const,
  }));
}

function executed(text: string, exitCode: number | null = 0, timedOut = false): CheckProcessObservation {
  return { kind: 'executed', startedAt: B2_AT, finishedAt: B2_AT, exitCode, signal: null, timedOut,
    cancelled: false, stdout: { text, totalBytes: Buffer.byteLength(text), truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { workspaceRevision: 'a2-round-read-revision', changedPaths: [] }, sandboxProfileVersion: 'bwrap-m3-v4' };
}

async function latest(fixture: R3eEvidenceFixture, ref: RoundSnapshot['ref']): Promise<RoundSnapshot> {
  const read = await fixture.evidence.readVerification(fixture.ctx, ref);
  if (read.status !== 'ready') throw new Error(`the opened round must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

async function world(kind: 'memory' | 'sqlite', count: number): Promise<{ fixture: R3eEvidenceFixture; round: RoundSnapshot }> {
  const fixture = await createR3eEvidenceFixture(kind);
  cleanups.push(() => fixture.close());
  (fixture.configuration as unknown as { checks: RegisteredCommandCheck[] }).checks = checks(count);
  const opened = await fixture.evidence.openVerification(fixture.ctx, fixture.openRequest());
  if (opened.status !== 'committed') throw new Error(`the round must open: ${JSON.stringify(opened)}`);
  return { fixture, round: opened.value };
}

async function memoryPlatformOver(fixture: R3eEvidenceFixture, records = fixture.records): Promise<Platform> {
  const platform = await openMemoryPlatform(records, fixture.b2.bodies,
    { workspace: fixture.workspaceHost, checks: fixture.configuration, now: () => B2_AT });
  cleanups.push(() => platform.close());
  return platform;
}

async function platformFor(fixture: R3eEvidenceFixture, records = fixture.records): Promise<Platform> {
  if (fixture.kind === 'memory') return await memoryPlatformOver(fixture, records);
  await fixture.b2.base.closeBackend();
  const platform = await createTargetPlatform({ storage: { kind: 'sqlite', directory: fixture.b2.base.directory },
    workspace: fixture.workspaceHost, checks: fixture.configuration, now: () => B2_AT });
  cleanups.push(() => platform.close());
  return platform;
}

async function finish(fixture: R3eEvidenceFixture, round: RoundSnapshot,
  results: readonly { index: number; observation: CheckProcessObservation }[]): Promise<FinalizedChecks> {
  let current = round;
  for (const result of results) {
    const check = round.checks[result.index];
    if (check === undefined) throw new Error(`the round has no check ${result.index}`);
    const begin = await fixture.evidence.beginCheck(fixture.ctx, fixture.beginRequest(current, check.checkId));
    if (begin.status !== 'committed') throw new Error(`check ${check.checkId} must begin: ${JSON.stringify(begin)}`);
    const atBegin = await latest(fixture, round.ref);
    const recorded = await fixture.evidence.recordCheckResult(fixture.ctx,
      fixture.recordRequest(atBegin, check.checkId, begin.value.invocationId, result.observation));
    if (recorded.status !== 'committed') throw new Error(`check ${check.checkId} must record: ${JSON.stringify(recorded)}`);
    current = recorded.value;
  }
  const finalized = await fixture.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(current));
  if (finalized.status !== 'committed') throw new Error(`the round must finalize: ${JSON.stringify(finalized)}`);
  return finalized.value;
}

async function finishAll(fixture: R3eEvidenceFixture, round: RoundSnapshot,
  observation: CheckProcessObservation): Promise<FinalizedChecks> {
  return await finish(fixture, round, round.checks.map((_check, index) => ({ index, observation })));
}

function routeRow(): void {
  const specs = CORE_ROUTE_SPECS as unknown as Record<string, { kind: string; binding: string; owner: string }>;
  const spec = specs[ROUND_ROUTE];
  expect(spec, 'verification/round must be published in CORE_ROUTE_SPECS')
    .toEqual(EXPECTED_ROUTE_ROWS['verification/round']);
  if (spec === undefined) throw new Error('verification/round is not published');
}

async function readThroughRoute(platform: Platform, ctx: CoreCallContext, input: unknown): Promise<ReadBody> {
  routeRow();
  const bindings = createPlatformCoreRouteBindings(platform);
  const parsed = parseCoreRouteRequest(ROUND_ROUTE,
    { scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' }, input });
  return await dispatchCoreRoute(bindings, ROUND_ROUTE, ctx, parsed) as ReadBody;
}

const plainBody = (scope: { projectId: string; workspaceId: string }, input: unknown) => ({ scope, input });

async function openRoundReadHost(fixture: R3eEvidenceFixture): Promise<{ host: LocalWorkbenchHost; base: string; token: string }> {
  await fixture.b2.base.closeBackend();
  await linkHostStore(fixture.scope.projectId, fixture.workspaceRoot, fixture.b2.base.directory);
  const publicDir = await publicDirectory();
  const host = await createLocalWorkbenchHost({
    storage: { kind: 'sqlite', directory: fixture.b2.base.directory }, actor: R3E_HOST, publicDir, now: () => B2_AT,
    workspaces: [{ scope: fixture.scope, name: 'A2 verification round host', root: fixture.workspaceRoot,
      workspaceRevision: 1, readPrefixes: ['.'] }],
  });
  const address = await host.listen();
  return { host, base: address.url, token: await readPageToken(address.url) };
}

function countedRecords(records: R3eEvidenceFixture['records']): {
  counts: { lookup: number; readMany: number }; records: R3eEvidenceFixture['records'];
} {
  const counts = { lookup: 0, readMany: 0 };
  return { counts, records: {
    commit: input => records.commit(input),
    lookupCommit: input => records.lookupCommit(input),
    readMany: refKeys => { counts.readMany += 1; return records.readMany(refKeys); },
    eventAt: cursor => records.eventAt(cursor),
    lookup: request => { counts.lookup += 1; return records.lookup(request); },
    lookupOrdered: request => records.lookupOrdered(request),
  } };
}

async function adoptSixRequirementGate(fixture: R3eEvidenceFixture): Promise<PlanRevisionSnapshot> {
  const goal = await fixture.b2.base.plans.queryGoal(fixture.ctx, fixture.goalRef);
  if (goal.status !== 'ready') throw new Error(`the Goal must be readable: ${JSON.stringify(goal)}`);
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: 'r3e-six-plan', planRevision: fixture.plan.planRevision + 1, goalId: fixture.goalRef.goalId,
    stages: structuredClone(fixture.plan.stages),
    tasks: [...structuredClone(fixture.plan.tasks), { taskId: SIX_GATE_TASK, title: 'Six-requirement gate',
      requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    assignments: structuredClone(fixture.plan.assignments ?? []),
    obligations: [...structuredClone(fixture.plan.obligations), { obligationId: 'r3e-six', title: 'Five more checks',
      requirementLevel: 'required', taskIds: [SIX_GATE_TASK],
      verificationRequirements: Array.from({ length: 5 }, (_, index) => ({
        requirementId: `r3e-requirement-${index + 1}`, requirementLevel: 'required' as const,
        kind: 'static', description: `Required check ${index + 1}`,
      })) }],
    taskHierarchy: structuredClone(fixture.plan.taskHierarchy), executionDag: structuredClone(fixture.plan.executionDag),
    taskRelations: fixture.plan.taskRelations ?? [], inputRequirements: fixture.plan.inputRequirements ?? [],
  };
  const proposed = await fixture.b2.base.plans.proposePlan(fixture.ctx, {
    input: { goalRef: fixture.goalRef, basedOn: fixture.plan.ref, draft,
      reason: { text: 'A2 round read six requirements', sources: [] } },
    meta: { requestId: 'a2-round-six-propose', expected: [{ ref: fixture.goalRef, revision: goal.value.goal.revision }] },
  });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
    throw new Error(`the six-requirement Plan must propose: ${JSON.stringify(proposed)}`);
  }
  const applied = await fixture.b2.base.plans.applyPlanChange(fixture.ctx, {
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
    meta: { requestId: 'a2-round-six-apply', expected: [{ ref: fixture.goalRef, revision: goal.value.goal.revision }] },
  });
  if (applied.status !== 'committed') throw new Error(`the six-requirement Plan must apply: ${JSON.stringify(applied)}`);
  return applied.value;
}

// Mutation: delete the verification/round row from CORE_ROUTE_SPECS -> the toEqual below.
it('publishes verification/round as a plain read with the named binding and owner', () => {
  routeRow();
});

describe('verification/round over the real Host (SQLite, one start)', () => {
  let fixture: R3eEvidenceFixture;
  let host: LocalWorkbenchHost | null = null;
  let base = '';
  let token = '';
  let round: RoundSnapshot;

  beforeAll(async () => {
    fixture = await createR3eEvidenceFixture('sqlite');
    (fixture.configuration as unknown as { checks: RegisteredCommandCheck[] }).checks = checks(2);
    const opened = await fixture.evidence.openVerification(fixture.ctx, fixture.openRequest());
    if (opened.status !== 'committed') throw new Error(JSON.stringify(opened));
    round = (await finishAll(fixture, opened.value, executed('R3E_CHECK_OK'))).snapshot;
    const started = await openRoundReadHost(fixture);
    host = started.host; base = started.base; token = started.token;
  }, 90_000);

  afterAll(async () => {
    if (host !== null) await host.close();
    await fixture.close();
    await cleanupRestart();
  });

  // Mutation: leave the suffix unbound/absent -> the 404 assertion below.
  it('returns a finalized round through the HTTP boundary', async () => {
    const response = await corePost(base, ROUND_ROUTE, token, plainBody(fixture.scope, { roundRef: round.ref }));
    expect(response.status, 'verification/round is a published plain route').toBe(200);
    const body = await response.json() as ReadBody;
    expect(body.status).toBe('ready');
    expect(body.value?.roundRef).toEqual(round.ref);
    expect(body.value?.checks).toHaveLength(2);
  }, 90_000);

  // Mutation: answer an empty ready for an unknown roundRef -> the not_found assertion below.
  it('rejects: an unknown round is a domain not_found at HTTP 200', async () => {
    const unknown = { ...round.ref, roundId: 'round-that-does-not-exist' };
    const response = await corePost(base, ROUND_ROUTE, token, plainBody(fixture.scope, { roundRef: unknown }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'rejected', code: 'not_found',
      reason: 'the round does not exist' });
    await expectUnchanged();
  });

  // Mutation: drop the workspace comparison -> the forbidden assertion below.
  it('rejects: a round in another workspace is forbidden', async () => {
    const foreign = { ...round.ref, workspaceId: 'a2-round-other-workspace' };
    const response = await corePost(base, ROUND_ROUTE, token, plainBody(fixture.scope, { roundRef: foreign }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'rejected', code: 'forbidden',
      reason: 'the round ref is outside the trusted Host scope' });
    await expectUnchanged();
  });

  // Mutation: drop roundRefProblem -> the invalid assertion below.
  it('rejects: an incomplete roundRef is invalid', async () => {
    const response = await corePost(base, ROUND_ROUTE, token, plainBody(fixture.scope, {
      roundRef: { aggregateType: 'VerificationRound', projectId: fixture.scope.projectId,
        workspaceId: fixture.scope.workspaceId },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'the round ref must be a complete VerificationRoundRef' });
    await expectUnchanged();
  });

  // Mutation: drop the mutual-exclusion check -> the exact-one assertion below.
  it('rejects: roundRef together with taskRef is invalid', async () => {
    const response = await corePost(base, ROUND_ROUTE, token,
      plainBody(fixture.scope, { roundRef: round.ref, taskRef: fixture.subject }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'the round read requires exactly one of roundRef, taskRef or subjectRunRef' });
    await expectUnchanged();
  });

  // Mutation: drop the work-chain taskKind check -> the invalid assertion below.
  it('rejects: a work chain without subjectRunRef is invalid', async () => {
    const response = await corePost(base, ROUND_ROUTE, token, plainBody(fixture.scope, { taskRef: fixture.subject }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'a work chain requires subjectRunRef' });
    await expectUnchanged();
  });

  // Mutation: drop the RunRef shape check -> the invalid assertion below.
  it('rejects: an incomplete subjectRunRef is invalid', async () => {
    const response = await corePost(base, ROUND_ROUTE, token, plainBody(fixture.scope, {
      subjectRunRef: { aggregateType: 'Run', projectId: fixture.scope.projectId, goalId: fixture.goalRef.goalId },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'subjectRunRef must be a complete RunRef' });
    await expectUnchanged();
  });

  // Mutation: drop the run.task comparison -> the mismatch assertion below.
  it('rejects: a subject Run that belongs to another Task is invalid', async () => {
    const response = await corePost(base, ROUND_ROUTE, token, plainBody(fixture.scope, {
      taskRef: { ...fixture.subject, taskId: R3E_GATE_TASK_ID }, subjectRunRef: fixture.subjectRunRef,
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'the subject Run does not belong to the requested Task' });
    await expectUnchanged();
  });

  async function expectUnchanged(): Promise<void> {
    const response = await corePost(base, ROUND_ROUTE, token, plainBody(fixture.scope, { roundRef: round.ref }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ready',
      value: { roundRef: round.ref, revision: round.revision } });
  }
});

describe('verification/round read model', () => {
  // Mutation: filter out PASS checks in the view -> the literal order below.
  it.each(KINDS)('returns all 14 checks in the plan check order (%s)', async kind => {
    const { fixture, round } = await world(kind, 14);
    const platform = await platformFor(fixture);
    const body = await readThroughRoute(platform, fixture.ctx, { roundRef: round.ref });
    expect(body.status).toBe('ready');
    expect(body.value?.checks.map(check => check.checkId)).toEqual([
      'r3e-check-1', 'r3e-check-2', 'r3e-check-3', 'r3e-check-4', 'r3e-check-5', 'r3e-check-6',
      'r3e-check-7', 'r3e-check-8', 'r3e-check-9', 'r3e-check-10', 'r3e-check-11', 'r3e-check-12',
      'r3e-check-13', 'r3e-check-14',
    ]);
    for (const check of body.value?.checks ?? []) {
      expect(check).toHaveProperty('phase');
      expect(check).toHaveProperty('outcome');
      expect(check).toHaveProperty('reportRef');
    }
  }, 90_000);

  // Mutation: read `outcome` from the checks instead of the stored round -> the FAIL assertion below.
  it.each(KINDS)('keeps a FAIL over a missing check and lists the failing id (%s)', async kind => {
    const { fixture, round } = await world(kind, 2);
    const finalized = await finish(fixture, round, [{ index: 0, observation: executed('R3E_CHECK_FAIL', 3) }]);
    const platform = await platformFor(fixture);
    const body = await readThroughRoute(platform, fixture.ctx, { roundRef: finalized.snapshot.ref });
    expect(body.value).toMatchObject({ status: 'finalized', outcome: 'FAIL',
      failingCheckIds: ['r3e-check-1'] });
    expect(body.value?.gaps.length, 'the pending check leaves a gap').toBeGreaterThan(0);
  }, 90_000);

  // Mutation: map incompleteCause to null -> the process_timed_out assertion below.
  it.each(KINDS)('returns process_timed_out as the incomplete cause (%s)', async kind => {
    const { fixture, round } = await world(kind, 1);
    const finalized = await finish(fixture, round, [{ index: 0, observation: executed('', null, true) }]);
    const platform = await platformFor(fixture);
    const body = await readThroughRoute(platform, fixture.ctx, { roundRef: finalized.snapshot.ref });
    expect(body.value?.checks[0]).toMatchObject({ phase: 'finished', outcome: 'INCONCLUSIVE',
      incompleteCause: 'process_timed_out' });
    expect(body.value).toMatchObject({ outcome: 'INCONCLUSIVE' });
  }, 90_000);

  // Mutation: return a null reportRef -> the digest assertion below.
  it.each(KINDS)('returns a reportRef that materials/open opens (%s)', async kind => {
    const { fixture, round } = await world(kind, 1);
    const finalized = await finish(fixture, round, [{ index: 0, observation: executed('R3E_CHECK_OK') }]);
    const platform = await platformFor(fixture);
    const body = await readThroughRoute(platform, fixture.ctx, { roundRef: finalized.snapshot.ref });
    const reportRef = body.value?.checks[0]?.reportRef;
    expect(reportRef?.digest, 'the round read keeps the check report ref').toBeTruthy();
    if (reportRef === undefined || reportRef === null) return;
    const opened = await fixture.materials.openArtifact(fixture.ctx,
      { ref: reportRef, usage: 'historical_explanation' }) as ReadResultBody;
    expect(opened.status).toBe('ready');
    expect(opened.value?.body).toContain('R3E_CHECK_OK');
  }, 90_000);

  // Mutation: select chain.rounds[0] -> the ordinal-2 assertion below.
  it.each(KINDS)('selects the ordinal-2 chain head and its predecessor (%s)', async kind => {
    const { fixture, round } = await world(kind, 1);
    const first = (await finish(fixture, round, [{ index: 0, observation: executed('R3E_CHECK_FAIL', 3) }])).snapshot;
    const successor = await fixture.evidence.reverifyRound?.(fixture.ctx, {
      input: { predecessorRoundRef: first.ref },
      meta: { requestId: 'a2-round-read-reverify', expected: [{ ref: first.ref, revision: first.revision }] },
    });
    if (successor === undefined || successor.status !== 'committed' || successor.value.kind !== 'reverified') {
      throw new Error(`the FAIL head must reverify: ${JSON.stringify(successor)}`);
    }
    const platform = await platformFor(fixture);
    const body = await readThroughRoute(platform, fixture.ctx, { subjectRunRef: fixture.subjectRunRef });
    expect(body.value?.roundRef).toEqual(successor.value.round.ref);
    expect(body.value?.chain).toMatchObject({ ordinal: 2, predecessorRoundRef: first.ref, length: 2, isHead: true });
    expect(body.value?.chain.rounds.map(entry => entry.ordinal)).toEqual([1, 2]);
  }, 90_000);

  // Mutation: readMany per check in the view -> the two count assertions below.
  it.each(KINDS)('reads the chain with at most three storage reads and one chain lookup (%s)', async kind => {
    const { fixture, round } = await world(kind, 14);
    await finishAll(fixture, round, executed('R3E_CHECK_OK'));
    const counted = countedRecords(fixture.records);
    const platform = await memoryPlatformOver(fixture, counted.records);
    counted.counts.lookup = 0; counted.counts.readMany = 0;
    const body = await readThroughRoute(platform, fixture.ctx, { roundRef: round.ref });
    expect(body.value?.checks).toHaveLength(14);
    expect(counted.counts.lookup, 'the chain is one lookup').toBe(1);
    expect(counted.counts.lookup + counted.counts.readMany, 'anchor + plan + chain only').toBeLessThanOrEqual(3);
  }, 90_000);

  // Mutation: match coverage by checkId prefix -> the per-requirement checks length/state below.
  it.each(KINDS)('returns the six Done requirements matched by coverage (%s)', async kind => {
    const { fixture } = await world(kind, 6);
    const plan = await adoptSixRequirementGate(fixture);
    const gateSubject = { ...fixture.subject, taskId: SIX_GATE_TASK };
    const opened = await fixture.evidence.openVerification(fixture.ctx,
      fixture.openRequest({ subject: gateSubject, planRef: plan.ref, gateSubject: 'goal' }));
    if (opened.status !== 'committed') throw new Error(`the gate round must open: ${JSON.stringify(opened)}`);
    const finalized = await finishAll(fixture, opened.value, executed('R3E_CHECK_OK'));
    const platform = await platformFor(fixture);
    const body = await readThroughRoute(platform, fixture.ctx, {
      taskRef: { projectId: fixture.scope.projectId, goalId: fixture.goalRef.goalId, taskId: SIX_GATE_TASK },
    });
    const requirements = body.value?.delivery.requirements ?? [];
    expect(requirements).toHaveLength(6);
    for (const requirement of requirements) {
      expect(requirement.checks, requirement.requirementId).toHaveLength(6);
      expect(requirement.checks.every(check => check.outcome === 'PASS')).toBe(true);
      expect(requirement.state).toBe('pass');
    }
    expect(body.value?.delivery.summary).toMatchObject({ requirements: 6, pass: 6, fail: 0,
      inconclusive: 0, pending: 0, missing: 0, rounds: 1 });
    expect(finalized.outcome).toBe('PASS');
  }, 90_000);
});
