import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { PreparedQueryManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { ReadResult } from '../../contracts/core/results.js';
import type { ContextAssemblyBindingV1, PlatformDutyV1 } from '../../contracts/graph-context.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { QueryPreparationFacts } from '../work-graph/queries/contracts.js';
import type { GraphContextFactsV1 } from '../work-graph/model/graph-context-contracts.js';
import {
  annotations, effectiveDuty, goalPayload, notImplementedExtensions, noteSourcesOf,
  queryFocusLines, queryPlanSummary, rolePayload, topLevelModuleCards,
} from './context-fact-text.js';
import { CONTEXT_FORMAT_VERSION, QUERY_CONTEXT_PRELUDE, renderQueryContext } from './context-rendering.js';
import { messageOf, rejected, sortedSources } from './context-support.js';
import type { AssembledContextV1, ContextAssemblerDependencies } from './context-types.js';
import type { ResolvedRuntimeConfiguration } from './execution-contracts.js';

const S = PLATFORM_PROMPT_PACK_V1.strings;

export async function assembleQueryContext(
  deps: ContextAssemblerDependencies, ctx: CoreCallContext,
  input: {
    facts: QueryPreparationFacts;
    role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
    configuration: ResolvedRuntimeConfiguration;
    permissions: PreparedQueryManifestV1['permissions'];
    question: string;
  },
): Promise<ReadResult<AssembledContextV1>> {
  const residentBudgetBytes = typeof input.configuration?.contextResidentBytes === 'number'
    && Number.isSafeInteger(input.configuration.contextResidentBytes) && input.configuration.contextResidentBytes >= 0
    ? input.configuration.contextResidentBytes : 4096;
  const dutyResult = effectiveDuty(input.role, input.configuration, input.facts.record?.session?.role);
  if ('rejection' in dutyResult) return dutyResult.rejection;
  const duty: PlatformDutyV1 = dutyResult.duty;
  const permissions: TaskEnvelopeV1['permissions'] = {
    policyRevision: input.configuration?.configurationRevision ?? '',
    tools: [...input.permissions.tools], writeScope: [...input.permissions.writeScope],
  };
  const roleSection = rolePayload(input.role, permissions, duty, residentBudgetBytes);
  const goal = input.facts.goal;
  const workspace = input.facts.workspace;

  // §4.2/G5.1: a Query reads the same graph context when the port is wired; a
  // graph rejection passes through unchanged and is never a legacy fallback.
  // Query has no inputs section, so `includeInputs` stays false.
  let facts: GraphContextFactsV1 | null = null;
  if (deps.graphContext !== undefined) {
    const focusTaskIds = (input.facts.record?.job?.job?.intent?.focusTaskRefs ?? []).map((ref) => ref.taskId);
    let read: ReadResult<GraphContextFactsV1>;
    try {
      read = await deps.graphContext.readContextFacts(ctx, {
        goalRef: goal.ref,
        ...(input.facts.focusPlan === null ? {} : { planRef: input.facts.focusPlan.ref }),
        focusTaskIds,
        includeInputs: false,
      });
    } catch (error) {
      return rejected('unavailable', `the Query graph context read failed: ${messageOf(error)}`);
    }
    if (read.status !== 'ready') return read;
    facts = read.value;
  }
  const queryKind = input.facts.record?.job?.job?.intent?.execution?.kind;
  const planning = facts !== null && queryKind === 'initial_coordination';
  const extensions = facts?.extensions ?? notImplementedExtensions();
  const goalSection = `${goalPayload(facts?.goal ?? goal, workspace.revision, extensions)}\n${S['context.questionHeading']}\n${input.question}`;
  const taskSection = planning && input.facts.focusPlan !== null
    ? queryPlanSummary(input.facts.focusPlan)
    : planning ? null : queryFocusLines(input.facts, facts?.graph ?? null);
  const footprintRows = planning ? topLevelModuleCards(facts?.architecture ?? null) : [];
  const rendered = renderQueryContext({
    templateId: planning ? 'query-planning-input' : 'query-copy-input',
    prelude: QUERY_CONTEXT_PRELUDE,
    required: { role: roleSection, goal: goalSection, task: taskSection },
    optional: planning ? { footprint: footprintRows } : {},
    residentBudgetBytes,
  });
  const binding: ContextAssemblyBindingV1 = {
    schemaVersion: 1,
    formatVersion: CONTEXT_FORMAT_VERSION,
    callKind: planning ? 'planning' : 'copy',
    duty,
    residentBudgetBytes,
    residentBytes: rendered.residentBytes,
    totalBytes: rendered.totalBytes,
    sections: rendered.sections,
    // §11.4/L20 (C-04): a Query renders understanding + norms only, so
    // `keptGeneral` is empty and no general note source is recorded.
    sources: sortedSources([...(facts?.sources ?? []), ...noteSourcesOf(extensions.notes, [])]),
    inputSelections: [],
    extensions: annotations(extensions),
  };
  return { status: 'ready', value: { input: rendered.input, binding, continuationBrief: null, sessionBasis: undefined, selectedTaskInputs: [] } };
}
