/**
 * The secretary round's form-filled answer (decision 97-3, FA). One submit tool
 * per answer shape; the model fills the form and the tool builds today's answer
 * protocol text from it, so the stored answer, its codec, its 16 KiB bound and
 * every later re-parse stay exactly as they are.
 *
 * The tool is write-free: the Kernel transcript is its only record, so there is
 * no command id, no idempotency and no `requestIdForCall`. It fills every fixed
 * member (versions, kind, the plan's pending phases, the catalog's `requireDag`
 * and every ref's trusted `projectId`/`aggregateType`) from the frozen manifest
 * and the trusted QueryRun context, never from the model.
 *
 * Schemas are built once per Run from the frozen manifest facts (the note tool's
 * precedent): plain JSON shapes, no transforms or defaults, strict objects and
 * discriminated unions only, because the Kernel flattens a root union and drops
 * a `minLength`. The schema must cover every member the content checks read.
 */
import { Buffer } from 'node:buffer';
import type {
  AdoptInitialArchitectureInput, AdoptedArchitecture, ModuleDefinition,
} from '../../contracts/architecture-catalog.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CompletionPolicyContentV1 } from '../../contracts/governance.js';
import type {
  GoalCardDraftV1, GoalScreeningV1, QueryJobAnswerV1, QueryRunRef, SecretaryRequestManifestV1,
} from '../../contracts/query-job.js';
import type { PlanRevisionDraft, RuntimeTask } from '../../contracts/plan.js';
import type { InitialPlanningSetupV2 } from '../../contracts/initial-planning.js';
import type { ToolTextV1 } from '../../contracts/prompts/prompt-pack.js';
import type {
  SecretaryPreparationFactsPort, SecretaryPreparationFactsV1,
} from '../work-graph/model/secretary-contracts.js';
import { ideasIssues } from '../work-graph/model/request-ideas.js';
import { goalCardDraftCheck, parseSecretaryAnswer, planDraftIndexOf } from '../work-graph/queries/secretary-answer.js';
import {
  unknownModuleTasksOf, validatePlanAssignments, validatePlanDraft,
} from '../work-graph/tasks/plan-validation.js';
import { unservedRoles } from '../work-graph/tasks/initialization-adoption-service.js';
import { completionPolicyContentProblem } from '../work-graph/configuration/project-bootstrap-record-codecs.js';
import { validateAdoptedArchitecture } from '../work-graph/architecture/catalog-record-codecs.js';
import { moduleRefOf } from '../work-graph/notes/note-anchors.js';
import { goalRefFor } from '../work-graph/persistence/commit-compiler.js';
import {
  toolSchema as z,
  type RunState,
  type ToolCall,
  type ToolDefinition,
  type ToolGroupBarrier,
  type ToolResult,
} from '../../../vendor/coding-agent/dist/public-api.js';
import { success, rejectedResult } from './graph-tools.js';
import type { ToolGroup } from './tool-group-assembly.js';
import { MAX_ANSWER_BYTES } from './query-observation.js';

/** The three submit tool names, in the order the initial kind freezes them. */
export const ANSWER_TOOL_NAMES = [
  'submit_secretary_answer', 'submit_initial_plan', 'submit_initial_questions',
] as const;

export type AnswerToolName = (typeof ANSWER_TOOL_NAMES)[number];
/** The answer kind the frozen manifest names: a semantic or an initial-coordination round. */
export type AnswerToolKind = 'secretary' | 'initial';

/** The submit names a frozen tool list holds, in their declared order. */
export function answerSubmitNamesIn(toolNames: readonly string[]): readonly AnswerToolName[] {
  const frozen = new Set(toolNames);
  return ANSWER_TOOL_NAMES.filter(name => frozen.has(name));
}

/** The answer-tool family a frozen execution kind selects. */
export function answerToolsOf(kind: SecretaryRequestManifestV1['executionKind']): AnswerToolKind {
  return kind === 'semantic_query' ? 'secretary' : 'initial';
}

/** One form value the platform fills before writing the protocol text. */
export type AnswerTextContext = { projectId: string };

/** One goal-card draft as the form carries it: bare module and goal ids only. */
type ScreeningForm = Omit<GoalScreeningV1, 'modules' | 'conflictsWith' | 'dependsOn'> & {
  modules: string[]; conflictsWith: string[]; dependsOn: string[] };
