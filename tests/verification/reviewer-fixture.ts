import { ControlReworkDisposition } from '../../src/control/control-engine/rework-disposition.js';
import { expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { VerificationService } from '../../src/control/verification-engine/verification-service.js';
import { VerificationContextCompiler } from '../../src/data/context-compiler/verification-context.js';
import { ReviewerContextCompiler } from '../../src/data/context-compiler/reviewer-context.js';
import { ReviewerProfileCompiler } from '../../src/data/context-compiler/reviewer-profile.js';
import { CandidateWorkspaceReader } from '../../src/data/workspace-reader/candidate-workspace-reader.js';
import { VerificationWorkspaceReader } from '../../src/data/workspace-reader/verification-workspace-reader.js';
import { VerificationSourceApplicability } from '../../src/data/workspace-reader/verification-source-applicability.js';
import { createReviewControlPorts } from '../../src/control/control-engine/reviewer-work.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import { P107_PLAN_REVISION_FIXTURE_V1 } from '../contract-support/fixtures/workspace-fixtures.js';
import { buildDispatchStartCommand, buildRunFactCommand } from '../../src/contracts/commands/dispatch.js';
import { buildGrantMaterialAccessCommand, buildMaterialAccessGrantV1 } from '../../src/contracts/commands/material-access.js';
import { materialAccessGrantIdFor } from '../../src/contracts/material-access.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type { ReviewerRuntimeObservations, ReviewerPacketV1 } from '../../src/contracts/reviewer-context.js';
import type { ReviewStartInput, ReviewerSemanticReportV1 } from '../../src/contracts/reviewer-verification.js';
import type { ReviewWorkRef, ReviewWorkSnapshot } from '../../src/contracts/reviewer-work.js';
import type { VerificationRoundScope } from '../../src/contracts/verification-context.js';
import type { VerificationServiceDeps } from "../../src/control/verification-engine/verification-deps.js";
import {
  prepareP107Scenario, runP107Task, toP1_07Harness, P107_PROJECT, P107_WORKSPACE, P107_GOAL, P107_SCHEMA,
  P107_TASK_WRITER_B, P107_ROLE_BINDING_WRITER_V1, P107_BUDGET_WRITER_V1,
} from '../contract-suite/p1-07-harness.js';

export const scope: VerificationRoundScope = { projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
  goalId: P107_GOAL, taskId: P107_TASK_WRITER_B, runId: 'independent-review-producer' };
export async function reviewerFixture(roots: string[], opts: { extraToolFailure?: boolean; reviewerKinds?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'independent-review-source-')); roots.push(root);
  const directory = await mkdtemp(join(tmpdir(), 'independent-review-journal-')); roots.push(directory);
  await writeFile(join(root, 'source.txt'), 'first source line\nsecond source line\n');
  const source = new VerificationSourceApplicability(() => root);
  const h = createInMemoryHarness({ sourceApplicability: source, deps: { clock: () => P107_SCHEMA } });
  const p107 = toP1_07Harness(h), draft = structuredClone(P107_PLAN_REVISION_FIXTURE_V1);
  draft.obligations.push({ obligationId: 'independent-review', title: 'Independent exact review', requirementLevel: 'required', taskIds: [scope.taskId],
    verificationRequirements: [{ requirementId: 'tool', kind: 'dynamic', requirementLevel: 'required', description: 'Execute configured check' },
      ...Array.from({ length: opts.reviewerKinds ?? 2 }, (_, index) => ({ requirementId: 'review-' + index,
        kind: 'reviewer', requirementLevel: 'required' as const, description: 'Review source requirement ' + index }))] });
  await prepareP107Scenario(p107, draft);
  await runP107Task(p107, { taskId: scope.taskId, runId: scope.runId, attemptId: 'producer-attempt',
    roleBinding: P107_ROLE_BINDING_WRITER_V1, declaredPermissions: { tools: ['read', 'write'], writeScope: ['*'] }, budget: P107_BUDGET_WRITER_V1 });
  const observations: ReturnType<ReviewerRuntimeObservations['all']> = [{ spec: { ...scope,
    budget: { ...DEFAULT_RUNTIME_BUDGET, contextWindowTokens: P107_BUDGET_WRITER_V1.tokenBudget } },
    status: 'completed', sessionId: 'producer-session' }];
  const observationPort = { all: () => structuredClone(observations) };
  let modelRevision = 'model-1';
  const profiles = new ReviewerProfileCompiler({ ledger: h.ledger, observations: observationPort,
    modelMetadata: { current: async () => ({ configurationRevision: modelRevision, provider: 'fixture', model: 'reviewer', baseUrl: 'http://localhost:1' }) } });
  const context = new VerificationContextCompiler({ ledger: h.ledger, vault: h.vault, runtime: observationPort,
    rootFor: () => root, workspaceSource: new CandidateWorkspaceReader(), roundSource: new VerificationWorkspaceReader() });
  const reviewContext = new ReviewerContextCompiler({ ledger: h.ledger, vault: h.vault, roundContext: context,
    profiles, source, observations: observationPort });
  const control = createReviewControlPorts({ ledger: h.ledger, now: () => P107_SCHEMA, eventId: () => 'review-' + randomUUID() });
  const deps: VerificationServiceDeps = { directory, disposition: new ControlReworkDisposition(h.ledger as never), context, vault: h.vault, control: h.control, workspaceLease: h.workspaceLease,
    candidatePatchCheck: { check: async () => { throw Error('not a candidate-patch test'); } },
    review: { context: reviewContext, profiles, control: control.lifecycle } };
  const reopen = async () => { const service = new VerificationService(deps); await service.init(); return service; };
  const service = await reopen();
  const round = await service.startRound(scope, { requestId: 'tools', allowExecute: true, configuration: { checks: [
    { checkId: 'dynamic', kind: 'dynamic', command: 'mkdir -p .cache; printf x >> .cache/tool-count', cwd: '.', timeoutMs: 3000,
      appliesTo: { workspaceId: scope.workspaceId, taskIds: [scope.taskId] } },
    ...(opts.extraToolFailure ? [{ checkId: 'extra-static', kind: 'static' as const, command: 'exit 1', cwd: '.', timeoutMs: 3000,
      appliesTo: { workspaceId: scope.workspaceId, taskIds: [scope.taskId] } }] : []),
  ] } });
  expect(round.round.status, JSON.stringify(round.round.gaps)).toBe('completed');
  const profile = await profiles.current(scope); expect(profile.status, JSON.stringify(profile)).toBe('ready');
  if (profile.status !== 'ready') throw Error('profile unavailable');
  const input: ReviewStartInput = { requestId: 'review-request', roundRequestId: 'tools', allowExecute: true, reviewerConfigRef: profile.ref };
  const work = async (ref: ReviewWorkRef) => {
    const loaded = await h.ledger.load(ref);
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'ReviewWork') throw Error('Work missing');
    return loaded.snapshot as ReviewWorkSnapshot;
  };
  const identity = (id: string) => ({ projectId: scope.projectId, actor: { kind: 'system' as const, id: 'review-test-dispatch' },
    commandId: id, idempotencyKey: id, correlationId: input.requestId, submittedAt: P107_SCHEMA });
  const begin = async (ref: ReviewWorkRef) => {
    const selected = await reviewContext.select(ref); expect(selected.status, JSON.stringify(selected)).toBe('ready');
    if (selected.status !== 'ready') throw Error('materials unavailable');
    const currentWork = selected.work;
    const grantId = materialAccessGrantIdFor(currentWork.reviewerRunRef, selected.materials, selected.basis);
    const grant = buildMaterialAccessGrantV1({ grantId, scope: { projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: scope.goalId },
      materials: selected.materials, reader: currentWork.reviewerRunRef, issuedBy: { aggregateType: 'Control', projectId: scope.projectId, goalId: scope.goalId },
      purpose: 'Read exact original reports for independent verification', basis: selected.basis, grantedAt: P107_SCHEMA });
    const granted = await h.grantMaterialAccess(buildGrantMaterialAccessCommand(grant, { commandId: grantId, projectId: scope.projectId,
      actorKind: 'system', actorId: 'review-test-dispatch', idempotencyKey: grantId, correlationId: input.requestId, submittedAt: P107_SCHEMA }));
    expect(granted.status, JSON.stringify(granted)).toBe('committed');
    if (granted.status !== 'committed') throw Error('grant unavailable');
    const assembled = await reviewContext.assemble(ref, [granted.grantRef]);
    expect(assembled.status, JSON.stringify(assembled)).toBe('ready');
    if (assembled.status !== 'ready') throw Error('packet unavailable');
    const receipt = await h.control.startRun(buildDispatchStartCommand({ ...identity('start-' + ref.reviewId), runId: currentWork.reviewerRunRef.runId,
      expectedRevision: 1, envelope: assembled.envelope, manifest: assembled.manifest }));
    expect(receipt.status, JSON.stringify(receipt)).toBe('committed');
    observations.push({ spec: { ...scope, runId: currentWork.reviewerRunRef.runId, mode: 'review',
      review: { workRef: ref, profile: currentWork.reviewerProfile }, budget: currentWork.reviewerProfile.budget }, status: 'running', sessionId: 'reviewer-session' });
    return { packet: assembled.packet, grantRef: granted.grantRef };
  };
  const report = async (ref: ReviewWorkRef, packet: ReviewerPacketV1, results: Array<'PASS' | 'FAIL' | 'INCONCLUSIVE'> = ['PASS', 'PASS']): Promise<ReviewerSemanticReportV1> => {
    const item = await work(ref), sourcePage = await reviewContext.readSource(ref, { path: 'source.txt', startLine: 1, endLine: 1 });
    const aggregate = packet.materials.find(m => m.kind === 'tool-aggregate')!;
    return { schemaVersion: 1, kind: 'independent-review-result', reviewId: ref.reviewId, descriptorDigest: item.descriptorRef.digest,
      packetDigest: item.input!.packetDigest, sourceDigest: packet.materialIdentity.sourceDigest,
      citations: [{ citationId: 'source', materialId: sourcePage.materialId, digest: sourcePage.digest,
        location: { kind: 'source-lines', path: 'source.txt', startLine: 1, endLine: 1 } },
      { citationId: 'tools', materialId: aggregate.materialId, digest: aggregate.ref.digest, location: { kind: 'artifact-section', pointer: '/reports/0/result' } }],
      requirements: packet.coverage.map((c, index) => ({ obligationId: c.obligationId, requirementId: c.requirementId,
        result: results[index] ?? 'PASS', rationale: 'Compared the exact source line with the task requirement and original tool report.',
        citationIds: ['source', 'tools'], issueIds: results[index] === 'FAIL' ? ['issue-' + index] : [],
        unknowns: results[index] === 'INCONCLUSIVE' ? ['The supplied source does not establish the required behavior.'] : [] })),
      issues: packet.coverage.flatMap((c, index) => results[index] === 'FAIL' ? [{ issueId: 'issue-' + index,
        coverage: [{ obligationId: c.obligationId, requirementId: c.requirementId }], description: 'This requirement is contradicted by the source.',
        impact: 'The requested behavior is not met.', citationIds: ['source'] }] : []),
    };
  };
  const complete = async (ref: ReviewWorkRef, body: unknown) => {
    let item = await work(ref);
    for (const sequence of [1, 2]) {
      const current = await reviewContext.inspect(ref); if (!current) throw Error('run missing');
      const event = sequence === 1
        ? { schemaVersion: 1 as const, eventId: ref.reviewId + '-started', runRef: item.reviewerRunRef, sequence, occurredAt: P107_SCHEMA,
          eventType: 'run_started' as const, payload: { kind: 'started' as const, startedAt: P107_SCHEMA } }
        : { schemaVersion: 1 as const, eventId: ref.reviewId + '-completed', runRef: item.reviewerRunRef, sequence, occurredAt: P107_SCHEMA,
          eventType: 'run_completed' as const, payload: { kind: 'completed' as const, exitCode: 0 } };
      const receipt = await h.control.runFact(buildRunFactCommand({ ...identity('fact-' + ref.reviewId + '-' + sequence),
        runId: item.reviewerRunRef.runId, expectedRevision: current.run.revision, fact: { kind: 'runtime_event', event } }));
      expect(receipt.status, JSON.stringify(receipt)).toBe('committed');
    }
    observations.find(row => row.spec.runId === item.reviewerRunRef.runId)!.status = 'completed';
    item = await work(ref);
    const stored = await h.vault.put({ body: typeof body === 'string' ? body : canonicalJson(body as never), contentType: 'application/json',
      ownerRef: item.reviewerRunRef, sourceRefs: [item.input!.packetRef.source], requestedAt: P107_SCHEMA });
    expect(stored.status).toBe('stored'); if (stored.status !== 'stored') throw Error('raw report unavailable');
    const current = await reviewContext.inspect(ref); if (!current) throw Error('run missing');
    const bound = await control.dispatch.bindOutput({ identity: { projectId: scope.projectId, actor: { kind: 'system', id: 'review-test-dispatch' }, idempotencyKey: 'output-' + ref.reviewId },
      workRef: ref, expectedWorkRevision: item.revision, output: { reportRef: stored.ref, reportDigest: stored.ref.digest,
        runRef: item.reviewerRunRef, runRevision: current.run.revision, terminalEventId: current.run.lastRuntimeEventId,
        terminalEventSeq: current.run.lastEventSeq, observationId: 'original-observation', sessionId: 'reviewer-session',
        packetDigest: item.input!.packetDigest, inputDigest: item.input!.inputDigest, descriptorDigest: item.input!.descriptorDigest } });
    expect(bound.status, JSON.stringify(bound)).toBe('accepted');
    return stored.ref;
  };
  return { root, directory, h, deps, service, reopen, source, context, reviewContext, profiles, observations,
    control, input, round: round.round, begin, report, complete, work, changeModel: () => { modelRevision = 'model-2'; } };
}
