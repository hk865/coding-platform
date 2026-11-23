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
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import { systemRoundRequestId, type SystemRoundV1 } from '../../src/contracts/plan-round.js';
import { systemRoundMessageRef } from './system-round-ref.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import type { NoteItemV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { ModuleOverlapGateV1 } from '../../src/core/work-graph/persistence/module-overlap-gate-codecs.js';
import { AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { draftFrom } from '../scenarios/support/common.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from './S6A-host-fixture.js';
import type { ScriptedReply } from './B2-runtime-fixture.js';
import {
  S6A_SCOPE, S6A_WORK_ROLE, S6A_WORK_ROLE_BINDING, type S6ABackend, type S6ASession,
} from './S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from './S6B1-fixture.js';
import {
  awaitPlanningAnswer, heartbeatUntil, proposalRefOf, questionCards, readQueryAnswer,
} from './IV-host-fixture.js';
import { advanceUntil } from './A2-restart-fixture.js';
import { openS7C1World, type S7C1World } from './S7C-member-fixture.js';
import { sessionOf } from './S7A-fixture.js';
import { assignGoalAdviserLine } from './S7C-handoff-fixture.js';

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

/** The `submit_plan_round` tool's plan body: the tool omits the record identity and the runtime `phase`. */
function reviewRoundPlanOf(draft: PlanRevisionDraft): Record<string, unknown> {
  return {
    stages: draft.stages,
    tasks: draft.tasks.map(task => {
      const { phase: _phase, ...rest } = task;
      return rest;
    }),
    ...(draft.assignments === undefined ? {} : { assignments: draft.assignments }),
    obligations: draft.obligations,
    taskHierarchy: draft.taskHierarchy,
    executionDag: draft.executionDag,
    ...(draft.taskRelations === undefined ? {} : { taskRelations: draft.taskRelations }),
    ...(draft.inputRequirements === undefined ? {} : { inputRequirements: draft.inputRequirements }),
  };
}

/**
 * Add the adviser Query profile and its `read`/`record_note` grant to S7C's
 * finished configuration. A separate binding cannot carry them: validation
 * refuses a second binding with the adviser Role in the same scope, and the
 * adviser binding is created inside S7C's own factory after `extraBindings`
 * are applied.
 */
function configureOverlapAdviser(configuration: WorkbenchRuntimeConfiguration,
  extraTools: readonly string[] = []): void {
  const binding = configuration.bindings.find(entry => entry.id === S7C_ADVISER_BINDING_ID);
  if (binding === undefined) throw new Error('PL: the S7C adviser binding is absent');
  binding.grant = { ...binding.grant,
    tools: [...new Set([...binding.grant.tools, 'read', 'record_note', ...extraTools])] };
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
  /** A-13 sourced candidates: also consume the adviser profile, so a real `refine:` round is served. */
  adviserConsumer?: boolean;
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
    extraHostOptions: { inputConsumers: [
      consumerOf(PL_REVIEWER_PROFILE_ID, 'pl-reviewer'),
      ...(options.adviserConsumer === true ? [consumerOf(PL_ADVISER_PROFILE_ID, 'pl-adviser')] : []),
    ] },
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
  /**
   * A-13 (`p2-frozen.md:208/210/345`): write the candidate through the adviser's real `refine:` round instead of a
   * direct `plans/propose` (whose missing author is now the A13 `source_incomplete` card). The base keeps
   * `PL_REVIEW_CHANGED_TASK_ID` as a `plan_only` placeholder and the candidate fills it, the lead-approved exemption;
   * the default path stays the frozen unsourced candidate.
   */
  sourced?: boolean;
  /** With `sourced`: the caller's draft instead of the frozen review-template candidate (e.g. plannedFiles). */
  draft?: (base: PlanRevisionSnapshot) => PlanRevisionDraft;
} = {}): Promise<PLReviewCandidateWorld> {
  const opened = await openPLReviewWorld({
    ...(options.backend === undefined ? {} : { backend: options.backend }), configuration: 'no_secretary',
    ...(options.sourced === true ? { adviserConsumer: true } : {}),
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
    // 新版本里新出现的任务不能一出生就是已取消（E08 的计划校验），所以旧任务先作为 active 进一版，下一版再取消它本身。
    const oldDraft = draftFrom(plan, 'pl-review-old', draft => ({
      ...draft,
      tasks: [...draft.tasks, {
        taskId: PL_REVIEW_OLD_TASK_ID, title: 'PL review old cancelled task',
        requirementLevel: 'optional', taskKind: 'work', disposition: 'active', phase: 'pending',
        scope: { kind: 'goal' },
      }],
      assignments: [...(draft.assignments ?? []), {
        taskId: PL_REVIEW_OLD_TASK_ID, role: S6A_WORK_ROLE.templateId, instruction: PL_REVIEW_OLD_INSTRUCTION,
      }],
    }));
    const oldProposed = await main.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: goal, basedOn: plan.ref, draft: oldDraft, reason: { text: 'PL review old task', sources: [] },
    }, 'pl-review-old-propose')) as { status: string; value: { ref: unknown; revision: number } };
    if (oldProposed.status !== 'committed') throw new Error('PL: the review old-task Plan did not commit');
    const oldApplied = await main.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: oldProposed.value.ref, expectedProposalRevision: oldProposed.value.revision, decisionRefs: [],
    }, 'pl-review-old-apply')) as { status: string };
    if (oldApplied.status !== 'committed') throw new Error('PL: the review old-task Plan was not adopted');
    const oldPlan = await main.activePlan(goal);
    if (oldPlan === null) throw new Error('PL: the review old-task Plan is not readable');
    const baseDraft = draftFrom(oldPlan, 'pl-review-base', draft => ({
      ...draft,
      tasks: draft.tasks.map(task => task.taskId === PL_REVIEW_OLD_TASK_ID
        ? { ...task, disposition: 'cancelled' as const }
        : options.sourced === true && task.taskId === PL_REVIEW_CHANGED_TASK_ID
          ? { ...task, executionIntent: 'plan_only' as const } : task),
    }));
    const baseProposed = await main.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: goal, basedOn: oldPlan.ref, draft: baseDraft, reason: { text: 'PL review base', sources: [] },
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
    const candidateDraft = options.draft === undefined ? draftFrom(basePlan, 'pl-review-candidate', draft => ({
      ...draft,
      tasks: [...draft.tasks.map(task => options.sourced === true && task.taskId === PL_REVIEW_CHANGED_TASK_ID
        ? { ...task, executionIntent: 'request_execution' as const } : task),
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
    })) : options.draft(basePlan);
    // 7D2 O4b-2: the review fix goes to the Goal's responsible adviser; T4a opens the line and lets the platform's
    // queue assignment write the Goal link and its claim (no `sessions/link` patch).
    const adviser = options.adviser === true || options.sourced === true
      ? await assignGoalAdviserLine(opened.world, { goal, label: 'pl-adviser', requestId: 'pl-adviser' })
      : null;
    let candidate: { readonly ref: PlanProposalRef; readonly revision: number };
    if (options.sourced === true) {
      if (adviser === null) throw new Error('PL: the sourced review candidate has no adviser line');
      candidate = await proposePLCandidateThroughRefine({ world: opened.world, goal, basePlan,
        draft: candidateDraft, adviser, target: { kind: 'task', taskId: PL_REVIEW_CHANGED_TASK_ID }, label: 'pl-review-refine' });
    } else {
      const proposed = await main.post('plans/propose', graphWrite(S6A_SCOPE, {
        goalRef: goal, basedOn: basePlan.ref, draft: candidateDraft,
        reason: { text: 'PL review candidate', sources: [] },
      }, 'pl-review-candidate-propose')) as { status: string; value: { ref: PlanProposalRef; revision: number } };
      if (proposed.status !== 'committed') throw new Error('PL: the review candidate did not commit');
      candidate = { ref: proposed.value.ref, revision: proposed.value.revision };
    }
    return {
      ...opened,
      main,
      goal,
      plan,
      candidate,
      adviser,
    };
  } catch (error) {
    await opened.close();
    throw error;
  }
}

