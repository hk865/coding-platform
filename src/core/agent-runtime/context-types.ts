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
import type { TaskContextInputPort } from '../work-graph/model/context-input-contracts.js';
import type { TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import type { GraphContextReadPort } from '../work-graph/model/graph-context-contracts.js';
import type { ResolvedRuntimeConfiguration, RuntimeExecutionDependencies } from './execution-contracts.js';

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
    commandRerunRequests?: CommandRerunRequestReadPort };

export type AssembledContextV1 = {
  input: string; binding: ContextAssemblyBindingV1;
  continuationBrief: ContinuationBriefV1 | null;
  sessionBasis: PreparedTaskManifestV1['sessionBasis'] | undefined;
  selectedTaskInputs: PreparedTaskManifestV1['selectedTaskInputs'];
  /** Slice 1 §2.7: the anchors named by the brief's anomaly section (absent/null when it has none). */
  anomalyAnchorRefs?: SessionAnomalyAnchorRef[] | null;
  /** K3 L13: the structured review instruction of a review-purpose Run. */
  unknownCallReview?: UnknownCallReviewInputV1;
  /**
   * K3 L13 (D8): the byte offset where the rendered review instruction starts
   * in `input` (its trailing section). `prepare` re-renders from this offset when
   * it trims the instruction to fit the manifest.
   */
  reviewSectionStart?: number | null;
};

export interface ContextAssembler {
  assembleTask(ctx: CoreCallContext, input: {
    execution: TaskExecutionRecord; role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
    configuration: ResolvedRuntimeConfiguration;
    permissions: TaskEnvelopeV1['permissions'];
    texts?: PromptTextsV1;
  }): Promise<ReadResult<AssembledContextV1>>;
  assembleQuery(ctx: CoreCallContext, input: {
    facts: QueryPreparationFacts;
    role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
    configuration: ResolvedRuntimeConfiguration;
    permissions: PreparedQueryManifestV1['permissions'];
    question: string;
    texts?: PromptTextsV1;
  }): Promise<ReadResult<AssembledContextV1>>;
  readAttentionGraph(ctx: CoreCallContext, request: AttentionGraphReadRequestV1): Promise<ReadResult<GraphAttentionFactsV1>>;
}

export type OptionalSectionName = 'footprint' | 'notes' | 'reminders' | 'inputs';
export type OptionalRow = { key: string; text: string };

export type ContextClock = { now?: () => string };
