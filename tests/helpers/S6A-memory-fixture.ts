/**
 * The project's knowledge and governance on a request world (tests/helpers/S6A-request-fixture.ts), on the memory
 * or the SQLite backend: what a secretary round reads about the project, its goals and their memory.
 *
 * What it provides, and the public step behind each item:
 * - Notes, written by the human operator through `notes/write` over HTTP (the person-only route): the project
 *   understanding, two project norms (a convention and a decision, the kinds the read model shows as norms), a
 *   project pitfall (a project note that is not a norm), goal 1's understanding and two goal 1 notes (its note
 *   index), and goal 2's understanding (a secretary reads it through look/find). A user write is accepted and
 *   confirmed by the user, so every note is current. The fixture advances the world clock by one second before each
 *   write: the read model lists norms newest first (ties by note id), so the norms' display order is the reverse of
 *   `project.norms`.
 * - Goals: the world's two goals (created by its seed through `goals/create`) and any extra goal through
 *   `goals/create`; each goal's objective, desired state, revision and autonomy as `goals/settings` returns them.
 * - Governance, each optional so a test can make the four cases of the initialization branch (both pointers
 *   missing, architecture missing, policy missing, both present): the architecture through
 *   `architecture/adopt-initial`; the completion policy through `completion-policies/install` then
 *   `completion-policies/activate`. A later change of each pointer: a new architecture revision through the public
 *   owner `platform.architecture.reviseArchitectureCatalog` (no HTTP route publishes it) with the human operator's
 *   context, or the first adoption when none exists yet; another policy revision installed and activated. Each
 *   change reads the current pointer through `architecture/read` / `completion-policies/read` first, so it starts
 *   from what the platform holds, not from what this fixture remembers.
 * - The workspace id and revision as `workspaces/registration` returns them; every guard revision a write sends
 *   (project, workspace, the active policy pointer) is the value a public read or write returned just before.
 *
 * Every value it returns is what a public step returned or what the fixture submitted; nothing is read from the
 * store and no record is written by hand. A catalog adoption or revision starts the platform's automatic capture as
 * detached work: the seed waits for it through the world's `settleDetached` (the request fixture's delegating
 * wrapper around `platform.trackDetached`); a later change waits only when asked (`settle: true`), because a test may
 * call it while a Host gate holds other detached work.
 */
import type { CoreRejection, ReadResult } from '../../src/contracts/core/results.js';
import type { AdoptedArchitecture } from '../../src/contracts/architecture-catalog.js';
import type { GoalAutonomyV1, GoalSettingsV1 } from '../../src/contracts/goal-decisions.js';
import type {
  ArchitectureBaselineRevisionRef, CompletionPolicyContentV1, CompletionPolicyRevisionSnapshot,
  ProjectCompletionPolicyActiveSnapshot,
} from '../../src/contracts/governance.js';
import type {
  GoalDesiredState, GoalRef, GoalSnapshot, ProjectSnapshot, VersionedRef, WorkspaceSnapshot,
} from '../../src/contracts/ledger.js';
import type { NoteDraftAnchorV1, NoteDraftV1, NoteKind, NoteSectionsV1 } from '../../src/contracts/note.js';
import type { WriteNoteEnvelopeV1 } from '../../src/core/work-graph/model/note-contracts.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import type { S6ARequestWorld } from './S6A-request-fixture.js';

/** What the fixture needs of a request world (the S6A request world, or a world that wraps it). */
export type S6AMemoryWorld = Pick<S6ARequestWorld,
  'scope' | 'goals' | 'clock' | 'platform' | 'post' | 'humanContext' | 'settleDetached'>;

/** One note the fixture wrote: the ids `notes/write` returned and the draft it submitted. */
export type S6AWrittenNote = {
  noteId: string;
  version: number;
  kind: NoteKind;
  topic: string;
  conclusion: string;
  anchor: NoteDraftAnchorV1;
  structural: boolean;
  /** Understanding notes only; every other kind has `null`. */
  sections: NoteSectionsV1 | null;
  /** Every kind but understanding; understanding has `null`. */
  body: string | null;
  /** The `goalId` the write named. */
  goalId: string | null;
};

/** One goal as `goals/settings` returned it. */
export type S6AGoalFacts = {
  ref: GoalRef;
  goalId: string;
  objective: string;
  desiredState: GoalDesiredState;
  revision: number;
  autonomy: GoalAutonomyV1;
};

