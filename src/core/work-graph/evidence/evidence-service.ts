/**
 * Evidence service.
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
 * Every round, check and TaskEvidenceIndex write is decided by
 * `state/verification-machine.ts` (spec §9 VR-01..VR-05, VR-07,
 * VR-10..VR-15) after the unchanged receipt lookup: the service reads,
 * captures and mints ids, stops at the machine's exported guard steps where it
 * stopped before each IO, and translates the machine's effects into the commit.
 * A subject has at most one round chain (VD-1, VD-15): `openVerification`
 * reads the subject's rounds before the capture and claims the subject slot in
 * the commit; `queryRoundChainHead` reads the chain head (VD-14).
 * `reverifyRound` (A.2 step 5.9, VR-14/VR-15, VD-12, VD-13) opens the
 * successor of a finalized non-PASS head through the same opening path
 * (`prepareRoundOpening`, LA-5) and moves the slot from the head to it, or
 * commits one policy refusal (`TaskReworkRefusal`, operation `reverify`).
 *
 * The service never calls completeTask/completeGoal, never releases or advances
 * a Task/Run/Session, and never fabricates a PASS from a missing/blocked check.
 */
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext, CorePrincipal, MaterialReader } from '../../../contracts/core/call-context.js';
import type { VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { EffectWriteResultV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import { messageOf } from '../../../contracts/error-message.js';
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type {
    EffectivityAnchorV1, EvidenceOutcome, EvidenceRef, EvidenceSnapshot, EvidenceV1,
} from '../../../contracts/evidence.js';
import { EVIDENCE_SUMMARY_MAX_BYTES } from '../../../contracts/evidence.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import {
    MAX_NEW_BASIS_INPUT_REFS, REPORT_CONTENT_TYPE, type NewBasisInputRefV1, type SourceStampV1,
} from '../../../contracts/no-progress.js';
import type { PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../../contracts/plan.js';
import type { RunRef, RunSnapshot, SourceRefV1, TaskTriple } from '../../../contracts/dispatch.js';
import {
    DEFAULT_TASK_AUTOMATION_POLICY, GOAL_FAN_OUT_ACTOR, MAX_AUTO_REWORK_LIMIT, TASK_REWORK_REASON_MAX_CHARS, reworkActorClassOf,
    type ReworkActorClass, type TaskAutomationPolicyV1, type TaskReworkRefusalRef, type TaskReworkRefusalSnapshotV1,
} from '../../../contracts/task-requeue.js';
import { MIB } from '../../../contracts/resource-caps.js';
import type {
    CheckCapabilityV1, CheckExecutionTicket, CheckProcessObservation, RoundCheckSnapshot, RoundSnapshot,
    TrustedCheckConfiguration, VerificationRoundRef,
} from '../../../contracts/verification.js';
import type {
    VerificationRoundMaterialIdentity, VerificationRoundSourcePort, VerificationRoundSourceResult,
} from '../../../contracts/verification-context.js';
import { canonicalJson, canonicalOf, sameJson as sameRef, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { rejected, rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type {
    EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreCommitReceipt,
    UniqueClaimChange,
} from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { WorkspaceHostBindings } from '../../workspace/access.js';
import type { SessionMailboxPort } from '../model/communication-contracts.js';
import type { MaterialPort } from '../model/material-contracts.js';
import { architectureBaselineDigest, readArchitectureBaselineSnapshot } from '../architecture/catalog-record-codecs.js';
import {
    readBatch, readGoal, readGoalRunsForCount, readPinnedCompletionPolicy, readPlan, readPointerIntents, readRevisionNumber,
    type Rejected as ReadRejected,
} from '../tasks/plan-readers.js';
import { planRevisionRefKey } from '../persistence/plan-record-codecs.js';
import {
    TASK_REWORK_EVENT_SCHEMA_VERSION, TASK_REWORK_REFUSED_EVENT_TYPE, decodeTaskReworkRefusalSnapshot,
    encodeTaskReworkRefusalSnapshot, encodeTaskReworkRefusedEvent, taskRequeueRefKey, taskReworkRefusalRefKey,
    taskReworkRefusedEventFromEvent, type TaskReworkRefusedEvent,
} from '../tasks/claim-record-codecs.js';
import {
    buildEffectiveTaskBasis, isBasisUnsupported,
} from '../tasks/plan-task-basis.js';
import {
    bindTrustedContext, isolateWrite, loadReplayEvent, mapStoreFailure, mergeGuards,
} from '../tasks/execution-entry-service.js';
import {
    authorizeDelegatedWrite, identifyDelegatedWriter, type AgentPlanWriter, type PlanDelegatedWriteDependencies,
} from '../tasks/plan-write-admission.js';
import { REWORK_NOTE_CONTENT_TYPE, newBasisInputsProblem } from '../tasks/requeue-service.js';
import { newBasisInputRefsProblem } from '../persistence/rework-codecs.js';
import { reverifyBasis } from '../state/no-progress.js';
import { decisionActionPolicy } from '../state/decision-policy.js';
import { readGoalSettings as goalSettingsOf } from '../persistence/record-codecs.js';
import {
    countEndedGoalRuns, reworkFenceOf, reworkPermission, taskReworkRefusalEffects, type ReworkFence,
} from '../state/task-failure.js';
import {
    checkEventAdmission, finalizeRoundOutcome, foldVerdictChecks, frozenBindingProblem, nextTaskEvidenceIndex, outcomeFor,
    reverifyAdmissionProblem, reverifyCapRefusal, reverifyExemption, reverifyFailureClass, successorAutoCount,
    roundActivityProblem, roundChainHead, roundGoalActivityProblem, roundOpenBasisProblem, roundOpenChainProblem,
    roundOpenChecksProblem, roundOpenPointerProblem, roundOpenSubjectProblem, roundReviewerEvidenceProblem,
    roundSubjectActivityProblem, roundWriteAdmission, taskEvidenceIndexRefOf, transitionCheck, transitionRound,
    type CheckEvent, type RoundActivityFactsV1, type CheckVerdictDecisionV1, type RoundChainHeadV1, type RoundFoldFactsV1, type RoundGuardContext,
    type RoundOpenFactsV1, type RoundReverifyFactsV1, type RoundSubjectRelationV1, type RoundSuccessorV1, type SuccessorRoundBuildV1,
    type TaskEvidenceIndexReadV1, type TaskEvidenceIndexWrite, type VerificationEffect,
} from '../state/verification-machine.js';
import { unreachable, type Rejected } from '../state/transition.js';
import { compileVerificationPlan } from './verification-plan.js';
import { evidenceApplicabilityWithBasis } from '../tasks/evidence-coverage.js';
import {
    VERIFICATION_CHECK_ABANDONED_EVENT_TYPE, VERIFICATION_CHECK_BEGUN_EVENT_TYPE,
    VERIFICATION_CHECK_INTERRUPTED_EVENT_TYPE, VERIFICATION_CHECK_RESULT_RECORDED_EVENT_TYPE,
    VERIFICATION_ROUND_BY_TASK_LOOKUP, VERIFICATION_ROUND_FINALIZED_EVENT_TYPE,
    VERIFICATION_ROUND_OPENED_EVENT_TYPE, VERIFICATION_ROUND_ORIGINAL_LOOKUP, VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT,
    VERIFICATION_ROUND_REVERIFIED_EVENT_TYPE,
    checkObservationProblem, decodeVerificationRoundSnapshot,
    encodeEvidenceSnapshot, encodeTaskEvidenceIndexSnapshot, encodeVerificationRoundEvent,
    encodeVerificationRoundSnapshot, verificationRoundEventFromEvent, decodeTaskEvidenceIndexSnapshot,
    type VerificationRoundEvent,
} from '../persistence/evidence-record-codecs.js';
import {
    decodeNoticeOrigin, type NoticeOriginWireV1,
} from '../persistence/decision-record-codecs.js';
import type {
    AbandonCheckInput, EvidencePort, FinalizedChecks, InterruptCheckInput,
    OriginalVerificationQuery, ReverifyOutcomeV1, ReverifyRoundInput, RoundChainHeadQuery,
} from '../model/evidence-contracts.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import { sessionMessageRefProblem } from '../tasks/codec-shape-checks.js';

type Records = GoalRecordTransactionPort & RecordLookupPort;
type HostActor = { kind: 'human' | 'system'; id: string };
type LoadedRound = { ok: true; round: RoundSnapshot } | { ok: false; rejection: CoreRejection };

// -------------------------------------------------------------------------- //
// Small pure helpers                                                          //
// -------------------------------------------------------------------------- //

function invalid(reason: string): CoreRejection { return rejected('invalid', reason); }
function forbidden(reason: string): CoreRejection { return rejected('forbidden', reason); }
function unavailable(reason: string): CoreRejection { return rejected('unavailable', reason); }
function notFound(reason: string): CoreRejection { return rejected('not_found', reason); }
function incomplete(reason: string): CoreRejection { return rejected('incomplete', reason); }
function unsupported(reason: string): CoreRejection { return rejected('unsupported', reason); }
function cancelled(reason: string): CoreRejection { return rejected('cancelled', reason); }
function fingerprintOf(value: unknown): string { return sha256Hex(canonicalJson(value as JsonValue)); }
function digestOf(value: unknown): string { return sha256Hex(canonicalJson(value as JsonValue)); }
function identityKeyOf(prefix: string, actor: Pick<ActorRef, 'kind' | 'id'>, projectId: string, workspaceId: string,
    requestId: string): string {
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
function mapRejected(result: ReadRejected): CoreRejection {
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
    return rejectedWithCurrent('source_stale', capture.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ') || 'the workspace source changed');
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
function boundedSummary(text: string): string {
    if (Buffer.byteLength(text, 'utf8') <= EVIDENCE_SUMMARY_MAX_BYTES) return text;
    let end = Math.min(text.length, EVIDENCE_SUMMARY_MAX_BYTES);
    while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > EVIDENCE_SUMMARY_MAX_BYTES) end -= 1;
    return text.slice(0, end);
}
/**
 * L16（决定 55）：`recordCheckResult` 收到的观察里，`executed` 且报告 `memory: 'cap_hit'`
 * 时把那次的上限（MiB）读出来，随同一次提交写进检查快照；别的观察不写这个字段。
 * 上限值是 1 MiB 的整数倍（Kernel L13），所以这里是精确的商。
 */
function resourceCapHitOf(observation: CheckProcessObservation): NonNullable<RoundCheckSnapshot['resourceCapHit']> | undefined {
    if (observation.kind !== 'executed') return undefined;
    const report = observation.resourceCaps;
    if (report === undefined || report.status !== 'applied' || report.memory !== 'cap_hit') return undefined;
    return { memory: 'cap_hit', memoryCapMiB: report.memoryMaxBytes / MIB };
}
function anchorOf(round: RoundSnapshot): EffectivityAnchorV1 {
    return { schemaVersion: 1, planRef: round.adoptedPlanRef, planRevision: round.verificationPlan.planRevision,
        workspaceRevision: round.identity.workspaceRevision,
        pinnedCompletionPolicy: round.verificationPlan.pinnedCompletionPolicy,
        pinnedArchitectureBaseline: round.verificationPlan.pinnedArchitectureBaseline };
}

// -------------------------------------------------------------------------- //
// The verification machine (spec §9)                                          //
// -------------------------------------------------------------------------- //

/** The round machines' guard context for this caller; a service call never holds the reconcile lease. */
function roundCtx(executor: HostActor, actor: HostActor, expectedRevision: number | null): RoundGuardContext {
    return { callerIsExecutor: executor.kind === actor.kind && executor.id === actor.id, expectedRevision,
        instanceLeaseHeld: false };
}

type Refused = { ok: false; code: CoreError; detail: string };

/** A machine refusal as today's rejection (§1.2: code and reason kept); a stale pin also reports the round's revision. */
function refusalOf(refusal: Refused, round?: RoundSnapshot): CoreRejection;
function refusalOf(refusal: Rejected | null, round?: RoundSnapshot): CoreRejection | null;
function refusalOf(refusal: Refused | Rejected | null, round?: RoundSnapshot): CoreRejection | null {
    if (refusal === null || refusal.ok) return null;
    return rejectedWithCurrent(refusal.code, refusal.detail, refusal.code === 'revision_conflict' && round !== undefined
        ? [{ ref: round.ref, revision: round.revision }] : undefined);
}

/** The effect of one kind (a decided write carries each kind at most once). */
function effectOf<K extends VerificationEffect['kind']>(effects: readonly VerificationEffect[], kind: K):
Extract<VerificationEffect, { kind: K }> | undefined {
    return effects.find((effect): effect is Extract<VerificationEffect, { kind: K }> => effect.kind === kind);
}

/** One decided write: the parts its effects select for the ONE commit. */
type RoundWrite<T> = {
    identity: string;
    fingerprint: string;
    effects: readonly VerificationEffect[];
    /** The machine's next round, written under its CAS when the effects carry `guard_round`. */
    round: RoundSnapshot;
    /**
     * L14 end: VR-07 only. The finalization instant written at the round record
     * top level (`finalizedAt`), the same `deps.now()` as the event's
     * `occurredAt`; every other write leaves it to `preservedRoundNoticeOrigin`.
     */
    finalizedAt?: string;
    /** `guard_open_read_set` / `guard_finalize_read_set` / `guard_begin_read_set`: the CAS of every record the operation read. */
    readSet?: readonly RecordGuard[];
    /** `admit_verdict_evidence`: the Evidence@1 rows built from the effect. */
    evidence?: readonly EvidenceSnapshot[];
    /** `append_task_evidence_index`. */
    index?: TaskEvidenceIndexWrite;
    event: VerificationRoundEvent;
    value: T;
    /** The cancel refusal checked just before the commit; null where there is none (`recordCheckResult`). */
    cancelled: string | null;
    /**
     * `claim_round_slot`: the owner's own answer to a lost slot (VR-01), read
     * again from the subject's rounds instead of the generic store mapping.
     */
    slotTaken?: () => Promise<CoreRejection>;
};

/**
 * SPEC §2.5: a later update of an existing round copies its creation wire origin
 * (`since`, and the automatic `noticeAutomationCap`) verbatim and never re-binds
 * it. A stored round without a `since` is damaged (decision 79), not a legacy
 * origin, so the update is refused. This is the exact analogue of the mailbox's
 * `preservedNoticeOrigin`.
 */
async function preservedRoundNoticeOrigin(records: Records, ref: VerificationRoundRef): Promise<
    { ok: true; value: NoticeOriginWireV1 } | { ok: false; rejection: CoreRejection }> {
    const key = canonicalOf(ref);
    if (key === null) return { ok: false, rejection: invalid('the round ref is not canonical JSON') };
    let read: Awaited<ReturnType<Records['readMany']>>;
    try {
        read = await records.readMany([key]);
    } catch {
        return { ok: false, rejection: unavailable('the round notice origin could not be read') };
    }
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record = read.value.records.find(candidate => candidate.refKey === key);
    if (record === undefined) return { ok: false, rejection: unavailable('the updated round is missing') };
    const decoded = decodeNoticeOrigin(record);
    if (decoded.status !== 'decoded') {
        return { ok: false, rejection: unavailable(`the round notice origin is damaged: ${decoded.reason}`) };
    }
    if (decoded.value.since === undefined) {
        return { ok: false, rejection: unavailable('the round notice origin has no stored creation position') };
    }
    const origin: NoticeOriginWireV1 = { since: decoded.value.since };
    if (decoded.value.noticeAutomationCap !== undefined) origin.noticeAutomationCap = decoded.value.noticeAutomationCap;
    // L14 end: a later rewrite of a finalized round keeps its VR-07
    // `finalizedAt` exactly like `since` (never re-binds it).
    if (decoded.value.finalizedAt !== undefined) origin.finalizedAt = decoded.value.finalizedAt;
    return { ok: true, value: origin };
}

/**
 * Translates the effects into ONE RecordStore commit and commits it. Guards:
 * round, read set, index, then each Evidence (CAS null); records: round,
 * Evidence, index; claims: the round slot. A replayed or lost commit restores
 * the original event result.
 */
async function commitRoundWrite<T>(records: Records, signal: AbortSignal, write: RoundWrite<T>): Promise<WriteResult<T>> {
    type Guarded = { record: EncodedRecord; guard: RecordGuard };
    const guarded = (record: EncodedRecord, expectedRevision: number | null): Guarded => ({ record, guard: { refKey: record.refKey, expectedRevision } });
    let round: Guarded[] = [];
    let readSet: readonly RecordGuard[] = [];
    let evidence: Guarded[] = [];
    let index: Guarded[] = [];
    let claims: UniqueClaimChange[] = [];
    let events: EncodedDomainEvent[] = [];
    // Slice 2B F20/L9/L14: a round's CREATING commit binds its cursor to the
    // record top-level `since`, exactly as `commitReverify` already does for an
    // automatic successor. Without this a freshly opened round reads as a
    // legacy no-`since` round and never enters the activity calendar.
    let roundOriginBinding: PreparedCommit['commitCursorBindings'] = undefined;
    for (const effect of write.effects) {
        switch (effect.kind) {
            case 'guard_round': {
                // §2.5: an update copies the round's stored creation origin
                // (`since`/`noticeAutomationCap`) instead of dropping it; the
                // creating commit writes the null `since` placeholder the Store
                // binds to this commit's cursor.
                // L14 end: VR-07 adds the finalization instant on top.
                let origin: NoticeOriginWireV1;
                if (effect.expectedRevision !== null) {
                    const preserved = await preservedRoundNoticeOrigin(records, write.round.ref);
                    if (!preserved.ok) return preserved.rejection;
                    origin = preserved.value;
                } else {
                    origin = { since: null };
                }
                if (write.finalizedAt !== undefined) {
                    origin = { ...origin, finalizedAt: write.finalizedAt };
                }
                const record = encodeVerificationRoundSnapshot(write.round, origin);
                if (effect.expectedRevision === null) roundOriginBinding = [{ refKey: record.refKey, field: 'since' }];
                round = [guarded(record, effect.expectedRevision)];
                break;
            }
            case 'guard_open_read_set':
            case 'guard_finalize_read_set':
            case 'guard_begin_read_set':
                readSet = write.readSet ?? [];
                break;
            case 'admit_verdict_evidence':
                evidence = (write.evidence ?? []).map(snapshot => guarded(encodeEvidenceSnapshot(snapshot), null));
                break;
            case 'append_task_evidence_index':
                if (write.index?.write === true) index = [guarded(encodeTaskEvidenceIndexSnapshot(write.index.record), write.index.expectedRevision)];
                break;
            case 'emit_event':
                if (effect.eventType !== write.event.eventType) throw new Error(`the decided event is ${effect.eventType}, not ${write.event.eventType}`);
                events = [encodeVerificationRoundEvent(write.event)];
                break;
            case 'claim_round_slot': claims = [{ ...effect.claim }]; break;
            case 'guard_predecessor':
            case 'guard_reverify_read_set':
            case 'refuse_reverify':
                throw new Error(`${effect.kind} belongs to a reverify write (commitReverify)`);
            // Only VR-09 (`task_requeued`) decides it, and no operation of this service passes that event:
            // the requeue owner translates it in its own commit (`tasks/requeue-service.ts`).
            case 'guard_round_unchanged':
                throw new Error(`${effect.kind} belongs to a requeue write (requeue-service)`);
            default: return unreachable(effect, 'verification effect');
        }
    }
    const merged = mergeGuards([...round.map(entry => entry.guard), ...readSet,
        ...[...index, ...evidence].map(entry => entry.guard)]);
    if (!merged.ok) return merged.rejection;
    const prepared: PreparedCommit = { identityKey: write.identity, fingerprint: write.fingerprint, guards: merged.guards,
        records: [...round, ...evidence, ...index].map(entry => entry.record), claims, indexGuards: [], indexChanges: [], events,
        ...(roundOriginBinding === undefined ? {} : { commitCursorBindings: roundOriginBinding }) };
    const eventType = write.event.eventType;
    try {
        if (write.cancelled !== null && signal.aborted) return cancelled(write.cancelled);
        const receipt = await records.commit(prepared);
        if (receipt.status !== 'committed') {
            if (receipt.code === 'unique_conflict' && write.slotTaken !== undefined) return await write.slotTaken();
            return mapStoreFailure(receipt);
        }
        if (receipt.replayed) return await replayEvent(records, receipt, write.identity, write.fingerprint, eventType) as WriteResult<T>;
        return { status: 'committed', value: write.value, replayed: false, cursor: receipt.cursor };
    } catch (error) {
        return await commitOrRecover(records, write.identity, write.fingerprint, eventType, error) as WriteResult<T>;
    }
}

// -------------------------------------------------------------------------- //
// Store helpers                                                               //
// -------------------------------------------------------------------------- //

async function readRoundRecord(records: Records, ref: VerificationRoundRef): Promise<LoadedRound> {
    const key = canonicalOf(ref);
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

/**
 * VD-9 facts of a fresh check begin (VR-02): the round's Goal and the subject
 * task's disposition in the Goal's CURRENT adopted Plan (null: that Plan does
 * not name it, or there is none), with the guards of both reads (Goal@rev,
 * Plan@rev); a W16 or a Goal control between the read and the commit moves the
 * Goal revision and conflicts.
 */
async function readRoundActivity(records: Records, scope: { projectId: string; workspaceId: string }, round: RoundSnapshot):
Promise<{ ok: true; facts: RoundActivityFactsV1; guards: RecordGuard[] } | { ok: false; rejection: CoreRejection }> {
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: round.subject.projectId, goalId: round.subject.goalId };
    const goalRead = await readGoal(records, goalRef);
    if (goalRead.status !== 'ready') return { ok: false, rejection: mapRejected(goalRead) };
    const goal = goalRead.goal;
    if (goal.workspaceRef.projectId !== scope.projectId || goal.workspaceRef.workspaceId !== scope.workspaceId) {
        return { ok: false, rejection: forbidden('the round Goal belongs to another workspace') };
    }
    const goalKey = canonicalOf(goalRef);
    if (goalKey === null) return { ok: false, rejection: invalid('the round Goal ref is not canonical JSON') };
    const guards: RecordGuard[] = [{ refKey: goalKey, expectedRevision: goal.revision }];
    let subjectDisposition: RoundActivityFactsV1['subjectDisposition'] = null;
    if (goal.desiredState === 'active' && goal.activePlanRevision !== null) {
        const planRead = await readPlan(records, goal.activePlanRevision);
        if (planRead.status !== 'ready') return { ok: false, rejection: mapRejected(planRead) };
        subjectDisposition = planRead.plan.tasks.find(task => task.taskId === round.subject.taskId)?.disposition ?? null;
        guards.push({ refKey: planRevisionRefKey(goal.activePlanRevision), expectedRevision: planRead.plan.revision });
    }
    return { ok: true, facts: { goalDesiredState: goal.desiredState, subjectDisposition }, guards };
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
    const key = canonicalOf(pin.ref);
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
        return { ok: false, rejection: rejectedWithCurrent('source_stale', 'the pinned ArchitectureBaseline content revision disagrees with the adopted pin') };
    }
    const digest = architectureBaselineDigest(body as { schemaVersion?: unknown; baselineId?: unknown; contentRevision?: unknown; content?: unknown });
    if (digest === null) return { ok: false, rejection: incomplete('the pinned ArchitectureBaseline content is not canonical JSON') };
    if (digest !== pin.digest) return { ok: false, rejection: rejectedWithCurrent('source_stale', 'the pinned ArchitectureBaseline digest disagrees with the adopted pin') };
    if (record.revision !== snapshot.revision) return { ok: false, rejection: unavailable('the ArchitectureBaseline outer revision disagrees with its body') };
    return { ok: true, guard: { refKey: key, expectedRevision: record.revision } };
}

/** The formal Workspace record's current domain revision. Read through the same
 * existing Plan reader owner; a missing/corrupt row is never a default. */
async function readWorkspaceRevision(records: Records, workspaceRef: { aggregateType: 'Workspace'; projectId: string; workspaceId: string }):
Promise<{ ok: true; revision: number } | { ok: false; rejection: CoreRejection }> {
    const key = canonicalOf(workspaceRef);
    if (key === null) return { ok: false, rejection: incomplete('the Workspace ref is not canonical JSON') };
    const read = await readBatch(records, [key]);
    if (read.status !== 'ready') return { ok: false, rejection: mapRejected(read) };
    const revision = readRevisionNumber(read.batch, key);
    if (revision === null) return { ok: false, rejection: notFound('the subject Workspace does not exist') };
    return { ok: true, revision };
}

/** The subject task's evidence index as read (VR-10..12); a missing row reads as revision 0 with no ids. */
async function readIndex(records: Records, round: RoundSnapshot):
Promise<{ ok: true; index: TaskEvidenceIndexReadV1 } | { ok: false; rejection: CoreRejection }> {
    const ref = taskEvidenceIndexRefOf(round);
    const key = canonicalOf(ref);
    if (key === null) return { ok: false, rejection: invalid('the task evidence index ref is not canonical JSON') };
    let read;
    try { read = await records.readMany([key]); }
    catch (error) { return { ok: false, rejection: unavailable(`the task evidence index read failed: ${messageOf(error)}`) }; }
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record: EncodedRecord | undefined = read.value.records.find(candidate => candidate.refKey === key);
    if (record === undefined || read.value.missing.includes(key)) {
        return { ok: true, index: { ref, exists: false, revision: 0, evidenceIds: [] } };
    }
    const decoded = decodeTaskEvidenceIndexSnapshot(record);
    if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`the task evidence index is damaged: ${decoded.reason}`) };
    return { ok: true, index: { ...decoded.value, exists: true } };
}

/**
 * One subject's round chain (§9.1 lookups, VD-14): the work chain of the
 * subject Run (`VerificationRoundBySubject`) or, with `subjectRunRef: null`,
 * the gate's chain over every producer (`VerificationRoundByTask`, VD-15). At
 * most `ROUND_CHAIN_MAX + 1` rows; a next page cannot be judged
 * (`incomplete`). Each row is rechecked against the scope and the subject (a
 * candidate index only); legacy slot-less rounds are read like any other.
 */
async function readSubjectChain(
    records: Records,
    scope: { projectId: string; workspaceId: string },
    subject: TaskTriple,
    subjectRunRef: RunRef | null,
): Promise<{ ok: true; chain: RoundChainHeadV1 } | { ok: false; rejection: CoreRejection }> {
    let lookup;
    try {
        lookup = await records.lookup(subjectRunRef === null
            ? { index: VERIFICATION_ROUND_BY_TASK_LOOKUP, values: [scope.projectId, scope.workspaceId, subject.goalId, subject.taskId],
                limit: VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT }
            : { index: VERIFICATION_ROUND_ORIGINAL_LOOKUP,
                values: [scope.projectId, scope.workspaceId, subject.goalId, subject.taskId, subjectRunRef.runId],
                limit: VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT });
    } catch (error) {
        return { ok: false, rejection: unavailable(`the round chain lookup failed: ${messageOf(error)}`) };
    }
    if (lookup.status !== 'ready') return { ok: false, rejection: mapStoreFailure(lookup) };
    if (lookup.value.next !== null) {
        return { ok: false, rejection: incomplete('the round chain is longer than the chain limit; refusing to guess its head') };
    }
    const rounds: RoundSnapshot[] = [];
    for (const record of lookup.value.records) {
        const decoded = decodeVerificationRoundSnapshot(record);
        if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`a chain round is damaged: ${decoded.reason}`) };
        const round = decoded.value;
        if (round.ref.projectId !== scope.projectId || round.ref.workspaceId !== scope.workspaceId
            || !sameRef(round.subject, subject) || (subjectRunRef !== null && !sameRef(round.subjectRunRef, subjectRunRef))) {
            return { ok: false, rejection: unavailable('an indexed round does not match the requested subject') };
        }
        rounds.push(round);
    }
    return { ok: true, chain: roundChainHead(rounds) };
}

/**
 * VR-01 (D-3, §9.4): whether a TaskRequeue covers the subject Run, and the
 * absence guard the open commits with. A backend without the claim schemas
 * cannot hold a TaskRequeue: `unsupported` is a confirmed absence with no guard.
 */
async function readRequeueCover(
    records: Records, run: Pick<RunSnapshot, 'ref' | 'task'>,
): Promise<{ ok: true; covered: boolean; guards: RecordGuard[] } | { ok: false; rejection: CoreRejection }> {
    const key = taskRequeueRefKey({ aggregateType: 'TaskRequeue', projectId: run.ref.projectId, goalId: run.ref.goalId,
        taskId: run.task.taskId, afterRunId: run.ref.runId });
    const read = await records.readMany([key]);
    if (read.status !== 'ready') {
        if (read.code === 'unsupported') return { ok: true, covered: false, guards: [] };
        return { ok: false, rejection: mapStoreFailure(read) };
    }
    const covered = read.value.records.some(record => record.refKey === key);
    return { ok: true, covered, guards: covered ? [] : [{ refKey: key, expectedRevision: null }] };
}

/** VD-1/VD-15 answered with the head pin (§9.4): the caller re-reads the head, never a second root. */
function chainRefusal(refusal: Rejected, chain: RoundChainHeadV1): CoreRejection {
    if (refusal.ok) throw new Error('chainRefusal needs a refusal');
    return rejectedWithCurrent(refusal.code, refusal.detail, chain.kind === 'head' && refusal.code === 'busy'
        ? [{ ref: chain.head.ref, revision: chain.head.revision }] : undefined);
}

// -------------------------------------------------------------------------- //
// VR-14 request helpers (C5, VD-12)                                           //
// -------------------------------------------------------------------------- //

/** A reverify caller: a Host principal (operator or platform automation) or an Agent's `work_run` principal. */
type ReverifyCaller =
    | { kind: 'host'; ctx: CoreCallContext; scope: { projectId: string; workspaceId: string }; signal: AbortSignal; actor: HostActor }
    | { kind: 'work_run'; ctx: CoreCallContext; scope: { projectId: string; workspaceId: string }; signal: AbortSignal };

/** Bind the caller synchronously before the first await (Host: `bindTrustedContext`; work_run: its own scope and signal). */
function bindReverifyCaller(ctx: CoreCallContext): ReverifyCaller | CoreRejection {
    const raw = ctx as unknown as { projectId?: unknown; workspaceId?: unknown; principal?: unknown;
        materialReader?: unknown; signal?: unknown } | null | undefined;
    if (raw === null || raw === undefined || !isRecord(raw.principal) || raw.principal['kind'] !== 'work_run') {
        const bound = bindTrustedContext(ctx);
        if (!bound.ok) return bound.rejection;
        return { kind: 'host', ctx: bound.ctx, scope: bound.scope, signal: bound.signal, actor: bound.actor };
    }
    const { projectId, workspaceId, signal } = raw;
    if (!nonEmpty(projectId) || !nonEmpty(workspaceId)) return forbidden('a reverify requires a bound project/workspace context');
    if (!isRecord(signal) || typeof signal['aborted'] !== 'boolean' || typeof signal['addEventListener'] !== 'function') {
        return forbidden('a reverify requires the bound AbortSignal');
    }
    let principal: unknown;
    let materialReader: unknown;
    try {
        principal = structuredClone(raw.principal);
        materialReader = structuredClone(raw.materialReader);
    } catch {
        return invalid('the call context identity cannot be isolated from the caller');
    }
    const bound = signal as unknown as AbortSignal;
    return { kind: 'work_run', scope: { projectId, workspaceId }, signal: bound, ctx: { projectId, workspaceId,
        principal: principal as CorePrincipal, materialReader: materialReader as MaterialReader, signal: bound } };
}

/** The fixed platform attribution of the reverify owner's Host-only reads (WG11, pointer intents). */
const REVERIFY_READ_ACTOR = Object.freeze({ kind: 'system' as const, id: 'evidence-reverify-reader' });

/** A trusted Host context for exactly this scope and signal with the given actor (reads, or the configured executor's grant). */
function hostContextOf(scope: { projectId: string; workspaceId: string }, actor: HostActor, signal: AbortSignal): CoreCallContext {
    const bound = { kind: actor.kind, id: actor.id };
    return { projectId: scope.projectId, workspaceId: scope.workspaceId, principal: { kind: 'host', actor: bound },
        materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: bound }, signal };
}

