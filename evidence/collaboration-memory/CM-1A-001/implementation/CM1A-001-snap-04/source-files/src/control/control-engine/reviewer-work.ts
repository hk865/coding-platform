import { qualifyProjectedReviewEvidence } from './policies/reviewer-evidence.js';
import { INDEPENDENT_REVIEWER_ROLE } from '../../contracts/reviewer-context.js';
import type { AggregateRef, AggregateSnapshot, ExpectedVersion, GoalSnapshot, ReviewLedgerCommitV1, StateLedger } from '../../contracts/ledger.js';
import type { CommandIdentity } from '../../contracts/command-event.js';
import type { DispatchIntentV1, DispatchOutboxEntrySnapshot, RunSnapshot, TaskAttemptSnapshot, TaskLeaseSnapshot } from '../../contracts/dispatch.js';
import { dispatchOutboxRefFor, runRefFor, taskAttemptRefFor, taskLeaseRefFor } from '../../contracts/dispatch.js';
import type { EvidenceSnapshot, EvidenceV1, TaskEvidenceIndexSnapshot } from '../../contracts/evidence.js';
import { evidenceRefFor, requirementKeyOf, taskEvidenceIndexRefFor } from '../../contracts/evidence.js';
import type { MaterialAccessGrantSnapshot } from '../../contracts/material-access.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { BindReviewOutputCommand, ReplaceFailedReviewWorkCommand, ReviewCommandReceipt, ReviewDispatchControlPort, ReviewLifecycleControlPort, ReviewOutputBinding, ReviewResultSnapshot, ReviewWorkSnapshot, TaskReviewProtocolRef, TaskReviewProtocolSnapshot, ValidatedReviewMaterialCommand, ValidatedReviewResultCommand } from '../../contracts/reviewer-work.js';
import { reviewCommandFingerprint, reviewWorkRefFor } from '../../contracts/reviewer-work.js';
import type { ReviewMaterialDescriptorV1 } from '../../contracts/reviewer-verification.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import { buildCurrentEffectivityAnchor } from './task-reducer.js';
import { evidenceApplicability, selectEffectiveEvidenceSet } from './policies/evidence.js';
import { buildEvidenceIntakeLedgerCommit } from './records/evidence.js';
import type { ControlEngineDeps } from './control-engine.js';

const same = (a: unknown, b: unknown) => a === undefined || b === undefined ? a === b : canonicalJson(a as never) === canonicalJson(b as never);
const digest = (value: unknown) => sha256Hex(canonicalJson(value as never));
const reject = (code: string, issues?: string[]): ReviewCommandReceipt => ({ status: 'rejected', code, ...(issues ? { issues } : {}) });
const receipt = (work: ReviewWorkSnapshot, replayed = false): ReviewCommandReceipt => ({ status: replayed ? 'replayed' : 'accepted', workRef: work.ref, workRevision: work.revision, resultRef: work.resultRef });
export const taskReviewProtocolRefFor = (subject: { projectId: string; goalId: string; taskId: string }, planId: string): TaskReviewProtocolRef => ({ aggregateType: 'TaskReviewProtocol', projectId: subject.projectId, goalId: subject.goalId, taskId: subject.taskId, planId });
export function reviewerCoverage(plan: PlanRevisionSnapshot, taskId: string, requiredOnly = true) {
  return plan.obligations.filter(o => o.taskIds.includes(taskId) && (!requiredOnly || o.requirementLevel === 'required')).flatMap(o => o.verificationRequirements.filter(v => v.kind === 'reviewer' && (!requiredOnly || v.requirementLevel === 'required')).map(v => ({ obligationId: o.obligationId, requirementId: v.requirementId })));
}
export async function hasIndependentReviewProtocol(ledger: Pick<StateLedger, 'load'>, plan: PlanRevisionSnapshot, subject: { projectId: string; goalId: string; taskId: string }) {
  return plan.reviewAdmissionProtocol === 'independent-review-v1' || (await ledger.load(taskReviewProtocolRefFor(subject, plan.planId))).status === 'found';
}

class Reads {
  readonly versions: ExpectedVersion[] = [];
  constructor(readonly ledger: StateLedger) {}
  async load<T extends AggregateSnapshot>(ref: AggregateRef): Promise<T | null> {
    const result = await this.ledger.load(ref);
    const snapshot = result.status === 'found' ? result.snapshot : null;
    if (!this.versions.some(v => same(v.ref, ref))) this.versions.push({ ref, revision: snapshot?.revision ?? 0 });
    return snapshot as T | null;
  }
}

/** Capture the first observed revision, including absent protocol @0. Reducer
 * commits can then reject concurrent adoption or qualification changes. */
