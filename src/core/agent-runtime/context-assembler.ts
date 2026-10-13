/**
 * Slice 3 context assembler (§4.2, §4.3, §4.5). It owns the eight-section
 * assembly, the graph-facts collection and the Host attention notification
 * renderer.
 *
 * The pure `renderContext` owns the frozen section headers, the byte budget of
 * the four optional sections and the exact `\n\n` separators (no trailing LF).
 * `createContextAssembler` consumes formal WorkGraph facts through the two
 * narrow ports (`graphContext`, `taskInputs`) and the per-Run execution record;
 * a failing `graphContext` read is propagated unchanged, never replaced by a
 * legacy fallback.
 */
import type { ArtifactRef } from '../../contracts/artifact.js';
import {
  CONTINUATION_BRIEF_LIMITS, ContinuationBriefCapacityError, continuationBriefDigest, continuationBriefShapeProblem,
  renderContinuationBriefZh, type ContinuationBriefV1, type ContinuationSourceCheckpointV1,
} from '../../contracts/continuation-brief.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { RoleConfigurationRef } from '../../contracts/core/identity.js';
import type { PreparedQueryManifestV1, PreparedTaskManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { TaskTriple } from '../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import type {
  AttentionChangesV1, AttentionGraphReadRequestV1, ContextAssemblyBindingV1,
  ContextExtensionsV1, ContextIndexRowV1, ContextSectionNameV1, ContextSourceV1, GraphAttentionFactsV1,
  InputDeclarationV1, InputSelectionV1, PlatformDutyV1, TaskInputPageV1,
} from '../../contracts/graph-context.js';
import { goalContextDigestV1 } from '../../contracts/graph-context.js';
import type { GoalSnapshot } from '../../contracts/ledger.js';
import type { PlanRevisionSnapshot, RuntimeTask } from '../../contracts/plan.js';
import { revisionAssignments } from '../../contracts/plan.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { TaskRequeueSnapshotV1 } from '../../contracts/task-requeue.js';
import type { SessionAnomalyAnchorRef } from '../../contracts/session-anomaly.js';
import type { QueryPreparationFacts } from '../work-graph/queries/contracts.js';
import type { TaskContextInputPort } from '../work-graph/model/context-input-contracts.js';
import type { ContinuationBasis, TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import type { GraphContextFactsV1, GraphContextReadPort } from '../work-graph/model/graph-context-contracts.js';
import { assembleAnomalySection, assembleContinuationBrief, readPreviousTurn, type BriefWorkspaceFacts } from './continuation-brief-assembly.js';
import { platformRoleProfile } from './role-profiles.js';
import { decodeKernelEntry } from './kernel-turn-facts.js';
import { createSessionHistoryCursorOwner } from './session-operations.js';
import type { ResolvedRuntimeConfiguration, RuntimeExecutionDependencies } from './execution-contracts.js';

export type { AttentionGraphReadRequestV1 } from '../../contracts/graph-context.js';

/** The frozen format version of an assembled context binding (§4.3). */
export const CONTEXT_FORMAT_VERSION = 's3-context-v1' as const;

/** The frozen section headers, in render order (§4.3). */
export const CONTEXT_SECTION_HEADERS: Readonly<Record<ContextSectionNameV1, string>> = {
  role: '## Runtime context',
  goal: '## Goal',
  task: '## Accepted task',
  footprint: '## Footprint',
  notes: '## Note index',
  reminders: '## Reminders',
  inputs: '## Selected inputs',
  continuation: '',
};

export const CONTEXT_SECTION_ORDER: readonly ContextSectionNameV1[] = [
  'role', 'goal', 'task', 'footprint', 'notes', 'reminders', 'inputs', 'continuation',
];

export const WORK_CONTEXT_PRELUDE = '# Verified runtime task input\n\nThis is the current task context assembled from formal platform facts; it is not a transcript.';
/** §4.3: the Query prelude keeps the original header AND its bounded-Query line. */
export const QUERY_CONTEXT_PRELUDE = '# Verified read-only Query input\n\nThis is the current bounded Query context assembled from formal platform facts; it is not a transcript.';

export type ContextAssemblerDependencies = Pick<RuntimeExecutionDependencies,
  'executions' | 'roles' | 'materials' | 'bodies'>
  & Partial<Pick<RuntimeExecutionDependencies, 'plans' | 'sessions' | 'kernelStores' | 'workspaceHost' | 'workspaceSource'>>
  & { graphContext?: GraphContextReadPort; taskInputs?: TaskContextInputPort };

export type AssembledContextV1 = {
  input: string; binding: ContextAssemblyBindingV1;
  continuationBrief: ContinuationBriefV1 | null;
  sessionBasis: PreparedTaskManifestV1['sessionBasis'] | undefined;
  selectedTaskInputs: PreparedTaskManifestV1['selectedTaskInputs'];
  /** Slice 1 §2.7: the anchors named by the brief's anomaly section (absent/null when it has none). */
  anomalyAnchorRefs?: SessionAnomalyAnchorRef[] | null;
};

export interface ContextAssembler {
  assembleTask(ctx: CoreCallContext, input: {
    execution: TaskExecutionRecord; role: RoleSpecResolutionV1;
    configuration: ResolvedRuntimeConfiguration;
    permissions: TaskEnvelopeV1['permissions'];
  }): Promise<ReadResult<AssembledContextV1>>;
  assembleQuery(ctx: CoreCallContext, input: {
    facts: QueryPreparationFacts;
    role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
    configuration: ResolvedRuntimeConfiguration;
    permissions: PreparedQueryManifestV1['permissions'];
    question: string;
  }): Promise<ReadResult<AssembledContextV1>>;
  readAttentionGraph(ctx: CoreCallContext, request: AttentionGraphReadRequestV1): Promise<ReadResult<GraphAttentionFactsV1>>;
}

// ------------------------------------------------------------------------ //
// Shared small helpers                                                      //
// ------------------------------------------------------------------------ //

type OptionalSectionName = 'footprint' | 'notes' | 'reminders' | 'inputs';
const OPTIONAL_SECTIONS: readonly OptionalSectionName[] = CONTEXT_SECTION_ORDER.filter(
  (name): name is OptionalSectionName =>
    name === 'footprint' || name === 'notes' || name === 'reminders' || name === 'inputs',
);
type OptionalRow = { key: string; text: string };

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}
function byKey(left: { key: string }, right: { key: string }): number {
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function rejected(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
/** Propagate a must-fail read with its own code; never turn it into a ready default. */
function mapRead(result: ReadResult<unknown>): CoreRejection {
  if (result.status === 'ready') return rejected('unavailable', 'a must-fail read unexpectedly returned a value');
  if (result.status === 'not_found') return rejected('not_found', 'the required fact was not found');
  if (result.status === 'not_ready') return rejected('incomplete', 'the required fact is not readable at the required watermark');
  return { status: 'rejected', code: result.code, reason: result.reason, ...(result.current === undefined ? {} : { current: result.current }) };
}
function requirementIdOf(declarationId: string): string {
  return declarationId.startsWith('legacy:') ? declarationId.slice('legacy:'.length) : declarationId;
}
function notImplementedExtensions(): ContextExtensionsV1 {
  const empty = (): { availability: 'not_implemented'; rows: ContextIndexRowV1[] } => ({ availability: 'not_implemented', rows: [] });
  return {
    notes: empty(), anomalies: empty(), footprint: empty(),
    goalSettings: { availability: 'not_implemented', autonomy: null },
    decisions: empty(),
  };
}
function indexRowText(row: ContextIndexRowV1): string {
  return canonicalJson({ key: row.key, node: row.node, text: row.text, sources: row.sources } as unknown as JsonValue);
}
function canonical(value: unknown, fallback: string): string {
  try { return canonicalJson(value as JsonValue); } catch { return fallback; }
}
function sortedSources(sources: readonly ContextSourceV1[]): ContextSourceV1[] {
  const byCanonical = new Map<string, ContextSourceV1>();
  for (const source of sources) {
    const key = canonical(source, '');
    if (key !== '') byCanonical.set(key, source);
  }
  return [...byCanonical.entries()]
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map((entry) => entry[1]);
}

// ------------------------------------------------------------------------ //
// renderContext (§4.3)                                                      //
// ------------------------------------------------------------------------ //

export function renderContext(input: {
  prelude: string;
  required: { role: string; goal: string | null; task: string | null };
  optional: Partial<Record<'footprint' | 'notes' | 'reminders' | 'inputs', { key: string; text: string }[]>>;
  continuationSuffix: string | null;
  residentBudgetBytes: number;
}): { input: string; sections: ContextAssemblyBindingV1['sections']; residentBytes: number; totalBytes: number } {
  const present = OPTIONAL_SECTIONS
    .map((name) => ({ name, rows: [...(input.optional[name] ?? [])].sort(byKey) }))
    .filter((section) => section.rows.length > 0);
  const totalRows = present.reduce((sum, section) => sum + section.rows.length, 0);

  const renderPrefix = (k: number): { text: string; omitted: Map<OptionalSectionName, number> } => {
    let remaining = k;
    const omitted = new Map<OptionalSectionName, number>();
    const parts: string[] = [];
    for (const section of present) {
      const kept = Math.min(remaining, section.rows.length);
      remaining -= kept;
      const missing = section.rows.length - kept;
      omitted.set(section.name, missing);
      let text = CONTEXT_SECTION_HEADERS[section.name];
      if (kept > 0) text += '\n' + section.rows.slice(0, kept).map((row) => row.text).join('\n');
      if (missing > 0) text += `\n另有 ${String(missing)} 条，用‘看’读`;
      parts.push(text);
    }
    return { text: parts.length === 0 ? '' : '\n\n' + parts.join('\n\n'), omitted };
  };

  // The longest global prefix whose FULL billed string fits. Scanning every k
  // (not stopping at the first failure) keeps the omission counts exact.
  let chosen = -1;
  let chosenRender: { text: string; omitted: Map<OptionalSectionName, number> } | null = null;
  for (let k = 0; k <= totalRows; k += 1) {
    const rendered = renderPrefix(k);
    if (utf8Bytes(rendered.text) <= input.residentBudgetBytes) { chosen = k; chosenRender = rendered; }
  }

  const pieces: string[] = [];
  let byteLength = 0;
  const sections: ContextAssemblyBindingV1['sections'] = [];
  let lastRequiredIndex = -1;
  const append = (text: string): void => { pieces.push(text); byteLength += utf8Bytes(text); };
  const appendSection = (name: ContextSectionNameV1, header: string, payload: string): void => {
    const start = byteLength;
    append(`${header}\n${payload}`);
    sections.push({ name, startByte: start, endByte: byteLength, omitted: 0 });
    lastRequiredIndex = sections.length - 1;
  };

  append(input.prelude);
  append('\n\n');
  appendSection('role', CONTEXT_SECTION_HEADERS.role, input.required.role);
  if (input.required.goal !== null) {
    append('\n\n');
    appendSection('goal', CONTEXT_SECTION_HEADERS.goal, input.required.goal);
  }
  if (input.required.task !== null) {
    append('\n\n');
    appendSection('task', CONTEXT_SECTION_HEADERS.task, input.required.task);
  }

  let residentBytes = 0;
  if (chosen < 0 || chosenRender === null) {
    // Even the k=0 marker structure is too large: render no optional section
    // body and list the omitted counts on the required card instead.
    const lines: string[] = [];
    for (const name of OPTIONAL_SECTIONS) {
      const count = (input.optional[name] ?? []).length;
      if (count === 0) continue;
      lines.push(`${name}: 另有 ${String(count)} 条，用‘看’读`);
      sections.push({ name, startByte: null, endByte: null, omitted: count });
    }
    if (lines.length > 0) {
      append(`\n\n## Context omissions\n${lines.join('\n')}`);
      // §4.3/G5.5: the mandatory omission metadata is appended at the end of the
      // required task section (or the goal section when no task exists); extend
      // that section's interval so those lines are not outside every interval.
      if (lastRequiredIndex >= 0) {
        const section = sections[lastRequiredIndex];
        if (section !== undefined) section.endByte = byteLength;
      }
    }
    residentBytes = 0;
  } else if (present.length > 0) {
    const optionalStart = byteLength;
    let remaining = chosen;
    for (const section of present) {
      const kept = Math.min(remaining, section.rows.length);
      remaining -= kept;
      const missing = section.rows.length - kept;
      append('\n\n');
      const start = byteLength;
      let text = CONTEXT_SECTION_HEADERS[section.name];
      if (kept > 0) text += '\n' + section.rows.slice(0, kept).map((row) => row.text).join('\n');
      if (missing > 0) text += `\n另有 ${String(missing)} 条，用‘看’读`;
      append(text);
      sections.push({ name: section.name, startByte: start, endByte: byteLength, omitted: missing });
    }
    residentBytes = byteLength - optionalStart;
  }

  if (input.continuationSuffix !== null) {
    append('\n\n');
    const start = byteLength;
    append(input.continuationSuffix);
    sections.push({ name: 'continuation', startByte: start, endByte: byteLength, omitted: 0 });
  }

  const text = pieces.join('');
  return { input: text, sections, residentBytes, totalBytes: byteLength };
}

// ------------------------------------------------------------------------ //
// renderAttentionChanges (§4.5)                                             //
// ------------------------------------------------------------------------ //

export const ATTENTION_HEADER = '[attention s3-v1]';
export const ATTENTION_MAX_BYTES = 16_384;

export function renderAttentionChanges(input: AttentionChangesV1): string {
  const scopeLine = JSON.stringify({
    kind: 'scope', projectId: input.scope.projectId, workspaceId: input.scope.workspaceId,
    goalId: input.goalRef === null ? null : input.goalRef.goalId,
  });
  const rows: string[] = [];
  if (input.revision !== null) {
    rows.push(JSON.stringify({
      kind: 'revision', key: 'graph', change: 'revision_change',
      beforeVersion: input.revision.before, afterVersion: input.revision.after,
    }));
  }
  for (const change of [...input.nodes].sort(byKey)) {
    rows.push(JSON.stringify({
      kind: 'node', key: change.key, change: change.change,
      beforeVersion: change.beforeVersion, afterVersion: change.afterVersion,
      node: change.detail.node, name: change.detail.name, summary: change.detail.summary, state: change.detail.state,
    }));
  }
  for (const edge of [...input.edges].sort(byKey)) {
    rows.push(JSON.stringify({ kind: 'edge', key: edge.key, change: edge.change }));
  }
  for (const file of [...input.files].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))) {
    rows.push(JSON.stringify({ kind: 'file', key: file.path, version: file.version }));
  }
  for (const id of [...input.feedbackIds].sort()) {
    rows.push(JSON.stringify({ kind: 'feedback', key: id }));
  }
  if (input.heartbeat !== null) {
    rows.push(JSON.stringify({
      kind: 'heartbeat', key: 'heartbeat',
      pendingInputs: input.heartbeat.pendingInputs, messageCursor: input.heartbeat.messageCursor,
    }));
  }

  const omittedLine = (count: number): string => JSON.stringify({
    kind: 'omitted', count, hint: `另有 ${String(count)} 条，用‘看’读`,
  });
  // §4.5/G5.6: keep the longest prefix whose ACTUAL final text fits. The last
  // kept row needs no omission line (count 0), so reserving one always would
  // wrongly drop a row that fits.
  const baseBytes = utf8Bytes(ATTENTION_HEADER) + 1 + utf8Bytes(scopeLine);
  let running = baseBytes;
  let kept = 0;
  for (let k = 1; k <= rows.length; k += 1) {
    running += 1 + utf8Bytes(rows[k - 1] ?? '');
    const omittedBytes = k < rows.length ? 1 + utf8Bytes(omittedLine(rows.length - k)) : 0;
    if (running + omittedBytes <= ATTENTION_MAX_BYTES) kept = k;
  }
  const omittedCount = rows.length - kept;
  const lines = [ATTENTION_HEADER, scopeLine, ...rows.slice(0, kept)];
  if (omittedCount > 0) lines.push(omittedLine(omittedCount));
  return lines.join('\n');
}

