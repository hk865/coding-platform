import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { PreparedQueryManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { ReadResult } from '../../contracts/core/results.js';
import type { ContextAssemblyBindingV1, PlatformDutyV1 } from '../../contracts/graph-context.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { PromptTextsV1 } from '../../contracts/prompts/prompt-set.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import { messageOf } from '../../contracts/error-message.js';
import { rejected } from '../../contracts/core/rejections.js';
import { isRequestRound } from '../../contracts/query-job.js';
import type { FrozenHandoffBriefV1 } from '../../contracts/handoff-brief.js';
import { renderHandoffBriefZh } from '../../contracts/continuation-brief-render.js';
import { sha256Hex } from '../../contracts/fingerprint.js';
import type { QueryPreparationFacts } from '../work-graph/queries/contracts.js';
import type { SecretaryPreparationFactsV1 } from '../work-graph/model/secretary-contracts.js';
import type { GraphContextFactsV1, GraphReadPageV1, NodeCardV1 } from '../work-graph/model/graph-context-contracts.js';
import {
  annotations, effectiveDuty, goalPayload, notImplementedExtensions, noteSourcesOf,
  queryFocusLines, queryPlanSummary, rolePayload, topLevelModuleCards,
  type RolePayloadPermissionsV1 } from './context-fact-text.js';
import {
  CONTEXT_FORMAT_VERSION, queryContextPrelude, renderQueryContext, sectionOrderFor,
} from './context-rendering.js';
import { packString } from '../../contracts/prompts/pack-string.js';
import { consultationFactsLines } from './consultation-facts-text.js';
import { takesSessionHistoryOf } from './context-history-facts.js';
import { assembleSecretaryContext } from './context-secretary-recipe.js';
import { sortedSources } from './context-support.js';
import type {
  AssembledContextV1, ContextAssembler, ContextAssemblerDependencies, ContextQueryHistoryInputV1,
} from './context-types.js';
import type { ResolvedRuntimeConfiguration } from './execution-contracts.js';

/**
 * A role_exploration round has no Goal, so it reads the project branch of the same graph port
 * (`lookGraph` with `goalRef: null`): every module card from the root path, page by page. A
 * catalog with no module answers `not_found`, which is no cards.
 */
async function readProjectModuleCards(
  deps: ContextAssemblerDependencies, ctx: CoreCallContext,
): Promise<ReadResult<NodeCardV1[]>> {
  if (deps.graphContext === undefined) {
    return rejected('unavailable', 'the exploration Query has no graph context reader');
  }
  const cards: NodeCardV1[] = [];
  let afterCursor: string | null = null;
  do {
    let read: ReadResult<GraphReadPageV1<NodeCardV1>>;
    try {
      read = await deps.graphContext.lookGraph(ctx, {
        goalRef: null, target: { kind: 'path', path: '.' }, relation: 'card', page: { afterCursor, limit: 100 },
      });
    } catch (error) {
      return rejected('unavailable', `the exploration project graph read failed: ${messageOf(error)}`);
    }
    if (read.status === 'not_found') return { status: 'ready', value: cards };
    if (read.status !== 'ready') return read;
    cards.push(...read.value.items);
    afterCursor = read.value.nextCursor;
  } while (afterCursor !== null);
  return { status: 'ready', value: cards };
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
    /** The frozen `PromptSetV1.toolNames` (ruling 10/16). */
    toolNames: readonly string[];
    /** Ruling 14 C7: the Query's formal basis, or the real completed boundary. */
    history: ContextQueryHistoryInputV1;
    /** The successor's frozen record 5, read once by preparation; the recipe renders it into the role section. */
    record5?: Pick<FrozenHandoffBriefV1, 'binding' | 'material'>;
    /** The one facts value preparation read; the secretary recipe renders it and reads no port. */
    secretaryFacts?: SecretaryPreparationFactsV1;
    /** SR3 item 6: the round's hand-off material preparation read once; the recipe renders it and derives nothing. */
    handoff?: NonNullable<Parameters<ContextAssembler['assembleQuery']>[1]['handoff']>;
    /** §3.15 item 5: the frozen platform facts preparation read and resolved once. */
    consultationFacts?: NonNullable<Parameters<ContextAssembler['assembleQuery']>[1]['consultationFacts']>;
  },
): Promise<ReadResult<AssembledContextV1>> {
  const texts = input.texts ?? PLATFORM_PROMPT_PACK_V1;
  const job = input.facts.record?.job;
  if (job !== undefined && isRequestRound(job)) {
    // Preparation read the secretary facts once, before the final tool list,
    // and passes the same value beside the frozen input; the recipe never reads
    // the port itself.
    return assembleSecretaryContext(deps, ctx, input);
  }
  const S = (key: string): string => packString(texts, key);
  const residentBudgetBytes = typeof input.configuration?.contextResidentBytes === 'number'
    && Number.isSafeInteger(input.configuration.contextResidentBytes) && input.configuration.contextResidentBytes >= 0
    ? input.configuration.contextResidentBytes : 4096;
  const dutyResult = effectiveDuty(input.role, input.configuration, input.facts.record?.session?.role, texts);
  if ('rejection' in dutyResult) return dutyResult.rejection;
  const duty: PlatformDutyV1 = dutyResult.duty;
  const permissions: RolePayloadPermissionsV1 = {
    policyRevision: input.configuration?.configurationRevision ?? '',
    tools: [...input.permissions.tools], writeScope: [...input.permissions.writeScope],
  };
  const roleBase = rolePayload(input.role, permissions, duty, residentBudgetBytes, texts);
  const record5 = input.record5;
  const record5Text = record5 === undefined ? null : renderHandoffBriefZh(record5.material, texts);
  const roleSection = record5Text === null ? roleBase : roleBase + '\n\n' + record5Text;
  const goal = input.facts.goal;
  const workspace = input.facts.workspace;
  const queryKind = input.facts.record?.job?.job?.intent?.execution?.kind;
  const execution = input.facts.record?.job?.job?.intent?.execution;
  const exploration = queryKind === 'role_exploration';
  // A saved-message consultation Query on a goal-less line is the other no-goal
  // round: its frozen facts and question ride the role section.
  const consultationRound = queryKind === 'semantic_query' && execution?.consultation !== undefined;
  // The plain Query recipe reads the graph context of its Goal. A request round
  // without a goal takes the secretary recipe before this point; a role_exploration
  // round has no Goal and reads the project instead.
  if (goal === null && !exploration && !consultationRound) return rejected('invalid', 'no goal');

  // §4.2/G5.1: a Query reads the same graph context when the port is wired; a
  // graph rejection passes through unchanged and is never a legacy fallback.
  // Query has no inputs section, so `includeInputs` stays false. The exploration
  // round takes no Goal read (that request needs a GoalRef).
  let facts: GraphContextFactsV1 | null = null;
  if (deps.graphContext !== undefined && goal !== null && !exploration) {
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
  // The exploration footprint is the project's top-level modules, rebuilt from the module cards and their child
  // modules. The cards' memory indexes go only into the binding's extension annotations: no notes section is
  // rendered, so no note source is recorded.
  let projectCards: NodeCardV1[] | null = null;
  if (exploration) {
    const read = await readProjectModuleCards(deps, ctx);
    if (read.status !== 'ready') return read;
    projectCards = read.value;
  }
  const projectArchitecture = projectCards === null ? null : {
    modules: projectCards.flatMap((card) => card.module === null ? [] : [card.module]),
    containment: { parentOf: projectCards.flatMap((card) => {
      const parent = card.module;
      return parent === null ? [] : card.children.flatMap((child) =>
        child.kind === 'module' ? [{ parent: parent.ref, child: child.ref }] : []);
    }) },
  };
  const intervention = queryKind === 'intervention_planning';
  const planning = intervention || (facts !== null && queryKind === 'initial_coordination');
  const extensions = facts?.extensions ?? projectCards?.[0]?.indexes ?? notImplementedExtensions();
  const goalText = goal === null ? null
    : goalPayload(facts?.goal ?? goal, workspace.revision, extensions, texts);
  const consultationText = input.consultationFacts === undefined ? null
    : consultationFactsLines(input.consultationFacts.facts, input.consultationFacts.resolved, texts);
  // The intervention template has its own `message` slot, so the question leaves the goal section
  // (otherwise it would render twice); every other kind keeps today's goal+questionHeading+question text.
  const goalSection = goalText === null ? null : intervention ? goalText
    : `${goalText}\n${consultationText === null ? '' : consultationText + '\n'}${S('context.questionHeading')}\n${input.question}`;
  const consultationOnlySection = goal === null && consultationRound
    ? `${consultationText === null ? '' : consultationText + '\n'}${S('context.questionHeading')}\n${input.question}`
    : null;
  const taskSection = exploration || consultationOnlySection !== null ? null : intervention ? null
    : planning && input.facts.focusPlan !== null
      ? queryPlanSummary(input.facts.focusPlan, texts)
      : planning ? null : queryFocusLines(input.facts, facts?.graph ?? null, texts);
  const footprintRows = (planning || exploration) && !intervention
    ? topLevelModuleCards(exploration ? projectArchitecture : facts?.architecture ?? null) : [];
  // Ruling 14: the ONE pure mode rule. A Query with a formal basis follows it
  // and reads no boundary (C7); without one it follows the stored cursor.
  const history = input.history;
  const takesSessionHistory = takesSessionHistoryOf({
    callKind: 'query',
    sessionBasis: history.sessionBasis,
    hasCompletedCursor: history.sessionBasis === undefined && history.hasCompletedCursor,
  });
  const callKind = exploration ? 'role_exploration' as const
    : intervention ? 'intervention_planning' as const : planning ? 'planning' as const : 'copy' as const;
  // The exploration round has no new template: it uses the planning input template, and its question rides
  // the role section because the round has no goal section.
  const templateId = exploration ? 'query-planning-input' as const
    : intervention ? 'intervention-planning' as const
      : planning ? 'query-planning-input' as const : 'query-copy-input' as const;
  const sectionOrder = sectionOrderFor(callKind, templateId, texts);
  const rendered = renderQueryContext({
    templateId,
    prelude: queryContextPrelude(texts),
    required: { role: exploration ? roleSection + '\n' + input.question
      : consultationOnlySection === null ? roleSection : roleSection + '\n' + consultationOnlySection,
      goal: goalSection, task: taskSection },
    ...(intervention ? { plan: input.facts.focusPlan === null ? null : queryPlanSummary(input.facts.focusPlan, texts), message: input.question } : {}),
    optional: exploration ? { footprint: footprintRows }
      : planning && !intervention ? { footprint: footprintRows } : {},
    residentBudgetBytes,
    sectionOrder,
    toolNames: input.toolNames,
    takesSessionHistory,
    texts,
  });
  const binding: ContextAssemblyBindingV1 = {
    schemaVersion: 1,
    formatVersion: CONTEXT_FORMAT_VERSION,
    callKind,
    sectionOrder,
    duty,
    residentBudgetBytes,
    residentBytes: rendered.residentBytes,
    totalBytes: rendered.totalBytes,
    sections: rendered.sections,
    // §11.4/L20 (C-04): a Query renders understanding + norms only, so
    // `keptGeneral` is empty and no general note source is recorded.
    sources: sortedSources([...(facts?.sources ?? []),
      ...(exploration ? [] : noteSourcesOf(extensions.notes, [], texts))]),
    inputSelections: [],
    extensions: annotations(extensions),
  };
  return { status: 'ready', value: { input: rendered.input, binding, continuationBrief: null,
    ...(record5 === undefined ? {} : { handoffBrief: { binding: record5.binding, material: record5.material,
      renderedDigest: sha256Hex(record5Text!) } }),
    sessionBasis: undefined, selectedTaskInputs: [], takesSessionHistory, renderMaterial: rendered.material } };
}