export function withReviewReadVersions(ledger: StateLedger, versions: ExpectedVersion[]): StateLedger {
  return {
    async load(ref) {
      const result = await ledger.load(ref);
      if (!versions.some(v => same(v.ref, ref))) versions.push({ ref, revision: result.status === 'found' ? result.snapshot.revision : 0 });
      return result;
    },
    commit: batch => ledger.commit(batch),
    events: query => ledger.events(query),
    pendingDispatchIntents: (limit, selection) => ledger.pendingDispatchIntents(limit, selection),
  };
}

/** Revalidate all canonical material identities after any external I/O. Source
 * and actual Vault reads remain the trusted Context/Verification boundary. */
async function current(reads: Reads, descriptor: ReviewMaterialDescriptorV1) {
  const scope = descriptor.subject.scope, identity = descriptor.materialIdentity;
  const goal = await reads.load<GoalSnapshot>({ aggregateType: 'Goal', projectId: scope.projectId, goalId: scope.goalId });
  const plan = await reads.load<PlanRevisionSnapshot>(identity.planRef);
  const workspace = await reads.load({ aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId });
  const producer = await reads.load<RunSnapshot>(descriptor.subject.producerRunRef);
  const attempt = await reads.load<TaskAttemptSnapshot>(descriptor.subject.producerAttemptRef);
  const lease = await reads.load<TaskLeaseSnapshot>(taskLeaseRefFor(scope.projectId, scope.goalId, scope.taskId));
  if (!goal || !plan || !workspace || !producer || !attempt || !lease) throw Error('not_found');
  const task = plan.tasks.find(t => t.taskId === scope.taskId);
  if (!task || task.taskKind !== 'work' || task.disposition !== 'active' || !same(goal.workspaceRef, workspace.ref) || !same(goal.activePlanRevision, plan.ref) || !same(plan.goalRef, goal.ref) || goal.desiredState !== 'active') throw Error('stale_material');
  if (!same(identity.scope, scope) || !same(identity.runRef, producer.ref) || !same(producer.task, { projectId: scope.projectId, goalId: scope.goalId, taskId: scope.taskId }) || !same(producer.planRef, plan.ref) || producer.ref.runId !== scope.runId || producer.work || producer.status !== 'ended' || producer.outcome !== 'completed' || producer.exitCode !== 0 || !producer.envelope) throw Error('producer_ineligible');
  if (lease.holderRunId !== producer.ref.runId || lease.attemptId !== producer.attemptId || attempt.ref.attemptId !== producer.attemptId || attempt.runId !== producer.ref.runId || attempt.status !== 'ended' || !same(attempt.ref, producer.envelope.attemptRef)) throw Error('producer_ineligible');
  if (identity.runRevision !== producer.revision || identity.runDigest !== digest(producer) || identity.goalRevision !== goal.revision || identity.goalDigest !== digest(goal) || identity.planRevision !== plan.planRevision || identity.planDigest !== digest(plan) || identity.taskDigest !== digest(task) || identity.workspaceRevision !== workspace.revision || identity.workspaceDigest !== digest(workspace) || !same(identity.policyPin, plan.effectiveCompletionPolicy) || !same(identity.baselinePin, plan.effectiveArchitectureBaseline)) throw Error('stale_material');
  const index = await reads.load<TaskEvidenceIndexSnapshot>(taskEvidenceIndexRefFor(scope.projectId, scope.goalId, scope.taskId));
  const evidence: EvidenceV1[] = [];
  for (const id of index?.evidenceIds ?? []) {
    const record = await reads.load<EvidenceSnapshot>(evidenceRefFor(scope.projectId, id));
    if (!record) throw Error('material_unavailable');
    evidence.push(record.evidence);
  }
  return { goal, plan, workspace, producer, index, evidence, task };
}

function eventBase(deps: ControlEngineDeps, identity: CommandIdentity, work: ReviewWorkSnapshot) {
  return { eventId: deps.eventId(), schemaVersion: 1 as const, projectId: work.ref.projectId, workspaceId: work.ref.workspaceId, aggregateId: work.ref.reviewId, aggregateRevision: work.revision, causationId: identity.idempotencyKey, correlationId: work.requestId, idempotencyKey: identity.idempotencyKey, actor: identity.actor, occurredAt: deps.now() };
}
function validIdentity(identity: CommandIdentity) { return !!identity && !!identity.projectId && !!identity.idempotencyKey && !!identity.actor?.id && ['human', 'system'].includes(identity.actor.kind); }

