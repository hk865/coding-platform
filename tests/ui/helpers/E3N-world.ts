import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GoalRef } from '../../../src/contracts/ledger.js';
import type { QueryJobRef, RequestReferenceInputV1 } from '../../../src/contracts/query-job.js';
import type { CoreScope } from '../../../src/app/core-http-types.js';
import {
  S6A_SCOPE, S6A_WORK_ROLE, openS6ARequestWorld,
  type S6ABackend, type S6ARequestWorld, type S6ASession, type S6AWorldOptions,
} from '../../helpers/S6A-request-fixture.js';
import { gitIn } from '../../scenarios/support/git-workspace.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../../helpers/S6A-host-fixture.js';
import { s6aCardsWorkspace } from '../../helpers/S6A-cards-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../../helpers/S6B1-fixture.js';
import { completeS7BGoal, refinementPlanFrom } from '../../helpers/S7B-V-fixture.js';
import { sessionOf } from '../../helpers/S7A-fixture.js';
import { secretaryAnswer, type S6AIdea } from '../../helpers/S6A-history-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from '../../helpers/request-claim-steps.js';
import { readActivePlan } from '../../scenarios/support/S5-decisions.js';
import {
  AG2B_GATE_TASK_ID, ag2bChecksConfiguration, ag2bPlanDraft, graphWrite, plain,
} from '../../helpers/AG2b-collaboration-fixture.js';

/**
 * E3W worlds (run sheet §1.3): one real S6A Host world per row. W1 is the
 * two-Goal world plus one secretary and one executor line; W2 adds an archived
 * executor; W3 is W1 on SQLite; W4 completes the old Plan through the public
 * Workflow + completeGoal and then adopts the next Plan, so the GoalPhase
 * revision the page reads is non-zero.
 */

export type E3NWorld = {
  world: S6ARequestWorld;
  secretary: S6ASession;
  work: S6ASession;
};

const root = fileURLToPath(new URL('../../..', import.meta.url));

export async function openW1(backend: S6ABackend = 'memory'): Promise<E3NWorld> {
  return await openW1With({ backend });
}

async function openW1With(options: S6AWorldOptions): Promise<E3NWorld> {
  const world = await openS6ARequestWorld(options);
  try {
    const secretary = await world.createSecretary('e3n-secretary');
    const work = await world.createWorkSession('e3n-work');
    return { world, secretary, work };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

export async function openW2(): Promise<E3NWorld & { archived: S6ASession }> {
  const opened = await openW1('memory');
  try {
    const archived = await opened.world.createWorkSession('e3n-archived');
    await opened.world.archive(archived);
    return { ...opened, archived };
  } catch (error) {
    await opened.world.close().catch(() => undefined);
    throw error;
  }
}

export async function openW3(): Promise<E3NWorld> {
  return await openW1('sqlite');
}

/**
 * The old Plan is satisfied by the public Workflow and `completeGoal`; the next
 * Plan is then proposed against the active Plan and adopted. `tasks/query`
 * keeps the old completion (`revision` 1) with `selectedPlanMatches: false`,
 * which is the non-zero GoalPhase pin N33 reads. `emptyStage` (E3U, lead
 * 11-12) adds one plan stage no task belongs to (`E3U_EMPTY_STAGE`).
 */
export async function openW4(options: { nextPlan?: boolean; emptyStage?: true } = {}): Promise<{ world: S6AHostWorld; goal: GoalRef }> {
  const world = await openS6AHostWorld({ backend: 'memory' });
  try {
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = world.goals.first;
    await governS6B(world, ws, world.goals);
    await adoptS6BPlan(ws, goal, {
      label: 'e3n-w4', taskIds: ['e3n-w4-work'], role: S6A_WORK_ROLE.templateId,
    });
    await completeS7BGoal({ world, goalRef: goal });
    if (options.nextPlan === false) return { world, goal };

    const active = await readActivePlan(world.platform, world.humanContext(), goal);
    const draft = (JSON.parse(refinementPlanFrom(active, goal, {
      label: 'e3n-w4-next', taskId: 'e3n-w4-next', role: S6A_WORK_ROLE.templateId,
    })) as { plan: Record<string, unknown> }).plan;
    if (options.emptyStage === true) {
      draft['stages'] = [...(draft['stages'] as unknown[]), { stageId: 'e3u-empty-stage', title: E3U_EMPTY_STAGE }];
    }
    const goalRead = await world.post('goals/read', plain(S6A_SCOPE, goal));
    if (goalRead.body === null || (goalRead.body as { status?: string }).status !== 'ready') {
      throw new Error(`E3N W4: the completed Goal is not readable: ${JSON.stringify(goalRead.body)}`);
    }
    const revision = (goalRead.body as { value: { goal: { revision: number } } }).value.goal.revision;
    const proposed = await world.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: goal, basedOn: active.ref, draft,
      reason: { text: 'E3N W4 next Plan', sources: [] },
    }, 'e3n-w4-propose', [{ ref: goal, revision }]));
    const proposal = proposed.body as { status?: string; value?: { ref: unknown; revision: number } };
    if (proposal.status !== 'committed' || proposal.value === undefined) {
      throw new Error(`E3N W4: the next Plan was not proposed: ${JSON.stringify(proposed.body)}`);
    }
    const applied = await world.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: proposal.value.ref, expectedProposalRevision: proposal.value.revision, decisionRefs: [],
    }, 'e3n-w4-apply'));
    if ((applied.body as { status?: string }).status !== 'committed') {
      throw new Error(`E3N W4: the next Plan was not adopted: ${JSON.stringify(applied.body)}`);
    }
    return { world, goal };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** The title of `openW4({ emptyStage: true })`'s stage without tasks. */
