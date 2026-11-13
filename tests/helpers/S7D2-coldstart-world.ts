/**
 * C1's cold-start world (`7d2-start-rulings.v4.md` §7.1/§7.2; the frozen test brief of 11-06): the SE2 host world
 * (`openS6AHostWorld`) with the project's three opening lines, the empty catalog adopted before the initial answer,
 * a two-task first Plan that never starts on its own, and the public steps of the six `cold_start` phases
 * (`candidates → adopted → route → coarse_split → regions → proposals`).
 *
 * Why not `openS7D2RoleLineWorld`: it adopts a four-region catalog right after the opening lines, so a secretary
 * round after it is no longer the initial format; it also fixes the module set. Here the catalog is empty until
 * `initialization/adopt` (the cold start's own `adopted` phase), so the candidate answer is the initial one.
 *
 * Host inputs (each a Host input, rule sheet A8):
 * - `defaultGoals: false` (the seed creates no Goal; the first Goal comes from the initial answer's draft);
 * - `requestDriver: 'on'` (the round driver runs the initial round, the route round and the exploration rounds);
 * - `checks: ag2bChecksConfiguration(...)` (the main workspace is read-only; an answer without `setup` skips the
 *   checks stage with this static fallback, `tests/app/S6B3-adoption-host.test.ts:315–:340`);
 * - `S7D2_ADVISER_WORK` (the adviser template's Runtime and Workflow binding, whose grant carries `create_member`),
 *   with the exploration/Work tools merged into it (`record_note`, `propose_architecture_revision`, `look_graph`,
 *   `find_graph`, `read_requests`; the precedent `S7D2-capacity-world.ts:80–:81`). The brief's separate new
 *   `c1-adviser-query-binding` for the same `(scope, Role)` is refused by the Host's one-binding-per-role rule
 *   (`runtime-configuration.ts:377–:379`), so the world merges the tools into the one adviser binding instead.
 *
 * Every state comes from a public step: `requests/submit`, `requests/read`, `queries/read`, `queries/answer`,
 * `goals/confirm-draft`, `initialization/adopt`, 8A's public governance adoption, `decisions/queue`/
 * `decisions/answer`, `role-lines/operations`, `role-lines/allocation`, `projects/role-limits/set`,
 * `architecture/read`, `architecture/proposals/read`, `sessions/read`, `sessions/find`, `messages/inbox` and
 * `notes/list`. No record, event or store is read or written.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { vi } from 'vitest';
import type { WorkbenchQueryProfile, WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import { dirname, join } from 'node:path';
import type {
  AdoptedArchitecture, ArchitectureCatalogPinV1, ModuleDefinition,
} from '../../src/contracts/architecture-catalog.js';
import type { ArchitectureProposalRef, ProposalRead } from '../../src/contracts/architecture-proposal.js';
import type { ModuleRef, SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryJobAnswerRef, QueryJobRef } from '../../src/contracts/query-job.js';
import type { RoleLimitsViewV1 } from '../../src/contracts/role-lines.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import { coldStartOperationRef } from '../../src/core/work-graph/state/cold-start.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import type { RequestCoreViewV1, RequestRoundViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import { waitFor } from '../scenarios/harness.js';
import { draftFrom } from '../scenarios/support/common.js';
import { AG2B_CONSUMER_ID, AG2B_RUNTIME_BUDGET, ag2bChecksConfiguration, graphWrite, listSessions, plain }
  from './AG2b-collaboration-fixture.js';
import { readQuery } from './A2-restart-fixture.js';
import { secretaryAnswer, waitForRound } from './S6A-history-fixture.js';
import { PL_ADVISER_ROLE, PL_ADVISER_ROLE_BINDING } from './PL-consumption-fixture.js';
import { commitBarrier, type CommitHold, type CommitMatch } from './S6A-commit-barrier.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { openingLinesOf, openS6AHostWorld, type S6AHostWorld, type S6AOpeningLines, type S6AReply }
  from './S6A-host-fixture.js';
import {
  OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6ABackend, type S6AExtraBinding, type S6ASession,
} from './S6A-request-fixture.js';
import { valueOf } from './S6B3-fixture.js';
import { readS7D1Limits, setS7D1Open } from './S7D1-allocation-world.js';
import {
  linkS7D2Scopes, readS7D2Operations, runS7D2Work, S7D2_ADVISER_WORK, S7D2_MODULE_IDS,
} from './S7D2-role-line-world.js';
import { S6A_BASELINE_ID, S6A_POLICY_CONTENT, S6A_POLICY_ID } from './S6A-memory-fixture.js';

// ---------------------------------------------------------------------------
// The frozen literals
// ---------------------------------------------------------------------------

/** The coarse-split “please act” message (C1a `src/core/work-graph/state/role-exploration.ts:27–:31`). */
export const COLDSTART_COARSE_QUESTION =
  'Please act: read only the top-level directories, entry points and existing docs, then propose the coarse split.';

/** The region “please act” message; the region is the module id. */
export const coldStartRegionQuestion = (moduleId: string): string =>
  `Please act: explore only the region ${moduleId} and propose that region's revision.`;

/** The one route question, a system round on the initial request (L-10, v4 §7.1 d30). */
export const COLDSTART_ROUTE_QUESTION =
  'Cold start: decide how the project map is made. Answer with exactly one word: map (you draw the map yourself) '
  + 'or split (advisers explore the regions). If you cannot decide, ask the person in your answer.';

/** The `start_lines` operation's hand-computed identity (`role-line-operation.ts:18–:20`). */
export function startLinesOperationRef(projectId: string): {
  aggregateType: 'CoreOperation'; projectId: string; operationId: string;
} {
  const commandKey = 'start_lines';
  return { aggregateType: 'CoreOperation', projectId,
    operationId: `role-line-${sha256Hex(canonicalJson({ projectId, commandKey, commandId: commandKey }))}` };
}

/** The QueryJobRef of one QueryRun (`queries/read` takes the job). */
export function queryJobRefOfRun(run: { projectId: string; workspaceId: string; queryJobId: string }): QueryJobRef {
  return { aggregateType: 'QueryJob', projectId: run.projectId, workspaceId: run.workspaceId,
    queryJobId: run.queryJobId };
}

/** The coarse-split Query pair (v4 :7988–:7990); `queryRunRef` is the Run half of the same pair. */
export function coarseSplitQueryRefs(projectId: string):
{ queryJobRef: QueryJobRef; queryRunRef: QueryRunRefLike } {
  return { queryJobRef: exportQueryJobRef(projectId, 'coarse_split', 'root'),
    queryRunRef: exportQueryRunRef(projectId, 'coarse_split', 'root') };
}