async function createWork(deps: ControlEngineDeps, command: ValidatedReviewMaterialCommand): Promise<ReviewCommandReceipt> {
  try {
    const d = command.descriptor, profile = command.reviewerProfile;
    if (!validIdentity(command.identity) || !command.requestId || d?.schemaVersion !== 1 || d.kind !== 'independent-review-material' || !d.subject?.scope || command.identity.projectId !== d.subject.scope.projectId || Buffer.byteLength(canonicalJson(d)) > 192 * 1024 || !d.tools.length || d.tools.some(t => t.result !== 'PASS') || command.descriptorRef.digest !== digest(d)) return reject('invalid');
    const { descriptorId, ...descriptorBody } = d;
    if (descriptorId !== digest(descriptorBody)) return reject('invalid_descriptor');
    const ref = reviewWorkRefFor(d.subject.scope, command.requestId), fingerprint = reviewCommandFingerprint('review-work-create', command);
    const reads = new Reads(deps.ledger), existing = await reads.load<ReviewWorkSnapshot>(ref);
    if (existing) return existing.requestFingerprint === fingerprint ? receipt(existing, true) : reject('idempotency_conflict');
    const { plan, workspace, producer, evidence } = await current(reads, d);
    const scope = d.subject.scope, subject = { projectId: scope.projectId, goalId: scope.goalId, taskId: scope.taskId };
    const expected = reviewerCoverage(plan, scope.taskId), actual = d.requiredReviewerCoverage;
    if (!expected.length || !same([...expected].sort((a,b) => requirementKeyOf(a).localeCompare(requirementKeyOf(b))), [...actual].sort((a,b) => requirementKeyOf(a).localeCompare(requirementKeyOf(b)))) || new Set(actual.map(requirementKeyOf)).size !== actual.length) return reject('coverage_mismatch');
    if (profile.schemaVersion !== 1 || profile.mode !== 'review' || !same(profile.subjectScope, scope) || !same(profile.permissions, { tools: ['read'], writeScope: [] }) || !same(profile.roleBinding, INDEPENDENT_REVIEWER_ROLE) || !profile.model.configurationRevision || !same(command.reviewerConfigRef, { configId: profile.profileId, revision: profile.revision, digest: profile.digest })) return reject('invalid_profile');
    const { digest: _profileDigest, profileId: _profileId, revision: _profileRevision, ...profileBody } = profile;
    if (profile.digest !== digest(profileBody)) return reject('invalid_profile');
    const anchor = buildCurrentEffectivityAnchor({ plan, workspaceRevision: workspace.revision });
    const effective = selectEffectiveEvidenceSet(evidence, plan, anchor);
    if (Object.keys(effective.blockingByRequirement).length) return reject('rework_required');
    // Historical unhandled reviewer negatives remain blocking on adoption.
    const reviewerKeys = new Set(expected.map(requirementKeyOf));
    if (evidence.some(e => e.kind !== 'claim' && e.outcome !== 'PASS' && evidenceApplicability(e, plan, anchor) === 'APPLICABLE' && e.coverage.some(c => reviewerKeys.has(requirementKeyOf(c))))) return reject('rework_required');
    const requiredTools = plan.obligations.filter(o => o.taskIds.includes(scope.taskId) && o.requirementLevel === 'required').flatMap(o => o.verificationRequirements.filter(v => v.requirementLevel === 'required' && v.kind !== 'reviewer').map(v => ({ obligationId: o.obligationId, requirementId: v.requirementId })));
    for (const required of requiredTools) {
      const tool = d.toolEvidence.find(t => t.coverage.some(c => requirementKeyOf(c) === requirementKeyOf(required)));
      const e = tool ? evidence.find(e => e.evidenceId === tool.evidenceRef.evidenceId) : null;
      if (!e || e.kind !== 'observation' || e.outcome !== 'PASS' || evidenceApplicability(e, plan, anchor) !== 'APPLICABLE' || !same(e.verificationPlanRef, d.toolRound.verificationPlanRef) || !same(e.summary.artifactRef, d.toolRound.aggregateRef) || !e.coverage.some(c => requirementKeyOf(c) === requirementKeyOf(required))) return reject('tool_coverage_incomplete');
    }
    const protocolRef = taskReviewProtocolRefFor(subject, plan.planId), protocol = await reads.load<TaskReviewProtocolSnapshot>(protocolRef);
    if (protocol) return reject('review_already_exists'); // No unauthorized re-draw of this task/plan.
    const reviewerRunRef = runRefFor(scope.projectId, scope.goalId, ref.reviewId + '-run'), reviewerAttemptRef = taskAttemptRefFor(scope.projectId, scope.goalId, scope.taskId, ref.reviewId + '-attempt');
    const outboxRef = dispatchOutboxRefFor(scope.projectId, scope.goalId, scope.taskId, reviewerAttemptRef.attemptId);
    const work: ReviewWorkSnapshot = { ref, schemaVersion: 1, revision: 1, protocol: 'independent-review-v1', protocolRef, requestId: command.requestId, requestFingerprint: fingerprint, subject, planRef: plan.ref, producerRunRef: producer.ref, producerAttemptRef: d.subject.producerAttemptRef, descriptor: structuredClone(d), descriptorRef: command.descriptorRef, reviewerConfigRef: command.reviewerConfigRef, reviewerConfigDigest: profile.digest, reviewerProfile: structuredClone(profile), reviewerRunRef, reviewerAttemptRef, outboxRef, roleBinding: profile.roleBinding, input: null, output: null, resultRef: null };
    const binding = { kind: 'review' as const, reviewWorkRef: ref }, at = deps.now(), budget = { tokenBudget: profile.budget.contextWindowTokens, deadline: null };
    const run: RunSnapshot = { ref: reviewerRunRef, revision: 1, schemaVersion: 1, work: binding, task: subject, attemptId: reviewerAttemptRef.attemptId, planRef: plan.ref, roleBinding: profile.roleBinding, budget, workspaceSnapshot: { workspaceId: scope.workspaceId, revision: workspace.revision }, status: 'starting', outcome: null, exitCode: null, lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '', envelope: null, startedAt: null, endedAt: null };
    const attempt: TaskAttemptSnapshot = { ref: reviewerAttemptRef, revision: 1, schemaVersion: 1, work: binding, runId: reviewerRunRef.runId, planRef: plan.ref, status: 'claimed', startedAt: null, endedAt: null, endOutcome: null };
    const intent: DispatchIntentV1 = { schemaVersion: 1, work: binding, intentId: reviewerAttemptRef.attemptId, ...subject, workspaceId: scope.workspaceId, planRef: plan.ref, attemptRef: reviewerAttemptRef, runRef: reviewerRunRef, roleBinding: profile.roleBinding, workspaceSnapshot: run.workspaceSnapshot, declaredPermissions: { tools: ['read'], writeScope: [] }, budget, requestedAt: at, correlationId: command.requestId };
    const outbox: DispatchOutboxEntrySnapshot = { ref: outboxRef, revision: 1, schemaVersion: 1, status: 'pending', intent, pendingAt: at, startedAt: null, doneAt: null };
    const adopted: TaskReviewProtocolSnapshot = { ref: protocolRef, revision: 1, schemaVersion: 1, protocol: work.protocol, planRef: plan.ref, firstWorkRef: ref, workRefs: [ref], adoptedAt: at };
    const batch: ReviewLedgerCommitV1 = { commitKind: 'review-work-create', schemaVersion: 1, identity: command.identity, fingerprint, expectedVersions: [...reads.versions, ...[run, attempt, outbox].map(s => ({ ref: s.ref, revision: 0 }))], snapshots: [work, run, attempt, outbox, adopted], events: [{ ...eventBase(deps, command.identity, work), eventType: 'ReviewWorkCreated', aggregateType: 'ReviewWork', payload: { work, run, attempt, outbox } }, { ...eventBase(deps, command.identity, work), eventType: 'TaskReviewProtocolAdopted', aggregateType: 'TaskReviewProtocol', payload: { protocol: adopted } }], outboxIntents: [intent] };
    const result = await deps.ledger.commit(batch);
    return result.status === 'committed' ? receipt(work, result.replayed) : reject(result.code);
  } catch (error) { return reject(error instanceof Error ? error.message : 'invalid'); }
}

