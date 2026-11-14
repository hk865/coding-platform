import type { VersionPin } from '../../../src/contracts/core/identity.js';
import type { GoalRef } from '../../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../../src/contracts/plan.js';
import type { GoalListReadV1 } from '../../../src/core/work-graph/model/decision-contracts.js';
import {
  S6A_SCOPE, S6A_WORK_ROLE, openS6ARequestWorld,
  type S6ARequestWorld, type S6ASession,
} from '../../helpers/S6A-request-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../../helpers/S6A-host-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from '../../helpers/S6A-cards-fixture.js';
import { governS6B } from '../../helpers/S6B1-fixture.js';
import { ag2bPlanDraft, graphWrite, plain } from '../../helpers/AG2b-collaboration-fixture.js';
import { completeS7BGoal } from '../../helpers/S7B-V-fixture.js';
import { draftFrom } from '../../scenarios/support/common.js';
import { click } from './E3N-interact.js';
import { bootE3N, callsTo, countRoute, descendants, hasClass, turns, type PageLog } from './E3N-page.js';
import { findButton, type BootedPage } from './boot-page.js';
import type { FakeElement } from './dom.js';

/**
 * The E3 Goals worlds (test sheet §1.2): one real Host per row, every state
 * through a public route. W0 is the two seeded Goals plus a secretary and a
 * work line; W1 adopts one Plan per Goal whose work task lists the same two
 * catalog paths, so `goals/conflicts` projects one card; W2 completes W1's
 * earlier Plan through the public Workflow and adopts the next Plan, which
 * leaves `tasks/query.completion.snapshot.revision` at 1.
 *
 * `adoptS6BPlan` (tests/helpers/S6B1-fixture.ts:75) cannot carry `plannedFiles`,
 * and that fixture is outside this package's whitelist: `adoptOverlapPlan`
 * builds the same draft from `ag2bPlanDraft` (tests/helpers/AG2b-collaboration-fixture.ts:409)
 * and adds the two paths to its work task.
 */

/** The two overlapping paths of W1/W2, both in `s6aInitialCatalog`'s module paths (`tests/helpers/S6A-memory-fixture.ts:120`). */
export const E3G_OVERLAP = ['src/ui/views.ts', 'src/app/core-routes.ts'] as const;

export type E3GWorld = {
  world: S6ARequestWorld;
  ws: S6ACardsWorkspace;
  secretary: S6ASession;
  work: S6ASession;
};

async function sessions(world: S6ARequestWorld): Promise<Pick<E3GWorld, 'secretary' | 'work'>> {
  return { secretary: await world.createSecretary('e3g-secretary'), work: await world.createWorkSession('e3g-work') };
}

/** One Goal's Plan through `plans/propose` + `plans/apply`, its one work task listing `paths`. */
async function adoptOverlapPlan(ws: S6ACardsWorkspace, goal: GoalRef, label: string, taskId: string): Promise<void> {
  const read = (await ws.post('goals/read', plain(S6A_SCOPE, goal))) as
    { status?: string; value?: { goal: { revision: number } } };
  if (read.status !== 'ready' || read.value === undefined) {
    throw new Error(`E3G: ${goal.goalId} is not readable before its Plan: ${JSON.stringify(read)}`);
  }
  const draft: PlanRevisionDraft = {
    ...ag2bPlanDraft([taskId]), planId: `e3g-plan-${label}`, goalId: goal.goalId,
    tasks: ag2bPlanDraft([taskId]).tasks.map((task) => task.taskKind === 'work'
      ? { ...task, plannedFiles: [...E3G_OVERLAP] } : task),
    assignments: [{ taskId, role: S6A_WORK_ROLE.templateId, instruction: `E3G ${label}` }],
  };
  const proposed = (await ws.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: null, draft, reason: { text: `E3G ${label}`, sources: [] },
  }, `e3g-plan-${label}-propose`, [{ ref: goal, revision: read.value.goal.revision }]))) as
    { status?: string; value?: { ref: unknown; revision: number } };
  if (proposed.status !== 'committed' || proposed.value === undefined) {
    throw new Error(`E3G: the Plan ${label} was not proposed: ${JSON.stringify(proposed)}`);
  }
  const applied = await ws.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
  }, `e3g-plan-${label}-apply`));
  if ((applied as { status?: string }).status !== 'committed') {
    throw new Error(`E3G: the Plan ${label} was not adopted: ${JSON.stringify(applied)}`);
  }
}

/**
 * The S6A initial catalog maps modules to directory prefixes (`src`, `src/ui`),
 * so the two shared file paths are not file nodes yet. Declare them through the
 * public catalog revision before the Plans use them; the architecture map then
 * draws the files the sheet's `objects` name.
 */
