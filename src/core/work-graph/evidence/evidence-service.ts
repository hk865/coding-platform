/**
 * R3e.1 Evidence service (implementation).
 *
 * The ONE trusted Evidence/verification service the composition root owns.
 * `openVerification` reads the adopted Goal/Plan/subject Run, captures the real
 * VerificationWorkspaceReader source, compiles the pinned VerificationPlan and
 * registers the pending checks under a Round revision CAS. `beginCheck` CASes
 * `pending -> executing` and freezes the ticket. `recordCheckResult` restores
 * the original identity/fingerprint receipt first, then accepts the bound
 * Host's real observation as history/INCONCLUSIVE when the current source or
 * permission changed. `finalizeChecks` folds the frozen coverage and commits
 * round + Evidence + TaskEvidenceIndex + event + receipt in ONE records.commit.
 *
 * The service never calls completeTask/completeGoal, never releases or advances
 * a Task/Run/Session, and never fabricates a PASS from a missing/blocked check.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { EffectivityAnchorV1, EvidenceApplicability, EvidenceCoverageV1, EvidenceOutcome, EvidenceRef,
    EvidenceSnapshot, EvidenceV1, TaskEvidenceIndexRef, TaskEvidenceIndexSnapshot } from '../../../contracts/evidence.js';
import { EVIDENCE_SUMMARY_MAX_BYTES, requirementKeyOf } from '../../../contracts/evidence.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { RunRef, RunSnapshot, SourceRefV1, TaskTriple } from '../../../contracts/dispatch.js';
import type {
    CheckCapabilityV1, CheckExecutionTicket, CheckProcessObservation, RoundCheckSnapshot, RoundSnapshot,
    TrustedCheckConfiguration, VerificationRoundRef,
} from '../../../contracts/verification.js';
import type {
    VerificationRoundMaterialIdentity, VerificationRoundSourceProof, VerificationRoundSourceResult,
} from '../../../contracts/verification-context.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
    EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreCommitReceipt, StoreFailure,
} from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { architectureBaselineDigest, readArchitectureBaselineSnapshot } from '../architecture/catalog-record-codecs.js';
import {
    readBatch, readGoal, readPinnedCompletionPolicy, readPlan, readRevisionNumber, type Rejected,
} from '../tasks/plan-readers.js';
import { planRevisionRefKey } from '../tasks/plan-record-codecs.js';
import {
    buildEffectiveTaskBasis, isBasisUnsupported,
} from '../tasks/plan-task-basis.js';
import {
    bindTrustedContext, isRecord, isolateWrite, loadReplayEvent, mapStoreFailure, mergeGuards, nonEmpty, sameRef,
} from '../tasks/execution-entry-service.js';
import { compileVerificationPlan } from './verification-plan.js';
import { evidenceApplicabilityWithBasis, evidenceBindingFor, selectEffectiveEvidenceSet } from './coverage.js';
import {
    EVIDENCE_ADMITTED_EVENT_TYPE, VERIFICATION_CHECK_BEGUN_EVENT_TYPE,
    VERIFICATION_CHECK_RESULT_RECORDED_EVENT_TYPE, VERIFICATION_ROUND_FINALIZED_EVENT_TYPE,
    VERIFICATION_ROUND_OPENED_EVENT_TYPE, checkObservationProblem, decodeVerificationRoundSnapshot,
    encodeEvidenceSnapshot, encodeTaskEvidenceIndexSnapshot, encodeVerificationRoundEvent,
    encodeVerificationRoundSnapshot, verificationRoundEventFromEvent, decodeTaskEvidenceIndexSnapshot,
    type VerificationRoundEvent,
} from './evidence-record-codecs.js';
import type {
    EvidencePort, EvidenceServiceDependencies, FinalizedChecks,
} from './contracts.js';
import type { GraphWrite } from '../tasks/contracts.js';

type Records = GoalRecordTransactionPort & RecordLookupPort;
type HostActor = { kind: 'human' | 'system'; id: string };
type LoadedRound = { ok: true; round: RoundSnapshot } | { ok: false; rejection: CoreRejection };

const REPORT_CONTENT_TYPE = 'application/vnd.coding-platform.verification-check-report+json;version=1';

// -------------------------------------------------------------------------- //
// Small pure helpers                                                          //
// -------------------------------------------------------------------------- //

function reject(code: CoreError, reason: string, current?: VersionPin[]): CoreRejection {
    return { status: 'rejected', code, reason, ...(current === undefined ? {} : { current }) };
}
function invalid(reason: string): CoreRejection { return reject('invalid', reason); }
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }
function busy(reason: string): CoreRejection { return reject('busy', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function notFound(reason: string): CoreRejection { return reject('not_found', reason); }
function incomplete(reason: string): CoreRejection { return reject('incomplete', reason); }
function unsupported(reason: string): CoreRejection { return reject('unsupported', reason); }
function cancelled(reason: string): CoreRejection { return reject('cancelled', reason); }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function refKeyOf(value: unknown): string | null {
    try { return canonicalJson(value as JsonValue); } catch { return null; }
}
function fingerprintOf(value: unknown): string { return sha256Hex(canonicalJson(value as JsonValue)); }
function digestOf(value: unknown): string { return sha256Hex(canonicalJson(value as JsonValue)); }
function identityKeyOf(prefix: string, actor: HostActor, projectId: string, workspaceId: string, requestId: string): string {
    return prefix + sha256Hex(canonicalJson({ actor: { kind: actor.kind, id: actor.id }, projectId, workspaceId, requestId } as unknown as JsonValue));
}
function roundRefProblem(ref: unknown): string | null {
    if (!isRecord(ref) || ref['aggregateType'] !== 'VerificationRound' || !nonEmpty(ref['projectId'])
        || !nonEmpty(ref['workspaceId']) || !nonEmpty(ref['goalId']) || !nonEmpty(ref['taskId'])
        || !nonEmpty(ref['runId']) || !nonEmpty(ref['roundId'])) {
        return 'the round ref must be a complete VerificationRoundRef';
    }
    return null;
}
function taskTripleProblem(value: unknown): string | null {
    if (!isRecord(value) || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['taskId'])) {
        return 'the subject must be a complete TaskTriple';
    }
    return null;
}
function planRefProblem(value: unknown): string | null {
    if (!isRecord(value) || value['aggregateType'] !== 'PlanRevision' || !nonEmpty(value['projectId']) || !nonEmpty(value['planId'])) {
        return 'the plan ref must be a complete PlanRevisionRef';
    }
    return null;
}
function isRunRef(value: unknown): value is RunRef {
    return isRecord(value) && value['aggregateType'] === 'Run' && nonEmpty(value['projectId'])
        && nonEmpty(value['goalId']) && nonEmpty(value['runId']);
}
function mapRejected(result: Rejected): CoreRejection {
    return { status: 'rejected', code: result.code, reason: result.reason };
}
function mapWorkspaceRejection(result: { status: 'rejected'; code: string; reason: string }): CoreRejection {
    const code: CoreError = result.code === 'cancelled' || result.code === 'forbidden' || result.code === 'invalid'
        || result.code === 'unavailable' || result.code === 'not_found' ? result.code : 'unavailable';
    return { status: 'rejected', code, reason: result.reason };
}
function mapRead<T>(result: Exclude<ReadResult<T>, { status: 'ready' }>): CoreRejection {
    if (result.status === 'not_found') return notFound('the requested record does not exist');
    if (result.status === 'not_ready') return incomplete('the read is not ready at the required watermark');
    return result;
}
function mapSourceFailure(capture: Exclude<VerificationRoundSourceResult, { status: 'ready' }>): CoreRejection {
    if (capture.status === 'incomplete') return incomplete(capture.missing.join('; ') || 'the workspace source is unavailable');
    return reject('source_stale', capture.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ') || 'the workspace source changed');
}
function checkRoundPin(expected: readonly VersionPin[], ref: VerificationRoundRef):
{ ok: true; revision: number } | CoreRejection {
    if (expected.length !== 1) return invalid('meta.expected must contain exactly one VerificationRound revision pin');
    const raw = expected[0] as unknown;
    if (!isRecord(raw) || !isRecord(raw['ref']) || typeof raw['revision'] !== 'number'
        || !Number.isSafeInteger(raw['revision']) || raw['revision'] < 1) {
        return invalid('the expected round pin must carry a ref and a positive safe revision');
    }
    if (!sameRef(raw['ref'], ref)) return invalid('meta.expected must pin exactly the target round');
    return { ok: true, revision: raw['revision'] as number };
}
function withCheck(round: RoundSnapshot, checkId: string, update: Partial<RoundCheckSnapshot>): RoundCheckSnapshot[] {
    return round.checks.map(check => check.checkId === checkId ? { ...check, ...update } : check);
}
function boundedSummary(text: string): string {
    if (Buffer.byteLength(text, 'utf8') <= EVIDENCE_SUMMARY_MAX_BYTES) return text;
    let end = Math.min(text.length, EVIDENCE_SUMMARY_MAX_BYTES);
    while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > EVIDENCE_SUMMARY_MAX_BYTES) end -= 1;
    return text.slice(0, end);
}
function anchorOf(round: RoundSnapshot): EffectivityAnchorV1 {
    return { schemaVersion: 1, planRef: round.adoptedPlanRef, planRevision: round.verificationPlan.planRevision,
        workspaceRevision: round.identity.workspaceRevision,
        pinnedCompletionPolicy: round.verificationPlan.pinnedCompletionPolicy,
        pinnedArchitectureBaseline: round.verificationPlan.pinnedArchitectureBaseline };
}

// -------------------------------------------------------------------------- //
// Store helpers                                                               //
// -------------------------------------------------------------------------- //

async function readRoundRecord(records: Records, ref: VerificationRoundRef): Promise<LoadedRound> {
    const key = refKeyOf(ref);
    if (key === null) return { ok: false, rejection: invalid('the round ref is not canonical JSON') };
    let read;
    try { read = await records.readMany([key]); }
    catch (error) { return { ok: false, rejection: unavailable(`the round read failed: ${messageOf(error)}`) }; }
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record = read.value.records.find(candidate => candidate.refKey === key);
    if (record === undefined) {
        return { ok: false, rejection: read.value.missing.includes(key) ? notFound('the round does not exist') : unavailable('the round key was neither returned nor missing') };
    }
    const decoded = decodeVerificationRoundSnapshot(record);
    if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`the round is damaged: ${decoded.reason}`) };
    return { ok: true, round: decoded.value };
}

type LookupOutcome = { status: 'found'; receipt: Extract<StoreCommitReceipt, { status: 'committed' }> }
    | { status: 'absent' } | { status: 'failed'; rejection: CoreRejection };

async function lookupReceipt(records: Records, identity: string, fingerprint: string): Promise<LookupOutcome> {
    try {
        const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
        if (lookup.status === 'ready') return { status: 'found', receipt: lookup.value };
        if (lookup.code === 'not_found') return { status: 'absent' };
        return { status: 'failed', rejection: mapStoreFailure(lookup) };
    } catch (error) {
        return { status: 'failed', rejection: unavailable(`the original receipt could not be read: ${messageOf(error)}`) };
    }
}

type ReplayResult = { status: 'committed'; value: unknown; replayed: true; cursor: CommitCursor } | CoreRejection;

async function replayEvent(
    records: Records,
    receipt: Extract<StoreCommitReceipt, { status: 'committed' }>,
    identity: string,
    fingerprint: string,
    expectedEventType: VerificationRoundEvent['eventType'],
): Promise<ReplayResult> {
    const loaded = await loadReplayEvent(records, receipt);
    if (!loaded.ok) return loaded.rejection;
    const decoded = verificationRoundEventFromEvent(loaded.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded round event is not decodable: ${decoded.reason}`);
    const event = decoded.value;
    if (event.eventType !== expectedEventType) return unavailable('the recorded event type disagrees with the operation');
    if (event.identityKey !== identity || event.fingerprint !== fingerprint) return unavailable('the recorded event disagrees with the request identity');
    return { status: 'committed', value: event.result, replayed: true, cursor: receipt.cursor };
}

async function commitOrRecover(
    records: Records,
    prepared: PreparedCommit,
    identity: string,
    fingerprint: string,
    expectedEventType: VerificationRoundEvent['eventType'],
    cause: unknown,
): Promise<unknown | CoreRejection> {
    const outcome = await lookupReceipt(records, identity, fingerprint);
    if (outcome.status === 'found') return await replayEvent(records, outcome.receipt, identity, fingerprint, expectedEventType);
    if (outcome.status === 'failed') return outcome.rejection;
    return unavailable(`the commit result is unknown: ${messageOf(cause)}`);
}

async function readPinnedBaseline(records: Records, pin: { ref: { baselineId: string; revision: number }; digest: string }):
Promise<{ ok: true; guard: RecordGuard } | { ok: false; rejection: CoreRejection }> {
    const key = refKeyOf(pin.ref);
    if (key === null) return { ok: false, rejection: incomplete('the pinned baseline ref is not canonical JSON') };
    const read = await readBatch(records, [key]);
    if (read.status !== 'ready') return { ok: false, rejection: mapRejected(read) };
    const record = read.batch.present.get(key);
    if (record === undefined) return { ok: false, rejection: notFound(`the adopted Plan baseline ${pin.ref.baselineId} is missing`) };
    let body: unknown;
    try { body = JSON.parse(record.json); } catch { return { ok: false, rejection: unavailable('the pinned ArchitectureBaseline is not JSON') }; }
    const snapshot = readArchitectureBaselineSnapshot(body);
    if (snapshot === null) return { ok: false, rejection: unavailable('the pinned ArchitectureBaseline is damaged') };
    if (snapshot.ref.baselineId !== pin.ref.baselineId || snapshot.contentRevision !== pin.ref.revision) {
        return { ok: false, rejection: reject('source_stale', 'the pinned ArchitectureBaseline content revision disagrees with the adopted pin') };
    }
    const digest = architectureBaselineDigest(body as { schemaVersion?: unknown; baselineId?: unknown; contentRevision?: unknown; content?: unknown });
    if (digest === null) return { ok: false, rejection: incomplete('the pinned ArchitectureBaseline content is not canonical JSON') };
    if (digest !== pin.digest) return { ok: false, rejection: reject('source_stale', 'the pinned ArchitectureBaseline digest disagrees with the adopted pin') };
    if (record.revision !== snapshot.revision) return { ok: false, rejection: unavailable('the ArchitectureBaseline outer revision disagrees with its body') };
    return { ok: true, guard: { refKey: key, expectedRevision: record.revision } };
}

/** The formal Workspace record's current domain revision. Read through the same
 * existing Plan reader owner; a missing/corrupt row is never a default. */
