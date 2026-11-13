/**
 * R5b.2 bounded Query input preparation.
 *
 * Reads the real Goal/Workspace and the optional accepted focus Plan from the
 * SAME records the claim already bound, resolves the trusted Host Query
 * configuration, intersects it with the stable Role ceiling and the read-only
 * Query ceiling, stores one bounded manifest body through the existing raw body
 * store under the Query's own owner, and asks the internal Query writer to bind
 * it. Nothing is fabricated: a missing fact, an inadmissible Role, a revoked
 * Host grant or a manifest over the Artifact capacity is an explicit rejection.
 */
import { messageOf } from '../../contracts/error-message.js';
import { rejected } from '../../contracts/core/rejections.js';
import { isRecord, nonEmpty } from '../../contracts/validation/common.js';
import { ARTIFACT_MAX_SIZE_BYTES } from '../../contracts/artifact.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { RoleConfigurationRef } from '../../contracts/core/identity.js';
import type { PlatformDutyV1 } from '../../contracts/platform-duty.js';
import {
  interventionPlanningQueryRefs, isRequestRound, queryAnswerShapeOf, queryExecutionBindingOf,
  type QueryAnswerShapeV1, type QueryJobIntentV1,
} from '../../contracts/query-job.js';
import { planResumeOriginalQueryOfText, systemRoundOfText, unknownCallAdviceSubjectOfText } from '../../contracts/plan-round.js';
import { parseInitialPlanningResponseV2 } from '../../contracts/initial-planning-parse.js';
import type { FrozenHandoffBriefV1 } from '../../contracts/handoff-brief.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { SourceRefV1 } from '../../contracts/dispatch.js';
import type { RuntimeBudget } from '../../contracts/runtime-budget.js';
import { sha256Hex, canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import type { PlanRevisionSnapshot, RuntimeTask } from '../../contracts/plan.js';
import type { QueryJobAnswerRef } from '../../contracts/query-job.js';
import { decisionSourceKey } from '../../contracts/goal-decisions.js';
import type { DecisionCardV1 } from '../work-graph/model/decision-contracts.js';
import { QUERY_MANIFEST_CONTENT_TYPE } from '../../contracts/no-progress.js';
import type { PromptPackSourcePort } from '../../contracts/prompts/prompt-pack.js';
import { promptSelectionOf } from '../../contracts/prompts/prompt-set.js';
import { renderTemplate } from '../../contracts/prompts/render-template.js';
import { plainSessionRefToAggregate } from '../work-graph/sessions/session-record-codecs.js';
import { readConsultationCreate } from '../work-graph/queries/platform-facts.js';
import type { ConsultationCreateV1, ConsultationFactsV1 } from '../work-graph/model/session-contracts.js';
import type { QueryNoteAdmissionV1 } from '../work-graph/model/secretary-note-contracts.js';
import type { SecretaryPreparationFactsV1 } from '../work-graph/model/secretary-contracts.js';
import type { SecretaryHandoffFactsPort } from '../work-graph/model/secretary-lifecycle-contracts.js';
import type { RequestFactsPort } from '../work-graph/tasks/request-facts.js';
import { planningNoteAdmission, secretaryNoteAdmission } from '../work-graph/state/secretary-note.js';
import { decisionActionPolicy } from '../work-graph/state/decision-policy.js';
import { SECRETARY_QUERY_MAILBOX_TOOL_NAMES, SESSION_MAILBOX_TOOL_NAMES } from './communication-tools.js';
import { CREATE_MEMBER_TOOL_NAME } from './member-tools.js';
import { READ_REQUESTS_TOOL_NAME } from './request-read-tools.js';
import type { ContextAssembler } from './context-assembler.js';
import { createContextAssembler } from './context-assembler.js';
import { queryPreparedSectionOrder, sectionOrderFor } from './context-rendering.js';
import type { SecretaryHandoffPromptFactsV1 } from './context-secretary-recipe.js';
import type { ConsultationResolvedFactV1 } from './consultation-facts-text.js';
import { finalToolNamesOf, BUILTIN_TOOL_NAMES, RUNTIME_TOOL_NAMES } from './tool-group-assembly.js';
import { READONLY_COMMAND_TOOL_NAME } from './readonly-command-tool.js';
import type { ContextQueryHistoryInputV1 } from './context-types.js';
import type { PlanningQuestionReader } from '../work-graph/tasks/planning-question-reader.js';
import { hostContextIn } from '../work-graph/tasks/plan-lineage.js';
import type { PlanProposal } from '../work-graph/model/plan-contracts.js';
import { deriveFuturePlanDelta, type FuturePlanDelta } from '../work-graph/tasks/plan-validation.js';
import { effectiveDuty, queryPlanSummary } from './context-fact-text.js';
import {
  promptDeclarationProblem, promptRenderProblem, resolvePromptPack, selectPromptSkills,
  promptTemplatePart, promptTemplateVersion, storePromptTexts, templatesToFreeze,
  trackPromptTexts, type PromptPartsV1,
} from './prompt-set-texts.js';
import type {
  PrepareQueryExecutionRequest, ResolvedRuntimeConfiguration, RuntimeExecutionDependencies,
} from './execution-contracts.js';

export type QueryPreparationPort = {
  prepare(ctx: CoreCallContext, request: PrepareQueryExecutionRequest): Promise<ReadResult<PreparedQueryExecution>>;
};

/** Exact manifest content type (declared once in contracts, ND-9); the Query writer re-reads the body and requires this. */
export { QUERY_MANIFEST_CONTENT_TYPE };
export const MAX_QUERY_MANIFEST_BYTES = ARTIFACT_MAX_SIZE_BYTES;

/**
 * The read-only Query ceiling: no file mutation, no shell, no mailbox writer and no plan or member writer,
 * regardless of what the Host grant or the Role ceiling declare. `propose_future_plan` stays out (coordination):
 * an agent plan write is admitted only for a work Run holding the Task lease (plan-write-admission.ts), and a
 * planning round's candidate is written by the platform from the round's answer. The two whiteboard reads are
 * reads and pass (121-114). Declaring a name here grants nothing; it is the outer intersection applied AFTER the
 * Host grant and Role ceiling.
 */
const FORBIDDEN_QUERY_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  'write', 'edit', 'shell', ...SESSION_MAILBOX_TOOL_NAMES, 'propose_future_plan', CREATE_MEMBER_TOOL_NAME,
  READ_REQUESTS_TOOL_NAME,
]);
/** Only a secretary request round may select these four. */
const SECRETARY_QUERY_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...SECRETARY_QUERY_MAILBOX_TOOL_NAMES, CREATE_MEMBER_TOOL_NAME, READ_REQUESTS_TOOL_NAME,
]);
/** A cold-start exploration round may also select `read_requests` (the request it explores from). */
const EXPLORATION_QUERY_TOOL_NAMES: ReadonlySet<string> = new Set<string>([READ_REQUESTS_TOOL_NAME]);
/** 121-114: the adviser's own planning round may create an executor line. */
const ADVISER_QUERY_TOOL_NAMES: ReadonlySet<string> = new Set<string>([CREATE_MEMBER_TOOL_NAME]);
/** The three rounds are exclusive: a request round, a `role_exploration` round, an `intervention_planning` round. */
function forbiddenQueryToolNames(
  secretaryRound: boolean, explorationRound: boolean, memberRound: boolean,
): ReadonlySet<string> {
  if (!secretaryRound && !explorationRound && !memberRound) return FORBIDDEN_QUERY_TOOL_NAMES;
  const allowed = secretaryRound ? SECRETARY_QUERY_TOOL_NAMES
    : explorationRound ? EXPLORATION_QUERY_TOOL_NAMES : ADVISER_QUERY_TOOL_NAMES;
  return new Set([...FORBIDDEN_QUERY_TOOL_NAMES].filter(name => !allowed.has(name)));
}

