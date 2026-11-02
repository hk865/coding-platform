/**
 * PL's thin F0/F2/F4 composition. It adds only PL-specific inputs and steps and
 * reuses the existing real worlds:
 * - `openPLReviewWorld` opens the SE2 Host world with one extra reviewer
 *   binding/profile and the adviser binding/profile its adviser line matches,
 *   then creates the reviewer line.
 * - `openPlanOnlyWorld` adds the F0 plan_only world on that same Host with the
 *   adviser binding/profile, one consumer and the adviser line.
 * - `openPLOverlapWorld` opens S7C's overlap world, adds the adviser's Query
 *   profile, `read`/`record_note` grant and input consumer, and names its line.
 * The overlap gate/note read steps (`select`, `gatesOf`, `notesOnModule`,
 * `currentVersions`) live here once for PL-39 and PL-40.
 *
 * No consumer loop, Host, model or Query step is copied here.
 */
import { fileURLToPath } from 'node:url';
import type { WorkbenchQueryProfile, WorkbenchRuntimeBinding, WorkbenchRuntimeConfiguration } from '../../src/app/runtime-configuration.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { NoteVersionSnapshot } from '../../src/contracts/note.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import type { NoteItemV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { ModuleOverlapGateV1 } from '../../src/core/work-graph/persistence/module-overlap-gate-codecs.js';
import { AG2B_CONSUMER_ID, AG2B_RUNTIME_BUDGET, graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { draftFrom } from '../scenarios/support/common.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from './S6A-host-fixture.js';
import type { ScriptedReply } from './B2-runtime-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ABackend, type S6ASession } from './S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from './S6B1-fixture.js';
import {
  awaitPlanningAnswer, questionCards, readQueryAnswer,
} from './IV-host-fixture.js';
import { openS7C1World, type S7C1World } from './S7C-member-fixture.js';
import { sessionOf } from './S7A-fixture.js';

const REVIEWER = platformRoleProfile('reviewer');
const ADVISER = platformRoleProfile('adviser');
export const PL_REVIEWER_PROFILE_ID = 'pl-reviewer-profile';
export const PL_ADVISER_PROFILE_ID = 'pl-adviser-profile';
const PL_OVERLAP_MODULE = 's6a-core';
const CONTROLLED_SECRET_VAR = 'S6A_CONTROLLED_SECRET';

/**
 * The frozen A-01/A-02/A-03 candidate differences. The adopted Plan keeps the
 * old cancelled task (and its instruction) as the "do not re-copy it" control;
 * the candidate adds two tasks, changes one task's instruction, adds one
 * obligation/verification, and carries one edge of each of the three relation
 * kinds.
 */
export const PL_REVIEW_OLD_TASK_ID = 'pl-review-old';
export const PL_REVIEW_OLD_INSTRUCTION = 'PL review old cancelled instruction that must not be copied';
export const PL_REVIEW_CHANGED_TASK_ID = 'pl-review-work';
export const PL_REVIEW_CHANGED_INSTRUCTION = 'PL review changed instruction: review only this revision';
export const PL_REVIEW_NEW_TASK_A = 'pl-review-new-a';
export const PL_REVIEW_NEW_TASK_B = 'pl-review-new-b';
export const PL_REVIEW_NEW_INSTRUCTION_A = 'PL review new instruction A: read the adopted plan first';
export const PL_REVIEW_NEW_INSTRUCTION_B = 'PL review new instruction B: verify the new segment';
export const PL_REVIEW_NEW_OBLIGATION_ID = 'pl-review-new-obligation';
export const PL_REVIEW_NEW_CHECK_ID = 'pl-review-new-check';
export const PL_REVIEW_NEW_CHECK_TEXT = 'PL review checks the new segment';
export const PL_REVIEW_DEPENDS_ON = {
  taskId: PL_REVIEW_NEW_TASK_B, dependsOnId: PL_REVIEW_NEW_TASK_A,
  requires: { kind: 'artifact' as const, label: 'PL review A output' },
};
export const PL_REVIEW_TASK_RELATION = {
  fromTaskId: PL_REVIEW_NEW_TASK_A, toTaskId: PL_REVIEW_NEW_TASK_B,
  kind: 'coordination' as const, note: 'PL review coordination',
};
export const PL_REVIEW_INPUT_REQUIREMENT = {
  requirementId: 'pl-review-new-input', consumerTaskId: PL_REVIEW_NEW_TASK_B, kind: 'artifact' as const,
  artifactRef: {
    kind: 'artifact' as const, contentType: 'text/plain', digest: 'b'.repeat(64), sizeBytes: 1,
    source: { kind: 'workspace' as const, refId: S6A_SCOPE.workspaceId, revision: '1' },
  },
};
const REVIEWER_INSTRUCTION = 'PL reviewer guidance';
const ADVISER_INSTRUCTION = 'PL adviser guidance';
const S7C_ADVISER_BINDING_ID = 's7c-adviser-binding';

/**
 * Add the adviser Query profile and its `read`/`record_note` grant to S7C's
 * finished configuration. A separate binding cannot carry them: validation
 * refuses a second binding with the adviser Role in the same scope, and the
 * adviser binding is created inside S7C's own factory after `extraBindings`
 * are applied.
 */
function configureOverlapAdviser(configuration: WorkbenchRuntimeConfiguration): void {
  const binding = configuration.bindings.find(entry => entry.id === S7C_ADVISER_BINDING_ID);
  if (binding === undefined) throw new Error('PL: the S7C adviser binding is absent');
  binding.grant = { ...binding.grant, tools: [...new Set([...binding.grant.tools, 'read', 'record_note'])] };
  configuration.queryProfiles.push({
    id: 'pl-overlap-adviser-profile',
    label: 'PL overlap adviser',
    scope: S6A_SCOPE,
    runtimeBindingId: S7C_ADVISER_BINDING_ID,
    sessionRole: structuredClone(ADVISER.template),
    roleBinding: {
      schemaVersion: 1, bindingId: S7C_ADVISER_BINDING_ID, templateId: ADVISER.template.templateId,
      templateRevision: ADVISER.template.templateRevision, bindingVersion: 1,
      policyRevision: binding.configurationRevision,
    },
    runtimeBudget: structuredClone(AG2B_RUNTIME_BUDGET),
    budget: { maxTokens: null, deadline: null },
    consumerId: AG2B_CONSUMER_ID,
  });
}

/** One Host input consumer over the workspace; its session/goal ids are validation anchors, not a filter. */
export function consumerOf(queryProfileId: string, label: string) {
  return {
    scope: S6A_SCOPE,
    sessionRef: { projectId: S6A_SCOPE.projectId, sessionId: `${label}-consumer` },
    goalRef: { aggregateType: 'Goal' as const, projectId: S6A_SCOPE.projectId, goalId: `${label}-consumer` },
    queryProfileId,
    heartbeatMs: 25,
  };
}

export function reviewerBinding(): WorkbenchRuntimeBinding {
  const skillsRoot = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));
  return {
    id: 'pl-reviewer-binding',
    label: 'PL reviewer',
    scope: S6A_SCOPE,
    role: structuredClone(REVIEWER.template),
    configurationRevision: 'pl-reviewer-binding@1',
    model: { revision: 'pl-reviewer-model@1', provider: 'deepseek', model: 'pl-scripted-reviewer',
      secretEnvironmentVariable: CONTROLLED_SECRET_VAR },
    grant: {
      budget: structuredClone(AG2B_RUNTIME_BUDGET),
      hostTemplate: { templateId: REVIEWER.template.templateId, revision: REVIEWER.template.templateRevision,
        digest: sha256Hex(REVIEWER_INSTRUCTION) },
      tools: ['read'], writeScope: [], skills: { resourceRoot: skillsRoot, enabledIds: [] },
      systemInstruction: REVIEWER_INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
    },
  };
}