async function declareOverlapFiles(ws: S6ACardsWorkspace): Promise<void> {
  const read = await ws.post('architecture/read', plain(S6A_SCOPE, { selection: { kind: 'current' } })) as
    { status?: string; value?: { baseline?: { ref?: unknown; contentDigest?: string }; catalog?: { ref?: unknown } } };
  const value = read.value;
  if (read.status !== 'ready' || value?.baseline === undefined || value.catalog === undefined) {
    throw new Error(`E3G: architecture/read is not ready: ${JSON.stringify(read)}`);
  }
  const registration = await ws.post('workspaces/registration', plain(S6A_SCOPE, { ...S6A_SCOPE })) as
    { status?: string; value?: { project?: { ref?: unknown; revision?: number }; workspace?: { ref?: unknown; revision?: number } } };
  const pinned = registration.value;
  if (registration.status !== 'ready' || pinned?.project === undefined || pinned.workspace === undefined) {
    throw new Error(`E3G: workspaces/registration is not ready: ${JSON.stringify(registration)}`);
  }
  const revised = await ws.post('architecture/revise', graphWrite(S6A_SCOPE, {
    expected: { catalogRef: value.catalog.ref, baseline: { ref: value.baseline.ref, digest: value.baseline.contentDigest } },
    ops: [
      { op: 'add_path', moduleId: 's6a-ui', path: E3G_OVERLAP[0] },
      { op: 'add_path', moduleId: 's6a-core', path: E3G_OVERLAP[1] },
    ],
    responsibilityMoves: [],
    reason: 'E3G: declare the two files both plans change',
  }, 'e3g-overlap-catalog', [
    { ref: pinned.project.ref, revision: pinned.project.revision },
    { ref: pinned.workspace.ref, revision: pinned.workspace.revision },
  ]));
  if ((revised as { status?: string }).status !== 'committed') {
    throw new Error(`E3G: the catalog did not declare the overlap files: ${JSON.stringify(revised)}`);
  }
}

/** W0: the two seeded Goals, one secretary and one executor line; no adopted Plan. */
export async function openE3GW0(): Promise<E3GWorld> {
  const world = await openS6ARequestWorld({ backend: 'memory' });
  try {
    const made = await sessions(world);
    return { world, ws: s6aCardsWorkspace(world, S6A_SCOPE), ...made };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** W1: W0 plus one adopted Plan per Goal, both work tasks listing `E3G_OVERLAP`. */
export async function openE3GW1(): Promise<E3GWorld> {
  const opened = await openE3GW0();
  try {
    await governS6B(opened.world, opened.ws, opened.world.goals);
    await declareOverlapFiles(opened.ws);
    await adoptOverlapPlan(opened.ws, opened.world.goals.first, 'one', 'e3g-one-work');
    await adoptOverlapPlan(opened.ws, opened.world.goals.second, 'two', 'e3g-two-work');
    await opened.world.settleDetached();
    return opened;
  } catch (error) {
    await opened.world.close().catch(() => undefined);
    throw error;
  }
}

/** W2: W1 with the earlier Goal's old Plan completed and its next Plan adopted (GoalPhase revision 1). */
export async function openE3GW2(): Promise<E3GWorld> {
  const world: S6AHostWorld = await openS6AHostWorld({ backend: 'memory' });
  try {
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, ws, world.goals);
    await declareOverlapFiles(ws);
    await adoptOverlapPlan(ws, world.goals.first, 'one', 'e3g-one-work');
    await adoptOverlapPlan(ws, world.goals.second, 'two', 'e3g-two-work');
    await completeS7BGoal({ world, goalRef: world.goals.first });
    const active = await ws.activePlan(world.goals.first);
    if (active === null) throw new Error('E3G: the completed Goal has no active Plan to revise');
    const read = (await ws.post('goals/read', plain(S6A_SCOPE, world.goals.first))) as
      { status?: string; value?: { goal: { revision: number } } };
    if (read.status !== 'ready' || read.value === undefined) throw new Error('E3G: the completed Goal is not readable');
    const next = draftFrom(active, 'e3g-plan-one-next', (draft) => ({
      ...draft,
      tasks: draft.tasks.map((task) => task.taskKind === 'work'
        ? { ...task, plannedFiles: [...E3G_OVERLAP] } : task),
    }));
    const proposed = (await ws.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: world.goals.first, basedOn: active.ref, draft: next,
      reason: { text: 'E3G the next Plan', sources: [] },
    }, 'e3g-plan-one-next-propose', [{ ref: world.goals.first, revision: read.value.goal.revision }]))) as
      { status?: string; value?: { ref: unknown; revision: number } };
    if (proposed.status !== 'committed' || proposed.value === undefined) {
      throw new Error(`E3G: the next Plan was not proposed: ${JSON.stringify(proposed)}`);
    }
    const applied = await ws.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
    }, 'e3g-plan-one-next-apply'));
    if ((applied as { status?: string }).status !== 'committed') {
      throw new Error(`E3G: the next Plan was not adopted: ${JSON.stringify(applied)}`);
    }
    const made = await sessions(world);
    await world.settleDetached();
    return { world, ws, ...made };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** Every Goal's pin as `goals/list` states it, in the list's order. */
