import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { PreparedQueryManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { ReadResult } from '../../contracts/core/results.js';
import type { ContextAssemblyBindingV1, PlatformDutyV1 } from '../../contracts/graph-context.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { PromptTextsV1 } from '../../contracts/prompts/prompt-set.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { QueryPreparationFacts } from '../work-graph/queries/contracts.js';
import type { GraphContextFactsV1 } from '../work-graph/model/graph-context-contracts.js';
import {
  annotations, effectiveDuty, goalPayload, notImplementedExtensions, noteSourcesOf,
  queryFocusLines, queryPlanSummary, rolePayload, topLevelModuleCards,
} from './context-fact-text.js';
import {
  CONTEXT_FORMAT_VERSION, queryContextPrelude, renderQueryContext,
} from './context-rendering.js';
import { messageOf, rejected, sortedSources } from './context-support.js';
import type { AssembledContextV1, ContextAssemblerDependencies } from './context-types.js';
import type { ResolvedRuntimeConfiguration } from './execution-contracts.js';

/** One fixed string of the resolved pack; a missing key is a pack bug. */
function packString(texts: PromptTextsV1, key: string): string {
  const value = texts.strings[key];
  if (value === undefined) throw new Error(`the resolved prompt pack has no string "${key}"`);
  return value;
}

export async function assembleQueryContext(
  deps: ContextAssemblerDependencies, ctx: CoreCallContext,
  input: {
    facts: QueryPreparationFacts;
    role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
    configuration: ResolvedRuntimeConfiguration;
    permissions: PreparedQueryManifestV1['permissions'];
    question: string;
    /** The resolved pack (ruling 14); absent keeps the generated pack. */
    texts?: PromptTextsV1;
  },
): Promise<ReadResult<AssembledContextV1>> {
  const texts = input.texts ?? PLATFORM_PROMPT_PACK_V1;
  const S = (key: string): string => packString(texts, key);
  const residentBudgetBytes = typeof input.configuration?.contextResidentBytes === 'number'
    && Number.isSafeInteger(input.configuration.contextResidentBytes) && input.configuration.contextResidentBytes >= 0
    ? input.configuration.contextResidentBytes : 4096;
  const dutyResult = effectiveDuty(input.role, input.configuration, input.facts.record?.session?.role, texts);
  if ('rejection' in dutyResult) return dutyResult.rejection;
  const duty: PlatformDutyV1 = dutyResult.duty;
  const permissions: TaskEnvelopeV1['permissions'] = {
    policyRevision: input.configuration?.configurationRevision ?? '',
    tools: [...input.permissions.tools], writeScope: [...input.permissions.writeScope],
  };
  const roleSection = rolePayload(input.role, permissions, duty, residentBudgetBytes, texts);
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
  const goalSection = `${goalPayload(facts?.goal ?? goal, workspace.revision, extensions, texts)}\n${S('context.questionHeading')}\n${input.question}`;
  const taskSection = planning && input.facts.focusPlan !== null
    ? queryPlanSummary(input.facts.focusPlan, texts)
    : planning ? null : queryFocusLines(input.facts, facts?.graph ?? null, texts);
  const footprintRows = planning ? topLevelModuleCards(facts?.architecture ?? null) : [];
  const rendered = renderQueryContext({
    templateId: planning ? 'query-planning-input' : 'query-copy-input',
    prelude: queryContextPrelude(texts),
    required: { role: roleSection, goal: goalSection, task: taskSection },
    optional: planning ? { footprint: footprintRows } : {},
    residentBudgetBytes,
    texts,
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
    sources: sortedSources([...(facts?.sources ?? []), ...noteSourcesOf(extensions.notes, [], texts)]),
    inputSelections: [],
    extensions: annotations(extensions),
  };
  return { status: 'ready', value: { input: rendered.input, binding, continuationBrief: null, sessionBasis: undefined, selectedTaskInputs: [] } };
}
