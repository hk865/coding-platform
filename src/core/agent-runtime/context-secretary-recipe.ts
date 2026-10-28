/**
 * The secretary round's context recipe. A request round renders the
 * `secretary-round` template from the frozen secretary preparation facts; the
 * three `task_*` slots are one `task` section in the binding.
 *
 * The facts are declared input: preparation reads the port once, before the
 * final tool list, and hands the same value to the admission, this recipe, the
 * render and the manifest. The recipe never reads the port. The shared renderer
 * owns the note budget, the omission block's place at the end of the task segment
 * and the three-slot task range; this file only composes the section bodies.
 */
import { messageOf } from '../../contracts/error-message.js';
import { rejected } from '../../contracts/core/rejections.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type { PreparedQueryManifestV1 } from '../../contracts/core/prepared-execution.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import type { ReadResult } from '../../contracts/core/results.js';
import { truncateUtf8 } from '../../contracts/utf8.js';
import type {
  ContextAssemblyBindingV1, ContextExtensionsV1, NoteIndexRowV1, PlatformDutyV1,
} from '../../contracts/graph-context.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { PromptTextsV1 } from '../../contracts/prompts/prompt-set.js';
import { renderTemplate } from '../../contracts/prompts/render-template.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { SecretaryRoundMaterialV1, QueryJobRef } from '../../contracts/query-job.js';
import type { QueryPreparationFacts } from '../work-graph/queries/contracts.js';
import type { GraphContextFactsV1 } from '../work-graph/model/graph-context-contracts.js';
import type { NoteMemoryMaterialV1 } from '../work-graph/model/note-contracts.js';
import { SECRETARY_HISTORY_ANSWER_BYTES } from '../work-graph/model/request-contracts.js';
import type {
  HandoffBriefNoteV1, HandoffBriefV1,
} from '../work-graph/model/secretary-lifecycle-contracts.js';
import type {
  SecretaryHistoryEntryV1, SecretaryPreparationFactsV1,
} from '../work-graph/model/secretary-contracts.js';
import {
  annotations, effectiveDuty, goalPayload, notImplementedExtensions, noteSourcesOf,
  optionalRowsFromExtensions, rolePayload, topLevelModuleCards, understandingLine, withNoteVersion,
} from './context-fact-text.js';
import { takesSessionHistoryOf } from './context-history-facts.js';
import {
  CONTEXT_FORMAT_VERSION, contextSectionHeaders, queryContextPrelude, renderQueryContext,
  sectionOrderFor,
} from './context-rendering.js';
import { packString } from '../../contracts/prompts/pack-string.js';
import { sortedSources } from './context-support.js';
import type {
  AssembledContextV1, ContextAssemblerDependencies, ContextQueryHistoryInputV1, OptionalRow,
} from './context-types.js';
import type { ResolvedRuntimeConfiguration } from './execution-contracts.js';

/** The objective's first line, cut to 160 code points with `…` when it is longer. */
function goalLineObjective(objective: string): string {
  const firstLine = objective.split('\n')[0] ?? '';
  const codePoints = [...firstLine];
  return codePoints.length > 160 ? `${codePoints.slice(0, 160).join('')}…` : firstLine;
}

/**
 * One card ref of a round: `- <aggregateType> <the ref's other fields as
 * canonical JSON> @<pinned revision>`, then ` (now @<current>)` when the
 * object's revision moved since the card was read, or ` (not found)` when the
 * object does not exist. The secretary reads the details through look/find.
 */
function relatedCardLine(card: SecretaryRoundMaterialV1['relatedCards'][number]): string {
  const { aggregateType, ...id } = card.ref.ref as unknown as Record<string, JsonValue>;
  const line = `- ${String(aggregateType)} ${canonicalJson(id)} @${String(card.ref.revision)}`;
  if (card.current === null) return `${line} (not found)`;
  return card.current === card.ref.revision ? line : `${line} (now @${String(card.current)})`;
}

/**
 * `- [<since>] <input>`, then the selected idea when there is one, then the
 * card refs the round carries (an `ask`) under their heading. A round with
 * none of these renders its input line alone.
 */
export function roundMaterial(round: SecretaryRoundMaterialV1, texts: PromptTextsV1): string {
  const lines = [`- [${round.since}] ${round.text}`];
  if (round.selectedIdea !== null) {
    lines.push(packString(texts, 'secretary.selectedIdea'), `${round.selectedIdea.title}: ${round.selectedIdea.detail}`);
  }
  if (round.relatedCards.length > 0) {
    lines.push(packString(texts, 'secretary.cardsHeading'), ...round.relatedCards.map(relatedCardLine));
  }
  return lines.join('\n');
}