export async function e3gGoalPins(world: S6ARequestWorld): Promise<VersionPin[]> {
  const answer = await world.post('goals/list', plain(S6A_SCOPE, { workspace: S6A_SCOPE }));
  const body = answer.body as { status?: string; value?: GoalListReadV1 };
  if (body.status !== 'ready' || body.value === undefined) {
    throw new Error(`E3G: goals/list is not ready: ${JSON.stringify(answer.body)}`);
  }
  return body.value.goals.map((row) => ({ ref: row.ref, revision: row.revision }));
}

/**
 * T1: the baseline every route count uses is after the first read *and* the
 * stream-open reread (E3N-2 N16 `:194-219`): the page's first read, then one
 * more read when the change stream opens. `card` says whether this world has a
 * conflict card, which adds `tasks/query` and `architecture/read` to both reads.
 */
export async function e3gSettled(log: PageLog, card: boolean): Promise<void> {
  await turns(() => countRoute(log, 'goals/list') === 2
    && countRoute(log, 'goals/conflicts') === 2
    && countRoute(log, 'architecture/read') === (card ? 2 : 0), 3_000);
}

/**
 * T2: the pins a conflict card carries, read from `goals/conflicts`; a
 * `decisions/answer` must echo exactly this set (the two Goals plus their Plan
 * revisions), never a hand-written shorter list.
 */
export async function e3gCardPins(world: S6ARequestWorld): Promise<VersionPin[]> {
  const answer = await world.post('goals/conflicts', plain(S6A_SCOPE, { workspace: S6A_SCOPE }));
  const body = answer.body as {
    status?: string; value?: { cards?: Array<{ source?: { pins?: VersionPin[] } }> };
  };
  const pins = body.status === 'ready' ? body.value?.cards?.[0]?.source?.pins : undefined;
  if (!Array.isArray(pins) || pins.length === 0) {
    throw new Error(`E3G: goals/conflicts has no card pins: ${JSON.stringify(answer.body)}`);
  }
  return pins;
}

/* ------------------------------------------------------- the Goals page's DOM */

/** The Goals order list's `role=listitem` rows, in document order. */
export function e3gGoalRows(root: FakeElement): FakeElement[] {
  const list = descendants(root).find((element) => hasClass(element, 'gx-list')
    && element.getAttribute('role') === 'list');
  return list === undefined ? [] : descendants(list).filter((element) => element.getAttribute('role') === 'listitem');
}

/**
 * Boot the Goals page on a world and wait for its first `goals/list` and its two
 * rows. `mode: 'controlled'` holds the change stream for a row that counts the
 * action's own reread.
 */
export async function openE3GGoals(world: E3GWorld['world'], search?: string,
  mode?: 'controlled'): Promise<{ page: BootedPage; log: PageLog }> {
  const booted = await bootE3N(world, 'Goals', { ...(search === undefined ? {} : { search }),
    ...(mode === undefined ? {} : { mode }) });
  await turns(() => callsTo(booted.log, 'goals/list').some((call) => call.reply !== undefined)
    && e3gGoalRows(booted.page.root).length === 2, 3_000).catch(() => undefined);
  return booted;
}

/** The `section.gx-sec[aria-label=冲突]` holder of the card and its done line. */
export function e3gConflictSection(root: FakeElement): FakeElement | undefined {
  return descendants(root).find((element) => hasClass(element, 'gx-sec')
    && element.getAttribute('aria-label') === '冲突');
}

/** The three `button.opt-top` options of the Goals conflict card. */
export function e3gConflictOptions(root: FakeElement): FakeElement[] {
  const section = e3gConflictSection(root);
  return section === undefined ? [] : descendants(section)
    .filter((element) => element.tagName.toLowerCase() === 'button' && hasClass(element, 'opt-top'));
}

/**
 * Pick `option` and press 确定, the gesture E3G-2's rows use. It returns after
 * the option is drawn selected; the caller waits for the answer's own effect.
 */
export async function decideConflict(page: BootedPage, option: number):
Promise<{ options: FakeElement[]; go: FakeElement }> {
  const options = e3gConflictOptions(page.root);
  if (options.length !== 3) throw new Error(`E3G: the conflict card has ${String(options.length)} options`);
  click(options[option]!);
  await turns(() => hasClass(options[option]!, 'is-on')
    || options[option]!.getAttribute('aria-checked') === 'true', 800);
  const go = findButton(page.root, '确定');
  if (go === undefined) throw new Error('E3G: the conflict card has no 确定');
  click(go);
  return { options, go };
}