async function replaceFailedWork(deps: ControlEngineDeps, command: ReplaceFailedReviewWorkCommand): Promise<ReviewCommandReceipt> {
  try {
    if (!validIdentity(command.identity) || command.identity.actor.kind !== 'human' || !command.requestId
        || command.proof?.schemaVersion !== 1 || command.proof.runtimeStatus !== 'failed'
        || command.proof.modelStarted !== false || command.proof.toolStarted !== false
        || command.proof.traceCount !== 0 || command.proof.usageCount !== 0
        || !same(command.proof.eventTypes, ['run_crashed'])) return reject('replacement_not_authorized');
    const reads = new Reads(deps.ledger);
    if (command.identity.projectId !== command.previousWorkRef.projectId) return reject('replacement_not_authorized');
    const ref = reviewWorkRefFor(command.previousWorkRef, command.requestId), fingerprint = reviewCommandFingerprint('review-work-replace', command);
    const existing = await reads.load<ReviewWorkSnapshot>(ref);
    // A committed replacement survives protocol advancement and source changes.
    // Replay its exact durable identity before rechecking first-admission CAS.
    if (existing) return existing.requestFingerprint === fingerprint ? receipt(existing, true) : reject('idempotency_conflict');
    const previous = await reads.load<ReviewWorkSnapshot>(command.previousWorkRef);
    if (!previous || previous.revision !== command.expectedWorkRevision || previous.output || previous.resultRef) return reject('replacement_ineligible');
    const oldRun = await reads.load<RunSnapshot>(previous.reviewerRunRef), protocol = await reads.load<TaskReviewProtocolSnapshot>(previous.protocolRef);
    // A `run_crashed` terminal event folds to the canonical Run outcome
    // `crashed` (contracts/dispatch.ts runtimeEventTerminalOutcome), never to
    // `failed`; requiring `failed` here made this authorized-replacement path
    // unreachable for every pre-start failure. The proof above still pins the
    // exact terminal event type and the zero model/tool side-effect claims.
    if (!oldRun || !protocol || protocol.revision !== command.expectedProtocolRevision || oldRun.status !== 'ended'
        || oldRun.outcome !== 'crashed' || oldRun.exitCode !== null || oldRun.lastEventSeq !== command.proof.terminalEventSeq
        || oldRun.lastRuntimeEventId !== command.proof.terminalEventId || !same(command.proof.workRef, previous.ref)
        || !same(command.proof.runRef, oldRun.ref) || !command.proof.observationId || command.proof.terminalEventSeq !== 1
        || !same(oldRun.work, { kind: 'review', reviewWorkRef: previous.ref }) || !same(oldRun.task, previous.subject)
        || oldRun.attemptId !== previous.reviewerAttemptRef.attemptId || !same(oldRun.roleBinding, previous.roleBinding)
        || !same(oldRun.envelope?.reviewInput, previous.input) || !same(oldRun.envelope?.permissions.tools, ['read'])
        || oldRun.envelope?.permissions.writeScope.length !== 0) return reject('replacement_evidence_insufficient');
    const history = protocol.workRefs ?? [protocol.firstWorkRef];
    if (!history.some(ref => same(ref, previous.ref)) || !same(history.at(-1), previous.ref)) return reject('replacement_not_current');
    if (same(ref, previous.ref)) return reject('replacement_request_conflict');
    await current(reads, previous.descriptor);
    const reviewerRunRef = runRefFor(ref.projectId, ref.goalId, ref.reviewId + '-run');
    const reviewerAttemptRef = taskAttemptRefFor(ref.projectId, ref.goalId, previous.subject.taskId, ref.reviewId + '-attempt');
    const outboxRef = dispatchOutboxRefFor(ref.projectId, ref.goalId, previous.subject.taskId, reviewerAttemptRef.attemptId);
    const binding = { kind: 'review' as const, reviewWorkRef: ref };
    const work: ReviewWorkSnapshot = { ...structuredClone(previous), ref, revision: 1, requestId: command.requestId,
      requestFingerprint: fingerprint, reviewerRunRef, reviewerAttemptRef, outboxRef, input: null, output: null, resultRef: null };
    const budget = { tokenBudget: work.reviewerProfile.budget.contextWindowTokens, deadline: null }, at = deps.now();
    const run: RunSnapshot = { ref: reviewerRunRef, revision: 1, schemaVersion: 1, work: binding, task: work.subject,
      attemptId: reviewerAttemptRef.attemptId, planRef: work.planRef, roleBinding: work.roleBinding, budget,
      workspaceSnapshot: oldRun.workspaceSnapshot, status: 'starting', outcome: null, exitCode: null, lastEventSeq: 0,
      lastRuntimeEventId: '', lastFactEventId: '', envelope: null, startedAt: null, endedAt: null };
    const attempt: TaskAttemptSnapshot = { ref: reviewerAttemptRef, revision: 1, schemaVersion: 1, work: binding,
      runId: reviewerRunRef.runId, planRef: work.planRef, status: 'claimed', startedAt: null, endedAt: null, endOutcome: null };
    const intent: DispatchIntentV1 = { schemaVersion: 1, work: binding, intentId: reviewerAttemptRef.attemptId,
      ...work.subject, workspaceId: work.ref.workspaceId, planRef: work.planRef, attemptRef: reviewerAttemptRef, runRef: reviewerRunRef,
      roleBinding: work.roleBinding, workspaceSnapshot: run.workspaceSnapshot, declaredPermissions: { tools: ['read'], writeScope: [] },
      budget, requestedAt: at, correlationId: command.requestId };
    const outbox: DispatchOutboxEntrySnapshot = { ref: outboxRef, revision: 1, schemaVersion: 1, status: 'pending', intent,
      pendingAt: at, startedAt: null, doneAt: null };
    const updatedProtocol: TaskReviewProtocolSnapshot = { ...protocol, revision: protocol.revision + 1, workRefs: [...history, ref] };
    const batch: ReviewLedgerCommitV1 = { commitKind: 'review-work-replace', schemaVersion: 1, identity: command.identity, fingerprint,
      expectedVersions: [...reads.versions, ...[run, attempt, outbox].map(s => ({ ref: s.ref, revision: 0 }))],
      snapshots: [work, run, attempt, outbox, updatedProtocol], events: [{ ...eventBase(deps, command.identity, work),
        eventType: 'FailedReviewWorkReplaced', aggregateType: 'ReviewWork', payload: { work, previousWorkRef: previous.ref,
          protocol: updatedProtocol, run, attempt, outbox } }], outboxIntents: [intent] };
    const result = await deps.ledger.commit(batch);
    return result.status === 'committed' ? receipt(work, result.replayed) : reject(result.code);
  } catch (error) { return reject(error instanceof Error ? error.message : 'invalid'); }
}

