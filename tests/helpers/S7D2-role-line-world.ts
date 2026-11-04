/**
 * O1b's role-line world (`7d2-start-rulings.v4.md` §11 `:8874`, lead 13; X-18 and X-21 of the drill rulings): the
 * one fixture RL-01/02/03 run on and RL-13/14 (O2), RL-19/20 (O4b) and RL-21 (O5a) read without editing or copying.
 *
 * Every state is reached through a public step of the SE2 host world (`openS6AHostWorld`,
 * tests/helpers/S6A-host-fixture.ts) and the 7D1 role-line steps (`openLink`, tests/helpers/S7D1-role-line-world.ts;
 * the allocation, limits, archive and reactivate steps of tests/helpers/S7D1-allocation-world.ts):
 * - The birth. The host world's seed is a fresh project and its main workspace: `projects/create`, then the first
 *   `workspaces/register`, whose commit births the project's one `start_lines` operation. The world starts every Host
 *   with `requestDriver: 'on'` (the lifecycle queue that drives the operation lives behind that switch) spread under
 *   the caller's `extraHostOptions` (X-21: the same pass-through on every start and restart). The Host's own lifecycle
 *   passes then open the three lines; the world waits, through `role-lines/operations`, until the operation ends, and
 *   names each line from its step's `childOperation` (`sessions/operation` → the create's `plannedSessionRef`).
 * - The one stop (`openS7D2BirthWorld`, SQLite only; T8, rework-1). Before the first Host starts, one hold is armed
 *   on a real commit that writes the `start_lines` record, in that Host's background pass: `stopAt: 'created'` is a
 *   `CommitBarrier.holdAfter` on the secretary step's `created` commit (it lands and its answer is kept), and
 *   `stopAt: 'registered'` a `CommitBarrier.hold` on the commit that moves that step past `registered` (kept before it
 *   commits). `role-lines/operations` is read at the stop, and the world's `crash()` starts a new Host on the same
 *   directory, whose start-up pass drives the operation to its end in one call (C1). The abandoned Host is let go only
 *   by `close()`. The test file installs the barrier's two `vi.mock`s.
 * - Governance (`adoptS7D2Governance`). After the lines, the project's policy and the default catalog (`s7d2Catalog`:
 *   region `src` with the children `src/a` and `src/b`, containment declared) through the memory fixture's
 *   governance seed (`seedS6AMemory`, `architecture/adopt-initial`), so module targets are in the formal catalog.
 *   RL-14's observation inputs come from the same public steps (8A's adopt and its automatic capture): a capture that
 *   fails (the workspace root is moved away while the adoption's capture runs, the S8A failure path), a longest-prefix
 *   tie (a twin module on `src`'s own path) and a catalog without its `containment` field.
 * - Role-line commands through their person routes: `role-lines/open`, `role-lines/change-scope`; scope links through
 *   `sessions/link` (`openLink`); the module maintainer through `modules/assign-maintainer`; caps through
 *   `projects/role-limits/set`; Work lines through `sessions/create` (the world's Work role, duty executor).
 * - The later packages' steps: a second workspace of the same project through the Host's `workspaces/open` settings
 *   route and a goal there (`addS7D2SecondWorkspace`; X-18's cross-workspace goal); scope links on a line
 *   (`linkS7D2Scopes`); one real Work Run on a line through `workflow/advance` with the line's scripted replies
 *   (`runS7D2Work`; lead 13's too-long input in `runS7D2TooLongWork`); the real `create_member` tool from a Work Run
 *   (`askS7D2Member`; a second caller on the same member Task is the reuse); the person's full handoff
 *   (`handoffS7D2Line`: `sessionHandoff.acceptHandoff` + `driveS6BHandoff`); archive and reactivate are 7D1's
 *   `archiveS7D1Session`/`reactivateS7D1Session`. `openS7D2ProjectWorld` composes them.
 * - Observations only through `role-lines/operations`, `sessions/read`, `sessions/find`, `sessions/operation`,
 *   `role-lines/allocation`, `decisions/queue` and `architecture/observation-state`. No record, context or store read
 *   is made here; a route the tree does not publish yet answers its 404, which the step reports and never reads as a
 *   business answer.
 */
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdoptedArchitecture, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';
import type { ModuleRef, SessionRef, WorkLinkTarget, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { SessionWorkLink } from '../../src/contracts/core/session.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import type {
  RoleLineAllocationReportV1, RoleLineDutyV1, RoleLimitsViewV1, RoleScopeV1,
} from '../../src/contracts/role-lines.js';
import { isRecord } from '../../src/contracts/validation/common.js';
import type { PreparedCommit } from '../../src/core/record-store/ports.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type {
  SessionCard, SessionCreateOperationRecord, SessionPage,
} from '../../src/core/work-graph/model/session-contracts.js';
import type { RoleLineLineV1 } from '../../src/core/work-graph/sessions/role-line-operations.js';
import { ROLE_LINE_STEP_KEYS, type RoleLineStepStateV1 } from '../../src/core/work-graph/state/role-line-action.js';
import type { MemberRequestResultV1 } from '../../src/core/work-graph/tasks/member-service.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import { waitFor } from '../scenarios/harness.js';
import { driveWorkflow, type AdvanceValue } from './A2-restart-fixture.js';
import { graphWrite, plain, startLinesEnded, writeAG2bWorkspace } from './AG2b-collaboration-fixture.js';
import { adoptPLMixedPlan, PL_ADVISER_ROLE, PL_ADVISER_ROLE_BINDING } from './PL-consumption-fixture.js';
import { drivePLTaskRunsToStop } from './PL-deviation-fixture.js';
import { commitBarrier, type CommitHold, type CommitMatch } from './S6A-commit-barrier.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { openS6AHostWorld, refOf, usageOf, type S6AHostWorld, type S6AReply } from './S6A-host-fixture.js';
import { seedS6AMemory } from './S6A-memory-fixture.js';
import {
  S6A_SCOPE, type S6ABackend, type S6AExtraBinding, type S6ARequestWorld, type S6ASession,
} from './S6A-request-fixture.js';
import { driveS6BHandoff } from './S6B2-fixture.js';
import { valueOf } from './S6B3-fixture.js';
import { jsonOf } from './S7C-member-fixture.js';
import { bindingOf, sessionOf } from './S7A-fixture.js';
import {
  archiveS7D1Session, reactivateS7D1Session, readS7D1Allocation, readS7D1Limits, setS7D1Open,
} from './S7D1-allocation-world.js';
import { openLink, type S7D1LinkInput, type S7D1Write } from './S7D1-role-line-world.js';

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** The three opening lines, in the operation's step order. */
export type S7D2OpeningDuty = (typeof ROLE_LINE_STEP_KEYS)[number];

