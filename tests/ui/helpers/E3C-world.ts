import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionRef } from '../../../src/contracts/core/identity.js';
import type { RunRef } from '../../../src/contracts/dispatch.js';
import type { GoalRef } from '../../../src/contracts/ledger.js';
import type { TaskRow } from '../../../src/contracts/task-graph.js';
import { advanceUntil } from '../../helpers/A2-restart-fixture.js';
import { ag2bChecksConfiguration, ag2bPlanDraft, graphWrite, plain } from '../../helpers/AG2b-collaboration-fixture.js';
import { runRevisionOf } from '../../helpers/PL-deviation-fixture.js';
import { s6aCardsWorkspace } from '../../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, type S6ARequestWorld } from '../../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../../helpers/S6B1-fixture.js';
import { valueOf } from '../../helpers/S6B3-fixture.js';
import { sessionOf } from '../../helpers/S7A-fixture.js';
import { S7C1_CREATE_ROLE, type S7C1World } from '../../helpers/S7C-member-fixture.js';
import { checkRevisionOf } from '../../scenarios/harness.js';
import { bootPage, findClass, findElement, type BootedPage } from './boot-page.js';
import type { FakeElement } from './dom.js';
import { descendants, forwardPage, gateChanges, hasClass, newPageLog, routeOf, textOf, type PageLog } from './E3N-page.js';

/**
 * E3 Chain worlds and page reads (test sheet §1.1–§1.3). Every state comes
 * from a public route, the public Workflow or the Host's own check
 * configuration (A10's entry); the literals the rows assert are the sheet's.
 * The S7C world (`openS7C1World`) is the one line/execution world; the check
 * rounds and the second Goal's failed Task are added here through the same
 * public steps. Route answers are unwrapped by S6B3's `valueOf`; the Run
 * revision is PL's `runRevisionOf`.
 */

export const CHAIN_PASS_CHECK = 'chain-lint';
export const CHAIN_FAIL_CHECK = 'chain-unit';
/** Sheet §2.4 E3C-24: the second Goal's task title, a test literal. */
export const CHAIN_B_TITLE = 'Chain B task';

export type ChainRound = { ref: Record<string, unknown>; revision: number };
export type ChainChecks = {
  firstRun: RunRef; secondRun: RunRef; firstRound: ChainRound; secondRound: ChainRound | null;
  passCheck: typeof CHAIN_PASS_CHECK; failCheck: typeof CHAIN_FAIL_CHECK;
};

/** The sheet's two checks (§1.2): `chain-lint` always passes, `chain-unit` passes only once its file exists. */
function registerChainChecks(s7c: S7C1World): void {
  const host = s7c.world;
  const base = ag2bChecksConfiguration({ actor: host.ag2b.actor, revision: checkRevisionOf(2) });
  const one = base.checks[0]!;
  host.platform.registerCheckConfiguration({ configuration: { ...base, checks: [
    { ...one, checkId: CHAIN_PASS_CHECK, command: 'node -e "process.exit(0)"' },
    { ...one, checkId: CHAIN_FAIL_CHECK, command: 'test -f chain-unit.pass' },
  ] } });
}

/** One check round on `taskId`'s Run through the public Workflow: `open_checks`, both `run_check`s, then `finalize_checks`. */
async function runChecksRound(s7c: S7C1World, goal: GoalRef, line: SessionRef, taskId: string, flowId: string): Promise<void> {
  const host = s7c.world;
  const finalize = await advanceUntil(host.ag2b, { schemaVersion: 1, goalRef: goal, flowId, sessionHint: line,
    kind: 'select_work', taskId }, 'finalize_checks');
  valueOf((await host.post('workflow/advance', plain(S6A_SCOPE, finalize))).body, 'ready', 'finalize_checks');
}

/** The newest round of `run` through the public `verification/round` (its chain's head). */
async function headRound(s7c: S7C1World, run: RunRef): Promise<ChainRound> {
  const read = valueOf<{ chain: { rounds: Array<{ roundRef: Record<string, unknown>; revision: number }> } }>(
    (await s7c.world.post('verification/round', plain(S6A_SCOPE, { subjectRunRef: run }))).body, 'ready', 'the check round');
  const last = read.chain.rounds.at(-1);
  if (last === undefined) throw new Error('E3C: the Run has no check round');
  return { ref: last.roundRef, revision: last.revision };
}

/**
 * Sheet §1.2: the first round on `s7c-m1`'s ended Run (lint PASS / unit FAIL);
 * with `rounds: 2` the person's public `verification/reverify` opens the
 * successor round on the same Run after `chain-unit.pass` is written (2/2).
 */