async function validateWork(reads: Reads, work: ReviewWorkSnapshot) {
  const facts = await current(reads, work.descriptor);
  const protocol = await reads.load<TaskReviewProtocolSnapshot>(work.protocolRef);
  const run = await reads.load<RunSnapshot>(work.reviewerRunRef), attempt = await reads.load<TaskAttemptSnapshot>(work.reviewerAttemptRef);
  const outbox = await reads.load<DispatchOutboxEntrySnapshot>(work.outboxRef);
  const binding = { kind: 'review', reviewWorkRef: work.ref };
  if (!protocol || !(protocol.workRefs ?? [protocol.firstWorkRef]).some(ref => same(ref, work.ref)) || !same(protocol.planRef, work.planRef) || !run || !attempt || !outbox || !same(run.work, binding) || !same(attempt.work, binding) || !same(outbox.intent.work, binding) || !same(run.roleBinding, work.roleBinding) || !same(run.ref, outbox.intent.runRef) || !same(run.ref, work.reviewerRunRef) || run.attemptId !== attempt.ref.attemptId || !same(run.planRef, work.planRef) || !same(run.envelope?.permissions.tools, ['read']) || run.envelope?.permissions.writeScope.length !== 0 || !same(run.envelope?.reviewInput, work.input)) throw Error('invalid_review_run');
  for (const ref of work.input?.grantRefs ?? []) {
    const grant = await reads.load<MaterialAccessGrantSnapshot>(ref);
    if (!grant || grant.revocation || !same(grant.grant.reader, run.ref) || grant.grant.history || grant.grant.basis.workspaceRevision !== facts.workspace.revision || !same(grant.grant.basis.planRef, work.planRef) || grant.grant.basis.sourceDigest !== work.descriptor.materialIdentity.sourceDigest) throw Error('stale_grant');
  }
  return { ...facts, run };
}
function validOutput(work: ReviewWorkSnapshot, run: RunSnapshot, output: ReviewOutputBinding) {
  return !!work.input && run.status === 'ended' && run.outcome === 'completed' && run.exitCode === 0 && same(output.runRef, run.ref) && output.runRevision === run.revision && output.terminalEventId === run.lastRuntimeEventId && output.terminalEventSeq === run.lastEventSeq && !!output.observationId && !!output.sessionId && output.reportDigest === output.reportRef.digest && output.packetDigest === work.input.packetDigest && output.inputDigest === work.input.inputDigest && output.descriptorDigest === work.input.descriptorDigest;
}
async function bindOutput(deps: ControlEngineDeps, command: BindReviewOutputCommand): Promise<ReviewCommandReceipt> {
  try {
    const reads = new Reads(deps.ledger), work = await reads.load<ReviewWorkSnapshot>(command.workRef);
    if (!work || !validIdentity(command.identity) || command.identity.projectId !== work.ref.projectId) return reject('not_found');
    if (work.output) {
      // Replay checks the recorded transition identity and full fingerprint,
      // including the original CAS. Equal output under a new key is no replay.
      let cursor: import('../../contracts/command-event.js').CommitCursor | null = null;
      for (;;) {
        const page = await deps.ledger.events({ afterCursor: cursor, limit: 256 });
        const event = page.events.map(e => e.event).find(e => e.eventType === 'ReviewOutputBound' && same(e.payload.work.ref, work.ref));
        if (event?.eventType === 'ReviewOutputBound') return event.payload.commandFingerprint === reviewCommandFingerprint('review-output-bind', command) ? receipt(work, true) : reject('idempotency_conflict');
        if (!page.hasMore) return reject('output_binding_unavailable');
        cursor = page.throughCursor;
      }
    }
    if (work.revision !== command.expectedWorkRevision) return reject('revision_conflict');
    const { run } = await validateWork(reads, work);
    if (!validOutput(work, run, command.output)) return reject('invalid_output');
    const next = { ...work, revision: work.revision + 1, output: structuredClone(command.output) };
    const fingerprint = reviewCommandFingerprint('review-output-bind', command);
    const result = await deps.ledger.commit({ commitKind: 'review-output-bind', schemaVersion: 1, identity: command.identity, fingerprint, expectedVersions: reads.versions, snapshots: [next], events: [{ ...eventBase(deps, command.identity, next), eventType: 'ReviewOutputBound', aggregateType: 'ReviewWork', payload: { work: next, commandFingerprint: fingerprint } }], outboxIntents: [] });
    return result.status === 'committed' ? receipt(next, result.replayed) : reject(result.code);
  } catch (error) { return reject(error instanceof Error ? error.message : 'invalid'); }
}
async function recordValidatedResult(deps: ControlEngineDeps, command: ValidatedReviewResultCommand): Promise<ReviewCommandReceipt> {
  try {
    const reads = new Reads(deps.ledger), work = await reads.load<ReviewWorkSnapshot>(command.workRef);
    const fingerprint = reviewCommandFingerprint('review-result-admission', command);
    if (!work || !validIdentity(command.identity) || command.identity.projectId !== work.ref.projectId) return reject('not_found');
    if (work.resultRef) {
      const old = await reads.load<ReviewResultSnapshot>(work.resultRef);
      return old && old.commandFingerprint === fingerprint ? receipt(work, true) : reject('idempotency_conflict');
    }
    if (work.revision !== command.expectedWorkRevision) return reject('revision_conflict');
    const { run, plan, workspace, index } = await validateWork(reads, work);
    if (!work.output || !same(work.output, command.output) || !validOutput(work, run, command.output) || command.assessmentRef.digest !== command.assessmentDigest || command.validatedMaterialIdentityDigest !== digest(work.descriptor.materialIdentity)) return reject('invalid_result');
    if (command.decision.status === 'accepted') {
      const required = work.descriptor.requiredReviewerCoverage.map(requirementKeyOf).sort(), supplied = command.decision.requirements.map(requirementKeyOf).sort();
      if (!same(required, supplied) || command.decision.requirements.some(r => !['PASS','FAIL','INCONCLUSIVE'].includes(r.outcome) || !r.summary.trim() || Buffer.byteLength(r.summary) > 4096)) return reject('coverage_mismatch');
    } else if (command.decision.status !== 'rejected' || !command.decision.reasonCodes.length) return reject('invalid_result');
    const resultRef = { ...work.ref, aggregateType: 'ReviewResult' as const }, next = { ...work, revision: work.revision + 1, resultRef };
    const result: ReviewResultSnapshot = { ref: resultRef, revision: 1, schemaVersion: 1, workRef: work.ref, protocol: work.protocol, output: work.output, validatedMaterialIdentityDigest: command.validatedMaterialIdentityDigest, assessmentRef: command.assessmentRef, assessmentDigest: command.assessmentDigest, validationVersion: 'review-report-v1', decision: { ...command.decision, evidenceRefs: [] }, commandIdentity: command.identity, commandFingerprint: fingerprint };
    const batch: ReviewLedgerCommitV1 = { commitKind: 'review-result-admission', schemaVersion: 1, identity: command.identity, fingerprint, expectedVersions: [...reads.versions, { ref: resultRef, revision: 0 }], snapshots: [next, result], events: [], outboxIntents: [] };
    let currentIndex = index;
    if (command.decision.status === 'accepted') for (const outcome of ['PASS', 'FAIL', 'INCONCLUSIVE'] as const) {
      const rows = command.decision.requirements.filter(r => r.outcome === outcome);
      if (!rows.length) continue;
      const evidenceId = work.ref.reviewId + '-' + outcome.toLowerCase();
      const evidence: EvidenceV1 = { schemaVersion: 1, evidenceId, kind: 'verdict', outcome, source: { actor: { kind: 'system', id: 'independent-review' }, runRef: work.reviewerRunRef, checkId: 'independent-review-v1' }, subject: work.subject, coverage: rows.map(({ obligationId, requirementId }) => ({ obligationId, requirementId })), anchor: buildCurrentEffectivityAnchor({ plan, workspaceRevision: workspace.revision }), verificationPlanRef: work.descriptor.toolRound.verificationPlanRef, summary: { text: `${rows.length} reviewer requirements: ${outcome}. See the original report for itemized findings.`, artifactRef: work.output.reportRef }, reviewAdmission: { protocol: work.protocol, workRef: work.ref, resultRef } };
      const intake = buildEvidenceIntakeLedgerCommit({ commandId: command.identity.idempotencyKey, commandType: 'SubmitEvidence', schemaVersion: 1, identity: command.identity, aggregateId: evidenceId, expectedRevision: 0, correlationId: work.requestId, submittedAt: deps.now(), payload: { evidence } }, { eventId: deps.eventId(), occurredAt: deps.now(), workspaceId: work.ref.workspaceId, priorIndex: currentIndex });
      batch.snapshots.push(intake.snapshots[0]); batch.events.push(intake.events[0]); batch.expectedVersions.push({ ref: intake.snapshots[0].ref, revision: 0 });
      result.decision.evidenceRefs.push(intake.snapshots[0].ref); currentIndex = intake.snapshots[1];
    }
    if (currentIndex !== index && currentIndex) {
      if (currentIndex.revision > 512) return reject('evidence_limit_exceeded');
      batch.snapshots.push(currentIndex);
    }
    batch.events.unshift({ ...eventBase(deps, command.identity, next), aggregateRevision: 1, eventType: 'ReviewResultRecorded', aggregateType: 'ReviewResult', payload: { work: next, result } });
    const committed = await deps.ledger.commit(batch);
    return committed.status === 'committed' ? receipt(next, committed.replayed) : reject(committed.code);
  } catch (error) { return reject(error instanceof Error ? error.message : 'invalid'); }
}