/**
 * 121-114: the one Query besides the secretary's request round that keeps `create_member`: an adviser's
 * intervention planning round in the planning shape or the Host-system text shape (null). A review round and
 * every other system-round shape is not one. Every other Query keeps the name out for a product rule
 * (MVP-BEHAVIOR:327): the secretary builds only in its request round, the scribe and the reviewer inherit no
 * member creation, an executor needs an explicit delegation on its Work path, and a cold-start exploration round
 * has no Goal yet (a member is built only for an adopted Plan's Task, L17).
 */
export function adviserMemberRound(round: {
  executionKind: QueryJobIntentV1['execution']['kind'];
  shape: QueryAnswerShapeV1 | null;
  duty: PlatformDutyV1 | null;
}): boolean {
  return round.executionKind === 'intervention_planning' && round.duty === 'adviser'
    && (round.shape === 'plan_round' || round.shape === null);
}

function ownContext(ctx: CoreCallContext): CoreCallContext | null {
  try {
    return {
      projectId: ctx.projectId,
      principal: structuredClone(ctx.principal),
      materialReader: structuredClone(ctx.materialReader),
      signal: ctx.signal,
      ...(typeof ctx.workspaceId === 'string' ? { workspaceId: ctx.workspaceId } : {}),
    };
  } catch { return null; }
}
function mapRead(result: ReadResult<unknown>): CoreRejection {
  if (result.status === 'ready') return rejected('unavailable', 'a must-fail read unexpectedly returned a value');
  if (result.status === 'not_found') return rejected('not_found', 'the required Query fact was not found');
  if (result.status === 'not_ready') return rejected('incomplete', 'the required Query fact is not readable at the required watermark');
  return { status: 'rejected', code: result.code, reason: result.reason, ...(result.current === undefined ? {} : { current: result.current }) };
}

/**
 * The review candidate's own full text (spec §6.3.2): the changed tasks'
 * complete instructions and fields, the new/changed obligations, and the three
 * dependency differences against the adopted plan. It renders the draft
 * verbatim and never reads a task card from the adopted universe.
 */
function reviewCandidateText(
  base: PlanRevisionSnapshot,
  proposal: PlanProposal,
  changedIds: ReadonlySet<string>,
  groups: FuturePlanDelta,
): string {
  const draft = proposal.draft;
  const lines: string[] = [
    `proposal: ${proposal.ref.proposalId}@${String(proposal.revision)}`,
    `basedOn: ${proposal.basedOn === null ? '(none)' : proposal.basedOn.planId}`,
  ];
  const group = (label: string, ids: readonly string[]): void => {
    if (ids.length > 0) lines.push(`${label}: ${ids.join(', ')}`);
  };
  group('added taskIds', groups.addedTaskIds);
  group('changed taskIds', groups.changedTaskIds);
  group('cancelled taskIds', groups.cancelledTaskIds);
  group('disposition-only taskIds', groups.dispositionOnlyTaskIds);
  for (const task of draft.tasks) {
    if (!changedIds.has(task.taskId)) continue;
    const assignment = (draft.assignments ?? []).find(candidate => candidate.taskId === task.taskId);
    lines.push('', `## task ${task.taskId}: ${task.title}`);
    if (task.estimatedLines !== undefined) lines.push(`estimatedLines: ${String(task.estimatedLines)}`);
    if (task.sizeClass !== undefined) lines.push(`sizeClass: ${task.sizeClass}`);
    if (task.plannedFiles !== undefined) lines.push(`plannedFiles: ${task.plannedFiles.join(', ')}`);
    if (task.replacedByTaskId !== undefined && task.replacedByTaskId !== null) {
      lines.push(`replacedByTaskId: ${task.replacedByTaskId}`);
    }
    if (assignment !== undefined) lines.push(`instruction:\n${assignment.instruction}`);
  }
  const baseObligations = new Map(base.obligations.map(obligation =>
    [obligation.obligationId, canonicalJson(obligation as unknown as JsonValue)] as const));
  for (const obligation of draft.obligations) {
    const carried = obligation.taskIds.some(taskId => changedIds.has(taskId));
    const text = canonicalJson(obligation as unknown as JsonValue);
    if (carried || baseObligations.get(obligation.obligationId) !== text) {
      lines.push(`obligation: ${text}`);
    }
  }
  const difference = (label: string, before: readonly unknown[], after: readonly unknown[]): void => {
    const left = new Set(before.map(value => canonicalJson(value as unknown as JsonValue)));
    const right = new Set(after.map(value => canonicalJson(value as unknown as JsonValue)));
    for (const value of right) if (!left.has(value)) lines.push(`${label} added: ${value}`);
    for (const value of left) if (!right.has(value)) lines.push(`${label} removed: ${value}`);
  };
  difference('dependsOn', base.executionDag.dependsOn, draft.executionDag.dependsOn);
  difference('taskRelations', base.taskRelations ?? [], draft.taskRelations ?? []);
  difference('inputRequirements', base.inputRequirements ?? [], draft.inputRequirements ?? []);
  return lines.join('\n');
}

/** Per-field intersection of two runtime budgets: null means "no limit", so a
 * value in either side is the tighter bound and both-null stays null. */