export function reviewerProfile(binding: WorkbenchRuntimeBinding): WorkbenchQueryProfile {
  return {
    id: PL_REVIEWER_PROFILE_ID,
    label: 'PL reviewer',
    scope: S6A_SCOPE,
    runtimeBindingId: binding.id,
    sessionRole: structuredClone(REVIEWER.template),
    roleBinding: {
      schemaVersion: 1, bindingId: binding.id, templateId: REVIEWER.template.templateId,
      templateRevision: REVIEWER.template.templateRevision, bindingVersion: 1,
      policyRevision: binding.configurationRevision,
    },
    runtimeBudget: structuredClone(AG2B_RUNTIME_BUDGET),
    budget: { maxTokens: null, deadline: null },
    consumerId: AG2B_CONSUMER_ID,
  };
}

/** The trusted adviser binding the F0/review worlds' platform-adviser lines run under. */
function adviserBinding(): WorkbenchRuntimeBinding {
  const skillsRoot = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));
  return {
    id: 'pl-adviser-binding',
    label: 'PL adviser',
    scope: S6A_SCOPE,
    role: structuredClone(ADVISER.template),
    configurationRevision: 'pl-adviser-binding@1',
    model: { revision: 'pl-adviser-model@1', provider: 'deepseek', model: 'pl-scripted-adviser',
      secretEnvironmentVariable: CONTROLLED_SECRET_VAR },
    grant: {
      budget: structuredClone(AG2B_RUNTIME_BUDGET),
      hostTemplate: { templateId: ADVISER.template.templateId, revision: ADVISER.template.templateRevision,
        digest: sha256Hex(ADVISER_INSTRUCTION) },
      tools: ['read', 'record_note'], writeScope: [], skills: { resourceRoot: skillsRoot, enabledIds: [] },
      systemInstruction: ADVISER_INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
    },
  };
}