type DraftForm = Omit<GoalCardDraftV1, 'screening'> & { screening?: ScreeningForm | null };
type IdeaForm = QueryJobAnswerV1['ideas'][number];
export type SemanticForm = { body: string; ideas: IdeaForm[]; goalCardDrafts?: DraftForm[] };
export type QuestionsForm = { summary: string; questions: string[]; goalCardDrafts?: DraftForm[] };
type ModuleForm = Omit<ModuleDefinition, 'ref'> & { moduleId: string };
type CatalogForm = { modules: ModuleForm[]; dependencies: { from: string; to: string; reason: string }[];
  containment?: { parentOf: { parent: string; child: string }[] } };
type ArchitectureForm = Omit<AdoptInitialArchitectureInput, 'catalog'> & { catalog: CatalogForm };
type CompletionPolicyForm = Omit<CompletionPolicyContentV1, 'schemaVersion'>;
type SetupForm = Omit<InitialPlanningSetupV2, 'architecture' | 'completionPolicy'> & {
  architecture: ArchitectureForm; completionPolicy: CompletionPolicyForm };
type PlanTaskForm = Omit<RuntimeTask, 'phase' | 'replacedByTaskId'>;
type PlanForm = Pick<PlanRevisionDraft,
  'stages' | 'assignments' | 'obligations' | 'taskHierarchy' | 'executionDag' | 'taskRelations'>
  & { tasks: PlanTaskForm[] };
export type InitialPlanForm = { summary: string; plan: PlanForm; setup: SetupForm;
  goalCardDrafts?: DraftForm[]; planDraftIndex?: number };
/** One submit form as the Kernel parsed it against the per-Run schema. */
export type AnswerForm = SemanticForm | QuestionsForm | InitialPlanForm;

function filledScreening(projectId: string, screening: ScreeningForm | null | undefined): Record<string, unknown> | null {
  if (screening === null || screening === undefined) return null;
  return { ...screening,
    modules: screening.modules.map(moduleId => moduleRefOf(projectId, moduleId)),
    conflictsWith: screening.conflictsWith.map(goalId => goalRefFor(projectId, goalId)),
    dependsOn: screening.dependsOn.map(goalId => goalRefFor(projectId, goalId)) };
}

function filledDraft(projectId: string, draft: DraftForm): Record<string, unknown> {
  return { ...draft, screening: filledScreening(projectId, draft.screening) };
}

function filledPlan(plan: PlanForm): Record<string, unknown> {
  return { ...plan, schemaVersion: 2,
    // A new plan's tasks are always pending; the prompt already says so.
    tasks: plan.tasks.map(task => ({ ...task, phase: 'pending' as const })) };
}

/** The filled setup the builder writes and the composer checks: every ref already carries the trusted project. */
type FilledSetup = InitialPlanningSetupV2;

function filledSetup(projectId: string, setup: SetupForm): FilledSetup {
  const catalog = setup.architecture.catalog;
  return {
    architecture: {
      ...setup.architecture,
      catalog: {
        // Every module ref and dependency endpoint belongs to this trusted project.
        modules: catalog.modules.map(module => ({ ref: moduleRefOf(projectId, module.moduleId), name: module.name,
          responsibility: module.responsibility, paths: module.paths, interfaces: module.interfaces })),
        dependencies: catalog.dependencies.map(dependency => ({ ...dependency,
          from: moduleRefOf(projectId, dependency.from), to: moduleRefOf(projectId, dependency.to) })),
        requireDag: true as const,
        ...(catalog.containment === undefined ? {} : { containment: {
          parentOf: catalog.containment.parentOf.map(relation => ({ ...relation,
            parent: moduleRefOf(projectId, relation.parent), child: moduleRefOf(projectId, relation.child) })) } }),
      },
    },
    completionPolicy: { ...setup.completionPolicy, schemaVersion: 1 as const },
    checks: setup.checks,
  };
}

/**
 * The form plus the platform-filled fields give today's protocol text: the v1
 * secretary object (`semantic_query`) or the v2 initial-planning envelope
 * (`initial_coordination`). Pure; the handler and the observer call this ONE
 * builder, so acceptance and booking always agree. There is no key-order rule:
 * every consumer parses JSON.
 */
