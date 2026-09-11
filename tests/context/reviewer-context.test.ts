import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { VerificationContextCompiler } from '../../src/data/context-compiler/verification-context.js';
import { ReviewerContextCompiler } from '../../src/data/context-compiler/reviewer-context.js';
import { ReviewerProfileCompiler } from '../../src/data/context-compiler/reviewer-profile.js';
import { ControlEngineImpl } from '../../src/control/control-engine/control-engine.js';
import { buildGrantMaterialAccessCommand } from '../../src/contracts/commands/material-access.js';
import { assembleRuntimeContext } from '../../src/data/context-compiler/runtime-context.js';
import { VerificationWorkspaceReader } from '../../src/data/workspace-reader/verification-workspace-reader.js';
import { VerificationSourceApplicability } from '../../src/data/workspace-reader/verification-source-applicability.js';
import { reviewerSourcePathAllowed } from '../../src/data/workspace-reader/reviewer-source-reader.js';
import { ArtifactVault, type StoredRecord } from '../../src/data/artifact-vault/artifact-vault.js';
import { createMaterialAccessResolver } from '../../src/data/artifact-vault/material-access-policy.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { AggregateSnapshot, StateLedger } from '../../src/contracts/ledger.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { RunSnapshot, DispatchOutboxEntrySnapshot } from '../../src/contracts/dispatch.js';
import type { ReviewWorkSnapshot } from '../../src/contracts/reviewer-work.js';
import type { ReviewMaterialDescriptorV1 } from '../../src/contracts/reviewer-verification.js';
import type { ReviewerRuntimeObservations, ReviewerModelMetadataPort } from '../../src/contracts/reviewer-context.js';
import type { MaterialAccessGrantSnapshot } from '../../src/contracts/material-access.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import { prepareP107Scenario, runP107Task, toP1_07Harness, P107_PROJECT, P107_WORKSPACE, P107_GOAL, P107_SCHEMA, P107_TASK_WRITER_B, P107_ROLE_BINDING_WRITER_V1, P107_BUDGET_WRITER_V1, P107_DECLARED_WRITE_PERMISSIONS_V1 } from '../contract-suite/p1-07-harness.js';

const roots: string[] = [];
const json = (v: unknown) => canonicalJson(v as JsonValue);
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const value = <T extends { status: string }>(result: T): Extract<T, { status: 'ready' }> => { expect(result.status).toBe('ready'); if (result.status !== 'ready') throw Error(json(result)); return result as Extract<T, { status: 'ready' }>; };