function adviserProfile(binding: WorkbenchRuntimeBinding): WorkbenchQueryProfile {
  return {
    id: PL_ADVISER_PROFILE_ID,
    label: 'PL adviser',
    scope: S6A_SCOPE,
    runtimeBindingId: binding.id,
    sessionRole: structuredClone(ADVISER.template),
    roleBinding: {
      schemaVersion: 1, bindingId: binding.id, templateId: ADVISER.template.templateId,
      templateRevision: ADVISER.template.templateRevision, bindingVersion: 1,
      policyRevision: binding.configurationRevision,
    },
    runtimeBudget: structuredClone(AG2B_RUNTIME_BUDGET),
    budget: { maxTokens: null, deadline: null },
    consumerId: AG2B_CONSUMER_ID,
  };
}

export type PLReviewWorld = {
  readonly world: S6AHostWorld;
  readonly reviewer: S6ASession;
  /** Appends replies to the reviewer line's queue. */
  script(replies: readonly S6AReply[]): Promise<void>;
  /** Appends replies to the world's shared scripted model. */
  replies(replies: readonly ScriptedReply[]): Promise<void>;
  awaitPlanningAnswer: typeof awaitPlanningAnswer;
  questionCards: typeof questionCards;
  readQueryAnswer: typeof readQueryAnswer;
  close(): Promise<void>;
};

/** F2: the SE2 Host world plus the reviewer binding/profile and one reviewer line. */
export async function openPLReviewWorld(options: {
  backend?: S6ABackend;
  /** Default `with_secretary`; the review round needs no secretary profile. */
  configuration?: 'with_secretary' | 'no_secretary';
} = {}): Promise<PLReviewWorld> {
  const binding = reviewerBinding();
  const adviser = adviserBinding();
  const world = await openS6AHostWorld({
    backend: options.backend ?? 'memory',
    ...(options.configuration === undefined ? {} : { configuration: options.configuration }),
    extraBindings: [
      { binding, queryProfile: reviewerProfile(binding) },
      { binding: adviser, queryProfile: adviserProfile(adviser) },
    ],
    extraHostOptions: { inputConsumers: [consumerOf(PL_REVIEWER_PROFILE_ID, 'pl-reviewer')] },
  });
  try {
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const reviewer = await sessionOf(world, await createS6BLine(main, {
      label: 'pl-reviewer', role: REVIEWER.template,
    }));
    return {
      world,
      reviewer,
      script: (replies) => world.scripted.script(reviewer, replies),
      replies: async (replies) => world.scriptReplies(replies),
      awaitPlanningAnswer,
      questionCards,
      readQueryAnswer,
      close: () => world.close(),
    };
  } catch (error) {
    await world.close();
    throw error;
  }
}