// ------------------------------------------------------------------------ //
// Assembler                                                                 //
// ------------------------------------------------------------------------ //

type ContextClock = { now?: () => string };

const PLATFORM_DUTIES: readonly PlatformDutyV1[] = ['executor', 'secretary', 'adviser', 'scribe', 'reviewer'];

/** §2.4 item 3 / §2.5: the duty a versioned legacy template Session role ref fixes, or none. */
function templateDutyOf(sessionRole: RoleConfigurationRef | undefined): PlatformDutyV1 | undefined {
  if (sessionRole === undefined || sessionRole.kind !== 'legacy_template') return undefined;
  return PLATFORM_DUTIES.find((duty) => {
    const template = platformRoleProfile(duty).template;
    return template.templateId === sessionRole.templateId && template.templateRevision === sessionRole.templateRevision;
  });
}

/** The Role's explicit duty, else the Host's, else the duty the Session's versioned legacy template fixes, else executor. */
function effectiveDuty(
  role: RoleSpecResolutionV1, configuration: ResolvedRuntimeConfiguration, sessionRole: RoleConfigurationRef | undefined,
): { duty: PlatformDutyV1 } | { rejection: CoreRejection } {
  const roleDuty = role.status === 'resolved' ? role.spec.platformDuty : undefined;
  const hostDuty = configuration?.platformDuty;
  const templateDuty = templateDutyOf(sessionRole);
  if (roleDuty !== undefined && hostDuty !== undefined && roleDuty !== hostDuty) {
    return { rejection: rejected('forbidden', 'the explicit Host duty disagrees with the resolved Role duty') };
  }
  if (templateDuty !== undefined && hostDuty !== undefined && templateDuty !== hostDuty) {
    return { rejection: rejected('forbidden', 'the explicit Host duty disagrees with the Session legacy template') };
  }
  return { duty: roleDuty ?? hostDuty ?? templateDuty ?? 'executor' };
}