/** The role-line read's `role_line` row. */
export type S7D2OperationRow = Extract<RoleLineOperationReadV1, { action: 'role_line' }>;

/** The default catalog's regions: `region` contains `child` and `sibling`; `other` is a top-level region of its own. */
export const S7D2_MODULE_IDS = { region: 'src', child: 'src/a', sibling: 'src/b', other: 'docs' } as const;
/** `ownership_ambiguous`'s twin: a fourth module whose path is `src`'s own, so a file under `src` ties. */
export const S7D2_TWIN_MODULE_ID = 'src-twin';

export const S7D2_PROJECT_TARGET: WorkLinkTarget = { kind: 'project', ref: { projectId: S6A_SCOPE.projectId } };

/** RL-14's observation inputs this world reaches through public steps (see `adoptS7D2Governance`). */
export type S7D2ObservationVariant = 'capture_failed' | 'ownership_ambiguous' | 'containment_absent';

/**
 * The world's catalog: the four regions, each owning its own directory. `containment: false` drops the declared
 * containment (the field absent means "unknown", never "flat"); `twin: true` adds `S7D2_TWIN_MODULE_ID` on `src`.
 */
export function s7d2Catalog(projectId: string,
  options: { containment: boolean; twin?: boolean } = { containment: true }): AdoptedArchitecture {
  const ref = (moduleId: string): ModuleRef => ({ projectId, moduleId });
  const moduleOf = (moduleId: string, path: string): ModuleDefinition => ({
    ref: ref(moduleId), name: `S7D2 ${moduleId}`, responsibility: `S7D2 region ${moduleId}`, paths: [path],
    interfaces: [],
  });
  const modules = Object.values(S7D2_MODULE_IDS).map(moduleId => moduleOf(moduleId, moduleId));
  return {
    requireDag: true, dependencies: [],
    modules: options.twin === true ? [...modules, moduleOf(S7D2_TWIN_MODULE_ID, S7D2_MODULE_IDS.region)] : modules,
    ...(options.containment ? { containment: { parentOf: [
      { parent: ref(S7D2_MODULE_IDS.region), child: ref(S7D2_MODULE_IDS.child) },
      { parent: ref(S7D2_MODULE_IDS.region), child: ref(S7D2_MODULE_IDS.sibling) },
    ] } } : {}),
  };
}

// ---------------------------------------------------------------------------
// The start_lines commits and the operations read
// ---------------------------------------------------------------------------

/**
 * The prepared commit that writes the project's `start_lines` record with `step` in one of `states`. It matches the
 * held commit's own records only (the encoded `CoreOperation` record), never a store read.
 */
export function startLinesStepCommit(step: S7D2OpeningDuty, states: readonly RoleLineStepStateV1[]): CommitMatch {
  return roleLineStepCommit('start_lines', step, states);
}

/** O1B-R1-04's stop for O2's RL-13 (v4 :175: the world's state is O1b's): keeps the answer of the split child's
 *  admission commit, the one that writes the `role_line_split` step `reserved`; the caller crashes the Host there. */
export function holdS7D2SplitReserved(): CommitHold {
  return commitBarrier.holdAfter(roleLineStepCommit('role_line_split', 'split', ['reserved']),
    'S7D2 role_line_split: after the child is reserved');
}

/** A commit that writes a `role_line` record of `action` whose step `step` is in one of `states`. */
function roleLineStepCommit(actionName: string, step: string, states: readonly RoleLineStepStateV1[]): CommitMatch {
  return (commit: PreparedCommit) => commit.records.some(record => {
    let value: unknown;
    try { value = JSON.parse(record.json) as unknown; } catch { return false; }
    if (!isRecord(value)) return false;
    const ref = value['ref'];
    const action = value['action'];
    if (!isRecord(ref) || ref['aggregateType'] !== 'CoreOperation' || !isRecord(action)) return false;
    if (action['kind'] !== 'role_line' || action['action'] !== actionName) return false;
    const steps: unknown[] = Array.isArray(action['steps']) ? action['steps'] as unknown[] : [];
    return steps.some(entry => isRecord(entry) && entry['key'] === step
      && (states as readonly unknown[]).includes(entry['state']));
  });
}