export type PLReviewCandidateWorld = PLReviewWorld & {
  readonly main: S6ACardsWorkspace;
  readonly goal: GoalRef;
  /** The adopted first Plan the review compares against. */
  readonly plan: PlanRevisionSnapshot;
  /** The `candidate` proposal the review round reads. */
  readonly candidate: { readonly ref: PlanProposalRef; readonly revision: number };
  /** The adviser line a `planfix:` round addresses; `null` when the row does not need it. */
  readonly adviser: S6ASession | null;
};

/**
 * F2's review world plus the frozen A-01/A-02/A-03 preconditions, all through
 * public steps: governance, goal 1's adopted Plan, one `candidate` proposal and
 * (for A-02) one adviser line. PL P3-05 / ruling line 7: the review rows drive
 * the real Host; this only composes existing public steps.
 */
export async function openPLReviewCandidateWorld(options: {
  backend?: S6ABackend;
  adviser?: boolean;
} = {}): Promise<PLReviewCandidateWorld> {
  const opened = await openPLReviewWorld({
    ...(options.backend === undefined ? {} : { backend: options.backend }), configuration: 'no_secretary',
  });
  try {
    const main = s6aCardsWorkspace(opened.world, S6A_SCOPE);
    await governS6B(opened.world, main, opened.world.goals);
    const goal = opened.world.goals.first;
    const { plan } = await adoptS6BPlan(main, goal, {
      label: 'pl-review', role: S6A_WORK_ROLE.templateId, taskIds: [PL_REVIEW_CHANGED_TASK_ID],
    });
    // The adopted base keeps one old cancelled task with its own instruction:
    // the review input must list it as cancelled, never re-copy its taskbook.
    const baseDraft = draftFrom(plan, 'pl-review-base', draft => ({
      ...draft,
      tasks: [...draft.tasks, {
        taskId: PL_REVIEW_OLD_TASK_ID, title: 'PL review old cancelled task',
        requirementLevel: 'optional', taskKind: 'work', disposition: 'cancelled', phase: 'pending',
        scope: { kind: 'goal' },
      }],
      assignments: [...(draft.assignments ?? []), {
        taskId: PL_REVIEW_OLD_TASK_ID, role: S6A_WORK_ROLE.templateId, instruction: PL_REVIEW_OLD_INSTRUCTION,
      }],
    }));
    const baseProposed = await main.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: goal, basedOn: plan.ref, draft: baseDraft, reason: { text: 'PL review base', sources: [] },
    }, 'pl-review-base-propose')) as { status: string; value: { ref: unknown; revision: number } };
    if (baseProposed.status !== 'committed') throw new Error('PL: the review base Plan did not commit');
    const baseApplied = await main.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: baseProposed.value.ref, expectedProposalRevision: baseProposed.value.revision, decisionRefs: [],
    }, 'pl-review-base-apply')) as { status: string };
    if (baseApplied.status !== 'committed') throw new Error('PL: the review base Plan was not adopted');
    const basePlan = await main.activePlan(goal);
    if (basePlan === null) throw new Error('PL: the review base Plan is not readable');
    // `draftFrom` is the existing future-draft copier: the candidate differs
    // from the adopted Plan in tasks, obligations and all three relation kinds.
    const candidateDraft = draftFrom(basePlan, 'pl-review-candidate', draft => ({
      ...draft,
      tasks: [...draft.tasks,
        {
          taskId: PL_REVIEW_NEW_TASK_A, title: 'PL review new task A',
          requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
          scope: { kind: 'goal' }, executionIntent: 'request_execution',
          estimatedLines: 12, sizeClass: 'medium',
        },
        {
          taskId: PL_REVIEW_NEW_TASK_B, title: 'PL review new task B',
          requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
          scope: { kind: 'goal' }, executionIntent: 'request_execution',
          estimatedLines: 20, sizeClass: 'medium',
        }],
      assignments: [
        ...(draft.assignments ?? []).map(assignment => assignment.taskId === PL_REVIEW_CHANGED_TASK_ID
          ? { ...assignment, instruction: PL_REVIEW_CHANGED_INSTRUCTION } : assignment),
        { taskId: PL_REVIEW_NEW_TASK_A, role: S6A_WORK_ROLE.templateId, instruction: PL_REVIEW_NEW_INSTRUCTION_A },
        { taskId: PL_REVIEW_NEW_TASK_B, role: S6A_WORK_ROLE.templateId, instruction: PL_REVIEW_NEW_INSTRUCTION_B },
      ],
      obligations: [...draft.obligations, {
        obligationId: PL_REVIEW_NEW_OBLIGATION_ID, title: 'PL review new obligation',
        requirementLevel: 'required', taskIds: [PL_REVIEW_NEW_TASK_A, PL_REVIEW_NEW_TASK_B],
        verificationRequirements: [{
          requirementId: PL_REVIEW_NEW_CHECK_ID, requirementLevel: 'required', kind: 'test',
          description: PL_REVIEW_NEW_CHECK_TEXT,
        }],
      }],
      executionDag: { dependsOn: [...draft.executionDag.dependsOn, PL_REVIEW_DEPENDS_ON] },
      taskRelations: [...(draft.taskRelations ?? []), PL_REVIEW_TASK_RELATION],
      inputRequirements: [...(draft.inputRequirements ?? []), PL_REVIEW_INPUT_REQUIREMENT],
    }));
    const proposed = await main.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: goal, basedOn: basePlan.ref, draft: candidateDraft,
      reason: { text: 'PL review candidate', sources: [] },
    }, 'pl-review-candidate-propose')) as { status: string; value: { ref: PlanProposalRef; revision: number } };
    if (proposed.status !== 'committed') throw new Error('PL: the review candidate did not commit');
    const adviser = options.adviser === true
      ? await sessionOf(opened.world, await createS6BLine(main, { label: 'pl-adviser', role: ADVISER.template }))
      : null;
    return {
      ...opened,
      main,
      goal,
      plan,
      candidate: { ref: proposed.value.ref, revision: proposed.value.revision },
      adviser,
    };
  } catch (error) {
    await opened.close();
    throw error;
  }
}