/** The region Query pair of one module id (v4 :7988–:7990). */
export function regionQueryRefs(projectId: string, moduleId: string):
{ queryJobRef: QueryJobRef; queryRunRef: QueryRunRefLike } {
  return { queryJobRef: exportQueryJobRef(projectId, 'region', moduleId),
    queryRunRef: exportQueryRunRef(projectId, 'region', moduleId) };
}

type QueryRunRefLike = {
  aggregateType: 'QueryRun'; projectId: string; workspaceId: string; queryJobId: string; runId: string;
};

function exportQueryJobRef(projectId: string, segment: 'coarse_split' | 'region', suffix: string): QueryJobRef {
  return { aggregateType: 'QueryJob', projectId, workspaceId: S6A_SCOPE.workspaceId,
    queryJobId: `cold-start-query:${projectId}:${segment}:${suffix}` };
}

function exportQueryRunRef(projectId: string, segment: 'coarse_split' | 'region', suffix: string): QueryRunRefLike {
  return { aggregateType: 'QueryRun', projectId, workspaceId: S6A_SCOPE.workspaceId,
    queryJobId: `cold-start-query:${projectId}:${segment}:${suffix}`,
    runId: `cold-start-run:${projectId}:${segment}:${suffix}` };
}

/** The empty catalog `initialization/adopt` runs on: the adoption declares no module (SMK's `smkSetup`). */
export const COLDSTART_EMPTY_CATALOG: AdoptedArchitecture = {
  requireDag: true, dependencies: [], modules: [], containment: { parentOf: [] },
};

/** The workspace source files the notes anchor on; `src/module.ts` is the AG2b world's own file. */
export const COLDSTART_SOURCE_FILES: Readonly<Record<string, string>> = {
  'src/a/a.ts': 'export const c1tSourceA = "C1T_LINK";\n',
  'src/b/b.ts': 'export const c1tSourceB = "C1T_LINK";\n',
  'docs/guide.md': '# C1T guide\n\nC1T_LINK\n',
  'docs/notes.md': '# C1T notes\n\nC1T_LINK\n',
};

/** Writes the cold-start source files into a world's workspace root (missing files only). */
export async function writeColdStartSources(world: { readonly root: string }): Promise<void> {
  // The AG2b module file carries the same literal so a link's two evidence ends can name one key.
  await mkdir(join(world.root, 'src'), { recursive: true });
  await writeFile(join(world.root, 'src', 'module.ts'),
    'export const ag2bMarker = "AG2B_ISOLATED_SOURCE";\nexport const c1tLink = "C1T_LINK";\n');
  for (const [path, text] of Object.entries(COLDSTART_SOURCE_FILES)) {
    await mkdir(dirname(join(world.root, path)), { recursive: true });
    await writeFile(join(world.root, path), text, { flag: 'wx' }).catch((error: unknown) => {
      if ((error as { code?: string }).code !== 'EEXIST') throw error;
    });
  }
}

/** The first Plan's two task ids (one per served role; `plan_only`, so the Goal driver starts neither). */
export const COLDSTART_PLAN_TASKS = { work: 'coldstart-work', adviser: 'coldstart-adviser' } as const;

/** The coarse-split proposal's fixed input (RL-23a step 6; v4 §7.1 d11). */
export function coldStartCoarseProposal(projectId: string) {
  const ref = (moduleId: string): ModuleRef => ({ projectId, moduleId });
  const moduleOf = (moduleId: string): ModuleDefinition => ({ ref: ref(moduleId), name: moduleId,
    responsibility: `${moduleId} region`, paths: [moduleId], interfaces: [] });
  return {
    ops: [
      { op: 'add_module' as const, module: moduleOf(S7D2_MODULE_IDS.region) },
      { op: 'add_module' as const, module: moduleOf(S7D2_MODULE_IDS.other) },
      { op: 'add_module' as const, module: moduleOf(S7D2_MODULE_IDS.child) },
      { op: 'add_module' as const, module: moduleOf(S7D2_MODULE_IDS.sibling) },
      { op: 'set_parent' as const, moduleId: S7D2_MODULE_IDS.child, parentId: S7D2_MODULE_IDS.region },
      { op: 'set_parent' as const, moduleId: S7D2_MODULE_IDS.sibling, parentId: S7D2_MODULE_IDS.region },
    ],
    responsibilityMoves: [],
    reason: 'coarse split',
  };
}