/** Real accepted producer/Plan/governance plus explicit canonical read fixtures
 * for C-owned ReviewWork transitions. Real Vault authorization and filesystem I/O
 * remain active; this fixture does not claim to test Control's creation handler. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'reviewer-context-')); roots.push(root);
  await writeFile(join(root, 'source.txt'), 'reviewed source\nsecond line\n');
  const h = createInMemoryHarness({ deps: { clock: () => P107_SCHEMA } }), p = toP1_07Harness(h);
  await prepareP107Scenario(p);
  await runP107Task(p, { taskId: P107_TASK_WRITER_B, runId: 'producer', attemptId: 'producer-attempt', roleBinding: P107_ROLE_BINDING_WRITER_V1, declaredPermissions: P107_DECLARED_WRITE_PERMISSIONS_V1, budget: P107_BUDGET_WRITER_V1 });
  const scope = { projectId: P107_PROJECT, workspaceId: P107_WORKSPACE, goalId: P107_GOAL, taskId: P107_TASK_WRITER_B, runId: 'producer' };
  const budget = { ...DEFAULT_RUNTIME_BUDGET, contextWindowTokens: P107_BUDGET_WRITER_V1.tokenBudget };
  const observations: ReturnType<ReviewerRuntimeObservations['all']> = [{ spec: { ...scope, budget }, status: 'completed', sessionId: 'producer-session' }];
  const overlay = new Map<string, AggregateSnapshot>(), ledger = Object.create(h.ledger) as StateLedger;
  ledger.commit = h.ledger.commit.bind(h.ledger);
  ledger.load = async ref => { const row = overlay.get(json(ref)); return row ? { status: 'found', snapshot: structuredClone(row) } : h.ledger.load(ref); };
  let eventNumber = 0;
  const control = new ControlEngineImpl({ ledger, now: () => P107_SCHEMA, eventId: () => 'review-context-event-' + ++eventNumber });
  const source = new VerificationSourceApplicability(() => root);
  const store = new Map<string, StoredRecord>(), grants: MaterialAccessGrantSnapshot[] = [];
  let candidatesVisible = true;
  const vault = new ArtifactVault(store, { grants: createMaterialAccessResolver(ledger, {
    materialAccessCandidates: async () => ({ status: 'ready', grants: candidatesVisible ? grants.map(g => ({ ...g, sourceCursor: '1' as CommitCursor })) : [], sourceCursor: '1' as CommitCursor }),
  }, source) });
  const facts = { all: () => structuredClone(observations) };
  const round = new VerificationContextCompiler({ ledger, vault, runtime: facts, rootFor: () => root, roundSource: new VerificationWorkspaceReader() });
  const material = value(await round.resolveRound(scope)).material;
  let model: Awaited<ReturnType<ReviewerModelMetadataPort['current']>> = { configurationRevision: 'saved-model-1', provider: 'openai-compatible', model: 'review-model', baseUrl: 'http://127.0.0.1:5555/v1' };
  const profiles = new ReviewerProfileCompiler({ ledger, observations: facts, modelMetadata: { current: async () => structuredClone(model) } });
  const profile = value(await profiles.current(scope));
  const put = async (body: string, owner = material.run.ref) => {
    const stored = await vault.put({ contentType: 'application/json', body, sourceRefs: [{ kind: 'workspace', refId: scope.workspaceId, revision: '1' }], ownerRef: owner, requestedAt: P107_SCHEMA });
    if (stored.status !== 'stored') throw Error(json(stored));
    return stored.ref;
  };
  const toolRef = await put(json({ report: 'original tool PASS 原文', result: 'PASS' }));
  const aggregateRef = await put(json({ aggregate: 'full tool set', reports: [toolRef] }));
  const descriptorBody: Omit<ReviewMaterialDescriptorV1, 'descriptorId'> = { schemaVersion: 1, kind: 'independent-review-material', subject: { scope, producerRunRef: material.run.ref, producerAttemptRef: material.run.envelope!.attemptRef },
    toolRound: { roundId: 'round', requestId: 'round-request', aggregateRef, configurationDigest: 'a'.repeat(64), verificationPlanRef: { planId: 'vp', planDigest: 'b'.repeat(64) } },
    materialIdentity: material.identity, sourceProof: material.sourceProof, requiredReviewerCoverage: [{ obligationId: 'review-obligation', requirementId: 'review-vr' }], requirements: [{ obligationId: 'review-obligation', requirementId: 'review-vr', description: 'Check actual source and original reports' }],
    tools: [{ checkId: 'test', kind: 'static', definitionDigest: 'c'.repeat(64), childRequestId: 'check', observationId: 'check-observation', reportRef: toolRef, coverage: [], result: 'PASS' }], toolEvidence: [], sourceNotes: material.gaps };
  const descriptor = { ...descriptorBody, descriptorId: sha256Hex(json(descriptorBody)) }, descriptorRef = await put(json(descriptor));
  const workRef = { aggregateType: 'ReviewWork' as const, projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: scope.goalId, reviewId: 'review-context' };
  const reviewerRunRef = { aggregateType: 'Run' as const, projectId: scope.projectId, goalId: scope.goalId, runId: 'reviewer' };
  const attemptRef = { ...material.run.envelope!.attemptRef, attemptId: 'review-attempt' };
  const outboxRef = { aggregateType: 'DispatchOutboxEntry' as const, projectId: scope.projectId, goalId: scope.goalId, taskId: scope.taskId, attemptId: attemptRef.attemptId };
  const work: ReviewWorkSnapshot = { ref: workRef, schemaVersion: 1, revision: 1, protocol: 'independent-review-v1', protocolRef: { aggregateType: 'TaskReviewProtocol', projectId: scope.projectId, goalId: scope.goalId, taskId: scope.taskId, planId: material.plan.planId }, requestId: 'review-context', requestFingerprint: 'd'.repeat(64), subject: material.run.task, planRef: material.plan.ref, producerRunRef: material.run.ref, producerAttemptRef: material.run.envelope!.attemptRef, descriptor, descriptorRef,
    reviewerConfigRef: profile.ref, reviewerConfigDigest: profile.profile.digest, reviewerProfile: profile.profile, reviewerRunRef, reviewerAttemptRef: attemptRef, outboxRef, roleBinding: profile.profile.roleBinding, input: null, output: null, resultRef: null };
  const run: RunSnapshot = { ...structuredClone(material.run), ref: reviewerRunRef, work: { kind: 'review', reviewWorkRef: workRef }, attemptId: attemptRef.attemptId, roleBinding: work.roleBinding, revision: 1, status: 'starting', outcome: null, exitCode: null, lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '', envelope: null, startedAt: null, endedAt: null };
  const outbox: DispatchOutboxEntrySnapshot = { ref: outboxRef, revision: 1, schemaVersion: 1, status: 'pending', pendingAt: P107_SCHEMA, startedAt: null, doneAt: null,
    intent: { schemaVersion: 1, work: { kind: 'review', reviewWorkRef: workRef }, intentId: attemptRef.attemptId, projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: scope.goalId, taskId: scope.taskId, planRef: work.planRef, attemptRef, runRef: reviewerRunRef, roleBinding: work.roleBinding, workspaceSnapshot: run.workspaceSnapshot, declaredPermissions: profile.profile.permissions, budget: run.budget, requestedAt: P107_SCHEMA, correlationId: 'review-context' } };
  overlay.set(json(workRef), work); overlay.set(json(reviewerRunRef), run); overlay.set(json(outboxRef), outbox);
  const context = new ReviewerContextCompiler({ ledger, vault, roundContext: round, profiles, source, observations: facts });
  const authorize = async () => {
    const selected = value(await context.select(workRef));
    const grant: MaterialAccessGrantSnapshot = { schemaVersion: 1, revision: 1, ref: { aggregateType: 'MaterialAccessGrant', projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: scope.goalId, grantId: 'review-grant' },
      grant: { schemaVersion: 1, grantId: 'review-grant', scope: { projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: scope.goalId }, materials: selected.materials, reader: reviewerRunRef,
        issuedBy: { aggregateType: 'Control', projectId: scope.projectId, goalId: scope.goalId }, purpose: 'review original material', basis: selected.basis, grantedAt: P107_SCHEMA } };
    expect(await control.grantMaterialAccess(buildGrantMaterialAccessCommand(grant.grant, { commandId: 'context-grant', projectId: scope.projectId, actorKind: 'system', actorId: 'control', idempotencyKey: 'context-grant', correlationId: 'context-grant', submittedAt: P107_SCHEMA }))).toMatchObject({ status: 'committed' });
    grants.push(grant);
    return [grant.ref];
  };
  const start = async () => {
    const refs = await authorize(), assembled = value(await context.assemble(workRef, refs));
    work.input = assembled.input; work.revision++;
    run.envelope = assembled.envelope; run.status = 'running'; run.revision++;
    observations.push({ spec: { ...scope, runId: run.ref.runId, mode: 'review', review: { workRef, profile: profile.profile }, budget }, status: 'running', sessionId: 'reviewer-session' });
    return assembled;
  };
  return { h, control, scope, root, context, profiles, round, source, vault, store, work, run, observations, grants, material, toolRef, aggregateRef, descriptorRef, profile, overlay, authorize, start,
    model: (value: typeof model) => { model = value; }, candidates: (visible: boolean) => { candidatesVisible = visible; } };
}

describe('independent Reviewer material consumer', () => {
  it('builds a usable exact saved profile without inventing cumulative limits, and refuses stale configuration', async () => {
    const s = await fixture();
    expect(s.profile.profile.budget).toMatchObject({ inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null });
    expect(s.profile.profile.permissions).toEqual({ tools: ['read'], writeScope: [] });
    expect(await s.profiles.resolve(s.scope, s.profile.ref)).toEqual(s.profile);
    s.model({ ...s.profile.profile.model, configurationRevision: 'new-model' });
    expect(await s.profiles.resolve(s.scope, s.profile.ref)).toMatchObject({ status: 'rejected', code: 'stale_configuration' });
    s.model(null); expect(await s.profiles.current(s.scope)).toMatchObject({ status: 'incomplete' });
    s.model(s.profile.profile.model);
    delete (s.observations[0]!.spec.budget as Partial<typeof s.observations[0]['spec']['budget']>).inputTokens;
    expect(await s.profiles.current(s.scope)).toMatchObject({ status: 'incomplete', missing: [expect.stringContaining('Persisted Task budget is incomplete')] });
  });
  it('assembles the first packet without an existing Reviewer envelope and consumes its exact frozen runtime input', async () => {
    const s = await fixture(); expect(s.run.envelope).toBeNull();
    const assembled = await s.start(), access = await s.context.runtime(s.work.ref, assembled.envelope);
    expect(assembled.packet.materials.map(i => i.ref.digest)).toEqual([s.descriptorRef.digest, s.aggregateRef.digest, s.toolRef.digest]);
    const runtime = await assembleRuntimeContext({ ...s.scope, runId: s.run.ref.runId, instruction: 'untrusted instruction', budget: s.profile.profile.budget, mode: 'review', review: { workRef: s.work.ref, profile: s.profile.profile } }, assembled.envelope, { vault: s.vault, reviewer: access });
    expect(runtime.manifest.inputDigest).toBe(s.work.input!.inputDigest);
    expect(runtime.input).toContain('independent-review-result');
    expect(runtime.input).not.toContain('untrusted instruction');
    expect((await s.context.inspect(s.work.ref))?.producerSessionId).toBe('producer-session');
    expect(value(await s.context.current(s.work.ref)).reviewerSessionId).toBe('reviewer-session');
  });
  it('does not allow absent/late grants or producer-owner fallback', async () => {
    const s = await fixture();
    expect(await s.context.assemble(s.work.ref, [])).toMatchObject({ status: 'incomplete' });
    const refs = await s.authorize(); s.candidates(false);
    expect(await s.context.assemble(s.work.ref, refs)).toMatchObject({ status: 'incomplete' });
    s.candidates(true); expect(await s.context.assemble(s.work.ref, refs)).toMatchObject({ status: 'ready' });
  });
  it('allows only its precise readonly running observation, blocks other prepared work and all unknown outcomes', async () => {
    const s = await fixture(); await s.start();
    expect(await s.context.current(s.work.ref)).toMatchObject({ status: 'ready' });
    s.observations.push({ spec: { ...s.observations[0]!.spec, runId: 'writer' }, status: 'prepared' });
    expect(await s.context.current(s.work.ref)).toMatchObject({ status: 'rejected', code: 'run_unsettled' });
    s.observations.pop(); s.observations[1]!.status = 'outcome_unknown';
    expect(await s.context.current(s.work.ref)).toMatchObject({ status: 'rejected', code: 'run_unsettled' });
    s.observations[1]!.status = 'running'; s.observations[1]!.spec.mode = 'explore';
    expect(await s.context.current(s.work.ref)).toMatchObject({ status: 'rejected', code: 'scope_mismatch' });
    s.observations[1]!.spec.mode = 'review'; s.observations[1]!.status = 'completed'; s.run.status = 'ended'; s.run.outcome = 'outcome_unknown';
    expect(await s.context.current(s.work.ref)).toMatchObject({ status: 'rejected', code: 'run_unsettled' });
  });
  it('returns exact bounded original text and source citations, rejects invented refs and excluded/symlink paths', async () => {
    const s = await fixture();
    await mkdir(join(s.root, '.cache')); await writeFile(join(s.root, '.cache', 'private.txt'), 'excluded');
    await s.start();
    let offset = 0, body = '';
    do { const page = await s.context.readMaterial(s.work.ref, { ref: s.toolRef, offset, maxBytes: 7 }); body += page.content; offset = page.nextOffset; } while (offset < s.toolRef.sizeBytes);
    expect(sha256Hex(body)).toBe(s.toolRef.digest);
    await expect(s.context.readMaterial(s.work.ref, { ref: { ...s.toolRef, digest: '0'.repeat(64) }, offset: 0, maxBytes: 16 })).rejects.toMatchObject({ code: 'invalid_reference' });
    expect(await s.context.readSource(s.work.ref, { path: 'source.txt', startLine: 1, endLine: 1 })).toMatchObject({ materialId: 'source:source.txt', content: 'reviewed source' });
    await expect(s.context.readSource(s.work.ref, { path: '.cache/private.txt', startLine: 1, endLine: 1 })).rejects.toMatchObject({ code: 'invalid_reference' });
    expect(reviewerSourcePathAllowed('src/node_modules/hidden.ts')).toBe(false);
    await symlink('source.txt', join(s.root, 'linked.txt'));
    // A newly added link first changes the frozen source identity.
    await expect(s.context.readSource(s.work.ref, { path: 'linked.txt', startLine: 1, endLine: 1 })).rejects.toMatchObject({ code: 'stale' });
  });
  it('rejects a real grant revocation committed during source capture even with a stale grant projection', async () => {
    const s = await fixture(); await s.start();
    const original = s.source.capture.bind(s.source); let revoke = true;
    vi.spyOn(s.source, 'capture').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (revoke) {
        revoke = false; const grant = s.grants[0]!;
        expect(await s.control.revokeMaterialAccess({ commandId: 'context-revoke', commandType: 'RevokeMaterialAccess', schemaVersion: 1,
          identity: { projectId: s.scope.projectId, actor: { kind: 'human', id: 'operator' }, idempotencyKey: 'context-revoke' }, aggregateId: grant.ref.grantId,
          expectedRevision: 1, correlationId: 'context-revoke', submittedAt: P107_SCHEMA, payload: { grantRef: grant.ref, reason: 'revoke during source capture' } })).toMatchObject({ status: 'committed' });
      }
      return result;
    });
    await expect(s.context.readMaterial(s.work.ref, { ref: s.toolRef, offset: 0, maxBytes: 32 })).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('rejects source changes before/during/after reads while inspect preserves the historical Work', async () => {
    const s = await fixture(); await s.start();
    await mkdir(join(s.root, '.cache')); await writeFile(join(s.root, '.cache', 'tool-log'), 'ignored output');
    expect(await s.context.current(s.work.ref)).toMatchObject({ status: 'ready' });
    await writeFile(join(s.root, 'source.txt'), 'external edit\n');
    expect(await s.context.current(s.work.ref)).toMatchObject({ status: 'rejected', code: 'stale_material' });
    expect((await s.context.inspect(s.work.ref))?.work.input).toEqual(s.work.input);
  });
  it('refuses corrupted original body instead of constructing a ready packet', async () => {
    const s = await fixture(), refs = await s.authorize();
    for (const [key, row] of s.store) if (row.ref.digest === s.toolRef.digest) s.store.set(key, { ...row, body: 'corrupt' });
    expect(await s.context.assemble(s.work.ref, refs)).toMatchObject({ status: 'incomplete' });
  });
  it('rejects an oversized complete packet without truncating obligations', async () => {
    const s = await fixture();
    s.work.descriptor.requirements[0]!.description = 'required rubric '.repeat(5000);
    const { descriptorId: _id, ...body } = s.work.descriptor;
    s.work.descriptor.descriptorId = sha256Hex(json(body));
    const stored = await s.vault.put({ contentType: 'application/json', body: json(s.work.descriptor), sourceRefs: [{ kind: 'workspace', refId: s.scope.workspaceId, revision: '1' }], ownerRef: s.material.run.ref, requestedAt: P107_SCHEMA });
    if (stored.status !== 'stored') throw Error(json(stored));
    s.work.descriptorRef = stored.ref;
    const refs = await s.authorize();
    expect(await s.context.assemble(s.work.ref, refs)).toMatchObject({ status: 'incomplete', missing: [expect.stringContaining('exceeds 64 KiB')] });
    expect(s.work.input).toBeNull();
  });
  it('rechecks actual source after a Vault read rather than returning body captured across a source edit', async () => {
    const s = await fixture(); await s.start();
    const original = s.vault.open.bind(s.vault);
    vi.spyOn(s.vault, 'open').mockImplementation(async (...args) => {
      const opened = await original(...args);
      if (args[0].digest === s.toolRef.digest) await writeFile(join(s.root, 'source.txt'), 'changed during report read\n');
      return opened;
    });
    await expect(s.context.readMaterial(s.work.ref, { ref: s.toolRef, offset: 0, maxBytes: 32 })).rejects.toMatchObject({ code: 'stale' });
  });
  it('reads the canonical owner report as history after source change without allowing current admission or arbitrary producer artifacts', async () => {
    const s = await fixture(); await s.start();
    const saved = await s.vault.put({ contentType: 'application/json', body: '{"original":"Reviewer raw answer"}', ownerRef: s.run.ref, sourceRefs: s.run.envelope!.sourceRefs, requestedAt: P107_SCHEMA });
    if (saved.status !== 'stored') throw Error(json(saved));
    s.work.output = { reportRef: saved.ref, reportDigest: saved.ref.digest, runRef: s.run.ref, runRevision: 3, terminalEventId: 'review-end', terminalEventSeq: 2, observationId: 'actual-output', sessionId: 'reviewer-session', packetDigest: s.work.input!.packetDigest, inputDigest: s.work.input!.inputDigest, descriptorDigest: s.work.input!.descriptorDigest };
    s.work.revision++; s.run.status = 'ended'; s.run.outcome = 'completed'; s.run.revision++; s.observations[1]!.status = 'completed';
    const grant = s.grants[0]!;
    expect(await s.control.revokeMaterialAccess({ commandId: 'historical-revoke', commandType: 'RevokeMaterialAccess', schemaVersion: 1,
      identity: { projectId: s.scope.projectId, actor: { kind: 'human', id: 'operator' }, idempotencyKey: 'historical-revoke' }, aggregateId: grant.ref.grantId, expectedRevision: 1,
      correlationId: 'historical-revoke', submittedAt: P107_SCHEMA, payload: { grantRef: grant.ref, reason: 'Revoke current original tool material' } })).toMatchObject({ status: 'committed' });
    expect(await s.context.current(s.work.ref)).toMatchObject({ status: 'incomplete' });
    await writeFile(join(s.root, 'source.txt'), 'source advanced outside review\n');
    expect(await s.context.openHistoricalReport(s.work.ref)).toMatchObject({ status: 'ready', record: { applicability: 'historical_explanation', ownerRunRef: s.run.ref, body: '{"original":"Reviewer raw answer"}' } });
    await expect(s.context.openReport(s.work.ref)).rejects.toMatchObject({ code: 'stale' });
    s.work.output.reportRef = s.toolRef; s.work.output.reportDigest = s.toolRef.digest;
    expect(await s.context.openHistoricalReport(s.work.ref)).toMatchObject({ status: 'rejected' });
  });
});