export function buildAnswerText(
  kind: SecretaryRequestManifestV1['executionKind'],
  form: Readonly<Record<string, unknown>>,
  ctx: AnswerTextContext,
): string {
  if (kind === 'semantic_query') {
    const answer = form as SemanticForm;
    return JSON.stringify({
      schemaVersion: 1,
      body: answer.body,
      ideas: answer.ideas,
      goalCardDrafts: (answer.goalCardDrafts ?? []).map(draft => filledDraft(ctx.projectId, draft)),
    });
  }
  const initial = form as InitialPlanForm | QuestionsForm;
  if ('plan' in initial) {
    return JSON.stringify({
      schemaVersion: 2,
      kind: 'plan',
      summary: initial.summary,
      plan: filledPlan(initial.plan),
      setup: filledSetup(ctx.projectId, initial.setup),
      ...(initial.goalCardDrafts === undefined && initial.planDraftIndex === undefined ? {} : {
        goalCardDrafts: (initial.goalCardDrafts ?? []).map(draft => filledDraft(ctx.projectId, draft)),
        planDraftIndex: initial.planDraftIndex,
      }),
    });
  }
  return JSON.stringify({
    schemaVersion: 2,
    kind: 'needs_decision',
    summary: initial.summary,
    questions: initial.questions,
    ...(initial.goalCardDrafts === undefined
      ? {} : { goalCardDrafts: initial.goalCardDrafts.map(draft => filledDraft(ctx.projectId, draft)) }),
  });
}

// --------------------------------------------------------------------------
// Strict per-Run form schemas. Built at start from the frozen manifest only:
// `goalCardDrafts` and `planDraftIndex` exist only on a goal-less request, and
// every other member is the model's. The platform fills versions, kind,
// `phase`, `requireDag` and every project-scoped ref.
// --------------------------------------------------------------------------

const AUTONOMIES = ['every_step', 'after_plan_confirmation'] as const;

function textField<T extends z.ZodType>(schema: T, texts: ToolTextV1['parameters'], path: string): T {
  const text = texts[path];
  return (text === undefined ? schema : schema.describe(text)) as T;
}

function ideaSchema(texts: ToolTextV1['parameters']): z.ZodType {
  return z.object({
    title: textField(z.string(), texts, 'ideas[].title'),
    detail: textField(z.string(), texts, 'ideas[].detail'),
  }).strict();
}

function screeningSchema(texts: ToolTextV1['parameters']): z.ZodType {
  return z.object({
    modules: textField(z.array(z.string().min(1)), texts, 'goalCardDrafts[].screening.modules'),
    size: textField(z.enum(['small', 'medium', 'large', 'unknown']), texts, 'goalCardDrafts[].screening.size'),
    conflictsWith: textField(z.array(z.string().min(1)), texts, 'goalCardDrafts[].screening.conflictsWith'),
    dependsOn: textField(z.array(z.string().min(1)), texts, 'goalCardDrafts[].screening.dependsOn'),
    urgency: textField(z.enum(['high', 'normal', 'low']), texts, 'goalCardDrafts[].screening.urgency'),
    suggestedPosition: textField(z.number().int().min(0).nullable(), texts, 'goalCardDrafts[].screening.suggestedPosition'),
    note: textField(z.string(), texts, 'goalCardDrafts[].screening.note'),
  }).strict();
}

function draftSchema(texts: ToolTextV1['parameters']): z.ZodType {
  return z.object({
    // Emptiness of the objective and the criteria is content (the per-draft check's),
    // so the schema keeps them strings and lets every content problem be collected.
    objective: textField(z.string(), texts, 'goalCardDrafts[].objective'),
    completion: textField(z.array(z.string()), texts, 'goalCardDrafts[].completion'),
    autonomy: textField(z.enum(AUTONOMIES), texts, 'goalCardDrafts[].autonomy'),
    screening: textField(screeningSchema(texts).nullable().optional(), texts, 'goalCardDrafts[].screening'),
  }).strict();
}

function semanticSchema(goalLess: boolean, texts: ToolTextV1['parameters']): z.ZodType {
  return z.object({
    body: textField(z.string().min(1), texts, 'body'),
    ideas: textField(z.array(ideaSchema(texts)), texts, 'ideas'),
    ...(goalLess ? { goalCardDrafts: textField(z.array(draftSchema(texts)).optional(), texts, 'goalCardDrafts') } : {}),
  }).strict();
}

