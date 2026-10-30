import type { ArchitectureReminderFactsV1 } from '../../contracts/architecture-observation.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../contracts/core/identity.js';
import type {
  PreparedQueryManifestV1, PreparedTaskManifestV1, UnknownCallReviewInputV1,
} from '../../contracts/core/prepared-execution.js';
import type { ReadResult } from '../../contracts/core/results.js';
import type { PromptTextsV1 } from '../../contracts/prompts/prompt-set.js';
import type { ContinuationBriefV1 } from '../../contracts/continuation-brief.js';
import type {
  AttentionGraphReadRequestV1, ContextAssemblyBindingV1, GraphAttentionFactsV1,
} from '../../contracts/graph-context.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { SessionAnomalyAnchorRef } from '../../contracts/session-anomaly.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { QueryPreparationFacts } from '../work-graph/queries/contracts.js';
import type { CommandRerunRequestReadPort } from '../work-graph/model/command-rerun-request-contracts.js';
import type { SecretaryPreparationFactsV1 } from '../work-graph/model/secretary-contracts.js';
import type { ConsultationFactsV1 } from '../work-graph/model/session-contracts.js';
import type { NoteMemoryMaterialPort } from '../work-graph/model/note-contracts.js';
import type { TaskContextInputPort } from '../work-graph/model/context-input-contracts.js';
import type { TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import type { GraphContextReadPort } from '../work-graph/model/graph-context-contracts.js';
import type { ResolvedRuntimeConfiguration, RuntimeExecutionDependencies } from './execution-contracts.js';
import type { SecretaryHandoffPromptFactsV1 } from './context-secretary-recipe.js';
import type { ConsultationResolvedFactV1 } from './consultation-facts-text.js';

/**
 * L8 (book ruling 12; interface §8): the one reminder read the assembler takes
 * before the model. `read` loads the observation state, the active catalog and
 * the two node lists once. A cancelled read cancels the preparation; any other
 * rejection becomes the single `架构提醒不可用` row and the preparation continues.
 */
export type ArchitectureReminderReadPort = {
  read(ctx: CoreCallContext, workspace: WorkspaceScope):
    Promise<ReadResult<ArchitectureReminderFactsV1>>;
};

export type ContextAssemblerDependencies = Pick<RuntimeExecutionDependencies,
  'executions' | 'roles' | 'materials' | 'bodies'>
  & Partial<Pick<RuntimeExecutionDependencies, 'plans' | 'sessions' | 'kernelStores' | 'workspaceHost' | 'workspaceSource' | 'kernel' | 'unknownCallReviews'>>
  & {
    graphContext?: GraphContextReadPort; taskInputs?: TaskContextInputPort;
    architectureReminders?: ArchitectureReminderReadPort;
    /** K3 B3 item 7: the Task's requests for the blocked section; optional for old test doubles. */
    commandRerunRequests?: CommandRerunRequestReadPort;
    /** The note memory-material read the notes already share; absent fails a secretary round closed. */
    memoryMaterial?: NoteMemoryMaterialPort };

/**
 * The one template id vocabulary. The material carries it so a re-render never
 * guesses which input template produced the text.
 */
export type ContextTemplateId = 'work-input' | 'query-planning-input' | 'query-copy-input' | 'secretary-round'
  | 'intervention-planning';

/** One section's frozen omission state; `wholeOmitted` means the range is null. */
export type ContextSectionPlanV1 = {
  name: ContextAssemblyBindingV1['sections'][number]['name'];
  omitted: number;
  wholeOmitted: boolean;
};

/**
 * Everything the assembler used, so `prepare` can re-render the whole input with
 * only the review slot replaced. `slots` is every slot except
 * `unknown_call_review`.
 */
export type ContextRenderMaterialV1 = {
  pack: PromptTextsV1;
  templateId: ContextTemplateId;
  slots: Readonly<Record<string, string | undefined>>;
  toolNames: readonly string[];
  residentBudgetBytes: number;
  residentBytes: number;
  sections: readonly ContextSectionPlanV1[];
};

/** The result of re-rendering one input with a replacement review instruction. */
export type ContextRerenderV1 = {
  input: string;
  sections: ContextAssemblyBindingV1['sections'];
  residentBytes: number;
  totalBytes: number;
};

/** Whether the Run's input announces Session history, and through where. */
export type HistoryDecisionV1 =
  | { mode: 'current_turn'; takesSessionHistory: false }
  | { mode: 'session_history'; takesSessionHistory: true;
      throughPosition: number; sourceSessionId: string | null };

/** The completed Turn boundary the history decision was read from (LA-1). */
export type CompletedHistoryBoundaryV1 = { cursor: string | null; position: number };

/** The one input the pure history rule takes (ruling 14). */
export type SessionHistoryDecisionInputV1 = {
  callKind: 'work' | 'query';
  sessionBasis: { sourceKernelSessionId: string; throughPosition: number | null } | undefined;
  /** C7: absent only for a Query with `sessionBasis`. */
  completedBoundary?: CompletedHistoryBoundaryV1;
};

/** The history seed a continuation or review Run derives at preparation. */
export type SessionBasisV1 = { sourceKernelSessionId: string; throughPosition: number | null };

/**
 * Ruling 14 C6: the Work history facts crossing the assembler seam. Preparation
 * reads no Kernel history: the presence of the Session's completed cursor is
 * all the recipe needs to decide whether the Run announces Session history.
 */
export type ContextWorkHistoryInputV1 = {
  callKind: 'work';
  hasCompletedCursor: boolean;
};

/**
 * Ruling 14 C7: a Query with a formal `sessionBasis` passes it and reads no
 * boundary; a Query without one passes the stored cursor's presence.
 */
export type ContextQueryHistoryInputV1 =
  | { callKind: 'query'; sessionBasis: SessionBasisV1 }
  | { callKind: 'query'; sessionBasis?: undefined; hasCompletedCursor: boolean };

export type AssembledContextV1 = {
  input: string; binding: ContextAssemblyBindingV1;
  continuationBrief: ContinuationBriefV1 | null;
  sessionBasis: PreparedTaskManifestV1['sessionBasis'] | undefined;
  selectedTaskInputs: PreparedTaskManifestV1['selectedTaskInputs'];
  /** Slice 1 §2.7: the anchors named by the brief's anomaly section (absent/null when it has none). */
  anomalyAnchorRefs?: SessionAnomalyAnchorRef[] | null;
  /** K3 L13: the structured review instruction of a review-purpose Run. */
  unknownCallReview?: UnknownCallReviewInputV1;
  /** Whether the recipe used Session history. */
  takesSessionHistory: boolean;
  /** What the review shrink re-renders from. */
  renderMaterial: ContextRenderMaterialV1;
};

export interface ContextAssembler {
  assembleTask(ctx: CoreCallContext, input: {
    execution: TaskExecutionRecord; role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
    configuration: ResolvedRuntimeConfiguration;
    permissions: TaskEnvelopeV1['permissions'];
    texts?: PromptTextsV1;
    /** The frozen `PromptSetV1.toolNames`, never recomputed here (ruling 10/16). */
    toolNames: readonly string[];
    history: ContextWorkHistoryInputV1;
  }): Promise<ReadResult<AssembledContextV1>>;
  assembleQuery(ctx: CoreCallContext, input: {
    facts: QueryPreparationFacts;
    role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
    configuration: ResolvedRuntimeConfiguration;
    permissions: PreparedQueryManifestV1['permissions'];
    question: string;
    texts?: PromptTextsV1;
    toolNames: readonly string[];
    history: ContextQueryHistoryInputV1;
    /** The one facts value preparation read before the final tool list; the recipe never reads the port. */
    secretaryFacts?: SecretaryPreparationFactsV1;
    /** SR3 item 6: the round's hand-off material preparation read once; the recipe renders it and derives nothing. */
    handoff?: SecretaryHandoffPromptFactsV1;
    /**
     * §3.15 item 5: the frozen platform facts preparation read once and resolved
     * (a `task` fact's definition, an opened `body`); the recipe renders them and
     * re-collects nothing.
     */
    consultationFacts?: { facts: ConsultationFactsV1; resolved: readonly ConsultationResolvedFactV1[] };
  }): Promise<ReadResult<AssembledContextV1>>;
  readAttentionGraph(ctx: CoreCallContext, request: AttentionGraphReadRequestV1): Promise<ReadResult<GraphAttentionFactsV1>>;
}

export type OptionalSectionName = 'footprint' | 'notes' | 'reminders' | 'inputs';
export type OptionalRow = { key: string; text: string };

export type ContextClock = { now?: () => string };