/** The initial v2 `kind: 'plan'` answer: two card drafts, no `setup`, two `plan_only` tasks (one per served role). */
export function coldStartPlanText(label = 'initial'): string {
  return JSON.stringify({
    schemaVersion: 2, kind: 'plan', summary: `C1T ${label} cold start`,
    plan: {
      schemaVersion: 2, stages: [],
      tasks: [
        { taskId: COLDSTART_PLAN_TASKS.work, title: `C1T ${label} work`, requirementLevel: 'required',
          taskKind: 'work', disposition: 'deferred', phase: 'pending', scope: { kind: 'goal' },
          executionIntent: 'plan_only' },
        { taskId: COLDSTART_PLAN_TASKS.adviser, title: `C1T ${label} adviser work`, requirementLevel: 'required',
          taskKind: 'work', disposition: 'deferred', phase: 'pending', scope: { kind: 'goal' },
          executionIntent: 'plan_only' },
      ],
      assignments: [
        { taskId: COLDSTART_PLAN_TASKS.work, role: S6A_WORK_ROLE.templateId, instruction: `C1T ${label} work` },
        { taskId: COLDSTART_PLAN_TASKS.adviser, role: PL_ADVISER_ROLE.templateId,
          instruction: `C1T ${label} adviser work` },
      ],
      obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
    },
    goalCardDrafts: [
      { objective: `C1T ${label} draft 0`, completion: [`C1T ${label} criterion 0`], autonomy: 'every_step',
        screening: null },
      { objective: `C1T ${label} draft 1`, completion: [`C1T ${label} criterion 1`],
        autonomy: 'after_plan_confirmation', screening: null },
    ],
    planDraftIndex: 0,
  });
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

export type S7D2ColdStartCandidate = {
  readonly requestRoot: QueryJobRef;
  readonly round: QueryJobRef;
  readonly answerRef: QueryJobAnswerRef;
  readonly answerText: string;
};

export type S7D2ColdStartRow = Extract<RoleLineOperationReadV1, { action: 'role_line' }>;
export type S7D2ColdStartPhase = NonNullable<S7D2ColdStartRow['actionPhase']>;
export type S7D2Exploration = NonNullable<S7D2ColdStartRow['explorations']>[number];

export type S7D2WalkOptions = {
  /** The scripted first answer of each region line; default one text answer naming the region. */
  regionReplies?: (moduleId: string) => readonly S6AReply[];
};

const COLDSTART_ADVISER_BINDING_ID = 'c1-adviser-query-binding';
const COLDSTART_ADVISER_PROFILE_ID = 'c1-adviser-query-profile';

/** One adviser runtime binding for Work and the exploration Query: the Workflow binding plus the Query profile. */
const COLDSTART_ADVISER_WORK: S6AExtraBinding = {
  binding: {
    ...structuredClone(S7D2_ADVISER_WORK.binding), id: COLDSTART_ADVISER_BINDING_ID,
    grant: { ...structuredClone(S7D2_ADVISER_WORK.binding.grant),
      tools: [...new Set([...S7D2_ADVISER_WORK.binding.grant.tools, 'look_graph', 'find_graph', 'read_requests',
        'record_note', 'propose_architecture_revision'])] },
  },
  workflow: S7D2_ADVISER_WORK.workflow!,
  queryProfile: {
    id: COLDSTART_ADVISER_PROFILE_ID, label: 'C1 adviser query', scope: S6A_SCOPE,
    runtimeBindingId: COLDSTART_ADVISER_BINDING_ID, sessionRole: PL_ADVISER_ROLE,
    roleBinding: PL_ADVISER_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET,
    budget: { maxTokens: null, deadline: null }, consumerId: AG2B_CONSUMER_ID,
  },
};

export type S7D2ColdStartWorldOptions = {
  backend: S6ABackend;
  /** Extra Host options spread over the world's own (each start and restart). */
  extraHostOptions?: Record<string, unknown>;
  /** Further bindings (a test adds its own tool to the adviser Work binding). */
  extraBindings?: readonly S6AExtraBinding[];
  /**
   * DEXC: the exploration depth the seed's first `workspaces/register` carries as `explorationDepth`. The seed lives
   * in the request world, so a delegating `fetch` spy, installed only while the world opens, adds this one field to
   * that one body and changes nothing else. Absent: the body is the seed's own (the default depth).
   */
  depth?: 1 | 2 | 3;
};

export type S7D2ColdStartWorld = {
  readonly host: S6AHostWorld;
  readonly main: S6ACardsWorkspace;
  readonly lines: S6AOpeningLines;
  /** The initial no-goal request root (null before `submitInitialPlan`). */
  initialRoot(): QueryJobRef;
  /** The initial round and its saved answer. */
  initial(): S7D2ColdStartCandidate;
  /** `role-lines/operations` of the main workspace. */
  operations(): Promise<readonly RoleLineOperationReadV1[]>;
  /** The one `cold_start` row (its operation identity, `cold_start:<projectId>`). */
  coldStart(): Promise<S7D2ColdStartRow>;
  /** The action phase the row reads (`completed` is the outer record's phase). */
  phase(): Promise<S7D2ColdStartPhase | 'completed'>;
  /** Polls the row until its action phase reads `phase` (or the record `completed`). */
  waitForPhase(phase: S7D2ColdStartPhase | 'completed'): Promise<S7D2ColdStartRow>;
  /** Polls the row until `explorations` holds `count` entries. */
  waitForExplorations(count: number): Promise<S7D2ColdStartRow>;
  /** Step 1: the initial no-goal plan answer on the opening secretary, read through `queries/read`/`queries/answer`. */
  submitInitialPlan(): Promise<S7D2ColdStartCandidate>;
  /** Step 3: the empty-catalog governance adoption; answers the current pin (`pin1`). */
  adoptGovernance(): Promise<ArchitectureCatalogPinV1>;
  /** Step 4a: `goals/confirm-draft` of the answer's draft; answers the Goal. */
  confirmDraft(candidate: S7D2ColdStartCandidate, index?: 0 | 1): Promise<GoalRef>;
  /** Step 4b: `initialization/adopt` of the same answer (no `setup`; the static checks fallback). */
  adopt(candidate: S7D2ColdStartCandidate, goal: GoalRef, index?: 0 | 1): Promise<void>;
  /** Steps 1–4 in order; the route/coarse scripts are queued before the adoption commit. */
  initialize(options?: { coarseProposal?: boolean }):
    Promise<{ candidate: S7D2ColdStartCandidate; goal: GoalRef; pin1: ArchitectureCatalogPinV1 }>;
  /** Scripts the opening secretary (clarify, then the route answer) and the opening adviser (the coarse proposal). */
  prepareRouteScripts(input: { clarify?: string; routeAnswer: 'map' | 'split'; coarseProposal?: boolean }): Promise<void>;
  /** The route round `requests/read` lists on the initial request (the one carrying the route question). */
  routeRound(): Promise<QueryJobRef>;
  /** Waits until the initial request carries exactly `count` rounds. */
  waitForRounds(count: number): Promise<void>;
  /** Waits until the round `requests/read` lists reads `ended`. */
  waitForRequestRoundEnded(round: QueryJobRef): Promise<void>;
  /** Polls `done` (bounded, about 15 s) and fails naming `what`. */
  waitFor(what: string, done: () => Promise<boolean>): Promise<void>;
  /** The person's answer on the same request (`continues`); answers the round it landed on. */
  submitContinuation(text: string, commandId: string): Promise<QueryJobRef>;
  /** Scripts every region line's first answer (after the entries are saved, before they are claimed). */
  scriptRegions(replies: (moduleId: string) => readonly S6AReply[]): Promise<void>;
  /** `sessions/read` of a `sessionRef` from an exploration entry. */
  lineOf(ref: SessionRef, label: string): Promise<S6ASession>;
  /** The inbox page of one line (`messages/inbox`). */
  inbox(line: S6ASession | SessionRef): Promise<SessionMessage[]>;
  /** `decisions/queue`'s cards (every section, all pages). */
  cards(): Promise<DecisionCardV1[]>;
  /** The `structural_proposal` cards only. */
  proposalCards(): Promise<DecisionCardV1[]>;
  /** `decisions/answer` of `approve` on a card, with the card's own source pins. */
  approve(card: DecisionCardV1, requestId: string): Promise<Record<string, unknown>>;
  /** `architecture/read` of the current selection: the current pin. */
  pin(): Promise<ArchitectureCatalogPinV1>;
  /** `architecture/proposals/read` of one proposal ref. */
  proposal(ref: ArchitectureProposalRef): Promise<ProposalRead>;
  /** `queries/read` of one job. */
  query(ref: QueryJobRef): Promise<QueryJobRecord>;
  /** `projects/role-limits/set` of the adviser open limit at the revision `projects/role-limits` reads. */
  setAdviserOpen(n: number, commandId: string): Promise<RoleLimitsViewV1>;
  /** The adviser holders' count (`role-lines/allocation`). */
  adviserHolders(): Promise<number>;
  /** One Work Run on `line` for `task`, with the line's scripted replies. */
  runWork(input: { line: S6ASession; task: { projectId: string; goalId: string; taskId: string }; label: string;
    replies: readonly S6AReply[] }): Promise<void>;
  /** Adds one active adviser Work task to the Goal's current Plan; scripts `line` before `plans/apply` and links the
   * adopted task to it, so the Goal's own autonomous start consumes the script (C1TR ruling 2, 11-06). */
  adoptWorkPlan(input: { goal: GoalRef; label: string; taskId: string; line: S6ASession;
    replies: readonly S6AReply[] }): Promise<{ projectId: string; goalId: string; taskId: string }>;
  /** The whole flow 1–8 with no region proposal; answers the final row and `pin2`. */
  walkToCompleted(options?: { regionReplies?: (moduleId: string) => readonly S6AReply[] }):
    Promise<{ final: S7D2ColdStartRow; pin2: ArchitectureCatalogPinV1 }>;
  /** Steps the row phase by phase up to and including `phase` (no restart in between). */
  advanceTo(phase: S7D2ColdStartPhase, options?: S7D2WalkOptions): Promise<void>;
  /** The remaining steps from the phase after `phase` to `completed`; answers the final row and `pin2`. */
  finishFrom(phase: S7D2ColdStartPhase, options?: S7D2WalkOptions):
    Promise<{ final: S7D2ColdStartRow; pin2: ArchitectureCatalogPinV1 }>;
  /** The first answer of one already-saved region line (before `proposals` claims it). */
  scriptRegion(moduleId: string, replies: readonly S6AReply[]): Promise<void>;
  /**
   * DEXC: up to `coarse_split` if the row is before it, then two free adviser seats, the coarse card approved if it
   * waits, the `proposals` commit held while `script` runs on each region line (by module id, with the pin after the
   * coarse split), then released. Answers the row read at that commit and the region lines.
   */
  toProposals(script?: (moduleId: string, line: S6ASession, pin: ArchitectureCatalogPinV1) => Promise<void>):
    Promise<{ row: DexcRow; lines: Record<string, S6ASession> }>;
  /** Every field a restart must not change, plus the opening-line/message/round counts (9a's equality). */
  snapshot(): Promise<Record<string, unknown>>;
  /**
   * The adviser Query profile's budget for the NEXT Host start: the world's mutable extra binding is the Host's
   * trusted runtime input, which every `crash()`/`reopen()` re-reads. The running Host keeps its own snapshot.
   */
  setAdviserProfileBudget(budget: WorkbenchQueryProfile['budget']): void;
  close(): Promise<void>;
};

/** The commit that writes the `cold_start` record at action phase `phase` (both hold helpers' one predicate). */
export function coldStartPhaseCommit(phase: S7D2ColdStartPhase): CommitMatch {
  const projectId = S6A_SCOPE.projectId;
  return commit => commit.records.some(record => {
    let value: unknown;
    try { value = JSON.parse(record.json) as unknown; } catch { return false; }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    const ref = row['ref'];
    const action = row['action'];
    if (typeof ref !== 'object' || ref === null || typeof action !== 'object' || action === null) return false;
    const refRow = ref as Record<string, unknown>;
    const actionRow = action as Record<string, unknown>;
    return refRow['aggregateType'] === 'CoreOperation' && refRow['operationId'] === `cold_start:${projectId}`
      && actionRow['action'] === 'cold_start' && actionRow['phase'] === phase;
  });
}

/** A `holdAfter` on the first commit that writes the `cold_start` record at action phase `phase`. */
export function holdColdStartPhase(phase: S7D2ColdStartPhase, label?: string): CommitHold {
  return commitBarrier.holdAfter(coldStartPhaseCommit(phase), label ?? `C1T: after the cold_start ${phase} commit`);
}

/** A `hold` before the first commit that writes the `cold_start` record at action phase `phase`. */
export function holdColdStartPhaseBefore(phase: S7D2ColdStartPhase, label?: string): CommitHold {
  return commitBarrier.hold(coldStartPhaseCommit(phase), label ?? `C1T: before the cold_start ${phase} commit`);
}

/** Open the world: the opening lines, the source files, and the handle (no request yet). Memory or SQLite. */
export async function openS7D2ColdStartWorld(
  options: S7D2ColdStartWorldOptions,
): Promise<S7D2ColdStartWorld> {
  // The Host re-reads this binding through the fixture on every start; a test may change its Query budget before
  // a crash/reopen, and the reopened Host sees the new value while the running one keeps its old snapshot.
  const adviserWork = structuredClone(COLDSTART_ADVISER_WORK);
  const realFetch = globalThis.fetch;
  const depth = options.depth;
  const register = depth === undefined ? null : vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (!String(url).endsWith('/workspaces/register') || typeof init?.body !== 'string') return await realFetch(url, init);
    const body = JSON.parse(init.body) as { request: { input: Record<string, unknown> } };
    return await realFetch(url, { ...init, body: JSON.stringify({ ...body,
      request: { ...body.request, input: { ...body.request.input, explorationDepth: depth } } }) });
  });
  let world: S6AHostWorld;
  try {
    world = await openS6AHostWorld({
      backend: options.backend,
      defaultGoals: false,
      extraHostOptions: {
        requestDriver: 'on',
        checks: ag2bChecksConfiguration({ actor: OPERATOR, command: 'node --test' }),
        ...(options.extraHostOptions ?? {}),
      },
      extraBindings: [adviserWork, ...(options.extraBindings ?? [])],
    });
  } finally {
    register?.mockRestore();
  }
  try {
    // 121-109: these rows read the structural cards, so the project asks before every structural change; the
    // factory default ("auto") would apply a proposal as it freezes and its card would never stay.
    const asked = await world.settings('structural-approval/save',
      { projectId: S6A_SCOPE.projectId, value: { proposals: 'ask', repairs: 'ask' } });
    if (asked.status !== 'ready') throw new Error(`C1T: structural-approval/save: ${JSON.stringify(asked)}`);
    await writeColdStartSources(world);
    const lines = await openingLinesOf(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const projectId = S6A_SCOPE.projectId;
    let initial: S7D2ColdStartCandidate | null = null;
    let closed = false;

    const coldStartRowOf = (rows: readonly RoleLineOperationReadV1[]): S7D2ColdStartRow => {
      const ref = coldStartOperationRef(projectId);
      for (const row of rows) {
        if (row.action === 'role_line' && row.operation.operationId === ref.operationId) return row;
      }
      throw new Error(`C1T: role-lines/operations lists no cold_start row ${ref.operationId}: `
        + JSON.stringify(rows.map(row => row.operation.operationId)));
    };
    const currentRoot = (): QueryJobRef => {
      if (initial === null) throw new Error('C1T: the initial request has not been submitted yet');
      return initial.requestRoot;
    };

    const handle: S7D2ColdStartWorld = {
      host: world, main, lines,
      initialRoot: currentRoot,
      initial() {
        if (initial === null) throw new Error('C1T: the initial request has not been submitted yet');
        return initial;
      },
      operations: async () => await readOperations(world),
      async coldStart() { return coldStartRowOf(await readOperations(world)); },
      async phase() {
        const row = coldStartRowOf(await readOperations(world));
        return row.phase === 'completed' ? 'completed' : row.actionPhase;
      },
      async waitForPhase(phase) {
        // A drive may finish two phases between two reads, so an intermediate phase is not always observable;
        // wait for the target or any later one. Callers that need the exact phase assert it on `coldStart()`.
        const order: readonly S7D2ColdStartPhase[] = ['candidates', 'adopted', 'route', 'coarse_split',
          'regions', 'proposals'];
        return await waitFor(async () => await coldStartRowOf(await readOperations(world)), row => {
          const actual = row.phase === 'completed' ? 'completed' : row.actionPhase;
          if (phase === 'completed') return actual === 'completed';
          // A completed record has passed every phase, even if the poll missed the intermediate one.
          if (actual === 'completed') return true;
          return order.indexOf(actual) >= order.indexOf(phase);
        }, `the cold_start phase ${phase}`);
      },
      async waitForExplorations(count) {
        return await waitFor(async () => await coldStartRowOf(await readOperations(world)),
          row => (row.explorations ?? []).length >= count, `the cold_start's ${String(count)} exploration entries`);
      },
      async submitInitialPlan() {
        await world.scripted.script(lines.secretary, [{ kind: 'text', text: coldStartPlanText('initial') }]);
        const submitted = await world.submit({ commandId: 'c1t-initial-plan', goalId: null,
          text: 'C1T: prepare the first plan', recipient: lines.secretary });
        if (submitted.status !== 'queued') throw new Error(`C1T: the initial submit was refused: ${JSON.stringify(submitted)}`);
        await waitForRound(world, submitted.requestRoot, submitted.round, 'ended');
        const job = await readQuery(world.ag2b, submitted.round);
        const answerRef = job.job.job.answerRefs.at(-1);
        if (answerRef === undefined) throw new Error('C1T: the initial round saved no answer');
        const answer = valueOf<{ answer: { answer: string } }>((await world.post('queries/answer',
          plain(S6A_SCOPE, answerRef))).body, 'ready', 'the initial answer');
        initial = { requestRoot: submitted.requestRoot, round: submitted.round, answerRef,
          answerText: answer.answer.answer };
        return initial;
      },
      async adoptGovernance() {
        await adoptColdStartGovernance(world);
        return await readCurrentPin(world);
      },
      async confirmDraft(candidate, index = 0) {
        const confirmed = (await world.post('goals/confirm-draft', plain(S6A_SCOPE, {
          commandId: `c1t-confirm-${String(index)}`, round: candidate.round, index,
        }))).body;
        return valueOf<{ goal: { ref: GoalRef } }>(confirmed, 'committed', 'the draft confirmation').goal.ref;
      },
      async adopt(candidate, goal, index = 0) {
        const adopted = (await world.post('initialization/adopt', plain(S6A_SCOPE, {
          commandId: `c1t-adopt-${String(index)}`, expectedAnswerDigest: sha256Hex(candidate.answerText),
          source: { kind: 'binding', answerRef: candidate.answerRef, draftIndex: index },
          expectedGoal: { ref: goal, revision: 1 },
        }))).body;
        valueOf<unknown>(adopted, 'committed', 'the initialization adoption');
      },
      async initialize(options = {}) {
        const candidate = await handle.submitInitialPlan();
        const pin1 = await handle.adoptGovernance();
        const goal = await handle.confirmDraft(candidate);
        await handle.prepareRouteScripts({ routeAnswer: 'split',
          ...(options.coarseProposal === undefined ? {} : { coarseProposal: options.coarseProposal }) });
        await handle.adopt(candidate, goal);
        return { candidate, goal, pin1 };
      },
      async prepareRouteScripts(input) {
        const clarify = input.clarify ?? 'C1T: should I draw the map myself or let the advisers explore?';
        // A request round's answer is the secretary protocol JSON; the stored answer's body is what the route reads.
        await world.scripted.script(lines.secretary, [
          { kind: 'text', text: secretaryAnswer({ body: clarify }) },
          { kind: 'text', text: secretaryAnswer({ body: input.routeAnswer }) }]);
        if (input.coarseProposal !== false) {
          await world.scripted.script(lines.adviser, [{
            kind: 'calls', calls: [{ callId: 'c1t-coarse-split', name: 'propose_architecture_revision',
              args: { baseCatalogPin: await readCurrentPin(world), ops: coldStartCoarseProposal(projectId).ops,
                responsibilityMoves: [], reason: 'coarse split' } }],
          }, { kind: 'text', text: 'C1T: the coarse split is proposed' }]);
        }
      },
      async routeRound() {
        // The route phase's question is a separate append after the phase commit; the person answers it, so wait
        // for the append before submitting (a `waitForPhase('route')` may observe the phase one pass earlier).
        const found = await waitFor(async () => {
          const view = await world.readRequest(currentRoot());
          return view.rounds.find((candidate: RequestRoundViewV1) => candidate.input === COLDSTART_ROUTE_QUESTION) ?? null;
        }, (round: RequestRoundViewV1 | null) => round !== null, 'the cold start route question');
        return (found as RequestRoundViewV1).ref;
      },
      async waitForRounds(count) {
        await world.waitForRequest(currentRoot(), (view: RequestCoreViewV1) => view.rounds.length === count,
          `the initial request's ${String(count)} rounds`);
      },
      async waitForRequestRoundEnded(round) {
        await waitForRound(world, currentRoot(), round, 'ended');
      },
      async waitFor(what, done) {
        await waitFor(done, (value: boolean) => value, what);
      },
      async submitContinuation(text, commandId) {
        const route = await handle.routeRound();
        // The route question is answered by the secretary's round; the person's continuation lands after it.
        await waitForRound(world, currentRoot(), route, 'ended');
        const submitted = await world.submit({ commandId, goalId: null, text, continues: currentRoot(),
          recipient: null });
        if (submitted.status !== 'queued') throw new Error(`C1T: the continuation was refused: ${JSON.stringify(submitted)}`);
        await waitForRound(world, currentRoot(), submitted.round, 'ended');
        return submitted.round;
      },
      async scriptRegions(replies) {
        const row = await handle.waitForExplorations(3);
        for (const entry of (row.explorations ?? []) as readonly S7D2Exploration[]) {
          if (entry.segment !== 'region') continue;
          const moduleId = entry.queryRunRef.runId.split(':').at(-1)!;
          await world.scripted.script(await handle.lineOf(entry.sessionRef, `c1t-region-${moduleId}`),
            replies(moduleId));
        }
      },
      async lineOf(ref, label) {
        const card = await world.readSession(ref);
        return { label, ref, aggregateRef: card.record.ref, role: structuredClone(card.record.role),
          createdAt: card.record.createdAt };
      },
      async inbox(line) {
        const recipient = 'aggregateRef' in line ? line.ref : line;
        return valueOf<{ items: SessionMessage[] }>((await world.post('messages/inbox',
          plain(S6A_SCOPE, { recipient, page: { limit: 50 } }))).body, 'ready', 'the inbox page').items;
      },
      cards: async () => await main.readCards(),
      async proposalCards() {
        // The queue read also returns `history`; a card is in the queue only while it waits for the person.
        return (await main.readCards()).filter(card => card.source.kind === 'structural_proposal'
          && card.state === 'waiting_answer');
      },
      async approve(card, requestId) {
        return (await world.post('decisions/answer', graphWrite(S6A_SCOPE, {
          source: card.source, selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [],
        }, requestId, card.source.pins))).body as Record<string, unknown>;
      },
      async pin() { return await readCurrentPin(world); },
      async proposal(ref) {
        return valueOf<ProposalRead>((await world.post('architecture/proposals/read',
          plain(S6A_SCOPE, { proposalRef: ref }))).body, 'ready', `the proposal ${ref.proposalId}`);
      },
      async query(ref) { return await readQuery(world.ag2b, ref); },
      async setAdviserOpen(n, commandId) {
        const limits = await readS7D1Limits(world);
        return await setS7D1Open(world, 'adviser', n, limits.revision, commandId) as unknown as RoleLimitsViewV1;
      },
      async adviserHolders() {
        const allocation = valueOf<{ duties: { adviser: { holders: readonly unknown[] } } }>(
          (await world.post('role-lines/allocation', plain(S6A_SCOPE, {}))).body, 'ready', 'the allocation');
        return allocation.duties.adviser.holders.length;
      },
      async adoptWorkPlan(input) {
        const active = await main.activePlan(input.goal);
        if (active === null) throw new Error(`C1T: the Goal ${input.goal.goalId} has no active Plan`);
        const task = { taskId: input.taskId, title: `C1T ${input.label} work`, requirementLevel: 'required' as const,
          taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const,
          scope: { kind: 'goal' as const }, executionIntent: 'request_execution' as const };
        // The cold start's Plan has no obligation (`coldStartPlanText`). A `request_execution` task adopted into it
        // would fail `open_checks` (`verification-plan.ts:72`), park the Goal driver with no wait, and the next plan
        // adoption would wake nobody (RL-24 step 7). The adopted task carries the registered static obligation.
        const draft = draftFrom(active, `c1t-${input.label}`,
          current => ({ ...current, tasks: [...current.tasks, task],
            obligations: [...current.obligations, { obligationId: `c1t-${input.label}-obligation`,
              title: `C1T ${input.label} delivery`, requirementLevel: 'required' as const,
              taskIds: [input.taskId], verificationRequirements: [{ requirementId: 'ag2b-static',
                requirementLevel: 'required' as const, kind: 'static' as const,
                description: 'Registered static command check' }] }],
            assignments: [...(current.assignments ?? []), { taskId: input.taskId, role: PL_ADVISER_ROLE.templateId,
              instruction: `C1T ${input.label}` }] }));
        const proposed = valueOf<{ ref: unknown; revision: number }>((await world.post('plans/propose',
          graphWrite(S6A_SCOPE, { goalRef: input.goal, basedOn: active.ref, draft,
            reason: { text: `C1T ${input.label}`, sources: [] } }, `c1t-${input.label}-propose`))).body,
          'committed', `the Plan ${input.label}`);
        const taskRef = { projectId: input.goal.projectId, goalId: input.goal.goalId, taskId: input.taskId };
        // The autonomous start after the adoption consumes this line's script (C1TR ruling 2); the script is queued
        // before the adoption. The task link needs the accepted Plan, so it follows the apply and aims that start.
        await world.scripted.script(input.line, input.replies);
        valueOf<unknown>((await world.post('plans/apply', graphWrite(S6A_SCOPE, {
          proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
        }, `c1t-${input.label}-apply`))).body, 'committed', `the adoption of ${input.label}`);
        await linkS7D2Scopes(world, { line: input.line, targets: [{ kind: 'task', ref: taskRef }],
          label: `${input.label}-task` });
        return taskRef;
      },
      async runWork(input) {
        await runS7D2Work(world, { line: input.line,
          goal: { aggregateType: 'Goal', projectId: input.task.projectId, goalId: input.task.goalId },
          task: input.task, label: input.label, replies: input.replies });
      },
      async walkToCompleted(options = {}) {
        return await finishAfter('candidates', options);
      },
      async advanceTo(phase, options = {}) {
        await runSteps('candidates', phase, options);
      },
      async finishFrom(phase, options = {}) {
        return await finishAfter(phase, options);
      },
      async scriptRegion(moduleId, replies) {
        const row = await handle.waitForExplorations(1);
        const entry = (row.explorations ?? []).find(candidate => candidate.segment === 'region'
          && candidate.queryRunRef.runId.endsWith(`:${moduleId}`));
        if (entry === undefined) throw new Error(`C1T: no region exploration for ${moduleId}`);
        await world.scripted.script(await handle.lineOf(entry.sessionRef, `c1t-region-${moduleId}`), replies);
      },
      async toProposals(script = async () => undefined) {
        const at = await handle.phase();
        if (at !== 'coarse_split' && at !== 'regions') await handle.advanceTo('coarse_split');
        const proposals = holdColdStartPhase('proposals', 'C1T: after the proposals phase commit');
        try {
          // Two region lines need two free seats; `holders` may still count only the opening adviser line here.
          await handle.setAdviserOpen(await handle.adviserHolders() + 2, 'c1t-limits-two');
          if (await handle.phase() === 'coarse_split') await runSteps('coarse_split', 'regions');
          await proposals.reached;
          const row = await handle.coldStart() as DexcRow;
          const pin = await readCurrentPin(world);
          const lines: Record<string, S6ASession> = {};
          for (const entry of (row.explorations ?? []) as readonly S7D2Exploration[]) {
            if (entry.segment !== 'region') continue;
            const moduleId = entry.queryRunRef.runId.split(':').at(-1)!;
            lines[moduleId] = await handle.lineOf(entry.sessionRef, `c1t-region-${moduleId}`);
            await script(moduleId, lines[moduleId], pin);
          }
          return { row, lines };
        } finally {
          proposals.release();
        }
      },
      setAdviserProfileBudget(budget) {
        if (adviserWork.queryProfile === undefined) throw new Error('C1T: the adviser binding has no Query profile');
        adviserWork.queryProfile.budget = { ...budget };
      },
      async snapshot() {
        const row = await handle.coldStart();
        const sessions = await listSessions(world.ag2b);
        const roundView = await world.readRequest(currentRoot());
        // The Query ids are random per world; the snapshot compares the same names, not the generated UUIDs.
        // Ruling 7: the candidate is not normalized here. Its empty suffixes would hide a different answer or run;
        // each world checks the two real refs against `initial()` and its original round instead (RL-23 9a).
        const tailOf = (id: string): string => id.split(':').slice(3).join(':');
        return {
          phase: row.phase, actionPhase: row.actionPhase, lastCompleted: row.lastCompleted ?? null,
          pendingRegions: row.pendingRegions, route: row.route,
          baseCatalogPin: row.baseCatalogPin, steps: row.steps, result: row.result,
          batchRefs: row.batchRefs ?? null,
          explorations: (row.explorations ?? []).map(entry => ({ segment: entry.segment,
            sessionId: entry.sessionRef.sessionId, messageId: entry.messageRef.messageId,
            operationId: entry.operationRef.operationId, suffix: tailOf(entry.queryRunRef.runId) })),
          adviserLines: sessions.filter(card => card.record.role.kind === 'legacy_template'
            && card.record.role.templateId === PL_ADVISER_ROLE.templateId).length,
          rounds: roundView.rounds.length,
          roundInputs: roundView.rounds.map((entry: RequestRoundViewV1) => entry.input),
        };
      },
      async close() {
        if (closed) return;
        closed = true;
        await world.close();
      },
    };
    const NEXT_PHASE: Record<S7D2ColdStartPhase, S7D2ColdStartPhase | 'completed'> = {
      candidates: 'adopted', adopted: 'route', route: 'coarse_split', coarse_split: 'regions',
      regions: 'proposals', proposals: 'completed',
    };

    async function oneStep(from: S7D2ColdStartPhase, options: S7D2WalkOptions = {}): Promise<void> {
      switch (from) {
        case 'candidates':
          await handle.submitInitialPlan();
          break;
        case 'adopted': {
          await handle.adoptGovernance();
          const goal = await handle.confirmDraft(handle.initial());
          await handle.prepareRouteScripts({ routeAnswer: 'split' });
          await handle.adopt(handle.initial(), goal);
          break;
        }
        case 'route': {
          await handle.waitForPhase('route');
          const holders = await handle.adviserHolders();
          await handle.setAdviserOpen(holders + 1, 'c1t-limits-one');
          await handle.submitContinuation('split', 'c1t-route-split');
          break;
        }
        case 'coarse_split': {
          await handle.waitForPhase('coarse_split');
          await waitFor(async () => (await handle.proposalCards()).length, (count: number) => count > 0,
            'the coarse-split structural proposal card');
          await handle.approve((await handle.proposalCards())[0]!, 'c1t-approve-coarse');
          break;
        }
        case 'regions': {
          await handle.waitForPhase('regions');
          await handle.toProposals(async (moduleId, line) => await world.scripted.script(line,
            options.regionReplies?.(moduleId) ?? [{ kind: 'text', text: `C1T: region ${moduleId} explored` }]));
          break;
        }
        case 'proposals':
          break;
      }
      if (from !== 'proposals') await handle.waitForPhase(NEXT_PHASE[from]!);
    }

    async function runSteps(from: S7D2ColdStartPhase | 'completed', until: S7D2ColdStartPhase | 'completed',
      options: S7D2WalkOptions = {}) {
      let current: S7D2ColdStartPhase | 'completed' = from;
      while (current !== 'completed' && current !== until) {
        await oneStep(current, options);
        current = NEXT_PHASE[current]!;
      }
      if (until === 'completed') await handle.waitForPhase('completed');
    }

    async function finishAfter(phase: S7D2ColdStartPhase, options: S7D2WalkOptions = {}): Promise<{
      final: S7D2ColdStartRow; pin2: ArchitectureCatalogPinV1;
    }> {
      // Another phase may already have advanced while the test held a round; start from what is stored, not the
      // phase the caller remembered.
      const current = await handle.coldStart();
      const from = current.phase === 'completed' ? 'completed' : current.actionPhase;
      await runSteps(from, 'completed', options);
      return { final: await handle.coldStart(), pin2: await readCurrentPin(world) };
    }

    handle.advanceTo = async (phase: S7D2ColdStartPhase) => {
      const row = await handle.coldStart();
      const from = row.phase === 'completed' ? 'completed' : row.actionPhase;
      await runSteps(from, phase);
    };
    handle.finishFrom = async (phase: S7D2ColdStartPhase) => await finishAfter(phase);
    return handle;
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Small reads the handle composes
// ---------------------------------------------------------------------------

async function readOperations(world: S6AHostWorld): Promise<readonly RoleLineOperationReadV1[]> {
  return valueOf<readonly RoleLineOperationReadV1[]>((await world.post('role-lines/operations', plain(S6A_SCOPE, {
    workspace: { projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId },
  }))).body, 'ready', 'the role-line operations read');
}

async function readCurrentPin(world: S6AHostWorld): Promise<ArchitectureCatalogPinV1> {
  const view = valueOf<{ baseline: { ref: ArchitectureCatalogPinV1['baseline']['ref']; contentDigest: string };
    catalog: { ref: ArchitectureCatalogPinV1['catalogRef'] } }>((await world.post('architecture/read',
    plain(S6A_SCOPE, { selection: { kind: 'current' } }))).body, 'ready', 'the current architecture');
  return { catalogRef: view.catalog.ref, baseline: { ref: view.baseline.ref, digest: view.baseline.contentDigest } };
}

/**
 * The governance the `adopted` phase runs on, through the same public routes the memory fixture's seed composes
 * (`tests/helpers/S6A-memory-fixture.ts:288–:358`): install and activate the world's completion policy at revision
 * 1, then `architecture/adopt-initial` with the empty catalog. The seed itself is not reused because it requires
 * the world's two seeded Goals (`:404`), which a cold start at `candidates` does not have.
 */
async function adoptColdStartGovernance(world: S6AHostWorld): Promise<void> {
  const scope = S6A_SCOPE;
  const projectRef = { aggregateType: 'Project' as const, projectId: scope.projectId };
  const workspaceRef = { aggregateType: 'Workspace' as const, ...scope };
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: scope.projectId,
    policyId: S6A_POLICY_ID, revision: 1 };
  const activePolicyRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: scope.projectId };
  const registration = valueOf<{ project: { revision: number }; workspace: { revision: number } }>(
    (await world.post('workspaces/registration', plain(scope, { ...scope }))).body, 'ready', 'the registration');
  const projectPin = { ref: projectRef, revision: registration.project.revision };
  const workspacePin = { ref: workspaceRef, revision: registration.workspace.revision };
  const installed = valueOf<{ ref: unknown; policyId: string; contentRevision: number; contentDigest: string }>(
    (await world.post('completion-policies/install', graphWrite(scope, { policyId: S6A_POLICY_ID, contentRevision: 1,
      content: S6A_POLICY_CONTENT }, 'c1t-policy-install', [projectPin, { ref: policyRef, revision: 0 }]))).body,
    'committed', 'the policy install');
  valueOf<unknown>((await world.post('completion-policies/activate', graphWrite(scope, {
    target: { ref: installed.ref, digest: installed.contentDigest } }, 'c1t-policy-activate',
  [projectPin, { ref: activePolicyRef, revision: 0 }]))).body, 'committed', 'the policy activation');
  valueOf<unknown>((await world.post('architecture/adopt-initial', graphWrite(scope, { baselineId: S6A_BASELINE_ID,
    description: 'C1T empty cold-start catalog', constraints: [], catalog: COLDSTART_EMPTY_CATALOG },
  'c1t-architecture-adopt', [projectPin, workspacePin]))).body, 'committed', 'the empty catalog adoption');
  await world.settleDetached();
}

