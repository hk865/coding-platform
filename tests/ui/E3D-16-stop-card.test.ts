import { afterEach, expect, it } from 'vitest';
import { LOCAL_WORKBENCH_ROLE } from '../../src/app/runtime-configuration.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { TaskRow } from '../../src/contracts/task-graph.js';
import { g8Check, g8NewGoal, g8PlanCall, g8PlanForm, openG8Project } from '../helpers/G8-world.js';
import { G8B_ROLE } from '../helpers/G8B-world.js';
import { heartbeatUntil } from '../helpers/IV-host-fixture.js';
import { click } from './helpers/E3N-interact.js';
import { bootE3N, callsOf, count, descendants, hasClass, openedPage, quietPage, textOf } from './helpers/E3N-page.js';
import { card, cardButton, cardFacts, factOf, isOff, sectionRows, settle, stepConfirm, typeInto } from './helpers/E3D-page.js';

/**
 * Y3/Y4 (D121-149-2/-3): the stop card withdraws the approved-list check and
 * re-verifies without a note; a refused re-verify shows the sentence and the
 * “最近重新检查被拒绝”/“出路” facts.
 */
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.allSettled(cleanup.splice(0).reverse().map((close) => close())); });
const PASSES = 600;

const parsedCode = (card: { source: { key?: string } }): unknown => {
  try { return (JSON.parse(String(card.source.key ?? '')) as { code?: unknown }).code; } catch { return undefined; }
};
const evidenceFacts = (root: Parameters<typeof sectionRows>[0]): Record<string, string> => {
  const open = card(root);
  const list = open === undefined ? undefined : descendants(open).find((element) => hasClass(element, 'dc-facts')
    && element.getAttribute('aria-label') === '已知的事实');
  const out: Record<string, string> = {};
  if (list === undefined) return out;
  let key = '';
  for (const child of descendants(list)) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'dt') key = textOf(child);
    else if (tag === 'dd' && key !== '') out[key] = textOf(child);
  }
  return out;
};
const stopRows = (root: Parameters<typeof sectionRows>[0]) =>
  sectionRows(root, '要决定').filter((row) => textOf(row).includes('没有新依据'));
/** The no_new_basis card is the later of the two same-labelled rows (the other is auto_rework_count). */
const stopRow = (root: Parameters<typeof sectionRows>[0]) => stopRows(root).at(-1);

async function stopWorld(label: string, checks: ReturnType<typeof g8Check>[]) {
  const task = label + '-work';
  const project = await openG8Project(label, checks, 25);
  cleanup.push(project.close);
  const flow = await g8NewGoal(project, label, [g8PlanCall(`${label}-plan`, g8PlanForm(label, G8B_ROLE))]);
  const head = await project.candidate(flow.goal, flow.requestRoot);
  expect(await project.apply(flow.goal, head, `${label}-apply`)).toMatchObject({ status: 'committed' });
  const executor = await project.line(`${label}-executor`, LOCAL_WORKBENCH_ROLE);
  await project.world.scripted.script(executor, [{ kind: 'text', text: `${label} 第一次，什么都不改` },
    { kind: 'text', text: `${label} 第二次，还是什么都不改` }], project.scope);
  await project.read('workflow/driver-start', { advance: { schemaVersion: 1, goalRef: flow.goal,
    flowId: `${label}-driver`, sessionHint: null, kind: 'select_work', taskId: task }, queryProfileIds: [] });
  const readStopQueue = () => project.read<DecisionQueueReadV1>('decisions/queue', { workspace: project.scope,
    goalRef: flow.goal, sections: ['waiting_answer'], page: { limit: 100 } });
  await heartbeatUntil(project.world, readStopQueue, (queue) => queue.waitingAnswer.some((entry) =>
    entry.source.kind === 'goal_cause' && entry.taskRef?.taskId === task
    && parsedCode(entry) === 'no_new_basis'), PASSES);
  return { project, flow, task };
}

