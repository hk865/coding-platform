/**
 * Slice 3 WorkGraph read-model contracts. Ports and owner-bound facts live here
 * because they need owner types; pure DTOs come from `contracts/graph-context.ts`.
 */
import type { AdoptedArchitecture, ModuleDefinition } from '../../../contracts/architecture-catalog.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../../contracts/dispatch.js';
import type {
  AttentionGraphReadRequestV1, ContextExtensionsV1, ContextSourceV1, GraphAttentionFactsV1,
  GraphNodeRefV1, InputDeclarationV1, InputSelectionV1,
} from '../../../contracts/graph-context.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type {
  AcceptanceObligation, DependencyRequirement, Phase, PlanRevisionRef, PlanStage, PlanTaskAssignment,
  RuntimeTask,
} from '../../../contracts/plan.js';
import type { TaskFailureFactsV1 } from '../../../contracts/task-failure.js';
import type { RoundSnapshot, VerificationRoundRef } from '../../../contracts/verification.js';
import type { TaskExecutionRecord } from './execution-read-contracts.js';
import type { TaskGraph } from './plan-contracts.js';

export type ContextReadRequestV1 = {
  goalRef: GoalRef;
  planRef?: PlanRevisionRef;
  focusTaskIds: string[];
  includeInputs?: boolean;
};
/** The extensions read of a request with no Goal: the project understanding
 * and norms only. The Goal-owned extensions are skipped, and the full context
 * read keeps its required Goal. */
export type ProjectContextExtensionsRequestV1 = {
  goalRef: null;
  focusTaskIds: readonly [];
};
export type ContextExtensionsRequestV1 = ContextReadRequestV1 | ProjectContextExtensionsRequestV1;
/** The one extensions provider. A project request carries no Goal; the method
 * signature is bivariant so a provider that answers only the Goal request
 * stays assignable to the published dependency. */
export type ContextExtensionsReaderV1 = {
  read(ctx: CoreCallContext, request: ContextExtensionsRequestV1): Promise<ReadResult<ContextExtensionsV1>>;
}['read'];
export type GraphContextFactsV1 = {
  goal: GoalSnapshot;
  graph: TaskGraph | null;
  architecture: AdoptedArchitecture | null;
  executions: TaskExecutionRecord[];
  inputs: InputSelectionV1[];
  extensions: ContextExtensionsV1;
  sources: ContextSourceV1[];
  readThrough: CommitCursor | null;
};
export type GraphTaskCardV1 = {
  ref: TaskTriple; planRef: PlanRevisionRef; definitionPlanRef: PlanRevisionRef;
  definition: RuntimeTask; assignment: PlanTaskAssignment | null;
  obligations: Omit<AcceptanceObligation, 'taskIds'>[];
  effectivePhase: Phase; failure: TaskFailureFactsV1 | null;
  stage: PlanStage | null; module: ModuleDefinition | null;
  upstream: InputDeclarationV1[];
  downstream: { consumer: TaskTriple; requires: DependencyRequirement }[];
};
export type NodeCardV1 = {
  node: GraphNodeRefV1; name: string; paths: string[]; summary: string;
  task: GraphTaskCardV1 | null;
  goal: GoalSnapshot | null; stage: PlanStage | null; module: ModuleDefinition | null;
  session: SessionRecord | null; run: RunSnapshot | null; round: RoundSnapshot | null;
  state: string | null; children: GraphNodeRefV1[]; neighbours: GraphNodeRefV1[];
  executions: RunRef[]; rounds: VerificationRoundRef[];
  inputDeclarations: InputDeclarationV1[];
  indexes: ContextExtensionsV1;
  sources: ContextSourceV1[];
};
export type GraphLookRequestV1 = {
  /** `null` is the project branch (no goal); Goal-owned targets and relations then refuse. */
  goalRef: GoalRef | null;
  target: { kind: 'node'; node: GraphNodeRefV1 } | { kind: 'path'; path: string };
  relation: 'card' | 'children' | 'neighbours' | 'executions' | 'checks';
  page: { afterCursor: string | null; limit: number };
};
export type GraphFindRequestV1 = {
  /** `null` is the project branch (no goal); find has no Goal-owned argument. */
  goalRef: GoalRef | null;
  needle: string;
  page: { afterCursor: string | null; limit: number };
};
export type GraphReadPageV1<T> = {
  items: T[]; nextCursor: string | null; readThrough: CommitCursor | null;
};
export interface GraphContextReadPort {
  readContextFacts(ctx: CoreCallContext, request: ContextReadRequestV1): Promise<ReadResult<GraphContextFactsV1>>;
  lookGraph(ctx: CoreCallContext, request: GraphLookRequestV1): Promise<ReadResult<GraphReadPageV1<NodeCardV1>>>;
  findGraph(ctx: CoreCallContext, request: GraphFindRequestV1): Promise<ReadResult<GraphReadPageV1<NodeCardV1>>>;
  readAttentionFacts(ctx: CoreCallContext, request: AttentionGraphReadRequestV1): Promise<ReadResult<GraphAttentionFactsV1>>;
}