/** The composition root distributes each object to its sole intended consumer.
 * No actor string grants access and Control gains no callback dependency. */
export function createReviewControlPorts(deps: ControlEngineDeps): { lifecycle: ReviewLifecycleControlPort; dispatch: ReviewDispatchControlPort } {
  return { lifecycle: { createWork: command => createWork(deps, command), replaceFailedWork: command => replaceFailedWork(deps, command), recordValidatedResult: command => recordValidatedResult(deps, command) }, dispatch: { bindOutput: command => bindOutput(deps, command) } };
}
/** Start reuses the same canonical material check before binding the input.
 * Returned read revisions join the start transaction's compare-and-swap set. */
export async function reviewMaterialReadVersions(ledger: StateLedger, work: ReviewWorkSnapshot): Promise<ExpectedVersion[]> {
  const reads = new Reads(ledger);
  await current(reads, work.descriptor);
  const protocol = await reads.load<TaskReviewProtocolSnapshot>(work.protocolRef);
  if (!protocol || !(protocol.workRefs ?? [protocol.firstWorkRef]).some(ref => same(ref, work.ref)) || !same(protocol.planRef, work.planRef)) throw Error('invalid_review_protocol');
  return reads.versions;
}

/** Canonical review PASS qualification, used before the existing reducer. Old
 * reports remain stored, and unresolved negative reviewer evidence stays last
 * in this derived input so a later PASS cannot silently dispose of it. */
