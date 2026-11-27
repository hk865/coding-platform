// E05: two independent Sessions in one workspace, Runs really overlapping, an actual shared file, decision 89's
// three cross-checks and three counterexamples (draft §1.1; MVP-BEHAVIOR.md:357, :366-374; slice-9-SPEC.md:660).
// Book route (9-start-rulings.frozen.md:660) after one cold-start seed Goal: a settings-opened workspace gets its
// trusted check configuration only from a saved initial-plan Answer (`evidence-service.ts:1256`,
// `host-settings-types.ts:170-182`), so the seed's adoption brings architecture, policy and checks; the E05 Goal
// itself is the explicit `goals/create` → policy → `plans/propose` → `plans/apply` → two `workflow/driver-start`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { newId, ready } from '../lib/http.mjs';
import { broken, chooseModel, coldStart, coversPath, createGoal, driverStart, ensurePolicy, executions, findAll, openProject, openRoleLine,
  proposeAndApply, runHistory, taskCard, taskRounds, testCheck, textOf, turnsOf, waitGoal } from '../lib/flows.mjs';

const MINUTE = 60_000;
const SEED = {
  'package.json': '{\n  "name": "g6-e05",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# g6-e05\n\nUsers and orders.\n',
  'src/users.js': 'export function createUser(name, email) {\n  return { name, email };\n}\n',
  'src/orders.js': 'export function createOrder(id, contactEmail) {\n  return { id, contactEmail };\n}\n',
  'src/rules.js': '// Shared validation rules.\n',
};
// Planted after both tasks started (decision 89: the copy is buried after the start, so it can always be found).
const PLANTED = {
  // The mechanical positive (P6J E05): the same top-level name in two files, uniquely pairable
  // (`duplicate-candidates.ts:84-101`). The comparison may only match same-name definitions or equal strings of at
  // least 40 characters; the file whose name differs but whose regex is the same rule is for the reviewer, not it.
  'src/legacy/contact-check.js': 'export function looksLikeMailAddress(text) {\n  return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(text);\n}\n'
    + 'export function joinPath(base, name) {\n  return `${base}/${name}`;\n}\n',
  'src/legacy/path-join.js': 'export function joinPath(base, name) {\n  return `${base}/${name}`;\n}\n',
  // name same, rule different → must not be reported
  'src/legacy/is-email.js': 'export function isEmail(value) {\n  return typeof value === \'string\' && value.length <= 254;\n}\n',
};
/** The two paths the mechanical duplicate candidate must name, in either order (P6J E05, diagnosis `duplicates`). */
export const DUPLICATE_PATHS = ['src/legacy/contact-check.js', 'src/legacy/path-join.js'];

const def = {
  id: 'E05',
  rows: ['C-182', 'C-183', 'C-185', 'C-71', 'C-73', 'C-191', 'C-208', 'C-217', 'C-218'],
  checks: [
    { id: 'overlap', rows: ['C-182', 'C-183', 'C-217'], text: '两个 Run 的 startedAt/endedAt 真实重叠，claim Session 不同' },
    { id: 'gate', rows: ['C-185'], text: '同模块重叠门回 task/module 和在跑的 Run' },
    { id: 'paths', rows: ['C-185', 'C-217'], text: '实际改动能给出具体 path（含共享文件）' },
    { id: 'kept', rows: ['C-185'], text: '两个任务的独立成果都还在，两个任务都 satisfied' },
    { id: 'single-occupancy', rows: ['C-71'], text: '同一 Session 同时最多一个写入执行（没有同 Session 时间重叠的两个 Run）' },
    { id: 'convention', rows: ['C-208'], text: '接口约定只交给一个任务写，另一个任务引用它' },
    { id: 'duplicates', rows: ['C-208'], text: 'project_source compare（duplicates:true）列出埋入的副本及两处位置' },
    { id: 'reviewer', rows: ['C-208', 'C-218'], text: '审阅者独立判断它是同一条规则（审阅要求有结论）' },
    { id: 'name-different', rows: ['C-208'], text: '名字不同、规则相同：报' },
    { id: 'name-same', rows: ['C-208'], text: '名字相同、规则不同：不报' },
    { id: 'temporary', rows: ['C-208'], text: '工作记录里明确认出的临时件在做完之前已收回；只知道写过记未覆盖' },
    { id: 'line-choice', rows: ['C-73', 'C-191'], text: '派工排除只读副本/等待/退役线并按六键排序' },
  ],
};

const plantedNames = ['contact-check', 'looksLikeMailAddress'];
const sameNameFile = 'is-email';
// Only the RULE conclusion counts (quick check #5): "名字不同但属同一条规则" is a same-rule reading; a name difference
// never reads as "not the same". The negative markers name the rule itself.
const SAME_RULE = /同一(条)?(校验)?规则|规则相同|相同的规则|一样的规则|重复|duplicate|same (validation )?rule/i;
const NOT_SAME = /规则不同|不同的规则|不是同一(条)?规则|不属于同一(条)?规则|不是重复|不算重复|并非重复|not (a )?duplicate|not the same rule|different rule/i;

/** The answer's sentences that name one of `names`, each read as `same`, `not` (a negation wins) or `unclear`. */
function conclusions(text, names) {
  return text.split(/[。；;\n]|\.\s/).filter(sentence => names.some(name => sentence.includes(name)))
    .map(sentence => ({ sentence: sentence.trim(), reading: NOT_SAME.test(sentence) ? 'not' : SAME_RULE.test(sentence) ? 'same' : 'unclear' }));
}

/**
 * Judge one conclusion from the formal answer's text (second review #5): an explicit reading decides; a mention
 * without a clear conclusion cannot be shown from the text and is `uncovered`, never a pass.
 */
function judgeSentence(rec, id, found, wantSame, label) {
  const quote = found.slice(0, 2).map(entry => `「${entry.sentence}」`).join(' ');
  if (found.length === 0) {
    if (wantSame) rec.fail(id, `正式审阅答复没有提到 ${label}`);
    else rec.pass(id, `正式审阅答复没有提到 ${label}（没有报）`);
  } else if (found.some(entry => entry.reading === 'same')) {
    rec.check(id, wantSame, `正式审阅答复说 ${label} 是同一条规则：${quote}`);
  } else if (found.every(entry => entry.reading === 'not')) {
    rec.check(id, !wantSame, `正式审阅答复说 ${label} 不是同一条规则：${quote}`);
  } else {
    rec.uncover(id, 'entry-missing', `正式审阅答复提到 ${label}，但文字没有明确结论：${quote}`);
  }
}