function questionsSchema(goalLess: boolean, texts: ToolTextV1['parameters']): z.ZodType {
  return z.object({
    summary: textField(z.string(), texts, 'summary'),
    questions: textField(z.array(z.string().min(1)).min(1), texts, 'questions'),
    ...(goalLess ? { goalCardDrafts: textField(z.array(draftSchema(texts)).optional(), texts, 'goalCardDrafts') } : {}),
  }).strict();
}

function scopeSchema(): z.ZodType {
  return z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('goal') }).strict(),
    z.object({ kind: z.literal('stage'), stageId: z.string().min(1) }).strict(),
    z.object({ kind: z.literal('module'), stageId: z.string().min(1), moduleRef: z.string().min(1) }).strict(),
  ]);
}

function planSchema(texts: ToolTextV1['parameters']): z.ZodType {
  const commonTaskFields = {
    taskId: z.string().min(1),
    stageId: z.string().min(1).optional(),
    title: z.string().min(1),
    requirementLevel: z.enum(['required', 'optional']),
    disposition: z.enum(['active', 'deferred', 'cancelled', 'superseded']),
    scope: scopeSchema(),
  };
  const taskSchema = z.discriminatedUnion('taskKind', [
    z.object({
      ...commonTaskFields,
      taskKind: z.literal('work'),
      executionIntent: z.enum(['plan_only', 'request_execution']).optional(),
    }).strict(),
    z.object({
      ...commonTaskFields,
      taskKind: z.literal('gate'),
    }).strict(),
  ]);
  const stageSchema = z.object({
    stageId: z.string().min(1), title: z.string().min(1), description: z.string().optional(),
  }).strict();
  const requirementSchema = z.object({
    requirementId: z.string().min(1),
    requirementLevel: z.enum(['required', 'optional']),
    kind: z.string().min(1),
    description: z.string().min(1),
  }).strict();
  const obligationSchema = z.object({
    obligationId: z.string().min(1),
    title: z.string().min(1),
    requirementLevel: z.enum(['required', 'optional']),
    taskIds: z.array(z.string().min(1)),
    verificationRequirements: z.array(requirementSchema),
  }).strict();
  const assignmentSchema = z.object({
    taskId: z.string().min(1), role: z.string().min(1), instruction: z.string().min(1),
  }).strict();
  const hierarchySchema = z.object({
    parentOf: z.array(z.object({ parentTaskId: z.string().min(1), childTaskId: z.string().min(1) }).strict()),
  }).strict();
  const dagSchema = z.object({
    dependsOn: z.array(z.object({
      taskId: z.string().min(1),
      dependsOnId: z.string().min(1),
      requires: z.object({
        kind: z.enum(['output-contract', 'artifact', 'decision', 'environment-revision', 'gate-result']),
        label: z.string().min(1),
      }).strict(),
    }).strict()),
  }).strict();
  const relationSchema = z.object({
    fromTaskId: z.string().min(1), toTaskId: z.string().min(1),
    kind: z.enum(['coordination', 'expected_dependency']), note: z.string(),
  }).strict();
  return z.object({
    stages: textField(z.array(stageSchema), texts, 'plan.stages'),
    tasks: textField(z.array(taskSchema), texts, 'plan.tasks'),
    assignments: textField(z.array(assignmentSchema).optional(), texts, 'plan.assignments'),
    obligations: textField(z.array(obligationSchema), texts, 'plan.obligations'),
    taskHierarchy: textField(hierarchySchema, texts, 'plan.taskHierarchy'),
    executionDag: textField(dagSchema, texts, 'plan.executionDag'),
    taskRelations: textField(z.array(relationSchema).optional(), texts, 'plan.taskRelations'),
  }).strict();
}