/**
 * A-13 (`p2-frozen.md:208/210/345`): write one future candidate through the Goal's adviser line, answering the
 * Goal's real `refine:` round of `target` with `submit_plan_round`. The candidate's `sourceMessageRef` is that
 * round, so its author lineage is complete; a base `plan_only` target keeps the candidate inside the lead-approved
 * filling exemption. Public steps only (the Goal's own `workflow/advance` plus the Host's consume pass).
 */
export async function proposePLCandidateThroughRefine(input: {
  world: S6AHostWorld;
  goal: GoalRef;
  basePlan: PlanRevisionSnapshot;
  draft: PlanRevisionDraft;
  adviser: S6ASession;
  target: { kind: 'task'; taskId: string } | { kind: 'stage'; stageId: string };
  label: string;
}): Promise<{ readonly ref: PlanProposalRef; readonly revision: number }> {
  const { world, goal, basePlan, draft, adviser, target, label } = input;
  await world.scripted.script(adviser, [{ kind: 'calls', calls: [{
    callId: `${label}-submit`, name: 'submit_plan_round', args: {
      answerKind: 'plan', summary: label, plan: reviewRoundPlanOf(draft),
      reason: { text: label, affectedTaskIds: [] },
    } }] }]);
  const round: SystemRoundV1 = { kind: 'refine', goalRef: goal, target, planRevision: basePlan.planRevision };
  const requestId = systemRoundRequestId(round);
  if (requestId.status !== 'ready') throw new Error(`PL: the ${label} round has no request id`);
  const messageRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
  if (messageRef.status !== 'ready') throw new Error(`PL: the ${label} round has no message ref`);
  const next = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal,
    flowId: `${label}-send`, sessionHint: null, kind: 'select_work' }, 'send_system_round');
  const sent = await world.post('workflow/advance', plain(S6A_SCOPE, next));
  if ((sent.body as { status?: string }).status !== 'ready') {
    throw new Error(`PL: the ${label} send was not ready: ${JSON.stringify(sent.body)}`);
  }
  // The Host's close-out of the adviser's answer writes the candidate from M (`intervention:<key>:propose`).
  const written = await heartbeatUntil(world, async () => (await world.post('plans/proposal',
    plain(S6A_SCOPE, proposalRefOf(messageRef.value, goal)))).body as
    { status: string; value?: { ref: PlanProposalRef; revision: number } },
  read => read.status === 'ready', 16);
  if (written.status !== 'ready' || written.value === undefined) {
    throw new Error(`PL: the ${label} candidate was not written: ${JSON.stringify(written)}`);
  }
  return { ref: written.value.ref, revision: written.value.revision };
}

