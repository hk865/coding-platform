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
import {
  MAX_ANSWER_BYTES,
  type GoalCardDraftV1, type GoalScreeningV1, type QueryAnswerShapeV1, type QueryJobAnswerV1, type QueryRunRef,
  type SecretaryRequestManifestV1,
} from '../../contracts/query-job.js';
import { PLANNED_FILES_MAX, type PlanRevisionDraft, type RuntimeTask, type TaskInputRequirementV2 } from '../../contracts/plan.js';
import { isLiteralSourceFilePath } from '../workspace/path-validation.js';
import { parseInitialPlanningResponseV2 } from '../../contracts/initial-planning-parse.js';
import {
  planReviewAnswerText, parsePlanReviewAnswer, type PlanReviewFormV1,
} from '../../contracts/plan-review.js';
import {
  execReviewAnswerText, parseExecReviewAnswer, type ExecReviewFormV1,
} from '../../contracts/exec-review.js';
import {
  parseUnknownCallAdviceAnswer, unknownCallAdviceAnswerText,
  UNKNOWN_CALL_ADVICE_CHOICES, UNKNOWN_CALL_ADVICE_ESCALATION_KINDS,
  type UnknownCallAdviceEscalationKindV1, type UnknownCallAdviceSubjectV1, type UnknownCallAdviceV1,
} from '../../contracts/unknown-call-advice.js';
import {
  commandReviewAnswerText, parseCommandReviewAnswer, COMMAND_REVIEW_CONCLUSIONS, type CommandReviewAnswerV1,
} from '../../contracts/scribe-review.js';
import {
  COMMAND_RERUN_ADVICE_CHOICES, commandRerunAdviceAnswerText, parseCommandRerunAdviceAnswer,
  type CommandRerunAdviceSubjectV1, type CommandRerunAdviceV1,
} from '../../contracts/command-rerun-advice.js';
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
import { PLANNING_MAX_ANSWER_BYTES } from './query-observation.js';

/** The submit tool names, in the order the answer shapes freeze them. */
export const ANSWER_TOOL_NAMES = [
  'submit_secretary_answer', 'submit_initial_plan', 'submit_initial_questions',
  'submit_plan_round', 'submit_plan_review', 'submit_exec_review', 'submit_unknown_call_advice',
  'submit_scribe_review',
  'submit_command_rerun_advice',
] as const;

export type AnswerToolName = (typeof ANSWER_TOOL_NAMES)[number];
/** The frozen `manifest.answerShape` is the answer-tool family (spec §5.2.7). */
export type AnswerToolKind = QueryAnswerShapeV1;

/** The submit names a frozen tool list holds, in their declared order. */
export function answerSubmitNamesIn(toolNames: readonly string[]): readonly AnswerToolName[] {
  const frozen = new Set(toolNames);
  return ANSWER_TOOL_NAMES.filter(name => frozen.has(name));
}

/** The submit names one answer shape builds, in the frozen `ANSWER_TOOL_NAMES` order. */
export function answerToolNamesOf(kind: AnswerToolKind | null, smallPlan = false): readonly AnswerToolName[] {
  if (kind === 'secretary') return smallPlan ? ['submit_secretary_answer', 'submit_plan_round'] : ['submit_secretary_answer'];
  if (kind === 'initial') return ['submit_initial_plan', 'submit_initial_questions'];
  if (kind === 'plan_round') return ['submit_plan_round'];
  if (kind === 'plan_review') return ['submit_plan_review'];
  if (kind === 'exec_review') return ['submit_exec_review'];
  if (kind === 'unknown_call_advice') return ['submit_unknown_call_advice'];
  if (kind === 'scribe_review') return ['submit_scribe_review'];
  if (kind === 'command_rerun_advice') return ['submit_command_rerun_advice'];
  return [];
}

/**
 * The answer bound by shape and submit name (spec §5.3.5 #5): only
 * `submit_plan_round` gets 256 KiB; every other tool answer is 16 KiB. Without
 * a name, a `plan_round` shape is the accepted planning answer.
 */
export function answerBoundBytes(shape: QueryAnswerShapeV1 | null, name?: string): number {
  return shape === 'plan_round' && (name === undefined || name === 'submit_plan_round')
    ? PLANNING_MAX_ANSWER_BYTES : MAX_ANSWER_BYTES;
}

/** 121-112: the planning submit of a secretary round answers in the planning shape; every other submit keeps the frozen one. */
export function submitShapeOf(frozen: QueryAnswerShapeV1, name: string): QueryAnswerShapeV1 {
  return name === 'submit_plan_round' ? 'plan_round' : frozen;
}