function tightenRuntimeBudget(requested: RuntimeBudget, host: RuntimeBudget): RuntimeBudget {
  const tighten = (left: number | null, right: number | null): number | null => {
    if (left === null) return right;
    if (right === null) return left;
    return Math.min(left, right);
  };
  return {
    contextWindowTokens: Math.min(requested.contextWindowTokens, host.contextWindowTokens),
    inputTokens: tighten(requested.inputTokens, host.inputTokens),
    outputTokens: tighten(requested.outputTokens, host.outputTokens),
    maxRequests: tighten(requested.maxRequests, host.maxRequests),
    maxToolCalls: tighten(requested.maxToolCalls, host.maxToolCalls),
    timeoutMs: tighten(requested.timeoutMs, host.timeoutMs),
    perResponseTokens: Math.min(requested.perResponseTokens, host.perResponseTokens),
  };
}

/**
 * The ONE trusted Query Host projection: the real Host resolution intersected
 * with the stable Role ceiling and the read-only Query ceiling. It never echoes
 * a manifest declaration and never widens the Host grant.
 */
export function projectQueryConfiguration(input: {
  host: ResolvedRuntimeConfiguration;
  requested: RuntimeBudget;
  roleResolution: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
  /** `isRequestRound(job)`: the one frozen class fact. */
  secretaryRound: boolean;
  /** The Job's execution kind is `role_exploration`; absent reads false. */
  explorationRound?: boolean;
  /** 121-114: the round's frozen execution and its Session's Role (`executionState.role`). */
  execution: QueryJobIntentV1['execution'];
  sessionRole: RoleConfigurationRef;
}): {
  configurationRevision: string;
  permissions: { tools: string[]; writeScope: [] };
  hostTemplate: PreparedQueryManifestV1['hostTemplate'];
  budget: RuntimeBudget;
} {
  // A non-request round's frozen shape is `queryAnswerShapeOf(execution, null)` (the preparation's own call). A duty
  // the Host and the Role disagree on is not the adviser's; the context recipe refuses that round anyway.
  const duty = effectiveDuty(input.roleResolution, input.host, input.sessionRole);
  const memberRound = adviserMemberRound({ executionKind: input.execution.kind,
    shape: queryAnswerShapeOf(input.execution, null), duty: 'duty' in duty ? duty.duty : null });
  const forbidden = forbiddenQueryToolNames(input.secretaryRound, input.explorationRound === true, memberRound);
  const ceiling = input.roleResolution.status === 'resolved'
    ? new Set(input.roleResolution.spec.permissions.tools)
    : null;
  const tools = input.host.tools.filter(tool => !forbidden.has(tool)
    && (ceiling === null || ceiling.has(tool)));
  return {
    configurationRevision: input.host.configurationRevision,
    permissions: { tools, writeScope: [] },
    hostTemplate: input.host.hostTemplate === null ? null : { ...input.host.hostTemplate },
    budget: tightenRuntimeBudget(input.requested, input.host.budget),
  };
}

/** H: the inherited `handoffBriefs` is the SAME instance Work preparation uses. */
export type QueryPreparationDependencies = RuntimeExecutionDependencies & {
  /**
   * Ruling 14: the ONE prompt-pack source of this preparation. Absent installs
   * the ruling-30 platform default (the generated pack), never `unavailable`;
   * production always wires the source.
   */
  promptPacks?: PromptPackSourcePort;
  /** SR3 item 6/§8.3: the SAME hand-off facts owner H publishes, read once for a successor round's brief. */
  handoff?: Pick<SecretaryHandoffFactsPort, 'readBriefState'>;
  /** The saved planning-question read a `planresume:` preparation assembles from. */
  planningQuestions?: PlanningQuestionReader;
  /**
   * S1: the request-facts read that decides whether a request followup is a
   * plan round. It reads the request's FULL round list (not `earlier`), so a
   * selected-idea round stays decisive when it falls out of the preparation
   * window. Absent makes only that decision `unavailable`.
   */
  requests?: Pick<RequestFactsPort, 'readRequest'>;
};