/** `role-lines/operations` of one workspace (default the main one); anything but `ready` throws with the answer. */
export async function readS7D2Operations(world: Pick<S6AHostWorld, 'post'>,
  scope: WorkspaceScope = S6A_SCOPE): Promise<readonly RoleLineOperationReadV1[]> {
  const answer = await world.post('role-lines/operations', plain(scope, {
    workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId },
  }));
  return valueOf<readonly RoleLineOperationReadV1[]>(answer.body, 'ready',
    `the role-line operations read (HTTP ${String(answer.httpStatus)})`);
}

/** The `start_lines` row: the one `role_line` row whose steps are the three opening keys, in order. */
export function startLinesOf(rows: readonly RoleLineOperationReadV1[]): S7D2OperationRow | null {
  const keys = ROLE_LINE_STEP_KEYS.join(',');
  for (const row of rows) {
    if (row.action === 'role_line' && row.steps.map(step => step.key).join(',') === keys) return row;
  }
  return null;
}

/** The open `responsible` link targets of a card (the public `sessions/read` shape), in link order. */
export function openTargetsOf(card: SessionCard): WorkLinkTarget[] {
  return card.links.filter(link => link.ref.relation === 'responsible' && link.until === null)
    .map(link => link.ref.target);
}

// ---------------------------------------------------------------------------
// The person routes of a role line
// ---------------------------------------------------------------------------

/** `role-lines/open`: `duty` is the HTTP field as sent (an `executor` is a body a person can send). */
export type S7D2OpenInput = { duty: string; scope: readonly RoleScopeV1[]; name?: string; requestId: string };
export type S7D2ChangeScopeInput = { session: S6ASession | SessionRef; scope: readonly RoleScopeV1[]; requestId: string };

/** One `role-lines/open` body (`meta.requestId` is the command id); `replay` sends the same body again. */
export async function openS7D2Line(world: Pick<S6AHostWorld, 'post'>, input: S7D2OpenInput):
Promise<S7D1Write<RoleLineLineV1>> {
  const body = graphWrite(S6A_SCOPE, {
    duty: input.duty, scope: [...input.scope], ...(input.name === undefined ? {} : { name: input.name }),
  }, input.requestId);
  const send = async (): Promise<WriteResult<RoleLineLineV1>> =>
    (await world.post('role-lines/open', body)).body as WriteResult<RoleLineLineV1>;
  return { result: await send(), replay: send };
}

/** One `role-lines/change-scope` body; `replay` sends the same body again. */
export async function changeS7D2Scope(world: Pick<S6AHostWorld, 'post'>, input: S7D2ChangeScopeInput):
Promise<S7D1Write<RoleLineLineV1>> {
  const body = graphWrite(S6A_SCOPE, { session: refOf(input.session), scope: [...input.scope] }, input.requestId);
  const send = async (): Promise<WriteResult<RoleLineLineV1>> =>
    (await world.post('role-lines/change-scope', body)).body as WriteResult<RoleLineLineV1>;
  return { result: await send(), replay: send };
}

/** The Session a committed role-line command names, as `sessions/read` returns it. */
export async function lineOfS7D2(world: Pick<S6AHostWorld, 'readSession'>, label: string,
  result: WriteResult<RoleLineLineV1>): Promise<S6ASession> {
  const value = valueOf<RoleLineLineV1>(result, 'committed', `the role line ${label}`);
  if (value.session === null) throw new Error(`S7D2: the role line ${label} names no Session: ${JSON.stringify(value)}`);
  return await sessionOf(world, { label, ref: value.session, operation: value.operation });
}

// ---------------------------------------------------------------------------
// Governance and RL-14's observation inputs
// ---------------------------------------------------------------------------

/**
 * The project's policy and catalog through the memory fixture's governance seed (once per world). The catalog is
 * `input.catalog`, else `s7d2Catalog` shaped by the variant: `containment_absent` without the `containment` field,
 * `ownership_ambiguous` with the twin module. `capture_failed` moves the workspace root away while the adoption's
 * automatic capture runs and puts it back after the capture settled. Answers `architecture/observation-state` after.
 */
export async function adoptS7D2Governance(world: S6AHostWorld,
  input: { catalog?: AdoptedArchitecture; observation?: S7D2ObservationVariant } = {}):