// ---------------------------------------------------------------------------
// DEXC: exploration control through its public routes (stop, continue, deepen and the card's third option)
// ---------------------------------------------------------------------------

/** A `role_line` row of `role-lines/operations` with the three fields exploration control adds to it. */
export type DexcRow = S7D2ColdStartRow & { depth?: number; plannedRounds?: number | null;
  followUp?: { kind: string; moduleRefs: ModuleRef[]; reason: string | null; sourceBatchRef: unknown } | null };

/** The `role-lines/operations` rows of one workspace (default the main one) that carry a `followUp`. */
export async function dexcFollowUps(world: Pick<S6AHostWorld, 'post'>, scope: WorkspaceScope = S6A_SCOPE):
Promise<DexcRow[]> {
  return (await readS7D2Operations(world, scope) as DexcRow[]).filter(row => row.action === 'role_line'
    && row.followUp !== undefined && row.followUp !== null);
}

/**
 * One `workspaces/exploration/<verb>` write in `scope`, pinned at the project and workspace revisions
 * `workspaces/registration` reads; `body` names another target workspace or the `deepen` module. `replay` sends the
 * same body again.
 */
export async function dexcCommand(world: Pick<S6AHostWorld, 'post'>, verb: 'stop' | 'continue' | 'deepen',
  requestId: string, input: { scope?: WorkspaceScope; workspace?: WorkspaceScope; module?: ModuleRef } = {}):