export async function qualifyReviewEvidence(ledger: StateLedger, plan: PlanRevisionSnapshot, subject: { projectId: string; goalId: string; taskId: string }, evidence: EvidenceV1[], versions: ExpectedVersion[] = []): Promise<EvidenceV1[]> {
  const protocolRef = taskReviewProtocolRefFor(subject, plan.planId), protocolResult = await ledger.load(protocolRef);
  versions.push({ ref: protocolRef, revision: protocolResult.status === 'found' ? protocolResult.snapshot.revision : 0 });
  if (plan.reviewAdmissionProtocol !== 'independent-review-v1' && protocolResult.status !== 'found') return evidence;
  const facts: import('../../contracts/read-model.js').ReviewProjectionFacts = { protocols: protocolResult.status === 'found' ? [protocolResult.snapshot as TaskReviewProtocolSnapshot] : [], works: [], results: [], runs: [] };
  const reads = new Reads(ledger);
  for (const e of evidence) if (e.reviewAdmission?.protocol === 'independent-review-v1') {
    const work = await reads.load<ReviewWorkSnapshot>(e.reviewAdmission.workRef), result = await reads.load<ReviewResultSnapshot>(e.reviewAdmission.resultRef);
    if (work) { facts.works.push(work); const run = await reads.load<RunSnapshot>(work.reviewerRunRef); if (run) facts.runs.push(run); }
    if (result) facts.results.push(result);
  }
  versions.push(...reads.versions.filter(v => !versions.some(old => same(v.ref, old.ref))));
  return qualifyProjectedReviewEvidence(evidence, plan, facts);
}