async function readWorkspaceRevision(records: Records, workspaceRef: { aggregateType: 'Workspace'; projectId: string; workspaceId: string }):
Promise<{ ok: true; revision: number } | { ok: false; rejection: CoreRejection }> {
    const key = refKeyOf(workspaceRef);
    if (key === null) return { ok: false, rejection: incomplete('the Workspace ref is not canonical JSON') };
    const read = await readBatch(records, [key]);
    if (read.status !== 'ready') return { ok: false, rejection: mapRejected(read) };
    const revision = readRevisionNumber(read.batch, key);
    if (revision === null) return { ok: false, rejection: notFound('the subject Workspace does not exist') };
    return { ok: true, revision };
}

// -------------------------------------------------------------------------- //
// The factory                                                                 //
// -------------------------------------------------------------------------- //

export function createEvidenceService(deps: EvidenceServiceDependencies): EvidencePort {
    const records = deps.records;

    async function storeReport(
        ctx: CoreCallContext,
        round: RoundSnapshot,
        check: RoundCheckSnapshot,
        observation: CheckProcessObservation,
        requestId: string,
        sourceStatus: RoundCheckSnapshot['sourceStatus'],
        outcome: EvidenceOutcome,
    ): Promise<{ ok: true; ref: ArtifactRef } | { ok: false; rejection: CoreRejection }> {
        const body = JSON.stringify({
            schemaVersion: 1, kind: 'registered-check-report', roundRef: round.ref,
            checkId: check.checkId, invocationId: check.invocationId,
            source: { actor: round.executor, runRef: null, checkId: check.checkId },
            subjectRunRef: round.subjectRunRef, subject: round.subject,
            observation, sourceStatus, outcome, recordedAt: deps.now(),
        });
        const sources: SourceRefV1[] = [
            { kind: 'plan-revision', refId: round.adoptedPlanRef.planId, revision: String(round.verificationPlan.planRevision) },
            { kind: 'governance', refId: round.verificationPlan.pinnedCompletionPolicy.ref.policyId,
                revision: String(round.verificationPlan.pinnedCompletionPolicy.ref.revision),
                digest: round.verificationPlan.pinnedCompletionPolicy.digest },
        ];
        let stored;
        try {
            stored = await deps.materials.storeArtifact(ctx, { contentType: REPORT_CONTENT_TYPE, body, sources,
                origin: { kind: 'platform_operation', projectId: ctx.projectId,
                    ...(ctx.workspaceId === undefined ? {} : { workspaceId: ctx.workspaceId }),
                    requestId, actor: round.executor } });
        } catch (error) {
            return { ok: false, rejection: unavailable(`the check report could not be stored: ${messageOf(error)}`) };
        }
        if (stored.status !== 'stored') return { ok: false, rejection: unavailable(`the check report was rejected: ${stored.reason}`) };
        return { ok: true, ref: stored.ref };
    }

    async function evaluateSource(
        ctx: CoreCallContext,
        configuration: TrustedCheckConfiguration,
        round: RoundSnapshot,
    ): Promise<RoundCheckSnapshot['sourceStatus']> {
        try {
            const resolved = await deps.workspaceHost.resolveRoot(configuration.workspace);
            if (resolved.status !== 'ready') return 'unavailable';
            const authorized = await deps.workspaceHost.authorize(ctx, configuration.workspace);
            if (authorized.status !== 'ready') return 'permission_changed';
            if (authorized.value.permissionRevision !== configuration.permissionRevision) return 'permission_changed';
            const captured = await deps.source.capture(resolved.value.root);
            if (captured.status === 'ready') return captured.sourceDigest === round.identity.sourceDigest ? 'matched' : 'changed';
            if (captured.status === 'rejected' && captured.code === 'source_changed') return 'changed';
            return 'unavailable';
        } catch {
            return 'unavailable';
        }
    }

    function outcomeFor(observation: CheckProcessObservation, sourceStatus: RoundCheckSnapshot['sourceStatus']): EvidenceOutcome {
        if (observation.kind === 'not_started') return 'INCONCLUSIVE';
        if (sourceStatus !== 'matched') return 'INCONCLUSIVE';
        if (observation.timedOut || observation.cancelled || observation.signal !== null || observation.exitCode === null) return 'INCONCLUSIVE';
        if (observation.effects.workspaceRevision === null) return 'INCONCLUSIVE';
        return observation.exitCode === 0 ? 'PASS' : 'FAIL';
    }

    async function openVerification(
        ctx: CoreCallContext,
        request: GraphWrite<{ subjectRunRef: RunRef; subject: TaskTriple; planRef: PlanRevisionRef; gateSubject?: 'goal' }>,
    ): Promise<WriteResult<RoundSnapshot>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const { ctx: trusted, scope, actor, signal } = ownedCtx;
        const owned = isolateWrite(request);
        if (!owned.ok) return owned.rejection;
        const input = owned.input;
        if (!isRunRef(input.subjectRunRef)) return invalid('a formal round requires a complete subject RunRef');
        if (input.subject.projectId !== scope.projectId) return forbidden('the subject task belongs to another project');
        const subjectProblem = taskTripleProblem(input.subject);
        if (subjectProblem !== null) return invalid(subjectProblem);
        const planProblem = planRefProblem(input.planRef);
        if (planProblem !== null) return invalid(planProblem);
        if (input.gateSubject !== undefined && input.gateSubject !== 'goal') return invalid('gateSubject must be goal when present');
        // Receipt-first: the ORIGINAL open result is restored by the stable
        // identity/fingerprint before any current configuration/source check, so
        // a later missing/changed trusted configuration cannot lose the receipt.
        let identity = '';
        let fingerprint = '';
        try {
            identity = identityKeyOf('r3e-open:', actor, scope.projectId, scope.workspaceId, owned.requestId);
            fingerprint = fingerprintOf({ kind: 'r3e-open', subjectRunRef: input.subjectRunRef, subject: input.subject,
                planRef: input.planRef, ...(input.gateSubject === undefined ? {} : { gateSubject: input.gateSubject }),
                expected: owned.expected });
        } catch { return invalid('the open request is not canonicalizable JSON'); }
        const lookup = await lookupReceipt(records, identity, fingerprint);
        if (lookup.status === 'failed') return lookup.rejection;
        if (lookup.status === 'found') {
            const replayed = await replayEvent(records, lookup.receipt, identity, fingerprint, VERIFICATION_ROUND_OPENED_EVENT_TYPE);
            return 'status' in replayed ? replayed as WriteResult<RoundSnapshot> : replayed;
        }
        // Only a fresh open needs the current trusted configuration.
        const configuration = deps.configuration;
        if (configuration === undefined) return unsupported('no frozen trusted check configuration is registered; fresh round open is unsupported');
        if (configuration.workspace.projectId !== scope.projectId || configuration.workspace.workspaceId !== scope.workspaceId) {
            return forbidden('the trusted check configuration belongs to another workspace');
        }
        if (actor.kind !== configuration.executor.kind || actor.id !== configuration.executor.id) {
            return forbidden('the call context is not the registered check Host executor');
        }
        if (signal.aborted) return cancelled('the round open was cancelled before the reads');

        const goalRef: GoalRef = { aggregateType: 'Goal', projectId: input.subject.projectId, goalId: input.subject.goalId };
        if (goalRef.projectId !== scope.projectId) return forbidden('the subject Goal belongs to another project');
        const goalRead = await readGoal(records, goalRef);
        if (goalRead.status !== 'ready') return mapRejected(goalRead);
        const goal = goalRead.goal;
        if (goal.workspaceRef.projectId !== scope.projectId || goal.workspaceRef.workspaceId !== scope.workspaceId) {
            return forbidden('the subject Goal belongs to another workspace');
        }
        if (goal.activePlanRevision === null || planRevisionRefKey(goal.activePlanRevision) !== planRevisionRefKey(input.planRef)) {
            return reject('source_stale', 'the requested planRef is not the Goal current adopted Plan');
        }
        const planRead = await readPlan(records, input.planRef);
        if (planRead.status !== 'ready') return mapRejected(planRead);
        const plan = planRead.plan;
        if (plan.goalRef.projectId !== goalRef.projectId || plan.goalRef.goalId !== goalRef.goalId) {
            return notFound('the adopted Plan belongs to another Goal');
        }
        const basis = buildEffectiveTaskBasis(plan).get(input.subject.taskId);
        if (basis === undefined || isBasisUnsupported(basis)) {
            return incomplete(`the subject task ${input.subject.taskId} has no resolved task-state basis`);
        }
        const execution = await deps.executions.readExecution(trusted, input.subjectRunRef);
        if (execution.status !== 'ready') return mapRead(execution);
        const run = execution.value.run;
        if (!sameRef(run.ref, input.subjectRunRef)) return unavailable('the Run read returned a different aggregate');
        if (input.gateSubject === 'goal') {
            // A Goal gate is not claimable: its round is opened against a formal
            // ended normal work Run of the SAME project/Goal/workspace while the
            // Round/VerificationPlan/taskBasis/Evidence subject stays the gate.
            const gateNode = plan.tasks.find(task => task.taskId === input.subject.taskId);
            if (gateNode === undefined || gateNode.taskKind !== 'gate' || gateNode.scope.kind !== 'goal') {
                return invalid(`the gate subject ${input.subject.taskId} is not an adopted Goal gate`);
            }
            if (run.task.projectId !== input.subject.projectId || run.task.goalId !== input.subject.goalId
                || run.task.taskId === input.subject.taskId) {
                return forbidden('the gate producer Run is not a work Run of the same Goal');
            }
            const producerNode = plan.tasks.find(task => task.taskId === run.task.taskId);
            if (producerNode === undefined || producerNode.taskKind !== 'work') {
                return forbidden('the gate producer Run is not an adopted work task of the same Plan');
            }
            if (run.workspaceSnapshot.workspaceId !== scope.workspaceId) {
                return forbidden('the gate producer Run belongs to another workspace');
            }
        } else if (run.task.projectId !== input.subject.projectId || run.task.goalId !== input.subject.goalId
            || run.task.taskId !== input.subject.taskId) {
            return forbidden('the subject task is not the subject Run task');
        }
        if (run.status !== 'ended') return forbidden('the subject Run has not formally ended');
        const policyRead = await readPinnedCompletionPolicy(records, plan.effectiveCompletionPolicy);
        if (policyRead.status !== 'resolved') return mapRejected(policyRead);
        const baseline = await readPinnedBaseline(records, plan.effectiveArchitectureBaseline);
        if (!baseline.ok) return baseline.rejection;
        const resolvedRoot = await deps.workspaceHost.resolveRoot(configuration.workspace);
        if (resolvedRoot.status !== 'ready') return mapWorkspaceRejection(resolvedRoot);
        const authorization = await deps.workspaceHost.authorize(trusted, configuration.workspace);
        if (authorization.status !== 'ready') return mapWorkspaceRejection(authorization);
        if (authorization.value.permissionRevision !== configuration.permissionRevision) {
            return forbidden('the current Host permission revision is not the trusted configuration binding');
        }
        const workspaceRead = await readWorkspaceRevision(records, goal.workspaceRef);
        if (!workspaceRead.ok) return workspaceRead.rejection;
        if (workspaceRead.revision !== resolvedRoot.value.workspaceRevision) {
            return reject('source_stale', 'the Host access workspace revision is not the current Workspace record revision');
        }
        const captured = await deps.source.capture(resolvedRoot.value.root);
        if (captured.status !== 'ready') return mapSourceFailure(captured);
        if (signal.aborted) return cancelled('the round open was cancelled during source capture');

        let configurationDigest: string;
        try { configurationDigest = digestOf(configuration); }
        catch { return invalid('the trusted check configuration is not canonical JSON'); }
        const capabilities: CheckCapabilityV1[] = configuration.checks.map(check => ({
            checkId: check.checkId, kind: check.kind, coversKinds: [check.kind], replayable: false }));
        const compiled = compileVerificationPlan({
            schemaVersion: 1, taskRef: input.subject, planRef: input.planRef, planSnapshot: plan,
            workspaceRevision: resolvedRoot.value.workspaceRevision, changeScope: captured.changeScope,
            semanticChange: 'semantic', risks: [], checkCapabilities: capabilities,
            policy: { requirementKinds: [...policyRead.policyContent.requirementKinds],
                ...(policyRead.policyContent.fastPathDiffClasses === undefined
                    ? {} : { fastPathDiffClasses: [...policyRead.policyContent.fastPathDiffClasses] }) },
            configurationDigest,
        });
        if (compiled.status !== 'ready') {
            return compiled.code === 'invalid'
                ? invalid(compiled.issues.map(issue => issue.message).join('; '))
                : incomplete(`the VerificationPlan could not be compiled (${compiled.code}): ${compiled.issues.map(issue => issue.message).join('; ')}`);
        }
        const verificationPlan = compiled.plan;
        const checks: RoundCheckSnapshot[] = [];
        for (const planCheck of verificationPlan.checks) {
            const definition = configuration.checks.find(candidate => candidate.checkId === planCheck.checkId);
            if (definition === undefined) return incomplete(`the compiled plan names an unregistered check ${planCheck.checkId}`);
            checks.push({ checkId: planCheck.checkId, definition, coverage: planCheck.coverage.map(entry => ({ ...entry })),
                phase: 'pending', invocationId: null, outcome: null, reportRef: null, sourceStatus: null });
        }
        const taskDefinition = plan.tasks.find(task => task.taskId === input.subject.taskId);
        let identityMaterial: VerificationRoundMaterialIdentity;
        try {
            identityMaterial = {
                schemaVersion: 1,
                scope: { projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: goalRef.goalId,
                    runId: input.subjectRunRef.runId, taskId: input.subject.taskId,
                    ...(input.gateSubject === undefined ? {} : { gateSubject: input.gateSubject }) },
                runRef: input.subjectRunRef, runRevision: run.revision, runDigest: digestOf(run),
                planRef: input.planRef, planRevision: plan.planRevision, planDigest: digestOf(plan),
                taskDigest: digestOf(taskDefinition ?? input.subject),
                goalRevision: goal.revision, goalDigest: digestOf(goal),
                workspaceRevision: resolvedRoot.value.workspaceRevision,
                workspaceDigest: digestOf({ workspaceRef: goal.workspaceRef, revision: resolvedRoot.value.workspaceRevision }),
                workspaceRoot: resolvedRoot.value.root,
                policyPin: plan.effectiveCompletionPolicy, baselinePin: plan.effectiveArchitectureBaseline,
                sourceDigest: captured.sourceDigest, sourceProofDigest: digestOf(captured.sourceProof),
            };
        } catch { return invalid('the round material identity is not canonical JSON'); }
        const roundRef: VerificationRoundRef = { aggregateType: 'VerificationRound', projectId: scope.projectId,
            workspaceId: scope.workspaceId, goalId: goalRef.goalId, taskId: input.subject.taskId,
            runId: input.subjectRunRef.runId, roundId: deps.newId() };
        const gaps: RoundSnapshot['gaps'] = (verificationPlan.uncovered ?? []).map(uncovered => ({
            code: 'uncovered_requirement', message: `no registered check covers required requirement ${uncovered.requirementId}`,
            coverage: { obligationId: uncovered.obligationId, requirementId: uncovered.requirementId } }));
        const round: RoundSnapshot = { ref: roundRef, revision: 1, schemaVersion: 1, subject: { ...input.subject },
            subjectRunRef: input.subjectRunRef, adoptedPlanRef: input.planRef, taskBasisRef: basis as PlanRevisionRef,
            executor: actor, configuration, configurationDigest, identity: identityMaterial,
            sourceProof: captured.sourceProof, verificationPlan, checks, status: 'open', outcome: null, gaps, evidenceRefs: [] };
        const record = encodeVerificationRoundSnapshot(round);
        const occurredAt = deps.now();
        const event: VerificationRoundEvent = { eventId: deps.newId(), eventType: VERIFICATION_ROUND_OPENED_EVENT_TYPE,
            schemaVersion: 1, occurredAt, identityKey: identity, roundRef, actor, fingerprint, result: round };
        // The commit CASes the ACTUAL local read set this open consumed: Goal's
        // current adopted pointer, the adopted Plan, the formal Workspace domain
        // revision, the ended subject Run, the pinned policy/baseline and the
        // Round absence. A legal W1 future apply during the capture await moves
        // the Goal pointer and conflicts here instead of landing silently.
        const goalKey = refKeyOf(goalRef);
        const workspaceKey = refKeyOf(goal.workspaceRef);
        const runKey = refKeyOf(run.ref);
        if (goalKey === null || workspaceKey === null || runKey === null) {
            return invalid('the open read refs are not canonical JSON');
        }
        const mergedGuards = mergeGuards([
            { refKey: record.refKey, expectedRevision: null },
            { refKey: goalKey, expectedRevision: goal.revision },
            { refKey: planRevisionRefKey(input.planRef), expectedRevision: plan.revision },
            { refKey: workspaceKey, expectedRevision: workspaceRead.revision },
            { refKey: runKey, expectedRevision: run.revision },
            ...policyRead.guards,
            baseline.guard,
        ]);
        if (!mergedGuards.ok) return mergedGuards.rejection;
        const prepared: PreparedCommit = { identityKey: identity, fingerprint,
            guards: mergedGuards.guards,
            records: [record], claims: [], indexGuards: [], indexChanges: [],
            events: [encodeVerificationRoundEvent(event)] };
        try {
            if (signal.aborted) return cancelled('the round open was cancelled before commit');
            const receipt = await records.commit(prepared);
            if (receipt.status !== 'committed') return mapStoreFailure(receipt);
            if (receipt.replayed) {
                const replayed = await replayEvent(records, receipt, identity, fingerprint, VERIFICATION_ROUND_OPENED_EVENT_TYPE);
                return replayed as WriteResult<RoundSnapshot>;
            }
            return { status: 'committed', value: round, replayed: false, cursor: receipt.cursor };
        } catch (error) {
            const recovered = await commitOrRecover(records, prepared, identity, fingerprint, VERIFICATION_ROUND_OPENED_EVENT_TYPE, error);
            return recovered as WriteResult<RoundSnapshot>;
        }
    }

    async function readVerification(ctx: CoreCallContext, ref: VerificationRoundRef): Promise<ReadResult<RoundSnapshot>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const refProblem = roundRefProblem(ref);
        if (refProblem !== null) return invalid(refProblem);
        if (ref.projectId !== ownedCtx.scope.projectId || ref.workspaceId !== ownedCtx.scope.workspaceId) {
            return forbidden('the round ref is outside the trusted Host scope');
        }
        const loaded = await readRoundRecord(records, ref);
        if (!loaded.ok) return loaded.rejection;
        return { status: 'ready', value: loaded.round };
    }

    async function beginCheck(ctx: CoreCallContext, request: GraphWrite<{ roundRef: VerificationRoundRef; checkId: string }>):
    Promise<WriteResult<CheckExecutionTicket>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const { scope, actor, signal } = ownedCtx;
        const owned = isolateWrite(request);
        if (!owned.ok) return owned.rejection;
        const input = owned.input;
        const refProblem = roundRefProblem(input.roundRef);
        if (refProblem !== null) return invalid(refProblem);
        if (!nonEmpty(input.checkId)) return invalid('beginCheck requires a checkId');
        if (input.roundRef.projectId !== scope.projectId || input.roundRef.workspaceId !== scope.workspaceId) {
            return forbidden('the round ref is outside the trusted Host scope');
        }
        let identity = '';
        let fingerprint = '';
        try {
            identity = identityKeyOf('r3e-begin:', actor, scope.projectId, scope.workspaceId, owned.requestId);
            fingerprint = fingerprintOf({ kind: 'r3e-begin', roundRef: input.roundRef, checkId: input.checkId, expected: owned.expected });
        } catch { return invalid('the begin request is not canonicalizable JSON'); }
        const lookup = await lookupReceipt(records, identity, fingerprint);
        if (lookup.status === 'failed') return lookup.rejection;
        if (lookup.status === 'found') {
            return await replayEvent(records, lookup.receipt, identity, fingerprint, VERIFICATION_CHECK_BEGUN_EVENT_TYPE) as WriteResult<CheckExecutionTicket>;
        }
        const configuration = deps.configuration;
        if (configuration === undefined) return unsupported('no frozen trusted check configuration is registered; fresh begin is unsupported');
        const checked = checkRoundPin(owned.expected, input.roundRef);
        if ('status' in checked) return checked;
        const loaded = await readRoundRecord(records, input.roundRef);
        if (!loaded.ok) return loaded.rejection;
        const round = loaded.round;
        if (round.status === 'finalized') return busy('the round is finalized; no fresh check may begin');
        if (round.executor.kind !== actor.kind || round.executor.id !== actor.id) return forbidden('the check executor is not the round executor');
        if (round.configuration.configurationRevision !== configuration.configurationRevision) {
            return forbidden('the current trusted configuration revision is not the round binding');
        }
        const check = round.checks.find(candidate => candidate.checkId === input.checkId);
        if (check === undefined) return invalid(`the round has no registered check ${input.checkId}`);
        if (round.revision !== checked.revision) {
            return reject('revision_conflict', 'the round changed since the caller read it', [{ ref: round.ref, revision: round.revision }]);
        }
        if (check.phase !== 'pending') return busy(`the check ${input.checkId} is already ${check.phase}`);
        // A fresh begin must still match the CURRENT trusted configuration's
        // Host grant and exact source; otherwise no execution ticket is issued.
        const resolved = await deps.workspaceHost.resolveRoot(configuration.workspace);
        if (resolved.status !== 'ready') return mapWorkspaceRejection(resolved);
        const authorized = await deps.workspaceHost.authorize(ownedCtx.ctx, configuration.workspace);
        if (authorized.status !== 'ready') return mapWorkspaceRejection(authorized);
        if (authorized.value.permissionRevision !== configuration.permissionRevision) {
            return forbidden('the current Host permission revision is not the trusted configuration binding');
        }
        if (resolved.value.root !== round.identity.workspaceRoot) {
            return reject('source_stale', 'the current workspace root is not the round fixed root');
        }
        const captured = await deps.source.capture(resolved.value.root);
        if (captured.status !== 'ready') return mapSourceFailure(captured);
        if (captured.sourceDigest !== round.identity.sourceDigest) {
            return reject('source_stale', 'the current verification source is not the round fixed source');
        }
        const ticket: CheckExecutionTicket = { roundRef: round.ref, checkId: check.checkId, invocationId: deps.newId(),
            configurationRevision: configuration.configurationRevision, configurationDigest: round.configurationDigest,
            executor: round.executor, workspace: configuration.workspace, workspaceRoot: round.identity.workspaceRoot,
            permissionRevision: configuration.permissionRevision, sourceDigest: round.identity.sourceDigest,
            processAccess: configuration.processAccess, deniedPrefixes: configuration.deniedPrefixes, definition: check.definition };
        const nextRound: RoundSnapshot = { ...round, revision: round.revision + 1,
            checks: withCheck(round, check.checkId, { phase: 'executing', invocationId: ticket.invocationId }) };
        const record = encodeVerificationRoundSnapshot(nextRound);
        const occurredAt = deps.now();
        const event: VerificationRoundEvent = { eventId: deps.newId(), eventType: VERIFICATION_CHECK_BEGUN_EVENT_TYPE,
            schemaVersion: 1, occurredAt, identityKey: identity, roundRef: round.ref, actor, fingerprint, result: ticket };
        const prepared: PreparedCommit = { identityKey: identity, fingerprint,
            guards: [{ refKey: record.refKey, expectedRevision: checked.revision }],
            records: [record], claims: [], indexGuards: [], indexChanges: [], events: [encodeVerificationRoundEvent(event)] };
        try {
            if (signal.aborted) return cancelled('the check begin was cancelled before commit');
            const receipt = await records.commit(prepared);
            if (receipt.status !== 'committed') return mapStoreFailure(receipt);
            if (receipt.replayed) {
                return await replayEvent(records, receipt, identity, fingerprint, VERIFICATION_CHECK_BEGUN_EVENT_TYPE) as WriteResult<CheckExecutionTicket>;
            }
            return { status: 'committed', value: ticket, replayed: false, cursor: receipt.cursor };
        } catch (error) {
            const recovered = await commitOrRecover(records, prepared, identity, fingerprint, VERIFICATION_CHECK_BEGUN_EVENT_TYPE, error);
            return recovered as WriteResult<CheckExecutionTicket>;
        }
    }

    async function recordCheckResult(ctx: CoreCallContext, request: GraphWrite<{
        roundRef: VerificationRoundRef; checkId: string; invocationId: string; observation: CheckProcessObservation;
    }>): Promise<WriteResult<RoundSnapshot>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const { scope, actor, signal } = ownedCtx;
        const owned = isolateWrite(request);
        if (!owned.ok) return owned.rejection;
        const input = owned.input;
        const refProblem = roundRefProblem(input.roundRef);
        if (refProblem !== null) return invalid(refProblem);
        if (!nonEmpty(input.checkId)) return invalid('recordCheckResult requires a checkId');
        if (!nonEmpty(input.invocationId)) return invalid('recordCheckResult requires an invocationId');
        const observationProblem = checkObservationProblem(input.observation);
        if (observationProblem !== null) return invalid(observationProblem);
        if (input.roundRef.projectId !== scope.projectId || input.roundRef.workspaceId !== scope.workspaceId) {
            return forbidden('the round ref is outside the trusted Host scope');
        }
        let identity = '';
        let fingerprint = '';
        try {
            identity = identityKeyOf('r3e-record:', actor, scope.projectId, scope.workspaceId, owned.requestId);
            fingerprint = fingerprintOf({ kind: 'r3e-record', roundRef: input.roundRef, checkId: input.checkId,
                invocationId: input.invocationId, observation: input.observation, expected: owned.expected });
        } catch { return invalid('the record request is not canonicalizable JSON'); }
        const lookup = await lookupReceipt(records, identity, fingerprint);
        if (lookup.status === 'failed') return lookup.rejection;
        if (lookup.status === 'found') {
            return await replayEvent(records, lookup.receipt, identity, fingerprint, VERIFICATION_CHECK_RESULT_RECORDED_EVENT_TYPE) as WriteResult<RoundSnapshot>;
        }
        const checked = checkRoundPin(owned.expected, input.roundRef);
        if ('status' in checked) return checked;
        const loaded = await readRoundRecord(records, input.roundRef);
        if (!loaded.ok) return loaded.rejection;
        const round = loaded.round;
        if (round.status === 'finalized') return busy('the round is finalized; no fresh result may be recorded');
        if (round.executor.kind !== actor.kind || round.executor.id !== actor.id) return forbidden('the check executor is not the round executor');
        const check = round.checks.find(candidate => candidate.checkId === input.checkId);
        if (check === undefined) return invalid(`the round has no registered check ${input.checkId}`);
        if (check.phase !== 'executing') return busy(`the check ${input.checkId} is ${check.phase}, not executing`);
        if (check.invocationId !== input.invocationId) return forbidden('the ticket is not the begun invocation of this check');
        if (round.revision !== checked.revision) {
            return reject('revision_conflict', 'the round changed since the caller read it', [{ ref: round.ref, revision: round.revision }]);
        }
        const sourceStatus = await evaluateSource(ownedCtx.ctx, round.configuration, round);
        const outcome = outcomeFor(input.observation, sourceStatus);
        // The observation is already an occurred fact. A late caller cancel must not
        // discard the real exit/signal/stdout/stderr/effects/report; the trusted
        // finishing signal keeps the same Host identity/scope (B2 cleanup pattern).
        const finishingCtx: CoreCallContext = { ...ownedCtx.ctx, signal: new AbortController().signal };
        const report = await storeReport(finishingCtx, round, check, input.observation, owned.requestId, sourceStatus, outcome);
        if (!report.ok) return report.rejection;
        const nextRound: RoundSnapshot = { ...round, revision: round.revision + 1,
            checks: withCheck(round, check.checkId, { phase: 'finished', outcome, reportRef: report.ref, sourceStatus }) };
        const record = encodeVerificationRoundSnapshot(nextRound);
        const occurredAt = deps.now();
        const event: VerificationRoundEvent = { eventId: deps.newId(), eventType: VERIFICATION_CHECK_RESULT_RECORDED_EVENT_TYPE,
            schemaVersion: 1, occurredAt, identityKey: identity, roundRef: round.ref, actor, fingerprint, result: nextRound };
        const prepared: PreparedCommit = { identityKey: identity, fingerprint,
            guards: [{ refKey: record.refKey, expectedRevision: checked.revision }],
            records: [record], claims: [], indexGuards: [], indexChanges: [], events: [encodeVerificationRoundEvent(event)] };
        try {
            const receipt = await records.commit(prepared);
            if (receipt.status !== 'committed') return mapStoreFailure(receipt);
            if (receipt.replayed) {
                return await replayEvent(records, receipt, identity, fingerprint, VERIFICATION_CHECK_RESULT_RECORDED_EVENT_TYPE) as WriteResult<RoundSnapshot>;
            }
            return { status: 'committed', value: nextRound, replayed: false, cursor: receipt.cursor };
        } catch (error) {
            const recovered = await commitOrRecover(records, prepared, identity, fingerprint, VERIFICATION_CHECK_RESULT_RECORDED_EVENT_TYPE, error);
            return recovered as WriteResult<RoundSnapshot>;
        }
    }

    async function submitEvidence(ctx: CoreCallContext, request: GraphWrite<{ roundRef: VerificationRoundRef; claim: string }>):
    Promise<WriteResult<EvidenceSnapshot>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const { scope, actor, signal } = ownedCtx;
        const owned = isolateWrite(request);
        if (!owned.ok) return owned.rejection;
        const input = owned.input;
        const refProblem = roundRefProblem(input.roundRef);
        if (refProblem !== null) return invalid(refProblem);
        if (!nonEmpty(input.claim)) return invalid('submitEvidence requires a non-empty claim');
        if (input.roundRef.projectId !== scope.projectId || input.roundRef.workspaceId !== scope.workspaceId) {
            return forbidden('the round ref is outside the trusted Host scope');
        }
        let identity = '';
        let fingerprint = '';
        try {
            identity = identityKeyOf('r3e-submit:', actor, scope.projectId, scope.workspaceId, owned.requestId);
            fingerprint = fingerprintOf({ kind: 'r3e-submit', roundRef: input.roundRef, claim: input.claim, expected: owned.expected });
        } catch { return invalid('the submit request is not canonicalizable JSON'); }
        const lookup = await lookupReceipt(records, identity, fingerprint);
        if (lookup.status === 'failed') return lookup.rejection;
        if (lookup.status === 'found') {
            return await replayEvent(records, lookup.receipt, identity, fingerprint, EVIDENCE_ADMITTED_EVENT_TYPE) as WriteResult<EvidenceSnapshot>;
        }
        const loaded = await readRoundRecord(records, input.roundRef);
        if (!loaded.ok) return loaded.rejection;
        const round = loaded.round;
        if (round.executor.kind !== actor.kind || round.executor.id !== actor.id) return forbidden('the evidence author is not the round executor');
        const coverage = collectRequiredCoverage(round);
        if (coverage.length === 0) return incomplete('the round has no required verification coverage to attach a claim to');
        const evidenceId = deps.newId();
        const admittedAt = deps.now();
        const evidence: EvidenceV1 = { schemaVersion: 1, evidenceId, kind: 'claim', outcome: 'INCONCLUSIVE',
            source: { actor: round.executor, runRef: null, checkId: null }, subject: { ...round.subject },
            coverage, anchor: anchorOf(round),
            verificationPlanRef: { planId: round.verificationPlan.planId, planDigest: round.verificationPlan.planDigest },
            summary: { text: boundedSummary(input.claim), artifactRef: null } };
        const snapshot: EvidenceSnapshot = { ref: { aggregateType: 'Evidence', projectId: round.ref.projectId, evidenceId },
            revision: 1, schemaVersion: 1, evidence, admittedAt };
        const indexRead = await readIndex(records, round);
        if (!indexRead.ok) return indexRead.rejection;
        const index = indexRead.index;
        const nextIndex: TaskEvidenceIndexSnapshot = { ref: index.ref, revision: index.evidenceIds.length + 1,
            schemaVersion: 1, evidenceIds: [...index.evidenceIds, evidenceId] };
        const prepared: PreparedCommit = { identityKey: identity, fingerprint,
            guards: [{ refKey: encodeTaskEvidenceIndexSnapshot(nextIndex).refKey,
                    expectedRevision: index.revision === 0 ? null : index.revision },
                { refKey: encodeEvidenceSnapshot(snapshot).refKey, expectedRevision: null }],
            records: [encodeEvidenceSnapshot(snapshot), encodeTaskEvidenceIndexSnapshot(nextIndex)],
            claims: [], indexGuards: [], indexChanges: [],
            events: [encodeVerificationRoundEvent({ eventId: deps.newId(), eventType: EVIDENCE_ADMITTED_EVENT_TYPE,
                schemaVersion: 1, occurredAt: admittedAt, identityKey: identity, roundRef: round.ref, actor, fingerprint,
                result: snapshot })] };
        try {
            if (signal.aborted) return cancelled('the evidence claim was cancelled before commit');
            const receipt = await records.commit(prepared);
            if (receipt.status !== 'committed') return mapStoreFailure(receipt);
            if (receipt.replayed) {
                return await replayEvent(records, receipt, identity, fingerprint, EVIDENCE_ADMITTED_EVENT_TYPE) as WriteResult<EvidenceSnapshot>;
            }
            return { status: 'committed', value: snapshot, replayed: false, cursor: receipt.cursor };
        } catch (error) {
            const recovered = await commitOrRecover(records, prepared, identity, fingerprint, EVIDENCE_ADMITTED_EVENT_TYPE, error);
            return recovered as WriteResult<EvidenceSnapshot>;
        }
    }

    async function finalizeChecks(ctx: CoreCallContext, request: GraphWrite<{
        roundRef: VerificationRoundRef; reviewerEvidence?: readonly EvidenceRef[];
    }>): Promise<WriteResult<FinalizedChecks>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const { scope, actor, signal } = ownedCtx;
        const owned = isolateWrite(request);
        if (!owned.ok) return owned.rejection;
        const input = owned.input;
        const refProblem = roundRefProblem(input.roundRef);
        if (refProblem !== null) return invalid(refProblem);
        if (input.reviewerEvidence !== undefined && input.reviewerEvidence.length > 0) {
            return unsupported('reviewer evidence finalization is not implemented in R3e.1');
        }
        if (input.roundRef.projectId !== scope.projectId || input.roundRef.workspaceId !== scope.workspaceId) {
            return forbidden('the round ref is outside the trusted Host scope');
        }
        let identity = '';
        let fingerprint = '';
        try {
            identity = identityKeyOf('r3e-finalize:', actor, scope.projectId, scope.workspaceId, owned.requestId);
            fingerprint = fingerprintOf({ kind: 'r3e-finalize', roundRef: input.roundRef, expected: owned.expected });
        } catch { return invalid('the finalize request is not canonicalizable JSON'); }
        const lookup = await lookupReceipt(records, identity, fingerprint);
        if (lookup.status === 'failed') return lookup.rejection;
        if (lookup.status === 'found') {
            return await replayEvent(records, lookup.receipt, identity, fingerprint, VERIFICATION_ROUND_FINALIZED_EVENT_TYPE) as WriteResult<FinalizedChecks>;
        }
        const checked = checkRoundPin(owned.expected, input.roundRef);
        if ('status' in checked) return checked;
        const loaded = await readRoundRecord(records, input.roundRef);
        if (!loaded.ok) return loaded.rejection;
        const round = loaded.round;
        if (round.status === 'finalized') return busy('the round is already finalized');
        if (round.executor.kind !== actor.kind || round.executor.id !== actor.id) return forbidden('the finalizer is not the round executor');
        if (round.revision !== checked.revision) {
            return reject('revision_conflict', 'the round changed since the caller read it', [{ ref: round.ref, revision: round.revision }]);
        }

        // Resolve the CURRENT adopted Plan and source once, then judge each
        // finished check's evidence with the existing basis/frozen-definition
        // rule. An unreadable current Plan or a changed/unverifiable source
        // cannot contribute PASS; the historical observation/outcome/anchor and
        // the original receipt are still preserved (never rewritten/re-run).
        const goalRef: GoalRef = { aggregateType: 'Goal', projectId: round.subject.projectId, goalId: round.subject.goalId };
        let evidencePlan: PlanRevisionSnapshot | null = null;
        let adoptedPlan: PlanRevisionSnapshot | null = null;
        const contextGaps: RoundSnapshot['gaps'] = [];
        const evidencePlanRead = await readPlan(records, round.adoptedPlanRef);
        if (evidencePlanRead.status === 'ready') evidencePlan = evidencePlanRead.plan;
        else contextGaps.push({ code: 'evidence_plan_unavailable', message: 'the round adopted Plan is not readable' });
        const goalRead = await readGoal(records, goalRef);
        if (goalRead.status !== 'ready') {
            contextGaps.push({ code: 'goal_unavailable', message: 'the subject Goal is not readable' });
        } else if (evidencePlan !== null) {
            const activeRef = goalRead.goal.activePlanRevision ?? round.adoptedPlanRef;
            if (planRevisionRefKey(activeRef) === planRevisionRefKey(round.adoptedPlanRef)) {
                adoptedPlan = evidencePlan;
            } else {
                const adoptedRead = await readPlan(records, activeRef);
                if (adoptedRead.status === 'ready') adoptedPlan = adoptedRead.plan;
                else contextGaps.push({ code: 'adopted_plan_unavailable', message: 'the current adopted Plan is not readable' });
            }
        }
        let sourceCurrent = false;
        let currentWorkspaceRevision = round.identity.workspaceRevision;
        const resolved = await deps.workspaceHost.resolveRoot(round.configuration.workspace);
        if (resolved.status === 'ready') {
            currentWorkspaceRevision = resolved.value.workspaceRevision;
            const authorized = await deps.workspaceHost.authorize(ownedCtx.ctx, round.configuration.workspace);
            if (authorized.status === 'ready' && authorized.value.permissionRevision === round.configuration.permissionRevision) {
                const captured = await deps.source.capture(resolved.value.root);
                if (captured.status === 'ready' && captured.sourceDigest === round.identity.sourceDigest) sourceCurrent = true;
                else contextGaps.push({ code: 'source_changed', message: 'the current verification source no longer matches the round fixed source' });
            } else {
                contextGaps.push({ code: 'source_unavailable', message: 'the current Host grant does not authorize the round fixed source' });
            }
        } else {
            contextGaps.push({ code: 'source_unavailable', message: 'the current workspace root is unavailable for the round fixed source' });
        }

        const candidates: { evidence: EvidenceV1; applicability: EvidenceApplicability }[] = [];
        const gaps: RoundSnapshot['gaps'] = [];
        for (const planCheck of round.verificationPlan.checks) {
            const check = round.checks.find(candidate => candidate.checkId === planCheck.checkId);
            if (check === undefined) { gaps.push({ code: 'missing_check', message: `the round is missing required check ${planCheck.checkId}` }); continue; }
            if (check.phase === 'executing' || check.phase === 'interrupted') {
                return incomplete(`the check ${check.checkId} is ${check.phase}; its result window is not reconciled`);
            }
            if (check.phase === 'pending') {
                gaps.push({ code: 'pending_check', message: `the required check ${check.checkId} never ran`,
                    ...(planCheck.coverage[0] === undefined ? {} : { coverage: { ...planCheck.coverage[0] } }) });
                continue;
            }
            const evidence: EvidenceV1 = {
                schemaVersion: 1, evidenceId: deps.newId(), kind: 'verdict', outcome: check.outcome ?? 'INCONCLUSIVE',
                source: { actor: round.executor, runRef: null, checkId: check.checkId }, subject: { ...round.subject },
                coverage: check.coverage.map(entry => ({ ...entry })), anchor: anchorOf(round),
                verificationPlanRef: { planId: round.verificationPlan.planId, planDigest: round.verificationPlan.planDigest },
                summary: { text: boundedSummary(`check ${check.checkId} ${check.outcome ?? 'INCONCLUSIVE'}`), artifactRef: check.reportRef },
            };
            let applicability: EvidenceApplicability = 'APPLICABLE';
            if (evidencePlan !== null && adoptedPlan !== null) {
                const currentAnchor: EffectivityAnchorV1 = { schemaVersion: 1, planRef: adoptedPlan.ref,
                    planRevision: adoptedPlan.planRevision, workspaceRevision: currentWorkspaceRevision,
                    pinnedCompletionPolicy: adoptedPlan.effectiveCompletionPolicy,
                    pinnedArchitectureBaseline: adoptedPlan.effectiveArchitectureBaseline };
                const decision = evidenceApplicabilityWithBasis({ evidence, adoptedPlan, evidencePlan, currentAnchor });
                applicability = decision.applicability;
                if (decision.applicability !== 'APPLICABLE') {
                    gaps.push({ code: `evidence_${decision.basis}`, message: `check ${check.checkId}: ${decision.reason}`,
                        ...(planCheck.coverage[0] === undefined ? {} : { coverage: { ...planCheck.coverage[0] } }) });
                }
            } else {
                applicability = 'OUT_OF_SCOPE';
            }
            if (!sourceCurrent) applicability = 'STALE';
            candidates.push({ evidence, applicability });
        }
        for (const uncovered of round.verificationPlan.uncovered ?? []) {
            gaps.push({ code: 'uncovered_requirement', message: `no registered check covers required requirement ${uncovered.requirementId}`,
                coverage: { obligationId: uncovered.obligationId, requirementId: uncovered.requirementId } });
        }
        gaps.push(...contextGaps);
        const effective = selectEffectiveEvidenceSet(candidates.map(candidate => candidate.evidence),
            candidates.map(candidate => evidenceBindingFor(candidate.evidence, candidate.applicability)));
        const requiredKeys = new Set<string>();
        for (const planCheck of round.verificationPlan.checks) {
            for (const coverage of planCheck.coverage) requiredKeys.add(requirementKeyOf(coverage));
        }
        for (const uncovered of round.verificationPlan.uncovered ?? []) requiredKeys.add(requirementKeyOf(uncovered));
        let blocked = false;
        let missing = false;
        for (const key of requiredKeys) {
            if ((effective.blockingByRequirement[key]?.length ?? 0) > 0) blocked = true;
            if (effective.coverageByRequirement[key] === undefined) missing = true;
        }
        const outcome: EvidenceOutcome = blocked || missing ? 'INCONCLUSIVE' : 'PASS';

        const snapshots: EvidenceSnapshot[] = [];
        const admittedAt = deps.now();
        const pushSnapshot = (sourceEvidence: EvidenceV1, coverage: EvidenceCoverageV1): void => {
            const evidenceId = deps.newId();
            const evidence: EvidenceV1 = { ...sourceEvidence, evidenceId, coverage: [{ ...coverage }] };
            snapshots.push({ ref: { aggregateType: 'Evidence', projectId: round.ref.projectId, evidenceId },
                revision: 1, schemaVersion: 1, evidence, admittedAt });
        };
        const candidateById = new Map(candidates.map(candidate => [candidate.evidence.evidenceId, candidate.evidence]));
        for (const [key, evidenceId] of Object.entries(effective.coverageByRequirement)) {
            const source = candidateById.get(evidenceId);
            if (source === undefined) continue;
            pushSnapshot(source, requirementPartsOf(key));
        }
        for (const [key, ids] of Object.entries(effective.blockingByRequirement)) {
            for (const evidenceId of ids) {
                const source = candidateById.get(evidenceId);
                if (source === undefined) continue;
                pushSnapshot(source, requirementPartsOf(key));
            }
        }
        const indexRead = await readIndex(records, round);
        if (!indexRead.ok) return indexRead.rejection;
        const index = indexRead.index;
        const nextIndex: TaskEvidenceIndexSnapshot = { ref: index.ref,
            revision: index.evidenceIds.length + snapshots.length, schemaVersion: 1,
            evidenceIds: [...index.evidenceIds, ...snapshots.map(snapshot => snapshot.ref.evidenceId)] };
        const finalizedRound: RoundSnapshot = { ...round, revision: round.revision + 1, status: 'finalized',
            outcome, gaps, evidenceRefs: snapshots.map(snapshot => snapshot.ref) };
        const finalized: FinalizedChecks = { snapshot: finalizedRound, outcome, evidence: snapshots,
            applicable: outcome === 'PASS', gaps };
        const prepared: PreparedCommit = { identityKey: identity, fingerprint,
            guards: [
                { refKey: encodeVerificationRoundSnapshot(finalizedRound).refKey, expectedRevision: checked.revision },
                { refKey: encodeTaskEvidenceIndexSnapshot(nextIndex).refKey,
                    expectedRevision: index.revision === 0 ? null : index.revision },
                ...snapshots.map(snapshot => ({ refKey: encodeEvidenceSnapshot(snapshot).refKey, expectedRevision: null as number | null })),
            ],
            records: [encodeVerificationRoundSnapshot(finalizedRound), ...snapshots.map(encodeEvidenceSnapshot),
                encodeTaskEvidenceIndexSnapshot(nextIndex)],
            claims: [], indexGuards: [], indexChanges: [],
            events: [encodeVerificationRoundEvent({ eventId: deps.newId(), eventType: VERIFICATION_ROUND_FINALIZED_EVENT_TYPE,
                schemaVersion: 1, occurredAt: admittedAt, identityKey: identity, roundRef: round.ref, actor, fingerprint,
                result: finalized })] };
        try {
            if (signal.aborted) return cancelled('the round finalize was cancelled before commit');
            const receipt = await records.commit(prepared);
            if (receipt.status !== 'committed') return mapStoreFailure(receipt);
            if (receipt.replayed) {
                return await replayEvent(records, receipt, identity, fingerprint, VERIFICATION_ROUND_FINALIZED_EVENT_TYPE) as WriteResult<FinalizedChecks>;
            }
            return { status: 'committed', value: finalized, replayed: false, cursor: receipt.cursor };
        } catch (error) {
            const recovered = await commitOrRecover(records, prepared, identity, fingerprint, VERIFICATION_ROUND_FINALIZED_EVENT_TYPE, error);
            return recovered as WriteResult<FinalizedChecks>;
        }
    }

    return { openVerification, readVerification, beginCheck, recordCheckResult, submitEvidence, finalizeChecks };
}