Promise<{ result: Record<string, unknown>; replay(): Promise<Record<string, unknown>> }> {
  const scope = input.scope ?? S6A_SCOPE;
  const registration = valueOf<{ project: { revision: number }; workspace: { revision: number } }>(
    (await world.post('workspaces/registration', plain(scope, { ...scope }))).body, 'ready', 'the registration');
  const body = graphWrite(scope, { workspace: { ...(input.workspace ?? scope) },
    ...(input.module === undefined ? {} : { module: input.module }) }, requestId, [
    { ref: { aggregateType: 'Project', projectId: scope.projectId }, revision: registration.project.revision },
    { ref: { aggregateType: 'Workspace', ...scope }, revision: registration.workspace.revision }]);
  const send = async (): Promise<Record<string, unknown>> =>
    (await world.post(`workspaces/exploration/${verb}`, body)).body as Record<string, unknown>;
  return { result: await send(), replay: send };
}

/** `decisions/answer` of one option with its text, on the card's own source and pins. */
export async function dexcAnswer(world: Pick<S6AHostWorld, 'post'>, card: DecisionCardV1, optionId: string,
  text: string, requestId: string): Promise<Record<string, unknown>> {
  return (await world.post('decisions/answer', graphWrite(S6A_SCOPE, { source: card.source,
    selection: { kind: 'option', optionId }, text, annotations: [] }, requestId, card.source.pins))).body as
    Record<string, unknown>;
}

