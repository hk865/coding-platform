/**
 * The secretary preparation seam (spec L8): the frozen facts one request
 * round prepares from, and the port the Runtime asks for them.
 *
 * Declarations only. The port is injected by composition; the implementation
 * lives in `views/`, so this module reads no store and publishes no route.
 */
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CompletionPolicyContentV1 } from '../../../contracts/governance.js';
import type { RegisteredCommandCheck } from '../../../contracts/verification.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { GoalDesiredState, GoalRef } from '../../../contracts/ledger.js';
import type {
  QueryJobRef, QueryRunRef, RequestInterventionSourceV1, SecretaryRoundMaterialV1,
} from '../../../contracts/query-job.js';
import type { RecordGuard } from '../../record-store/ports.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { TracedTaskFactsV1 } from '../state/plan-machine.js';

/**
 * 97-3: what a plan answer's submit check reads, as the propose and the adoption read it, so the two judge the same
 * facts: the current architecture (`readCurrentCatalogWindow`; null when none is active), which the propose checks
 * every plan's module scopes against and a later plan's adoption too; for a first plan the catalog governance
 * selected (`readSelectedCatalog`), which the first adoption checks them against (null for a later plan or before
 * governance resolves; a failed read is kept, since the adoption reads it only for a module-scoped task); the main
 * workspace a draft's module ids are qualified against (`qualifyPlanDraft`); and the effective Goal's adopted Plan
 * the round's segment merges into with the base's pinned policy, every base Task's execution facts and its closed
 * Tasks (`readPlanExecutionFacts`). `base` is null for a first plan.
 */
export type PlanAdmissionFactsV1 = {
  catalog: AdoptedArchitecture | null;
  firstAdoptionCatalog: null | { status: 'ready'; catalog: AdoptedArchitecture } | { status: 'rejected'; reason: string };
  mainWorkspaceId: string;
  base: null | {
    plan: PlanRevisionSnapshot;
    goalDesiredState: GoalDesiredState;
    pinnedPolicy: { status: 'resolved'; content: CompletionPolicyContentV1 } | { status: 'rejected'; reason: string };
    tasks: readonly TracedTaskFactsV1[];
    terminalTaskIds: readonly string[];
  };
};

/** One earlier round of the same request that ran on another Session. */
export type SecretaryHistoryEntryV1 = {
  round: SecretaryRoundMaterialV1;
  absorbed: SecretaryRoundMaterialV1[];
  session: SessionRef;
  result:
    | { kind: 'answer'; text: string }
    | { kind: 'no_answer'; closeCode: string }
    | { kind: 'not_ended' };
};

/**
 * Every fact one secretary preparation reads, at one watermark with its guards.
 *
 * `briefRef` is the hand-off operation the successor's brief belongs to, and
 * `understandingGrants` is the one still-valid grant set of the frozen material
 * list. Both are computed once in this read and never re-derived by a consumer.
 */
export type SecretaryPreparationFactsV1 = {
  request: {
    requestRoot: QueryJobRef;
    effectiveGoalId: string | null;
    preparationCursor: CommitCursor;
    round: SecretaryRoundMaterialV1;
    batch: SecretaryRoundMaterialV1[];
    earlier: SecretaryHistoryEntryV1[];
    briefRef: OperationRef | null;
    understandingGrants: GoalRef[];
    /** G6F F4: the source an `intervention_new_goal` request's root round keeps; null for every other request. */
    interventionSource: RequestInterventionSourceV1 | null;
  };
  workspace: { workspaceId: string; revision: number };
  executionRoles: readonly string[];
  architecture: { baselineId: string; revision: number; catalog: AdoptedArchitecture } | null;
  completionPolicy: { policyId: string; revision: number } | null;
  /**
   * 97-3: what a planning answer's submit check reads beside the catalog. The active policy's content with its
   * digest (null until both governance pointers are present), and the workspace's installed checks (null: no
   * configuration at all).
   */
  effectivePolicy: { digest: string; content: CompletionPolicyContentV1 } | null;
  installedChecks: readonly RegisteredCommandCheck[] | null;
  /**
   * RC：人已采用且那次采用已提交的计划检查，带 checkId 和当前内容摘要；规划轮提交用它放行同 id 换定义。
   * 没有人采用过的计划检查时是空数组；旧读者缺省读作没有。
   */
  adoptedPlanChecks?: readonly { checkId: string; digest: string }[];
  /**
   * RC L-2：计划来源的已装检查（不论当初谁批准），带 checkId 和当前内容摘要。规划提交按当前已装定义的来源判可替换；
   * 旧读者缺省读作没有。
   */
  planSourceChecks?: readonly { checkId: string; digest: string }[];
  /** Read only when the caller asks (`admission: true`, a plan answer's submit); null otherwise. */
  admission: PlanAdmissionFactsV1 | null;
  /** `phase` is the formal GoalPhase for the active Plan (`COMPLETED` or `ACCEPTED_PARTIAL`, `readGoalTerminalState`),
   *  else null (G6F F4). */
  goals: { goalId: string; desiredState: GoalDesiredState; phase: 'COMPLETED' | 'ACCEPTED_PARTIAL' | null;
    objective: string; ordinal: number | null }[];
  executionKind: 'semantic_query' | 'initial_coordination';
  guards: RecordGuard[];
  watermark: CommitCursor | null;
};

export interface SecretaryPreparationFactsPort {
  read(ctx: CoreCallContext, input: { queryRunRef: QueryRunRef; admission?: true }): Promise<ReadResult<SecretaryPreparationFactsV1>>;
}