// -------------------------------------------------------------------------- //
// Small helpers used by finalize/submit                                       //
// -------------------------------------------------------------------------- //

function collectRequiredCoverage(round: RoundSnapshot): EvidenceCoverageV1[] {
    const seen = new Set<string>();
    const coverage: EvidenceCoverageV1[] = [];
    for (const check of round.verificationPlan.checks) {
        for (const entry of check.coverage) {
            const key = requirementKeyOf(entry);
            if (seen.has(key)) continue;
            seen.add(key);
            coverage.push({ ...entry });
        }
    }
    for (const uncovered of round.verificationPlan.uncovered ?? []) {
        const key = requirementKeyOf(uncovered);
        if (seen.has(key)) continue;
        seen.add(key);
        coverage.push({ obligationId: uncovered.obligationId, requirementId: uncovered.requirementId });
    }
    return coverage;
}

function requirementPartsOf(key: string): EvidenceCoverageV1 {
    const separator = key.indexOf('\u0000');
    return { obligationId: key.slice(0, separator), requirementId: key.slice(separator + 1) };
}

type IndexRead = { ok: true; index: TaskEvidenceIndexSnapshot } | { ok: false; rejection: CoreRejection };

async function readIndex(records: Records, round: RoundSnapshot): Promise<IndexRead> {
    const ref: TaskEvidenceIndexRef = { aggregateType: 'TaskEvidenceIndex', projectId: round.ref.projectId,
        goalId: round.ref.goalId, taskId: round.ref.taskId };
    const key = refKeyOf(ref);
    if (key === null) return { ok: false, rejection: invalid('the task evidence index ref is not canonical JSON') };
    let read;
    try { read = await records.readMany([key]); }
    catch (error) { return { ok: false, rejection: unavailable(`the task evidence index read failed: ${messageOf(error)}`) }; }
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record: EncodedRecord | undefined = read.value.records.find(candidate => candidate.refKey === key);
    if (record === undefined || read.value.missing.includes(key)) {
        return { ok: true, index: { ref, revision: 0, schemaVersion: 1, evidenceIds: [] } };
    }
    const decoded = decodeTaskEvidenceIndexSnapshot(record);
    if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`the task evidence index is damaged: ${decoded.reason}`) };
    return { ok: true, index: decoded.value };
}