export const E3U_EMPTY_STAGE = 'E3U 空阶段';

/** `goals/control` cancel through the public route: read the Goal, then commit with both pins. */
export async function cancelGoal(world: S6ARequestWorld, goal: GoalRef): Promise<void> {
  const read = await world.post('goals/read', plain(S6A_SCOPE, goal));
  const body = read.body as { status?: string; value?: { goal: { revision: number } } };
  if (body.status !== 'ready' || body.value === undefined) {
    throw new Error(`E3N: the Goal is not readable before cancel: ${JSON.stringify(read.body)}`);
  }
  const phase = { aggregateType: 'GoalPhase', projectId: goal.projectId, goalId: goal.goalId } as const;
  const answer = await world.post('goals/control', graphWrite(S6A_SCOPE, {
    goalRef: goal, control: 'cancel', reason: null,
  }, `e3n-cancel-${goal.goalId}-${body.value.goal.revision}`, [
    { ref: goal, revision: body.value.goal.revision }, { ref: phase, revision: 0 },
  ]));
  if ((answer.body as { status?: string }).status !== 'committed') {
    throw new Error(`E3N: the cancel did not commit: ${JSON.stringify(answer.body)}`);
  }
}

/**
 * N17 needs the built static pages in the world's own public directory. The
 * build goes to its own temporary directory (the build script's optional
 * argument), then every entry is copied beside `index.html`; the returned
 * directory is removed by the caller.
 */
export async function copyBuiltWorkbench(publicDir: string): Promise<string> {
  const buildDir = await mkdtemp(join(tmpdir(), 'e3n-build-'));
  try {
    execFileSync(process.execPath, [join(root, 'scripts/build-ui.mjs'), buildDir], { cwd: root, stdio: 'pipe' });
    for (const entry of await readdir(buildDir)) {
      await cp(join(buildDir, entry), join(publicDir, entry), { recursive: true });
    }
    return buildDir;
  } catch (error) {
    await rm(buildDir, { recursive: true, force: true });
    throw error;
  }
}

export async function removeBuild(buildDir: string): Promise<void> {
  await rm(buildDir, { recursive: true, force: true });
}

export const E3N_BOARDS = join(root, 'src/ui/boards');

/* ------------------------------------------------- E3U Main package A worlds */

/**
 * WA (E3U thread rows): W1's two Goals, one secretary and one executor on the
 * Host world whose project has its architecture and completion policy, so a
 * secretary round runs as `semantic_query` and its answer is the scripted body
 * as it is (W1 has neither pointer: its rounds answer the v2 coordination text).
 */
export type E3NAnswerWorld = { world: S6AHostWorld; secretary: S6ASession; work: S6ASession };