export type S6AGoalMemory = S6AGoalFacts & {
  understanding: S6AWrittenNote | null;
  /** The goal's note index, in the read model's order (one class, all user-confirmed: topic order). */
  notes: S6AWrittenNote[];
};

/** The active architecture as the adoption, revision or `architecture/read` returned it. */
export type S6AArchitecturePointer = {
  baselineId: string;
  /** The baseline content revision: 1 after the adoption, one more per revision. */
  revision: number;
  ref: ArchitectureBaselineRevisionRef;
  contentDigest: string;
  catalog: AdoptedArchitecture;
};

/** The active completion policy as the activation or `completion-policies/read` returned it. */
export type S6APolicyPointer = {
  policyId: string;
  /** The policy content revision the pointer names. */
  revision: number;
  contentDigest: string;
  /** The active pointer's own revision (1 on the first activation, one more per later one). */
  activeRevision: number;
};

export type S6AGovernanceCase = { name: string; architecture: boolean; policy: boolean };

/** The four cases of the initialization branch, in the order the spec names them. */
export const S6A_GOVERNANCE_CASES: readonly S6AGovernanceCase[] = [
  { name: 'both missing', architecture: false, policy: false },
  { name: 'architecture missing', architecture: false, policy: true },
  { name: 'policy missing', architecture: true, policy: false },
  { name: 'both present', architecture: true, policy: true },
];

export const S6A_BASELINE_ID = 's6a-baseline';
export const S6A_POLICY_ID = 's6a-policy';

/** The catalog the first adoption submits: two top-level modules of the world's project. */
export function s6aInitialCatalog(projectId: string): AdoptedArchitecture {
  return {
    requireDag: true,
    dependencies: [],
    modules: [
      { ref: { projectId, moduleId: 's6a-core' }, name: 'S6A core', responsibility: 'S6A core: the request records',
        paths: ['src'], interfaces: [] },
      { ref: { projectId, moduleId: 's6a-ui' }, name: 'S6A UI', responsibility: 'S6A UI: the main conversation',
        paths: ['src/ui'], interfaces: [] },
    ],
  };
}

/** The catalog a revision submits by default: every module kept, one more added (a revision may not remove one). */
export function s6aRevisedCatalog(previous: AdoptedArchitecture, revision: number): AdoptedArchitecture {
  const projectId = previous.modules[0]?.ref.projectId;
  if (projectId === undefined) throw new Error('S6A memory: the previous catalog has no module');
  return {
    ...structuredClone(previous),
    modules: [...structuredClone(previous.modules), {
      ref: { projectId, moduleId: `s6a-extra-${String(revision)}` }, name: `S6A extra ${String(revision)}`,
      responsibility: `S6A extra module of revision ${String(revision)}`, paths: [`src/extra-${String(revision)}`],
      interfaces: [],
    }],
  };
}

/** The policy content every install submits (the AG2b content). */
export const S6A_POLICY_CONTENT: CompletionPolicyContentV1 = {
  schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1,
};

export type S6AGovernance = {
  /** The last pointer this object adopted, revised or read (null: none known to be active). */
  readonly architecture: S6AArchitecturePointer | null;
  readonly policy: S6APolicyPointer | null;
  /** `architecture/read` and `completion-policies/read`; a missing pointer is null, any other refusal throws. */
  read(): Promise<{ architecture: S6AArchitecturePointer | null; policy: S6APolicyPointer | null }>;
  /** `architecture/adopt-initial` (refused by the platform when an architecture is already active). */
  adoptArchitecture(options?: { catalog?: AdoptedArchitecture; settle?: boolean }): Promise<S6AArchitecturePointer>;
  /** A new revision of the active architecture through the public owner (`s6aRevisedCatalog` by default). */
  reviseArchitecture(options?: { catalog?: AdoptedArchitecture; settle?: boolean }): Promise<S6AArchitecturePointer>;
  /**
   * `completion-policies/install` then `activate`. Default: `S6A_POLICY_ID` at the content revision after the active
   * one (1 when none is active).
   */
  activatePolicy(options?: { policyId?: string; contentRevision?: number; content?: CompletionPolicyContentV1 }):
  Promise<S6APolicyPointer>;
  /** The architecture pointer changes: a revision when one is active, else the first adoption. */
  changeArchitecture(options?: { settle?: boolean }): Promise<S6AArchitecturePointer>;
  /** The policy pointer changes: the active policy's next content revision installed and activated. */
  changePolicy(): Promise<S6APolicyPointer>;
};

