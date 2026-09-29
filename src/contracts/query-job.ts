// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
import type { ArtifactRef } from "./artifact.js";
export type QueryJobRef = {
    aggregateType: "QueryJob";
    projectId: string;
    workspaceId: string;
    queryJobId: string;
};
export type QueryRunRef = {
    aggregateType: "QueryRun";
    projectId: string;
    workspaceId: string;
    queryJobId: string;
    runId: string;
};
export type QueryJobAnswerRef = {
    aggregateType: "QueryJobAnswer";
    projectId: string;
    workspaceId: string;
    queryJobId: string;
    answerId: string;
};
/**
 * The frozen deterministic identity of the ONE consultation Query bound to a
 * complete SessionMessageRef: the canonical SHA-256 of the message ref decides
 * the QueryJob and QueryRun ids (response processing has a distinct part key).
 * Two outer retries therefore address the same
 * persisted pair; no generic dedupe layer exists.
 */
export function consultationQueryRefs(messageRef: SessionMessageRef, part: 'message' | 'response' = 'message'): { queryJobRef: QueryJobRef; queryRunRef: QueryRunRef } {
    const hash = sha256Hex(canonicalJson((part === 'message' ? messageRef : { messageRef, part }) as unknown as JsonValue));
    const queryJobId = `consultation-${hash}`;
    return {
        queryJobRef: { aggregateType: "QueryJob", projectId: messageRef.projectId, workspaceId: messageRef.workspaceId, queryJobId },
        queryRunRef: { aggregateType: "QueryRun", projectId: messageRef.projectId, workspaceId: messageRef.workspaceId,
            queryJobId, runId: `consultation-run-${hash}` },
    };
}
type QueryRunStatus = "pending" | "running" | "answered" | "closed";
export type QueryExecutionBindingV1 = {
    schemaVersion: 1;
    roundIndex: number;
    request: {
        runRef: QueryRunRef;
        bundleRef: ArtifactRef;
        question: string;
        budget: {
            maxTokens: number | null;
        };
    };
    selectedSources: {
        kind: string;
        refKey: string;
        version: string | null;
    }[];
};
export type QueryRunV1 = {
    /** Absent on historical claims: absence never authorizes replaying execution. */
    execution?: QueryExecutionBindingV1;
    /**
     * R5b.2 execution/claim state. Absent on historical claims; absence never
     * authorizes replaying execution.
     */
    executionState?: QueryExecutionStateV1;
    schemaVersion: 1;
    queryJobRef: QueryJobRef;
    /** The QueryRun identity runId (same as QueryRunRef.runId). */
    runId: string;
    status: QueryRunStatus;
    startedAt: string | null;
    endedAt: string | null;
    outcome: "answered" | "timeout" | "gap" | "failed" | "cancelled" | null;
};
export type QueryRunSnapshot = {
    ref: QueryRunRef;
    revision: number;
    schemaVersion: 1;
    run: QueryRunV1;
};

// Completed-capability migration: selected original declarations, no legacy service port.
/**
 * Persisted QueryJob intent and accepted submission records.
 * QueryRun is a distinct versioned aggregate: ordinary Run snapshots require
 * a TaskAttempt anchor. These formats do not publish an old execution port.
 *
 * CURRENT producer scope (R5b.1 first batch): the formal producer only records
 * the pending pair and reads it back. Nothing here drives a Kernel run, captures
 * a source, prepares a bundle, records an answer or executes a multi-round
 * follow-up yet; those stay declared target shapes, not published behaviour.
 *
 * Target semantics (NOT produced by the first batch):
 *   - SubmitQueryJob is desired-state-first: it atomically records QueryJob
 *     (pending) + QueryRun (pending); the persisted pending pair is the
 *     query dispatch intent, reconstructed from QueryJobSubmitted events;
 *     a later execution assembles a BOUNDED read-only context (never a
 *     transcript), starts the read-only run and only then records the answer.
 *   - QueryJob NEVER touches the source worker: separate run id, separate
 *     budget, read-only permission; no write to the source lease/Context or
 *     the target workspace (workspaceCapability read-only).
 *   - Multi-round is bounded (maxRounds <= 4, roundIndex increments; a
 *     follow-up may reference the prior applicable answer).
 *   - Answers are sourced + revision-bound; stale marking is explicit
 *     (stale_answer) — a stale answer never presents as current.
 *   - Timeout / gap / failed / stale are OBSERVABLE closes; they never change
 *     the source Task/Goal phase.
 */