const REVERIFY_INPUT_KEYS: readonly string[] = ['predecessorRoundRef', 'onlyIfSourceChanged', 'newInputRefs', 'reason', 'note',
    'acknowledgement'];

/** The `ReverifyRoundInput` shape (§9 VD-12); the actor-dependent fields (`note`) are judged by the matrix (step 5). */
function reverifyInputProblem(input: ReverifyRoundInput, scope: { projectId: string; workspaceId: string }): CoreRejection | null {
    const raw = input as unknown as Record<string, unknown>;
    if (!Object.keys(raw).every(key => REVERIFY_INPUT_KEYS.includes(key))) return invalid('the reverify input carries unknown fields');
    // 7A §3.5: the acknowledgement is shape-checked only; the owner reads no
    // message and compares no scope. It joins the fingerprint only when present.
    if (input.acknowledgement !== undefined) {
        const acknowledgementProblem = sessionMessageRefProblem(input.acknowledgement, 'reverifyRound acknowledgement');
        if (acknowledgementProblem !== null) return invalid(acknowledgementProblem);
    }
    const refProblem = roundRefProblem(raw['predecessorRoundRef']);
    if (refProblem !== null) return invalid(refProblem);
    if (input.predecessorRoundRef.projectId !== scope.projectId || input.predecessorRoundRef.workspaceId !== scope.workspaceId) {
        return forbidden('the predecessor round is outside the trusted scope');
    }
    if (raw['onlyIfSourceChanged'] !== undefined && typeof raw['onlyIfSourceChanged'] !== 'boolean') {
        return invalid('onlyIfSourceChanged must be a boolean when present');
    }
    if (raw['newInputRefs'] !== undefined) {
        const inputsProblem = newBasisInputRefsProblem(raw['newInputRefs'], 'reverify newInputRefs');
        if (inputsProblem !== null) return invalid(inputsProblem);
    }
    const reason = raw['reason'];
    if (reason !== undefined && (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > TASK_REWORK_REASON_MAX_CHARS)) {
        return invalid(`the reverify reason must be non-empty and at most ${TASK_REWORK_REASON_MAX_CHARS} characters`);
    }
    const note = raw['note'];
    if (note !== undefined && (typeof note !== 'string' || note.trim().length === 0)) return invalid('the reverify note must be non-empty text');
    return null;
}