/** One earlier round on another Session: its material, absorbed rounds, then its result line. */
function earlierEntryText(entry: SecretaryHistoryEntryV1, texts: PromptTextsV1): string {
  const parts = [roundMaterial(entry.round, texts)];
  for (const absorbed of entry.absorbed) parts.push(roundMaterial(absorbed, texts));
  let result: string;
  switch (entry.result.kind) {
    case 'answer': {
      const kept = truncateUtf8(entry.result.text, SECRETARY_HISTORY_ANSWER_BYTES);
      result = kept.length < entry.result.text.length
        ? `${kept}\n${packString(texts, 'secretary.answerOmitted')}` : kept;
      break;
    }
    case 'no_answer':
      result = `${packString(texts, 'secretary.noAnswer')} ${entry.result.closeCode}`;
      break;
    case 'not_ended':
      result = packString(texts, 'secretary.notEnded');
      break;
  }
  return [...parts, result].join('\n');
}

/**
 * The handoff material of a secretary round: an old secretary's understanding
 * round carries the goals its live command lists; a successor's first entered
 * round carries the brief it now owns. Both are read by the caller from the
 * frozen manifest (the live command) or the handoff brief port; this recipe
 * never re-derives either.
 */
export type SecretaryHandoffPromptFactsV1 =
  | { kind: 'understanding'; goals: readonly GoalRef[] }
  | { kind: 'brief'; brief: HandoffBriefV1 };

/** A reference line: the aggregate then the identifying fields as canonical JSON, one line. */
function goalReferenceText(ref: GoalRef): string {
  return `Goal ${canonicalJson({ projectId: ref.projectId, goalId: ref.goalId })}`;
}

function requestReferenceText(ref: QueryJobRef): string {
  return `QueryJob ${canonicalJson({
    projectId: ref.projectId, workspaceId: ref.workspaceId, queryJobId: ref.queryJobId,
  })}`;
}

function sessionReferenceText(ref: SessionRef): string {
  return `Session ${canonicalJson({ projectId: ref.projectId, sessionId: ref.sessionId })}`;
}

/** One understanding pointer of a brief: its id, version and text, or the pack's `(none)`. */
function briefNoteText(note: HandoffBriefNoteV1 | null, texts: PromptTextsV1): string {
  return note === null
    ? packString(texts, 'context.none')
    : `${note.noteId}@${String(note.version)}: ${note.text}`;
}

/**
 * Renders the handoff template into the one `task_round` value the secretary
 * round prepends: the five-part instruction and the command's goal list for an
 * understanding round, or the whole brief for a successor's first round.
 */
function handoffPromptText(
  facts: SecretaryHandoffPromptFactsV1, texts: PromptTextsV1, toolNames: readonly string[],
): string {
  if (facts.kind === 'understanding') {
    const taskRound = [
      packString(texts, 'handoff.understandingInstruction'),
      ...facts.goals.map((goal) => `- ${goalReferenceText(goal)}`),
    ].join('\n');
    return renderTemplate(texts, 'handoff-write-understanding-secretary', { task_round: taskRound }, toolNames).text;
  }
  const brief = facts.brief;
  const lines = [packString(texts, 'handoff.briefHeading')];
  for (const request of brief.requests) {
    lines.push(`- request ${requestReferenceText(request.requestRoot)}`);
    lines.push(`  original text: ${request.text}`);
    lines.push(`  last answer: ${request.lastAnswer ?? packString(texts, 'secretary.noAnswer')}`);
  }
  for (const goal of brief.goals) {
    lines.push(`- ${goalReferenceText(goal.goalRef)}`);
    lines.push(`  written understanding: ${briefNoteText(goal.written, texts)}`);
    lines.push(`  current understanding: ${briefNoteText(goal.current, texts)}`);
  }
  lines.push(`- old line: ${sessionReferenceText(brief.line)}`);
  lines.push(packString(texts, 'handoff.briefTools'));
  return renderTemplate(texts, 'handoff-brief-secretary', { task_round: lines.join('\n') }, toolNames).text;
}