function setupSchema(texts: ToolTextV1['parameters']): z.ZodType {
  const interfaceSchema = z.object({
    id: z.string().min(1), description: z.string().min(1), paths: z.array(z.string().min(1)),
  }).strict();
  const moduleSchema = z.object({
    moduleId: z.string().min(1),
    name: z.string().min(1),
    responsibility: z.string().min(1),
    paths: z.array(z.string().min(1)),
    interfaces: z.array(interfaceSchema),
  }).strict();
  const catalogSchema = z.object({
    modules: z.array(moduleSchema),
    dependencies: z.array(z.object({
      from: z.string().min(1), to: z.string().min(1), reason: z.string().min(1),
    }).strict()),
    containment: z.object({
      parentOf: z.array(z.object({ parent: z.string().min(1), child: z.string().min(1) }).strict()),
    }).strict().optional(),
  }).strict();
  const architectureSchema = z.object({
    baselineId: z.string().min(1),
    description: z.string(),
    constraints: z.array(z.object({ name: z.string().min(1), scope: z.string().min(1) }).strict()),
    catalog: catalogSchema,
  }).strict();
  const policySchema = z.object({
    requirementKinds: z.array(z.string().min(1)),
    minimumRequiredRequirementsPerObligation: z.number().int().min(1),
    fastPathDiffClasses: z.array(z.string().min(1)).optional(),
  }).strict();
  const checkSchema = z.object({
    checkId: z.string().min(1),
    kind: z.enum(['static', 'dynamic']),
    command: z.string().min(1),
    cwd: z.string(),
    timeoutMs: z.number().int().min(1),
    taskIds: z.union([z.literal('all'), z.array(z.string().min(1))]),
  }).strict();
  return z.object({
    architecture: textField(architectureSchema, texts, 'setup.architecture'),
    completionPolicy: textField(policySchema, texts, 'setup.completionPolicy'),
    checks: textField(z.array(checkSchema), texts, 'setup.checks'),
  }).strict();
}

function initialPlanSchema(goalLess: boolean, texts: ToolTextV1['parameters']): z.ZodType {
  return z.object({
    summary: textField(z.string(), texts, 'summary'),
    plan: textField(planSchema(texts), texts, 'plan'),
    setup: textField(setupSchema(texts), texts, 'setup'),
    ...(goalLess ? {
      goalCardDrafts: textField(z.array(draftSchema(texts)), texts, 'goalCardDrafts'),
      planDraftIndex: textField(z.number().int().min(0), texts, 'planDraftIndex'),
    } : {}),
  }).strict();
}

function answerSchemaFor(name: AnswerToolName, goalLess: boolean, texts: ToolTextV1['parameters']): z.ZodType {
  switch (name) {
    case 'submit_secretary_answer': return semanticSchema(goalLess, texts);
    case 'submit_initial_plan': return initialPlanSchema(goalLess, texts);
    case 'submit_initial_questions': return questionsSchema(goalLess, texts);
  }
}

// --------------------------------------------------------------------------
// Checks (the composer). The handler accepts only an empty list, so this
// signature is the one the checks plug into.
// --------------------------------------------------------------------------

/** One collected problem; the reason is the checker's own text, unchanged. */
export type AnswerProblem = { section: string; reason: string };