import type { ActorRef } from "./command-event.js";
import { canonicalJson, sha256Hex, type JsonValue } from "./fingerprint.js";
import type { RoleBindingRefV1 } from "./dispatch.js";
import { validateRuntimeBudget, type RuntimeBudget } from './runtime-budget.js';
import type { RoleConfigurationRef, SessionRef } from './core/identity.js';
import type { SessionMessageRef } from './core/session-message.js';
import type { RoleSpecResolutionV1 } from './role-spec-materials.js';
import type { RunExecutionHistoryV1 } from './core/execution-history.js';
import { validMaterialSourcePin } from './material-access.js';
export type QueryTaskRef = {
    aggregateType: "Task";
    projectId: string;
    goalId: string;
    taskId: string;
};
type TaskRef = QueryTaskRef;
export function queryJobRefFor(projectId: string, workspaceId: string, queryJobId: string): QueryJobRef {
    return { aggregateType: "QueryJob", projectId, workspaceId, queryJobId };
}
// ------------------------------------------------------------------------ //
// Value types                                                                 //
// ------------------------------------------------------------------------ //
export type QueryJobIntentV1 = {
    schemaVersion: 1;
    intentId: string;
    projectId: string;
    workspaceId: string;
    goalId: string | null;
    question: string;
    focusTaskRefs: TaskRef[];
    budget: {
        maxTokens: number | null;
        deadline: string | null;
    };
    multiTurn: {
        maxRounds: number;
    };
    correlationId: string;
    /** Optional real read-only role work. Absence retains the legacy query contract. */
    execution?: {
        kind: 'semantic_query' | 'initial_coordination' | 'execution_coordination';
        responsePurpose?: import('./memory.js').MemoryPurpose;
        feedback?: import('./execution-feedback.js').FeedbackSource;
        roleBinding: RoleBindingRefV1;
        runtimeBudget: import('./runtime-budget.js').RuntimeBudget;
        /**
         * A saved mailbox source for a read-only semantic Query. Inquiry answers
         * attach to the original message; part=response processes that saved
         * response in the sender Session without replacing the original answer.
         */
        consultation?: {
            messageRef: SessionMessageRef;
            part?: 'response';
            recipient: SessionRef;
            /**
             * Formal isolated A′ derivation. When present the Query runs in
             * `childSessionRef` with the fixed completed prefix of `sourceSessionRef`
             * (null throughPosition = explicit empty baseline).
             */
            derivation?: {
                childSessionRef: SessionRef;
                sourceSessionRef: SessionRef;
                sourceKernel: {
                    adapterId: string;
                    kernelSessionId: string;
                };
                throughPosition: number | null;
            };
        };
        implementationAuthorization?: {
            requestId: string;
            writeScope: [
                '*'
            ];
            instruction: string;
            referenceContext?: string;
        };
    };
};
type QueryJobStatus = "pending" | "running" | "answered" | "closed";
function isRecordValue(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validSessionMessageRef(value: unknown): boolean {
    if (!isRecordValue(value))
        return false;
    const keys = Object.keys(value);
    return keys.length === 4 && keys.every(key => ['aggregateType', 'projectId', 'workspaceId', 'messageId'].includes(key)) &&
        value['aggregateType'] === 'SessionMessage' &&
        typeof value['projectId'] === 'string' && value['projectId'].length > 0 &&
        typeof value['workspaceId'] === 'string' && value['workspaceId'].length > 0 &&
        typeof value['messageId'] === 'string' && value['messageId'].length > 0;
}
function validPlainSessionRef(value: unknown): boolean {
    if (!isRecordValue(value))
        return false;
    if (Object.keys(value).some(key => key !== 'aggregateType' && key !== 'projectId' && key !== 'sessionId'))
        return false;
    return typeof value['projectId'] === 'string' && value['projectId'].length > 0 &&
        typeof value['sessionId'] === 'string' && value['sessionId'].length > 0;
}
function validConsultationBinding(value: unknown): boolean {
    if (!isRecordValue(value))
        return false;
    const keys = Object.keys(value);
    if (!(keys.length >= 2 && keys.length <= 4) || !keys.includes('messageRef') || !keys.includes('recipient'))
        return false;
    if (keys.some(key => !['messageRef', 'recipient', 'derivation', 'part'].includes(key)))
        return false;
    if (!validSessionMessageRef(value['messageRef']))
        return false;
    if (!validPlainSessionRef(value['recipient']))
        return false;
    if (value['part'] !== undefined && value['part'] !== 'response') return false;
    if (value['part'] === 'response' && value['derivation'] !== undefined) return false;
    const derivation = value['derivation'];
    if (derivation !== undefined) {
        if (!isRecordValue(derivation))
            return false;
        if (Object.keys(derivation).some(key => !['childSessionRef', 'sourceSessionRef', 'sourceKernel', 'throughPosition'].includes(key)))
            return false;
        if (!validPlainSessionRef(derivation['childSessionRef']) || !validPlainSessionRef(derivation['sourceSessionRef']))
            return false;
        const sourceKernel = derivation['sourceKernel'];
        if (!isRecordValue(sourceKernel)
            || typeof sourceKernel['adapterId'] !== 'string' || sourceKernel['adapterId'].length === 0
            || typeof sourceKernel['kernelSessionId'] !== 'string' || sourceKernel['kernelSessionId'].length === 0)
            return false;
        const through = derivation['throughPosition'];
        if (!(through === null || (Number.isSafeInteger(through) && (through as number) >= 1)))
            return false;
    }
    return true;
}
export function validQueryExecution(value: QueryJobIntentV1['execution']): boolean {
    if (value === undefined)
        return true;
    if (!value || !['semantic_query', 'initial_coordination', 'execution_coordination'].includes(value.kind))
        return false;
    if (value.consultation !== undefined && (value.kind !== 'semantic_query' || !validConsultationBinding(value.consultation)))
        return false;
    if (value.responsePurpose !== undefined && !['reply', 'architecture', 'progress', 'planning', 'handoff', 'execution'].includes(value.responsePurpose))
        return false;
    if ((value.kind === 'execution_coordination') !== !!value.feedback)
        return false;
    if (value.feedback?.decisionRef && (value.feedback.decisionRef.aggregateType !== 'UserDecision' ||
        typeof value.feedback.decisionRef.decisionId !== 'string' || !value.feedback.decisionRef.decisionId))
        return false;
    if (value.feedback?.supersedesQueryJobId !== undefined && (typeof value.feedback.supersedesQueryJobId !== 'string' ||
        !value.feedback.supersedesQueryJobId || value.feedback.supersedesQueryJobId.length > 256))
        return false;
    if (value.feedback?.failureIssueIds !== undefined && (!Array.isArray(value.feedback.failureIssueIds) ||
        !value.feedback.failureIssueIds.length || value.feedback.failureIssueIds.length > 32 ||
        value.feedback.failureIssueIds.some(id => typeof id !== 'string' || !/^rework-issue-[a-f0-9]{40}$/.test(id))))
        return false;
    if (value.feedback && (!value.feedback.runRef || value.feedback.runRef.aggregateType !== 'Run' || !value.feedback.taskId ||
        !value.feedback.planRef || value.feedback.planRef.aggregateType !== 'PlanRevision' || !Number.isSafeInteger(value.feedback.workspaceRevision) ||
        value.feedback.workspaceRevision < 1 || !validMaterialSourcePin(value.feedback.sourcePin) || !value.feedback.reportRef || !/^[a-f0-9]{64}$/.test(value.feedback.reportRef.digest)))
        return false;
    try {
        if (canonicalJson(validateRuntimeBudget(value.runtimeBudget)) !== canonicalJson(value.runtimeBudget))
            return false;
    }
    catch {
        return false;
    }
    const authorization = value.implementationAuthorization;
    if (authorization?.referenceContext !== undefined && (typeof authorization.referenceContext !== 'string' || Buffer.byteLength(authorization.referenceContext) > 131072))
        return false;
    if (authorization && (value.kind !== 'initial_coordination' || typeof authorization.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(authorization.requestId) || canonicalJson(authorization.writeScope) !== '["*"]' || typeof authorization.instruction !== 'string' || !authorization.instruction.trim() || authorization.instruction.length > 4096))
        return false;
    const role = value.roleBinding;
    return !!role && role.schemaVersion === 1 && Number.isSafeInteger(role.bindingVersion) && role.bindingVersion > 0 &&
        [role.bindingId, role.templateId, role.templateRevision, role.policyRevision].every(field => typeof field === 'string' && field.length > 0 && field.length <= 256);
}
export type QueryJobV1 = {
    schemaVersion: 1;
    queryJobId: string;
    projectId: string;
    workspaceId: string;
    goalId: string | null;
    intent: QueryJobIntentV1;
    status: QueryJobStatus;
    runRef: QueryRunRef | null;
    answerRefs: QueryJobAnswerRef[];
    closeReason: {
        code: "timeout" | "gap" | "failed" | "stale_source" | "cancelled";
        message: string;
    } | null;
    submittedAt: string;
    updatedAt: string;
};
// ------------------------------------------------------------------------ //
// Events (query v1)                                                         //
// ------------------------------------------------------------------------ //
export type QueryJobSubmittedEvent = {
    eventId: string;
    eventType: "QueryJobSubmitted";
    schemaVersion: 1;
    projectId: string;
    workspaceId: string;
    aggregateType: "QueryJob";
    aggregateId: string;
    aggregateRevision: 1;
    causationId: string;
    correlationId: string;
    idempotencyKey: string;
    actor: ActorRef;
    occurredAt: string;
    payload: {
        job: QueryJobV1;
    };
};
/**
 * Locator of one accepted submission, written by the formal submit producer into
 * the Job snapshot. It points back at the ORIGINAL `QueryJobSubmitted` event via
 * the Store's exact identity/fingerprint lookup, so the real actor and the
 * immutable submitted intent can be recovered later without scanning events.
 *
 * It is a location, not an authorization: a caller never supplies it, an absent
 * field on a historical snapshot stays readable, and its presence never by
 * itself grants execution authority.
 */
export type QuerySubmissionBindingV1 = {
    schemaVersion: 1;
    identityKey: string;
    fingerprint: string;
    eventId: string;
};
export type QueryJobSnapshot = {
    ref: QueryJobRef;
    revision: number;
    schemaVersion: 1;
    job: QueryJobV1;
    /** Present only on snapshots written by the formal submit producer. */
    submission?: QuerySubmissionBindingV1;
};

// ------------------------------------------------------------------------ //
// R5b.2 execution/claim + answer value types                                 //
// ------------------------------------------------------------------------ //
/**
 * One persisted model-request/usage fact of the SAME QueryRun. `admitted` is set
 * only by the formal request admission commit, never inferred from reported
 * usage. The row is a projection of the existing ModelBudget/meter facts, not a
 * second budget algorithm.
 */
export type QueryModelUsageV1 = {
    requestId: string;
    requestDigest: string;
    reservedInput: number;
    reservedOutput: number;
    inputTokens: number | null;
    outputTokens: number | null;
    cachedInputTokens: number | null;
    usageStatus: 'reserved' | 'reported' | 'unknown';
};
export type QueryModelRequestV1 = QueryModelUsageV1 & { admitted: boolean };
/**
 * The ONE QueryRun's execution/claim state. `QueryRunSnapshot.revision` is the
 * CAS version of every phase below; no duplicate revision field is introduced.
 * Phase is a persisted observation, never a fresh permission.
 */
export type QueryExecutionStateV1 = {
    schemaVersion: 1;
    phase: 'claimed' | 'prepared' | 'entering' | 'entered' | 'unknown' | 'settled';
    sessionRef: SessionRef;
    sessionGeneration: number;
    role: RoleConfigurationRef;
    roleBinding: RoleBindingRefV1;
    roleResolution: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
    /** The Session's original completed boundary; not this round's newest event. */
    priorHistoryCursor: string | null;
    prepared: { bundleRef: ArtifactRef; inputDigest: string } | null;
    entry: {
        generation: 1;
        consumerId: string;
        hostConfigurationRevision: string;
        permissions: { tools: string[]; writeScope: [] };
        budget: RuntimeBudget;
        kernel: RunExecutionHistoryV1['kernel'];
    } | null;
    history: RunExecutionHistoryV1 | null;
    requests: QueryModelRequestV1[];
};
export type QueryJobAnswerV1 = {
    schemaVersion: 1;
    answerId: string;
    queryJobRef: QueryJobRef;
    runRef: QueryRunRef;
    roundIndex: number;
    answer: string;
    sources: { kind: string; refKey: string; version: string | null; label: string | null }[];
    followsAnswerRef: QueryJobAnswerRef | null;
    stale: boolean;
    staleReason: string | null;
    answeredAt: string;
    bodyRef: ArtifactRef;
};
export type QueryJobAnswerSnapshot = {
    ref: QueryJobAnswerRef;
    revision: 1;
    schemaVersion: 1;
    answer: QueryJobAnswerV1;
};