export type S6AMemory = {
  workspace: { workspaceId: string; revision: number };
  /** Every goal the world and this fixture created, as `goals/settings` returned it, in creation order. */
  goals: S6AGoalFacts[];
  first: S6AGoalMemory;
  second: S6AGoalMemory;
  project: {
    understanding: S6AWrittenNote | null;
    /** Write order; the platform shows them newest first (the reverse). */
    norms: S6AWrittenNote[];
    /** Project notes that are not norms (never in a goal's note index, never in a no-goal round's notes). */
    notes: S6AWrittenNote[];
  };
  governance: S6AGovernance;
  /** `goals/settings` of one goal, now. */
  readGoal(goal: GoalRef): Promise<S6AGoalFacts>;
  /** `workspaces/registration`, now. */
  readWorkspace(): Promise<{ workspaceId: string; revision: number }>;
};

export type S6AMemoryOptions = {
  /** Adopt the initial architecture (`s6aInitialCatalog`) through `architecture/adopt-initial`. */
  architecture: boolean;
  /** Install and activate `S6A_POLICY_ID` revision 1. */
  policy: boolean;
  /** Write the notes (default true). */
  notes?: boolean;
  /** More goals through `goals/create`, after the world's two (e.g. a long or multi-line objective). */
  extraGoals?: readonly { goalId: string; objective: string }[];
};

/** The texts the notes carry. Topics of one goal's notes sort in write order, so the index order is write order. */
export const S6A_MEMORY_TEXTS = {
  projectUnderstanding: {
    topic: 's6a-project-understanding', conclusion: 'S6A project understanding',
    sections: { status: 'S6A project status', decided: 'S6A project decided', open: 'S6A project open',
      next: 'S6A project next', risks: 'S6A project risks' },
  },
  norms: [
    { kind: 'convention', topic: 's6a-norm-a', conclusion: 'S6A norm A: keep every request in the log', body: 'S6A norm A body' },
    { kind: 'decision', topic: 's6a-norm-b', conclusion: 'S6A norm B: answer in the person\'s language', body: 'S6A norm B body' },
  ],
  projectNotes: [
    { kind: 'pitfall', topic: 's6a-project-pitfall', conclusion: 'S6A project pitfall: the log is append-only', body: 'S6A project pitfall body' },
  ],
  firstGoalUnderstanding: {
    topic: 's6a-goal-1-understanding', conclusion: 'S6A goal one understanding',
    sections: { status: 'S6A goal one status', decided: 'S6A goal one decided', open: 'S6A goal one open',
      next: 'S6A goal one next', risks: 'S6A goal one risks' },
  },
  firstGoalNotes: [
    { kind: 'pitfall', topic: 's6a-goal-1-a-pitfall', conclusion: 'S6A goal one pitfall', body: 'S6A goal one pitfall body' },
    { kind: 'tradeoff', topic: 's6a-goal-1-b-tradeoff', conclusion: 'S6A goal one tradeoff', body: 'S6A goal one tradeoff body' },
  ],
  secondGoalUnderstanding: {
    topic: 's6a-goal-2-understanding', conclusion: 'S6A goal two understanding: the second goal marker',
    sections: { status: 'S6A goal two status', decided: 'S6A goal two decided', open: 'S6A goal two open',
      next: 'S6A goal two next', risks: 'S6A goal two risks' },
  },
} as const;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** One core route over HTTP as the world's human operator; a non-200 answer throws. */
async function route(world: S6AMemoryWorld, suffix: string, body: unknown, what: string): Promise<unknown> {
  const answer = await world.post(suffix, body);
  if (answer.httpStatus !== 200) throw new Error(`S6A memory: ${what} (${suffix}) answered ${answer.httpStatus}: ${JSON.stringify(answer.body)}`);
  return answer.body;
}

function committedValue<T>(body: unknown, what: string): T {
  if (asRecord(body)['status'] !== 'committed') throw new Error(`S6A memory: ${what} did not commit: ${JSON.stringify(body)}`);
  return asRecord(body)['value'] as T;
}