/**
 * A-13 (`p2-frozen.md:208/210/345`): write a candidate that names a real source message and its intervention request
 * root. The source is a person message to a fresh work line; its Query stays un-served (that line has no Host input
 * consumer), so a row's own `planfix:`/`planreview:` scripts are never eaten by it.
 */
export async function proposePLCandidateFromIntervention(input: {
  world: S6AHostWorld;
  goal: GoalRef;
  basedOn: PlanRevisionSnapshot['ref'];
  draft: PlanRevisionDraft;
  reason: { text: string; sources: readonly unknown[]; affectedTaskIds?: readonly string[] };
  label: string;
}): Promise<{ readonly ref: PlanProposalRef; readonly revision: number }> {
  const { world, goal, basedOn, draft, reason, label } = input;
  // A fresh work line has no Host input consumer: the source Query stays un-served, so it never eats replies the
  // row scripts for its own `planfix:`/`planreview:` rounds.
  const author = await createS6BLine(s6aCardsWorkspace(world, S6A_SCOPE), {
    label: `${label}-source-line`, role: S6A_WORK_ROLE,
  });
  const sent = await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: author.ref, text: `PL ${label} planning source`, entry: 'person_intervention' as const,
    needsReply: true, goalRef: goal,
  }, `${label}-source`));
  const sentBody = sent.body as { status?: string; value?: { ref: SessionMessageRef } };
  if (sentBody.status !== 'committed' || sentBody.value === undefined) {
    throw new Error(`PL: the ${label} source message was not sent: ${JSON.stringify(sentBody)}`);
  }
  const opened = await world.platform.workflow.handleIntervention!(world.humanContext(), {
    messageRef: sentBody.value.ref, roleBinding: S6A_WORK_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET,
    budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID,
  });
  if (opened.status === 'rejected') throw new Error(`PL: the ${label} source Query was refused: ${JSON.stringify(opened)}`);
  const proposed = await world.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn, draft, reason, sourceMessageRef: sentBody.value.ref,
    requestRef: interventionPlanningQueryRefs(sentBody.value.ref).queryJobRef,
  }, `${label}-propose`));
  const body = proposed.body as { status?: string; value?: { ref: PlanProposalRef; revision: number } };
  if (body.status !== 'committed' || body.value === undefined) {
    throw new Error(`PL: the ${label} candidate did not commit: ${JSON.stringify(body)}`);
  }
  return { ref: body.value.ref, revision: body.value.revision };
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
  label: string, options: { contextWindowTokens?: number; tools?: readonly string[] } = {},
): Promise<PLPlanOnlyWorld> {
  const binding = adviserBinding();
  if (options.tools !== undefined) {
    binding.grant = { ...binding.grant, tools: [...new Set([...binding.grant.tools, ...options.tools])] };
  }
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
    // 7D2 O4b-2: the refine round goes to the Goal's responsible adviser; T4a opens the line and lets the platform's
    // queue assignment write the Goal link and its claim (no `sessions/link` patch).
    const adviser = await assignGoalAdviserLine(world, {
      goal, label: `${label}-adviser`, requestId: `${label}-adviser`,
    });
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
 * a binding. Nothing about the world, its plan or its steps is copied here. `adviserTools` adds tool names to the
 * adviser's grant (a Host input, A8), e.g. the reply tool for a row whose busy adviser round may answer mail.
 */
export async function openPLOverlapWorld(options: { backend?: S6ABackend;
  firstRun?: 'held' | 'deferred'; adviserTools?: readonly string[] } = {}): Promise<PLOverlapWorld> {
  const world = await openS7C1World({
    backend: options.backend ?? 'memory',
    firstRun: options.firstRun ?? 'deferred',
    configure: configuration => configureOverlapAdviser(configuration, options.adviserTools),
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