/** A line's rounds at the model boundary, one per Kernel run (an exploration round is one run; a provider retry
 *  stays in it), a held or cancelled one included: each round's first request's last (user) message as JSON. */
export async function dexcRounds(world: Pick<S6AHostWorld, 'scripted'>, line: S6ASession): Promise<string[]> {
  const rounds = new Map<string, string>();
  for (const { request } of await world.scripted.boundary(line)) {
    if (!rounds.has(request.runId)) rounds.set(request.runId, JSON.stringify(request.messages.at(-1)));
  }
  return [...rounds.values()];
}

/** The signal of the line's last model call at the boundary; the only place a test reads a cancellation. */
export async function dexcSignal(world: Pick<S6AHostWorld, 'scripted'>, line: S6ASession): Promise<AbortSignal | null> {
  return (await world.scripted.boundary(line)).at(-1)?.signal ?? null;
}

/** One exploration round's `propose_architecture_revision` call and its closing answer (the reason as text). */
export function dexcProposal(callId: string, pin: ArchitectureCatalogPinV1,
  ops: readonly Record<string, unknown>[], reason: string): S6AReply[] {
  return [{ kind: 'calls', calls: [{ callId, name: 'propose_architecture_revision',
    args: { baseCatalogPin: pin, ops: [...ops], responsibilityMoves: [], reason } }] }, { kind: 'text', text: reason }];
}