function rolePayload(
  role: RoleSpecResolutionV1,
  permissions: TaskEnvelopeV1['permissions'],
  duty: PlatformDutyV1,
  residentBudgetBytes: number,
): string {
  const binding = [
    '## Runtime binding',
    `roleBinding: ${JSON.stringify(permissions)}`,
    `tools: ${permissions.tools.join(', ') || '(none)'}`,
    `writeScope: ${permissions.writeScope.join(', ') || '(none)'}`,
  ].join('\n');
  let specification: string;
  if (role.status === 'resolved') {
    specification = [
      '## Role specification',
      `role: ${role.roleId}@${String(role.revision.revision)}`,
      `label: ${role.spec.label}`,
      `purpose: ${role.spec.purpose}`,
      `responsibility: ${role.spec.responsibility.join(', ')}`,
      `required materials: ${role.spec.requiredMaterials.map((material) => `${material.kind} (${material.reason})`).join('; ')}`,
      `required outputs: ${role.spec.requiredOutputs.map((output) => `${output.kind} (${output.reason})`).join('; ')}`,
      `exit success: ${role.spec.exit.success}`,
      `exit stop: ${role.spec.exit.stop}`,
      `exit handoff: ${role.spec.exit.handoff}`,
    ].join('\n');
  } else {
    // §2.5: the configuration table supplies the label/purpose/responsibility of
    // a legacy explicit-duty Role; it never overrides an installed RoleSpec body.
    const profile = platformRoleProfile(duty);
    const detail = [
      `label: ${profile.label}`,
      `purpose: ${profile.purpose}`,
      `responsibility: ${profile.responsibility.join(', ')}`,
    ];
    if (role.status === 'absent') {
      specification = ['## Role specification', `role: ${role.roleId} (${role.status})`, role.reason, ...detail].join('\n');
    } else {
      specification = ['## Role specification', `role: ${role.roleId} (${role.status})`, role.reasons.map((reason) => JSON.stringify(reason)).join('; '), ...detail].join('\n');
    }
  }
  return [binding, specification, `duty: ${duty}`, `contextResidentBytes: ${String(residentBudgetBytes)}`].join('\n\n');
}