export async function seedChainChecks(s7c: S7C1World, rounds: 1 | 2): Promise<ChainChecks> {
  registerChainChecks(s7c);
  const run = s7c.run.runRef;
  await runChecksRound(s7c, s7c.goal, s7c.lines.module.ref, 's7c-m1', 'e3c-round-1');
  const firstRound = await headRound(s7c, run);
  let secondRound: ChainRound | null = null;
  if (rounds === 2) {
    await writeFile(join(s7c.world.root, 'chain-unit.pass'), '');
    const ref = firstRound.ref as { projectId: string; goalId: string; taskId: string; roundId: string };
    const refusal = { aggregateType: 'TaskReworkRefusal', projectId: ref.projectId, goalId: ref.goalId, taskId: ref.taskId,
      operation: 'reverify', subjectId: ref.roundId };
    valueOf((await s7c.world.post('verification/reverify', graphWrite(S6A_SCOPE, {
      predecessorRoundRef: firstRound.ref, reason: 'E3C second round',
    }, `e3c-reverify-${ref.roundId}`, [{ ref: firstRound.ref, revision: firstRound.revision }, { ref: refusal, revision: 0 }]))).body,
    'committed', 'verification/reverify');
    await runChecksRound(s7c, s7c.goal, s7c.lines.module.ref, 's7c-m1', 'e3c-round-2');
    secondRound = await headRound(s7c, run);
  }
  return { firstRun: run, secondRun: run, firstRound, secondRound, passCheck: CHAIN_PASS_CHECK, failCheck: CHAIN_FAIL_CHECK };
}

/** `tasks/query`'s row of `taskId` under `goal` (a public read, taken before the page opens). */
export async function taskRowOf(world: S6ARequestWorld, goal: GoalRef, taskId: string): Promise<TaskRow> {
  const graph = valueOf<{ tasks: TaskRow[] }>((await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal }))).body,
    'ready', `the task graph of ${goal.goalId}`);
  const row = graph.tasks.find((entry) => entry.ref.taskId === taskId);
  if (row === undefined) throw new Error(`E3C: ${taskId} is not in ${goal.goalId}'s graph`);
  return row;
}

/** `goals/read`'s Goal revision (a public read, taken before the page opens). */
export async function goalRevisionOf(world: S6ARequestWorld, goal: GoalRef): Promise<number> {
  return valueOf<{ goal: { revision: number } }>((await world.post('goals/read', plain(S6A_SCOPE, goal))).body,
    'ready', `the Goal ${goal.goalId}`).goal.revision;
}

export type ChainCrossGoal = { goal: GoalRef; task: { projectId: string; goalId: string; taskId: string };
  line: SessionRef; run: RunRef; goalRevision: number; runRevision: number; row: TaskRow };

/**
 * Sheet §1.2 跨目标世界: the S6A world's second Goal gets one task titled
 * `Chain B task` (public `plans/propose`/`plans/apply`), an executor line
 * responsible for it (`sessions/create` with `initialLinks`), a Run through
 * `workflow/advance`, and the same two checks' first round (FAIL). The pins
 * and the task row are read before any page opens.
 */
export async function seedCrossGoalLine(s7c: S7C1World): Promise<ChainCrossGoal> {
  const host = s7c.world;
  const main = s6aCardsWorkspace(host, S6A_SCOPE);
  const goal = host.goals.second;
  const taskId = 'chain-b';
  const draft = ag2bPlanDraft([taskId]);
  const proposal = valueOf<{ ref: unknown; revision: number }>((await host.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: null, reason: { text: 'E3C cross-goal plan', sources: [] },
    draft: { ...draft, planId: 'e3c-plan-b', goalId: goal.goalId,
      tasks: draft.tasks.map((task) => task.taskId === taskId ? { ...task, title: CHAIN_B_TITLE } : task),
      assignments: [{ taskId, role: S7C1_CREATE_ROLE.templateId, instruction: 'E3C chain-b' }] },
  }, 'e3c-plan-b-propose', [{ ref: goal, revision: await goalRevisionOf(host, goal) }]))).body, 'committed', 'the B Plan proposal');
  valueOf((await host.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [],
  }, 'e3c-plan-b-apply'))).body, 'committed', 'the B Plan adoption');
  const task = { projectId: goal.projectId, goalId: goal.goalId, taskId };
  const line = await sessionOf(host, await createS6BLine(main, { label: 'e3c-b', role: S7C1_CREATE_ROLE, tasks: [task] }));
  await host.scripted.script(line, [{ kind: 'text', text: 'E3C chain-b answer' }]);
  registerChainChecks(s7c);
  await runChecksRound(s7c, goal, line.ref, taskId, 'e3c-b-round-1');
  const row = await taskRowOf(host, goal, taskId);
  if (row.execution === null) throw new Error('E3C: the B task has no Run');
  return { goal, task, line: line.ref, run: row.execution, row,
    goalRevision: await goalRevisionOf(host, goal), runRevision: await runRevisionOf(host, row.execution) };
}

/* -------------------------------------------------------------- the page */

export type ChainPage = { page: BootedPage; log: PageLog };

/**
 * The Chain page on a real Host (§1.1): every request is forwarded as is,
 * the change stream is held (so the counts are the page's own reads), and
 * `failOnce` makes the first call of one route a network error (E3C-23②).
 * `target` is an S6A world or a scenario Host (`h.host`, read on every call).
 */