/** The completion barrier (F9): detached rounds settled, then one real consume pass. The world configures no consumer,
 *  so the pass period is the scribe reminder's 60 s on the frozen `Date.now()`; one clock step clears it. */
export async function dexcBarrier(world: Pick<S6AHostWorld, 'consumeBarrier' | 'clock' | 'settleDetached'>):
Promise<void> {
  await world.settleDetached();
  const settled = world.consumeBarrier();
  world.clock.advance(60_000);
  await settled;
}

/** A hold on the first commit that writes an `exploration_followup` record carrying a round: `before` keeps it from
 *  committing (`hold`), `after` lets it land and keeps its answer (`holdAfter`). */
export function holdFollowUpRound(when: 'before' | 'after', label: string): CommitHold {
  const match: CommitMatch = commit => commit.records.some(record => {
    let value: unknown;
    try { value = JSON.parse(record.json) as unknown; } catch { return false; }
    const action = (value as { action?: { action?: unknown; explorations?: unknown } } | null)?.action;
    return action?.action === 'exploration_followup' && Array.isArray(action.explorations)
      && action.explorations.length > 0;
  });
  return when === 'before' ? commitBarrier.hold(match, label) : commitBarrier.holdAfter(match, label);
}

/** Waits (bounded) for a waiting structural card other than `not`, and answers it. */
export async function dexcNextCard(cold: Pick<S7D2ColdStartWorld, 'waitFor' | 'proposalCards'>,
  not?: DecisionCardV1): Promise<DecisionCardV1> {
  await cold.waitFor('a new structural card', async () =>
    (await cold.proposalCards()).some(card => card.cardKey !== not?.cardKey));
  return (await cold.proposalCards()).find(card => card.cardKey !== not?.cardKey)!;
}