export async function openWA(): Promise<E3NAnswerWorld> {
  const world = await openS6AHostWorld({ backend: 'memory' });
  try {
    await ensureProjectPointers(world);
    const secretary = await world.createSecretary('e3u-secretary');
    const work = await world.createWorkSession('e3u-work');
    return { world, secretary, work };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** One request through the public `requests/submit` (no recipient: the Host assigns the secretary). */
export async function submitRequest(world: S6ARequestWorld, input: {
  commandId: string; text: string; goalId?: string | null; references?: RequestReferenceInputV1[];
}): Promise<{ requestRoot: QueryJobRef; round: QueryJobRef }> {
  const answer = await world.post('requests/submit', plain(S6A_SCOPE, {
    commandId: input.commandId, goalId: input.goalId === undefined ? world.goals.first.goalId : input.goalId,
    text: input.text, continues: null, recipient: null, references: input.references ?? [],
  }));
  const body = answer.body as { status?: string; requestRoot?: QueryJobRef; round?: QueryJobRef };
  if (body.status !== 'queued' || body.requestRoot === undefined || body.round === undefined) {
    throw new Error(`E3U: the request was not queued: ${JSON.stringify(answer.body)}`);
  }
  return { requestRoot: body.requestRoot, round: body.round };
}

/**
 * The secretary answers one submitted request with `answer`: `queries/claim`
 * with the published secretary profile (this sets the round's `session`),
 * `queries/prepare`, the scripted reply, `queries/start`, then the request
 * reads the answer.
 */
export async function answerRequest(opened: E3NAnswerWorld, input: {
  commandId: string; text: string; answer: string; references?: RequestReferenceInputV1[];
  ideas?: readonly S6AIdea[];
}): Promise<{ requestRoot: QueryJobRef; round: QueryJobRef }> {
  const { world, secretary } = opened;
  const request = await submitRequest(world, input);
  const claimed = await claimWithSecretaryProfile(world, request.round, secretary, `${input.commandId}-claim`);
  if (claimed['status'] !== 'committed') throw new Error(`E3U: the round was not claimed: ${JSON.stringify(claimed)}`);
  const prepared = await prepareAttempt(world, request.round, `${input.commandId}-prepare`);
  await world.scripted.script(secretary, [{ kind: 'text', text: secretaryAnswer({ body: input.answer, ideas: input.ideas ?? [] }) }]);
  await start(world, prepared, `${input.commandId}-start`);
  await world.waitForRequest(request.requestRoot, (view) => view.rounds.some((round) =>
    round.ref.queryJobId === request.round.queryJobId && round.answer !== null), `${input.commandId} answered`);
  return request;
}

/**
 * W5 (T-A05): `governS6B` + `adoptS6BPlan` adopt a Plan of two Tasks (the
 * work Task and the draft's gate); the public Workflow drives the work Task to
 * `satisfied` and stops at the next selection, so the gate stays `pending`.
 * Then a secretary round is claimed, so `lines/list` counts one working line.
 */
export const E3N_W5_WORK = 'e3u-w5-work';

export async function openWProgress(): Promise<{ world: S6AHostWorld; goal: GoalRef }> {
  const world = await openS6AHostWorld({ backend: 'memory' });
  try {
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = world.goals.first;
    await governS6B(world, ws, world.goals);
    await adoptS6BPlan(ws, goal, { label: 'e3u-w5', taskIds: [E3N_W5_WORK], role: S6A_WORK_ROLE.templateId });
    world.platform.registerCheckConfiguration({ configuration: ag2bChecksConfiguration({
      actor: world.ag2b.actor, command: 'true' }) });
    const line = await sessionOf(world, await createS6BLine(ws, { label: 'e3u-w5-line', role: S6A_WORK_ROLE,
      tasks: [{ projectId: S6A_SCOPE.projectId, goalId: goal.goalId, taskId: E3N_W5_WORK }] }));
    await world.scripted.script(line, [{ kind: 'text', text: 'E3U W5: the work Task is done' }]);
    let current: Record<string, unknown> = { schemaVersion: 1, goalRef: goal, flowId: 'e3u-w5', sessionHint: line.ref,
      kind: 'select_work', taskId: E3N_W5_WORK };
    for (let guard = 0; ; guard += 1) {
      if (guard === 32) throw new Error('E3N W5: the Workflow did not settle within the step guard');
      const body = (await world.post('workflow/advance', plain(S6A_SCOPE, current))).body as {
        status?: string; value?: { state: string; next: Record<string, unknown> | null };
      };
      if (body.status !== 'ready' || body.value === undefined) {
        throw new Error(`E3N W5: the Workflow call was not ready: ${JSON.stringify(body)}`);
      }
      const next = body.value.next;
      if (body.value.state === 'completed' || next === null || next['kind'] === 'select_work') break;
      current = next;
    }
    const secretary = await world.createSecretary('e3u-w5-secretary');
    const request = await submitRequest(world, { commandId: 'e3u-w5-ask', text: 'E3U W5' });
    const claimed = await claimWithSecretaryProfile(world, request.round, secretary, 'e3u-w5-claim');
    if (claimed['status'] !== 'committed') throw new Error(`E3N W5: the round was not claimed: ${JSON.stringify(claimed)}`);
    return { world, goal };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/**
 * WD (Main B rework, SPEC-14): one adopted Plan of two work Tasks where
 * `E3U_WD_LATER` and the draft's `Goal gate` depend on `E3U_WD_FIRST`
 * (`executionDag.dependsOn`), through `plans/propose` + `plans/apply`
 * (`adoptS6BPlan` cannot carry the edges). No Task has started.
 */
export const E3U_WD_FIRST = 'e3u-wd-first';
export const E3U_WD_LATER = 'e3u-wd-later';

export async function openWDeps(): Promise<{ world: S6AHostWorld; goal: GoalRef }> {
  const world = await openS6AHostWorld({ backend: 'memory' });
  try {
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = world.goals.first;
    await governS6B(world, ws, world.goals);
    const draft = {
      ...ag2bPlanDraft([E3U_WD_FIRST, E3U_WD_LATER]), planId: 'e3u-wd-plan', goalId: goal.goalId,
      assignments: [E3U_WD_FIRST, E3U_WD_LATER].map((taskId) => ({
        taskId, role: S6A_WORK_ROLE.templateId, instruction: `E3U WD ${taskId}` })),
      executionDag: { dependsOn: [E3U_WD_LATER, AG2B_GATE_TASK_ID].map((taskId) => ({ taskId, dependsOnId: E3U_WD_FIRST,
        requires: { kind: 'output-contract' as const, label: 'E3U WD first output' } })) },
    };
    const goalRead = (await world.post('goals/read', plain(S6A_SCOPE, goal))).body as
      { status?: string; value?: { goal: { revision: number } } };
    if (goalRead.status !== 'ready' || goalRead.value === undefined) {
      throw new Error(`E3N WD: the Goal is not readable: ${JSON.stringify(goalRead)}`);
    }
    const proposed = (await world.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: goal, basedOn: null, draft, reason: { text: 'E3U WD', sources: [] },
    }, 'e3u-wd-propose', [{ ref: goal, revision: goalRead.value.goal.revision }]))).body as
      { status?: string; value?: { ref: unknown; revision: number } };
    if (proposed.status !== 'committed' || proposed.value === undefined) {
      throw new Error(`E3N WD: the Plan was not proposed: ${JSON.stringify(proposed)}`);
    }
    const applied = (await world.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
    }, 'e3u-wd-apply'))).body as { status?: string };
    if (applied.status !== 'committed') throw new Error(`E3N WD: the Plan was not adopted: ${JSON.stringify(applied)}`);
    return { world, goal };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/**
 * T-A06's card title, written by hand from the Decide wording (E3-DECIDE, a
 * `goal_cause` card is named by its Task's stop word, else 需要你决定): the
 * interruption card's first Task pin is the gate, which has no stop.
 */