/** Every problem one answer has, in section order; empty means accepted. */
export function answerProblems(
  kind: SecretaryRequestManifestV1['executionKind'],
  form: AnswerForm,
  built: string,
  facts: SecretaryPreparationFactsV1,
): AnswerProblem[] {
  void built;
  const problems: AnswerProblem[] = [];
  const projectId = facts.request.requestRoot.projectId;
  const drafts = 'goalCardDrafts' in form ? form.goalCardDrafts ?? [] : [];

  // Layer 2: this answer alone, with adoption's own rules. Checks collect first;
  // the handler refuses only after every one of them has run.
  if ('ideas' in form) {
    for (const reason of ideasIssues(form.ideas, 'ideas')) problems.push({ section: 'ideas', reason });
  }
  for (const [index, draft] of drafts.entries()) {
    // The per-draft check judges the answer the form becomes, so every ref is filled first.
    const checked = goalCardDraftCheck(filledDraft(projectId, draft), index);
    if (typeof checked === 'string') problems.push({ section: 'goalCardDrafts', reason: checked });
  }
  if (kind === 'initial_coordination' && 'plan' in form) {
    const plan = form.plan;
    if (facts.request.effectiveGoalId === null) {
      if (drafts.length === 0) {
        problems.push({ section: 'goalCardDrafts',
          reason: 'a plan answer on a request without a goal must carry at least one goal card draft' });
      } else {
        const result = planDraftIndexOf({ ...form, kind: 'plan' }, false, drafts.length);
        if (typeof result === 'string') problems.push({ section: 'planDraftIndex', reason: result });
      }
    }
    const setup = filledSetup(projectId, form.setup);
    // The effective policy is the project's own; only a first install judges the answer's proposal.
    let policy: CompletionPolicyContentV1 | null = null;
    if (facts.completionPolicy === null) {
      const contentProblem = completionPolicyContentProblem(setup.completionPolicy);
      if (contentProblem === null) policy = setup.completionPolicy;
      else problems.push({ section: 'setup', reason: contentProblem });
    }
    for (const issue of validatePlanDraft(plan, policy)) {
      problems.push({ section: 'plan', reason: issue.message });
    }
    for (const reason of validatePlanAssignments(plan)) {
      problems.push({ section: 'assignments', reason });
    }
    let catalog: AdoptedArchitecture | null = facts.architecture?.catalog ?? null;
    if (catalog === null) {
      const adopted = validateAdoptedArchitecture(setup.architecture.catalog, projectId);
      if (adopted.status === 'ok') catalog = adopted.value;
      else problems.push({ section: 'setup', reason: adopted.reason });
    }
    if (catalog !== null) {
      const validModules = catalog.modules.map(module => module.ref.moduleId).join(', ') || '(none)';
      for (const unknown of unknownModuleTasksOf(plan, catalog)) {
        problems.push({ section: 'plan', reason: `task ${unknown.taskId} names module ${unknown.moduleId}, `
          + `which is not a module of the catalog (modules: ${validModules})` });
      }
    }
  }

  // Layer 3: against current state, with the same facts the round's preparation read.
  if (kind === 'initial_coordination' && 'plan' in form) {
    const served = facts.executionRoles;
    for (const role of new Set(unservedRoles(form.plan.assignments, served))) {
      problems.push({ section: 'assignments', reason: `assignment role ${role} is not served `
        + `by this workspace (served: ${served.join(', ') || '(none)'})` });
    }
  }
  const catalogIds = facts.architecture === null
    ? null : facts.architecture.catalog.modules.map(module => module.ref.moduleId);
  const validModules = catalogIds === null ? null : catalogIds.join(', ') || '(none)';
  const goalIds = new Set(facts.goals.map(goal => goal.goalId));
  const validGoals = facts.goals.map(goal => goal.goalId).join(', ') || '(none)';
  for (const draft of drafts) {
    const screening = draft.screening;
    if (screening === null || screening === undefined) continue;
    if (catalogIds !== null) {
      const known = new Set(catalogIds);
      for (const moduleId of screening.modules) {
        if (!known.has(moduleId)) {
          problems.push({ section: 'screening', reason: `goal card draft screening names module ${moduleId}, `
            + `which is not a module of the catalog (modules: ${String(validModules)})` });
        }
      }
    }
    for (const goalId of [...screening.conflictsWith, ...screening.dependsOn]) {
      if (!goalIds.has(goalId)) {
        problems.push({ section: 'screening', reason: `goal card draft screening names goal ${goalId}, `
          + `which does not exist (goals: ${validGoals})` });
      }
    }
  }
  return problems;
}

// --------------------------------------------------------------------------
// The factory
// --------------------------------------------------------------------------

export type AnswerToolsConfig = {
  /** The trusted `query_run` context; the project id is the fill source. */
  context: CoreCallContext;
  /** The trusted Host context the start holds, used only for the facts read. */
  hostContext: CoreCallContext;
  queryRunRef: QueryRunRef;
  /** The frozen `manifest.request.executionKind`. */
  kind: SecretaryRequestManifestV1['executionKind'];
  /** `manifest.goal !== null`: the observer's own answer-format gate. */
  hasGoal: boolean;
  /** `manifest.request.effectiveGoalId === null`: the form carries drafts. */
  goalLess: boolean;
  /** `deps.secretaryFacts`: the same read preparation used, at submit time. */
  secretaryFacts: SecretaryPreparationFactsPort;
  /** CallIds this round's handler accepted; the barrier yields on one of them. */
  acceptedCallIds: Set<string>;
  /** The submit names the frozen tool list selected. */
  names: readonly string[];
  /** The platform tools' model-facing texts. */
  texts: Readonly<Record<string, ToolTextV1>>;
};

export type AnswerToolsHandle = ToolGroup;