export function draft(goalId, moduleRef) {
  const work = (taskId, title, files) => ({ taskId, title, requirementLevel: 'required', taskKind: 'work', disposition: 'active',
    phase: 'pending', scope: { kind: 'module', stageId: 'build', moduleRef }, executionIntent: 'request_execution', plannedFiles: files });
  return {
    schemaVersion: 2, planId: `${goalId}-plan`, planRevision: 1, goalId,
    stages: [{ stageId: 'build', title: 'Build' }],
    tasks: [
      work('t-users', 'users 邮箱校验', ['src/users.js', 'src/rules.js', 'test/users.test.js']),
      work('t-orders', 'orders 邮箱校验', ['src/orders.js', 'src/rules.js', 'test/orders.test.js']),
      { taskId: 'gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [
      { taskId: 't-users', role: 'local-workbench', instruction: '在 src/users.js 的 createUser 里校验 email：必须形如 name@domain.tld，不合格抛 TypeError。校验规则写成 src/rules.js 导出的 isEmail(value)，users 引用它。加 test/users.test.js（node:test）。' },
      { taskId: 't-orders', role: 'local-workbench', instruction: '在 src/orders.js 的 createOrder 里校验 contactEmail，规则和 users 的邮箱规则相同。先查 src/rules.js 和项目里有没有现成的同一条规则，有就引用，不要另写一份。加 test/orders.test.js（node:test）。' },
    ],
    obligations: [
      { obligationId: 'o-tests', title: '测试通过', requirementLevel: 'required', taskIds: ['t-users', 't-orders', 'gate'],
        verificationRequirements: [{ requirementId: 'r-tests', requirementLevel: 'required', kind: 'static', description: 'node --test 全部通过' }] },
      { obligationId: 'o-review', title: '独立审阅', requirementLevel: 'required', taskIds: ['t-users', 't-orders'],
        verificationRequirements: [{ requirementId: 'r-review', requirementLevel: 'required', kind: 'reviewer',
          description: '独立审阅：两处邮箱校验是不是同一条规则；项目里有没有同一条规则的重复定义（名字不同也算），名字相同但规则不同的不算' }] },
    ],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

const intervalOf = item => [Date.parse(item.run.startedAt), Date.parse(item.run.endedAt ?? new Date().toISOString())];
const claimSession = item => item.outbox?.claim?.sessionRef?.sessionId ?? item.session?.ref?.sessionId ?? null;

/** The same two paths in either order (a duplicate candidate names its two locations, `duplicate-candidates.ts:41-49`). */
export const samePairPaths = (paths, expected) => paths.length === 2
  && [...paths].sort().join('\0') === [...expected].sort().join('\0');

/**
 * P6J E05: a person's release is one that committed. `goals/overlap-release` answers `released` on success and a
 * `rejected` envelope when it did not write the gate (`overlap-gates.ts:455-466`); only the former counts.
 */
export const committedRelease = answer => answer?.status === 'released' || answer?.status === 'committed';

/**
 * P6J4b (quick check p6jcr4 row 1): one poll's gates, kept per gate record — its ref and its `basisDigest`, since the
 * platform reopens the same ref with a new basis for a rework claim (`module-overlap-gate-codecs.ts` `basisDigest`).
 * Each record keeps its own latest revision (so its own release time); a new basis never overwrites an older one.
 * P6 #22: a record nobody satisfied for 10 minutes gets the person's release once (`release(gate)` → the answer); a
 * gate already satisfied answers `invalid` (`overlap-gates.ts:455-466`), so a record with a release is never sent one.
 * `gate.since` is a cursor, not a time: the age is from the driver's first sight of that record.
 */
export async function observeGates(seen, gates, { now, release }) {
  for (const gate of gates) {
    const key = `${JSON.stringify(gate.ref)}#${gate.basisDigest ?? ''}`;
    if (!seen.firstSeen.has(key)) seen.firstSeen.set(key, now);
    seen.gates.set(key, gate);
    if (gate.release === null && !seen.released.has(key) && now - seen.firstSeen.get(key) > 10 * MINUTE) {
      seen.released.set(key, await release(gate));
    }
  }
  return seen;
}

/**
 * P6J E06: E05's continuation object — a real project plus the Runs that actually started and the work lines they
 * claimed. A Run that never started (no `startedAt`) is not work, and a project with no such line has no continuation.
 */
export const continuationObject = ({ project, goalRef, runs, module }) => {
  const worked = [...runs].filter(item => item.run.startedAt != null
    && (item.outbox?.claim?.sessionRef?.sessionId ?? item.session?.ref?.sessionId) != null);
  const lines = [...new Map(worked.map(item => {
    const ref = item.outbox?.claim?.sessionRef ?? item.session?.ref;
    return [ref.sessionId, { projectId: ref.projectId, sessionId: ref.sessionId }];
  })).values()];
  return project === undefined || project === null || worked.length === 0 || lines.length === 0
    ? null : { project, goalRef, runs: worked, lines, module };
};

const firstStarted = runs => [...runs].filter(item => item.run.startedAt != null)
  .sort((left, right) => Date.parse(left.run.startedAt) - Date.parse(right.run.startedAt))[0] ?? null;
const runSpan = item => `${item.run.ref.runId}@${item.run.startedAt ?? '?'}–${item.run.endedAt ?? '仍在跑'}`;
const startOf = item => Date.parse(item.run.startedAt ?? '');
const endOf = item => Date.parse(item.run.endedAt ?? '');
const sessionOf = item => item.outbox?.claim?.sessionRef?.sessionId ?? item.session?.ref?.sessionId ?? null;

const planRevisionOf = item => item.run.planRevision ?? item.run.plan?.planRevision ?? item.plan?.planRevision ?? null;
const attemptOf = item => item.run.attemptId ?? item.run.attempt?.attemptId ?? item.attemptId ?? null;
const byStart = (left, right) => startOf(left) - startOf(right);

/**
 * P6J4b: when one claimable sample was read — from just before its first task card read (`at`) to just after the last
 * (`until`); an older sample with only `at` is a single instant.
 */
const sampleSpan = sample => [Date.parse(sample?.at ?? ''), Date.parse(sample?.until ?? sample?.at ?? '')];

/**
 * The first running sample that shows `taskId` claimable with its whole reading interval inside one of `conflictRuns`
 * (a Run with no end yet still runs) and ended before `heldBack` started: the moment the serial order missed a parallel
 * chance. A reading that straddles a conflict Run's end proves nothing (P6J4b). Null when none.
 */
export function claimableWhileRunning(samples, taskId, conflictRuns, heldBack) {
  for (const sample of samples) {
    const [from, until] = sampleSpan(sample);
    if (sample?.[taskId] !== true || !Number.isFinite(from) || !Number.isFinite(until) || !(until < startOf(heldBack))) continue;
    const run = conflictRuns.find(item => startOf(item) <= from && until < (Number.isFinite(endOf(item)) ? endOf(item) : Infinity));
    if (run !== undefined) return { sample, run };
  }
  return null;
}

/**
 * P6J4b (quick check p6jcr4 row 1): the Run a gate held back. A gate names the Attempt its Task had when it opened
 * (`workflow.ts:2573`: the current Attempt, or `none` before the first claim); the claim it held back makes a new
 * Attempt (`claim-service.ts:1609`) whose Run names the old Run as `previousRun` (`contracts/dispatch.ts:292`). So
 * `none` → the Task's first started Run (of the gate's plan) that started after the gate's running Runs; an old
 * Attempt → that Attempt's Run, then the same Task's started Run whose `previousRun` is it. Null when the chain is not
 * in what was read.
 */
export function heldBackOf(gate, taskRuns, byRun) {
  const started = taskRuns.filter(item => item.run.startedAt != null).sort(byStart);
  if (gate.waitingAttempt === undefined || gate.waitingAttempt === 'none') {
    const runningStarts = (gate.running ?? []).map(entry => byRun.get(entry.run?.runId)).filter(Boolean).map(startOf);
    const floor = runningStarts.length === 0 ? -Infinity : Math.min(...runningStarts);
    return started.find(item => startOf(item) >= floor && (gate.planRevision === undefined || planRevisionOf(item) === gate.planRevision)) ?? null;
  }
  const old = taskRuns.find(item => attemptOf(item) === gate.waitingAttempt);
  if (old === undefined) return null;
  return started.find(item => item.run.previousRun?.runId === old.run.ref.runId) ?? null;
}

/** One gate's window: its own conflict Runs and the Run it held back (null when that cannot be matched). */
const gateWindowOf = (gate, runsOf, byRun) => ({ gate, taskId: gate.waiting.taskId,
  conflict: (gate.running ?? []).map(entry => byRun.get(entry.run?.runId)).filter(Boolean),
  heldBack: heldBackOf(gate, runsOf(gate.waiting.taskId), byRun) });

const gateText = (gate, window) => `门 ${gate.moduleId}（等待 ${gate.waiting.taskId}，attempt ${gate.waitingAttempt ?? '-'}，计划 ${gate.planRevision ?? '-'}，在跑 ${
  (gate.running ?? []).map(entry => `${entry.task?.taskId}/${entry.run?.runId ?? '?'}`).join(', ')}，门记录自 ${gate.since ?? '-'}）；冲突 ${
  window.conflict.map(runSpan).join('、') || '读不到'}，被拦的 ${window.heldBack === null ? '对不上' : runSpan(window.heldBack)}`;

/**
 * One gate judged on its own timing: released while a conflict Run still ran, the held-back Run only starting after
 * they all ended, is a missed chance (`fail`); released after they ended is the gate using the chance up (`not-run`);
 * an unmatched held-back Run, a missing release time, unreadable conflict Runs or end times are named gaps.
 */
function judgeGate(window) {
  const { gate, conflict, heldBack } = window;
  const timing = gateText(gate, window);
  const missing = note => ({ status: 'uncovered', code: 'entry-missing', note: `${timing}；${note}` });
  if (heldBack === null) return missing(`门指向的 Attempt ${gate.waitingAttempt ?? '-'} 对不上读到的 Run 和它的后继（previousRun），无法归因`);
  if (gate.release?.at == null) return missing('缺门满足时刻（公开读口只有门记录；注记满足的时刻读不到，晚到的拒绝也倒推不出），并行机会是否被门耗尽无法定案');
  if (conflict.length < (gate.running ?? []).length) {
    return missing(`门记录的在跑 Run 有 ${(gate.running ?? []).length} 个，只读到 ${conflict.length} 个的时段，冲突 Run 的起止读不全，不能说门用尽了并行机会`);
  }
  if (conflict.length === 0) return missing('门没有记录在跑的冲突 Run，无法核对门是否覆盖了整个机会');
  const missingEnd = conflict.filter(item => !Number.isFinite(endOf(item)));
  if (missingEnd.length > 0) return missing(`冲突 Run ${missingEnd.map(item => item.run.ref.runId).join(', ')} 的结束时刻读不到，缺这条证据，不能判门覆盖了整个机会`);
  const lastEnd = Math.max(...conflict.map(endOf));
  const releaseAt = Date.parse(gate.release.at);
  if (!Number.isFinite(releaseAt)) return missing(`门满足时刻 ${gate.release.at} 读不成时间，并行机会是否被门耗尽无法定案`);
  if (releaseAt < lastEnd && startOf(heldBack) >= lastEnd) {
    return { status: 'fail', note: `${timing}；人放行于 ${gate.release.at}，放行时冲突 Run 还没结束，被拦的 Run 却等到 ${heldBack.run.startedAt} 才开始：有并行机会却串行` };
  }
  if (startOf(heldBack) >= lastEnd) {
    return { status: 'uncovered', code: 'not-run', note: `${timing}；人放行于 ${gate.release.at}，冲突 Run 最晚 ${new Date(lastEnd).toISOString()} 结束：同模块门用尽了并行机会` };
  }
  return missing(`人放行于 ${gate.release.at}，被拦的 Run 在冲突 Run 结束前就已开始却读不到异线重叠（同一 Session 或时段缺失），并行机会无法定案`);
}

/**
 * P6J E05 `overlap` (diagnosis row E05, pseudo-code :21-27; P6J4b, quick check p6jcr4 row 1): an overlap on two
 * different lines passes. Otherwise every window is judged on its own: the two Tasks' first Runs, and each gate's own
 * conflict Runs and the Run it held back (`heldBackOf`). A running sample whose whole reading lies inside a window's
 * conflict Run and shows its Task claimable proves a missed chance (`fail`), gate or not. A failed gate/execution read
 * leaves the rest `uncovered`. The start-time "both claimable" decides only when the gate list was read whole and no
 * gate ever waited on the later Task. Then each gate's timing: any missed chance fails; any gap stays `uncovered`
 * naming it; all gates used up is `not-run` only when one of them held back the later Task's first Run, else the first
 * serial stretch is still unexplained.
 */
export function judgeOverlap({ pair, usersRuns, ordersRuns, gates = [], claimable = null, gaps = [] }) {
  if (pair !== null) return { status: 'pass', note: pair.note };
  const users = [...usersRuns].filter(item => item.run.startedAt != null);
  const orders = [...ordersRuns].filter(item => item.run.startedAt != null);
  const firstUsers = firstStarted(users);
  const firstOrders = firstStarted(orders);
  if (firstUsers === null || firstOrders === null) {
    return { status: 'uncovered', code: 'not-run',
      note: `没有一对异线重叠；缺 ${firstUsers === null ? 't-users' : 't-orders'} 的已开工 Run，并行机会无从核对（t-users ${usersRuns.length} 个、t-orders ${ordersRuns.length} 个 Run）` };
  }
  const usersFirst = startOf(firstUsers) <= startOf(firstOrders);
  const earlier = usersFirst ? firstUsers : firstOrders;
  const later = usersFirst ? firstOrders : firstUsers;
  const runsOf = taskId => (taskId === 't-users' ? usersRuns : taskId === 't-orders' ? ordersRuns : []);
  const byRun = new Map([...usersRuns, ...ordersRuns].map(item => [item.run.ref.runId, item]));
  const samples = claimable?.samples ?? [];
  const at = claimable?.atStart === undefined ? '' : `（开工前 claimableNow：t-users ${claimable.atStart['t-users']}，t-orders ${claimable.atStart['t-orders']}）`;
  const gateWindows = gates.filter(gate => runsOf(gate.waiting?.taskId).length > 0).map(gate => gateWindowOf(gate, runsOf, byRun));
  const windows = [{ gate: null, taskId: later.run.task.taskId, conflict: [earlier], heldBack: later },
    ...gateWindows.filter(window => window.heldBack !== null)];
  for (const window of windows) {
    const hit = claimableWhileRunning(samples, window.taskId, window.conflict, window.heldBack);
    if (hit !== null) {
      return { status: 'fail', note: `${hit.sample.at}–${hit.sample.until ?? hit.sample.at} 读到 ${window.taskId} 可领取、${hit.run.run.task.taskId} 的 Run ${hit.run.run.ref.runId} 仍在跑${
        window.gate === null ? '' : `（门 ${window.gate.moduleId} 的冲突 Run）`}：同一冲突时段里有并行机会却串行（先 ${runSpan(hit.run)}，后 ${runSpan(window.heldBack)}）` };
    }
  }
  if (gaps.length > 0) return { status: 'uncovered', code: 'entry-missing',
    note: `重叠门或执行记录读不全：${gaps.join('；')}；没有异线重叠只能按已读到的门和时段核对` };
  const laterGated = gateWindows.some(window => window.taskId === later.run.task.taskId);
  if (!laterGated && claimable?.both === true) {
    return { status: 'fail',
      note: `t-users ${users.length} 个 Run、t-orders ${orders.length} 个 Run，全程串行且没有同模块门拦过后领的任务：开工前两个任务同时可领取${at}，有并行机会却串行（先 ${runSpan(earlier)}，后 ${runSpan(later)}）` };
  }
  // A sparse "no" sample is false at that instant only: it cannot prove the whole window had no opportunity.
  const readable = samples.filter(sample => typeof sample?.at === 'string');
  const sparse = `${readable.length === 0 ? '没有读到运行中的可领取样本' : `运行中可领取样本 ${readable.length} 个，都没有整段落在冲突 Run 里的是值（${
    readable.map(sample => `${sample.at}: t-users ${sample['t-users']}, t-orders ${sample['t-orders']}`).join('；')}）`}${at}`;
  if (gateWindows.length === 0) {
    return { status: 'uncovered', code: 'entry-missing',
      note: `没有同模块门拦住后领的任务，但${sparse}：稀疏的否值不能证明整个冲突时段没有并行机会；缺连续可领取样本（先 ${runSpan(earlier)}，后 ${runSpan(later)}）` };
  }
  const verdicts = gateWindows.map(judgeGate);
  const failed = verdicts.find(verdict => verdict.status === 'fail');
  if (failed !== undefined) return failed;
  const open = verdicts.filter(verdict => verdict.code === 'entry-missing');
  if (open.length > 0) return { status: 'uncovered', code: 'entry-missing', note: open.map(verdict => verdict.note).join('｜') };
  const usedUp = verdicts.map(verdict => verdict.note).join('｜');
  if (!gateWindows.some(window => window.heldBack === later)) {
    return { status: 'uncovered', code: 'entry-missing',
      note: `${usedUp}｜首段串行（先 ${runSpan(earlier)}，后 ${runSpan(later)}）没有门拦过后领任务的首个 Run，${sparse}：这一段的并行机会无从定案` };
  }
  return { status: 'uncovered', code: 'not-run', note: usedUp };
}

/**
 * P6J E05 `temporary` (SK ruling L5; diagnosis row E05): only a temporary file the work record names as such is judged.
 * `temporary` is that explicit list (a write the record later shows deleted, outside the plan); a path that was only
 * written is not evidence of a temporary file and makes the check `uncovered`. A named temporary file still present at
 * the end is `fail`; none named is `not-run`, never a pass.
 */
export function judgeTemporary({ temporary = [], written = [], insufficient = [], gaps = [], exists }) {
  if (gaps.length > 0) return { status: 'uncovered', code: 'env-unavailable', note: `工作记录读不全：${gaps.join('；')}` };
  if (temporary.length === 0) {
    if (insufficient.length > 0) return { status: 'uncovered', code: 'entry-missing',
      note: `工作记录里的临时件证据不足：${insufficient.map(entry => `${entry.path}（${entry.why}）`).join('、')}；只有写成记录 ${written.length} 处，只知道写过或只有删除字样不能算临时件` };
    return { status: 'uncovered', code: 'not-run',
      note: `工作记录里没有明确认出的临时件（只有写成记录 ${written.length} 处；只知道写过不能算临时件）` };
  }
  if (insufficient.length > 0) return { status: 'uncovered', code: 'entry-missing',
    note: `工作记录里的临时件证据不足：${insufficient.map(entry => `${entry.path}（${entry.why}）`).join('、')}；即使认出了 ${temporary.join(', ')}，这条记录也不完整` };
  const kept = temporary.filter(path => exists(path));
  if (kept.length > 0) return { status: 'fail', note: `工作记录认出的临时件没收回：${kept.join(', ')}` };
  return { status: 'pass', note: `工作记录认出的临时件 ${temporary.join(', ')} 在结束前已收回` };
}

/** The overlapping pair of the two Tasks' Runs on different Sessions, or null (the largest overlap when several). */
export function overlapPairOf(runs) {
  const of = taskId => runs.filter(item => item.run.task.taskId === taskId);
  let pair = null;
  for (const users of of('t-users')) {
    for (const orders of of('t-orders')) {
      const [a0, a1] = intervalOf(users);
      const [b0, b1] = intervalOf(orders);
      const overlap = Math.min(a1, b1) - Math.max(a0, b0);
      if (overlap > 0 && claimSession(users) !== claimSession(orders) && (pair === null || overlap > pair.overlap)) pair = { users, orders, overlap };
    }
  }
  if (pair === null) return null;
  return { ...pair, note: `重叠 ${Math.round(pair.overlap / 1000)} s：${pair.users.run.ref.runId}（${claimSession(pair.users)}）和 ${pair.orders.run.ref.runId}（${claimSession(pair.orders)}）` };
}

/** The overlap verdict from the Runs and gates the run actually read (shared by `run` and the driver tests). */
export function overlapEvidenceOf({ runs, gates = [], claimable = null, gaps = [] }) {
  const of = taskId => runs.filter(item => item.run.task.taskId === taskId);
  const pair = overlapPairOf(runs);
  const verdict = judgeOverlap({ pair: pair === null ? null : { note: pair.note }, usersRuns: of('t-users'), ordersRuns: of('t-orders'),
    claimable, gates, gaps });
  return { pair, verdict };
}

const DELETE_TOOL = /delete|remove|unlink/i;
const WRITE_TOOL = /write|save|create|edit|patch|apply|replace/i;

/** The structured operation of one successful tool result; text alone never decides it. */
export function operationOf(result) {
  for (const key of ['operation', 'op', 'mode', 'action']) {
    const value = result?.args?.[key];
    if (typeof value !== 'string') continue;
    if (DELETE_TOOL.test(value)) return 'delete';
    if (WRITE_TOOL.test(value)) return 'write';
  }
  const name = result?.name ?? '';
  if (DELETE_TOOL.test(name)) return 'delete';
  if (WRITE_TOOL.test(name)) return 'write';
  if ((result?.values ?? []).some(value => value?.deleted === true || value?.status === 'deleted')) return 'delete';
  return null;
}

/**
 * P6J4b (quick check p6jcr4 row 1): a shell command read the way the shell splits it at its top level — simple commands
 * at unquoted `;`, `&`, `|` and new lines, words at unquoted blanks, quotes removed (a quoted word is literal, so never a
 * glob). Text inside quotes is never a command: `printf '%s' 'note; rm tmp.js'` has no `rm`. Null when the command uses
 * what this reading cannot follow (an open quote, `$(`, backticks, a subshell), so no word of it counts as a delete.
 */
export function shellCommands(command) {
  const text = String(command ?? '');
  const commands = [];
  let words = [];
  let word = null;
  let quote = null;
  const endWord = () => { if (word !== null) words.push(word); word = null; };
  const endCommand = () => { endWord(); if (words.length > 0) commands.push(words); words = []; };
  const add = (ch, quoted) => { word = word ?? { text: '', quoted: false }; word.text += ch; word.quoted ||= quoted; };
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (quote !== null) {
      if (ch === quote) quote = null;
      else if (quote === '"' && (ch === '`' || (ch === '$' && text[index + 1] === '('))) return null;
      else if (quote === '"' && ch === '\\' && index + 1 < text.length) add(text[++index], true);
      else add(ch, true);
    } else if (ch === "'" || ch === '"') { quote = ch; add('', true); }
    else if (ch === '\\' && index + 1 < text.length) add(text[++index], true);
    else if (ch === '`' || ch === '(' || ch === ')' || (ch === '$' && text[index + 1] === '(')) return null;
    else if (ch === ';' || ch === '&' || ch === '|' || ch === '\n') endCommand();
    else if (/\s/.test(ch)) endWord();
    else add(ch, false);
  }
  if (quote !== null) return null;
  endCommand();
  return commands;
}

/** A shell glob word as a whole-path pattern (`*` and `?` stay inside one path segment). */
const globOf = word => new RegExp(`^${word.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`);
const workspacePath = (cwd, word) => {
  const joined = cwd === undefined || cwd === '' || cwd === '.' ? word : `${cwd.replace(/\/+$/, '')}/${word}`;
  return joined.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
};
/** A redirection word (`>`, `2>>`, `<`) and the target word after it are never operands of the command. */
const REDIRECT = /^\d*(>>?|<)$/;

/**
 * P6J4 E05 `temporary` (quick check row 1): the paths a shell command explicitly deletes — the operands of a top-level,
 * unquoted `rm`, `unlink` or `git rm` (flags and redirections skipped, the call's `cwd` applied; a directory covers
 * what is under it; an unquoted `*`/`?` is a glob). The real `shell` tool reports only the changed paths
 * (`workspace-sandbox.js:704`), so a change these words do not name, or a command this reading cannot follow, stays
 * unknown.
 */
export function shellDeletes(args) {
  const targets = [];
  for (const words of shellCommands(args?.command) ?? []) {
    const head = words[0].quoted ? null : words[0].text;
    const operands = head === 'rm' || head === 'unlink' ? words.slice(1)
      : head === 'git' && !words[1]?.quoted && words[1]?.text === 'rm' ? words.slice(2) : [];
    for (let index = 0; index < operands.length; index += 1) {
      const operand = operands[index];
      if (!operand.quoted && REDIRECT.test(operand.text)) { index += 1; continue; }
      if (operand.quoted || !/^(-|\d*[<>])/.test(operand.text)) targets.push({ path: workspacePath(args?.cwd, operand.text), glob: !operand.quoted && /[*?]/.test(operand.text) });
    }
  }
  return path => targets.some(target => (target.glob ? globOf(target.path).test(path)
    : path === target.path || path.startsWith(`${target.path}/`)));
}

/**
 * What one successful tool result did to each path it changed, from the real tool's own reply: the Kernel `edit`
 * (modes `create`/`replace`) and any write-named tool write; a delete-named tool deletes; `shell` deletes exactly the
 * paths its command names for deletion. Every other changed path is `unknown` (written or deleted cannot be told).
 */
export function pathOperationsOf(result) {
  // `"."` is the sandbox's marker for a changed workspace root (`workspace-sandbox.js:704-708`), not a file.
  const paths = (result?.changedPaths ?? []).filter(path => path !== '.');
  if (result?.name === 'shell') {
    const deletes = shellDeletes(result.args);
    return paths.map(path => ({ path, op: deletes(path) ? 'delete' : 'unknown' }));
  }
  const op = operationOf(result) ?? 'unknown';
  return paths.map(path => ({ path, op }));
}

/**
 * P6J4 E05 `temporary`: the work record's own operations, in the order the tool replies were recorded (`at`; Runs of
 * the two Tasks may interleave). Per path outside the plan: a write — or a shell change that a recognized delete later
 * follows, since that delete reported the path changed, so the file existed just before it — then a delete is a
 * temporary file. A delete with no
 * change before it, a change no recognized delete follows but that is gone at the end (`exists`), or a result only
 * whose text says "deleted", is `insufficient` (uncovered), never a temporary file and never a pass.
 */
export function temporaryEvidenceOf(turns, planned = [], exists = () => true) {
  const results = turns.flatMap(turn => turn.results).map((result, index) => ({ result, index }))
    .sort((left, right) => (Date.parse(left.result.at ?? '') || 0) - (Date.parse(right.result.at ?? '') || 0) || left.index - right.index);
  const writtenPaths = [];
  const deletedPaths = [];
  const temporaryPaths = [];
  const insufficient = [];
  const last = new Map();
  for (const { result } of results) {
    const operations = pathOperationsOf(result);
    for (const { path, op } of operations) {
      if (op === 'write') writtenPaths.push(path);
      if (op === 'delete') deletedPaths.push(path);
      if (planned.includes(path)) continue;
      if (op === 'delete') {
        if (['write', 'unknown'].includes(last.get(path))) temporaryPaths.push(path);
        else insufficient.push({ path, why: '删除记录之前没有写入记录' });
      }
      last.set(path, op);
    }
    if (operations.every(entry => entry.op !== 'delete') && /\b(deleted|removed|delete)\b|删除|已删/i.test(result.text ?? '')) {
      insufficient.push(...operations.filter(entry => !planned.includes(entry.path))
        .map(entry => ({ path: entry.path, why: '只有文本命中删除字样，没有认得出的删除操作' })));
    }
  }
  for (const [path, op] of last) {
    if (op === 'unknown' && !exists(path)) insufficient.push({ path, why: '工具改过它（回包认不出是写还是删）、结束时已不在，记录里没有认得出的删除' });
  }
  // P6J4b: a temporary file still there at the end fails only when the record shows it written again after its delete;
  // "deleted" but still there, or changed in a way not read after the delete, is a reading this cannot settle: a gap.
  const temporary = [...new Set(temporaryPaths)].filter(path => {
    if (!exists(path) || last.get(path) === 'write') return true;
    insufficient.push({ path, why: last.get(path) === 'delete' ? '记录里认出了删除，结束时文件却还在，认不准' : '删除之后又被改过（认不出是写还是删），结束时还在，认不准' });
    return false;
  });
  return { writtenPaths, deletedPaths, temporaryPaths: temporary, insufficient };
}

/** One failing check's report body (`evidence-service.ts:986` fields), or the read's own reason when it cannot be read. */
async function checkReportOf(project, check, gaps) {
  const base = { checkId: check.checkId, outcome: check.outcome ?? null, phase: check.phase ?? null, reportRef: check.reportRef ?? null };
  const body = await project.host.client.read('materials/open', project.scope,
    { ref: check.reportRef, usage: 'historical_explanation' });
  const material = ready(body);
  if (material === null || typeof material.body !== 'string') {
    const reason = `${body?.status ?? 'no answer'} ${body?.code ?? ''} ${body?.reason ?? ''}`.trim();
    gaps.push(`materials/open ${check.reportRef?.artifactId ?? '?'}: ${reason}`);
    return { ...base, unreadable: reason };
  }
  let observation = null;
  try { observation = JSON.parse(material.body)?.observation ?? null; } catch { observation = null; }
  if (observation === null) {
    gaps.push(`materials/open ${check.reportRef?.artifactId ?? '?'}: 报告正文没有 observation`);
    return { ...base, unreadable: '报告正文没有 observation' };
  }
  if (observation.kind === 'not_started') return { ...base, notStarted: observation.reason ?? null };
  // P6L E05 (diagnosis E05, next-run item 1): a failed check keeps the paths its own report says changed and the
  // error text, not only the exit code — the sixth run could not answer why the seed's `t1` stayed failed.
  // P6L2 B1: the report's own stdout/stderr and their truncation flags stay verbatim; `effects.changedPaths` is only
  // recorded as given, never parsed into a path list.
  return { ...base, exitCode: observation.exitCode ?? null, signal: observation.signal ?? null,
    timedOut: observation.timedOut ?? false, cancelled: observation.cancelled ?? false,
    stdout: observation.stdout ?? null, stderr: observation.stderr ?? null,
    paths: observation.effects?.changedPaths ?? [] };
}

/**
 * P6L E05 (diagnosis E05, next-run item 1): one Task's verification chains, each round with its failing checks and
 * every non-passing check's report. The formal evidence and the seed's own re-verification read rounds this one way;
 * `raw` keeps the round itself for the reviewer row.
 */
async function taskRoundChains(project, goalRef, taskId, gaps) {
  const chains = [];
  const raw = [];
  for (const chain of await taskRounds(project, goalRef, taskId, gaps)) {
    const rounds = [];
    for (const round of chain.rounds) {
      const failing = (round.checks ?? []).filter(check => check.outcome === 'FAIL' || check.incompleteCause != null);
      const reports = [];
      for (const check of (round.checks ?? []).filter(entry => entry.outcome !== 'PASS')) {
        if (check.reportRef == null) {
          gaps.push(`检查 ${check.checkId} 没有 reportRef，退出结果读不到`);
          continue;
        }
        reports.push(await checkReportOf(project, check, gaps));
      }
      rounds.push({ roundRef: round.roundRef, status: round.status, outcome: round.outcome,
        reverify: round.chain?.reverify ?? null,
        failing: failing.map(check => ({ checkId: check.checkId, outcome: check.outcome, phase: check.phase,
          incompleteCause: check.incompleteCause ?? null })),
        reports,
        gaps: (round.gaps ?? []).map(gap => gap.code) });
      raw.push(round);
    }
    chains.push({ runRef: chain.item.run.ref, startedAt: chain.item.run.startedAt, endedAt: chain.item.run.endedAt,
      outcome: chain.item.run.outcome, exitCode: chain.item.run.exitCode, rounds });
  }
  return { chains, raw };
}

/**
 * P6L E05 (diagnosis E05, next-run item 1): the seed Goal's re-verification. A failed round keeps its `checkId`, exit
 * code, the report's own stdout/stderr with truncation and raw `changedPaths`, plus `chain.reverify`, so why the seed check failed is answerable
 * without the original console. Reads go through the Host client only.
 */
export async function seedEvidence(project, goalRef) {
  const gaps = [];
  const body = await project.host.client.read('tasks/query', project.scope, { goalRef });
  const tasks = ready(body)?.tasks;
  if (tasks === undefined) {
    gaps.push(`tasks/query ${goalRef.goalId}: ${`${body?.status ?? 'no answer'} ${body?.code ?? ''} ${body?.reason ?? ''}`.trim()}`);
    return { goalRef, taskIds: [], rounds: {}, failures: [], gaps };
  }
  const rounds = {};
  const failures = [];
  for (const task of tasks) {
    const { chains } = await taskRoundChains(project, goalRef, task.ref.taskId, gaps);
    rounds[task.ref.taskId] = chains;
    for (const chain of chains) {
      for (const round of chain.rounds) {
        if (round.failing.length === 0 && round.reports.length === 0) continue;
        failures.push({ taskId: task.ref.taskId, runRef: chain.runRef, roundRef: round.roundRef,
          reverify: round.reverify, checks: round.failing, reports: round.reports });
      }
    }
  }
  return { goalRef, taskIds: tasks.map(task => task.ref), rounds, failures, gaps };
}

/**
 * P6L E05 (diagnosis E05, next-run item 1): the seed wait and the seed's own evidence in one place. A refused adoption
 * ends the preparation (`broken(..., null)`), but the failing round of the seed Goal still has to be kept.
 */
export async function seedRound(ctx, project, seed, rec) {
  try {
    await waitGoal(ctx, project, seed.goalRef, { timeoutMs: 60 * MINUTE, rec, adoptCandidates: true, check: null });
  } catch (error) {
    recordSeedEvidence(rec, await seedEvidence(project, seed.goalRef));
    throw error;
  }
  return seedEvidence(project, seed.goalRef);
}

/** The seed's own rounds in `facts.seed`, with each failed round's check, exit, stdout/stderr and raw paths in the notes. */
export function recordSeedEvidence(rec, seedFacts) {
  rec.facts.seed = seedFacts;
  if (seedFacts.gaps.length > 0) rec.note(`种子检查轮读不全：${seedFacts.gaps.join('；')}`);
  for (const failure of seedFacts.failures) {
    const side = (stream, name) => stream === null || stream === undefined ? `${name} 无`
      : `${name} 截断 ${String(stream.truncated === true)} 原文 ${JSON.stringify(stream.text ?? '')}`;
    const reports = failure.reports.map(report => `${report.checkId} 退出码 ${report.exitCode ?? '-'}；${
      side(report.stdout, 'stdout')}；${side(report.stderr, 'stderr')}；${
      (report.paths ?? []).length > 0 ? `变更路径 ${report.paths.join(', ')}` : '路径证据见输出'}`);
    rec.note(`种子任务 ${failure.taskId} 的 Run ${failure.runRef?.runId ?? '-'} 轮 ${failure.roundRef?.roundId ?? '-'} 有失败检查：${
      reports.join('；') || failure.checks.map(check => check.checkId).join(', ')}`);
  }
}

/**
 * P6J item 6 (E05): every formal round of the two Tasks, each failing check's report (`exitCode` / `signal` / the
 * `not_started` reason), each round's `chain.reverify`, the work record's temporary files and the waiting cards. The
 * `run` and the driver tests share this one collector; reads go through the Host client only.
 */
export async function e05Evidence({ project, goalRef, runs = null, gates = null, claimable = null, planDraft = null,
  plannedExtra = [], tasks = null, readGaps = [], historyGaps = [] }) {
  if (runs === null) runs = await executions(project, goalRef, readGaps);
  if (gates === null) {
    const body = await project.host.client.read('goals/overlap-gates', project.scope, { goalRef, page: { limit: 20 } });
    const list = ready(body)?.gates;
    if (list === undefined) {
      readGaps.push(`goals/overlap-gates: ${body?.status ?? 'no answer'} ${body?.code ?? ''}`);
      gates = [];
    } else gates = list;
  }
  const overlap = overlapEvidenceOf({ runs, gates, claimable, gaps: readGaps });
  if (tasks === null) {
    const body = await project.host.client.read('tasks/query', project.scope, { goalRef });
    tasks = ready(body)?.tasks ?? [];
    if (ready(body) === null) readGaps.push(`tasks/query: ${body?.status ?? 'no answer'} ${body?.code ?? ''}`);
  }
  const workTurns = [];
  for (const item of runs) workTurns.push(...turnsOf(await runHistory(project, item.run.ref, historyGaps)));
  const planned = [...new Set([...plannedExtra, ...(planDraft?.tasks ?? []).flatMap(task => task.plannedFiles ?? [])])];
  const exists = path => existsSync(join(project.root ?? '', path));
  const temporary = temporaryEvidenceOf(workTurns, planned, exists);
  const compares = workTurns.flatMap(turn => turn.results).filter(result => result.name === 'project_source'
    && /"duplicates"\s*:\s*true/.test(JSON.stringify(result.args ?? {})));
  const candidates = compares.flatMap(result => findAll(result.values, node => Array.isArray(node.candidates)).flatMap(report => report.candidates));
  const plantedPair = candidates.find(candidate => samePairPaths([candidate.first?.path, candidate.second?.path], DUPLICATE_PATHS)) ?? null;
  const roundGaps = [];
  const roundsByTask = {};
  const userRounds = [];
  for (const taskId of ['t-users', 't-orders']) {
    const { chains, raw } = await taskRoundChains(project, goalRef, taskId, roundGaps);
    roundsByTask[taskId] = chains;
    if (taskId === 't-users') userRounds.push(...raw);
  }
  const workRows = tasks.map(task => ({ taskId: task.ref.taskId, effectivePhase: task.effectivePhase,
    execution: task.execution ?? null, failure: task.failure ?? null, rework: task.rework ?? null }));
  const waitingBody = await project.host.client.read('decisions/queue', project.scope, { workspace: project.scope, goalRef,
    sections: ['waiting_answer', 'answered_pending_application'], page: { limit: 50 } });
  const waiting = ready(waitingBody);
  if (waiting === null && waitingBody?.status !== 'not_found') readGaps.push(`decisions/queue: ${waitingBody?.status ?? 'no answer'} ${waitingBody?.code ?? ''}`);
  const waitingCards = [...(waiting?.waitingAnswer ?? []), ...(waiting?.answeredPendingApplication ?? [])]
    .map(card => ({ cardKey: card.cardKey, kind: card.source?.kind ?? null, state: card.state ?? null }));
  const facts = { rounds: roundsByTask, roundGaps, readGaps, rows: workRows, waitingCards, waitingReadable: waiting !== null,
    waitingRead: waiting === null ? `${waitingBody?.status ?? 'no answer'} ${waitingBody?.code ?? ''} ${waitingBody?.reason ?? ''}`.trim() : null,
    writtenPaths: temporary.writtenPaths, temporaryPaths: temporary.temporaryPaths, insufficientTemporary: temporary.insufficient };
  const note = `E05 证据：检查轮读口${roundGaps.length === 0 ? '完整' : `缺 ${roundGaps.join('；')}`}；工作记录写入 ${temporary.writtenPaths.length} 处、认出的临时件 ${
    temporary.temporaryPaths.join(', ') || '无'}；待答/待落实卡 ${waiting === null ? `读不到（${facts.waitingRead}）` : waitingCards.map(card => card.kind).join(', ') || '无'}；返工记录 ${
    workRows.map(row => `${row.taskId}:${row.rework?.entries?.length ?? 0}`).join(', ')}`;
  const temporaryVerdict = judgeTemporary({ temporary: temporary.temporaryPaths, written: temporary.writtenPaths,
    insufficient: temporary.insufficient, gaps: historyGaps, exists });
  return { runs, gates, overlap, pair: overlap.pair, tasks, workTurns, temporary: temporaryVerdict,
    writtenPaths: temporary.writtenPaths, temporaryPaths: temporary.temporaryPaths, insufficient: temporary.insufficient,
    compares, candidates, plantedPair,
    roundsByTask, roundGaps, userRounds, workRows, waiting, waitingCards, facts, note };
}

async function run(ctx, rec) {
  const host = ctx.hosts['w-accept'];
  const project = await openProject(ctx, host, 'e05', SEED);
  const readGaps = [];
  rec.facts.project = project;
  rec.facts.model = await chooseModel(ctx, host, project);
  const seedText = '初始化这个项目：在 README.md 末尾加一行“校验规则统一放在 src/rules.js”。检查用 node --test。只改 README.md。';
  rec.facts.userCommand = [seedText];
  const seed = await coldStart(ctx, project, seedText, rec);
  // E05-D1 (lead 11-26): the seed is a prerequisite, waited for as `int` waits for its first Goal: the person adopts a
  // candidate card, and a seed that stops is `not-run`, never a fail of E05's first unjudged check.
  // P6L E05 (diagnosis E05, next-run item 1): the seed's own re-verification stays in facts even when the seed Goal
  // reached its end with a failed round — the sixth run kept no path output or error for `t1` — and also when a refused
  // adoption stops the wait: `seedRound` keeps the failing round before the original stop goes on.
  recordSeedEvidence(rec, await seedRound(ctx, project, seed, rec));
  // Second review #6: the seed's work is not E05's. The person commits what the seed left, and that commit is the
  // fixed baseline every E05 path is compared against.
  const gitRun = args => {
    const out = execFileSync('git', args, { cwd: project.root, encoding: 'utf8' });
    ctx.report.command(`git ${args.join(' ')} (in ${project.root}) -> 0`);
    return out.trim();
  };
  gitRun(['add', '-A']);
  if (gitRun(['status', '--porcelain']).length > 0) gitRun(['commit', '-q', '-m', 'g6 e05: the seed Goal is done']);
  const baseline = gitRun(['rev-parse', 'HEAD']);
  rec.facts.baseline = baseline;

  const architectureBody = await host.client.read('architecture/read', project.scope, { selection: { kind: 'current' } });
  const architecture = ready(architectureBody);
  if (architecture === null) readGaps.push(`architecture/read: ${architectureBody?.status ?? 'no answer'} ${architectureBody?.code ?? ''}`);
  const modules = architecture?.catalog?.catalog?.modules ?? [];
  const module = modules.find(entry => entry.paths.some(path => coversPath(path, 'src/users.js'))) ?? modules[0];
  if (module === undefined) throw broken(ctx, 'the seed adoption left no architecture module (architecture/read current)');
  await ensurePolicy(ctx, project, ['static', 'reviewer']);
  const reviewer = await openRoleLine(ctx, project, 'reviewer', [{ kind: 'project' }], rec);
  const goalId = newId('g6-e05');
  const goal = await createGoal(ctx, project, goalId, '给 users 和 orders 都加邮箱格式校验，两处用同一条校验规则', rec);
  rec.facts.userCommand.push('goals/create + plans/propose（两个任务：t-users、t-orders）');
  const planDraft = draft(goalId, module.ref.moduleId);
  const e05Plan = await proposeAndApply(ctx, project, goal.ref, planDraft, 'E05: 两个并行任务共用一条校验规则', rec,
    [testCheck(goalId, ['t-users', 't-orders', 'gate'])]);
  // P6J E05: the actual claimable moment, read once before any Run exists (a task card's `dispatch.claimableNow`, the
  // read E08 already uses). Both claimable then is the parallel opportunity the serial outcome is judged against.
  const claimableAtStart = {};
  for (const taskId of ['t-users', 't-orders']) {
    const card = await taskCard(project, goal.ref, taskId, e05Plan.ref);
    claimableAtStart[taskId] = card === null ? null : card.dispatch?.claimableNow ?? null;
  }
  const bothClaimable = claimableAtStart['t-users'] === null || claimableAtStart['t-orders'] === null ? null
    : claimableAtStart['t-users'] === true && claimableAtStart['t-orders'] === true;
  rec.facts.claimableAtStart = claimableAtStart;
  // The later claimable window, not one reading before the start: while only one Task has a Run, a card that still
  // says the other Task is claimable is a real parallel opportunity (`judgeOverlap`).
  const claimableSamples = [];
  let gateReadFailed = false;
  // P6 diagnosis 2 #5: every pick basis the driver results show (`last.value.pick`), kept once each for line-choice.
  const picks = [];
  const keepPick = snapshot => {
    const pick = snapshot?.last?.value?.pick ?? snapshot?.last?.pick ?? null;
    if (pick !== null && typeof pick === 'object' && !picks.some(entry => JSON.stringify(entry) === JSON.stringify(pick))) picks.push(pick);
  };
  for (const taskId of ['t-users', 't-orders']) {
    const started = await driverStart(ctx, project, goal.ref, { flowId: `e05-${taskId}`, taskId });
    keepPick(started?.value);
    rec.note(`driver-start ${taskId}: ${started?.status} ${started?.value?.state ?? started?.code ?? ''}`);
  }
  // lead 11-17（G6 第六次之后）：只按任务启动时，两个任务做完后没人推进关口任务和目标完成（按任务的推进不跟进
  // 目标范围的选择）。像人那样再启动一次整个目标，由目标的决定循环接着推进；放在两次按任务启动之后，不影响两条并行。
  const goalStarted = await driverStart(ctx, project, goal.ref, { flowId: 'e05-goal' });
  keepPick(goalStarted?.value);
  rec.note(`driver-start goal: ${goalStarted?.status} ${goalStarted?.value?.state ?? goalStarted?.code ?? ''}`);

  let planted = false;
  let gateSeen = null;
  const seenGates = { gates: new Map(), firstSeen: new Map(), released: new Map() };
  const display = await waitGoal(ctx, project, goal.ref, { timeoutMs: 150 * MINUTE, rec, returnOnDecide: true, check: 'kept', onPoll: async () => {
    // Second review #6: plant only after both Tasks have really started (each has a Run with a start time), and count
    // it planted only when every save was taken.
    keepPick(ready(await host.client.read('workflow/driver-read', project.scope, { goalRef: goal.ref })));
    const runs = await executions(project, goal.ref);
    const startedTasks = new Set(runs.filter(item => item.run.startedAt).map(item => item.run.task.taskId));
    if (!planted && startedTasks.has('t-users') && startedTasks.has('t-orders')) {
      // lead 11-17（G6 第七次）：`files/save` 的新建要求所在文件夹已经存在（内核“父目录不存在”），`src/legacy/`
      // 还没有。人会先在自己的电脑上建好文件夹，驱动照做，再经平台保存文件。
      for (const path of Object.keys(PLANTED)) mkdirSync(join(project.root, dirname(path)), { recursive: true });
      for (const [path, content] of Object.entries(PLANTED)) {
        const saved = await host.client.command('files/save', project.scope, { path, expectedRevision: null, content }, { commandId: newId('plant') });
        if (!['ready', 'committed'].includes(saved?.status)) throw broken(ctx, `files/save of the planted ${path}: ${saved?.status} ${saved?.code ?? ''} ${saved?.reason ?? ''}`, 'duplicates');
        rec.note(`planted ${path}: ${saved.status}`);
      }
      planted = true;
      rec.facts.plantedAt = new Date().toISOString();
    }
    const gatesBody = await host.client.read('goals/overlap-gates', project.scope, { goalRef: goal.ref, page: { limit: 20 } });
    const gates = ready(gatesBody)?.gates ?? [];
    if (ready(gatesBody) === null) {
      gateReadFailed = true;
      readGaps.push(`goals/overlap-gates: ${gatesBody?.status ?? 'no answer'} ${gatesBody?.code ?? ''}`);
    }
    // P6J4 (quick check row 1): the claimable samples cover every serial window `judgeOverlap` aligns them with — before
    // both Tasks started, and while a gate holds a Task back behind running Runs (a gate can name a rework Run). P6J4b:
    // a sample keeps its whole reading interval (`at` before the first card read, `until` after the last).
    if (!startedTasks.has('t-users') || !startedTasks.has('t-orders') || gates.some(gate => gate.release === null && gate.running.length > 0)) {
      const sample = { at: new Date().toISOString() };
      for (const taskId of ['t-users', 't-orders']) {
        const card = await taskCard(project, goal.ref, taskId, e05Plan.ref);
        sample[taskId] = card === null ? null : card.dispatch?.claimableNow ?? null;
      }
      sample.until = new Date().toISOString();
      claimableSamples.push(sample);
    }
    if (gateSeen === null) gateSeen = gates.find(gate => gate.running.length > 0) ?? null;
    await observeGates(seenGates, gates, { now: Date.now(), release: async gate => {
      const answer = await host.client.read('goals/overlap-release', project.scope,
        { commandId: newId('release'), gate: gate.ref, revision: gate.revision, reason: 'G6 E05: 人放行，让两个任务并行' });
      rec.note(`人放行重叠门 ${gate.moduleId}（等待 ${gate.waiting?.taskId ?? '-'}）：${answer?.status ?? 'no answer'} ${answer?.code ?? ''} ${answer?.reason ?? ''}`.trim());
      return answer;
    } });
  } });
  const { released, gates: gatesSeen } = seenGates;
  rec.note(`E05 Goal ended ${display.display.phase}`);
  rec.facts.stoppedFor = display.stoppedFor;
  if (display.stoppedFor !== null) rec.note(`E05 目标停下等人：${display.stoppedFor}`);

  const runs = await executions(project, goal.ref);
  for (const item of runs) { rec.link('run', item.run.ref, null); rec.link('session', item.outbox?.claim?.sessionRef ?? null); }
  const historyGaps = [];
  const evidence = await e05Evidence({ project, goalRef: goal.ref, runs, gates: [...gatesSeen.values()],
    claimable: { both: bothClaimable, atStart: claimableAtStart, samples: claimableSamples },
    planDraft, plannedExtra: Object.keys(PLANTED), readGaps, historyGaps });
  const overlap = evidence.overlap.verdict;
  if (overlap.status === 'pass') rec.pass('overlap', overlap.note);
  else if (overlap.status === 'fail') rec.fail('overlap', overlap.note);
  else rec.uncover('overlap', overlap.code, overlap.note);
  if (evidence.pair !== null) rec.facts.overlapPair = [evidence.pair.users.run.ref, evidence.pair.orders.run.ref];
  if (gateSeen !== null) {
    const committedReleases = [...released.values()].filter(committedRelease);
    rec.check('gate', gateSeen.moduleId === module.ref.moduleId && gateSeen.running.length > 0,
      `门：module ${gateSeen.moduleId}，等待 ${gateSeen.waiting.taskId}，在跑 ${gateSeen.running.map(entry => `${entry.task.taskId}/${entry.run.runId}`).join(', ')}；人放行成功 ${committedReleases.length} 道，被拒 ${released.size - committedReleases.length} 道`);
  } else if (gateReadFailed) rec.uncover('gate', 'env-unavailable', `goals/overlap-gates 读失败：${readGaps.filter(gap => gap.startsWith('goals/overlap-gates')).join('；')}；不能把读失败折成没有门`);
  else rec.fail('gate', '整个运行期间 goals/overlap-gates 没有出现带在跑 Run 的门');
  // `executions/read` has no `changedFiles` in this tree; `files/compare` against the initial commit gives the paths.
  const comparedBody = await host.client.read('files/compare', project.scope, {
    workspace: { aggregateType: 'Workspace', ...project.scope }, before: { kind: 'git', commit: baseline }, after: { kind: 'working_tree' } });
  const compared = ready(comparedBody);
  if (compared === null) readGaps.push(`files/compare: ${comparedBody?.status ?? 'no answer'} ${comparedBody?.code ?? ''}`);
  const changed = [...new Set((textOf(compared).match(/"path":"[^"]+"/g) ?? []).map(entry => entry.slice(8, -1)))];
  rec.facts.changedPaths = changed;
  rec.check('paths', changed.includes('src/users.js') && changed.includes('src/orders.js') && changed.includes('src/rules.js'),
    `files/compare 给出：${changed.join(', ') || '无'}`);
  const tasks = evidence.tasks;
  const phase = taskId => tasks.find(task => task.ref.taskId === taskId)?.effectivePhase;
  const source = path => { try { return readFileSync(join(project.root, path), 'utf8'); } catch { return ''; } };
  rec.check('kept', phase('t-users') === 'satisfied' && phase('t-orders') === 'satisfied'
    && /isEmail|rules/.test(source('src/users.js')) && /isEmail|rules/.test(source('src/orders.js')),
  `t-users ${phase('t-users')}，t-orders ${phase('t-orders')}${display.stoppedFor === null ? '' : `；目标停下等人：${display.stoppedFor}`}`);
  const sessions = new Map();
  let doubled = null;
  for (const item of runs) {
    const key = claimSession(item);
    for (const other of sessions.get(key) ?? []) {
      const [a0, a1] = intervalOf(item);
      const [b0, b1] = intervalOf(other);
      if (Math.min(a1, b1) > Math.max(a0, b0)) doubled = `${item.run.ref.runId} 和 ${other.run.ref.runId} 在 ${key}`;
    }
    sessions.set(key, [...(sessions.get(key) ?? []), item]);
  }
  rec.check('single-occupancy', doubled === null, doubled ?? `${runs.length} 个 Run，没有同 Session 时间重叠`);
  const users_ = source('src/users.js');
  const orders_ = source('src/orders.js');
  const rules = source('src/rules.js');
  rec.check('convention', /export\s+(function|const)\s+isEmail/.test(rules) && /rules(\.js)?['"]/.test(users_) && /rules(\.js)?['"]/.test(orders_)
    && !/function\s+isEmail/.test(orders_), `rules.js 定义 isEmail：${/isEmail/.test(rules)}；users/orders 都从 rules 引用`);

  // P6J E05: the tool pairs same-name top-level definitions or equal strings of at least 40 characters
  // (`duplicate-candidates.ts:84-101`); the fixture plants one such pair in the two expected files, so a pass is a
  // successful comparison whose candidate names exactly those two paths. "Different name, same rule" and "same name,
  // different rule" stay with the reviewer (`name-different`, `name-same`), never with this mechanical candidate.
  rec.check('duplicates', evidence.compares.length > 0 && evidence.plantedPair !== null, evidence.plantedPair === null
    ? `成功的 project_source（duplicates:true）结果 ${evidence.compares.length} 个，候选 ${evidence.candidates.length} 条，没有一条的两处路径正好是 ${DUPLICATE_PATHS.join(' ↔ ')}`
    : `候选：${evidence.plantedPair.first.path}:${evidence.plantedPair.first.line} ↔ ${evidence.plantedPair.second.path}:${evidence.plantedPair.second.line}`);
  // Quick check #5: the accepted Answer is read through its round. The round that answers the reviewer requirement →
  // that round's review Evidence (its `source.checkId` is null, `verification-round-read.ts:258-290`) → the Evidence's
  // own summary and body. A link that cannot be read is `uncovered`, never judged on another answer of the line.
  const usersRounds = evidence.userRounds;
  const reviewRound = usersRounds.filter(round => round.delivery.requirements.some(entry => entry.kind === 'reviewer')).at(-1);
  const reviewState = reviewRound?.delivery.requirements.find(entry => entry.kind === 'reviewer')?.state ?? null;
  rec.facts.checkRoundRef = reviewRound?.roundRef ?? null;
  const look = reviewRound === undefined ? null : ready(await host.client.read('graph/look', project.scope, { goalRef: goal.ref,
    target: { kind: 'node', node: { kind: 'round', ref: reviewRound.roundRef } }, relation: 'evidence', page: { afterCursor: null, limit: 20 } }));
  // P6 diagnosis 2 #4: a round's NodeCard carries `evidence` as an array (`graph-context-contracts.ts:80-81`); the review
  // Evidence is the record itself (no `checkId`), found wherever it sits in the answer.
  const review = findAll(look, node => node.source?.checkId === null && typeof node.outcome === 'string'
    && typeof node.evidenceId === 'string')[0] ?? null;
  let answer = null;
  if (review !== null) {
    answer = review.summary?.text ?? '';
    if (review.summary?.artifactRef) {
      const material = ready(await host.client.read('materials/open', project.scope, { ref: review.summary.artifactRef, usage: 'historical_explanation' }));
      if (typeof material?.body === 'string') answer += `\n${material.body}`;
    }
  }
  if (answer === null) {
    const missing = reviewRound === undefined ? 't-users 的检查轮里没有一轮带 reviewer 要求' : `轮 ${JSON.stringify(reviewRound.roundRef)} 没有可读的正式审阅 Evidence`;
    if (display.stoppedFor !== null) {
      for (const id of ['reviewer', 'name-different', 'name-same'])
        rec.uncover(id, 'not-run', `目标停下等人（${display.stoppedFor}），没走到这一步：${missing}（审阅要求状态 ${reviewState}）`);
    } else {
      for (const id of ['reviewer', 'name-different', 'name-same']) rec.uncover(id, 'entry-missing', `接不上：${missing}（审阅要求状态 ${reviewState}）`);
    }
  } else {
    rec.check('reviewer', ['PASS', 'FAIL'].includes(review.outcome),
      `轮 ${JSON.stringify(reviewRound.roundRef)} 的正式审阅 Evidence ${review.evidenceId}：${review.outcome}；审阅要求状态 ${reviewState}`);
    judgeSentence(rec, 'name-different', conclusions(answer, plantedNames), true, 'contact-check.js / looksLikeMailAddress');
    judgeSentence(rec, 'name-same', conclusions(answer, [sameNameFile]), false, 'is-email.js');
  }
  // P6J E05 `temporary` (SK ruling L5): the work record is the only source; a file left untracked is not evidence of a
  // temporary file by itself. A stop before the work is done leaves the "taken back before done" question open, so a
  // would-be fail there is `uncovered` instead.
  const temporary = evidence.temporary;
  if (temporary.status === 'pass') rec.pass('temporary', temporary.note);
  else if (temporary.status === 'fail' && display.stoppedFor !== null) {
    rec.uncover('temporary', 'not-run', `目标停下等人（${display.stoppedFor}），工作没做完，临时件该不该收回无从判：${temporary.note}`);
  } else if (temporary.status === 'fail') rec.fail('temporary', temporary.note);
  else rec.uncover('temporary', temporary.code, temporary.note);
  recordE05Evidence(rec, evidence);
  // P6 diagnosis 2 #5: the pick basis is public — `workflow/driver-start` and `workflow/driver-read` return the last
  // advancement result with its `pick` (`rank` of the six keys or `none`, `candidates`, `incomplete`;
  // `contracts/pick-basis.ts:5-12`, `business/workflow/contracts.ts:317-324`), read while the Goal ran. The excluded
  // lines themselves are not kept (MVP-BEHAVIOR.md:350), so only the basis is judged; nothing seen → not run.
  const RANKS = ['responsible_task', 'responsible_module', 'same_goal_history', 'duty', 'latest_activity', 'session_key'];
  const realPicks = picks.filter(pick => pick.rank !== 'none');
  if (realPicks.length === 0) {
    rec.uncover('line-choice', 'not-run', `运行中读到的派工依据 ${picks.length} 个，没有一个选中了线（rank 都是 none 或没读到）；候选线清单本来不另存（MVP-BEHAVIOR.md:350）`);
  } else {
    rec.check('line-choice', realPicks.every(pick => RANKS.includes(pick.rank) && Number.isInteger(pick.candidates) && pick.candidates >= 1
      && Array.isArray(pick.incomplete)), `派工依据：${realPicks.map(pick => `${pick.rank}/候选 ${pick.candidates}/不全 ${pick.incomplete.join(',') || '无'}`).join('；')}（排除了哪些线不另存，MVP-BEHAVIOR.md:350）`);
  }
  publishContinuation(ctx, rec, { project, goalRef: goal.ref, runs, module, tasks, stoppedFor: display.stoppedFor });
}

/**
 * P6J item 6 (E05): the evidence goes into the unit's record as collected — the two Tasks' formal rounds (failing checks
 * and their reports, every older round that could not be read), each round's `chain.reverify`, the rework basis and the
 * kinds of cards still waiting — and its summary into the notes. Evidence only; `result.json` takes `rec.facts`.
 */
export function recordE05Evidence(rec, evidence) {
  rec.facts.e05 = evidence.facts;
  rec.note(evidence.note);
}

/**
 * P6J E06 prerequisite (ruling 4): a real project and a line that did work are a continuation object even when E05's
 * Goal stopped for a person (`stoppedFor` is noted, never a reason to withhold it); whether its work settled is E06's
 * own second prerequisite. P6L E05 (diagnosis E06, next-run item 1): only a Run of THIS Goal's Work Task that started
 * on a claimed line is "worked"; a seed Goal's Run, a gate Run, or a Run with no line names nothing to hand over.
 */
export function publishContinuation(ctx, rec, { project, goalRef, runs, module, tasks, stoppedFor = null }) {
  const workTaskIds = new Set(tasks.filter(task => task.definition?.taskKind === 'work')
    .map(task => task.ref.taskId));
  const formalWork = (runs ?? []).filter(item => item.run?.task?.goalId === goalRef.goalId
    && workTaskIds.has(item.run.task.taskId));
  const continuation = continuationObject({ project, goalRef, runs: formalWork, module });
  if (continuation === null) rec.note('E05 没有留下接续对象：正式目标没有已开始、已被工作线领取的 Work Run');
  else {
    ctx.shared.e05 = continuation;
    rec.note(`E05 留下接续对象：项目 ${project.scope?.projectId ?? '-'}，做过工的线 ${continuation.lines.map(line => line.sessionId).join(', ')}${
      stoppedFor === null ? '' : `（目标停下等人：${stoppedFor}，照样留下）`}`);
  }
  return continuation;
}

export default { ...def, run };