it('① withdraws the named check, then re-verifies with only the round pin', async () => {
  const { project, flow, task } = await stopWorld('e3d-wd', [g8Check('wd-ok', 'all'), g8Check('wd-bad', 'all', 'false')]);
  const { page, log } = await bootE3N(project.world, 'Decide', { search: '?goal=' + flow.goal.goalId });
  try {
    await openedPage(log);
    await settle(() => sectionRows(page.root, '要决定').length > 0, 8_000);
    await settle(() => stopRow(page.root) !== undefined, 8_000);
    click(stopRow(page.root)!);
    await settle(() => card(page.root) !== undefined, 3_000);
    const main = cardButton(page.root, '撤回这些检查并重新检查');
    expect(main, 'the no_new_basis card\'s primary action').toBeDefined();
    click(main!);
    await settle(() => cardButton(page.root, '撤回并重新检查') !== undefined, 2_000);
    expect(evidenceFacts(page.root)['检查']).toMatch(/^false · 全部任务 · 已批准清单/);
    const taskReply = callsOf(log, 'tasks/query').find((call) => call.reply !== undefined)?.reply as
      { value?: { tasks?: TaskRow[] } } | undefined;
    const round = taskReply?.value?.tasks?.find((row) => row.ref.taskId === task)?.failure?.round ?? null;
    expect(round).not.toBeNull();
    click(stepConfirm(page.root)!);
    await settle(() => callsOf(log, 'settings/checks/withdraw').length > 0
      && callsOf(log, 'verification/reverify').some((call) => call.reply !== undefined), 10_000);
    const withdraw = callsOf(log, 'settings/checks/withdraw');
    expect(withdraw).toHaveLength(1);
    expect(withdraw[0]!.input).toMatchObject({ checkId: 'wd-bad' });
    const reverify = callsOf(log, 'verification/reverify');
    expect(reverify).toHaveLength(1);
    expect((reverify[0]!.input as Record<string, unknown>)['note']).toBeUndefined();
    expect(reverify[0]!.input).toMatchObject({ predecessorRoundRef: round!.roundRef });
    const callIndex = (route: string) => log.calls.findIndex((call) => call.route === route);
    expect(callIndex('settings/checks/withdraw')).toBeLessThan(callIndex('verification/reverify'));
    await settle(() => stopRows(page.root).length <= 1, 15_000);
    expect(stopRows(page.root).length).toBeLessThanOrEqual(1);
  } finally {
    await page.restore();
  }
}, 300_000);

it('② a refused re-verify keeps the step with the reason and the exit fact', async () => {
  const { project, flow, task } = await stopWorld('e3d-unc', [g8Check('unc-bad', 'all', 'false')]);
  const { page, log } = await bootE3N(project.world, 'Decide', { search: '?goal=' + flow.goal.goalId });
  try {
    await openedPage(log);
    await settle(() => stopRow(page.root) !== undefined, 8_000);
    click(stopRow(page.root)!);
    await settle(() => card(page.root) !== undefined, 3_000);
    click(cardButton(page.root, '撤回这些检查并重新检查')!);
    await settle(() => stepConfirm(page.root) !== undefined, 2_000);
    click(stepConfirm(page.root)!);
    await settle(() => callsOf(log, 'verification/reverify').some((call) => call.reply !== undefined), 10_000);
    await settle(() => (textOf(card(page.root)!) || '').includes('没有重新检查：'), 3_000);
    expect(textOf(card(page.root)!)).toContain('没有重新检查：没有检查覆盖必需的要求。要补检查，在主对话里说，参谋会起草带新检查的计划；你采用以后再重新检查。');
    expect(textOf(card(page.root)!)).not.toContain('写入失败。');
    expect(count(log, 'settings/checks/withdraw')).toBe(1);
    expect(count(log, 'verification/reverify')).toBe(1);
    const reply = callsOf(log, 'verification/reverify')[0]!.reply as
      { value?: { kind?: string; refusal?: { code?: string } } } | undefined;
    expect([reply?.value?.kind, reply?.value?.refusal?.code]).toEqual(['refused', 'verification_uncovered']);
    /* 返回后换页签触发一次重读，再打开详情读新写入的拒绝事实。 */
    click(cardButton(page.root, '返回')!);
    await settle(() => stepConfirm(page.root) === undefined, 2_000);
    const tab = (name: string) => descendants(page.root).find((element) =>
      element.tagName.toLowerCase() === 'button' && textOf(element) === name);
    const before = callsOf(log, 'decisions/queue').length;
    click(tab('已处理')!);
    await settle(() => callsOf(log, 'decisions/queue').length > before, 8_000);
    click(tab('待处理')!);
    await settle(() => callsOf(log, 'decisions/queue').length > before, 8_000);
    await quietPage(log);
    click(stopRow(page.root)!);
    await settle(() => card(page.root) !== undefined, 2_000);
    click(cardButton(page.root, '详情')!);
    await settle(() => factOf(page.root, '最近重新检查被拒绝') !== undefined, 3_000);
    expect(factOf(page.root, '最近重新检查被拒绝')).toContain('人工重新检查被拒绝：没有检查覆盖必需的要求');
    expect(factOf(page.root, '出路')).toBe('要补检查，在主对话里说，参谋会起草带新检查的计划');
    const main = cardButton(page.root, '撤回这些检查并重新检查');
    expect(isOff(main)).toBe(true);
    expect(main!.getAttribute('title')).toBe('没有检查覆盖这条要求，再点也会被拒；先按详情里的出路加检查');
  } finally {
    await page.restore();
  }
}, 300_000);