function readyValue<T>(body: unknown, what: string): T {
  const read = body as ReadResult<T>;
  if (read.status !== 'ready') throw new Error(`S6A memory: ${what} is not ready: ${JSON.stringify(body)}`);
  return read.value;
}

/**
 * A read whose `not_found` means "no such pointer"; every other refusal throws. The current-architecture read
 * answers a project with no active baseline as `{ status: 'not_found' }`, the policy read as a `not_found` rejection.
 */
function readyOrMissing<T>(body: unknown, what: string): T | null {
  const read = body as ReadResult<T>;
  if (read.status === 'ready') return read.value;
  if (asRecord(body)['status'] === 'not_found' || (read as CoreRejection).code === 'not_found') return null;
  throw new Error(`S6A memory: ${what} failed: ${JSON.stringify(body)}`);
}

/**
 * Seed the memory and the chosen governance on an open request world. Order: extra goals, architecture, policy,
 * notes (project understanding, norms, project pitfall, goal 1 understanding and notes, goal 2 understanding), then
 * the detached capture settles and the goals and the workspace are read back. Once per world: the request ids restart
 * with each call, so a second call replays (or conflicts with) the first one's writes.
 */
export async function seedS6AMemory(world: S6AMemoryWorld, options: S6AMemoryOptions): Promise<S6AMemory> {
  const scope = world.scope;
  const projectRef = { aggregateType: 'Project' as const, projectId: scope.projectId };
  const workspaceRef = { aggregateType: 'Workspace' as const, ...scope };
  const activePolicyRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: scope.projectId };
  let requestSeq = 0;
  const requestId = (label: string): string => `s6a-memory-${label}-${String(++requestSeq)}`;

  async function registration(): Promise<{ project: ProjectSnapshot; workspace: WorkspaceSnapshot }> {
    return readyValue(await route(world, 'workspaces/registration', plain(scope, { ...scope }), 'the registration read'),
      'the workspace registration');
  }
  async function scopePins(): Promise<VersionedRef[]> {
    const read = await registration();
    return [{ ref: projectRef, revision: read.project.revision }, { ref: workspaceRef, revision: read.workspace.revision }];
  }

  async function readGoal(goal: GoalRef): Promise<S6AGoalFacts> {
    const value = readyValue<{ goal: GoalSnapshot; settings: GoalSettingsV1 }>(await route(world, 'goals/settings',
      plain(scope, { goalRef: goal }), `the settings read of ${goal.goalId}`), `the goal ${goal.goalId}`);
    return { ref: structuredClone(value.goal.ref), goalId: value.goal.ref.goalId, objective: value.goal.objective,
      desiredState: value.goal.desiredState, revision: value.goal.revision, autonomy: value.settings.autonomy };
  }

  async function readWorkspace(): Promise<{ workspaceId: string; revision: number }> {
    const read = await registration();
    return { workspaceId: read.workspace.ref.workspaceId, revision: read.workspace.revision };
  }

  // ---- governance ----
  let architecture: S6AArchitecturePointer | null = null;
  let policy: S6APolicyPointer | null = null;

  const pointerOf = (value: { baseline: { baselineId: string; contentRevision: number; ref: ArchitectureBaselineRevisionRef;
    contentDigest: string }; catalog: { catalog: AdoptedArchitecture } }): S6AArchitecturePointer => ({
    baselineId: value.baseline.baselineId, revision: value.baseline.contentRevision,
    ref: structuredClone(value.baseline.ref), contentDigest: value.baseline.contentDigest,
    catalog: structuredClone(value.catalog.catalog),
  });

  async function readArchitecture(): Promise<S6AArchitecturePointer | null> {
    const value = readyOrMissing<Parameters<typeof pointerOf>[0]>(await route(world, 'architecture/read',
      plain(scope, { selection: { kind: 'current' } }), 'the architecture read'), 'the current architecture read');
    return value === null ? null : pointerOf(value);
  }

  async function readPolicy(): Promise<S6APolicyPointer | null> {
    const value = readyOrMissing<{ active: ProjectCompletionPolicyActiveSnapshot; policy: CompletionPolicyRevisionSnapshot }>(
      await route(world, 'completion-policies/read', plain(scope, { projectId: scope.projectId }), 'the policy read'),
      'the current policy read');
    return value === null ? null : { policyId: value.policy.policyId, revision: value.policy.contentRevision,
      contentDigest: value.policy.contentDigest, activeRevision: value.active.revision };
  }

  async function adoptArchitecture(adoptOptions: { catalog?: AdoptedArchitecture; settle?: boolean } = {}):
  Promise<S6AArchitecturePointer> {
    const catalog = adoptOptions.catalog ?? s6aInitialCatalog(scope.projectId);
    const value = committedValue<Parameters<typeof pointerOf>[0]>(await route(world, 'architecture/adopt-initial',
      graphWrite(scope, { baselineId: S6A_BASELINE_ID, description: 'S6A initial architecture', constraints: [], catalog },
        requestId('architecture-adopt'), await scopePins()), 'the adoption'), 'the architecture adoption');
    architecture = pointerOf(value);
    if (adoptOptions.settle === true) await world.settleDetached();
    return structuredClone(architecture);
  }

  async function reviseArchitecture(reviseOptions: { catalog?: AdoptedArchitecture; settle?: boolean } = {}):
  Promise<S6AArchitecturePointer> {
    const current = await readArchitecture();
    if (current === null) throw new Error('S6A memory: no active architecture to revise');
    const catalog = reviseOptions.catalog ?? s6aRevisedCatalog(current.catalog, current.revision + 1);
    // No HTTP route publishes the revision; the public owner runs with the human operator's trusted context.
    const revised = await world.platform.architecture.reviseArchitectureCatalog(world.humanContext(), {
      meta: { requestId: requestId('architecture-revise'), expected: await scopePins() },
      input: { basedOn: { ref: current.ref, digest: current.contentDigest }, catalog,
        reason: `S6A revision ${String(current.revision + 1)}` },
    });
    architecture = pointerOf(committedValue(revised, 'the architecture revision'));
    if (reviseOptions.settle === true) await world.settleDetached();
    return structuredClone(architecture);
  }

  async function activatePolicy(policyOptions: { policyId?: string; contentRevision?: number;
    content?: CompletionPolicyContentV1 } = {}): Promise<S6APolicyPointer> {
    const current = await readPolicy();
    const policyId = policyOptions.policyId ?? S6A_POLICY_ID;
    const contentRevision = policyOptions.contentRevision
      ?? (current !== null && current.policyId === policyId ? current.revision + 1 : 1);
    const project = (await registration()).project;
    const installed = committedValue<CompletionPolicyRevisionSnapshot>(await route(world, 'completion-policies/install',
      graphWrite(scope, { policyId, contentRevision, content: policyOptions.content ?? S6A_POLICY_CONTENT },
        requestId('policy-install'), [{ ref: projectRef, revision: project.revision }, {
          ref: { aggregateType: 'CompletionPolicyRevision', projectId: scope.projectId, policyId, revision: contentRevision },
          revision: 0 }]), 'the policy install'), 'the policy install');
    const active = committedValue<ProjectCompletionPolicyActiveSnapshot>(await route(world, 'completion-policies/activate',
      graphWrite(scope, { target: { ref: installed.ref, digest: installed.contentDigest } }, requestId('policy-activate'), [
        { ref: projectRef, revision: (await registration()).project.revision },
        { ref: activePolicyRef, revision: current === null ? 0 : current.activeRevision }]), 'the policy activation'),
    'the policy activation');
    policy = { policyId: installed.policyId, revision: installed.contentRevision, contentDigest: installed.contentDigest,
      activeRevision: active.revision };
    return { ...policy };
  }

  const governance: S6AGovernance = {
    get architecture() { return architecture === null ? null : structuredClone(architecture); },
    get policy() { return policy === null ? null : { ...policy }; },
    async read() {
      architecture = await readArchitecture();
      policy = await readPolicy();
      return { architecture: governance.architecture, policy: governance.policy };
    },
    adoptArchitecture,
    reviseArchitecture,
    activatePolicy,
    async changeArchitecture(changeOptions = {}) {
      const current = await readArchitecture();
      return current === null
        ? adoptArchitecture({ ...(changeOptions.settle === undefined ? {} : { settle: changeOptions.settle }) })
        : reviseArchitecture({ ...(changeOptions.settle === undefined ? {} : { settle: changeOptions.settle }) });
    },
    async changePolicy() {
      const current = await readPolicy();
      return activatePolicy(current === null ? {} : { policyId: current.policyId });
    },
  };

  // ---- goals ----
  const created: GoalRef[] = [world.goals.first, world.goals.second];
  for (const extra of options.extraGoals ?? []) {
    committedValue(await route(world, 'goals/create', graphWrite(scope, { goalId: extra.goalId, workspace: { ...scope },
      objective: extra.objective }, requestId(`goal-${extra.goalId}`), await scopePins()), `the goal ${extra.goalId}`),
    `the goal ${extra.goalId}`);
    created.push({ aggregateType: 'Goal', projectId: scope.projectId, goalId: extra.goalId });
  }

  if (options.architecture) await adoptArchitecture();
  if (options.policy) await activatePolicy();

  // ---- notes ----
  async function writeNote(draft: NoteDraftV1, goalId: string | null): Promise<S6AWrittenNote> {
    world.clock.advance(1000);
    const envelope = await route(world, 'notes/write', plain(scope, {
      commandId: requestId(`note-${draft.topic}`), note: draft, expectedPointerRevision: null, goalId,
    }), `the note ${draft.topic}`) as WriteNoteEnvelopeV1;
    const write = envelope.write;
    if (write.status !== 'accepted') throw new Error(`S6A memory: the note ${draft.topic} was not accepted: ${JSON.stringify(envelope)}`);
    return { noteId: write.noteId, version: write.version, kind: draft.kind, topic: draft.topic, conclusion: draft.conclusion,
      anchor: structuredClone(draft.anchor), structural: draft.structural,
      sections: draft.kind === 'understanding' ? { ...draft.sections } : null,
      body: draft.kind === 'understanding' ? null : draft.body, goalId };
  }
  const common = { extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [],
    coexistWith: [] };
  const understanding = (anchor: NoteDraftAnchorV1, text: { topic: string; conclusion: string; sections: NoteSectionsV1 }):
  NoteDraftV1 => ({ ...common, kind: 'understanding', topic: text.topic, conclusion: text.conclusion, anchor,
    sections: { ...text.sections } });
  const general = (anchor: NoteDraftAnchorV1, text: { kind: string; topic: string; conclusion: string; body: string }):
  NoteDraftV1 => ({ ...common, kind: text.kind as Exclude<NoteKind, 'understanding'>, topic: text.topic,
    conclusion: text.conclusion, anchor, body: text.body });

  const firstId = world.goals.first.goalId;
  const secondId = world.goals.second.goalId;
  let projectUnderstanding: S6AWrittenNote | null = null;
  const norms: S6AWrittenNote[] = [];
  const projectNotes: S6AWrittenNote[] = [];
  let firstUnderstanding: S6AWrittenNote | null = null;
  const firstNotes: S6AWrittenNote[] = [];
  let secondUnderstanding: S6AWrittenNote | null = null;
  if (options.notes !== false) {
    const texts = S6A_MEMORY_TEXTS;
    projectUnderstanding = await writeNote(understanding({ kind: 'project' }, texts.projectUnderstanding), null);
    for (const norm of texts.norms) norms.push(await writeNote(general({ kind: 'project' }, norm), null));
    for (const note of texts.projectNotes) projectNotes.push(await writeNote(general({ kind: 'project' }, note), null));
    firstUnderstanding = await writeNote(understanding({ kind: 'goal', goalId: firstId }, texts.firstGoalUnderstanding), firstId);
    for (const note of texts.firstGoalNotes) {
      firstNotes.push(await writeNote(general({ kind: 'goal', goalId: firstId }, note), firstId));
    }
    secondUnderstanding = await writeNote(understanding({ kind: 'goal', goalId: secondId }, texts.secondGoalUnderstanding),
      secondId);
  }

  // The capture the adoption started, and anything else the platform detached, settles before the reads.
  await world.settleDetached();
  const goals: S6AGoalFacts[] = [];
  for (const goal of created) goals.push(await readGoal(goal));
  const factsOf = (goalId: string): S6AGoalFacts => {
    const found = goals.find(goal => goal.goalId === goalId);
    if (found === undefined) throw new Error(`S6A memory: the goal ${goalId} was not read`);
    return found;
  };
  return {
    workspace: await readWorkspace(),
    goals,
    first: { ...factsOf(firstId), understanding: firstUnderstanding, notes: firstNotes },
    second: { ...factsOf(secondId), understanding: secondUnderstanding, notes: [] },
    project: { understanding: projectUnderstanding, norms, notes: projectNotes },
    governance,
    readGoal,
    readWorkspace,
  };
}