/** §13.7 point 9: exactly the predecessor@rev, and optionally `TaskReworkRefusal(reverify, predecessor)@k` (0 = absent). */
function reverifyPinsOf(expected: readonly VersionPin[], predecessorRef: VerificationRoundRef, refusalRef: TaskReworkRefusalRef):
{ ok: true; predecessor: number; refusal: number | null } | CoreRejection {
    let predecessor: number | null = null;
    let refusal: number | null = null;
    for (const pin of expected as readonly unknown[]) {
        if (!isRecord(pin) || !isRecord(pin['ref']) || !Number.isSafeInteger(pin['revision']) || (pin['revision'] as number) < 0) {
            return invalid('every expected pin needs a ref and a safe non-negative revision');
        }
        const revision = pin['revision'] as number;
        if (sameRef(pin['ref'], predecessorRef) && predecessor === null && revision >= 1) predecessor = revision;
        else if (sameRef(pin['ref'], refusalRef) && refusal === null) refusal = revision;
        else return invalid('meta.expected must be the predecessor round pin and the optional reverify refusal pin without extras');
    }
    if (predecessor === null) return invalid('meta.expected must pin the predecessor round');
    return { ok: true, predecessor, refusal };
}

/** Canonical pin order for the fingerprint (the same request in another pin order is the same request). */
function sortedPins(expected: readonly VersionPin[]): { ref: VersionPin['ref']; revision: number }[] {
    return [...expected].map(pin => ({ ref: pin.ref, revision: pin.revision }))
        .sort((left, right) => {
            const leftKey = canonicalOf(left.ref) ?? '';
            const rightKey = canonicalOf(right.ref) ?? '';
            return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        });
}

/** The reverify refusal record as read: absent (k = 0), or @k; `unsupported` (no claim schemas) is a confirmed absence. */
async function readReverifyRefusal(records: Records, ref: TaskReworkRefusalRef):
Promise<{ ok: true; current: TaskReworkRefusalSnapshotV1 | null; key: string } | { ok: false; rejection: CoreRejection }> {
    const key = taskReworkRefusalRefKey(ref);
    let read;
    try { read = await records.readMany([key]); }
    catch (error) { return { ok: false, rejection: unavailable(`the reverify refusal read failed: ${messageOf(error)}`) }; }
    if (read.status !== 'ready') {
        if (read.code === 'unsupported') return { ok: true, current: null, key };
        return { ok: false, rejection: mapStoreFailure(read) };
    }
    const record = read.value.records.find(candidate => candidate.refKey === key);
    if (record === undefined) return { ok: true, current: null, key };
    const decoded = decodeTaskReworkRefusalSnapshot(record);
    if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`the reverify refusal is damaged: ${decoded.reason}`) };
    return { ok: true, current: decoded.value, key };
}

// -------------------------------------------------------------------------- //
// The factory                                                                 //
// -------------------------------------------------------------------------- //

/**
 * R6 cold-start scoped checks resolver. It returns the CURRENT trusted checks
 * configuration for exactly one workspace scope, or `undefined` when that scope
 * has none. A fresh round resolves and FREEZES its own configuration; an
 * already-open round/ticket keeps the exact configuration it recorded. The
 * resolver never crosses a workspace and never widens a permission: Stage 2
 * reuses the existing Host workspace authorization to build the configuration.
 */
export type CheckConfigurationResolver = (scope: WorkspaceScope) => TrustedCheckConfiguration | undefined;

/**
 * Slice 5 §3.2/§4.4 (F37) seam: the autonomy verdict for an automatic reverify.
 * The evidence owner keeps every existing cap, chain and admission check; this
 * injected seam only decides whether `auto_reverify` proceeds automatically (a
 * "请知悉" notice) or must become a `needs_decision` cause instead. Absent, the
 * Goal's own autonomy setting decides (`decisionActionPolicy`).
 */
export type AutomaticReverifyPolicyV1 = (input: {
    goal: GoalSnapshot;
    actorClass: ReworkActorClass;
    countedNext: number | null;
    cap: number;
}) => 'automatic_notice' | 'needs_decision';

/**
 * R3e.1 the service's exact raw dependencies, kept beside the factory that
 * reads them (task D X2, decision 40). The dependency set is exactly what the
 * service reads:
 *  - the ONE RecordStore transaction/lookup pair already owned by composition;
 *  - the same Material body port (store/open);
 *  - the existing ExecutionReadPort for the real subject Run;
 *  - the trusted WorkspaceHostBindings + the existing
 *    `VerificationRoundSourcePort` (VerificationWorkspaceReader);
 *  - the optional frozen trusted checks configuration (absent => fresh
 *    open/begin are explicitly unsupported while history reads keep working).
 */
export type EvidenceServiceDependencies = {
    records: GoalRecordTransactionPort & RecordLookupPort;
    materials: MaterialPort;
    executions: ExecutionReadPort;
    workspaceHost: WorkspaceHostBindings;
    source: VerificationRoundSourcePort;
    /** Legacy frozen trusted checks configuration. Kept byte-compatible for
     * existing callers; a scoped `configurationFor` takes precedence for a
     * fresh round when both are supplied. Absent keeps history reads/receipts
     * but makes fresh open/begin explicitly unsupported. */
    configuration?: TrustedCheckConfiguration;
    /** R6 scoped resolver; when supplied it takes precedence over `configuration`. */
    configurationFor?: CheckConfigurationResolver;
    /** A.2 step 5.6: this Host instance and its lease (D-18), for VR-04. */
    hostInstance?: { hostInstanceId: string; lease: 'owned' | 'held_by_other' };
    /**
     * C8 / VD-13 (A.2 step 5.9): the automatic-rework policy whose limit caps
     * automatic successor rounds; the requeue owner's. Absent is
     * `DEFAULT_TASK_AUTOMATION_POLICY`.
     */
    automationPolicy?(): TaskAutomationPolicyV1;
    /**
     * Slice 5 §3.2/§4.4 (F37): the Goal autonomy/action policy seam consulted
     * for an automatic reverify; absent keeps the existing admission.
     */
    automaticReverifyPolicy?: AutomaticReverifyPolicyV1;
    /** VR-14 step 2: the delegated-write admission an Agent reverify goes through; absent refuses an Agent. */
    delegatedWrites?: PlanDelegatedWriteDependencies;
    /** ND-9: a session-message new input is read through the mailbox owner; absent refuses one (`unsupported`). */
    messages?: Pick<SessionMailboxPort, 'readMessage'>;
    now(): string;
    newId(): string;
};

