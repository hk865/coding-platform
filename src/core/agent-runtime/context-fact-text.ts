import { rejected } from '../../contracts/core/rejections.js';
import { packString } from '../../contracts/prompts/pack-string.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import type { RoleConfigurationRef } from '../../contracts/core/identity.js';
import type { TaskTriple } from '../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import { edgeDeclarationId, legacyDeclarationId } from '../../contracts/input-declaration-id.js';
import type {
  ContextAssemblyBindingV1, ContextExtensionsV1, ContextIndexRowV1, ContextSourceV1, InputDeclarationV1,
  InputSelectionV1, NoteIndexRowV1, NotesUnderstandingRowV1, PlatformDutyV1,
} from '../../contracts/graph-context.js';
import type { GoalSnapshot } from '../../contracts/ledger.js';
import type { PlanRevisionSnapshot, RuntimeTask } from '../../contracts/plan.js';
import { revisionAssignments } from '../../contracts/plan.js';
import { PLATFORM_DUTIES } from '../../contracts/platform-duty.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { PromptTextsV1 } from '../../contracts/prompts/prompt-set.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { QueryPreparationFacts } from '../work-graph/queries/contracts.js';
import type { TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import type { GraphContextFactsV1 } from '../work-graph/model/graph-context-contracts.js';
import { platformRoleProfile } from './role-profiles.js';
import { canonical, emptyNotes, indexRowText } from './context-support.js';
import type { OptionalRow } from './context-types.js';
import type { ResolvedRuntimeConfiguration } from './execution-contracts.js';

/** A direct call keeps the generated platform pack (ruling 14). */
const DEFAULT_TEXTS: PromptTextsV1 = PLATFORM_PROMPT_PACK_V1;

/** §2.4 item 3 / §2.5: the duty a versioned legacy template Session role ref fixes, or none. */
function templateDutyOf(sessionRole: RoleConfigurationRef | undefined, texts: PromptTextsV1): PlatformDutyV1 | undefined {
  if (sessionRole === undefined || sessionRole.kind !== 'legacy_template') return undefined;
  return PLATFORM_DUTIES.find((duty) => {
    const template = platformRoleProfile(duty, texts).template;
    return template.templateId === sessionRole.templateId && template.templateRevision === sessionRole.templateRevision;
  });
}

/** The Role's explicit duty, else the Host's, else the duty the Session's versioned legacy template fixes, else executor. */
export function effectiveDuty(
  role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>, configuration: ResolvedRuntimeConfiguration, sessionRole: RoleConfigurationRef | undefined,
  texts: PromptTextsV1 = DEFAULT_TEXTS,
): { duty: PlatformDutyV1 } | { rejection: CoreRejection } {
  const roleDuty = role.status === 'resolved' ? role.spec.platformDuty : undefined;
  const hostDuty = configuration?.platformDuty;
  const templateDuty = templateDutyOf(sessionRole, texts);
  if (roleDuty !== undefined && hostDuty !== undefined && roleDuty !== hostDuty) {
    return { rejection: rejected('forbidden', 'the explicit Host duty disagrees with the resolved Role duty') };
  }
  if (templateDuty !== undefined && hostDuty !== undefined && templateDuty !== hostDuty) {
    return { rejection: rejected('forbidden', 'the explicit Host duty disagrees with the Session legacy template') };
  }
  return { duty: roleDuty ?? hostDuty ?? templateDuty ?? 'executor' };
}

export function rolePayload(
  role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>,
  permissions: TaskEnvelopeV1['permissions'],
  duty: PlatformDutyV1,
  residentBudgetBytes: number,
  texts: PromptTextsV1 = DEFAULT_TEXTS,
): string {
  const S = (key: string): string => packString(texts, key);
  const binding = [
    S('context.role.bindingHeading'),
    `${S('context.role.binding')}${JSON.stringify(permissions)}`,
    `${S('context.role.tools')}${permissions.tools.join(', ') || S('context.none')}`,
    `${S('context.role.writeScope')}${permissions.writeScope.join(', ') || S('context.none')}`,
  ].join('\n');
  let specification: string;
  if (role.status === 'resolved') {
    specification = [
      S('context.role.specificationHeading'),
      `${S('context.role.role')}${role.roleId}@${String(role.revision.revision)}`,
      `${S('context.role.label')}${role.spec.label}`,
      `${S('context.role.purpose')}${role.spec.purpose}`,
      `${S('context.role.responsibility')}${role.spec.responsibility.join(', ')}`,
      `${S('context.role.materials')}${role.spec.requiredMaterials.map((material) => `${material.kind} (${material.reason})`).join('; ')}`,
      `${S('context.role.outputs')}${role.spec.requiredOutputs.map((output) => `${output.kind} (${output.reason})`).join('; ')}`,
      `${S('context.role.exitSuccess')}${role.spec.exit.success}`,
      `${S('context.role.exitStop')}${role.spec.exit.stop}`,
      `${S('context.role.exitHandoff')}${role.spec.exit.handoff}`,
    ].join('\n');
  } else {
    // §2.5: the configuration table supplies the label/purpose/responsibility of
    // a legacy explicit-duty Role; it never overrides an installed RoleSpec body.
    const profile = platformRoleProfile(duty, texts);
    const detail = [
      `${S('context.role.label')}${profile.label}`,
      `${S('context.role.purpose')}${profile.purpose}`,
      `${S('context.role.responsibility')}${profile.responsibility.join(', ')}`,
    ];
    specification = [S('context.role.specificationHeading'), `${S('context.role.role')}${role.roleId} (${role.status})`, role.reason, ...detail].join('\n');
  }
  return [binding, specification, `${S('context.role.duty')}${duty}`, `${S('context.role.residentBytes')}${String(residentBudgetBytes)}`].join('\n\n');
}

/** The bare goal id of a `goal:<goalId>` anchor key (never the pointer revision). */
function goalIdOfAnchor(anchorKey: string): string {
  return anchorKey.startsWith('goal:') ? anchorKey.slice('goal:'.length) : anchorKey;
}

/** The bare stage id of a `stage:<goalId>/<planRevision>/<stageId>` anchor key. */
function stageIdOfAnchor(anchorKey: string): string {
  const rest = anchorKey.startsWith('stage:') ? anchorKey.slice('stage:'.length) : anchorKey;
  const parts = rest.split('/');
  return parts.length === 0 ? anchorKey : (parts[parts.length - 1] ?? anchorKey);
}

/** Ruling 3: every rendered note line carries `（<noteId> v<version>）`. */
export function withNoteVersion(label: string, noteId: string, version: number, texts: PromptTextsV1): string {
  const S = (key: string): string => packString(texts, key);
  return label + S('context.understanding.versionOpen') + noteId + S('context.understanding.versionSeparator') + String(version) + S('context.understanding.versionClose');
}

/**
 * Ruling 3: the base label of one understanding row, used both for the rendered
 * line and (unchanged) as the digest label of its note source. A row that
 * cannot be the current conclusion is one warning line.
 */
function understandingSourceLabel(row: NotesUnderstandingRowV1, texts: PromptTextsV1): string {
  const S = (key: string): string => packString(texts, key);
  if (!row.currentEligible) return S('context.understanding.reread');
  if (row.scope === 'project') return S('context.understanding.projectLabel');
  if (row.scope === 'goal') return `${S('context.understanding.goalLabelPrefix')}${goalIdOfAnchor(row.status.anchorKey)}${S('context.understanding.labelSuffix')}`;
  return `${S('context.understanding.stageLabelPrefix')}${stageIdOfAnchor(row.status.anchorKey)}${S('context.understanding.labelSuffix')}`;
}

/**
 * §11.4/L20 (rulings 2 and 3): one Goal-card understanding line. The project row
 * carries its whole body; a goal/stage row carries its conclusion. A row with no
 * current understanding names only its anchor; an ineligible understanding is
 * exactly ONE warning line with the existing general warning wording and no
 * body. Every rendered note line carries the note id and version.
 */
export function understandingLine(row: NotesUnderstandingRowV1, texts: PromptTextsV1): string {
  const S = (key: string): string => packString(texts, key);
  const noteId = row.status.pointer.noteId;
  const version = row.version;
  if (!row.currentEligible) {
    if (noteId !== null && version !== null) {
      return withNoteVersion(S('context.understanding.warningPrefix') + noteId + ' ' + (row.conclusion ?? '') + S('context.understanding.notCurrent'), noteId, version, texts);
    }
    if (row.scope === 'goal') return S('context.understanding.noCurrentGoalPrefix') + goalIdOfAnchor(row.status.anchorKey) + S('context.understanding.noCurrentSuffix');
    if (row.scope === 'stage') return S('context.understanding.noCurrentStagePrefix') + stageIdOfAnchor(row.status.anchorKey) + S('context.understanding.noCurrentSuffix');
    return S('context.understanding.noCurrentProject');
  }
  if (noteId === null || version === null) {
    if (row.scope === 'goal') return S('context.understanding.noCurrentGoalPrefix') + goalIdOfAnchor(row.status.anchorKey) + S('context.understanding.noCurrentSuffix');
    if (row.scope === 'stage') return S('context.understanding.noCurrentStagePrefix') + stageIdOfAnchor(row.status.anchorKey) + S('context.understanding.noCurrentSuffix');
    return S('context.understanding.noCurrentProject');
  }
  const label = understandingSourceLabel(row, texts);
  const content = row.scope === 'project' ? (row.body ?? row.conclusion ?? '') : (row.conclusion ?? '');
  return `${withNoteVersion(label, noteId, version, texts)}${S('context.understanding.labelSeparator')}${content}`;
}

/** §11.4: the Goal card's `current understanding` block (rows then project norms). */
function notesGoalText(notes: ContextExtensionsV1['notes'], texts: PromptTextsV1): string {
  const S = (key: string): string => packString(texts, key);
  if (notes.availability === 'not_implemented') return S('context.notImplemented');
  const lines: string[] = [];
  for (const row of notes.understanding.rows.slice(0, 3)) lines.push(understandingLine(row, texts));
  for (const norm of notes.understanding.norms) {
    lines.push(withNoteVersion(norm.label, norm.noteId, norm.version, texts));
  }
  if (notes.understanding.normsOmitted > 0) {
    lines.push(S('context.understanding.normsOmittedPrefix') + String(notes.understanding.normsOmitted) + S('context.understanding.normsOmittedSuffix'));
  }
  return lines.length === 0 ? S('context.none') : lines.join('\n');
}

export function goalPayload(goal: GoalSnapshot, workspaceRevision: number, extensions: ContextExtensionsV1, texts: PromptTextsV1 = DEFAULT_TEXTS): string {
  const S = (key: string): string => packString(texts, key);
  const autonomy = extensions.goalSettings.availability === 'available' && extensions.goalSettings.autonomy !== null
    ? extensions.goalSettings.autonomy : S('context.notImplemented');
  return [
    `${S('context.goal.goal')}${goal.ref.goalId}`,
    `${S('context.goal.objective')}${goal.objective}`,
    `${S('context.goal.workspace')}${goal.workspaceRef.workspaceId}@${String(workspaceRevision)}`,
    `${S('context.goal.autonomy')}${autonomy}`,
    `${S('context.goal.understanding')}${notesGoalText(extensions.notes, texts)}`,
  ].join('\n');
}

function obligationsForTask(plan: PlanRevisionSnapshot, taskId: string) {
  return plan.obligations
    .filter((obligation) => obligation.taskIds.includes(taskId))
    .sort((left, right) => (left.obligationId < right.obligationId ? -1 : left.obligationId > right.obligationId ? 1 : 0));
}

/**
 * §4.3/G5.4: all declarations of the claim Plan for the consumer, legacy and
 * edge alike, sorted by declarationId. The same identity rule the graph reader
 * uses (`views/graph-context-reader.ts:declarationsForTask`).
 */
export function declarationsForTask(plan: PlanRevisionSnapshot, taskId: string): InputDeclarationV1[] {
  const tripleOf = (id: string): TaskTriple => ({ projectId: plan.ref.projectId, goalId: plan.goalRef.goalId, taskId: id });
  const out: InputDeclarationV1[] = [];
  for (const edge of plan.executionDag.dependsOn) {
    if (edge.taskId !== taskId) continue;
    out.push({
      declarationId: edgeDeclarationId(plan.ref, edge),
      consumer: tripleOf(edge.taskId),
      planRef: plan.ref,
      upstream: tripleOf(edge.dependsOnId),
      requires: edge.requires,
      legacyArtifactRef: null,
    });
  }
  if (plan.inputRequirements !== undefined) {
    for (const requirement of plan.inputRequirements) {
      if (requirement.consumerTaskId !== taskId) continue;
      out.push({
        declarationId: legacyDeclarationId(requirement.requirementId),
        consumer: tripleOf(requirement.consumerTaskId),
        planRef: plan.ref,
        upstream: null,
        requires: { kind: 'artifact', label: requirement.requirementId },
        legacyArtifactRef: requirement.artifactRef,
      });
    }
  }
  return out;
}

export function taskPayload(plan: PlanRevisionSnapshot, record: TaskExecutionRecord, graph: GraphContextFactsV1['graph'], texts: PromptTextsV1 = DEFAULT_TEXTS): string | null {
  const S = (key: string): string => packString(texts, key);
  const claim = record?.outbox?.claim;
  if (claim === undefined) return null;
  const taskId = claim.task.taskId;
  const task: RuntimeTask | undefined = plan.tasks.find((candidate) => candidate.taskId === taskId);
  const assignment = revisionAssignments(plan).find((candidate) => candidate.taskId === taskId);
  const stage = task?.stageId === undefined ? undefined : plan.stages.find((candidate) => candidate.stageId === task.stageId);
  const run = record?.run;
  const session = record?.session;
  const workspaceId = session?.workspaceId ?? run?.workspaceSnapshot?.workspaceId ?? plan.goalRef.projectId;
  const workspaceRevision = run?.workspaceSnapshot?.revision ?? 0;
  const obligations = obligationsForTask(plan, taskId);
  const requirements = obligations
    .flatMap((obligation) => obligation.verificationRequirements)
    .sort((left, right) => (left.requirementId < right.requirementId ? -1 : left.requirementId > right.requirementId ? 1 : 0));
  const upstream = declarationsForTask(plan, taskId)
    .sort((left, right) => (left.declarationId < right.declarationId ? -1 : left.declarationId > right.declarationId ? 1 : 0));
  const downstream = plan.executionDag.dependsOn
    .filter((edge) => edge.dependsOnId === taskId)
    .sort((left, right) => (left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0));
  // §4.1/§4.3: the phase is the CURRENT graph state; the frozen definition
  // fields stay from the claim Plan.
  const currentTask = graph?.tasks.find((row) => row.ref.taskId === taskId && row.ref.goalId === plan.goalRef.goalId);
  const phase = currentTask?.effectivePhase ?? task?.phase ?? 'pending';
  const lines = [
    `${S('context.task.task')}${task?.title ?? taskId} (${taskId})`,
    `${S('context.task.instruction')}${assignment?.instruction ?? ''}`,
    `${S('context.task.plan')}${plan.ref.planId}`,
    `${S('context.task.workspace')}${workspaceId}@${String(workspaceRevision)}`,
    `${S('context.task.definitionPlan')}${plan.ref.planId}@${String(plan.planRevision)}`,
    `${S('context.task.stage')}${stage === undefined ? S('context.task.undeclared') : `${stage.title} (${stage.stageId})`}`,
    `${S('context.task.module')}${task?.scope.kind === 'module' ? task.scope.moduleRef : S('context.task.undeclared')}`,
    `${S('context.task.requirementLevel')}${task?.requirementLevel ?? 'required'}`,
    `${S('context.task.disposition')}${task?.disposition ?? 'active'}`,
    `${S('context.task.phase')}${phase}`,
    `${S('context.task.obligations')}${obligations.length === 0 ? S('context.task.undefined') : canonical(obligations, S('context.task.undefined'))}`,
    `${S('context.task.acceptance')}${requirements.length === 0 ? S('context.task.undefined') : canonical(requirements, S('context.task.undefined'))}`,
    `${S('context.task.upstream')}${upstream.length === 0 ? S('context.task.null') : canonical(upstream, S('context.task.null'))}`,
    `${S('context.task.downstream')}${downstream.length === 0 ? S('context.task.null') : canonical(downstream, S('context.task.null'))}`,
    S('context.task.failure'),
  ];
  return lines.join('\n');
}

export function missingInputReminder(selection: InputSelectionV1, executions: readonly TaskExecutionRecord[], texts: PromptTextsV1 = DEFAULT_TEXTS): OptionalRow {
  const S = (key: string): string => packString(texts, key);
  const declaration = selection.declaration;
  const upstream = declaration.upstream;
  const execution = upstream === null ? undefined : executions.find((candidate) =>
    candidate.run?.task?.projectId === upstream.projectId
    && candidate.run?.task?.goalId === upstream.goalId
    && candidate.run?.task?.taskId === upstream.taskId);
  const facts = execution === undefined
    ? S('context.missingInput.noRecord')
    : S('context.missingInput.runPrefix') + execution.run.ref.runId + ' ' + execution.run.status
      + (execution.run.outcome === null ? '' : S('context.missingInput.outcomeOpen') + execution.run.outcome + S('context.missingInput.outcomeClose'));
  const reason = selection.reason === null ? selection.state : selection.reason;
  return {
    key: `input:${declaration.declarationId}`,
    text: S('context.missingInput.prefix') + declaration.declarationId + S('context.missingInput.reasonSeparator') + reason + S('context.missingInput.upstreamSeparator') + (upstream?.taskId ?? S('context.missingInput.noUpstream')) + S('context.missingInput.factsSeparator') + facts,
  };
}

function noteRowKey(row: NoteIndexRowV1): string {
  return `note:${row.anchorKey}\u0000${row.noteId}@${String(row.version)}`;
}

export function optionalRowsFromExtensions(extensions: ContextExtensionsV1, texts: PromptTextsV1 = DEFAULT_TEXTS): {
  footprint: OptionalRow[]; notes: OptionalRow[];
  reminders: OptionalRow[];
} {
  // Ruling 3: every rendered note line carries the note id and version. The
  // row key keeps its own identity so the budget dedup/sort is unchanged.
  const S = (key: string): string => packString(texts, key);
  const notes = extensions.notes.general.map((row) => ({
    key: noteRowKey(row),
    text: withNoteVersion(row.label, row.noteId, row.version, texts),
  }));
  return {
    // The footprint section is a declared future section; its producer only ever
    // writes not_implemented with no rows, so the projection stays empty.
    footprint: [],
    notes,
    reminders: [
      ...extensions.anomalies.rows.map((row) => ({
        key: row.key.startsWith('anomaly:') ? row.key : `anomaly:${row.key}`,
        text: indexRowText(row),
      })),
      // §4.3.6/L9: the decision index shares the reminders budget and keeps
      // exactly one `decision:` prefix; the renderer still orders and clips.
      ...extensions.decisions.rows.map((row) => ({
        key: row.key.startsWith('decision:') ? row.key : `decision:${row.key}`,
        text: indexRowText(row),
      })),
      // §11.5/L20: a goal/stage understanding whose `updateDue` is true. The
      // index prefix keeps the understanding rows' own order under the key sort.
      ...extensions.notes.understanding.rows
        .filter((row) => row.status.updateDue === true)
        .map((row, index) => ({
          key: `understanding:${String(index)}:${row.status.anchorKey}`,
          text: `${S('context.work.understandingUpdateDue')}${row.status.anchorKey}`,
        })),
    ],
  };
}

export function annotations(extensions: ContextExtensionsV1): ContextAssemblyBindingV1['extensions'] {
  return {
    notes: extensions.notes.availability,
    anomalies: extensions.anomalies.availability,
    footprint: extensions.footprint.availability,
    goalSettings: extensions.goalSettings.availability,
    decisions: extensions.decisions.availability,
  };
}

/**
 * §4.3/G5.1: the copy-mode Query task section is the focus line(s) named by the
 * QueryJob's `focusTaskRefs`; it is omitted when there is none.
 */
export function queryFocusLines(facts: QueryPreparationFacts, graph: GraphContextFactsV1['graph'], texts: PromptTextsV1 = DEFAULT_TEXTS): string | null {
  const S = (key: string): string => packString(texts, key);
  const focus = facts.record?.job?.job?.intent?.focusTaskRefs ?? [];
  const lines = focus.map((ref) => {
    const row = graph?.tasks.find((candidate) => candidate.ref.taskId === ref.taskId && candidate.ref.goalId === ref.goalId);
    return `${S('context.task.task')}${row?.definition.title ?? ref.taskId} (${ref.taskId})`;
  });
  return lines.length === 0 ? null : lines.join('\n');
}

/** §4.3/G5.1: the planning task section is the current Plan summary. */
export function queryPlanSummary(plan: PlanRevisionSnapshot, texts: PromptTextsV1 = DEFAULT_TEXTS): string {
  const S = (key: string): string => packString(texts, key);
  const stages = plan.stages.map((stage) => `${stage.title} (${stage.stageId})`).join(', ') || S('context.query.none');
  const tasks = plan.tasks.map((task) => `${task.title} (${task.taskId})`).join(', ') || S('context.query.none');
  return [`${S('context.query.plan')}${plan.ref.planId}@${String(plan.planRevision)}`, `${S('context.query.stages')}${stages}`, `${S('context.query.tasks')}${tasks}`].join('\n');
}

/** §4.3/G5.1: the planning footprint rows are the top-level module cards. */
export function topLevelModuleCards(architecture: GraphContextFactsV1['architecture']): OptionalRow[] {
  if (architecture === null) return [];
  const children = new Set((architecture.containment?.parentOf ?? []).map((entry) => entry.child.moduleId));
  return architecture.modules
    .filter((module) => !children.has(module.ref.moduleId))
    .map((module) => ({
      key: module.ref.moduleId,
      text: indexRowText({
        key: module.ref.moduleId, node: { kind: 'module', ref: module.ref },
        text: module.responsibility, sources: [],
      }),
    }));
}

export function notImplementedExtensions(): ContextExtensionsV1 {
  const empty = (): { availability: 'not_implemented'; rows: ContextIndexRowV1[] } => ({ availability: 'not_implemented', rows: [] });
  return {
    notes: emptyNotes(), anomalies: empty(), footprint: empty(),
    goalSettings: { availability: 'not_implemented', autonomy: null },
    decisions: empty(),
  };
}

/**
 * §11.4/L20 (ruling 3/item 4): binding note sources for Work and Query. It
 * records every rendered understanding row that carries a note (the real note
 * version, never the pointer revision), every rendered norm, and only the kept
 * general rows. Dedup identity is `anchorKey` + `noteId` + `version`; the
 * digest formula is unchanged (`{anchorKey,noteId,version,label}`).
 */
export function noteSourcesOf(
  notes: ContextExtensionsV1['notes'],
  keptGeneral: readonly NoteIndexRowV1[],
  texts: PromptTextsV1 = DEFAULT_TEXTS,
): ContextSourceV1[] {
  const sources: ContextSourceV1[] = [];
  const seen = new Set<string>();
  const add = (anchorKey: string, noteId: string, version: number, label: string): void => {
    const identity = `${anchorKey}\u0000${noteId}@${String(version)}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    sources.push({
      kind: 'note', anchorKey, noteId, version,
      digest: sha256Hex(canonicalJson({ anchorKey, noteId, version, label } as unknown as JsonValue)),
    });
  };
  for (const row of notes.understanding.rows.slice(0, 3)) {
    const noteId = row.status.pointer.noteId;
    if (noteId === null || row.version === null) continue;
    add(row.status.anchorKey, noteId, row.version, understandingSourceLabel(row, texts));
  }
  for (const norm of notes.understanding.norms) {
    add(norm.anchorKey, norm.noteId, norm.version, norm.label);
  }
  for (const row of keptGeneral) {
    add(row.anchorKey, row.noteId, row.version, row.label);
  }
  return sources;
}