export type PLPlanOnlyWorld = {
  readonly world: S6AHostWorld;
  readonly goal: GoalRef;
  readonly stageId: string;
  readonly taskId: string;
  readonly adviser: S6ASession;
  close(): Promise<void>;
};

/**
 * F0: one governed memory Host, the first Goal with an adopted Plan whose only
 * required work is a stage-scoped `plan_only` placeholder, one adviser line and
 * one Host input consumer (so the real consume passes can run). Every state is
 * a public step; this composes `openS6AHostWorld`, `governS6B`,
 * `s6aCardsWorkspace`, `plans/propose`, `plans/apply` and `sessions/create`.
 * The adviser binding/profile is the one the line's own Role matches.
 */
export async function openPlanOnlyWorld(
  label: string, options: { contextWindowTokens?: number } = {},
): Promise<PLPlanOnlyWorld> {
  const binding = adviserBinding();
  const profile = adviserProfile(binding);
  if (options.contextWindowTokens !== undefined) {
    binding.grant.budget = { ...binding.grant.budget, contextWindowTokens: options.contextWindowTokens };
    profile.runtimeBudget = { ...profile.runtimeBudget, contextWindowTokens: options.contextWindowTokens };
  }
  const world = await openS6AHostWorld({
    backend: 'memory',
    extraBindings: [{ binding, queryProfile: profile }],
    extraHostOptions: { inputConsumers: [consumerOf(PL_ADVISER_PROFILE_ID, label)] },
  });
  try {
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, main, world.goals);
    const goal = world.goals.first;
    const stageId = `${label}-next-segment`;
    const taskId = `${label}-placeholder`;
    const draft = {
      schemaVersion: 2, planId: `${label}-plan`, planRevision: 1, goalId: goal.goalId,
      stages: [{ stageId, title: 'Next segment' }],
      tasks: [{
        taskId, stageId, title: 'Next segment', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId }, executionIntent: 'plan_only',
      }],
      assignments: [], obligations: [], taskHierarchy: { parentOf: [] },
      executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
    };
    const proposed = await main.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: goal, basedOn: null, draft, reason: { text: `${label} plan`, sources: [] },
    }, `${label}-propose`)) as { status: string; value: { ref: unknown; revision: number } };
    if (proposed.status !== 'committed') throw new Error(`${label}: the plan proposal did not commit`);
    const applied = await main.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
    }, `${label}-apply`)) as { status: string };
    if (applied.status !== 'committed') throw new Error(`${label}: the plan was not adopted`);
    const adviser = await sessionOf(world, await createS6BLine(main, {
      label: `${label}-adviser`, role: ADVISER.template,
    }));
    return { world, goal, stageId, taskId, adviser, close: () => world.close() };
  } catch (error) {
    await world.close();
    throw error;
  }
}

