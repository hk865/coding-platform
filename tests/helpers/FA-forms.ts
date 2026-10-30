/**
 * The hand-written valid forms the submit tools receive, and the stored values
 * each one must produce (decision 97-3). Every value here is written by hand
 * from the ruling's form shapes; nothing is imported from `src`.
 *
 * The forms name modules and goals by their bare ids: the submit tool fills
 * every ref's `projectId` (and a GoalRef's `aggregateType`) from the trusted
 * QueryRun context.
 */
import type { S6AIdea } from './S6A-history-fixture.js';

/** A round as a request read lists it: the lookup needs only its query job id. */
type FARequestRound = { ref: { queryJobId: string } };

/** The round of `view` whose query job id is `round`'s (structural: no production type import). */
export function roundOf<T extends FARequestRound>(
  view: { rounds: readonly T[] }, round: { queryJobId: string },
): T {
  const found = view.rounds.find(entry => entry.ref.queryJobId === round.queryJobId);
  if (found === undefined) throw new Error(`FA: the request read lists no round ${round.queryJobId}`);
  return found;
}

/** The module id the S6A initial catalog declares (`s6aInitialCatalog`). */
const FA_MODULE_ID = 's6a-core';
/** An existing goal of the S6A world, named by its bare id. */
const FA_GOAL_ID = 's6a-goal-2';

/** The semantic form: a body, two ideas and one screened draft (goal-less round). */
export const FA_SEMANTIC_FORM = {
  body: 'FA semantic answer body',
  ideas: [
    { title: 'FA idea one', detail: 'FA detail of idea one' },
    { title: 'FA idea two', detail: 'FA detail of idea two' },
  ],
  goalCardDrafts: [{
    objective: 'FA draft objective',
    completion: ['FA completion one', 'FA completion two'],
    autonomy: 'every_step',
    screening: {
      modules: [FA_MODULE_ID],
      size: 'small',
      conflictsWith: [FA_GOAL_ID],
      dependsOn: [],
      urgency: 'normal',
      suggestedPosition: null,
      note: 'FA screening note',
    },
  }],
} as const;

/** One goal-card draft as the answer stores it: every ref platform-filled. */
type FAStoredDraft = {
  objective: string;
  completion: string[];
  autonomy: 'every_step' | 'after_plan_confirmation';
  screening: {
    modules: { projectId: string; moduleId: string }[];
    size: 'small' | 'medium' | 'large' | 'unknown';
    conflictsWith: { aggregateType: 'Goal'; projectId: string; goalId: string }[];
    dependsOn: { aggregateType: 'Goal'; projectId: string; goalId: string }[];
    urgency: 'high' | 'normal' | 'low';
    suggestedPosition: number | null;
    note: string;
  } | null;
};

/** The semantic form's expected stored values, with the platform-filled refs. */
export function faSemanticStored(projectId: string): {
  body: string;
  ideas: S6AIdea[];
  goalCardDrafts: FAStoredDraft[];
} {
  return {
    body: FA_SEMANTIC_FORM.body,
    ideas: FA_SEMANTIC_FORM.ideas.map(idea => ({ ...idea })),
    goalCardDrafts: [{
      objective: FA_SEMANTIC_FORM.goalCardDrafts[0].objective,
      completion: [...FA_SEMANTIC_FORM.goalCardDrafts[0].completion],
      autonomy: FA_SEMANTIC_FORM.goalCardDrafts[0].autonomy,
      screening: {
        modules: [{ projectId, moduleId: FA_MODULE_ID }],
        size: 'small',
        conflictsWith: [{ aggregateType: 'Goal', projectId, goalId: FA_GOAL_ID }],
        dependsOn: [],
        urgency: 'normal',
        suggestedPosition: null,
        note: 'FA screening note',
      },
    }],
  };
}


/** The initial-questions form: a summary and two non-empty questions (cold start). */
export const FA_INITIAL_QUESTIONS_FORM = {
  summary: 'FA questions summary',
  questions: ['FA question one', 'FA question two'],
} as const;

/** The initial-questions form's expected stored v2 envelope. */
export function faInitialQuestionsStored(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    kind: 'needs_decision',
    summary: FA_INITIAL_QUESTIONS_FORM.summary,
    questions: [...FA_INITIAL_QUESTIONS_FORM.questions],
  };
}