/** A cached satisfied reduction from before protocol adoption is insufficient
 * for dispatch/Goal. Recheck the exact reviewer evidence chain without writes. */
export async function reviewReductionIsCurrent(ledger: StateLedger, plan: PlanRevisionSnapshot, reduction: import('../../contracts/reduction.js').TaskReductionSnapshot) {
  const subject = { projectId: reduction.ref.projectId, goalId: reduction.ref.goalId, taskId: reduction.ref.taskId };
  if (!await hasIndependentReviewProtocol(ledger, plan, subject)) return true;
  const required = reviewerCoverage(plan, subject.taskId);
  if (!required.length) return true;
  const index = await ledger.load(taskEvidenceIndexRefFor(subject.projectId, subject.goalId, subject.taskId)), evidence: EvidenceV1[] = [];
  if (index.status !== 'found') return false;
  for (const id of (index.snapshot as TaskEvidenceIndexSnapshot).evidenceIds) {
    const record = await ledger.load(evidenceRefFor(subject.projectId, id));
    if (record.status !== 'found') return false;
    evidence.push((record.snapshot as EvidenceSnapshot).evidence);
  }
  const qualified = await qualifyReviewEvidence(ledger, plan, subject, evidence), effective = selectEffectiveEvidenceSet(qualified, plan, reduction.currentAnchor);
  return required.every(c => !!effective.coverageByRequirement[requirementKeyOf(c)] && reduction.effectiveEvidenceIds.includes(effective.coverageByRequirement[requirementKeyOf(c)]!)) && !Object.keys(effective.blockingByRequirement).length;
}