export async function assembleSecretaryContext(
  deps: ContextAssemblerDependencies, ctx: CoreCallContext,
  input: {
    facts: QueryPreparationFacts;
    role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
    configuration: ResolvedRuntimeConfiguration;
    permissions: PreparedQueryManifestV1['permissions'];
    question: string; texts?: PromptTextsV1; toolNames: readonly string[];
    history: ContextQueryHistoryInputV1;
    /** The handoff material this round prepends; absent when the round has no handoff. */
    handoff?: SecretaryHandoffPromptFactsV1;
    /** The one facts value preparation read; this recipe never reads the port. */
    secretaryFacts?: SecretaryPreparationFactsV1;
  },
): Promise<ReadResult<AssembledContextV1>> {
  const texts = input.texts ?? PLATFORM_PROMPT_PACK_V1;
  const headers = contextSectionHeaders(texts);
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
  const history = input.history;
  const takesSessionHistory = takesSessionHistoryOf({
    callKind: 'query',
    sessionBasis: history.sessionBasis,
    hasCompletedCursor: history.sessionBasis === undefined && history.hasCompletedCursor,
  });
  const roleSection = rolePayload(input.role, permissions, duty, residentBudgetBytes, texts);

  // Both are declared inputs from preparation; their absence is `unavailable`
  // before any model call, never an empty fact set.
  const secretary = input.secretaryFacts;
  if (secretary === undefined) return rejected('unavailable', 'a secretary round requires the secretary preparation facts');
  const memory = deps.memoryMaterial;
  if (memory === undefined) return rejected('unsupported', 'the secretary note memory read is not wired');

  const effectiveGoalId = secretary.request.effectiveGoalId;
  const goal = input.facts.goal;

  let extensions: ContextExtensionsV1 = notImplementedExtensions();
  let noteRows: OptionalRow[];
  let goalGeneral: NoteIndexRowV1[] = [];
  let noGoalMaterial: NoteMemoryMaterialV1 | null = null;
  let goalPayloadText: string;

  if (effectiveGoalId !== null) {
    if (goal === null) return rejected('invalid', 'a secretary goal request requires the goal facts');
    // §4.2/G5.1: the same one graph read the Query recipe takes; a rejection
    // passes through unchanged and is never a legacy fallback.
    if (deps.graphContext !== undefined) {
      let read: ReadResult<GraphContextFactsV1>;
      try {
        read = await deps.graphContext.readContextFacts(ctx, {
          goalRef: goal.ref,
          focusTaskIds: [],
          includeInputs: false,
        });
      } catch (error) {
        return rejected('unavailable', `the Query graph context read failed: ${messageOf(error)}`);
      }
      if (read.status !== 'ready') return read;
      extensions = read.value.extensions;
    }
    goalPayloadText = goalPayload(goal, secretary.workspace.revision, extensions, texts);
    const read = await memory.readMemoryMaterial(ctx, { goalId: goal.ref.goalId, includeInputs: true });
    if (read.status !== 'ready') return read;
    goalGeneral = read.value.general;
    noteRows = optionalRowsFromExtensions(
      { ...extensions, notes: { ...extensions.notes, general: goalGeneral } }, texts).notes;
  } else {
    goalPayloadText = packString(texts, 'secretary.noGoal');
    const read = await memory.readMemoryMaterial(ctx, { goalId: null, includeInputs: false });
    if (read.status !== 'ready') return read;
    const material = read.value;
    noGoalMaterial = material;
    const notesProjection: ContextExtensionsV1['notes'] = {
      availability: 'available',
      understanding: {
        rows: material.projectUnderstanding === null ? [] : [material.projectUnderstanding],
        norms: material.norms,
        normsOmitted: material.normsOmitted,
      },
      general: [],
    };
    extensions = { ...extensions, notes: notesProjection };
    noteRows = [];
    if (material.projectUnderstanding !== null) {
      noteRows.push({ key: 'understanding:project',
        text: understandingLine(material.projectUnderstanding, texts) });
    }
    for (const norm of material.norms) {
      noteRows.push({ key: `norm:${norm.anchorKey}\u0000${norm.noteId}@${String(norm.version)}`,
        text: withNoteVersion(norm.label, norm.noteId, norm.version, texts) });
    }
    if (material.normsOmitted > 0) {
      noteRows.push({ key: 'norms-omitted', text: packString(texts, 'context.understanding.normsOmittedPrefix')
        + String(material.normsOmitted) + packString(texts, 'context.understanding.normsOmittedSuffix') });
    }
  }

  const workspace = secretary.workspace;
  const architecture = secretary.architecture;
  const policy = secretary.completionPolicy;
  const goalLines = [
    packString(texts, 'secretary.workspaceHeading'),
    `projectId: ${ctx.projectId}`,
    `workspace: ${workspace.workspaceId}@${String(workspace.revision)}`,
    architecture === null
      ? `architecture: ${packString(texts, 'context.none')}`
      : `architecture: ${architecture.baselineId}@${String(architecture.revision)}`,
    policy === null
      ? `completion policy: ${packString(texts, 'context.none')}`
      : `completion policy: ${policy.policyId}@${String(policy.revision)}`,
    `available roles: ${secretary.executionRoles.length === 0
      ? packString(texts, 'context.none') : secretary.executionRoles.join(', ')}`,
    ...(architecture === null ? [] : topLevelModuleCards(architecture.catalog).map((row) => row.text)),
    packString(texts, 'secretary.goalsHeading'),
    ...(secretary.goals.length === 0
      ? [packString(texts, 'context.none')]
      : secretary.goals.map((entry) =>
        `- ${entry.goalId} [${entry.desiredState}] ${goalLineObjective(entry.objective)}`)),
  ];
  const goalSection = [...goalLines, goalPayloadText].join('\n');

  const answerFormat = secretary.executionKind === 'semantic_query'
    ? renderTemplate(texts, 'secretary-answer', {}, input.toolNames).text
    : renderTemplate(texts, 'initial-planning-answer', {}, input.toolNames).text
      + '\n' + packString(texts, 'secretary.setupRequired')
      + (effectiveGoalId === null ? '\n' + packString(texts, 'secretary.initialDrafts') : '');
  // Required handoff material is task material: it goes in front of the round,
  // never in the trimmable notes. One blank line separates it from the round.
  const handoffSection = input.handoff === undefined
    ? null
    : handoffPromptText(input.handoff, texts, input.toolNames);
  const taskRoundSection = `${handoffSection === null ? '' : `${handoffSection}\n\n`}`
    + `${packString(texts, 'secretary.roundHeading')}\n`
    + `${roundMaterial(secretary.request.round, texts)}\n\n${answerFormat}`;
  const taskBatchedSection = secretary.request.batch.length === 0
    ? null
    : `${packString(texts, 'secretary.batchedHeading')}\n`
      + secretary.request.batch.map((round) => roundMaterial(round, texts)).join('\n');
  const taskEarlierSection = secretary.request.earlier.length === 0
    ? null
    : `${packString(texts, 'secretary.earlierHeading')}\n`
      + secretary.request.earlier.map((entry) => earlierEntryText(entry, texts)).join('\n\n');

  const sectionOrder = sectionOrderFor('secretary', 'secretary-round', texts);
  const rendered = renderQueryContext({
    templateId: 'secretary-round',
    prelude: queryContextPrelude(texts),
    required: { role: roleSection, goal: goalSection, task: null },
    taskSlots: { round: taskRoundSection, batched: taskBatchedSection, earlier: taskEarlierSection },
    optional: { notes: noteRows },
    residentBudgetBytes,
    sectionOrder,
    toolNames: input.toolNames,
    takesSessionHistory,
    texts,
  });

  // The shared budget reports how many note rows it dropped; the binding lists
  // only the rows actually rendered. The no-goal notes are the project
  // understanding then the norms, so the same kept prefix trims both.
  const notesOmitted = rendered.sections.find((section) => section.name === 'notes')?.omitted ?? 0;
  const keptNotes = noteRows.length - notesOmitted;
  let sources;
  if (effectiveGoalId !== null) {
    const keptGeneral = goalGeneral.slice(0, Math.max(0, keptNotes));
    sources = noteSourcesOf(extensions.notes, keptGeneral, texts);
  } else {
    if (noGoalMaterial === null) return rejected('unavailable', 'the no-goal note material was not read');
    const project = noGoalMaterial;
    const understandingRows = project.projectUnderstanding === null ? [] : [project.projectUnderstanding];
    const understandingKept = Math.max(0, Math.min(understandingRows.length, keptNotes));
    const normsKept = Math.max(0, Math.min(project.norms.length, keptNotes - understandingKept));
    const trimmed: ContextExtensionsV1['notes'] = {
      availability: 'available',
      understanding: {
        rows: understandingRows.slice(0, understandingKept),
        norms: project.norms.slice(0, normsKept),
        normsOmitted: project.normsOmitted,
      },
      general: [],
    };
    sources = noteSourcesOf(trimmed, [], texts);
  }

  const binding: ContextAssemblyBindingV1 = {
    schemaVersion: 1,
    formatVersion: CONTEXT_FORMAT_VERSION,
    callKind: 'secretary',
    sectionOrder,
    duty,
    residentBudgetBytes,
    residentBytes: rendered.residentBytes,
    totalBytes: rendered.totalBytes,
    sections: rendered.sections,
    sources: sortedSources(sources),
    inputSelections: [],
    extensions: annotations(extensions),
  };
  return {
    status: 'ready',
    value: {
      input: rendered.input, binding, continuationBrief: null, sessionBasis: undefined,
      selectedTaskInputs: [], takesSessionHistory, renderMaterial: rendered.material,
    },
  };
}
