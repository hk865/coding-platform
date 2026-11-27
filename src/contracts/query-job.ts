import type { ArtifactRef } from "./artifact.js";
import type { PreparedQueryManifestV1 } from "./core/prepared-execution.js";
import type { InitializationBindingRef } from "./initialization-binding.js";
import type { InitializationSourceV1, InterventionAnswerSourceV1 } from "./initial-planning.js";
import type { DeliveryInputV1 } from "./prompts/delivery-input.js";
import type { UserDecisionBodyV1 } from "./goal-decisions.js";
export type QueryJobRef = {
    aggregateType: "QueryJob";
    projectId: string;
    workspaceId: string;
    queryJobId: string;
};

/** The public entry's shape of one request reference: omitted fields mean "none". */
export type RequestReferenceInputV1 = {
    path: string;
    /** 1-based; omitted/null = the whole file. */
    startLine?: number | null;
    /** Omitted/null with `startLine` set = that single line; it cannot stand without `startLine`. */
    endLine?: number | null;
    /** The draft snapshot text; omitted/null = the saved file. */
    snapshot?: string | null;
};

/** The stored/read shape: every key present, omitted values written null. */
export type RequestReferenceV1 = {
    path: string;
    startLine: number | null;
    endLine: number | null;
    snapshot: string | null;
};
export type QueryRunRef = {
    aggregateType: "QueryRun";
    projectId: string;
    workspaceId: string;
    queryJobId: string;
    runId: string;
};
/**
 * One request round as the secretary's preparation sees it: the Job/Run
 * revisions and the frozen input, never a re-read. The selected idea carries
 * the title and detail from the stored answer, so it survives a transfer to
 * another secretary; `relatedCards` pins each of the round's `relatedCardRefs`
 * with the card's current revision (`null` when the card is gone), read in the
 * same preparation.
 */
export type SecretaryRoundDeliveryV1 =
  | Omit<Extract<DeliveryInputV1, { template: 'wait-reply-delivery' }>, 'template' | 'messageId'>
  | Omit<Extract<DeliveryInputV1, { template: 'wait-expiry-delivery' }>, 'template' | 'messageId'>
  /**
   * P6I R1: the answer to a decision card: the question and the whole saved decision (the option, the person's words,
   * the notes). The decision renders as the reply's body, so a successor line still sees the question and message id.
   */
  | { question: string; decision: UserDecisionBodyV1 };
/**
 * P6I: the close message of an attempt a Host ended on purpose before it entered: a person's stop, or a preparation
 * refused for a cause that does not lift by itself (`preparation_refused: <code>: <reason>`). Such a round is not a lost
 * attempt to retry: the same stop or refusal would end every new attempt the same way.
 */
export const STOPPED_BEFORE_ENTRY = 'stopped_before_entry';
const PREPARATION_REFUSED = 'preparation_refused: ';

export function preparationRefusedMessage(code: string, reason: string): string {
  return `${PREPARATION_REFUSED}${code}: ${reason}`;
}

