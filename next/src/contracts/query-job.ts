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
type QueryRunStatus = "pending" | "running" | "answered" | "closed";
export type QueryExecutionBindingV1 = {
    schemaVersion: 1;
    roundIndex: number;
    request: {
        runRef: QueryRunRef;
        bundleRef: ArtifactRef;
        question: string;
        budget: {
            maxTokens: number;
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
 * Semantics:
 *   - SubmitQueryJob is desired-state-first: it atomically records QueryJob
 *     (pending) + QueryRun (pending); the persisted pending pair is the
 *     query dispatch intent, reconstructed from QueryJobSubmitted events;
 *     driveQuery assembles a BOUNDED read-only context (never a transcript),
 *     starts the read-only run and only then records the answer.
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
import { canonicalJson } from "./fingerprint.js";
import type { RoleBindingRefV1 } from "./dispatch.js";
import { validateRuntimeBudget } from './runtime-budget.js';
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
        maxTokens: number;
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
export function validQueryExecution(value: QueryJobIntentV1['execution']): boolean {
    if (value === undefined)
        return true;
    if (!value || !['semantic_query', 'initial_coordination', 'execution_coordination'].includes(value.kind))
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
// Completed-capability migration: selected original declarations, no legacy service port.
export type QueryJobSnapshot = {
    ref: QueryJobRef;
    revision: number;
    schemaVersion: 1;
    job: QueryJobV1;
};