export async function bootChain(target: { readonly base: string; readonly token: string }, search: string,
  options: { failOnce?: string } = {}): Promise<ChainPage> {
  const log = newPageLog();
  gateChanges(log);
  const forward = forwardPage(target as unknown as S6ARequestWorld, log, 'controlled');
  let failed = false;
  const page = await bootPage({ name: 'Chain', search, token: () => target.token, request: async (url, init, realFetch) => {
    if (options.failOnce !== undefined && !failed && routeOf(url) === options.failOnce) {
      failed = true;
      throw new TypeError('E3C: the network dropped this request');
    }
    return await forward(url, init, realFetch);
  } });
  return { page, log };
}

/* ------------------------------------------------------------- DOM reads */

export function byLabel(root: FakeElement, label: string): FakeElement | undefined {
  return findElement(root, (element) => element.getAttribute('aria-label') === label);
}

/** The two inbox rows of the rail (`需要你处理`): their `.row-meta` counts, in order. */
export function inboxCounts(root: FakeElement): string[] {
  const inbox = byLabel(root, '需要你处理');
  if (inbox === undefined) return [];
  return descendants(inbox).filter((element) => element.tagName.toLowerCase() === 'a')
    .map((link) => textOf(findClass(link, 'row-meta')));
}

/** The rail's Goal rows (the section under the `目标` label), in document order. */
export function goalSectionRows(root: FakeElement): FakeElement[] {
  const rail = findClass(root, 'rail');
  if (rail === undefined) return [];
  const section = descendants(rail).find((element) => hasClass(element, 'rail-sec')
    && textOf(findClass(element, 'rail-label')) === '目标');
  if (section === undefined) return [];
  return descendants(section).filter((element) => hasClass(element, 'row') && findClass(element, 'row-ord') !== undefined);
}

/** A Goal row as it reads: `目标 <ord> · <objective>`, whether the name or the `.row-ord` carries the number. */
export function goalRowLabel(row: FakeElement | undefined): string {
  if (row === undefined) return '';
  const name = textOf(findClass(row, 'row-name'));
  const ord = textOf(findClass(row, 'row-ord'));
  return name.startsWith('目标 ') || ord === '' ? name : `目标 ${ord} · ${name}`;
}

/** The `<dd>` element after the `<dt>` named `key` under `scope`. */
export function dlElement(scope: FakeElement | undefined, key: string): FakeElement | undefined {
  if (scope === undefined) return undefined;
  for (const list of descendants(scope).filter((element) => element.tagName.toLowerCase() === 'dl')) {
    const children = list.childNodes.filter((child): child is FakeElement => 'tagName' in child);
    const at = children.findIndex((child) => child.tagName.toLowerCase() === 'dt' && textOf(child) === key);
    if (at >= 0 && children[at + 1] !== undefined) return children[at + 1];
  }
  return undefined;
}

/** The value of the `<dd>` after the `<dt>` named `key` under `scope`. */
export function dlValue(scope: FakeElement | undefined, key: string): string | null {
  const element = dlElement(scope, key);
  return element === undefined ? null : textOf(element);
}

/** The dock's task bar (`aria-label="任务状态"`). */
export function taskBar(root: FakeElement): FakeElement | undefined {
  return byLabel(root, '任务状态');
}

/** The head buttons of the 对话 thread's `.grp` groups whose text contains `head`. */
export function groupHeads(root: FakeElement, head?: string): FakeElement[] {
  const thread = findClass(root, 'thread');
  if (thread === undefined) return [];
  return descendants(thread).filter((element) => hasClass(element, 'grp')).flatMap((group) => {
    const button = group.childNodes.find((child): child is FakeElement => 'tagName' in child
      && (child as FakeElement).tagName.toLowerCase() === 'button');
    return button === undefined ? [] : [button];
  }).filter((button) => head === undefined || textOf(button).includes(head));
}

/** The step rows (`.step`) under `scope`. */
export function stepRows(scope: FakeElement | undefined): FakeElement[] {
  return scope === undefined ? [] : descendants(scope).filter((element) => hasClass(element, 'step'));
}

/** Storage writes the page makes during a row (E3C-21): a recording `localStorage`/`sessionStorage`. */
export function watchStorage(): { writes: string[]; restore(): void } {
  const writes: string[] = [];
  const saved = ['localStorage', 'sessionStorage'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name] of saved) {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, name, { configurable: true, value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { writes.push(`${name}.${key}`); store.set(key, String(value)); },
      removeItem: (key: string) => { writes.push(`${name}.${key}`); store.delete(key); },
      clear: () => { writes.push(`${name}.clear`); store.clear(); },
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() { return store.size; },
    } });
  }
  return { writes, restore: () => {
    for (const [name, descriptor] of saved) {
      if (descriptor === undefined) delete (globalThis as Record<string, unknown>)[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
  } };
}