function goalPayload(goal: GoalSnapshot, workspaceRevision: number, extensions: ContextExtensionsV1): string {
  const autonomy = extensions.goalSettings.availability === 'available' && extensions.goalSettings.autonomy !== null
    ? extensions.goalSettings.autonomy : '(not_implemented)';
  const understanding = extensions.notes.availability === 'not_implemented' ? '(not_implemented)'
    : extensions.notes.rows.length === 0 ? '(none)' : extensions.notes.rows.map(indexRowText).join('\n');
  return [
    `goal: ${goal.ref.goalId}`,
    `objective: ${goal.objective}`,
    `workspace: ${goal.workspaceRef.workspaceId}@${String(workspaceRevision)}`,
    `autonomy: ${autonomy}`,
    `current understanding: ${understanding}`,
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
function declarationsForTask(plan: PlanRevisionSnapshot, taskId: string): InputDeclarationV1[] {
  const tripleOf = (id: string): TaskTriple => ({ projectId: plan.ref.projectId, goalId: plan.goalRef.goalId, taskId: id });
  const out: InputDeclarationV1[] = [];
  for (const edge of plan.executionDag.dependsOn) {
    if (edge.taskId !== taskId) continue;
    out.push({
      declarationId: 'edge:' + sha256Hex(canonicalJson({
        planRef: plan.ref, consumerTaskId: edge.taskId, dependsOnId: edge.dependsOnId, requires: edge.requires,
      } as unknown as JsonValue)),
      consumer: tripleOf(edge.taskId),
      planRef: plan.ref,
      upstream: tripleOf(edge.dependsOnId),
      requires: edge.requires,
      legacyArtifactRef: null,
    });
  }
  if (plan.schemaVersion === 2 && plan.inputRequirements !== undefined) {
    for (const requirement of plan.inputRequirements) {
      if (requirement.consumerTaskId !== taskId) continue;
      out.push({
        declarationId: 'legacy:' + requirement.requirementId,
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

function taskPayload(plan: PlanRevisionSnapshot, record: TaskExecutionRecord, graph: GraphContextFactsV1['graph']): string | null {
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
    `task: ${task?.title ?? taskId} (${taskId})`,
    `instruction: ${assignment?.instruction ?? ''}`,
    `plan: ${plan.ref.planId}`,
    `workspace: ${workspaceId}@${String(workspaceRevision)}`,
    `definitionPlan: ${plan.ref.planId}@${String(plan.planRevision)}`,
    `stage: ${stage === undefined ? '(未声明)' : `${stage.title} (${stage.stageId})`}`,
    `module: ${task?.scope.kind === 'module' ? task.scope.moduleRef : '(未声明)'}`,
    `requirementLevel: ${task?.requirementLevel ?? 'required'}`,
    `disposition: ${task?.disposition ?? 'active'}`,
    `phase: ${phase}`,
    `obligations: ${obligations.length === 0 ? '未定义' : canonical(obligations, '未定义')}`,
    `acceptance: ${requirements.length === 0 ? '未定义' : canonical(requirements, '未定义')}`,
    `upstream: ${upstream.length === 0 ? 'null' : canonical(upstream, 'null')}`,
    `downstream: ${downstream.length === 0 ? 'null' : canonical(downstream, 'null')}`,
    `failure: null`,
  ];
  return lines.join('\n');
}

function missingInputReminder(selection: InputSelectionV1, executions: readonly TaskExecutionRecord[]): OptionalRow {
  const declaration = selection.declaration;
  const upstream = declaration.upstream;
  const execution = upstream === null ? undefined : executions.find((candidate) =>
    candidate.run?.task?.projectId === upstream.projectId
    && candidate.run?.task?.goalId === upstream.goalId
    && candidate.run?.task?.taskId === upstream.taskId);
  const facts = execution === undefined
    ? 'no current execution record'
    : `run ${execution.run.ref.runId} ${execution.run.status}${execution.run.outcome === null ? '' : ` (${execution.run.outcome})`}`;
  const reason = selection.reason === null ? selection.state : selection.reason;
  return {
    key: `input:${declaration.declarationId}`,
    text: `missing input ${declaration.declarationId}: ${reason}; upstream task ${upstream?.taskId ?? '(none)'}; ${facts}`,
  };
}

function optionalRowsFromExtensions(extensions: ContextExtensionsV1): {
  footprint: OptionalRow[]; notes: OptionalRow[];
  reminders: OptionalRow[];
} {
  return {
    footprint: extensions.footprint.rows.map((row) => ({ key: row.key, text: indexRowText(row) })),
    notes: extensions.notes.rows.map((row) => ({ key: row.key, text: indexRowText(row) })),
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
    ],
  };
}

function annotations(extensions: ContextExtensionsV1): ContextAssemblyBindingV1['extensions'] {
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
function queryFocusLines(facts: QueryPreparationFacts, graph: GraphContextFactsV1['graph']): string | null {
  const focus = facts.record?.job?.job?.intent?.focusTaskRefs ?? [];
  const lines = focus.map((ref) => {
    const row = graph?.tasks.find((candidate) => candidate.ref.taskId === ref.taskId && candidate.ref.goalId === ref.goalId);
    return `task: ${row?.definition.title ?? ref.taskId} (${ref.taskId})`;
  });
  return lines.length === 0 ? null : lines.join('\n');
}

/** §4.3/G5.1: the planning task section is the current Plan summary. */
function queryPlanSummary(plan: PlanRevisionSnapshot): string {
  const stages = plan.stages.map((stage) => `${stage.title} (${stage.stageId})`).join(', ') || '(none)';
  const tasks = plan.tasks.map((task) => `${task.title} (${task.taskId})`).join(', ') || '(none)';
  return [`plan: ${plan.ref.planId}@${String(plan.planRevision)}`, `stages: ${stages}`, `tasks: ${tasks}`].join('\n');
}

/** §4.3/G5.1: the planning footprint rows are the top-level module cards. */
function topLevelModuleCards(architecture: GraphContextFactsV1['architecture']): OptionalRow[] {
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

function assembleSections(input: {
  role: string;
  goal: string | null;
  task: string | null;
  optional: Partial<Record<OptionalSectionName, OptionalRow[]>>;
  continuationSuffix: string | null;
  residentBudgetBytes: number;
}): { input: string; sections: ContextAssemblyBindingV1['sections']; residentBytes: number; totalBytes: number } {
  return renderContext({
    prelude: WORK_CONTEXT_PRELUDE,
    required: { role: input.role, goal: input.goal, task: input.task },
    optional: input.optional,
    continuationSuffix: input.continuationSuffix,
    residentBudgetBytes: input.residentBudgetBytes,
  });
}

// ------------------------------------------------------------------------ //
// Continuation brief (§4.3 hard rule)                                       //
// ------------------------------------------------------------------------ //

/** The Kernel `agent.event` types that end a Turn: a completed history boundary (LA-1). */
const KERNEL_TERMINAL_EVENTS: readonly string[] = ['run.completed', 'run.failed', 'run.cancelled', 'run.limit_exceeded', 'run.yielded'];

export async function briefWorkspaceFactsFor(
  deps: Partial<Pick<RuntimeExecutionDependencies, 'workspaceHost' | 'workspaceSource'>>, now: () => string,
  record: TaskExecutionRecord,
): Promise<BriefWorkspaceFacts> {
  const at = now();
  const unavailable = (reason: string): BriefWorkspaceFacts => ({
    briefCheckpoint: { kind: 'brief', at, workspaceRevision: null, sourceDigest: null, unavailableReason: reason },
    uncommitted: { status: 'unavailable', baseCommit: null, paths: [], omitted: 0, reason },
  });
  const source = deps.workspaceSource;
  if (source === undefined || deps.workspaceHost === undefined || record?.run === undefined) {
    return unavailable('the workspace source reader is not configured');
  }
  let resolved;
  try {
    resolved = await deps.workspaceHost.resolveRoot({ aggregateType: 'Workspace', projectId: record.run.ref.projectId,
      workspaceId: record.session.workspaceId });
  } catch (error) { return unavailable(`the workspace root could not be resolved: ${messageOf(error)}`); }
  if (resolved.status !== 'ready') return unavailable(`the workspace root could not be resolved: ${resolved.reason}`);
  const digest = await source.captureDigest(resolved.value.root).catch((error: unknown) =>
    ({ status: 'unavailable' as const, reason: messageOf(error) }));
  const briefCheckpoint: ContinuationSourceCheckpointV1 = digest.status === 'ready'
    ? { kind: 'brief', at, workspaceRevision: resolved.value.workspaceRevision, sourceDigest: digest.sourceDigest, unavailableReason: null }
    : { kind: 'brief', at, workspaceRevision: resolved.value.workspaceRevision, sourceDigest: null, unavailableReason: digest.reason };
  const captured = await source.capture(resolved.value.root).catch(() => null);
  let uncommitted: BriefWorkspaceFacts['uncommitted'];
  if (captured === null || captured.status !== 'ready') {
    uncommitted = { status: 'unavailable', baseCommit: null, paths: [], omitted: 0,
      reason: captured === null ? 'the workspace capture failed' : `the workspace capture is ${captured.status}` };
  } else if (captured.sourceProof.kind === 'git-head-worktree') {
    const paths = captured.sourceProof.changedFiles;
    uncommitted = { status: 'git', baseCommit: captured.sourceProof.baseCommit,
      paths: paths.slice(0, CONTINUATION_BRIEF_LIMITS.paths), omitted: Math.max(0, paths.length - CONTINUATION_BRIEF_LIMITS.paths),
      reason: null };
  } else {
    uncommitted = { status: 'not_git', baseCommit: null, paths: [], omitted: 0, reason: null };
  }
  return { briefCheckpoint, uncommitted };
}

async function sessionBasisForContext(
  deps: ContextAssemblerDependencies, record: TaskExecutionRecord, basis: ContinuationBasis, signal: AbortSignal,
): Promise<PreparedTaskManifestV1['sessionBasis'] | null> {
  const source = basis.requeue.historySource;
  if (source === null || deps.kernelStores === undefined) return null;
  const claimSession = record.session;
  if (source.sessionRef.projectId === record.outbox.claim.sessionRef.projectId
    && source.sessionRef.sessionId === record.outbox.claim.sessionRef.sessionId) return null;
  if (claimSession.historyCursor !== null) return null;
  if (source.adapterId !== claimSession.kernel.adapterId) return null;
  if (source.throughPosition === null) return { sourceKernelSessionId: source.kernelSessionId, throughPosition: null };
  const onChain = [basis.previous, ...basis.factsChain.map((hop) => hop.run)].find((candidate) =>
    candidate.session.ref.projectId === source.sessionRef.projectId && candidate.session.ref.sessionId === source.sessionRef.sessionId);
  const sourceSession = onChain?.session ?? { ...claimSession,
    ref: { ...claimSession.ref, projectId: source.sessionRef.projectId, sessionId: source.sessionRef.sessionId },
    kernel: { ...claimSession.kernel, adapterId: source.adapterId, kernelSessionId: source.kernelSessionId } };
  if (sourceSession.kernel.kernelSessionId !== source.kernelSessionId || sourceSession.kernel.adapterId !== source.adapterId) {
    return null;
  }
  const owner = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores });
  let boundary: number | null = null;
  let cursor = 0;
  for (let page = 0; page < 64 && cursor < source.throughPosition; page += 1) {
    let window;
    try {
      window = await owner.readPositionWindow({ session: sourceSession, afterPosition: cursor,
        throughPosition: source.throughPosition, limit: 200, signal });
    } catch { return null; }
    if (window.status !== 'ready') return null;
    for (const entry of window.value.entries) {
      const item = decodeKernelEntry(entry);
      if (item === null) return null;
      if (item.record.recordType === 'agent.event' && KERNEL_TERMINAL_EVENTS.includes(item.record.payload.event.type)) {
        boundary = item.position;
      }
    }
    cursor = window.value.nextPosition;
    if (!window.value.hasMore) break;
  }
  return { sourceKernelSessionId: source.kernelSessionId, throughPosition: boundary };
}

/**
 * Slice 1 §4.1 (T10): `TaskRequeue.archiveOrigin != null` marks an archive
 * ordinary claim. It keeps the real TaskRequeue fact chain and the anchored
 * brief but never seeds the old line's full Kernel history: the session basis
 * is skipped, so `sessionBasis`/`seededFrom` stay null and the brief's continuity
 * is `other_session`. The condition is deliberately NOT "the Task has an
 * anchor", which would break the existing human-continue continuation case.
 */
export function archiveOriginSkipsHistorySeed(
  requeue: Pick<TaskRequeueSnapshotV1, 'archiveOrigin'>,
): boolean {
  return requeue.archiveOrigin !== undefined && requeue.archiveOrigin !== null;
}

async function assembleBriefForContext(
  deps: ContextAssemblerDependencies, now: () => string, ctx: CoreCallContext, record: TaskExecutionRecord,
): Promise<{ ok: true; brief: ContinuationBriefV1; sessionBasis: PreparedTaskManifestV1['sessionBasis'] | null;
    anomalyAnchorRefs: SessionAnomalyAnchorRef[] | null }
  | { ok: false; rejection: CoreRejection }> {
  const readBasis = deps.executions.readContinuationBasis;
  if (readBasis === undefined || deps.kernelStores === undefined) {
    return { ok: false, rejection: rejected('unsupported', 'a requeue Run needs the continuation basis reader and the Kernel stores') };
  }
  let basis: ReadResult<ContinuationBasis>;
  try { basis = await readBasis.call(deps.executions, ctx, { runRef: record.run.ref }); }
  catch (error) { return { ok: false, rejection: rejected('unavailable', `the continuation basis read failed: ${messageOf(error)}`) }; }
  if (basis.status !== 'ready') return { ok: false, rejection: mapRead(basis) };
  const facts = basis.value.factsChain.at(-1)?.run ?? basis.value.previous;
  const truncated = facts.run.executionHistory === undefined
    && basis.value.factsChain.length >= CONTINUATION_BRIEF_LIMITS.factsFromHops && facts.run.requeueRef !== undefined;
  const owner = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores });
  const turn = await readPreviousTurn(owner, facts, ctx.signal);
  if (turn.kernel === 'retry') return { ok: false, rejection: rejected(turn.code, `the previous Turn is not readable now: ${turn.reason}`) };
  const workspace = await briefWorkspaceFactsFor(deps, now, record);
  // §4.1 T10 (slice 1): an archive-origin ordinary claim is a NEW pickup, never the old line's continuation.
  const sessionBasis = archiveOriginSkipsHistorySeed(basis.value.requeue)
    ? null
    : await sessionBasisForContext(deps, record, basis.value, ctx.signal);
  const source = basis.value.requeue.historySource;
  const seededFrom = sessionBasis === null || sessionBasis === undefined || sessionBasis.throughPosition === null || source === null
    ? null
    : { sessionRef: { projectId: source.sessionRef.projectId, sessionId: source.sessionRef.sessionId }, throughPosition: sessionBasis.throughPosition };
  // Slice 1 §2.7: this Task's not-yet-picked-up anchors, bounded to the earliest eight.
  const anomalies = assembleAnomalySection(basis.value.pendingAnomalies ?? []);
  const brief = assembleContinuationBrief({
    basis: basis.value, factsRecord: facts, factsHops: basis.value.factsChain.length, factsTruncated: truncated,
    turn, workspace, claimSessionRef: record.outbox.claim.sessionRef, seededFrom, anomalies,
  });
  const problem = continuationBriefShapeProblem(brief);
  if (problem !== null) return { ok: false, rejection: rejected('unavailable', `the assembled continuation brief is malformed: ${problem}`) };
  const anomalyAnchorRefs = anomalies === null ? null : anomalies.anchors.map((anchor) => anchor.ref);
  return { ok: true, brief, sessionBasis, anomalyAnchorRefs };
}

// ------------------------------------------------------------------------ //
// Factory                                                                   //
// ------------------------------------------------------------------------ //

export function createContextAssembler(deps: ContextAssemblerDependencies): ContextAssembler {
  const clock = (deps as ContextAssemblerDependencies & ContextClock).now;

  async function assembleTask(ctx: CoreCallContext, input: {
    execution: TaskExecutionRecord; role: RoleSpecResolutionV1;
    configuration: ResolvedRuntimeConfiguration;
    permissions: TaskEnvelopeV1['permissions'];
  }): Promise<ReadResult<AssembledContextV1>> {
    const execution = input.execution;
    const run = execution?.run;
    const claim = execution?.outbox?.claim;
    const plan = execution?.plan;
    const session = execution?.session;
    const residentBudgetBytes = typeof input.configuration?.contextResidentBytes === 'number'
      && Number.isSafeInteger(input.configuration.contextResidentBytes) && input.configuration.contextResidentBytes >= 0
      ? input.configuration.contextResidentBytes : 4096;
    const dutyResult = effectiveDuty(input.role, input.configuration, session?.role);
    if ('rejection' in dutyResult) return dutyResult.rejection;
    const duty = dutyResult.duty;

    let facts: GraphContextFactsV1 | null = null;
    if (deps.graphContext !== undefined && claim !== undefined) {
      let read: ReadResult<GraphContextFactsV1>;
      try {
        read = await deps.graphContext.readContextFacts(ctx, {
          goalRef: { aggregateType: 'Goal', projectId: claim.task.projectId, goalId: claim.task.goalId },
          planRef: claim.planRef,
          focusTaskIds: [claim.task.taskId],
          includeInputs: true,
        });
      } catch (error) {
        return rejected('unavailable', `the graph context read failed: ${messageOf(error)}`);
      }
      if (read.status !== 'ready') return read;
      facts = read.value;
    }
    const graphContextMissing = deps.graphContext === undefined;
    const extensions = facts?.extensions ?? notImplementedExtensions();
    const workspaceRevision = run?.workspaceSnapshot?.revision ?? 0;

    const roleSection = rolePayload(input.role, input.permissions, duty, residentBudgetBytes);
    const goalSection = graphContextMissing || facts === null
      ? '目标上下文未加载'
      : goalPayload(facts.goal, workspaceRevision, extensions);
    const taskSection = plan === undefined || claim === undefined ? null : taskPayload(plan, execution, facts?.graph ?? null);

    const extensionRows = optionalRowsFromExtensions(extensions);
    const reminders: OptionalRow[] = [];
    // §4.3/G5.3: an unassembled extension is reported as not connected whenever
    // the projection says `not_implemented`, with or without the graph port.
    if (extensions.notes.availability === 'not_implemented') {
      reminders.push({ key: 'note:not_implemented', text: '注记索引尚未接入' });
    }
    if (extensions.anomalies.availability === 'not_implemented') {
      reminders.push({ key: 'anomaly:not_implemented', text: '异常锚点投影尚未接入' });
    }
    reminders.push(...extensionRows.reminders);

    const inputSelections: InputSelectionV1[] = facts?.inputs ?? [];
    const missingSelections = inputSelections.filter((selection) => selection.state !== 'selected');
    // §4.1/G5.4: `facts.executions` holds only the focus Task's Run, so a bounded
    // second read obtains each missing declaration's upstream Task facts; it
    // never opens materials.
    let upstreamExecutions: readonly TaskExecutionRecord[] = facts?.executions ?? [];
    const upstreamTaskIds = [...new Set(missingSelections
      .map((selection) => selection.declaration.upstream)
      .filter((upstream): upstream is TaskTriple => upstream !== null)
      .map((upstream) => upstream.taskId))].sort();
    if (deps.graphContext !== undefined && claim !== undefined && upstreamTaskIds.length > 0) {
      let enriched: ReadResult<GraphContextFactsV1>;
      try {
        enriched = await deps.graphContext.readContextFacts(ctx, {
          goalRef: { aggregateType: 'Goal', projectId: claim.task.projectId, goalId: claim.task.goalId },
          planRef: claim.planRef,
          focusTaskIds: upstreamTaskIds,
          includeInputs: false,
        });
      } catch (error) {
        enriched = rejected('unavailable', `the upstream graph context read failed: ${messageOf(error)}`);
      }
      // The reminder index is optional enrichment; a bounded read that cannot
      // return the upstream Runs leaves the message at the honest
      // "no current execution record" fallback instead of blocking entry.
      if (enriched.status === 'ready') upstreamExecutions = enriched.value.executions;
    }
    for (const selection of missingSelections) {
      reminders.push(missingInputReminder(selection, upstreamExecutions));
    }

    const inputRows: OptionalRow[] = [];
    if (claim !== undefined && deps.taskInputs !== undefined) {
      for (const selection of inputSelections) {
        if (selection.state !== 'selected' || selection.source === null) continue;
        const candidateKey = sha256Hex(canonicalJson(selection.source as unknown as JsonValue));
        let page: ReadResult<TaskInputPageV1>;
        try {
          page = await deps.taskInputs.readTaskInputPage(ctx, {
            consumer: claim.task, planRef: claim.planRef, declarationId: selection.declaration.declarationId,
            candidateKey, afterCursor: null, maxBytes: 4096,
          });
        } catch (error) {
          return rejected('unavailable', `the task input page read failed: ${messageOf(error)}`);
        }
        if (page.status !== 'ready') return page;
        const pageSelection = page.value.selection;
        if (pageSelection.state !== 'selected' || pageSelection.source === null) {
          // The owner returned an item-level missing/unavailable state as ready:
          // render that state and never a fake selected row.
          reminders.push(missingInputReminder(pageSelection, upstreamExecutions));
          continue;
        }
        if (sha256Hex(canonicalJson(pageSelection.source as unknown as JsonValue)) !== candidateKey) {
          return rejected('revision_conflict', `the input ${selection.declaration.declarationId} changed while its first page was read`);
        }
        inputRows.push({
          key: selection.declaration.declarationId,
          text: canonical({
            declarationId: selection.declaration.declarationId, source: pageSelection.source,
            usage: pageSelection.usage, bodyExcerpt: page.value.body, more: page.value.nextCursor !== null,
          }, '{}'),
        });
      }
    }

    let continuationBrief: ContinuationBriefV1 | null = null;
    let sessionBasis: PreparedTaskManifestV1['sessionBasis'] | undefined;
    let continuationSuffix: string | null = null;
    let anomalyAnchorRefs: SessionAnomalyAnchorRef[] | null = null;
    if (run?.requeueRef !== undefined) {
      if (clock === undefined) {
        return rejected('unsupported', 'the context assembler needs the Host clock to assemble a continuation brief');
      }
      const assembled = await assembleBriefForContext(deps, clock, ctx, execution);
      if (!assembled.ok) return assembled.rejection;
      continuationBrief = assembled.brief;
      sessionBasis = assembled.sessionBasis === null ? undefined : assembled.sessionBasis;
      anomalyAnchorRefs = assembled.anomalyAnchorRefs;
      // Slice 1 N7 (§2.7): the anomaly section is budgeted; when even the mandatory content cannot fit the
      // 16 KiB brief the preparation is refused `capacity`, never rendered truncated or thrown out of the port.
      try {
        continuationSuffix = renderContinuationBriefZh(continuationBrief, continuationBriefDigest(continuationBrief));
      } catch (error) {
        if (error instanceof ContinuationBriefCapacityError) return rejected('capacity', error.message);
        throw error;
      }
    }

    const rendered = assembleSections({
      role: roleSection,
      goal: goalSection,
      task: taskSection,
      optional: {
        footprint: extensionRows.footprint, notes: extensionRows.notes, reminders, inputs: inputRows,
      },
      continuationSuffix,
      residentBudgetBytes,
    });

    const selectedTaskInputs = inputSelections
      .filter((selection) => selection.state === 'selected' && selection.source?.kind === 'artifact')
      .map((selection) => ({
        requirementId: requirementIdOf(selection.declaration.declarationId),
        ref: (selection.source as Extract<InputSelectionV1['source'], { kind: 'artifact' }>).ref as ArtifactRef,
      }))
      .sort((left, right) => (left.requirementId < right.requirementId ? -1 : left.requirementId > right.requirementId ? 1 : 0));

    // §4.3/G (wiring 1 W1-CTX-01, L2): the Work binding replaces only this claim
    // Goal's `record` source digest with the Goal-record content the Goal section
    // shows. Map first, then sort, so the digest takes part in the canonical key.
    const bindingSources = (facts?.sources ?? []).map((source): ContextSourceV1 => {
      if (facts === null || claim === undefined) return source;
      if (source.kind !== 'record' || source.ref.aggregateType !== 'Goal') return source;
      if (source.ref.projectId !== claim.task.projectId || source.ref.goalId !== claim.task.goalId) return source;
      return { ...source, digest: goalContextDigestV1(facts.goal) };
    });

    const binding: ContextAssemblyBindingV1 = {
      schemaVersion: 1,
      formatVersion: CONTEXT_FORMAT_VERSION,
      callKind: continuationSuffix === null ? 'work' : 'continuation',
      duty,
      residentBudgetBytes,
      residentBytes: rendered.residentBytes,
      totalBytes: rendered.totalBytes,
      sections: rendered.sections,
      sources: sortedSources(bindingSources),
      inputSelections: [...inputSelections],
      extensions: annotations(extensions),
    };
    return {
      status: 'ready',
      value: { input: rendered.input, binding, continuationBrief, sessionBasis, selectedTaskInputs,
        ...(anomalyAnchorRefs === null ? {} : { anomalyAnchorRefs }) },
    };
  }

  async function assembleQuery(ctx: CoreCallContext, input: {
    facts: QueryPreparationFacts;
    role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
    configuration: ResolvedRuntimeConfiguration;
    permissions: PreparedQueryManifestV1['permissions'];
    question: string;
  }): Promise<ReadResult<AssembledContextV1>> {
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
    const goalSection = `${goalPayload(facts?.goal ?? goal, workspace.revision, extensions)}\n## Question\n${input.question}`;
    const taskSection = planning && input.facts.focusPlan !== null
      ? queryPlanSummary(input.facts.focusPlan)
      : planning ? null : queryFocusLines(input.facts, facts?.graph ?? null);
    const footprintRows = planning ? topLevelModuleCards(facts?.architecture ?? null) : [];
    const rendered = renderContext({
      prelude: QUERY_CONTEXT_PRELUDE,
      required: { role: roleSection, goal: goalSection, task: taskSection },
      optional: planning ? { footprint: footprintRows } : {},
      continuationSuffix: null,
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
      sources: sortedSources(facts?.sources ?? []),
      inputSelections: [],
      extensions: annotations(extensions),
    };
    return { status: 'ready', value: { input: rendered.input, binding, continuationBrief: null, sessionBasis: undefined, selectedTaskInputs: [] } };
  }

  return {
    assembleTask,
    assembleQuery,
    async readAttentionGraph(ctx, request) {
      if (deps.graphContext === undefined) {
        return rejected('unsupported', 'the graph context reader is not configured');
      }
      return deps.graphContext.readAttentionFacts(ctx, request);
    },
  };
}