export function createEvidenceService(deps: EvidenceServiceDependencies): EvidencePort {
    const records = deps.records;

    async function storeReport(
        ctx: CoreCallContext,
        round: RoundSnapshot,
        request: { checkId: string; invocationId: string; observation: CheckProcessObservation },
        requestId: string,
        sourceStatus: RoundCheckSnapshot['sourceStatus'],
        outcome: EvidenceOutcome,
    ): Promise<{ ok: true; ref: ArtifactRef } | { ok: false; rejection: CoreRejection }> {
        const body = JSON.stringify({
            schemaVersion: 1, kind: 'registered-check-report', roundRef: round.ref,
            checkId: request.checkId, invocationId: request.invocationId,
            source: { actor: round.executor, runRef: null, checkId: request.checkId },
            subjectRunRef: round.subjectRunRef, subject: round.subject,
            observation: request.observation, sourceStatus, outcome, recordedAt: deps.now(),
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
    ): Promise<Exclude<RoundCheckSnapshot['sourceStatus'], null>> {
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

    type RoundPreparation = {
        ok: true;
        build: SuccessorRoundBuildV1;
        /** The capture's stamp (the reverify key's `source`, LA-5). */
        source: SourceStampV1;
        /** The open/reverify read set beyond Goal, Plan and Run: Workspace@rev, the pinned policy and baseline. */
        workspaceGuard: RecordGuard;
        policyGuards: readonly RecordGuard[];
        baselineGuard: RecordGuard;
    };

    /**
     * VR-01 / VR-14 step 9 (§9 VD-12, LA-5), one path for a chain root and a
     * successor: the adopted Plan's pinned policy and baseline, the current
     * Host root and grant of the configuration (permission revision), the
     * formal Workspace revision, a full source capture and the compiled
     * VerificationPlan with every check registered, then the round material
     * identity, in that order; every failure answers the open's code.
     */
    async function prepareRoundOpening(input: {
        hostCtx: CoreCallContext;
        scope: { projectId: string; workspaceId: string };
        signal: AbortSignal;
        cancelledReason: string;
        configuration: TrustedCheckConfiguration;
        goal: GoalSnapshot;
        plan: PlanRevisionSnapshot;
        /** The Goal's current adopted Plan (VD-7). */
        planRef: PlanRevisionRef;
        taskBasisRef: PlanRevisionRef;
        subject: TaskTriple;
        subjectNode: RuntimeTask | undefined;
        subjectRunRef: RunRef;
        run: RunSnapshot;
        gateSubject: 'goal' | 'stage' | 'module' | undefined;
    }): Promise<RoundPreparation | { ok: false; rejection: CoreRejection }> {
        const { configuration, goal, plan, scope } = input;
        const failure = (rejection: CoreRejection) => ({ ok: false as const, rejection });
        const policyRead = await readPinnedCompletionPolicy(records, plan.effectiveCompletionPolicy);
        if (policyRead.status !== 'resolved') return failure(mapRejected(policyRead));
        const baseline = await readPinnedBaseline(records, plan.effectiveArchitectureBaseline);
        if (!baseline.ok) return baseline;
        const resolvedRoot = await deps.workspaceHost.resolveRoot(configuration.workspace);
        if (resolvedRoot.status !== 'ready') return failure(mapWorkspaceRejection(resolvedRoot));
        const authorization = await deps.workspaceHost.authorize(input.hostCtx, configuration.workspace);
        if (authorization.status !== 'ready') return failure(mapWorkspaceRejection(authorization));
        if (authorization.value.permissionRevision !== configuration.permissionRevision) {
            return failure(forbidden('the current Host permission revision is not the trusted configuration binding'));
        }
        const workspaceRead = await readWorkspaceRevision(records, goal.workspaceRef);
        if (!workspaceRead.ok) return workspaceRead;
        if (workspaceRead.revision !== resolvedRoot.value.workspaceRevision) {
            return failure(rejectedWithCurrent('source_stale', 'the Host access workspace revision is not the current Workspace record revision'));
        }
        const captured = await deps.source.capture(resolvedRoot.value.root);
        if (captured.status !== 'ready') return failure(mapSourceFailure(captured));
        if (input.signal.aborted) return failure(cancelled(input.cancelledReason));

        let configurationDigest: string;
        try { configurationDigest = digestOf(configuration); }
        catch { return failure(invalid('the trusted check configuration is not canonical JSON')); }
        const capabilities: CheckCapabilityV1[] = configuration.checks.map(check => ({
            checkId: check.checkId, kind: check.kind, coversKinds: [check.kind], replayable: false }));
        const compiled = compileVerificationPlan({
            schemaVersion: 1, taskRef: input.subject, planRef: input.planRef, planSnapshot: plan,
            workspaceRevision: resolvedRoot.value.workspaceRevision, changeScope: captured.changeScope,
            semanticChange: 'semantic', checkCapabilities: capabilities,
            policy: { requirementKinds: [...policyRead.policyContent.requirementKinds],
                ...(policyRead.policyContent.fastPathDiffClasses === undefined
                    ? {} : { fastPathDiffClasses: [...policyRead.policyContent.fastPathDiffClasses] }) },
            configurationDigest,
        });
        if (compiled.status !== 'ready') {
            return failure(invalid(compiled.issues.map(issue => issue.message).join('; ')));
        }
        const verificationPlan = compiled.plan;
        const checksProblem = refusalOf(roundOpenChecksProblem(verificationPlan, configuration));
        if (checksProblem !== null) return failure(checksProblem);
        let identityMaterial: VerificationRoundMaterialIdentity;
        try {
            identityMaterial = {
                schemaVersion: 1,
                scope: { projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: input.subject.goalId,
                    runId: input.subjectRunRef.runId, taskId: input.subject.taskId,
                    ...(input.gateSubject === undefined ? {} : { gateSubject: input.gateSubject }) },
                runRef: input.subjectRunRef, runRevision: input.run.revision, runDigest: digestOf(input.run),
                planRef: input.planRef, planRevision: plan.planRevision, planDigest: digestOf(plan),
                taskDigest: digestOf(input.subjectNode ?? input.subject),
                goalRevision: goal.revision, goalDigest: digestOf(goal),
                workspaceRevision: resolvedRoot.value.workspaceRevision,
                workspaceDigest: digestOf({ workspaceRef: goal.workspaceRef, revision: resolvedRoot.value.workspaceRevision }),
                workspaceRoot: resolvedRoot.value.root,
                policyPin: plan.effectiveCompletionPolicy, baselinePin: plan.effectiveArchitectureBaseline,
                sourceDigest: captured.sourceDigest, sourceProofDigest: digestOf(captured.sourceProof),
            };
        } catch { return failure(invalid('the round material identity is not canonical JSON')); }
        const workspaceKey = canonicalOf(goal.workspaceRef);
        if (workspaceKey === null) return failure(invalid('the open read refs are not canonical JSON'));
        return { ok: true,
            build: { adoptedPlanRef: input.planRef, taskBasisRef: input.taskBasisRef, configuration, configurationDigest,
                identity: identityMaterial, sourceProof: captured.sourceProof, verificationPlan },
            source: { workspaceRevision: resolvedRoot.value.workspaceRevision, sourceDigest: captured.sourceDigest },
            workspaceGuard: { refKey: workspaceKey, expectedRevision: workspaceRead.revision },
            policyGuards: policyRead.guards, baselineGuard: baseline.guard };
    }

    async function openVerification(
        ctx: CoreCallContext,
        request: GraphWrite<{ subjectRunRef: RunRef; subject: TaskTriple; planRef: PlanRevisionRef; gateSubject?: 'goal' | 'stage' | 'module' }>,
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
        if (input.gateSubject !== undefined && input.gateSubject !== 'goal'
            && input.gateSubject !== 'stage' && input.gateSubject !== 'module') {
            return invalid('gateSubject must be goal, stage or module when present');
        }
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
        // R6 cold-start: a FRESH round resolves the CURRENT configuration for
        // exactly its own scope. The scoped resolver takes precedence; the
        // legacy static configuration stays a compatible fallback. Receipt
        // replay above already ran before this current-configuration read.
        const configuration = deps.configurationFor !== undefined
            ? deps.configurationFor(scope)
            : deps.configuration;
        if (configuration === undefined) return unsupported('no trusted check configuration is registered for this workspace; fresh round open is unsupported');
        if (configuration.workspace.projectId !== scope.projectId || configuration.workspace.workspaceId !== scope.workspaceId) {
            return forbidden('the trusted check configuration belongs to another workspace');
        }
        // VR-01: the caller must be the configuration's registered executor.
        const guardCtx = roundCtx(configuration.executor, actor, null);
        const admitted = refusalOf(roundWriteAdmission(null, { kind: 'round_opened' }, guardCtx));
        if (admitted !== null) return admitted;
        if (signal.aborted) return cancelled('the round open was cancelled before the reads');

        const goalRef: GoalRef = { aggregateType: 'Goal', projectId: input.subject.projectId, goalId: input.subject.goalId };
        if (goalRef.projectId !== scope.projectId) return forbidden('the subject Goal belongs to another project');
        const goalRead = await readGoal(records, goalRef);
        if (goalRead.status !== 'ready') return mapRejected(goalRead);
        const goal = goalRead.goal;
        if (goal.workspaceRef.projectId !== scope.projectId || goal.workspaceRef.workspaceId !== scope.workspaceId) {
            return forbidden('the subject Goal belongs to another workspace');
        }
        // VD-9 (5.5): a Goal that is not active opens no round; guarded as read below.
        const goalActivity = refusalOf(roundGoalActivityProblem(goal.desiredState));
        if (goalActivity !== null) return goalActivity;
        const planIsActive = goal.activePlanRevision !== null
            && planRevisionRefKey(goal.activePlanRevision) === planRevisionRefKey(input.planRef);
        const pointerProblem = refusalOf(roundOpenPointerProblem(planIsActive));
        if (pointerProblem !== null) return pointerProblem;
        const planRead = await readPlan(records, input.planRef);
        if (planRead.status !== 'ready') return mapRejected(planRead);
        const plan = planRead.plan;
        if (plan.goalRef.projectId !== goalRef.projectId || plan.goalRef.goalId !== goalRef.goalId) {
            return notFound('the adopted Plan belongs to another Goal');
        }
        // VD-9: the subject's disposition in the Goal's current adopted Plan (the pointer check made it this Plan).
        const activity: RoundActivityFactsV1 = { goalDesiredState: goal.desiredState,
            subjectDisposition: plan.tasks.find(task => task.taskId === input.subject.taskId)?.disposition ?? null };
        const subjectActivity = refusalOf(roundSubjectActivityProblem(activity.subjectDisposition, input.subject));
        if (subjectActivity !== null) return subjectActivity;
        const basis = buildEffectiveTaskBasis(plan).get(input.subject.taskId);
        const taskBasisResolved = basis !== undefined && !isBasisUnsupported(basis);
        const basisProblem = refusalOf(roundOpenBasisProblem(taskBasisResolved, input.subject));
        if (basisProblem !== null) return basisProblem;
        const execution = await deps.executions.readExecution(trusted, input.subjectRunRef);
        if (execution.status !== 'ready') return mapRead(execution);
        const run = execution.value.run;
        if (!sameRef(run.ref, input.subjectRunRef)) return unavailable('the Run read returned a different aggregate');
        // A gate is not claimable: its round is opened against a formal ended
        // normal work Run of the SAME project/Goal/workspace while the
        // Round/VerificationPlan/taskBasis/Evidence subject stays the gate. The
        // adopted node must be a gate whose ACTUAL scope kind equals the declared
        // gateSubject; that actual kind is preserved unchanged in the round's
        // VerificationRoundScope identity below.
        const subjectNode = plan.tasks.find(task => task.taskId === input.subject.taskId);
        const producerNode = plan.tasks.find(task => task.taskId === run.task.taskId);
        const sameGoal = run.task.projectId === input.subject.projectId && run.task.goalId === input.subject.goalId;
        // VR-01 (D-3, §9.4): a subject Run a TaskRequeue covers is never verified again;
        // its absence is guarded by the commit. A backend without the claim schemas
        // cannot hold a TaskRequeue (`unsupported` is a confirmed absence, no guard).
        const requeueCover = await readRequeueCover(records, run);
        if (!requeueCover.ok) return requeueCover.rejection;
        const subjectFacts: Pick<RoundOpenFactsV1, 'relation' | 'subjectRun' | 'subjectRunRequeued'> = { subjectRun: run,
            subjectRunRequeued: requeueCover.covered,
            relation: input.gateSubject === undefined
                ? { kind: 'work', runTaskIsSubject: sameGoal && run.task.taskId === input.subject.taskId }
                : { kind: 'gate', gateSubject: input.gateSubject,
                    gateAdopted: subjectNode !== undefined && subjectNode.taskKind === 'gate' && subjectNode.scope.kind === input.gateSubject,
                    producer: !sameGoal || run.task.taskId === input.subject.taskId ? 'not_goal_work_run'
                        : producerNode === undefined || producerNode.taskKind !== 'work' ? 'not_adopted_work'
                            : run.workspaceSnapshot.workspaceId !== scope.workspaceId ? 'other_workspace' : 'ok' } };
        const runProblem = refusalOf(roundOpenSubjectProblem(subjectFacts, input.subject));
        if (runProblem !== null) return runProblem;
        // VD-1/VD-15 before the capture: the subject's chain (a gate's on any
        // producer). The slot claim in the commit settles a concurrent open.
        const subjectChainRun = input.gateSubject === undefined ? input.subjectRunRef : null;
        const chainRead = await readSubjectChain(records, scope, input.subject, subjectChainRun);
        if (!chainRead.ok) return chainRead.rejection;
        const chainProblem = roundOpenChainProblem(chainRead.chain, input.subject);
        if (chainProblem !== null) return chainRefusal(chainProblem, chainRead.chain);
        const facts: RoundOpenFactsV1 = { activity, planIsActive, taskBasisResolved, ...subjectFacts, chain: chainRead.chain };
        const prepared = await prepareRoundOpening({ hostCtx: trusted, scope, signal,
            cancelledReason: 'the round open was cancelled during source capture', configuration, goal, plan,
            planRef: input.planRef, taskBasisRef: basis as PlanRevisionRef, subject: input.subject, subjectNode,
            subjectRunRef: input.subjectRunRef, run, gateSubject: input.gateSubject });
        if (!prepared.ok) return prepared.rejection;
        const roundRef: VerificationRoundRef = { aggregateType: 'VerificationRound', projectId: scope.projectId,
            workspaceId: scope.workspaceId, goalId: goalRef.goalId, taskId: input.subject.taskId,
            runId: input.subjectRunRef.runId, roundId: deps.newId() };
        const decided = transitionRound(null, { kind: 'round_opened', facts, opening: { ...prepared.build, ref: roundRef,
            subject: input.subject, subjectRunRef: input.subjectRunRef, executor: actor } }, guardCtx);
        if (!decided.ok) return chainRefusal(decided, chainRead.chain);
        const round = decided.next;
        const occurredAt = deps.now();
        const event: VerificationRoundEvent = { eventId: deps.newId(), eventType: VERIFICATION_ROUND_OPENED_EVENT_TYPE,
            schemaVersion: 1, occurredAt, identityKey: identity, roundRef, actor, fingerprint, result: round };
        // The commit CASes the ACTUAL local read set this open consumed: Goal's
        // current adopted pointer, the adopted Plan, the formal Workspace domain
        // revision, the ended subject Run, the pinned policy/baseline and the
        // Round absence. A legal W1 future apply during the capture await moves
        // the Goal pointer and conflicts here instead of landing silently.
        const goalKey = canonicalOf(goalRef);
        const runKey = canonicalOf(run.ref);
        if (goalKey === null || runKey === null) {
            return invalid('the open read refs are not canonical JSON');
        }
        // A concurrent open of the same subject took the slot first: read its
        // chain again and answer like a later open would (VD-1, §9.4).
        const slotTaken = async (): Promise<CoreRejection> => {
            const again = await readSubjectChain(records, scope, input.subject, subjectChainRun);
            if (!again.ok) return again.rejection;
            const problem = roundOpenChainProblem(again.chain, input.subject);
            return problem === null ? unavailable('the subject round slot is held but no round of the subject is readable')
                : chainRefusal(problem, again.chain);
        };
        return await commitRoundWrite(records, signal, { identity, fingerprint, effects: decided.effects, round, event,
            value: round, cancelled: 'the round open was cancelled before commit', slotTaken,
            readSet: [
                { refKey: goalKey, expectedRevision: goal.revision },
                { refKey: planRevisionRefKey(input.planRef), expectedRevision: plan.revision },
                prepared.workspaceGuard,
                { refKey: runKey, expectedRevision: run.revision },
                ...requeueCover.guards,
                ...prepared.policyGuards,
                prepared.baselineGuard,
            ] });
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

    /**
     * VD-14: the head of one subject's round chain, open or finalized. Work
     * (`subjectRunRef` given): the chain of that subject Run; gate
     * (`subjectRunRef: null`): the gate's one chain, whatever producer anchors
     * it (VD-15). No chain is exactly `not_found`; an invalid chain (legacy
     * roots, an ordinal gap) or one past the limit is `incomplete`, never a
     * guessed head; a lookup error or a mismatched/undecodable row is
     * `unavailable`, so the Workflow waits instead of opening a second round.
     */
    async function queryRoundChainHead(ctx: CoreCallContext, request: RoundChainHeadQuery): Promise<ReadResult<RoundSnapshot>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const { scope } = ownedCtx;
        if (!isRecord(request)) return invalid('the chain-head query requires an object');
        const rawSubject: unknown = request.subject;
        const rawRunRef: unknown = request.subjectRunRef;
        const subjectProblem = taskTripleProblem(rawSubject);
        if (subjectProblem !== null) return invalid(subjectProblem);
        if (rawRunRef !== null && !isRunRef(rawRunRef)) {
            return invalid('the chain-head query takes a complete subject RunRef, or null for a gate chain');
        }
        const subject = rawSubject as TaskTriple;
        if (subject.projectId !== scope.projectId || (rawRunRef !== null && rawRunRef.projectId !== scope.projectId)) {
            return forbidden('the chain-head query is outside the trusted Host scope');
        }
        if (rawRunRef !== null && rawRunRef.goalId !== subject.goalId) {
            return invalid('the chain-head query subject Run and Task do not share a Goal');
        }
        const read = await readSubjectChain(records, scope, subject, rawRunRef);
        if (!read.ok) return read.rejection;
        const chain = read.chain;
        switch (chain.kind) {
            case 'none': return { status: 'not_found' };
            case 'invalid': return incomplete(`the verification round chain is invalid (${chain.reason}); refusing to guess its head`);
            case 'head': return { status: 'ready', value: chain.head };
            default: return unreachable(chain, 'round chain');
        }
    }

    /**
     * The plan-independent alias of `queryRoundChainHead` for one subject Run
     * (VD-7, C6): `planRef`, when given, is checked as a PlanRevisionRef of the
     * scope project and never selects the round.
     */
    async function queryOriginalVerification(
        ctx: CoreCallContext,
        request: OriginalVerificationQuery,
    ): Promise<ReadResult<RoundSnapshot>> {
        if (!isRecord(request)) return invalid('the original-round query requires an object');
        const rawRunRef: unknown = request.subjectRunRef;
        const rawPlanRef: unknown = request.planRef;
        if (!isRunRef(rawRunRef)) return invalid('the original-round query requires a complete subject RunRef');
        if (rawPlanRef !== undefined) {
            const planProblem = planRefProblem(rawPlanRef);
            if (planProblem !== null) return invalid(planProblem);
            if ((rawPlanRef as PlanRevisionRef).projectId !== (rawRunRef as RunRef).projectId) {
                return forbidden('the original-round query plan belongs to another project');
            }
        }
        return queryRoundChainHead(ctx, { subject: request.subject, subjectRunRef: rawRunRef });
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
        const checked = checkRoundPin(owned.expected, input.roundRef);
        if ('status' in checked) return checked;
        const loaded = await readRoundRecord(records, input.roundRef);
        if (!loaded.ok) return loaded.rejection;
        const round = loaded.round;
        // VR-02 before any IO: open round, executor, registered check, pin, then `pending`.
        const guardCtx = roundCtx(round.executor, actor, checked.revision);
        const admitted = refusalOf(checkEventAdmission(round, { kind: 'check_begun', checkId: input.checkId }, guardCtx), round);
        if (admitted !== null) return admitted;
        // VD-9 (5.5): the Goal and the subject's disposition in its current adopted Plan, before any Host IO.
        const activity = await readRoundActivity(records, scope, round);
        if (!activity.ok) return activity.rejection;
        const activityProblem = refusalOf(roundActivityProblem(activity.facts, round.subject));
        if (activityProblem !== null) return activityProblem;
        // R6 cold-start: the original round FROZE its trusted configuration when
        // it opened. A later scope approval may never rewrite or re-key it, so
        // this fresh begin and every ticket it issues use the round's frozen
        // configuration, never the current resolver value.
        const configuration = round.configuration;
        // A fresh begin must still match the round's frozen Host grant and its
        // exact frozen source; otherwise no execution ticket is issued. The
        // permission and root are compared before the capture, the source
        // before the invocation id is minted.
        const resolved = await deps.workspaceHost.resolveRoot(configuration.workspace);
        if (resolved.status !== 'ready') return mapWorkspaceRejection(resolved);
        const authorized = await deps.workspaceHost.authorize(ownedCtx.ctx, configuration.workspace);
        if (authorized.status !== 'ready') return mapWorkspaceRejection(authorized);
        const grant = { permissionRevision: authorized.value.permissionRevision, workspaceRoot: resolved.value.root };
        const grantProblem = refusalOf(frozenBindingProblem(round, grant));
        if (grantProblem !== null) return grantProblem;
        const captured = await deps.source.capture(resolved.value.root);
        if (captured.status !== 'ready') return mapSourceFailure(captured);
        const observed = { ...grant, sourceDigest: captured.sourceDigest };
        const sourceProblem = refusalOf(frozenBindingProblem(round, observed));
        if (sourceProblem !== null) return sourceProblem;
        const invocationId = deps.newId();
        const decided = transitionCheck(round, { kind: 'check_begun', checkId: input.checkId, invocationId, observed,
            activity: activity.facts }, guardCtx);
        if (!decided.ok) return refusalOf(decided, round);
        const definition = round.checks.find(candidate => candidate.checkId === input.checkId)!.definition;
        const ticket: CheckExecutionTicket = { roundRef: round.ref, checkId: input.checkId, invocationId,
            configurationRevision: configuration.configurationRevision, configurationDigest: round.configurationDigest,
            executor: round.executor, workspace: configuration.workspace, workspaceRoot: round.identity.workspaceRoot,
            permissionRevision: configuration.permissionRevision, sourceDigest: round.identity.sourceDigest,
            processAccess: configuration.processAccess, deniedPrefixes: configuration.deniedPrefixes, definition };
        const occurredAt = deps.now();
        return await commitRoundWrite(records, signal, { identity, fingerprint, effects: decided.effects, round: decided.next,
            readSet: activity.guards,
            event: { eventId: deps.newId(), eventType: VERIFICATION_CHECK_BEGUN_EVENT_TYPE, schemaVersion: 1, occurredAt,
                identityKey: identity, roundRef: round.ref, actor, fingerprint, result: ticket },
            value: ticket, cancelled: 'the check begin was cancelled before commit' });
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
        // VR-03 before any IO: open round, executor, registered check, `executing`, the begun invocation, then the pin.
        const guardCtx = roundCtx(round.executor, actor, checked.revision);
        const admitted = refusalOf(checkEventAdmission(round, { kind: 'check_result_recorded', checkId: input.checkId,
            invocationId: input.invocationId }, guardCtx), round);
        if (admitted !== null) return admitted;
        const sourceStatus = await evaluateSource(ownedCtx.ctx, round.configuration, round);
        // The observation is already an occurred fact. A late caller cancel must not
        // discard the real exit/signal/stdout/stderr/effects/report; the trusted
        // finishing signal keeps the same Host identity/scope (B2 cleanup pattern).
        const finishingCtx: CoreCallContext = { ...ownedCtx.ctx, signal: new AbortController().signal };
        const report = await storeReport(finishingCtx, round, input, owned.requestId, sourceStatus,
            outcomeFor(input.observation, sourceStatus).outcome);
        if (!report.ok) return report.rejection;
        // L16（决定 55）：同一次提交写下这次检查的内存上限命中。
        const resourceCapHit = resourceCapHitOf(input.observation);
        const decided = transitionCheck(round, { kind: 'check_result_recorded', checkId: input.checkId,
            invocationId: input.invocationId, observation: input.observation, sourceStatus, reportRef: report.ref,
            ...(resourceCapHit === undefined ? {} : { resourceCapHit }) }, guardCtx);
        if (!decided.ok) return refusalOf(decided, round);
        const occurredAt = deps.now();
        return await commitRoundWrite(records, signal, { identity, fingerprint, effects: decided.effects, round: decided.next,
            event: { eventId: deps.newId(), eventType: VERIFICATION_CHECK_RESULT_RECORDED_EVENT_TYPE, schemaVersion: 1,
                occurredAt, identityKey: identity, roundRef: round.ref, actor, fingerprint, result: decided.next },
            value: decided.next, cancelled: null });
    }

    /**
     * VR-05 and VR-13: the runner settles an executing window it proved never
     * ran a process (abandon → `pending`) or whose frozen ticket is
     * incomplete (→ `interrupted`, `ticket_invalid`). The receipt comes first;
     * then the pin, the round and the machine (`checkEventAdmission`: open
     * round, executor, registered check, `executing`, the begun invocation, the
     * pin). The identity is the runner's request id, which it derives from the
     * invocation, so a repeat replays the original round.
     */
    async function settleExecutingCheck(
        ctx: CoreCallContext,
        request: GraphWrite<AbandonCheckInput> | GraphWrite<InterruptCheckInput>,
        kind: 'abandon' | 'interrupt',
    ): Promise<WriteResult<RoundSnapshot>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const { scope, actor, signal } = ownedCtx;
        const owned = isolateWrite<AbandonCheckInput | InterruptCheckInput>(request);
        if (!owned.ok) return owned.rejection;
        const input = owned.input;
        const refProblem = roundRefProblem(input.roundRef);
        if (refProblem !== null) return invalid(refProblem);
        if (!nonEmpty(input.checkId) || !nonEmpty(input.invocationId)) return invalid(`${kind}Check requires a checkId and an invocationId`);
        let event: CheckEvent;
        if (kind === 'abandon') {
            const cause = (input as AbandonCheckInput).cause;
            if (cause !== 'caller_cancelled' && cause !== 'root_changed' && cause !== 'permission_changed' && cause !== 'read_failed') {
                return invalid('abandonCheck requires a known abandon cause');
            }
            event = { kind: 'check_abandoned', checkId: input.checkId, invocationId: input.invocationId, cause, provenNotStarted: true };
        } else {
            const interrupt = input as InterruptCheckInput;
            if (interrupt.cause === 'host_restart') {
                // VR-04 (A.2 step 5.6): the start-up reconcile names this Host instance.
                if (!nonEmpty(interrupt.hostInstanceId)) return invalid('a host_restart interruption names the reconciling Host instance');
                event = { kind: 'check_interrupted', checkId: input.checkId, invocationId: input.invocationId, cause: 'host_restart',
                    hostInstanceId: interrupt.hostInstanceId };
            } else {
                if (interrupt.cause !== 'ticket_invalid' || !nonEmpty(interrupt.ticketProblem)) {
                    return invalid('interruptCheck requires the ticket_invalid cause and its ticket problem');
                }
                event = { kind: 'check_interrupted', checkId: input.checkId, invocationId: input.invocationId, cause: 'ticket_invalid',
                    ticketProblem: interrupt.ticketProblem };
            }
        }
        if (input.roundRef.projectId !== scope.projectId || input.roundRef.workspaceId !== scope.workspaceId) {
            return forbidden('the round ref is outside the trusted Host scope');
        }
        const eventType = kind === 'abandon' ? VERIFICATION_CHECK_ABANDONED_EVENT_TYPE : VERIFICATION_CHECK_INTERRUPTED_EVENT_TYPE;
        let identity = '';
        let fingerprint = '';
        try {
            identity = identityKeyOf(`r3e-${kind}:`, actor, scope.projectId, scope.workspaceId, owned.requestId);
            fingerprint = fingerprintOf({ kind: `r3e-${kind}`, ...input, expected: owned.expected });
        } catch { return invalid(`the ${kind} request is not canonicalizable JSON`); }
        const lookup = await lookupReceipt(records, identity, fingerprint);
        if (lookup.status === 'failed') return lookup.rejection;
        if (lookup.status === 'found') {
            return await replayEvent(records, lookup.receipt, identity, fingerprint, eventType) as WriteResult<RoundSnapshot>;
        }
        const checked = checkRoundPin(owned.expected, input.roundRef);
        if ('status' in checked) return checked;
        const loaded = await readRoundRecord(records, input.roundRef);
        if (!loaded.ok) return loaded.rejection;
        const round = loaded.round;
        // VR-04: the lease is held only when this Host holds it under the instance the reconcile names (D-18).
        const restart = event.kind === 'check_interrupted' && event.cause === 'host_restart' ? event.hostInstanceId : null;
        const host = deps.hostInstance;
        const decided = transitionCheck(round, event, { ...roundCtx(round.executor, actor, checked.revision),
            instanceLeaseHeld: restart !== null && host !== undefined && host.lease === 'owned' && host.hostInstanceId === restart });
        if (!decided.ok) return refusalOf(decided, round);
        const base = { eventId: deps.newId(), schemaVersion: 1 as const, occurredAt: deps.now(), identityKey: identity,
            roundRef: round.ref, actor, fingerprint, checkId: input.checkId, invocationId: input.invocationId, result: decided.next };
        const recorded: VerificationRoundEvent = kind === 'abandon'
            ? { ...base, eventType: VERIFICATION_CHECK_ABANDONED_EVENT_TYPE, cause: (input as AbandonCheckInput).cause }
            : restart !== null
                ? { ...base, eventType: VERIFICATION_CHECK_INTERRUPTED_EVENT_TYPE, cause: 'host_restart', hostInstanceId: restart }
                : { ...base, eventType: VERIFICATION_CHECK_INTERRUPTED_EVENT_TYPE, cause: 'ticket_invalid', hostInstanceId: null };
        // The proven fact is committed even after a late caller cancel (the runner passes a finishing signal).
        return await commitRoundWrite(records, signal, { identity, fingerprint, effects: decided.effects, round: decided.next,
            event: recorded, value: decided.next, cancelled: null });
    }

    async function abandonCheck(ctx: CoreCallContext, request: GraphWrite<AbandonCheckInput>): Promise<WriteResult<RoundSnapshot>> {
        return settleExecutingCheck(ctx, request, 'abandon');
    }

    async function interruptCheck(ctx: CoreCallContext, request: GraphWrite<InterruptCheckInput>): Promise<WriteResult<RoundSnapshot>> {
        return settleExecutingCheck(ctx, request, 'interrupt');
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
        // VR-07's first guard step, where it stood before: ahead of the scope check and the receipt lookup.
        const reviewerEvidenceCount = input.reviewerEvidence === undefined ? 0 : input.reviewerEvidence.length;
        const reviewerProblem = refusalOf(roundReviewerEvidenceProblem(reviewerEvidenceCount));
        if (reviewerProblem !== null) return reviewerProblem;
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
        // VR-07 before any read (reviewer evidence was refused above): open round, executor, then the pin.
        const guardCtx = roundCtx(round.executor, actor, checked.revision);
        const admitted = refusalOf(roundWriteAdmission(round, { kind: 'round_finalized', reviewerEvidenceCount }, guardCtx), round);
        if (admitted !== null) return admitted;

        // Resolve the CURRENT adopted Plan and source once, then judge each
        // finished check's evidence with the existing basis/frozen-definition
        // rule. An unreadable current Plan or a changed/unverifiable source
        // cannot contribute PASS; the historical observation/outcome/anchor and
        // the original receipt are still preserved (never rewritten/re-run).
        const goalRef: GoalRef = { aggregateType: 'Goal', projectId: round.subject.projectId, goalId: round.subject.goalId };
        let evidencePlan: PlanRevisionSnapshot | null = null;
        let adoptedPlan: PlanRevisionSnapshot | null = null;
        const contextGaps: RoundSnapshot['gaps'] = [];
        // VR-07 read set: the Goal, the Plans the fold judges against and the
        // subject Run as read, so a concurrent adoption conflicts here.
        const readSet: RecordGuard[] = [];
        const evidencePlanRead = await readPlan(records, round.adoptedPlanRef);
        if (evidencePlanRead.status === 'ready') {
            evidencePlan = evidencePlanRead.plan;
            readSet.push({ refKey: planRevisionRefKey(evidencePlan.ref), expectedRevision: evidencePlan.revision });
        } else contextGaps.push({ code: 'evidence_plan_unavailable', message: 'the round adopted Plan is not readable' });
        const goalRead = await readGoal(records, goalRef);
        if (goalRead.status !== 'ready') {
            contextGaps.push({ code: 'goal_unavailable', message: 'the subject Goal is not readable' });
        } else {
            const goalKey = canonicalOf(goalRef);
            if (goalKey === null) return invalid('the subject Goal ref is not canonical JSON');
            readSet.push({ refKey: goalKey, expectedRevision: goalRead.goal.revision });
            if (evidencePlan !== null) {
                const activeRef = goalRead.goal.activePlanRevision ?? round.adoptedPlanRef;
                if (planRevisionRefKey(activeRef) === planRevisionRefKey(round.adoptedPlanRef)) {
                    adoptedPlan = evidencePlan;
                } else {
                    const adoptedRead = await readPlan(records, activeRef);
                    if (adoptedRead.status === 'ready') {
                        adoptedPlan = adoptedRead.plan;
                        readSet.push({ refKey: planRevisionRefKey(adoptedPlan.ref), expectedRevision: adoptedPlan.revision });
                    } else contextGaps.push({ code: 'adopted_plan_unavailable', message: 'the current adopted Plan is not readable' });
                }
            }
        }
        const subjectRunKey = canonicalOf(round.subjectRunRef);
        if (subjectRunKey === null) return invalid('the subject Run ref is not canonical JSON');
        const subjectRunRead = await readBatch(records, [subjectRunKey]);
        if (subjectRunRead.status !== 'ready') return mapRejected(subjectRunRead);
        const subjectRunRevision = readRevisionNumber(subjectRunRead.batch, subjectRunKey);
        if (subjectRunRevision === null) return unavailable('the round subject Run is not readable');
        readSet.push({ refKey: subjectRunKey, expectedRevision: subjectRunRevision });
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

        // One candidate verdict (one id) and its applicability per check the
        // fold judges, in the machine's order (VR-07 `foldVerdictChecks`).
        const verdicts = new Map<string, EvidenceV1>();
        const decisions: Record<string, CheckVerdictDecisionV1> = {};
        for (const check of foldVerdictChecks(round)) {
            const evidence: EvidenceV1 = {
                schemaVersion: 1, evidenceId: deps.newId(), kind: 'verdict', outcome: check.outcome ?? 'INCONCLUSIVE',
                source: { actor: round.executor, runRef: null, checkId: check.checkId }, subject: { ...round.subject },
                coverage: check.coverage.map(entry => ({ ...entry })), anchor: anchorOf(round),
                verificationPlanRef: { planId: round.verificationPlan.planId, planDigest: round.verificationPlan.planDigest },
                summary: { text: boundedSummary(`check ${check.checkId} ${check.outcome ?? 'INCONCLUSIVE'}`), artifactRef: check.reportRef },
            };
            verdicts.set(check.checkId, evidence);
            if (evidencePlan !== null && adoptedPlan !== null) {
                const currentAnchor: EffectivityAnchorV1 = { schemaVersion: 1, planRef: adoptedPlan.ref,
                    planRevision: adoptedPlan.planRevision, workspaceRevision: currentWorkspaceRevision,
                    pinnedCompletionPolicy: adoptedPlan.effectiveCompletionPolicy,
                    pinnedArchitectureBaseline: adoptedPlan.effectiveArchitectureBaseline };
                decisions[check.checkId] = evidenceApplicabilityWithBasis({ evidence, adoptedPlan, evidencePlan, currentAnchor });
            }
        }
        const fold: RoundFoldFactsV1 = { decisions: evidencePlan !== null && adoptedPlan !== null ? decisions : null,
            sourceCurrent, contextGaps };
        // The machine mints no ids: one Evidence ref per admission of the fold,
        // after the clock as before; a refused fold mints none.
        const folded = finalizeRoundOutcome({ ...fold, round });
        const admittedAt = folded.status === 'folded' ? deps.now() : '';
        const evidenceRefs: EvidenceRef[] = folded.status !== 'folded' ? [] : folded.admissions.map(() => ({
            aggregateType: 'Evidence', projectId: round.ref.projectId, evidenceId: deps.newId() }));
        const decided = transitionRound(round, { kind: 'round_finalized', reviewerEvidenceCount, fold, evidenceRefs }, guardCtx);
        if (!decided.ok) return refusalOf(decided, round);
        const finalizedRound = decided.next;
        const snapshots: EvidenceSnapshot[] = (effectOf(decided.effects, 'admit_verdict_evidence')?.admissions ?? [])
            .map((admission): EvidenceSnapshot => {
                const verdict = verdicts.get(admission.checkId);
                if (verdict === undefined) throw new Error(`the fold admitted check ${admission.checkId}, which has no candidate verdict`);
                return { ref: admission.ref, revision: 1, schemaVersion: 1,
                    evidence: { ...verdict, evidenceId: admission.ref.evidenceId, coverage: [{ ...admission.coverage }] }, admittedAt };
            });
        const indexRead = await readIndex(records, round);
        if (!indexRead.ok) return indexRead.rejection;
        // VR-07 writes the folded outcome, never null.
        const finalized: FinalizedChecks = { snapshot: finalizedRound, outcome: finalizedRound.outcome!, evidence: snapshots,
            applicable: finalizedRound.outcome === 'PASS', gaps: finalizedRound.gaps };
        return await commitRoundWrite(records, signal, { identity, fingerprint, effects: decided.effects, round: finalizedRound,
            readSet, evidence: snapshots, index: nextTaskEvidenceIndex(indexRead.index, snapshots.map(snapshot => snapshot.ref.evidenceId)),
            finalizedAt: admittedAt,
            event: { eventId: deps.newId(), eventType: VERIFICATION_ROUND_FINALIZED_EVENT_TYPE, schemaVersion: 1,
                occurredAt: admittedAt, identityKey: identity, roundRef: round.ref, actor, fingerprint, result: finalized },
            value: finalized, cancelled: 'the round finalize was cancelled before commit' });
    }

    // ---------------------------------------------------------------------- //
    // VR-14 / VR-15: successor rounds (C5, VD-12, VD-13, §13.7)               //
    // ---------------------------------------------------------------------- //

    const policyOf = () => deps.automationPolicy?.() ?? DEFAULT_TASK_AUTOMATION_POLICY;

    /** Receipt replay: the recorded `VerificationRoundReverified` or `TaskReworkRefused` restores the original value. */
    async function replayReverify(
        receipt: Extract<StoreCommitReceipt, { status: 'committed' }>, identity: string, fingerprint: string,
        acknowledgement: SessionMessageRef | null,
    ): Promise<EffectWriteResultV1<ReverifyOutcomeV1>> {
        const loaded = await loadReplayEvent(records, receipt);
        if (!loaded.ok) return loaded.rejection;
        const event = loaded.event;
        let recorded: { identityKey: string; fingerprint: string; value: ReverifyOutcomeV1 };
        if (event.eventType === VERIFICATION_ROUND_REVERIFIED_EVENT_TYPE) {
            const decoded = verificationRoundEventFromEvent(event);
            if (decoded.status !== 'decoded') return unavailable(`the recorded successor round event is not decodable: ${decoded.reason}`);
            const value = decoded.value;
            if (value.eventType !== VERIFICATION_ROUND_REVERIFIED_EVENT_TYPE) return unavailable('the recorded event type disagrees with the operation');
            recorded = { identityKey: value.identityKey, fingerprint: value.fingerprint, value: { kind: 'reverified', round: value.result } };
        } else if (event.eventType === TASK_REWORK_REFUSED_EVENT_TYPE) {
            const decoded = taskReworkRefusedEventFromEvent(event);
            if (decoded.status !== 'decoded') return unavailable(`the recorded reverify refusal is not decodable: ${decoded.reason}`);
            recorded = { identityKey: decoded.value.identityKey, fingerprint: decoded.value.fingerprint,
                value: { kind: 'refused', refusal: decoded.value.refusal } };
        } else {
            return unavailable(`the recorded reverify receipt names a ${event.eventType} event`);
        }
        if (recorded.identityKey !== identity || recorded.fingerprint !== fingerprint) {
            return unavailable('the recorded reverify disagrees with the request identity');
        }
        return { status: 'committed', value: recorded.value, replayed: true, cursor: receipt.cursor,
            // 7A §3.5 rule 5: the receipt of this effect's own commit, present only
            // when the call carried an acknowledgement; a refusal never returns one.
            ...(acknowledgement === null || recorded.value.kind !== 'reverified' ? {}
                : { proofReceipt: { identityKey: identity, fingerprint, cursor: receipt.cursor } }) };
    }

    type ReverifyCommit = {
        identity: string;
        fingerprint: string;
        signal: AbortSignal;
        /** The real requester: an operator, a platform automation actor or an Agent. */
        actor: ActorRef;
        /** The Host identity the successor's event records; the Agent stays in `chain.reverify.requestedBy` (VR-14). */
        eventActor: HostActor | null;
        task: TaskTriple;
        predecessor: RoundSnapshot;
        run: RunSnapshot;
        refusalRef: TaskReworkRefusalRef;
        refusalKey: string;
        currentRefusal: TaskReworkRefusalSnapshotV1 | null;
        goalEndedRunsAtRefusal: number;
        /** `guard_reverify_read_set` without the refusal record (added here: CAS @k, or the written revision). */
        readSet: readonly RecordGuard[];
        decided: { next: RoundSnapshot; effects: readonly VerificationEffect[] };
        /**
         * §2.5 notice-origin wiring: the creating `policy.autoReworkLimit` an
         * automatic successor round writes to its wire `noticeAutomationCap`
         * (0..`MAX_AUTO_REWORK_LIMIT`); absent on a refusal. It is wire notice
         * metadata only and never changes the chain count or the old public DTO.
         */
        noticeAutomationCap?: number;
        /** 7A §3.5: the acknowledged message, null when the call carried none (a refusal returns no proof). */
        acknowledgement: SessionMessageRef | null;
        /** A lost slot claim: the head moved, answered from the chain read again. */
        slotTaken(): Promise<CoreRejection>;
    };

    /**
     * VR-14 step 12, the ONE commit of a successor or a policy refusal, from
     * the machine's effects: the successor @1 (CAS null), the predecessor as
     * read, the read set, the refusal record @k (CAS), the slot claim, and the
     * one event (`VerificationRoundReverified`, or `TaskReworkRefused` with
     * the record `taskReworkRefusalEffects` builds). A replayed or lost commit
     * restores the original value.
     */
    async function commitReverify(write: ReverifyCommit): Promise<EffectWriteResultV1<ReverifyOutcomeV1>> {
        const guards: RecordGuard[] = [];
        const written: EncodedRecord[] = [];
        let claims: UniqueClaimChange[] = [];
        let event: EncodedDomainEvent | null = null;
        let value: ReverifyOutcomeV1 | null = null;
        let roundOriginBinding: PreparedCommit['commitCursorBindings'] = undefined;
        let refusalGuard: RecordGuard = { refKey: write.refusalKey, expectedRevision: write.currentRefusal?.revision ?? null };
        for (const effect of write.decided.effects) {
            switch (effect.kind) {
                case 'guard_round': {
                    const key = canonicalOf(write.decided.next.ref);
                    if (key === null) return invalid('the successor round ref is not canonical JSON');
                    // Slice 5 §2.5: the successor round carries the wire-only
                    // notice origin; the Store binds this creation commit's
                    // cursor to `since` and the automatic cap is recorded here.
                    const cap = write.noticeAutomationCap === undefined ? undefined
                        : Math.min(Math.max(0, Math.trunc(write.noticeAutomationCap)), MAX_AUTO_REWORK_LIMIT);
                    written.push(encodeVerificationRoundSnapshot(write.decided.next,
                        cap === undefined ? { since: null } : { since: null, noticeAutomationCap: cap }));
                    roundOriginBinding = [{ refKey: key, field: 'since' }];
                    guards.push({ refKey: key, expectedRevision: effect.expectedRevision });
                    break;
                }
                case 'guard_predecessor': {
                    const key = canonicalOf(effect.ref);
                    if (key === null) return invalid('the predecessor round ref is not canonical JSON');
                    guards.push({ refKey: key, expectedRevision: effect.revision });
                    break;
                }
                case 'guard_reverify_read_set': guards.push(...write.readSet); break;
                case 'claim_round_slot': claims = [{ ...effect.claim }]; break;
                case 'refuse_reverify': {
                    const refusedAt = deps.now();
                    const [record] = taskReworkRefusalEffects({ current: write.currentRefusal, ref: write.refusalRef, task: write.task,
                        afterRunRef: write.run.ref, subjectRoundRef: write.predecessor.ref, failureClass: effect.refusal.failureClass,
                        code: effect.refusal.code, reason: effect.refusal.reason, basisDigest: effect.refusal.basisDigest,
                        source: effect.refusal.source, matchedRequeueRef: null, requestedBy: write.actor, refusedAt,
                        goalEndedRunsAtRefusal: write.goalEndedRunsAtRefusal, configurationRevision: effect.refusal.configurationRevision });
                    if (record?.kind !== 'write_task_rework_refusal') throw new Error('a reverify refusal writes its TaskReworkRefusal');
                    written.push(encodeTaskReworkRefusalSnapshot(record.refusal));
                    refusalGuard = { refKey: write.refusalKey, expectedRevision: record.expectedRevision };
                    const refused: TaskReworkRefusedEvent = { eventId: deps.newId(), eventType: TASK_REWORK_REFUSED_EVENT_TYPE,
                        schemaVersion: TASK_REWORK_EVENT_SCHEMA_VERSION, occurredAt: refusedAt, identityKey: write.identity,
                        actor: write.actor, fingerprint: write.fingerprint, refusal: record.refusal };
                    event = encodeTaskReworkRefusedEvent(refused);
                    value = { kind: 'refused', refusal: record.refusal };
                    break;
                }
                case 'emit_event': {
                    if (effect.eventType !== VERIFICATION_ROUND_REVERIFIED_EVENT_TYPE || write.eventActor === null) {
                        throw new Error(`a reverify write emits no ${effect.eventType} event without the Host identity`);
                    }
                    const successor = write.decided.next;
                    event = encodeVerificationRoundEvent({ eventId: deps.newId(), eventType: VERIFICATION_ROUND_REVERIFIED_EVENT_TYPE,
                        schemaVersion: 1, occurredAt: deps.now(), identityKey: write.identity, roundRef: successor.ref,
                        actor: write.eventActor, fingerprint: write.fingerprint, result: successor,
                        // 7A §3.5 rule 3: the effect event carries the key only when the input did.
                        ...(write.acknowledgement === null ? {} : { acknowledgement: write.acknowledgement }) });
                    value = { kind: 'reverified', round: successor };
                    break;
                }
                default: throw new Error(`a reverify write has no ${effect.kind} effect`);
            }
        }
        if (event === null || value === null) throw new Error('a reverify write commits a successor round or a refusal');
        const merged = mergeGuards([...guards, refusalGuard]);
        if (!merged.ok) return merged.rejection;
        const prepared: PreparedCommit = { identityKey: write.identity, fingerprint: write.fingerprint, guards: merged.guards,
            records: written, claims, indexGuards: [], indexChanges: [], events: [event],
            ...(roundOriginBinding === undefined ? {} : { commitCursorBindings: roundOriginBinding }) };
        try {
            if (write.signal.aborted) return cancelled('the reverify was cancelled before commit');
            const receipt = await records.commit(prepared);
            if (receipt.status !== 'committed') {
                if (receipt.code === 'unique_conflict') return await write.slotTaken();
                return mapStoreFailure(receipt);
            }
            if (receipt.replayed) return await replayReverify(receipt, write.identity, write.fingerprint, write.acknowledgement);
            return { status: 'committed', value, replayed: false, cursor: receipt.cursor,
                // 7A §3.5 rule 5: the receipt of this effect's own commit, present only
                // when the call carried an acknowledgement; a refusal never returns one.
                ...(write.acknowledgement === null || value.kind !== 'reverified' ? {}
                    : { proofReceipt: { identityKey: write.identity, fingerprint: write.fingerprint, cursor: receipt.cursor } }) };
        } catch (error) {
            const outcome = await lookupReceipt(records, write.identity, write.fingerprint);
            if (outcome.status === 'found') {
                return await replayReverify(outcome.receipt, write.identity, write.fingerprint, write.acknowledgement);
            }
            if (outcome.status === 'failed') return outcome.rejection;
            return unavailable(`the reverify commit result is unknown: ${messageOf(error)}`);
        }
    }

    /**
     * VR-14/VR-15 (§9 VD-12, VD-13, §13.2 point 3, §13.7; C5, C8): the
     * successor round of a finalized non-PASS chain head, or one committed
     * policy refusal, never both, in the unified order, each step before the
     * next IO:
     *   1. the receipt (a `reverified` and a `refused` value both replay);
     *   2. the caller and its class: a Host operator `human`, a platform
     *      automation actor `system`, an Agent `agent` of the same Goal through
     *      `authorizeDelegatedWrite(…, 'reverify_round')` (no production Role
     *      grants it before its Agent tool, GAP-46);
     *   3. the predecessor, its chain, the Goal and its current adopted Plan,
     *      the subject Run (gate: the anchored producer), work: its TaskRequeue
     *      cover and pointer intent; `reverifyAdmissionProblem` with steps 4–5
     *      (`reworkPermission`); then the refusal pin and the new inputs (ND-9);
     *   7. the cap (`reverifyCapRefusal`), 8. `countEndedGoalRuns`, both
     *      before any capture (a cap refusal captures nothing);
     *   9. the current configuration (its executor runs the successor), its
     *      Host grant, a full capture and the compile (`prepareRoundOpening`,
     *      VR-01's path, LA-5); a human `note` is then stored as an Artifact
     *      and joins the new inputs;
     *  10–11. `transitionRound(round_reverified)`: `verification_uncovered`,
     *      `source_unchanged`, the key (`reverifyBasis`);
     *  12. one commit (`commitReverify`).
     */
    async function reverifyRound(ctx: CoreCallContext, request: GraphWrite<ReverifyRoundInput>):
    Promise<EffectWriteResultV1<ReverifyOutcomeV1>> {
        const caller = bindReverifyCaller(ctx);
        if ('status' in caller) return caller;
        const { scope, signal } = caller;
        const owned = isolateWrite(request);
        if (!owned.ok) return owned.rejection;
        const input = owned.input;
        const shape = reverifyInputProblem(input, scope);
        if (shape !== null) return shape;
        const raw = input.predecessorRoundRef;
        const predecessorRef: VerificationRoundRef = { aggregateType: 'VerificationRound', projectId: raw.projectId,
            workspaceId: raw.workspaceId, goalId: raw.goalId, taskId: raw.taskId, runId: raw.runId, roundId: raw.roundId };
        const task: TaskTriple = { projectId: predecessorRef.projectId, goalId: predecessorRef.goalId, taskId: predecessorRef.taskId };
        const refusalRef: TaskReworkRefusalRef = { aggregateType: 'TaskReworkRefusal', projectId: task.projectId,
            goalId: task.goalId, taskId: task.taskId, operation: 'reverify', subjectId: predecessorRef.roundId };
        const pins = reverifyPinsOf(owned.expected, predecessorRef, refusalRef);
        if ('status' in pins) return pins;
        if (signal.aborted) return cancelled('the reverify was cancelled before lookup');

        // 1–2. The requester and the receipt; an Agent's identity is the formal writer (W2).
        let actor: ActorRef;
        let agentWriter: AgentPlanWriter | null = null;
        if (caller.kind === 'host') {
            actor = caller.actor;
        } else {
            if (deps.delegatedWrites === undefined) return forbidden('Agent reverifies are not admitted by this Host');
            const writer = await identifyDelegatedWriter(deps.delegatedWrites, caller.ctx, scope);
            if (writer.status !== 'ready') {
                return writer.status === 'rejected' ? writer : forbidden('the Agent writer identity is not readable');
            }
            agentWriter = writer.value;
            actor = writer.value.actor;
        }
        let identity: string;
        let fingerprint: string;
        try {
            identity = identityKeyOf('r3e-reverify:', actor, scope.projectId, scope.workspaceId, owned.requestId);
            fingerprint = fingerprintOf({ kind: 'r3e-reverify', predecessorRoundRef: predecessorRef,
                onlyIfSourceChanged: input.onlyIfSourceChanged ?? false, newInputRefs: input.newInputRefs ?? [],
                reason: input.reason ?? null, note: input.note ?? null, expected: sortedPins(owned.expected),
                ...(input.acknowledgement === undefined ? {} : { acknowledgement: input.acknowledgement }) });
        } catch { return invalid('the reverify request is not canonicalizable JSON'); }
        const lookup = await lookupReceipt(records, identity, fingerprint);
        if (lookup.status === 'failed') return lookup.rejection;
        if (lookup.status === 'found') {
            return await replayReverify(lookup.receipt, identity, fingerprint, input.acknowledgement ?? null);
        }
        const actorClass = reworkActorClassOf(caller.ctx.principal, actor);
        if (actorClass === null) return forbidden('the caller cannot rework this Task');
        let admissionGuards: readonly RecordGuard[] = [];
        if (agentWriter !== null) {
            if (agentWriter.goalRef.goalId !== task.goalId) return forbidden('an Agent reworks only Tasks of its own Goal');
            const admitted = await authorizeDelegatedWrite(deps.delegatedWrites!, caller.ctx,
                { writer: agentWriter, operation: 'reverify_round' });
            if (admitted.status !== 'ready') {
                return admitted.status === 'rejected' ? admitted : forbidden('the Agent reverify admission is not readable');
            }
            admissionGuards = admitted.value.guards;
        }

        // 3. The predecessor, its chain, the Goal and its current adopted Plan (VD-7), the subject Run.
        const readCtx = hostContextOf(scope, REVERIFY_READ_ACTOR, signal);
        const loaded = await readRoundRecord(records, predecessorRef);
        if (!loaded.ok) return loaded.rejection;
        const predecessor = loaded.round;
        if (!sameRef(predecessor.subject, task)) return unavailable('the predecessor round disagrees with its ref');
        const gateSubject = predecessor.identity.scope.gateSubject;
        const chainRun = gateSubject === undefined ? predecessor.subjectRunRef : null;
        const chainRead = await readSubjectChain(records, scope, predecessor.subject, chainRun);
        if (!chainRead.ok) return chainRead.rejection;
        const goalRef: GoalRef = { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId };
        const goalRead = await readGoal(records, goalRef);
        if (goalRead.status !== 'ready') return mapRejected(goalRead);
        const goal = goalRead.goal;
        if (goal.workspaceRef.projectId !== scope.projectId || goal.workspaceRef.workspaceId !== scope.workspaceId) {
            return forbidden('the subject Goal belongs to another workspace');
        }
        const planRef = goal.activePlanRevision;
        if (planRef === null) return incomplete('the Goal has no adopted Plan; no successor round opens');
        const planRead = await readPlan(records, planRef);
        if (planRead.status !== 'ready') return mapRejected(planRead);
        const plan = planRead.plan;
        if (plan.goalRef.projectId !== goalRef.projectId || plan.goalRef.goalId !== goalRef.goalId) {
            return notFound('the adopted Plan belongs to another Goal');
        }
        const execution = await deps.executions.readExecution(readCtx, predecessor.subjectRunRef);
        if (execution.status !== 'ready') return mapRead(execution);
        const run = execution.value.run;
        if (!sameRef(run.ref, predecessor.subjectRunRef)) return unavailable('the Run read returned a different aggregate');
        // VR-01's subject relation, judged against the Goal's current adopted Plan (a gate: its anchored producer, VD-15).
        const subjectNode = plan.tasks.find(candidate => candidate.taskId === task.taskId);
        const producerNode = plan.tasks.find(candidate => candidate.taskId === run.task.taskId);
        const sameGoal = run.task.projectId === task.projectId && run.task.goalId === task.goalId;
        const relation: RoundSubjectRelationV1 = gateSubject === undefined
            ? { kind: 'work', runTaskIsSubject: sameGoal && run.task.taskId === task.taskId }
            : { kind: 'gate', gateSubject,
                gateAdopted: subjectNode !== undefined && subjectNode.taskKind === 'gate' && subjectNode.scope.kind === gateSubject,
                producer: !sameGoal || run.task.taskId === task.taskId ? 'not_goal_work_run'
                    : producerNode === undefined || producerNode.taskKind !== 'work' ? 'not_adopted_work'
                        : run.workspaceSnapshot.workspaceId !== scope.workspaceId ? 'other_workspace' : 'ok' };
        // work: the TaskRequeue cover (its absence is guarded) and the pointer intent of the fence; a gate has neither.
        let cover: { covered: boolean; guards: RecordGuard[] } = { covered: false, guards: [] };
        let fence: ReworkFence = 'none';
        if (gateSubject === undefined) {
            const coverRead = await readRequeueCover(records, run);
            if (!coverRead.ok) return coverRead.rejection;
            cover = coverRead;
            const pointers = await readPointerIntents(records, [run]);
            if (pointers.status !== 'ready') return rejectedWithCurrent(pointers.code, pointers.reason);
            fence = reworkFenceOf(run, pointers.intents.get(run.ref.runId) ?? null);
        }
        const failureClass = reverifyFailureClass(predecessor);
        const facts: RoundReverifyFactsV1 = { actorClass, chain: chainRead.chain, subjectRun: run, relation,
            activity: { goalDesiredState: goal.desiredState, subjectDisposition: subjectNode?.disposition ?? null },
            subjectRunRequeued: cover.covered,
            permission: failureClass === null ? null : reworkPermission({ operation: 'reverify', goalDesiredState: goal.desiredState,
                failureClass, interruption: null, fence, actorClass,
                goalFanOut: actor.kind === GOAL_FAN_OUT_ACTOR.kind && actor.id === GOAL_FAN_OUT_ACTOR.id,
                trigger: false, budget: false, note: input.note !== undefined }) };
        const guardCtx: RoundGuardContext = { callerIsExecutor: false, expectedRevision: pins.predecessor, instanceLeaseHeld: false };
        const headPin = (chain: RoundChainHeadV1): VersionPin[] | undefined =>
            chain.kind === 'head' ? [{ ref: chain.head.ref, revision: chain.head.revision }] : undefined;
        const admission = reverifyAdmissionProblem(predecessor, facts, guardCtx);
        if (admission !== null && !admission.ok) {
            // §9.4: a moved head or a stale pin names the head; a requeued subject Run names its TaskRequeue@1.
            const moved = chainRead.chain.kind === 'head'
                && (!sameRef(chainRead.chain.head.ref, predecessor.ref) || pins.predecessor !== predecessor.revision);
            const current = admission.code !== 'revision_conflict' ? undefined : moved || !cover.covered ? headPin(chainRead.chain)
                : [{ ref: { aggregateType: 'TaskRequeue' as const, projectId: run.ref.projectId, goalId: run.ref.goalId,
                    taskId: run.task.taskId, afterRunId: run.ref.runId }, revision: 1 }];
            return rejectedWithCurrent(admission.code, admission.detail, current);
        }
        // The refusal record under (reverify, predecessor) and the caller's optional pin on it (§13.7 point 9).
        const refusalRead = await readReverifyRefusal(records, refusalRef);
        if (!refusalRead.ok) return refusalRead.rejection;
        const currentRefusal = refusalRead.current;
        if (pins.refusal !== null && pins.refusal !== (currentRefusal?.revision ?? 0)) {
            return rejectedWithCurrent('revision_conflict', 'the reverify refusal changed since the caller read it',
                currentRefusal === null ? undefined : [{ ref: refusalRef, revision: currentRefusal.revision }]);
        }
        // Step 5 (ND-9): every new input as the owner reads it.
        const requestedInputs = input.newInputRefs ?? [];
        const inputProblem = await newBasisInputsProblem({ materials: deps.materials, messages: deps.messages }, caller.ctx,
            scope, requestedInputs);
        if (inputProblem !== null) return inputProblem;
        if (signal.aborted) return cancelled('the reverify was cancelled after the input checks');

        // 7–8. The cap, then the Goal's ended Runs (the refusal watermark), both before any capture.
        const policy = policyOf();
        const ended = await readGoalRunsForCount(records, goalRef);
        if (ended.status !== 'ready') return rejectedWithCurrent(ended.code, ended.reason);
        const goalKey = canonicalOf(goalRef);
        const runKey = canonicalOf(run.ref);
        if (goalKey === null || runKey === null) return invalid('the reverify read refs are not canonical JSON');
        const readSet: RecordGuard[] = [
            { refKey: goalKey, expectedRevision: goal.revision },
            { refKey: planRevisionRefKey(planRef), expectedRevision: plan.revision },
            { refKey: runKey, expectedRevision: run.revision },
            ...cover.guards,
            ...admissionGuards,
        ];
        const decide = (successor: RoundSuccessorV1 | null) =>
            transitionRound(predecessor, { kind: 'round_reverified', facts, onlyIfSourceChanged: input.onlyIfSourceChanged ?? false,
                autoReworkLimit: policy.autoReworkLimit, successor }, guardCtx);
        const slotTaken = async (): Promise<CoreRejection> => {
            const again = await readSubjectChain(records, scope, predecessor.subject, chainRun);
            if (!again.ok) return again.rejection;
            return rejectedWithCurrent('revision_conflict', 'the predecessor is no longer the chain head (a successor round or a requeue committed first)',
                headPin(again.chain));
        };
        const commitBase = { identity, fingerprint, signal, actor, task, predecessor, run, refusalRef, refusalKey: refusalRead.key,
            currentRefusal, goalEndedRunsAtRefusal: countEndedGoalRuns(ended.runs), slotTaken,
            acknowledgement: input.acknowledgement ?? null };
        if (reverifyCapRefusal(predecessor, actorClass, policy.autoReworkLimit) !== null) {
            const capped = decide(null);
            if (!capped.ok) return rejectedWithCurrent(capped.code, capped.detail);
            return await commitReverify({ ...commitBase, eventActor: null, readSet, decided: capped });
        }

        // Slice 5 §3.2/S5-AU-03: an automatic (agent/system) reverify consults
        // the current Goal autonomy; `needs_decision` refuses with `forbidden`
        // and writes nothing. A person's explicit reverify keeps its existing
        // rights. The cap fence above stays first (旧上限先有效).
        if (actorClass !== 'human') {
            const countedNext = successorAutoCount(predecessor.chain?.autoCount ?? 0, actorClass, reverifyExemption(predecessor));
            const cap = policy.autoReworkLimit;
            const verdict = deps.automaticReverifyPolicy !== undefined
                ? deps.automaticReverifyPolicy({ goal, actorClass, countedNext, cap })
                : decisionActionPolicy({ autonomy: goalSettingsOf(goal).autonomy, action: 'auto_reverify',
                    actorClass, countedNext, cap });
            if (verdict === 'needs_decision' || verdict === 'user_only') {
                return forbidden('the Goal autonomy requires a user decision before an automatic reverify');
            }
        }

        // 9. The current configuration (its executor runs the successor), its Host grant, a full capture and the compile.
        const configuration = deps.configurationFor !== undefined ? deps.configurationFor(scope) : deps.configuration;
        if (configuration === undefined) {
            return unsupported('no trusted check configuration is registered for this workspace; a successor round is unsupported');
        }
        if (configuration.workspace.projectId !== scope.projectId || configuration.workspace.workspaceId !== scope.workspaceId) {
            return forbidden('the trusted check configuration belongs to another workspace');
        }
        const basis = buildEffectiveTaskBasis(plan).get(task.taskId);
        const basisProblem = refusalOf(roundOpenBasisProblem(basis !== undefined && !isBasisUnsupported(basis), task));
        if (basisProblem !== null) return basisProblem;
        const prepared = await prepareRoundOpening({ hostCtx: hostContextOf(scope, configuration.executor, signal), scope, signal,
            cancelledReason: 'the reverify was cancelled during source capture', configuration, goal, plan, planRef,
            taskBasisRef: basis as PlanRevisionRef, subject: task, subjectNode, subjectRunRef: predecessor.subjectRunRef, run,
            gateSubject });
        if (!prepared.ok) return prepared.rejection;
        // A human note is stored after the capture and joins the new inputs before the key (§13.2 step 9);
        // the body carries no time, so the same note is the same Artifact (and the same key).
        const newInputRefs: NewBasisInputRefV1[] = [...requestedInputs];
        if (input.note !== undefined) {
            if (caller.kind !== 'host') return invalid('only an operator may attach a note');
            const stored = await deps.materials.storeArtifact(caller.ctx, { contentType: REWORK_NOTE_CONTENT_TYPE, body: input.note,
                sources: [{ kind: 'workspace', refId: scope.workspaceId, revision: String(prepared.source.workspaceRevision) }],
                origin: { kind: 'platform_operation', projectId: scope.projectId, workspaceId: scope.workspaceId,
                    requestId: owned.requestId, actor: caller.actor } });
            if (stored.status !== 'stored') {
                return rejectedWithCurrent(stored.code === 'size_exceeded' ? 'capacity' : stored.code === 'missing_source' ? 'invalid' : stored.code,
                    `the note could not be stored: ${stored.reason}`);
            }
            if (newInputRefs.length >= MAX_NEW_BASIS_INPUT_REFS) {
                return invalid(`a reverify carries at most ${MAX_NEW_BASIS_INPUT_REFS} new inputs including its note`);
            }
            newInputRefs.push({ kind: 'artifact', ref: stored.ref });
        }
        // 11. The key (§13.7 point 1) over this capture and the configuration the successor freezes.
        const key = reverifyBasis({ subject: task, subjectRunId: run.ref.runId, predecessor, source: prepared.source,
            configuration: { configurationRevision: configuration.configurationRevision,
                configurationDigest: prepared.build.configurationDigest },
            basisPlan: basis, completionPolicyPin: plan.effectiveCompletionPolicy,
            architectureBaselinePin: plan.effectiveArchitectureBaseline, newInputRefs });
        if (!key.ok) return rejectedWithCurrent(key.code, key.detail);
        // 10–12. The machine: a successor or a policy refusal, then the one commit.
        const decided = decide({ roundId: deps.newId(), build: prepared.build, basis: key.next, requestedBy: actor,
            requestedAt: deps.now(), newInputRefs, reason: input.reason ?? null });
        if (!decided.ok) return rejectedWithCurrent(decided.code, decided.detail);
        return await commitReverify({ ...commitBase, decided,
            eventActor: caller.kind === 'host' ? caller.actor : { kind: configuration.executor.kind, id: configuration.executor.id },
            noticeAutomationCap: policy.autoReworkLimit,
            readSet: [...readSet, prepared.workspaceGuard, ...prepared.policyGuards, prepared.baselineGuard] });
    }

    return { openVerification, readVerification, queryOriginalVerification, queryRoundChainHead, beginCheck, recordCheckResult,
        abandonCheck, interruptCheck, finalizeChecks, reverifyRound };
}