/** One form value the platform fills before writing the protocol text. */
export type AnswerTextContext = {
  projectId: string;
  /** The adviser round's frozen subject; only `unknown_call_advice` uses it. */
  subject?: UnknownCallAdviceSubjectV1;
  /** The rerun round's frozen subject; only `command_rerun_advice` uses it. */
  rerunSubject?: CommandRerunAdviceSubjectV1;
};

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
type PlanTaskForm = Omit<RuntimeTask, 'phase'>;
type PlanForm = Pick<PlanRevisionDraft,
  'stages' | 'assignments' | 'obligations' | 'taskHierarchy' | 'executionDag' | 'taskRelations'>
  & { tasks: PlanTaskForm[]; inputRequirements?: TaskInputRequirementV2[] };
export type InitialPlanForm = { summary: string; plan: PlanForm; setup: SetupForm;
  goalCardDrafts?: DraftForm[]; planDraftIndex?: number };
/** The planning round's one-tool form: exactly one of `plan`/`questions` per `answerKind`. */
export type PlanRoundForm = { answerKind: 'plan' | 'questions'; summary: string;
  plan?: PlanForm; questions?: string[]; reason?: { text: string; affectedTaskIds?: string[]; objective?: string } };
/** The unknown-outcome round's form: the phase and frozen subject are never the model's. */
export type UnknownCallAdviceForm = {
  choice: UnknownCallAdviceV1['choice'];
  escalationKind?: UnknownCallAdviceEscalationKindV1;
  rationale: string;
  plain: string;
};
/** The scribe's long-command review form (121-112); the command facts are the platform's. */
export type CommandReviewForm = {
  conclusion: CommandReviewAnswerV1['conclusion'];
  nextReviewInMs?: number;
  reason: string;
};
/** The rerun round's form (121-110): the request and its revision are never the model's. */
export type CommandRerunAdviceForm = Omit<UnknownCallAdviceForm, 'choice'> & { choice: CommandRerunAdviceV1['choice'] };
/** One submit form as the Kernel parsed it against the per-Run schema. */
export type AnswerForm = SemanticForm | QuestionsForm | InitialPlanForm | PlanRoundForm | PlanReviewFormV1
  | ExecReviewFormV1 | UnknownCallAdviceForm | CommandReviewForm | CommandRerunAdviceForm;

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
  shape: QueryAnswerShapeV1,
  form: Readonly<Record<string, unknown>>,
  ctx: AnswerTextContext,
): string {
  if (shape === 'secretary') {
    const answer = form as SemanticForm;
    return JSON.stringify({
      schemaVersion: 1,
      body: answer.body,
      ideas: answer.ideas,
      goalCardDrafts: (answer.goalCardDrafts ?? []).map(draft => filledDraft(ctx.projectId, draft)),
    });
  }
  if (shape === 'plan_review') return planReviewAnswerText(form as PlanReviewFormV1);
  if (shape === 'exec_review') return execReviewAnswerText(form as ExecReviewFormV1);
  if (shape === 'unknown_call_advice') {
    const advice = form as UnknownCallAdviceForm;
    return unknownCallAdviceAnswerText(ctx.subject!, {
      phase: ctx.subject!.phase, choice: advice.choice,
      escalationKind: advice.escalationKind ?? null, rationale: advice.rationale, plain: advice.plain,
    });
  }
  if (shape === 'scribe_review') {
    const review = form as CommandReviewForm;
    return commandReviewAnswerText({ conclusion: review.conclusion,
      nextReviewInMs: review.nextReviewInMs ?? null, reason: review.reason });
  }
  if (shape === 'command_rerun_advice') {
    const advice = form as CommandRerunAdviceForm;
    return commandRerunAdviceAnswerText(ctx.rerunSubject!, {
      choice: advice.choice, escalationKind: advice.escalationKind ?? null,
      rationale: advice.rationale, plain: advice.plain,
    });
  }
  if (shape === 'plan_round') {
    const round = form as PlanRoundForm;
    if (round.answerKind === 'questions') {
      return JSON.stringify({
        schemaVersion: 2, kind: 'needs_decision', summary: round.summary,
        questions: round.questions ?? [],
      });
    }
    return JSON.stringify({
      schemaVersion: 2, kind: 'plan', summary: round.summary,
      ...(round.plan === undefined ? {} : { plan: filledPlan(round.plan) }),
      ...(round.reason === undefined ? {} : { reason: round.reason }),
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
    sizeClass: z.enum(['small', 'medium', 'large', 'explore']).optional(),
    estimatedLines: z.number().int().min(1).optional(),
    replacedByTaskId: z.string().min(1).nullable().optional(),
  };
  const taskSchema = z.discriminatedUnion('taskKind', [
    z.object({
      ...commonTaskFields,
      taskKind: z.literal('work'),
      executionIntent: z.enum(['plan_only', 'request_execution']).optional(),
        // Decision 121-10: the planned files are a hint; one path rule with the plan codec.
        plannedFiles: z.array(z.string().refine(isLiteralSourceFilePath, 'Use a normalized workspace-relative file path'))
          .min(1).max(PLANNED_FILES_MAX)
          .refine((paths) => new Set(paths).size === paths.length, 'List each path once')
          .optional(),
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
    requiredReadPaths: z.array(z.string()).optional(),
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
  const artifactSourceSchema = z.object({
    kind: z.enum(['plan-revision', 'workspace', 'governance', 'artifact', 'memory']),
    refId: z.string().min(1), revision: z.string().min(1), digest: z.string().min(1).optional(),
  }).strict();
  const artifactRefSchema = z.object({
    kind: z.literal('artifact'), contentType: z.string().min(1), digest: z.string().min(1),
    sizeBytes: z.number().int().min(1), source: artifactSourceSchema,
  }).strict();
  const inputRequirementSchema = z.object({
    requirementId: z.string().min(1), consumerTaskId: z.string().min(1),
    kind: z.literal('artifact'), artifactRef: artifactRefSchema,
  }).strict();
  return z.object({
    stages: textField(z.array(stageSchema), texts, 'plan.stages'),
    tasks: textField(z.array(taskSchema), texts, 'plan.tasks'),
    assignments: textField(z.array(assignmentSchema).optional(), texts, 'plan.assignments'),
    obligations: textField(z.array(obligationSchema), texts, 'plan.obligations'),
    taskHierarchy: textField(hierarchySchema, texts, 'plan.taskHierarchy'),
    executionDag: textField(dagSchema, texts, 'plan.executionDag'),
    taskRelations: textField(z.array(relationSchema).optional(), texts, 'plan.taskRelations'),
    inputRequirements: textField(z.array(inputRequirementSchema).optional(), texts, 'plan.inputRequirements'),
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

function planRoundSchema(texts: ToolTextV1['parameters']): z.ZodType {
  return z.object({
    answerKind: textField(z.enum(['plan', 'questions']), texts, 'answerKind'),
    summary: textField(z.string(), texts, 'summary'),
    plan: textField(planSchema(texts).optional(), texts, 'plan'),
    questions: textField(z.array(z.string().min(1)).min(1).optional(), texts, 'questions'),
    reason: textField(z.object({
      text: z.string(), affectedTaskIds: z.array(z.string().min(1)).optional(),
      objective: z.string().optional(),
    }).strict().optional(), texts, 'reason'),
  }).strict();
}

function planReviewSchema(): z.ZodType {
  return z.object({
    verdict: z.enum(['pass', 'fix']),
    findings: z.array(z.object({
      taskId: z.string().nullable(), text: z.string(),
    }).strict()).optional(),
  }).strict();
}

/** The exec review form (slice 9): the verdict and two texts; the header members are never the model's. */
function execReviewSchema(texts: ToolTextV1['parameters']): z.ZodType {
  return z.object({
    verdict: textField(z.enum(['pass', 'fix']), texts, 'verdict'),
    basis: textField(z.string(), texts, 'basis'),
    report: textField(z.string(), texts, 'report'),
  }).strict();
}

/**
 * An adviser round's form: its choices, the escalation kind, a rationale and the person's sentence. The subject (the
 * unknown-outcome record and phase, or the rerun request and its revision) is the platform's and never appears here.
 * Which choices fit which unknown-outcome phase is the content check's (`unknownCallAdviceProblem`), so the
 * unknown-outcome form names the union of both phases' choices.
 */
function adviceSchema(texts: ToolTextV1['parameters'], choices: readonly string[]): z.ZodType {
  return z.object({
    choice: textField(z.enum(choices as [string, ...string[]]), texts, 'choice'),
    escalationKind: textField(z.enum(UNKNOWN_CALL_ADVICE_ESCALATION_KINDS).optional(), texts, 'escalationKind'),
    rationale: textField(z.string(), texts, 'rationale'),
    plain: textField(z.string(), texts, 'plain'),
  }).strict();
}

/** The scribe's review form: which of the three, when to look again (normal only) and one sentence. */
function commandReviewSchema(texts: ToolTextV1['parameters']): z.ZodType {
  return z.object({
    conclusion: textField(z.enum(COMMAND_REVIEW_CONCLUSIONS), texts, 'conclusion'),
    nextReviewInMs: textField(z.number().int().min(1).optional(), texts, 'nextReviewInMs'),
    reason: textField(z.string(), texts, 'reason'),
  }).strict();
}

function answerSchemaFor(name: AnswerToolName, goalLess: boolean, texts: ToolTextV1['parameters']): z.ZodType {
  switch (name) {
    case 'submit_secretary_answer': return semanticSchema(goalLess, texts);
    case 'submit_initial_plan': return initialPlanSchema(goalLess, texts);
    case 'submit_initial_questions': return questionsSchema(goalLess, texts);
    case 'submit_plan_round': return planRoundSchema(texts);
    case 'submit_plan_review': return planReviewSchema();
    case 'submit_exec_review': return execReviewSchema(texts);
    case 'submit_unknown_call_advice': return adviceSchema(texts, [...new Set([
      ...UNKNOWN_CALL_ADVICE_CHOICES.disposition, ...UNKNOWN_CALL_ADVICE_CHOICES.approval])]);
    case 'submit_scribe_review': return commandReviewSchema(texts);
    case 'submit_command_rerun_advice': return adviceSchema(texts, COMMAND_RERUN_ADVICE_CHOICES);
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
  shape: QueryAnswerShapeV1,
  form: AnswerForm,
  built: string,
  facts: SecretaryPreparationFactsV1 | null,
): AnswerProblem[] {
  // The planning round's one format gate is the v2 parser; it also enforces the
  // non-empty `needs_decision` questions and the plan body. The only extra rule
  // is the short summary the reply derives from.
  if (shape === 'plan_round') {
    const round = form as PlanRoundForm;
    const problems: AnswerProblem[] = [];
    if (round.answerKind === 'plan') {
      if (round.questions !== undefined) problems.push({ section: 'questions', reason: 'the plan answer must not carry questions' });
    } else {
      if (round.plan !== undefined) problems.push({ section: 'plan', reason: 'the questions answer must not carry a plan' });
    }
    const parsed = parseInitialPlanningResponseV2(built);
    if (parsed.status !== 'parsed') problems.push({ section: 'answer', reason: parsed.reason });
    if (round.summary.length === 0
      || Buffer.byteLength(round.summary, 'utf8') > 16 * 1024) {
      problems.push({ section: 'summary', reason: 'the plan summary must be non-empty and at most 16 KiB of UTF-8' });
    }
    return problems;
  }
  if (shape === 'plan_review') {
    const parsed = parsePlanReviewAnswer(built);
    if (parsed.status !== 'parsed') return [{ section: 'answer', reason: parsed.reason }];
    return [];
  }
  if (shape === 'exec_review') {
    const parsed = parseExecReviewAnswer(built);
    if (parsed.status !== 'parsed') return [{ section: 'answer', reason: parsed.reason }];
    return [];
  }
  if (shape === 'unknown_call_advice') {
    const parsed = parseUnknownCallAdviceAnswer(built);
    if (parsed.status !== 'parsed') return [{ section: 'answer', reason: parsed.reason }];
    return [];
  }
  if (shape === 'scribe_review') {
    const parsed = parseCommandReviewAnswer(built);
    if (parsed.status !== 'parsed') return [{ section: 'answer', reason: parsed.reason }];
    return [];
  }
  if (shape === 'command_rerun_advice') {
    const parsed = parseCommandRerunAdviceAnswer(built);
    if (parsed.status !== 'parsed') return [{ section: 'answer', reason: parsed.reason }];
    return [];
  }
  const requestFacts = facts as SecretaryPreparationFactsV1;
  const problems: AnswerProblem[] = [];
  const projectId = requestFacts.request.requestRoot.projectId;
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
  if (shape === 'initial' && 'plan' in form) {
    const initial = form as InitialPlanForm;
    const plan = initial.plan;
    if (requestFacts.request.effectiveGoalId === null) {
      if (drafts.length === 0) {
        problems.push({ section: 'goalCardDrafts',
          reason: 'a plan answer on a request without a goal must carry at least one goal card draft' });
      } else {
        const result = planDraftIndexOf({ ...initial, kind: 'plan' }, false, drafts.length);
        if (typeof result === 'string') problems.push({ section: 'planDraftIndex', reason: result });
      }
    }
    const setup = filledSetup(projectId, initial.setup);
    // The effective policy is the project's own; only a first install judges the answer's proposal.
    let policy: CompletionPolicyContentV1 | null = null;
    if (requestFacts.completionPolicy === null) {
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
    let catalog: AdoptedArchitecture | null = requestFacts.architecture?.catalog ?? null;
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
  if (shape === 'initial' && 'plan' in form) {
    const served = requestFacts.executionRoles;
    for (const role of new Set(unservedRoles((form as InitialPlanForm).plan.assignments, served))) {
      problems.push({ section: 'assignments', reason: `assignment role ${role} is not served `
        + `by this workspace (served: ${served.join(', ') || '(none)'})` });
    }
  }
  const catalogIds = requestFacts.architecture === null
    ? null : requestFacts.architecture.catalog.modules.map(module => module.ref.moduleId);
  const validModules = catalogIds === null ? null : catalogIds.join(', ') || '(none)';
  const goalIds = new Set(requestFacts.goals.map(goal => goal.goalId));
  const validGoals = requestFacts.goals.map(goal => goal.goalId).join(', ') || '(none)';
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
  /** The trusted Host context the start holds, used only for the request facts read. */
  hostContext: CoreCallContext;
  queryRunRef: QueryRunRef;
  /** The frozen `manifest.answerShape`; it selects the tools and their bounds. */
  shape: QueryAnswerShapeV1;
  /** The adviser round's frozen subject (read from the request's second line by the start). */
  subject?: UnknownCallAdviceSubjectV1;
  /** The rerun round's frozen subject (read from the request's second line by the start). */
  rerunSubject?: CommandRerunAdviceSubjectV1;
  /** The frozen `manifest.request.executionKind`; read only by the two request shapes. */
  kind?: SecretaryRequestManifestV1['executionKind'];
  /** `manifest.goal !== null`: the observer's own answer-format gate (request shapes). */
  hasGoal?: boolean;
  /** `manifest.request.effectiveGoalId === null`: the form carries drafts (request shapes). */
  goalLess?: boolean;
  /** `deps.secretaryFacts`: the same read preparation used, at submit time (request shapes only). */
  secretaryFacts?: SecretaryPreparationFactsPort;
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
): { name: string; arguments: Readonly<Record<string, unknown>> } | null {
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
    return { name: call.name, arguments: call.arguments };
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
    // 121-112: a secretary round's planning submit answers in the planning
    // shape while every other submit keeps the round's frozen shape.
    const shape = submitShapeOf(config.shape, call.name);
    const requestShape = shape === 'secretary' || shape === 'initial';
    // 1. Build the shape's protocol text and hold it to that shape's bound.
    const text = buildAnswerText(shape, call.arguments, {
      projectId: fixedProjectId,
      ...(config.subject === undefined ? {} : { subject: config.subject }),
      ...(config.rerunSubject === undefined ? {} : { rerunSubject: config.rerunSubject }),
    });
    const bound = answerBoundBytes(shape, call.name);
    if (Buffer.byteLength(text, 'utf8') > bound) {
      const kib = bound / 1024;
      return rejectedResult(callId, { status: 'rejected', code: 'capacity',
        reason: `the answer over the ${String(kib)} KiB answer bound; shorten the body or the plan` },
      `the form builds an answer over the ${String(kib)} KiB answer bound`);
    }
    // 2. Request shapes check against the same facts read preparation used; the
    // planning shapes never read project facts.
    let factsValue: SecretaryPreparationFactsV1 | null = null;
    if (requestShape) {
      if (config.secretaryFacts === undefined) {
        return rejectedResult(callId, { status: 'rejected', code: 'unavailable',
          reason: 'the secretary facts read is not bound' }, 'the request answer cannot be checked');
      }
      const facts = await config.secretaryFacts.read({ ...config.hostContext, signal },
        { queryRunRef: config.queryRunRef });
      if (facts.status !== 'ready') {
        return rejectedResult(callId, facts,
          'the current project facts could not be read; the answer was not checked');
      }
      factsValue = facts.value;
    }
    const problems = answerProblems(shape, call.arguments as unknown as AnswerForm, text, factsValue);
    if (problems.length > 0) {
      return rejectedResult(callId, { status: 'rejected', code: 'invalid', problems },
        'the answer has problems; fix every one and call the tool again in this round');
    }
    // 3. The observer's own gate, so acceptance implies the observer accepts.
    if (requestShape) {
      const parsed = parseSecretaryAnswer(text, { kind: config.kind!, hasGoal: config.hasGoal! });
      if (!parsed.ok) {
        return rejectedResult(callId, { status: 'rejected', code: 'invalid', reason: parsed.reason }, parsed.reason);
      }
    }
    // 4. Accepted: the barrier sees this callId and ends the round.
    accepted.add(callId);
    return success(callId, { status: 'accepted' });
  }

  function answerToolDefinitionOf(name: AnswerToolName): ToolDefinition {
    const text = config.texts[name]!;
    const schema = answerSchemaFor(name, config.goalLess === true, text.parameters);
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