// ---------------------------------------------------------------------------
// FA-2 and FA-3: the composer's problems and the S6B3 adoption world
// ---------------------------------------------------------------------------

/** FA-2's one-problem draft: an empty objective and a module no catalog names. */
export const FA_BAD_SEMANTIC_FORM = {
  body: 'FA-2 body',
  ideas: [{ title: 'FA-2 idea', detail: 'FA-2 detail' }],
  goalCardDrafts: [{
    objective: '',
    completion: ['FA-2 completion'],
    autonomy: 'every_step',
    screening: {
      modules: ['fa2-no-such-module'], size: 'small', conflictsWith: [], dependsOn: [],
      urgency: 'normal', suggestedPosition: null, note: 'FA-2 screening',
    },
  }],
} as const;

/** The S6B3 second scope's one served role and the cold-start catalog module. */
export const FA_S6B3_SERVED_ROLE = 'local-workbench';
export const FA_S6B3_MODULE_ID = 'fa3-core';
export const FA_S6B3_UNSERVED_ROLE = 'fa3-unserved-role';

/** The S6B3 cold-start setup: one catalog module, a policy and no checks. */
const FA_S6B3_SETUP = {
  architecture: {
    baselineId: 'fa3-baseline',
    description: 'FA-3 architecture',
    constraints: [],
    catalog: {
      modules: [{
        moduleId: FA_S6B3_MODULE_ID, name: 'FA-3 core', responsibility: 'FA-3 core: the whole project',
        paths: ['src'], interfaces: [],
      }],
      dependencies: [],
    },
  },
  completionPolicy: { requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 },
  checks: [],
} as const;

/** One no-goal draft and its plan index: the cold-start plan belongs to draft 0. */
const FA_S6B3_DRAFTS = {
  goalCardDrafts: [{
    objective: 'FA-3 draft objective',
    completion: ['FA-3 completion'],
    autonomy: 'after_plan_confirmation',
    screening: null,
  }],
  planDraftIndex: 0,
} as const;

/** The first submit: a missing module, an unserved role, two tasks with one id and no Goal gate. */
export const FA_S6B3_BAD_FORM = {
  summary: 'FA-3 bad plan',
  plan: {
    stages: [{ stageId: 'fa3-stage', title: 'FA-3 stage' }],
    tasks: [
      {
        taskId: 'fa3-work', stageId: 'fa3-stage', title: 'FA-3 work', requirementLevel: 'required',
        taskKind: 'work', disposition: 'active',
        scope: { kind: 'module', stageId: 'fa3-stage', moduleRef: 'fa3-missing' },
      },
      {
        taskId: 'fa3-work', stageId: 'fa3-stage', title: 'FA-3 duplicate', requirementLevel: 'required',
        taskKind: 'work', disposition: 'active', scope: { kind: 'goal' },
      },
    ],
    assignments: [{ taskId: 'fa3-work', role: FA_S6B3_UNSERVED_ROLE, instruction: 'FA-3 instruction' }],
    obligations: [],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
  },
  setup: FA_S6B3_SETUP,
  ...FA_S6B3_DRAFTS,
} as const;

/** The fixed submit: the catalog module, the served role and a plan_only task adoption accepts. */
export const FA_S6B3_FIXED_FORM = {
  summary: 'FA-3 fixed plan',
  plan: {
    stages: [{ stageId: 'fa3-stage', title: 'FA-3 stage' }],
    tasks: [{
      taskId: 'fa3-work', stageId: 'fa3-stage', title: 'FA-3 work', requirementLevel: 'required',
      taskKind: 'work', disposition: 'active', executionIntent: 'plan_only',
      scope: { kind: 'module', stageId: 'fa3-stage', moduleRef: FA_S6B3_MODULE_ID },
    }],
    assignments: [{ taskId: 'fa3-work', role: FA_S6B3_SERVED_ROLE, instruction: 'FA-3 instruction' }],
    obligations: [],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
  },
  setup: FA_S6B3_SETUP,
  ...FA_S6B3_DRAFTS,
} as const;