export const E3N_INTERRUPTED_TITLE = '需要你决定';
/** T-A07's two cards of the budget world: the Goal's `no_adviser` card and the Run's `budget_exhausted` stop. */
export const E3N_BUDGET_TITLES = ['需要你决定', '预算耗尽'];

/* ------------------------------------------------- E3U Main package B worlds */

/**
 * The working-tree text of `src/module.ts` in WG and WW, written by hand. Its
 * SHA-256 (the Kernel revision `files/read` gives as `digest`) is
 * `E3U_MODULE_SHA`, worked out once from these bytes.
 */
export const E3U_MODULE_TEXT = '第一行\n第二行\n第三行\n';
export const E3U_MODULE_SHA = '6fa7f1cf91d3fecd5e8f45f43e5b8c3c578f43be2d2e37a0395be2998e134066';
/** WG's committed `src/module.ts`: against `E3U_MODULE_TEXT` git counts 旧的第二行 deleted, 第二行 and 第三行 added (+2 −1). */
export const E3U_WG_COMMITTED = '第一行\n旧的第二行\n';

/**
 * WG (Main B sheet §0): W1, then the world's own workspace becomes a git
 * repository whose one commit holds `E3U_WG_COMMITTED`, `README.md` ("旧") and
 * the fixture's `tsconfig.json`; the working tree then gets `E3U_MODULE_TEXT`
 * and `README.md` "新" (+1 −1). `files/list` is these three paths, README.md
 * first, so `files/uncommitted` checks all three and the first listed and
 * first changed file is never the `src/module.ts` a row opens (TESTS-1).
 *
 * Lead 11-12 item 4 adds two shapes after the commit: `manyFiles` writes that
 * many more files under `zz-many/` (the listing passes 100; they sort after the three
 * WG paths, so those stay in the first 100 checked), and `lockedDir`
 * makes `src/locked/` unreadable (mode 000), so the Kernel's listing reports
 * `partial` while it still lists only the three paths. A locked world must call
 * `unlockWGit` before it closes. `oddFiles` (READS-8) commits `src/big.txt`
 * and then writes it past the 1 MiB read limit (git cannot compare it:
 * `unknown`), and adds the untracked binary `src/blob.bin` (`uncommitted`,
 * `lines: null`).
 */