export function createQueryPreparation(deps: QueryPreparationDependencies, contextAssembler?: ContextAssembler): QueryPreparationPort {
  // §4.2/G5.7: a missing second argument constructs the same one assembler once.
  const assembler = contextAssembler ?? createContextAssembler(deps);
  // §3.15 item 5: the ONE read of a create operation's frozen consultation payload.
  const consultationCreate = readConsultationCreate(deps.sessions);
  return {
    async prepare(ctx: CoreCallContext, request: PrepareQueryExecutionRequest): Promise<ReadResult<PreparedQueryExecution>> {
      if (deps.queryExecution === undefined) {
        return rejected('unsupported', 'prepareQuery requires the trusted QueryExecutionPort');
      }
      const owned = ownContext(ctx);
      if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
      if (owned.principal.kind !== 'host') return rejected('forbidden', 'prepareQuery requires a trusted Host call context');
      const signal = owned.signal;
      if (signal.aborted) return rejected('cancelled', 'the Query preparation was cancelled before the execution read');
      const rawRef = request?.queryRunRef;
      if (!isRecord(rawRef) || rawRef['aggregateType'] !== 'QueryRun' || !nonEmpty(rawRef['projectId'])
        || !nonEmpty(rawRef['workspaceId']) || !nonEmpty(rawRef['queryJobId']) || !nonEmpty(rawRef['runId'])) {
        return rejected('invalid', 'prepareQuery requires a complete QueryRunRef');
      }
      let queryRunRef;
      try { queryRunRef = structuredClone(rawRef); } catch { return rejected('invalid', 'the prepare request cannot be isolated from the caller'); }
      if (!nonEmpty(request.requestId)) return rejected('invalid', 'prepareQuery requires a requestId');
      if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
        return rejected('forbidden', 'the QueryRun is outside the Host call scope');
      }
      const requestId: string = request.requestId;

      let facts;
      try {
        facts = await deps.queryExecution.readPreparationFacts(owned, queryRunRef);
      } catch (error) {
        return rejected('unavailable', `the Query preparation facts read failed: ${messageOf(error)}`);
      }
      if (facts.status !== 'ready') return mapRead(facts);
      const { record, goal, workspace, focusPlan } = facts.value;
      const requestRound = isRequestRound(record.job);
      const explorationRound = record.job.job.intent.execution.kind === 'role_exploration';
      // A saved-message consultation Query is the other no-goal round: it reads the
      // frozen source facts and runs on the read-only copy.
      const consultationRound = record.job.job.intent.execution.kind === 'semantic_query'
        && record.job.job.intent.execution.consultation !== undefined;
      // A no-goal request round prepares from the secretary facts and a cold-start exploration round has no Goal;
      // every other Query still requires its Goal, so a null goal is refused before any use.
      if (goal === null && !requestRound && !explorationRound && !consultationRound) return rejected('invalid', 'no goal');
      const executionState = record.run.run.executionState;
      if (executionState === undefined) return rejected('incomplete', 'the QueryRun has no persisted execution state');
      if (executionState.phase !== 'claimed' && executionState.phase !== 'prepared') {
        return rejected('busy', `the QueryRun is not awaiting preparation (phase ${executionState.phase})`);
      }
      const execution = record.job.job.intent.execution;
      // Idempotent prepare: a run already bound to a manifest returns the exact
      // persisted references instead of storing a second manifest.
      if (executionState.phase === 'prepared') {
        if (executionState.prepared === null) return rejected('incomplete', 'the prepared QueryRun has no persisted manifest reference');
        return { status: 'ready', value: { queryRunRef, bundleRef: structuredClone(executionState.prepared.bundleRef), inputDigest: executionState.prepared.inputDigest } };
      }
      if (signal.aborted) return rejected('cancelled', 'the Query preparation was cancelled after the facts read');
      // A request round's binding and budget come from its own attempt; a
      // claimed request round without one is an invariant break in the contract.
      const binding = queryExecutionBindingOf(record.job, record.run);

      if (deps.host.resolveQueryConfiguration === undefined) {
        return rejected('unsupported', 'prepareQuery requires the trusted Query Host configuration binding');
      }
      let configured;
      try {
        configured = await deps.host.resolveQueryConfiguration(owned, {
          queryRunRef,
          sessionRef: executionState.sessionRef,
          role: executionState.role,
          roleResolution: executionState.roleResolution,
        });
      } catch (error) {
        return rejected('unavailable', `Host Query configuration resolution failed: ${messageOf(error)}`);
      }
      if (configured.status !== 'ready') return mapRead(configured);
      // Ruling 14 item 1: Query has no snapshot, so take the selection and the
      // bound provider/model at once, before the pack await.
      const selection = promptSelectionOf(configured.value.model);
      const boundProvider = configured.value.model.configuration.provider;
      const boundModel = configured.value.model.configuration.model;
      if (signal.aborted) return rejected('cancelled', 'the Query preparation was cancelled after the Host configuration read');
      // Ruling 14 item 2: resolve the pack ONCE; a rejection names the pack.
      const resolved = await resolvePromptPack(deps.promptPacks, selection.promptPack, signal);
      if (resolved.status !== 'ready') return resolved;
      if (signal.aborted) return rejected('cancelled', 'the Query preparation was cancelled while the prompt pack was resolved');
      const pack = resolved.value;
      const tracked = trackPromptTexts(pack);
      const projected = projectQueryConfiguration({
        host: configured.value,
        requested: binding.runtimeBudget,
        roleResolution: executionState.roleResolution,
        secretaryRound: requestRound,
        explorationRound,
        execution,
        sessionRole: executionState.role,
      });
      const hostTemplate = executionState.roleResolution.status === 'resolved' ? null : projected.hostTemplate;
      if (executionState.roleResolution.status === 'absent') {
        if (hostTemplate === null) return rejected('unsupported', 'an absent Role spec requires a trusted Host legacy template');
        if (executionState.role.kind !== 'legacy_template'
          || executionState.role.templateId !== hostTemplate.templateId
          || executionState.role.templateRevision !== hostTemplate.revision) {
          return rejected('forbidden', 'the Host legacy template does not match the Session legacy template');
        }
      }

      const workspaceRevision = workspace.revision;
      const sourceRefs: SourceRefV1[] = [
        { kind: 'workspace', refId: workspace.ref.workspaceId, revision: String(workspaceRevision) },
      ];
      if (focusPlan !== null) {
        sourceRefs.push({ kind: 'plan-revision', refId: focusPlan.ref.planId, revision: String(focusPlan.planRevision) });
      }
      // The final tool list is computed once here and frozen as
      // `PromptSetV1.toolNames`.
      // Query builds graph/read-only tools and secretary-admitted note tools.
      const builtinTools = projected.permissions.tools.filter(tool => BUILTIN_TOOL_NAMES.has(tool));
      const readonlyRequested = projected.permissions.tools.includes(READONLY_COMMAND_TOOL_NAME);
      // The whole-workspace read gate is the real Host authorization, exactly
      // as the Work preparation reads it. A failed or denied authorization
      // leaves the read-only command out of the frozen list; the start reads
      // the same fact again and its comparison answers `forbidden` if it moved.
      let readonlyAllowsWholeWorkspace = false;
      if (readonlyRequested) {
        try {
          const authorized = await deps.workspaceHost.authorize(owned, {
            aggregateType: 'Workspace', projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId,
          });
          readonlyAllowsWholeWorkspace = authorized.status === 'ready' && authorized.value.allowsRead('.');
        } catch { readonlyAllowsWholeWorkspace = false; }
      }
      // A request round reads the secretary facts ONCE, before the final tool
      // list: the same value decides the note admission here, renders the
      // context, and freezes the manifest below. A failed or unwired read is
      // `unavailable`, never an empty grant set. Every non-request Query keeps
      // its old path and never reads the port.
      let secretaryFacts: SecretaryPreparationFactsV1 | null = null;
      if (requestRound) {
        if (deps.secretaryFacts === undefined) {
          return rejected('unavailable', 'the secretary preparation facts port is not wired');
        }
        try {
          const read = await deps.secretaryFacts.read(owned, { queryRunRef });
          if (read.status !== 'ready') return read;
          secretaryFacts = read.value;
        } catch (error) {
          return rejected('unavailable', `the secretary preparation facts read failed: ${messageOf(error)}`);
        }
      }
      // SR3 item 6 (§8.3): the round's hand-off material, read once from the same facts and handed to the recipe
      // through the frozen input. The understanding goals are the SAME live command's grants (no second rule); a
      // successor's brief ref reads the four states: `waiting` is the retryable `incomplete` (nothing is prepared),
      // `ready` renders the brief, `none`/`consumed` no template, a failed read `unavailable`, never an empty brief.
      let handoff: SecretaryHandoffPromptFactsV1 | undefined;
      if (secretaryFacts !== null) {
        if (secretaryFacts.request.briefRef === null) {
          if (secretaryFacts.request.understandingGrants.length > 0) {
            handoff = { kind: 'understanding', goals: [...secretaryFacts.request.understandingGrants] };
          }
        } else {
          if (deps.handoff === undefined) {
            return rejected('unavailable', 'the hand-off brief read port is not wired');
          }
          let brief;
          try {
            brief = await deps.handoff.readBriefState(owned, { session: executionState.sessionRef });
          } catch (error) {
            return rejected('unavailable', `the hand-off brief read failed: ${messageOf(error)}`);
          }
          if (brief.status === 'rejected') return brief;
          if (brief.status !== 'ready') {
            return rejected('unavailable', `the hand-off brief state is not readable (${brief.status})`);
          }
          if (brief.value.state === 'waiting') {
            return rejected('incomplete', 'the hand-off brief is not ready; the round is prepared once it is');
          }
          if (brief.value.state === 'ready') handoff = { kind: 'brief', brief: brief.value.brief };
        }
      }
      // The one frozen shape (spec §5.2.7): computed once here, written to the
      // tool list and the manifest. Note admission is a separate question
      // (§5.2.8): a request round keeps the secretary rule; every other Query
      // takes the planning rule, with only a shape-null planning Query reading
      // its source message to recognise the trusted Host system round.
      // A request followup is a plan round once any round of THIS request selected an idea. The read is the
      // request's full round list; a failed read is returned, never folded into "no idea selected".
      let planTurn = false;
      if (secretaryFacts !== null && secretaryFacts.executionKind === 'semantic_query'
        && record.job.job.roundKind === 'followup') {
        if (deps.requests === undefined) {
          return rejected('unavailable', 'the request facts read is not bound');
        }
        let requestView;
        try {
          requestView = await deps.requests.readRequest(owned, { requestRoot: secretaryFacts.request.requestRoot });
        } catch (error) {
          return rejected('unavailable', `the request facts read failed: ${messageOf(error)}`);
        }
        if (requestView.status === 'rejected') return requestView;
        if (requestView.status !== 'ready') {
          return rejected('incomplete', 'the request facts did not reach a stable window');
        }
        planTurn = requestView.value.rounds.some((round) => round.selectedIdea !== null);
      }
      const shape = queryAnswerShapeOf(
        execution, secretaryFacts === null ? null : secretaryFacts.executionKind, planTurn);
      let hostSystemPlanningSource = false;
      if (shape === null && execution.kind === 'intervention_planning') {
        if (deps.messages === undefined) {
          return rejected('unavailable', 'the planning source read is not bound');
        }
        let source;
        try {
          // The source lives in its recipient line's workspace, which may differ from the Query's (the Goal's).
          const sourceRef = execution.sourceMessageRef!;
          source = await deps.messages.readMessage(hostContextIn(owned, sourceRef.workspaceId), sourceRef);
        } catch (error) {
          return rejected('unavailable', `the planning source message read failed: ${messageOf(error)}`);
        }
        if (source.status !== 'ready') {
          return rejected('unavailable', 'the planning source message could not be read');
        }
        const message = source.value;
        hostSystemPlanningSource = message.sender.kind === 'host'
          && message.sender.actor.kind === 'system' && message.intent === 'action_request';
      }
      const noteAdmission: QueryNoteAdmissionV1 = secretaryFacts === null
        ? planningNoteAdmission({
            answerShape: shape,
            effectiveGoalId: goal === null ? null : goal.ref.goalId,
            planRef: focusPlan === null ? null : focusPlan.ref,
            hostSystemPlanningSource,
            roleExploration: explorationRound,
          })
        : secretaryNoteAdmission({
            requestRoot: secretaryFacts.request.requestRoot,
            effectiveGoalId: secretaryFacts.request.effectiveGoalId,
            grantedGoalIds: secretaryFacts.request.understandingGrants,
          });
      // 121-112: a secretary round on a Goal with an adopted Plan whose autonomy
      // lets the platform refine it may also arrange a small change directly.
      // The first plan stays the person's (no focusPlan, no tool); the Host only
      // hands over request/followup rounds.
      const answerPlanTool = shape === 'secretary' && goal !== null && focusPlan !== null
        && (record.job.job.roundKind === 'request' || record.job.job.roundKind === 'followup')
        && decisionActionPolicy({ autonomy: goal.settings.autonomy, action: 'refine_future',
          actorClass: 'system', countedNext: null, cap: 0 }) === 'automatic';
      const finalNames = finalToolNamesOf({
        callKind: 'query',
        explorationRound,
        noteAdmission,
        // Preparation freezes only the names this Runtime knows; the start
        // checks the real selection and rejects an unknown name first.
        selected: projected.permissions.tools.filter(tool => RUNTIME_TOOL_NAMES.has(tool)),
        reviewPhase: null,
        hasBlockedCommands: false,
        reviewSource: false,
        frozenSource: builtinTools.includes('read'),
        materialTools: false,
        goalBound: goal !== null,
        // The frozen answer shape follows the request round's own execution
        // kind, never the Host grant or the Role ceiling.
        answerTools: shape,
        answerPlanTool,
        // Preparation freezes the CAPABILITY set; the actual owner wiring is
        // re-checked by the same function at start.
        // Query builds graph/read-only tools and secretary-admitted note tools.
        owners: {
          mailbox: true, decisionMessages: true, applicationReceipt: true,
          sessions: true, plans: true, graph: true, notes: true,
          unknownCallReviews: true, commandRerunRequests: true,
          architectureProposals: explorationRound,
        },
        readonlyCommand: {
          requested: readonlyRequested,
          access: configured.value.readonlyCommandAccess,
          allowsReadWholeWorkspace: readonlyAllowsWholeWorkspace,
        },
      });
      if (!finalNames.ok) return finalNames.rejection;
      const toolNames = finalNames.value;
      // The initial-planning guide belongs only to an initial coordination
      // Query: render it now with the frozen final tool list so its tool blocks
      // expand like every other template, then append it to the question. A
      // semantic Query never reads it, so an unused declaration stays unused.
      // A secretary round renders its own answer format in the input, so the
      // guide is never appended a second time there.
      const requestQuestion = record.job.job.intent.question;
      let question = requestQuestion;
      const appendGuide = (templateId: string, slots: Readonly<Record<string, string>>): CoreRejection | null => {
        if (tracked.texts.templates[templateId] === undefined) {
          return rejected('invalid', `the resolved prompt pack has no ${templateId} template`);
        }
        try {
          question = `${question}\n\n${renderTemplate(tracked.texts, templateId, slots, toolNames).text}`;
        } catch (error) {
          const renderProblem = promptRenderProblem(error, pack.manifest.packId);
          if (renderProblem !== null) return renderProblem;
          throw error;
        }
        return null;
      };
      if (shape === 'plan_round') {
        const guideProblem = appendGuide('initial-planning-answer', {});
        if (guideProblem !== null) return guideProblem;
      } else if (shape === 'plan_review') {
        // The review round's candidate identity comes only from the request
        // head; no body parser and no fallback to the adopted plan or a latest
        // candidate (spec §6.3.2).
        const head = systemRoundOfText(requestQuestion);
        if (head === null || head.kind !== 'planreview') {
          return rejected('invalid', 'the review request does not name a plan proposal');
        }
        const proposalRef = { aggregateType: 'PlanProposal' as const, projectId: queryRunRef.projectId,
          workspaceId: queryRunRef.workspaceId, proposalId: head.proposalId };
        let proposalRead;
        try {
          proposalRead = await deps.plans.readPlanProposal(owned, proposalRef);
        } catch (error) {
          return rejected('unavailable', `the review candidate read failed: ${messageOf(error)}`);
        }
        if (proposalRead.status !== 'ready') return proposalRead;
        const proposal = proposalRead.value;
        if (proposal.revision !== head.proposalRevision) {
          return rejected('not_found', 'the review candidate is not the requested revision');
        }
        if (focusPlan === null) return rejected('not_found', 'the review round has no adopted plan to compare against');
        const delta = deriveFuturePlanDelta(focusPlan, proposal.draft);
        if (delta.status !== 'supported') {
          return rejected('invalid', `the review candidate delta cannot be derived: ${delta.reason}`);
        }
        const changedIds = new Set([
          ...delta.delta.addedTaskIds, ...delta.delta.changedTaskIds,
          ...delta.delta.dispositionOnlyTaskIds,
        ]);
        const candidate = reviewCandidateText(focusPlan, proposal, changedIds, delta.delta);
        const guideProblem = appendGuide('plan-review-input', {
          goal: goal === null ? '' : goal.objective,
          plan: `${queryPlanSummary(focusPlan, tracked.texts)}\n${canonicalJson({
            stages: focusPlan.stages,
            tasks: focusPlan.tasks.map(task => ({
              taskId: task.taskId, title: task.title, scope: task.scope, disposition: task.disposition,
            })),
            obligations: focusPlan.obligations,
            executionDag: focusPlan.executionDag,
            inputRequirements: focusPlan.inputRequirements ?? [],
          } as unknown as JsonValue)}`,
          candidate,
          message: requestQuestion,
        });
        if (guideProblem !== null) return guideProblem;
      } else if (shape === 'exec_review') {
        // The packet header is the request body itself; the guide adds only the
        // three inputs, the read-only rule and the three form members (slice 9).
        const guideProblem = appendGuide('exec-review-input', {});
        if (guideProblem !== null) return guideProblem;
      } else if (shape === 'unknown_call_advice') {
        // The adviser reads the same record a person's "I'll handle it" reads
        // (`unknown-call-reviews/read`), as it is now. A record that moved after
        // the round was sent (the person took it over) is still prepared: the
        // answer names the frozen revision, so the Workflow no longer reads the
        // round and the owner answers `revision_conflict`. Refusing here would
        // leave the claimed Query holding the adviser line (`query-stage-driver.ts`
        // blocks on a preparation `not_found`).
        const subject = unknownCallAdviceSubjectOfText(requestQuestion);
        if (subject === null) return rejected('invalid', 'the adviser round names no record subject');
        if (deps.unknownCallReviews === undefined) {
          return rejected('unsupported', 'the adviser round requires the unknown-call review read');
        }
        let reviewRead;
        try { reviewRead = await deps.unknownCallReviews.readReview(owned, { ref: subject.reviewRef }); }
        catch (error) { return rejected('unavailable', `the adviser round record read failed: ${messageOf(error)}`); }
        if (reviewRead.status !== 'ready') return reviewRead;
        const guideProblem = appendGuide('unknown-call-advice-input',
          { record: canonicalJson(reviewRead.value as unknown as JsonValue) });
        if (guideProblem !== null) return guideProblem;
      } else if (!requestRound && execution.kind === 'initial_coordination') {
        const guideProblem = appendGuide('initial-planning-answer', {});
        if (guideProblem !== null) return guideProblem;
      }
      // A `planresume:` Query carries only the head and the original Query ref;
      // the original question and the per-card answers are assembled here from
      // the saved facts (spec §5.3.5 #8). No source is rebuilt and no second
      // scan is added.
      const resumeOriginal = execution.kind === 'intervention_planning'
        ? planResumeOriginalQueryOfText(requestQuestion) : null;
      if (resumeOriginal !== null) {
        if (deps.planningQuestions === undefined) {
          return rejected('unsupported', 'the planning question reader is not bound');
        }
        if (deps.decisionMessages === undefined) {
          return rejected('unsupported', 'the decision answer read is not bound');
        }
        if (goal === null) return rejected('invalid', 'no goal');
        // The original Query lives with the same Goal as this one, in this Query's workspace.
        const originalRefs = interventionPlanningQueryRefs(resumeOriginal, queryRunRef.workspaceId);
        const original = await deps.queryExecution.readQueryExecution(owned, originalRefs.queryRunRef);
        if (original.status !== 'ready') return original;
        const answerRef = original.value.job.job.answerRefs.at(-1);
        if (answerRef === undefined) return rejected('not_found', 'the original planning round has no answer');
        const answerRead = await deps.queryExecution.readQueryAnswer(owned, answerRef);
        if (answerRead.status !== 'ready') return answerRead;
        const parsed = parseInitialPlanningResponseV2(answerRead.value.answer.answer);
        if (parsed.status !== 'parsed' || parsed.response.kind !== 'needs_decision') {
          return rejected('not_found', 'the original planning answer carries no questions');
        }
        const questions = parsed.response.questions;
        const indexOfKey = new Map<string, number>();
        for (const [index] of questions.entries()) {
          indexOfKey.set(decisionSourceKey({ kind: 'planning_question', answerRef, questionIndex: index }), index);
        }
        const cards: { index: number; card: DecisionCardV1 }[] = [];
        let cursor: string | undefined;
        for (;;) {
          let page;
          try {
            page = await deps.planningQuestions.readPlanningQuestions(owned, {
              goalRef: goal.ref,
              page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
            });
          } catch (error) {
            return rejected('unavailable', `the planning question read failed: ${messageOf(error)}`);
          }
          if (page.status !== 'ready') return page;
          if (page.value.availability !== 'available') {
            return rejected('unsupported', 'the saved planning questions are not available');
          }
          for (const card of page.value.items) {
            if (card.source.kind !== 'planning_question') continue;
            const index = indexOfKey.get(card.source.key);
            if (index !== undefined) cards.push({ index, card });
          }
          if (page.value.nextCursor === null) break;
          cursor = page.value.nextCursor;
        }
        if (cards.length === 0) {
          return rejected('not_found', 'no saved planning question card matches the original answer');
        }
        cards.sort((left, right) => left.index - right.index);
        const saved: string[] = [];
        for (const { index, card } of cards) {
          const answerBody = await deps.decisionMessages.readDecisionAnswer(owned, { source: card.source });
          if (answerBody.status !== 'ready') return answerBody;
          if (answerBody.value.body === null) {
            return rejected('not_found', 'a saved planning answer body is missing');
          }
          saved.push(`Question ${String(index + 1)}: ${questions[index]}\nAnswer: ${answerBody.value.body.text}`);
        }
        question = `${question}\n\nOriginal planning question:\n${original.value.job.job.intent.question}\n\n${saved.join('\n\n')}`;
      }
      // §3.15 item 5: read the frozen consultation payload ONCE from the create
      // operation; a `platform_facts` copy never re-collects mode or facts.
      let consultationMode: ConsultationCreateV1['mode'] | null = null;
      let frozenFacts: ConsultationFactsV1 | null = null;
      if (execution.kind === 'semantic_query' && execution.consultation?.operation !== undefined) {
        let create;
        try {
          create = await consultationCreate.readConsultationCreate(owned, {
            operationRef: execution.consultation.operation,
          });
        } catch (error) {
          return rejected('unavailable', `the consultation create read failed: ${messageOf(error)}`);
        }
        if (create.status !== 'ready') return mapRead(create);
        consultationMode = create.value.mode;
        frozenFacts = create.value.mode === 'platform_facts' ? create.value.facts : null;
      }
      // Resolve every fact's body once: a `record` carries its frozen text, a
      // `body` is opened with the existing material port, and a `task` is the
      // definition of the frozen PlanRevision record's own task. No Goal, plan,
      // Run, history or inbox read happens here.
      let consultationFacts: Parameters<ContextAssembler['assembleQuery']>[1]['consultationFacts'];
      if (consultationMode === 'platform_facts') {
        const facts = frozenFacts!;
        const planTasks = new Map<string, RuntimeTask[]>();
        for (const fact of facts.facts) {
          if (fact.kind !== 'record' || fact.sourceRef.ref.aggregateType !== 'PlanRevision') continue;
          const frozenPlan = JSON.parse(fact.body) as PlanRevisionSnapshot;
          planTasks.set(canonicalJson(fact.sourceRef.ref as unknown as JsonValue), frozenPlan.tasks);
        }
        const resolved: ConsultationResolvedFactV1[] = [];
        for (const fact of facts.facts) {
          let body: string | null = null;
          if (fact.kind === 'record') {
            body = fact.body;
          } else if (fact.kind === 'body') {
            try {
              const opened = await deps.materials.openArtifact(owned, {
                ref: fact.ref, usage: 'historical_explanation',
              });
              body = opened.status === 'ready' ? opened.value.body : null;
            } catch {
              // A failed open leaves this one fact bodyless; the renderer prints its unreadable line.
              body = null;
            }
          } else if (fact.kind === 'task') {
            const task = planTasks.get(canonicalJson(fact.planRevision as unknown as JsonValue))
              ?.find(candidate => candidate.taskId === fact.taskId);
            body = task === undefined ? null : canonicalJson(task as unknown as JsonValue);
          }
          resolved.push({ fact, body });
        }
        consultationFacts = { facts, resolved };
      }
      // Ruling 14: the formal isolated derivation decides the Kernel session
      // basis; without one preparation passes the stored cursor's presence (C7).
      // A `platform_facts` copy takes no Session history, decided by the mode.
      const consultationDerivation = consultationMode === 'platform_facts' ? undefined
        : execution.kind === 'semantic_query' ? execution.consultation?.derivation : undefined;
      const sessionBasis = consultationDerivation === undefined ? undefined : {
        sourceKernelSessionId: consultationDerivation.sourceKernel.kernelSessionId,
        throughPosition: consultationDerivation.throughPosition,
      };
      let history: ContextQueryHistoryInputV1;
      if (consultationMode === 'platform_facts') {
        history = { callKind: 'query', hasCompletedCursor: false };
      } else if (sessionBasis !== undefined) {
        history = { callKind: 'query', sessionBasis };
      } else {
        history = { callKind: 'query', hasCompletedCursor: record.session.historyCursor !== null };
      }
      // H/SPLITUND: the successor's record 5 is offered to the line's first round of ANY kind. A request round
      // keeps its own secretary brief path; a QueryRun has no requeue. The read is the SAME port and readiness
      // rule Work uses.
      let record5: Pick<FrozenHandoffBriefV1, 'binding' | 'material'> | undefined;
      if (!requestRound && deps.handoffBriefs !== undefined) {
        const read = await deps.handoffBriefs.readForSuccessor(owned, {
          session: executionState.sessionRef, workspaceId: queryRunRef.workspaceId,
        });
        if (read.status !== 'ready') return read;
        if (read.value !== null) record5 = { binding: read.value.binding, material: read.value.material };
      }
      // Slice 3 C7 (§4.2/§4.3): the ONE assembler owns the Query text and its
      // binding. A non-ready assembler result is propagated unchanged; its
      // rejection (in particular a failing `graphContext` read) is passed back as-is.
      // A request round's facts were read once above and passed into assembly,
      // so the manifest is frozen from the SAME value the input rendered from.
      const assemblyInput: Parameters<ContextAssembler['assembleQuery']>[1] = {
        facts: facts.value,
        role: executionState.roleResolution,
        configuration: configured.value,
        permissions: projected.permissions,
        question,
        texts: tracked.texts, toolNames, history,
        ...(record5 === undefined ? {} : { record5 }),
        ...(secretaryFacts === null ? {} : { secretaryFacts }),
        ...(handoff === undefined ? {} : { handoff }),
        ...(consultationFacts === undefined ? {} : { consultationFacts }),
      };
      let assembled;
      try {
        assembled = await assembler.assembleQuery(owned, assemblyInput);
      } catch (error) {
        const renderProblem = promptRenderProblem(error, pack.manifest.packId);
        if (renderProblem !== null) return renderProblem;
        return rejected('unavailable', `the Query context assembly failed: ${messageOf(error)}`);
      }
      if (assembled.status !== 'ready') return assembled;
      const input = assembled.value.input;
      const contextAssembly = assembled.value.binding;
      const inputDigest = sha256Hex(input);
      const takesSessionHistory = assembled.value.takesSessionHistory;
      // Ruling 14 items 4-6: base + Host instruction, Skills from the same pack,
      // then the frozen texts and the set.
      let baseText: string;
      try {
        baseText = renderTemplate(tracked.texts, 'base', {}, toolNames).text;
      } catch (error) {
        const renderProblem = promptRenderProblem(error, pack.manifest.packId);
        if (renderProblem !== null) return renderProblem;
        throw error;
      }
      const mergedBase = baseText + (configured.value.systemInstruction ? '\n\n' + configured.value.systemInstruction : '');
      const selectedSkills = await selectPromptSkills(configured.value.skills, tracked.texts, {
        signal, ...(deps.kernel === undefined ? {} : { kernel: deps.kernel }), toolNames,
      });
      if (selectedSkills.status !== 'ready') return selectedSkills;
      if (signal.aborted) return rejected('cancelled', 'the Query preparation was cancelled while the Skills were selected');
      const usedTemplates = tracked.usedTemplates();
      const declarationProblem = promptDeclarationProblem(pack, usedTemplates, toolNames);
      if (declarationProblem !== null) return declarationProblem;
      const toolParts = toolNames.flatMap((name) => {
        const entry = pack.tools[name];
        if (entry === undefined) return [];
        const packId = pack.toolOrigins[name];
        if (packId === undefined) throw new Error(`the resolved prompt pack has no origin for tool ${name}`);
        return [{ name, packId, entry }];
      });
      const promptParts: PromptPartsV1 = {
        selection: { modelId: selection.modelId, provider: boundProvider, model: boundModel,
          packId: pack.manifest.packId, reasoningReplay: selection.reasoningReplay },
        sectionOrder: explorationRound
          ? { ...queryPreparedSectionOrder(tracked.texts),
            role_exploration: sectionOrderFor('role_exploration', 'query-planning-input', tracked.texts) }
          : queryPreparedSectionOrder(tracked.texts),
        templates: templatesToFreeze(usedTemplates).map(id => promptTemplatePart(pack, id)),
        strings: pack.strings,
        base: { templateId: 'base', version: promptTemplateVersion(pack, 'base'), text: mergedBase },
        skills: selectedSkills.value,
        toolNames: [...toolNames],
        tools: toolParts,
      };
      const storedPrompts = await storePromptTexts(deps.bodies, { kind: 'run', owner: queryRunRef }, promptParts, deps.now());
      if (storedPrompts.status !== 'ready') {
        return rejected('unavailable', `storing the Query prompt texts failed: ${storedPrompts.reason}`);
      }
      const manifest: PreparedQueryManifestV1 = {
        schemaVersion: 1,
        kind: 'query_execution',
        queryRunRef,
        sessionRef: executionState.sessionRef,
        sessionGeneration: executionState.sessionGeneration,
        roleBinding: binding.roleBinding,
        sessionRole: executionState.role,
        role: executionState.roleResolution,
        hostTemplate,
        hostConfigurationRevision: projected.configurationRevision,
        goal: goal === null ? null : { ref: goal.ref, revision: goal.revision },
        request: secretaryFacts === null ? null : {
          requestRoot: secretaryFacts.request.requestRoot,
          round: secretaryFacts.request.round,
          batch: secretaryFacts.request.batch,
          preparationCursor: secretaryFacts.request.preparationCursor,
          effectiveGoalId: secretaryFacts.request.effectiveGoalId,
          executionKind: secretaryFacts.executionKind,
          briefRef: secretaryFacts.request.briefRef,
          understandingGrants: secretaryFacts.request.understandingGrants,
        },
        answerShape: shape,
        workspace: { ref: workspace.ref, revision: workspaceRevision },
        focusPlan: focusPlan === null ? null : { ref: focusPlan.ref, revision: focusPlan.planRevision },
        permissions: projected.permissions,
        runtimeBudget: projected.budget,
        budget: { tokenBudget: binding.budget.maxTokens, deadline: binding.budget.deadline },
        sourceRefs,
        ...(assembled.value.handoffBrief == null ? {} : { handoffBrief: assembled.value.handoffBrief }),
        ...(sessionBasis === undefined ? {} : { sessionBasis }),
        contextAssembly,
        takesSessionHistory,
        promptSet: storedPrompts.value,
        input,
        inputDigest,
      };
      const manifestJson = JSON.stringify(manifest);
      if (Buffer.byteLength(manifestJson, 'utf8') > MAX_QUERY_MANIFEST_BYTES) {
        return rejected('capacity', `the bounded Query manifest exceeds ${String(MAX_QUERY_MANIFEST_BYTES)} bytes`);
      }
      let stored;
      try {
        stored = await deps.bodies.put({
          body: manifestJson,
          contentType: QUERY_MANIFEST_CONTENT_TYPE,
          sourceRefs,
          origin: { kind: 'run', owner: queryRunRef },
          requestedAt: deps.now(),
        });
      } catch (error) {
        return rejected('unavailable', `storing the Query manifest failed: ${messageOf(error)}`);
      }
      if (stored.status !== 'ready') {
        const code = stored.reason !== undefined && stored.reason.includes('size') ? 'capacity' : 'unavailable';
        return rejected(code, `storing the Query manifest failed: ${stored.reason}`);
      }
      const prepared: PreparedQueryExecution = {
        queryRunRef,
        bundleRef: stored.value.ref,
        inputDigest,
      };
      let bound;
      try {
        bound = await deps.queryExecution.bindPreparedQuery(owned, {
          input: { prepared },
          meta: {
            requestId: `r5b-query-bind:${requestId}`,
            expected: [
              { ref: queryRunRef, revision: record.run.revision },
              { ref: plainSessionRefToAggregate(executionState.sessionRef), revision: record.session.revision },
            ],
          },
        });
      } catch (error) {
        return rejected('unavailable', `binding the prepared Query manifest failed: ${messageOf(error)}`);
      }
      if (bound.status !== 'committed') return bound;
      return { status: 'ready', value: prepared };
    },
  };
}