/**
 * The barrier that ends the round at the accepted submit. Each submit is its
 * own group (read-only, not independent), so the group's call is the submit
 * alone; the handler's result is already committed when `after_group` runs.
 */
export function createAnswerToolBarrier(acceptedCallIds: ReadonlySet<string>): ToolGroupBarrier {
  return async (invocation) => invocation.point === 'after_group'
    && invocation.callIds.some(callId => acceptedCallIds.has(callId))
    ? { kind: 'yield', reason: 'external_input_required' }
    : { kind: 'continue' };
}

/**
 * The arguments of the FIRST successful submit call, in transcript order: the
 * only accepted answer record. Names are matched against the assistant tool
 * call, as `projectSourceWitnesses` matches its sources.
 */
export function submittedAnswerArgumentsOf(
  state: Pick<RunState, 'transcript'>,
  names: readonly string[],
): Readonly<Record<string, unknown>> | null {
  const wanted = new Set(names);
  const declared = new Map<string, { name: string; arguments: Readonly<Record<string, unknown>> }>();
  for (const entry of state.transcript) {
    if (entry.kind === 'assistant_message') {
      for (const call of entry.toolCalls) declared.set(call.callId, { name: call.name, arguments: call.arguments });
      continue;
    }
    if (entry.kind !== 'tool_result') continue;
    if (entry.result.status !== 'success') continue;
    const call = declared.get(entry.callId)!;
    if (!wanted.has(call.name)) continue;
    return call.arguments;
  }
  return null;
}

export function createAnswerTools(config: AnswerToolsConfig): AnswerToolsHandle {
  const names = answerSubmitNamesIn(config.names);
  const fixedProjectId = config.context.projectId;
  const accepted = config.acceptedCallIds;

  async function executeSubmit(
    call: Readonly<ToolCall>, signal: AbortSignal,
  ): Promise<ToolResult> {
    const callId = call.callId;
    // 1. Build today's protocol text and hold it to the formal 16 KiB answer bound.
    const text = buildAnswerText(config.kind, call.arguments, { projectId: fixedProjectId });
    if (Buffer.byteLength(text, 'utf8') > MAX_ANSWER_BYTES) {
      return rejectedResult(callId, { status: 'rejected', code: 'capacity',
        reason: 'the answer over the 16 KiB answer bound; shorten the body or the plan' },
      'the form builds an answer over the 16 KiB answer bound');
    }
    // 2. The content checks against the same facts read the round's preparation used.
    const facts = await config.secretaryFacts.read({ ...config.hostContext, signal },
      { queryRunRef: config.queryRunRef });
    if (facts.status !== 'ready') {
      return rejectedResult(callId, facts,
        'the current project facts could not be read; the answer was not checked');
    }
    const problems = answerProblems(config.kind, call.arguments as unknown as AnswerForm, text, facts.value);
    if (problems.length > 0) {
      return rejectedResult(callId, { status: 'rejected', code: 'invalid', problems },
        'the answer has problems; fix every one and call the tool again in this round');
    }
    // 3. The observer's own gate, so acceptance implies the observer accepts.
    const parsed = parseSecretaryAnswer(text, { kind: config.kind, hasGoal: config.hasGoal });
    if (!parsed.ok) {
      return rejectedResult(callId, { status: 'rejected', code: 'invalid', reason: parsed.reason }, parsed.reason);
    }
    // 4. Accepted: the barrier sees this callId and ends the round.
    accepted.add(callId);
    return success(callId, { status: 'accepted' });
  }

  function answerToolDefinitionOf(name: AnswerToolName): ToolDefinition {
    const text = config.texts[name]!;
    const schema = answerSchemaFor(name, config.goalLess, text.parameters);
    return {
      name,
      description: text.description,
      inputSchema: schema,
      effectClass: 'read_only',
      // The Kernel's permission policy auto-allows a read-only extension only
      // when it declares exactly `workspace_read` (permission-policy.js:71-74);
      // an empty capability set is denied as an unknown operation.
      requiredCapabilities: ['workspace_read'],
      defaultTimeoutMs: 10000,
      outputLimitBytes: 64 * 1024,
      independentReadOnly: false,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return executeSubmit(call, options.signal);
        },
      },
    };
  }

  return { names, create: () => names.map(answerToolDefinitionOf) };
}