export async function openWGit(options: { manyFiles?: number; lockedDir?: true; oddFiles?: true } = {}): Promise<E3NWorld> {
  const opened = await openW1();
  try {
    const file = join(opened.world.root, 'src/module.ts');
    const readme = join(opened.world.root, 'README.md');
    const big = join(opened.world.root, 'src/big.txt');
    await writeFile(file, E3U_WG_COMMITTED);
    await writeFile(readme, '旧\n');
    if (options.oddFiles === true) await writeFile(big, 'small\n');
    gitIn(opened.world.root, 'init', '-q', '-b', 'main');
    gitIn(opened.world.root, 'add', '--', 'README.md', 'src/module.ts', 'tsconfig.json',
      ...(options.oddFiles === true ? ['src/big.txt'] : []));
    gitIn(opened.world.root, 'commit', '-q', '-m', 'E3U WG base');
    await writeFile(file, E3U_MODULE_TEXT);
    await writeFile(readme, '新\n');
    if (options.oddFiles === true) {
      await writeFile(big, 'x'.repeat(1024 * 1024 + 1));
      await writeFile(join(opened.world.root, 'src/blob.bin'), Buffer.from([1, 0, 2]));
    }
    if (options.manyFiles !== undefined) {
      await mkdir(join(opened.world.root, 'zz-many'), { recursive: true });
      for (let n = 0; n < options.manyFiles; n += 1) {
        await writeFile(join(opened.world.root, `zz-many/m${String(n).padStart(3, '0')}.ts`), `export const m${n} = ${n};\n`);
      }
    }
    if (options.lockedDir === true) {
      await mkdir(join(opened.world.root, 'src/locked'), { recursive: true });
      await writeFile(join(opened.world.root, 'src/locked/hidden.ts'), 'export const hidden = 1;\n');
      await chmod(join(opened.world.root, 'src/locked'), 0o000);
    }
    return opened;
  } catch (error) {
    await opened.world.close().catch(() => undefined);
    throw error;
  }
}

/** Gives `openWGit({ lockedDir: true })`'s locked folder its mode back, so the world can be removed. */
export async function unlockWGit(opened: E3NWorld): Promise<void> {
  await chmod(join(opened.world.root, 'src/locked'), 0o755);
}

/**
 * WW (Main B sheet §0): W1 whose workspace grant also writes (the fixture's
 * optional `workspaceGrants`, `writePrefixes: ['.']`), with `src/module.ts`
 * holding `E3U_MODULE_TEXT`.
 */
export async function openWWritable(): Promise<E3NWorld> {
  const opened = await openW1With({ backend: 'memory', workspaceGrants: { writePrefixes: ['.'] } });
  try {
    await writeFile(join(opened.world.root, 'src/module.ts'), E3U_MODULE_TEXT);
    return opened;
  } catch (error) {
    await opened.world.close().catch(() => undefined);
    throw error;
  }
}

/**
 * The `lines/list` rows' session ids in order, read through `post` before a
 * page boots (a read after the boot goes through the page's fetch and enters
 * its log). The rail draws them after the synthetic 秘书（主对话） row.
 */
export async function lineOrder(post: (route: string, body: unknown) => Promise<unknown>,
  scope: CoreScope = S6A_SCOPE): Promise<string[]> {
  const body = await post('lines/list', plain(scope, { workspace: scope })) as
    { value?: { rows?: Array<{ key: { sessionId: string } }> } };
  return (body.value?.rows ?? []).map((row) => row.key.sessionId);
}