/** Whether a Job's close reason is an attempt ended on purpose before entry (see `STOPPED_BEFORE_ENTRY`). */
export function endedOnPurposeBeforeEntry(closeReason: { code: string; message: string } | null): boolean {
  return closeReason !== null && closeReason.code === 'not_entered'
    && (closeReason.message === STOPPED_BEFORE_ENTRY || closeReason.message.startsWith(PREPARATION_REFUSED));
}
export type SecretaryRoundMaterialV1 = {
    ref: QueryJobRef;
    revision: number;
    runRef: QueryRunRef;
    runRevision: number;
    since: CommitCursor;
    text: string;
    /** The submit's structured file selections; a request round's projection always writes the list. */
    references?: RequestReferenceV1[];
    selectedIdea: { round: QueryJobRef; index: number; title: string; detail: string } | null;
    relatedCards: { ref: VersionedRef; current: number | null }[];
    /** The round's stored understanding command, projected from `round.job.understanding`. */
    command: RequestUnderstandingCommandV1 | null;
    relatedMessageRef: SessionMessageRef | null;
    delivery: SecretaryRoundDeliveryV1 | null;
};
/** The request facts frozen into a request round's prepared manifest. */
export type SecretaryRequestManifestV1 = {
    requestRoot: QueryJobRef;
    round: SecretaryRoundMaterialV1;
    batch: SecretaryRoundMaterialV1[];
    preparationCursor: CommitCursor;
    effectiveGoalId: string | null;
    executionKind: 'semantic_query' | 'initial_coordination';
    /** The successor's brief operation, read by its own Session; `null` when there is none. */
    briefRef: OperationRef | null;
    /** The still-valid understanding grants, frozen once beside `briefRef`. */
    understandingGrants: GoalRef[];
};
/** The one 16 KiB answer bound (BK-9-18): every non-planning answer, final text or submit. */
export const MAX_ANSWER_BYTES = 16 * 1024;

/**
 * The answer shape a Query was prepared with (spec §5.2.7). `secretary` and
 * `initial` are the two request-round shapes; the other five belong to a
 * planning line and are frozen on its `intervention_planning` execution
 * (`exec_review` is the reviewer's execution-result round, slice 9;
 * `unknown_call_advice` is the adviser's unknown-outcome round; `command_rerun_advice` the adviser's round on a
 * blocked command's rerun request; `scribe_review` is the scribe's long-command review, 121-112).
 */
export type QueryAnswerShapeV1 = 'secretary' | 'initial' | 'plan_round' | 'plan_review' | 'exec_review'
  | 'unknown_call_advice' | 'scribe_review' | 'command_rerun_advice' | 'check_review';
/** The planning-line subset written to `execution.answerShape`; `text` is the default. G8B: `check_review` 批检查。 */
export type PlanningAnswerShapeV1 = 'plan_round' | 'plan_review' | 'exec_review' | 'unknown_call_advice'
  | 'scribe_review' | 'command_rerun_advice' | 'check_review' | 'text';

/** The one shape mapping used by preparation and start-up (§5.2.7). */
export function queryAnswerShapeOf(
    execution: QueryJobIntentV1['execution'],
    requestExecutionKind: SecretaryRequestManifestV1['executionKind'] | null,
    /** The request is a plan round: one of its rounds already selected an idea (frozen at preparation). */
    requestPlanTurn = false,
): QueryAnswerShapeV1 | null {
    if (requestExecutionKind !== null) {
        if (requestExecutionKind === 'semantic_query' && requestPlanTurn) return 'plan_round';
        return requestExecutionKind === 'semantic_query' ? 'secretary' : 'initial';
    }
    if (execution.kind === 'intervention_planning') {
        if (execution.answerShape === 'plan_round') return 'plan_round';
        if (execution.answerShape === 'plan_review') return 'plan_review';
        if (execution.answerShape === 'exec_review') return 'exec_review';
        if (execution.answerShape === 'unknown_call_advice') return 'unknown_call_advice';
        if (execution.answerShape === 'scribe_review') return 'scribe_review';
        if (execution.answerShape === 'command_rerun_advice') return 'command_rerun_advice';
        if (execution.answerShape === 'check_review') return 'check_review';
        return null;
    }
    return null;
}
/**
 * The one canonical `request_understanding` command: one unfinished root of
 * the old secretary that a handoff operation's understanding generation covers,
 * and the goals to cover with the pointer each was checked at. The operation's
 * current generation is compared at prepare and start.
 */