export type PLOverlapWorld = {
  readonly world: S7C1World;
  readonly adviser: S6ASession;
  readonly script: S7C1World['world']['scripted']['script'];
  awaitPlanningAnswer: typeof awaitPlanningAnswer;
  questionCards: typeof questionCards;
  readQueryAnswer: typeof readQueryAnswer;
  close(): Promise<void>;
};

/**
 * F4: S7C's overlap world (`firstRun: 'deferred'`) plus PL's adviser Query profile,
 * its `read`/`record_note` grant and the one consumer that reaches the adviser line.
 * The profile rides the lead-approved `openS7C1World({ extraBindings })` seam; the
 * consumer rides `extraHostOptions` because a consumer is a Host start option, not
 * a binding. Nothing about the world, its plan or its steps is copied here.
 */
export async function openPLOverlapWorld(options: { backend?: S6ABackend;
  firstRun?: 'held' | 'deferred' } = {}): Promise<PLOverlapWorld> {
  const world = await openS7C1World({
    backend: options.backend ?? 'memory',
    firstRun: options.firstRun ?? 'deferred',
    configure: configureOverlapAdviser,
    extraHostOptions: { inputConsumers: [consumerOf('pl-overlap-adviser-profile', 'pl-overlap-adviser')] },
  });
  const adviser = world.lines.adviser;
  if (adviser === null) {
    await world.close();
    throw new Error('PL: the overlap world has no adviser line');
  }
  return {
    world,
    adviser,
    script: world.world.scripted.script,
    awaitPlanningAnswer,
    questionCards,
    readQueryAnswer,
    close: () => world.close(),
  };
}

export function select(target: PLOverlapWorld, flowId: string, taskId: string | null): WorkflowAdvanceInput {
  return {
    schemaVersion: 1, goalRef: target.world.goal, flowId, sessionHint: null, kind: 'select_work',
    ...(taskId === null ? {} : { taskId }),
  };
}

export async function gatesOf(target: PLOverlapWorld): Promise<ModuleOverlapGateV1[]> {
  const body = (await target.world.world.post('goals/overlap-gates', plain(S6A_SCOPE, {
    goalRef: target.world.goal, page: { limit: 10 },
  }))).body as { status: string; value?: { gates: ModuleOverlapGateV1[] } };
  if (body.status !== 'ready' || body.value === undefined) {
    throw new Error(`PL: the overlap gates are not readable: ${JSON.stringify(body)}`);
  }
  return body.value.gates;
}

export async function notesOnModule(target: PLOverlapWorld): Promise<NoteItemV1[]> {
  const body = (await target.world.world.post('notes/list', plain(S6A_SCOPE, {
    anchor: { kind: 'module', moduleId: PL_OVERLAP_MODULE }, limit: 100, cursor: null,
  }))).body as { status: string; value?: { items: NoteItemV1[] } };
  if (body.status !== 'ready' || body.value === undefined) {
    throw new Error(`PL: the module notes are not readable: ${JSON.stringify(body)}`);
  }
  return body.value.items;
}

export async function currentVersions(target: PLOverlapWorld): Promise<NoteVersionSnapshot[]> {
  const read = await target.world.world.platform.notes.listCurrentVersions(
    target.world.world.systemContext(), { anchor: { kind: 'module', moduleId: PL_OVERLAP_MODULE }, limit: 100, cursor: null });
  if (read.status !== 'ready') throw new Error(`PL: the current note versions are not readable: ${JSON.stringify(read)}`);
  return read.value.items;
}