Promise<ArchitectureObservationStateV1> {
  const governance = (await seedS6AMemory(world, { architecture: false, policy: true, notes: false })).governance;
  const catalog = input.catalog ?? s7d2Catalog(S6A_SCOPE.projectId, {
    containment: input.observation !== 'containment_absent', twin: input.observation === 'ownership_ambiguous' });
  if (input.observation === 'capture_failed') {
    const away = `${world.root}-away`;
    await rename(world.root, away);
    try {
      await governance.adoptArchitecture({ catalog, settle: true });
    } finally {
      await rename(away, world.root);
    }
  } else {
    await governance.adoptArchitecture({ catalog, settle: true });
  }
  return valueOf<ArchitectureObservationStateV1>((await world.post('architecture/observation-state',
    plain(S6A_SCOPE, { workspace: S6A_SCOPE }))).body, 'ready', 'the observation state');
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

export type S7D2RoleLineWorldOptions = {
  backend: S6ABackend;
  /** X-21: spread over `{ requestDriver: 'on' }` and passed to every Host start and restart of the world. */
  extraHostOptions?: Record<string, unknown>;
  /** Host bindings added at every start (tests/helpers/S6A-request-fixture.ts `S6AExtraBinding`). */
  extraBindings?: readonly S6AExtraBinding[];
  /** The catalog `architecture/adopt-initial` adopts after the opening lines; default `s7d2Catalog`. */
  catalog?: AdoptedArchitecture;
  /** RL-14: the observation input the governance step makes (`adoptS7D2Governance`); default a ready observation. */
  observation?: S7D2ObservationVariant;
  /**
   * The adviser Work binding's Host tool grant (`openS7D2ProjectWorld`); default
   * `['read', 'send_session_message', 'create_member']` (`S7D2_ADVISER_WORK`).
   */
  adviserTools?: readonly string[];
};

export type S7D2RoleLineWorld = {
  readonly world: S6AHostWorld;
  readonly main: S6ACardsWorkspace;
  /** The `start_lines` operation, as `role-lines/operations` names it. */
  readonly startLines: OperationRef;
  /** The three opening lines, each the Session its step's child create planned. */
  readonly lines: Readonly<Record<S7D2OpeningDuty, S6ASession>>;
  /** Goal 1 of the world (G). */
  readonly goal: GoalRef;
  readonly targets: { readonly project: WorkLinkTarget; readonly goal: WorkLinkTarget };
  /** The default catalog's regions (`S7D2_MODULE_IDS`). */
  readonly modules: { readonly region: ModuleRef; readonly child: ModuleRef; readonly sibling: ModuleRef;
    readonly other: ModuleRef };
  /** `architecture/observation-state` after the governance step. */
  readonly observation: ArchitectureObservationStateV1;
  operations(): Promise<readonly RoleLineOperationReadV1[]>;
  open(input: S7D2OpenInput): Promise<S7D1Write<RoleLineLineV1>>;
  changeScope(input: S7D2ChangeScopeInput): Promise<S7D1Write<RoleLineLineV1>>;
  lineOf(label: string, result: WriteResult<RoleLineLineV1>): Promise<S6ASession>;
  readCard(line: S6ASession | SessionRef): Promise<SessionCard>;
  /** `sessions/find` of the main workspace by target (archived excluded). */
  findByTarget(target: WorkLinkTarget): Promise<SessionCard[]>;
  /** `sessions/link` through the 7D1 step (the two pins from `sessions/read`). */
  link(input: S7D1LinkInput): Promise<S7D1Write<SessionWorkLink>>;
  allocation(): Promise<RoleLineAllocationReportV1>;
  /** `projects/role-limits/set` of one open limit at the revision `projects/role-limits` reads first. */
  setOpen(duty: RoleLineDutyV1, n: number, commandId: string): Promise<RoleLimitsViewV1>;
  /** Every card `decisions/queue` shows in the main workspace. */
  cards(): Promise<DecisionCardV1[]>;
  assignMaintainer(input: { module: ModuleRef; line: S6ASession | SessionRef; requestId: string }):
    Promise<WriteResult<SessionWorkLink>>;
  /** A Work line (`sessions/create` with the world's Work role; duty executor), no links. */
  createWorkLine(label: string): Promise<S6ASession>;
  /** 7D1's `sessions/archive` and `sessions/reactivate` of one line (O4b's archive/reactivate steps). */
  archive(line: S6ASession | SessionRef, reason: string): Promise<void>;
  reactivate(line: S6ASession | SessionRef, reason: string): Promise<void>;
  close(): Promise<void>;
};

async function openHost(options: S7D2RoleLineWorldOptions): Promise<S6AHostWorld> {
  return await openS6AHostWorld({
    backend: options.backend,
    extraHostOptions: { requestDriver: 'on', ...(options.extraHostOptions ?? {}) },
    ...(options.extraBindings === undefined ? {} : { extraBindings: options.extraBindings }),
  });
}

/** The step's line: its `childOperation` read through `sessions/operation`, the create's planned Session. */
async function openingLineOf(world: S6AHostWorld, step: S7D2OperationRow['steps'][number]): Promise<S6ASession> {
  if (step.childOperation === null) throw new Error(`S7D2: the ${step.key} step names no child create: ${JSON.stringify(step)}`);
  const child = valueOf<SessionCreateOperationRecord>((await world.post('sessions/operation',
    plain(S6A_SCOPE, step.childOperation))).body, 'ready', `the ${step.key} step's child create`);
  return await sessionOf(world, { label: `s7d2-${step.key}`, ref: child.action.plannedSessionRef,
    operation: step.childOperation });
}

/** Waits for the `start_lines` operation to end, names its lines, seeds the governance and builds the handle. */
async function completeWorld(host: S6AHostWorld, options: S7D2RoleLineWorldOptions,
  release: () => void): Promise<S7D2RoleLineWorld> {
  // The one start_lines wait (`AG2b-collaboration-fixture.ts` startLinesEnded, rework-1 item 10), loud on a timeout.
  const ended = await startLinesEnded(async () => (await host.post('role-lines/operations', plain(S6A_SCOPE, {
    workspace: { projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId } }))).body);
  if (ended === null || ended.phase !== 'completed') {
    throw new Error(`S7D2: the start_lines operation did not complete: ${JSON.stringify(ended)}`);
  }
  const opened: Partial<Record<S7D2OpeningDuty, S6ASession>> = {};
  for (const step of ended.steps) {
    const duty = ROLE_LINE_STEP_KEYS.find(key => key === step.key);
    if (duty === undefined) throw new Error(`S7D2: a start_lines step has an unknown key: ${JSON.stringify(step)}`);
    opened[duty] = await openingLineOf(host, step);
  }
  const lines = { secretary: opened.secretary!, adviser: opened.adviser!, scribe: opened.scribe! };
  const observation = await adoptS7D2Governance(host, {
    ...(options.catalog === undefined ? {} : { catalog: options.catalog }),
    ...(options.observation === undefined ? {} : { observation: options.observation }),
  });

  const main = s6aCardsWorkspace(host, S6A_SCOPE);
  const goal = host.goals.first;
  const moduleRef = (moduleId: string): ModuleRef => ({ projectId: S6A_SCOPE.projectId, moduleId });
  let limitsSeq = 0;
  let closed = false;
  return {
    world: host, main, startLines: ended.operation, lines, goal, observation,
    targets: { project: S7D2_PROJECT_TARGET, goal: { kind: 'goal', ref: goal } },
    modules: { region: moduleRef(S7D2_MODULE_IDS.region), child: moduleRef(S7D2_MODULE_IDS.child),
      sibling: moduleRef(S7D2_MODULE_IDS.sibling), other: moduleRef(S7D2_MODULE_IDS.other) },
    operations: () => readS7D2Operations(host),
    open: input => openS7D2Line(host, input),
    changeScope: input => changeS7D2Scope(host, input),
    lineOf: (label, result) => lineOfS7D2(host, label, result),
    readCard: line => host.readSession(line),
    async findByTarget(target) {
      const page = valueOf<SessionPage<SessionCard>>(await main.route('sessions/find', {
        workspace: { ...S6A_SCOPE }, target, includeArchived: false, page: { limit: 100 },
      }) as ReadResult<SessionPage<SessionCard>>, 'ready', `the ${target.kind} target page`);
      return page.items;
    },
    link: input => openLink(host, input),
    allocation: () => readS7D1Allocation(host),
    async setOpen(duty, n, commandId) {
      const limits = await readS7D1Limits(host);
      limitsSeq += 1;
      return await setS7D1Open(host, duty, n, limits.revision, `${commandId}-${String(limitsSeq)}`) as unknown as RoleLimitsViewV1;
    },
    cards: () => main.readCards(),
    async assignMaintainer(input) {
      return (await host.post('modules/assign-maintainer', graphWrite(S6A_SCOPE, {
        module: input.module, line: refOf(input.line),
      }, input.requestId))).body as WriteResult<SessionWorkLink>;
    },
    createWorkLine: label => host.createWorkSession(label),
    archive: (line, reason) => archiveS7D1Session(host, refOf(line), reason),
    reactivate: (line, reason) => reactivateS7D1Session(host, refOf(line), reason),
    async close() {
      if (closed) return;
      closed = true;
      release();
      await host.close();
    },
  };
}

/** Open the world (see the header): the birth, the three opening lines and the governance. Memory or SQLite. */
export async function openS7D2RoleLineWorld(options: S7D2RoleLineWorldOptions): Promise<S7D2RoleLineWorld> {
  const host = await openHost(options);
  try {
    return await completeWorld(host, options, () => undefined);
  } catch (error) {
    await host.close().catch(() => undefined);
    throw error;
  }
}

export type S7D2BirthRun = {
  readonly world: S7D2RoleLineWorld;
  /** `role-lines/operations` while the first Host is held at the stop. */
  readonly atStop: readonly RoleLineOperationReadV1[];
};

/**
 * The birth with its one stop (see the header), then the same world as `openS7D2RoleLineWorld` on the restarted
 * Host. SQLite only: the stop is a Host restart on the same directory.
 */
export async function openS7D2BirthWorld(options: S7D2RoleLineWorldOptions & { backend: 'sqlite';
  stopAt: 'created' | 'registered' }): Promise<S7D2BirthRun> {
  const stop = options.stopAt === 'created'
    ? commitBarrier.holdAfter(startLinesStepCommit('secretary', ['created']),
      'S7D2 start_lines: after the secretary step is created')
    : commitBarrier.hold(startLinesStepCommit('secretary', ['linked', 'done', 'failed']),
      'S7D2 start_lines: before the secretary step leaves registered');
  const release = (): void => { stop.release(); };
  let host: S6AHostWorld;
  try {
    host = await openHost(options);
  } catch (error) {
    release();
    throw error;
  }
  try {
    // The read the row makes at each stop: a tree that does not publish it stops here, not at a hold.
    await readS7D2Operations(host);
    await stop.reached;
    const atStop = await readS7D2Operations(host);
    await host.crash();
    return { world: await completeWorld(host, options, release), atStop };
  } catch (error) {
    release();
    await host.close().catch(() => undefined);
    throw error;
  }
}

export type S7D2RegionWorld = S7D2RoleLineWorld & {
  /** Adviser A, opened on region `src` (which has the children `src/a`, `src/b`) through `role-lines/open`. */
  readonly regionAdviser: S6ASession;
};

/** The world plus adviser A on region `src` through `role-lines/open` (RL-03's prior; RL-13's and RL-14's L1). */
export async function openS7D2RegionWorld(options: S7D2RoleLineWorldOptions): Promise<S7D2RegionWorld> {
  const world = await openS7D2RoleLineWorld(options);
  try {
    const opened = await world.open({ duty: 'adviser', scope: [{ kind: 'region', moduleRef: world.modules.region }],
      requestId: 's7d2-region-adviser-a' });
    return { ...world, regionAdviser: await world.lineOf('s7d2-region-adviser-a', opened.result) };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The later packages' steps (O2, O4b, O5a; no O1b row asserts them)
// ---------------------------------------------------------------------------

/**
 * lead 13's too-long input for a Work Run: at the bound `min(500,000, floor(0.8 × 200,000)) = 160,000`, the Work
 * window being `AG2B_RUNTIME_BUDGET.contextWindowTokens` (200,000) on every Work binding of the world.
 */
export const S7D2_TOO_LONG_INPUT_TOKENS = 160_000;

const ADVISER_TOOLS: readonly string[] = ['read', 'send_session_message', 'create_member'];

function adviserWorkOf(tools: readonly string[]): S6AExtraBinding {
  const binding = bindingOf(PL_ADVISER_ROLE_BINDING.bindingId, PL_ADVISER_ROLE, 'S7D2 trusted adviser guidance', tools);
  return {
    binding: { ...binding, grant: { ...binding.grant, createMember: true } },
    workflow: { workspace: S6A_SCOPE, sessionRole: PL_ADVISER_ROLE, roleBinding: PL_ADVISER_ROLE_BINDING,
      budget: { tokenBudget: 1_000_000, deadline: null } },
  };
}

/**
 * The Host input Work on an adviser line needs (a Host input, rule sheet A8): the adviser Runtime binding, whose
 * grant carries the real `create_member` tool and `createMember: true` (RL-19's A), and the Workflow binding of the
 * platform adviser template, which is the opening adviser's role. The world option `adviserTools` replaces the tools.
 */
export const S7D2_ADVISER_WORK: S6AExtraBinding = adviserWorkOf(ADVISER_TOOLS);

export type S7D2SecondWorkspace = {
  readonly scope: WorkspaceScope;
  readonly workspace: S6ACardsWorkspace;
  /** A goal of the second workspace: a main-workspace line linked to it is the cross-workspace line (X-18). */
  readonly goal: GoalRef;
  /** Removes the second root; after the Host closed. */
  remove(): Promise<void>;
};

/**
 * A second workspace of the same project: a new root with the AG2b files, opened through the Host's own
 * `workspaces/open` settings route under the world's project (the Host binds the root and registers the workspace),
 * then one goal through `goals/create` there. Role lines stay in the main workspace.
 */
export async function addS7D2SecondWorkspace(world: S6AHostWorld, label = 's7d2-second'): Promise<S7D2SecondWorkspace> {
  const root = await mkdtemp(join(tmpdir(), 's7d2-second-ws-'));
  const remove = (): Promise<void> => rm(root, { recursive: true, force: true });
  try {
    await writeAG2bWorkspace(root);
    const opened = await world.settings('workspaces/open', { path: root, name: 'S7D2 second workspace',
      projectId: S6A_SCOPE.projectId, writeAllowed: false, commandsAllowed: false });
    if (opened.status !== 'ready') throw new Error(`S7D2: the second workspace did not open: ${JSON.stringify(opened)}`);
    const scope: WorkspaceScope = { projectId: opened.value.scope.projectId, workspaceId: opened.value.scope.workspaceId };
    await world.settleDetached();
    const workspace = s6aCardsWorkspace(world, scope);
    const goal = (await workspace.createGoal(`${label}-goal`, 'S7D2 goal of the second workspace')).ref;
    return { scope, workspace, goal, remove };
  } catch (error) {
    await remove();
    throw error;
  }
}

/** `sessions/link` of each target on one line (the 7D1 step, in order); every link must commit. */
export async function linkS7D2Scopes(world: S6ARequestWorld,
  input: { line: S6ASession | SessionRef; targets: readonly WorkLinkTarget[]; label: string }): Promise<SessionWorkLink[]> {
  const links: SessionWorkLink[] = [];
  for (const [index, target] of input.targets.entries()) {
    const write = await openLink(world, { line: input.line, target, requestId: `${input.label}-${String(index)}` });
    links.push(valueOf<SessionWorkLink>(write.result, 'committed', `the ${target.kind} link ${input.label}`));
  }
  return links;
}

/**
 * One real Work Run on `line` for `task` (already linked to the line): the line's scripted model serves `replies`,
 * then `workflow/advance` of `select_work` with the line as hint, stopped before the Run's checks. Every reply must
 * be consumed. Answers the Workflow steps.
 */
export async function runS7D2Work(world: S6AHostWorld, input: {
  line: S6ASession; goal: GoalRef; task: TaskTriple; label: string; replies: readonly S6AReply[];
}): Promise<AdvanceValue[]> {
  await world.scripted.script(input.line, input.replies);
  const steps = await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: input.goal, flowId: `s7d2-${input.label}`,
    sessionHint: input.line.ref, kind: 'select_work', taskId: input.task.taskId }, { stopBefore: 'open_checks' });
  const left = await world.scripted.pending(input.line);
  if (left !== 0) {
    throw new Error(`S7D2: the Work Run ${input.label} left ${String(left)} replies: ${JSON.stringify(steps.at(-1))}`);
  }
  return steps;
}

function templateIdOf(line: S6ASession): string {
  if (line.role.kind !== 'legacy_template') throw new Error(`S7D2: ${line.label} has no template role`);
  return line.role.templateId;
}

/**
 * lead 13: one real Work Run on `line` whose one model request reports `S7D2_TOO_LONG_INPUT_TOKENS` input tokens.
 * Its Task is the one Task of a new Plan on `goal` (the goal's first Plan) assigned to the line's own role.
 */
export async function runS7D2TooLongWork(world: S6AHostWorld,
  input: { line: S6ASession; goal: GoalRef; label: string }): Promise<{ task: TaskTriple }> {
  const { tasks } = await adoptPLMixedPlan(world, { goal: input.goal, label: input.label,
    tasks: [{ taskId: `${input.label}-work`, role: templateIdOf(input.line) }] });
  const task = tasks[0]!;
  await linkS7D2Scopes(world, { line: input.line, targets: [{ kind: 'task', ref: task }], label: `${input.label}-task` });
  await runS7D2Work(world, { line: input.line, goal: input.goal, task, label: input.label,
    replies: [{ kind: 'text', text: `S7D2 ${input.label} done`, usage: usageOf(S7D2_TOO_LONG_INPUT_TOKENS) }] });
  return { task };
}

/**
 * The real `create_member` tool called by `caller`'s Work Run on `callerTask` (linked here), asking for an executor
 * on `memberTask`; answers the tool's own result. The caller's Work binding must carry the tool and `createMember`
 * (`S7D2_ADVISER_WORK` for an adviser), and the goal's autonomy decides direct or card (7D1/7C rules). A second
 * caller asking for the same `memberTask` is the reuse.
 */
export async function askS7D2Member(world: S6AHostWorld, input: {
  caller: S6ASession; goal: GoalRef; callerTask: TaskTriple; memberTask: TaskTriple; label: string;
}): Promise<MemberRequestResultV1> {
  await linkS7D2Scopes(world, { line: input.caller, targets: [{ kind: 'task', ref: input.callerTask }],
    label: `${input.label}-task` });
  const callId = `${input.label}-create-member`;
  await runS7D2Work(world, { line: input.caller, goal: input.goal, task: input.callerTask, label: input.label,
    replies: [
      { kind: 'calls', calls: [{ callId, name: 'create_member',
        args: { duty: 'executor', scope: { kind: 'task', task: input.memberTask }, reason: `S7D2 ${input.label}` } }] },
      { kind: 'text', text: `S7D2 ${input.label} asked` },
    ] });
  return jsonOf(await world.scripted.requests(input.caller), callId) as MemberRequestResultV1;
}

/**
 * RL-19 (lead 11-04 F2): member E's Task Runs driven from `select_work` until the Workflow stops
 * (`drivePLTaskRunsToStop`), E's one scripted reply failing the Run, so the real automatic requeue has no new basis
 * and the Task carries a `stop` deviation (PL-38's stop case). Answers the Runs and the Workflow steps.
 */
export async function driveS7D2MemberDeviation(world: S6AHostWorld, input: {
  member: S6ASession; goal: GoalRef; task: TaskTriple; label: string;
}): ReturnType<typeof drivePLTaskRunsToStop> {
  return await drivePLTaskRunsToStop(world, { goal: input.goal, line: input.member, taskId: input.task.taskId,
    flowId: `s7d2-${input.label}`, replies: [{ kind: 'fail', message: `S7D2 ${input.label}: the member Run fails` }] });
}

/**
 * The person's full handoff of `source` to a new line of `duty`: the published `sessionHandoff.acceptHandoff` (as
 * 7D1's handoff seed calls it) with every open responsible Task of the source, then `driveS6BHandoff` until the
 * successor exists (with the request driver on, the successor's create may still be accepted on a first drive).
 */
export async function handoffS7D2Line(world: S6AHostWorld, input: {
  source: S6ASession; duty: PlatformDutyV1; commandId: string;
}): Promise<{ operation: OperationRef; successor: SessionRef }> {
  const card = await world.readSession(input.source);
  const tasks = card.links.flatMap(link => link.ref.relation === 'responsible' && link.until === null
    && link.ref.target.kind === 'task' ? [link.ref.target.ref] : []);
  const accepted = await world.platform.sessionHandoff.acceptHandoff(world.humanContext(), {
    commandId: input.commandId, workspace: { ...S6A_SCOPE }, source: input.source.ref, trigger: 'manual',
    assignments: [{ target: { kind: 'create', duty: input.duty }, tasks }],
  });
  const { operation } = valueOf<{ operation: OperationRef }>(accepted, 'committed', `the handoff ${input.commandId}`);
  const drive = await waitFor(() => driveS6BHandoff(world, { operation }),
    value => value.progress !== null && value.progress.successor !== null, `the successor of ${input.commandId}`);
  const successor = drive.progress?.successor ?? null;
  if (successor === null) throw new Error(`S7D2: the handoff ${input.commandId} made no successor`);
  return { operation, successor };
}

export type S7D2ProjectWorld = S7D2RegionWorld & {
  readonly second: S7D2SecondWorkspace;
  /**
   * The opening adviser and scribe with goal, module and project links (their opening project link kept): the
   * adviser on the second workspace's goal (the cross-workspace line, X-18) and region `docs`, the scribe on goal G
   * and region `src/b`. Neither touches an adviser claim under A's `src`.
   */
  readonly scoped: { readonly adviser: S6ASession; readonly scribe: S6ASession };
  /**
   * lead 13: an adviser opened on goal 2 alone through `role-lines/open` (one scope, so no strict subrange) and its
   * one real Work Run on goal 2's first Plan, reporting `S7D2_TOO_LONG_INPUT_TOKENS`.
   */
  readonly tooLong: { readonly line: S6ASession; readonly task: TaskTriple };
};

/** The region world with `S7D2_ADVISER_WORK`, a second workspace, the scoped lines and the too-long Work Run. */
export async function openS7D2ProjectWorld(options: S7D2RoleLineWorldOptions): Promise<S7D2ProjectWorld> {
  const world = await openS7D2RegionWorld({ ...options,
    extraBindings: [options.adviserTools === undefined ? S7D2_ADVISER_WORK : adviserWorkOf(options.adviserTools),
      ...(options.extraBindings ?? [])] });
  let second: S7D2SecondWorkspace | null = null;
  try {
    second = await addS7D2SecondWorkspace(world.world);
    await linkS7D2Scopes(world.world, { line: world.lines.adviser, label: 's7d2-scoped-adviser',
      targets: [{ kind: 'goal', ref: second.goal }, { kind: 'module', ref: world.modules.other }] });
    await linkS7D2Scopes(world.world, { line: world.lines.scribe, label: 's7d2-scoped-scribe',
      targets: [world.targets.goal, { kind: 'module', ref: world.modules.sibling }] });
    const goal = world.world.goals.second;
    const line = await world.lineOf('s7d2-too-long-adviser', (await world.open({ duty: 'adviser',
      scope: [{ kind: 'goal', goalRef: goal }], requestId: 's7d2-too-long-adviser' })).result);
    const { task } = await runS7D2TooLongWork(world.world, { line, goal, label: 's7d2-too-long' });
    const added = second;
    return {
      ...world, second: added,
      scoped: { adviser: world.lines.adviser, scribe: world.lines.scribe },
      tooLong: { line, task },
      async close() {
        try { await world.close(); } finally { await added.remove(); }
      },
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    await second?.remove();
    throw error;
  }
}

/**
 * O2b's RL-13 stops (o2b start ruling 3; v4 :3250): the first commit that writes the `role_line_split` record whose
 * `action.phase` is `state` — `planned` is the acceptance's first write, `linked` the scope move's commit that carries
 * the `linked` record. `'after'` lets it land and keeps its answer (`holdAfter`), `'before'` keeps it before it
 * commits (`hold`). The record is picked by `roleLineStepCommit` (the split step only reaches these three states) and
 * its phase is read from the same `record.json`.
 */
export function holdS7D2SplitStep(state: 'planned' | 'admitted' | 'created' | 'linked',
  when: 'before' | 'after'): CommitHold {
  const isSplit = roleLineStepCommit('role_line_split', 'split', ['pending', 'reserved', 'created']);
  const match: CommitMatch = commit => commit.records.some(record => isSplit({ ...commit, records: [record] })
    && (JSON.parse(record.json) as { action: { phase?: unknown } }).action.phase === state);
  const label = `S7D2 role_line_split: ${when} the ${state} write`;
  return when === 'after' ? commitBarrier.holdAfter(match, label) : commitBarrier.hold(match, label);
}

/** `freezeS7D2SplitAfter`'s handle: `stopMatching()` before the crash; `release()` lets every held commit go. */
export type S7D2SplitFreeze = CommitHold & { stopMatching(): void };

/**
 * O2b-RW1 (lead 11-04): the RL-13 D stop that also stops the split there. The first commit that writes the
 * `role_line_split` record at `state` is picked as `holdS7D2SplitStep` picks it and kept after it lands (`holdAfter`);
 * from that commit on, every later commit that writes the same operation record is kept before it commits (one
 * `hold` each, the next armed in the same match), so no second driver (the Host's lifecycle queue) moves the operation
 * past `state` while the test reads it and crashes. `stopMatching()` lets the new Host's commits through and keeps the
 * held ones held; `release()` also stops matching and lets every held commit go.
 */
export function freezeS7D2SplitAfter(state: 'planned' | 'admitted' | 'created' | 'linked'): S7D2SplitFreeze {
  const isSplit = roleLineStepCommit('role_line_split', 'split', ['pending', 'reserved', 'created']);
  const operationIdOf = (json: string): unknown => {
    let value: unknown;
    try { value = JSON.parse(json) as unknown; } catch { return null; }
    const ref = isRecord(value) ? value['ref'] : null;
    return isRecord(ref) && ref['aggregateType'] === 'CoreOperation' ? ref['operationId'] : null;
  };
  let operationId: unknown = null;
  let matching = true;
  const label = `S7D2 role_line_split: after the ${state} write, then frozen`;
  const first = commitBarrier.holdAfter(commit => {
    const record = commit.records.find(entry => isSplit({ ...commit, records: [entry] })
      && (JSON.parse(entry.json) as { action: { phase?: unknown } }).action.phase === state);
    if (record === undefined) return false;
    operationId = operationIdOf(record.json);
    return true;
  }, label);
  const later: CommitHold[] = [];
  const arm = (): void => {
    later.push(commitBarrier.hold(commit => {
      if (!matching || operationId === null || !commit.records.some(record => operationIdOf(record.json) === operationId)) {
        return false;
      }
      arm();
      return true;
    }, `${label}: later write ${String(later.length + 1)}`));
  };
  arm();
  return {
    reached: first.reached,
    stopMatching() { matching = false; },
    release() {
      matching = false;
      first.release();
      for (const hold of later) hold.release();
    },
  };
}