export type RequestUnderstandingCommandV1 = {
    kind: 'request_understanding';
    /** `<handoffOp>:understanding:<generation>`. */
    commandId: string;
    operation: OperationRef;
    generation: number;
    /** One unfinished root of the old secretary this generation covers. */
    requestRoot: QueryJobRef;
    /** The goals to cover and the pointer each was checked at. */
    goals: { goalRef: GoalRef; pointer: CurrentPointerRef; pointerRevision: number }[];
    checkedRound: QueryRunRef | null;
    state: 'live' | 'closed' | 'consumed';
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
export function consultationQueryRefs(messageRef: SessionMessageRef): { queryJobRef: QueryJobRef; queryRunRef: QueryRunRef } {
    const hash = sha256Hex(canonicalJson(messageRef as unknown as JsonValue));
    const queryJobId = `consultation-${hash}`;
    return {
        queryJobRef: { aggregateType: "QueryJob", projectId: messageRef.projectId, workspaceId: messageRef.workspaceId, queryJobId },
        queryRunRef: { aggregateType: "QueryRun", projectId: messageRef.projectId, workspaceId: messageRef.workspaceId,
            queryJobId, runId: `consultation-run-${hash}` },
    };
}
/**
 * The consultation entry's binding of an existing Query to its message M (`consultation.ts`), also read by the node
 * draft (121-173): an explicit consultation of M, to M's recipient, under M's deterministic Job and Run. Null when
 * the Query is bound to M; otherwise why not.
 */
export function consultationBindingProblem(
    record: { job: { job: { queryJobId: string; intent: QueryJobIntentV1 } }; run: { run: { runId: string } } },
    message: { ref: SessionMessageRef; recipient: SessionRef },
): string | null {
    const execution = record.job.job.intent.execution;
    const consultation = execution.consultation;
    if (execution.kind !== 'semantic_query' || consultation === undefined) {
        return 'the existing deterministic Query is not an explicit consultation';
    }
    if (!sameJson(consultation.messageRef, message.ref)) return 'the existing consultation Query belongs to another message';
    const recipient = { projectId: message.recipient.projectId, sessionId: message.recipient.sessionId };
    if (!sameJson(consultation.recipient, recipient)) {
        return 'the existing consultation Query recipient is not the original message recipient';
    }
    const refs = consultationQueryRefs(message.ref);
    if (refs.queryJobRef.queryJobId !== record.job.job.queryJobId || refs.queryRunRef.runId !== record.run.run.runId) {
        return 'the existing Query is not the deterministic identity of its message';
    }
    return null;
}
/**
 * The frozen deterministic identity of the ONE intervention-planning Query bound
 * to a real source message: the canonical SHA-256 of the message ref decides the
 * QueryJob and QueryRun ids, so a retry addresses the same persisted pair.
 * The pair lives in the workspace of the Goal the message names, which may be
 * another workspace of the project than the message's own (a joined
 * workspace's round to a main-workspace line); the default is the message's.
 * A card-answer round freezes `part: 'decision_answer'`, so its deterministic key is the complete message ref plus
 * that part and never collides with the round opened from the same message as a plain source.
 */
export function interventionPlanningQueryRefs(messageRef: SessionMessageRef,
    queryWorkspaceId: string = messageRef.workspaceId,
    part: 'message' | 'decision_answer' = 'message'): { queryJobRef: QueryJobRef; queryRunRef: QueryRunRef } {
    const hash = sha256Hex(canonicalJson(
        (part === 'message' ? messageRef : { messageRef, part }) as unknown as JsonValue));
    const queryJobId = `intervention-planning-${hash}`;
    return {
        queryJobRef: queryJobRefFor(messageRef.projectId, queryWorkspaceId, queryJobId),
        queryRunRef: { aggregateType: "QueryRun", projectId: messageRef.projectId, workspaceId: queryWorkspaceId,
            queryJobId, runId: `intervention-planning-run-${hash}` },
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
    /** `not_entered`: settled by reconciliation without the Query ever entering the Kernel (§8). */
    outcome: "answered" | "timeout" | "gap" | "failed" | "cancelled" | "not_entered" | null;
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
import { defineShape, f, type InferShape } from './data-format.js';
import { GoalRefShape, ModuleRefShape } from './data-format-refs.js';
import { canonicalJson, sameJson, sha256Hex, type JsonValue } from "./fingerprint.js";
import type { RoleBindingRefV1 } from "./dispatch.js";
import { validateRuntimeBudget, type RuntimeBudget } from './runtime-budget.js';
import type { RoleConfigurationRef, SessionRef } from './core/identity.js';
import type { OperationRef } from './core/operations.js';
import type { SessionMessageRef } from './core/session-message.js';
import type { SessionRecord } from './core/session.js';
import type { RoleSpecResolutionV1 } from './role-spec-materials.js';
import type { RunExecutionHistoryV1 } from './core/execution-history.js';
import type { QueryRequestPromptFactsV1 } from './prompts/prompt-set.js';
import type { GoalAutonomyV1 } from './goal-decisions.js';
import type { CommitCursor } from './command-event.js';
import type { GoalRef, VersionedRef } from './ledger.js';
import type { CurrentPointerRef } from './note.js';
import { validMaterialSourcePin } from './material-access.js';
import { isRecord } from './validation/common.js';
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
// Request rounds                                                             //
// ------------------------------------------------------------------------ //
/** Created kinds: `request`, `followup`, `routing`; nothing creates `reply`, `expiry` or `explain` yet. */
export type QueryRoundKind = 'request' | 'followup' | 'reply' | 'expiry' | 'explain' | 'routing';
/** The model's screening of one proposed goal (the full screening shape). `null` = not screened. */
export const GoalScreeningShape = defineShape({ name: 'GoalScreeningV1', fields: {
    modules: f.array(f.ref(ModuleRefShape)),
    size: f.enumOf(['small', 'medium', 'large', 'unknown'] as const),
    conflictsWith: f.array(f.ref(GoalRefShape)),
    dependsOn: f.array(f.ref(GoalRefShape)),
    urgency: f.enumOf(['high', 'normal', 'low'] as const),
    suggestedPosition: f.nullable(f.integer({ min: 0 })),
    note: f.string({ max: 512, unit: 'utf8Bytes' }),
} });
export type GoalScreeningV1 = InferShape<(typeof GoalScreeningShape)['fields']>;
export type GoalCardDraftV1 = { objective: string; completion: string[]; autonomy: GoalAutonomyV1;
    screening: GoalScreeningV1 | null };
export type QueryCloseDetailV1 = 'too_long' | 'empty' | 'protocol' | 'dropped' | 'no_binding';
/** The originating command's refs, written once on the created round. */
export type RequestCommandReceiptV1 =
  | { kind: 'submit'; requestRoot: QueryJobRef; round: QueryJobRef; assignment: 'assigned'; secretary: SessionRef; created: boolean }
  | { kind: 'submit'; requestRoot: QueryJobRef; round: QueryJobRef; assignment: 'unassigned'; secretary: null; created: false }
  | { kind: 'route'; routingRound: QueryJobRef }
  | { kind: 'select_idea' | 'ask'; followupRound: QueryJobRef; secretary: SessionRef | null }
  | { kind: 'understanding'; round: QueryJobRef }
  | { kind: 'reply' | 'expiry'; round: QueryJobRef; relatedMessageRef: SessionMessageRef; secretary: SessionRef };
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
    /** The real read-only role work every current Query carries. */
    execution: {
        kind: 'semantic_query' | 'initial_coordination' | 'execution_coordination' | 'intervention_planning' | 'role_exploration';
        /** KC-3: a role_exploration round that repairs a knowledge conflict reads the last adopted architecture. */
        base?: import('./knowledge.js').KnowledgeReadBaseV1;
        responsePurpose?: import('./memory.js').MemoryPurpose;
        feedback?: import('./execution-feedback.js').FeedbackSource;
        roleBinding: RoleBindingRefV1;
        runtimeBudget: import('./runtime-budget.js').RuntimeBudget;
        /**
         * A saved copy question for a read-only semantic Query (§2.3/§3.10): the
         * question's own text under its frozen derivation, answered on the original
         * message. A reply is never a consultation source.
         */
        consultation?: {
            messageRef: SessionMessageRef;
            recipient: SessionRef;
            /** 7B-3: the create operation of a consultation copy; CS's writer sets it, Q reads the frozen payload by it. */
            operation?: OperationRef;
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
        /** L11: the planning Query starts from a real message; required on `intervention_planning`, absent on every other kind. */
        sourceMessageRef?: SessionMessageRef;
        /**
         * The frozen part of the source message this planning Query was opened from. Only a card-answer round carries
         * `decision_answer`; an ordinary source round omits it. The deterministic Query key is computed from it.
         */
        sourcePart?: 'decision_answer';
        /**
         * The sender facts frozen with the source message when this planning Query was opened: the person, the
         * platform, or the sending line. The prompt's source line names it; it is never re-derived from the
         * message body. Only `intervention_planning` carries it, and old intents omit it.
         */
        sourceSender?: { kind: 'person' } | { kind: 'platform' } | { kind: 'line'; sessionId: string };
        /**
         * The submit-tool shape frozen when the platform creates the Query; only
         * `intervention_planning` carries it, and only platform code writes it.
         */
        answerShape?: PlanningAnswerShapeV1;
        /**
         * The executor message a `planresume:` round ultimately replies to; only
         * `intervention_planning` carries it (spec #8, ruling DR-P1-04).
         */
        repliesToMessageRef?: SessionMessageRef;
        /**
         * The verified proof that this `intervention_planning` round was opened by a module-overlap gate's saved
         * `noteRequest.messageRef`. The gate owner freezes it when it builds the Query; preparation, execution and
         * the note owner admit the gate's text round by this flag, never by the sender's identity.
         */
        overlapNote?: true;
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
export function validSessionMessageRef(value: unknown): value is SessionMessageRef {
    if (!isRecord(value))
        return false;
    const keys = Object.keys(value);
    return keys.length === 4 && keys.every(key => ['aggregateType', 'projectId', 'workspaceId', 'messageId'].includes(key)) &&
        value['aggregateType'] === 'SessionMessage' &&
        typeof value['projectId'] === 'string' && value['projectId'].length > 0 &&
        typeof value['workspaceId'] === 'string' && value['workspaceId'].length > 0 &&
        typeof value['messageId'] === 'string' && value['messageId'].length > 0;
}
function validPlainSessionRef(value: unknown): boolean {
    if (!isRecord(value))
        return false;
    if (Object.keys(value).some(key => key !== 'aggregateType' && key !== 'projectId' && key !== 'sessionId'))
        return false;
    return typeof value['projectId'] === 'string' && value['projectId'].length > 0 &&
        typeof value['sessionId'] === 'string' && value['sessionId'].length > 0;
}
function validConsultationBinding(value: unknown): boolean {
    if (!isRecord(value))
        return false;
    const keys = Object.keys(value);
    if (!(keys.length >= 2 && keys.length <= 4) || !keys.includes('messageRef') || !keys.includes('recipient'))
        return false;
    if (keys.some(key => !['messageRef', 'recipient', 'derivation', 'operation'].includes(key)))
        return false;
    if (!validSessionMessageRef(value['messageRef']))
        return false;
    if (!validPlainSessionRef(value['recipient']))
        return false;
    const derivation = value['derivation'];
    if (derivation !== undefined) {
        if (!isRecord(derivation))
            return false;
        if (Object.keys(derivation).some(key => !['childSessionRef', 'sourceSessionRef', 'sourceKernel', 'throughPosition'].includes(key)))
            return false;
        if (!validPlainSessionRef(derivation['childSessionRef']) || !validPlainSessionRef(derivation['sourceSessionRef']))
            return false;
        const sourceKernel = derivation['sourceKernel'];
        if (!isRecord(sourceKernel)
            || typeof sourceKernel['adapterId'] !== 'string' || sourceKernel['adapterId'].length === 0
            || typeof sourceKernel['kernelSessionId'] !== 'string' || sourceKernel['kernelSessionId'].length === 0)
            return false;
        const through = derivation['throughPosition'];
        if (!(through === null || (Number.isSafeInteger(through) && (through as number) >= 1)))
            return false;
    }
    return true;
}
/** The frozen sender facts of one planning source: a closed three-way shape, no extra keys. */
function validSourceSender(value: unknown): boolean {
    if (!isRecord(value))
        return false;
    const kind = value['kind'];
    if (kind === 'person' || kind === 'platform') return Object.keys(value).length === 1;
    return kind === 'line' && Object.keys(value).length === 2
        && typeof value['sessionId'] === 'string' && value['sessionId'].length > 0;
}
export function validQueryExecution(value: QueryJobIntentV1['execution']): boolean {
    if (value === undefined)
        return true;
    if (!value || !['semantic_query', 'initial_coordination', 'execution_coordination', 'intervention_planning', 'role_exploration'].includes(value.kind))
        return false;
    // §3.17: the planning kind carries its source message; no other kind may carry one.
    if (value.kind === 'intervention_planning') {
        if (value.sourceMessageRef === undefined || !validSessionMessageRef(value.sourceMessageRef))
            return false;
    } else if (value.sourceMessageRef !== undefined)
        return false;
    // The frozen source part belongs to intervention_planning only, and only the card-answer value exists.
    if (value.sourcePart !== undefined
        && (value.kind !== 'intervention_planning' || value.sourcePart !== 'decision_answer'))
        return false;
    // The frozen source sender facts belong to intervention_planning only; old intents omit them.
    if (value.sourceSender !== undefined
        && (value.kind !== 'intervention_planning' || !validSourceSender(value.sourceSender)))
        return false;
    // Ruling DR-P1-04: the reply ref belongs to intervention_planning only.
    if (value.repliesToMessageRef !== undefined
        && (value.kind !== 'intervention_planning' || !validSessionMessageRef(value.repliesToMessageRef)))
        return false;
    // The gate-note proof is the literal `true` and belongs to intervention_planning only.
    if (value.overlapNote !== undefined
        && (value.kind !== 'intervention_planning' || value.overlapNote !== true))
        return false;
    // §5.2.7: answerShape belongs to intervention_planning only, from the seven planning values.
    if (value.answerShape !== undefined
        && (value.kind !== 'intervention_planning'
            || !['plan_round', 'plan_review', 'exec_review', 'unknown_call_advice', 'scribe_review',
              'command_rerun_advice', 'check_review', 'text'].includes(value.answerShape)))
        return false;
    if (value.consultation !== undefined && (value.kind !== 'semantic_query' || !validConsultationBinding(value.consultation)))
        return false;
    // KC-3: the read base belongs to role_exploration only.
    if (value.base !== undefined && (value.kind !== 'role_exploration' || !['current', 'recorded'].includes(value.base)))
        return false;
    if (value.responsePurpose !== undefined && !['reply', 'architecture', 'progress', 'planning', 'handoff', 'execution'].includes(value.responsePurpose))
        return false;
    if ((value.kind === 'execution_coordination') !== !!value.feedback)
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
        code: "timeout" | "gap" | "failed" | "stale_source" | "cancelled" | "not_entered" | "invalid_answer";
        message: string;
        detail: QueryCloseDetailV1 | null;
    } | null;
    submittedAt: string;
    updatedAt: string;
    /** The request this round belongs to; a request's first round points to itself. */
    requestRoot: QueryJobRef | null;
    roundKind: QueryRoundKind | null;
    requestGoalId: string | null;
    assignedSession: SessionRef | null;
    /** Explicit hand-off metadata of a `routing` round; null elsewhere. */
    routing: {
        from: SessionRef | null;
        to: SessionRef | null;
        reason: 'handoff' | 'manual' | 'archived' | 'dropped' | 'assigned';
    } | null;
    relatedMessageRef: SessionMessageRef | null;
    absorbedInto: QueryJobRef | null;
    absorbedRounds: QueryJobRef[];
    selectedIdea: { round: QueryJobRef; index: number } | null;
    goalAttribution: string | null;
    relatedCardRefs: VersionedRef[];
    enteredSession: SessionRef | null;
    intakeSession: SessionRef | null;
    receipt: RequestCommandReceiptV1 | null;
    /** The round's understanding command; `null` on every other Query and every historical record. */
    understanding: RequestUnderstandingCommandV1 | null;
    /** The submit's structured file selections (UI1 request-refs); every request round writes the list. */
    requestReferences?: RequestReferenceV1[];
    /**
     * G6F F4: the COMPLETED Goal and the message on its line an `intervention_new_goal` request came from. Only that
     * request's root round carries it; every other round and every record written before it has no key.
     */
    interventionSource?: RequestInterventionSourceV1;
};
/** Where an `intervention_new_goal` request came from: the completed Goal and the person's message on its line. */
export type RequestInterventionSourceV1 = { goalRef: GoalRef; messageRef: SessionMessageRef };
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
 * It is a location, not an authorization: a caller never supplies it, the formal
 * submit producer writes it into every snapshot after 79-1, and its presence
 * never by itself grants execution authority.
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
    /** The locator written by the formal submit producer on every snapshot. */
    submission: QuerySubmissionBindingV1;
    /** This record's creating commit cursor; bound by that commit from a null placeholder. */
    since: CommitCursor;
};
/** The pre-bind form every creator builds; the creating commit fills `since`. */
export type PendingQueryJobSnapshot = Omit<QueryJobSnapshot, 'since'> & { since: CommitCursor | null };

/** A request round is the one QueryJob kind whose binding and budget come from its own attempt. */
export function isRequestRound(job: QueryJobSnapshot): boolean {
    return job.job.roundKind !== null;
}

/**
 * The ONE reader of a Query's role binding and budget; every place that reads
 * them calls it. A plain Query reads exactly its Job intent. A request round
 * reads the attempt's own execution state, because preparation narrows its
 * budget; a request round without the claimed profile is an invariant break
 * and throws instead of falling back to the intent.
 */
export function queryExecutionBindingOf(job: QueryJobSnapshot, run: QueryRunSnapshot): {
    roleBinding: RoleBindingRefV1;
    runtimeBudget: RuntimeBudget;
    budget: QueryJobIntentV1['budget'];
} {
    if (!isRequestRound(job)) {
        const execution = job.job.intent.execution;
        return { roleBinding: execution.roleBinding, runtimeBudget: execution.runtimeBudget, budget: job.job.intent.budget };
    }
    const state = run.run.executionState;
    if (state === undefined || state.requestProfile === null) {
        throw new Error('a request round QueryRun has no requestProfile');
    }
    return {
        roleBinding: state.roleBinding,
        runtimeBudget: state.requestProfile.runtimeBudget,
        budget: state.requestProfile.budget,
    };
}

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
    /** The send layer's facts, written once by the reservation; never redefined by a usage write. */
    prompt: QueryRequestPromptFactsV1;
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
    /**
     * The bound manifest. `requestEffectiveGoalId` is the request round's goal
     * frozen from its prepared manifest (`request.effectiveGoalId`); null for a
     * no-goal round and for every plain Query. Required: the closing commit
     * reads the goal the round ran under here, not from the current Job.
     */
    prepared: { bundleRef: ArtifactRef; inputDigest: string; requestEffectiveGoalId: string | null } | null;
    /** The one running-cap marker (L31): `null` except while a prepared Query waits for a slot; the entering commit clears it; the group is derived from the trusted role and is not stored. */
    admissionWait: 'running_cap' | null;
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
    /**
     * The profile the request round was claimed with: the secretary profile
     * of the Session that claimed it, whose binding and budgets the attempt
     * runs with. Required, and null for every non-request Query. A request
     * round without it violates the claim invariant and is never read as the
     * Job intent.
     */
    requestProfile: {
        profileId: string;
        runtimeBudget: RuntimeBudget;
        budget: QueryJobIntentV1['budget'];
        consumerId: string;
    } | null;
    /**
     * Why the start-up reconcile made the QueryRun `unknown` (A.2 step 5.6,
     * QRR-05): the calls still without a result, or the probe verdict of an
     * unreadable Kernel. Absent otherwise (the in-process unknown observation
     * records none); kept after the QueryRun settles as the record of that
     * phase. The operator who attests the QueryRun (QRR-06) reads it here.
     */
    unknown?: QueryUnknownCauseV1;
};
/** QRR-05: the persisted cause of phase `unknown`. */
export type QueryUnknownCauseV1 =
    | { kind: 'unresolved_tools'; toolCallIds: string[] }
    | { kind: 'kernel_unreadable'; verdict: 'missing' | 'damaged' };
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
    /** 0 or 2–3 bounded ideas; the secretary answer's own check enforces the count. */
    ideas: { title: string; detail: string }[];
    goalCardDrafts: GoalCardDraftV1[];
    /** The draft a no-goal plan answer's plan belongs to; null when the plan names no draft. */
    planDraftIndex: number | null;
};
export type QueryJobAnswerSnapshot = {
    ref: QueryJobAnswerRef;
    revision: 1;
    schemaVersion: 1;
    answer: QueryJobAnswerV1;
};
/**
 * The exact formal facts the initial-plan normalization consumes. Declared in
 * contracts (pure data) so the WorkGraph `model` layer can name the seam's result
 * without importing `tasks/` (module-target `model -> state` only); the task
 * parser re-exports it.
 */
/** Which source the answer was read through and the exact Goal/version it proved. `plain` is the ordinary Query
 *  path: no source, no binding, the Job's own Goal and the frozen manifest's revision. */
export type InitialPlanSourceResolutionV1 =
    | { kind: 'plain'; source: null; bindingRef: null; goal: GoalRef; goalRevision: number }
    | { kind: 'binding'; source: InitializationSourceV1; bindingRef: InitializationBindingRef;
        goal: GoalRef; goalRevision: 1 }
    | { kind: 'prepared_goal'; source: InitializationSourceV1; bindingRef: null;
        goal: GoalRef; goalRevision: number }
    | { kind: 'request_followup'; source: InitializationSourceV1; bindingRef: null;
        goal: GoalRef; goalRevision: number }
    | { kind: 'intervention'; source: InterventionAnswerSourceV1; bindingRef: null;
        goal: GoalRef; goalRevision: number };
export type InitialPlanAnswerFacts = {
    answer: QueryJobAnswerV1;
    answerRef: QueryJobAnswerRef;
    job: QueryJobSnapshot;
    run: QueryRunSnapshot;
    manifest: PreparedQueryManifestV1;
    answerText: string;
    resolution: InitialPlanSourceResolutionV1;
    /**
     * The project's main workspace, read with the facts (a read result, not stored): the answer's module ids are
     * written in the round's workspace frame, so a merge of its segment onto a base puts the base back in that frame
     * first (`planInCallerView`) and the propose qualifies the merged plan once.
     */
    mainWorkspaceId: string;
};

/**
 * The internal execution record read by the Runtime thin path and by the Query
 * owner. Before claim there is no `session`; pending reads keep using
 * `readQueryJob`. WorkGraph's `queries/contracts.ts` re-exports it.
 */
export type QueryExecutionRecord = {
  job: QueryJobSnapshot;
  run: QueryRunSnapshot;
  session: SessionRecord;
  answer: QueryJobAnswerSnapshot | null;
};
