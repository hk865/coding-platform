import { afterEach, describe, expect, it } from 'vitest';
import { bootDone, openDoneDeliveryWorld, sectionHead } from './helpers/E3DN-done-world.js';
import { findClass, findElement, findLink } from './helpers/boot-page.js';
import { FakeElement } from './helpers/dom.js';
import { byLabel, goalSectionRows } from './helpers/E3C-world.js';
import { card, labelled, sendButton, typeInto } from './helpers/E3D-page.js';
import { buttonText, press, settle, UUID_V4, worldSlot } from './helpers/E3M-world.js';
import { callsTo, countRoute, descendants, hasClass, sentWrite, textOf } from './helpers/E3N-page.js';
import type { PageLog } from './helpers/E3N-page.js';

/**
 * E3DN-10 D15 (test sheet ①–④, ⑥): the completed delivery's card reads one
 * `goals/delivery`; 知道了 / 我要审查 / 有问题 are the three independent writes
 * `goals/accept-delivery`, `queries/ask` and `messages/send`; no secretary
 * greys the two messages; and "提交与推送" speaks from the delivery's own node
 * rows. Every row boots the real Done page against the real Host.
 */

type DeliveryReply = {
  value: {
    goal: { revision: number; objective: string; workspaceRef: { workspaceId: string } };
    phaseRevision: number;
    secretary: { projectId: string; sessionId: string } | null;
  };
};

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

const withSecretary = () => slot.use('delivery-secretary', async () => {
  const done = await openDoneDeliveryWorld();
  await done.world.createSecretary('e3dn-d10-secretary');
  return done;
}, (done) => done.close());
const withoutSecretary = () => slot.use('delivery-bare', () => openDoneDeliveryWorld(), (done) => done.close());
const goalBar = (root: FakeElement) => byLabel(root, '目标状态');
const sysLines = (root: FakeElement) => descendants(root)
  .filter((element) => hasClass(element, 'sys-line')).map((element) => textOf(element));

const deliveryOf = (log: PageLog): DeliveryReply => callsTo(log, 'goals/delivery')[0]!.reply as DeliveryReply;

const commitCell = (root: FakeElement): string => {
  const list = descendants(root).find((element) => hasClass(element, 'dv-kv')
    && textOf(element).includes('提交与推送'));
  expect(list, 'the 没有做的 list').toBeDefined();
  const children = list!.childNodes.filter((child): child is FakeElement => child instanceof FakeElement);
  const at = children.findIndex((child) => child.tagName.toLowerCase() === 'dt' && textOf(child) === '提交与推送');
  expect(at, 'the 提交与推送 row').toBeGreaterThanOrEqual(0);
  return textOf(children[at + 1]);
};

describe('E3DN-10 the delivery card actions', () => {
  it('D15① 知道了 writes one delivery acceptance with the read pins', async () => {
    const done = await withSecretary();
    const { page, log } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => card(page.root) !== undefined, 10_000);
      const reply = deliveryOf(log);
      const open = card(page.root)!;
      /* 具名改坏: 级别写回“要决定”；本行红。 */
      expect(textOf(findClass(open, 'lvl'))).toBe('请知悉');
      /* 具名改坏: COMPLETED 的 why 写死“等你验收”；本行红。 */
      expect(textOf(findClass(goalBar(page.root)!, 'gb-why'))).toBe('');
      expect(textOf(findClass(open, 'dc-title'))).toContain('交付');
      expect(textOf(findClass(open, 'dc-title'))).toContain('目标 1');
      expect(findClass(page.root, 'dv-pick')).toBeUndefined();

      const before = countRoute(log, 'goals/read');
      press(buttonText(open, '知道了'), '知道了');
      await settle(() => countRoute(log, 'goals/accept-delivery') === 1, 10_000);
      await settle(() => callsTo(log, 'goals/accept-delivery')[0]?.reply !== undefined, 10_000);
      await settle(() => countRoute(log, 'goals/read') > before, 15_000);
      const write = sentWrite(callsTo(log, 'goals/accept-delivery')[0]);
      /* 具名改坏: 用页面的第一个工作区发写；本行 scope 红。 */
      expect((callsTo(log, 'goals/accept-delivery')[0]!.body as { scope: { workspaceId: string } })
        .scope.workspaceId).toBe(reply.value.goal.workspaceRef.workspaceId);
      /* 具名改坏: expected 只带 Goal pin；本行的 GoalPhase pin 红。 */
      expect(write.meta.expected).toEqual([
        { ref: done.goal, revision: reply.value.goal.revision },
        { ref: { aggregateType: 'GoalPhase', projectId: done.goal.projectId, goalId: done.goal.goalId },
          revision: reply.value.phaseRevision },
      ]);
      expect((callsTo(log, 'goals/accept-delivery')[0]!.reply as { status: string }).status).toBe('committed');

      press(buttonText(card(page.root), '详情'), '详情');
      await settle(() => (findClass(page.root, 'dc-facts')?.textContent ?? '').includes('确认'), 10_000);
      const facts = textOf(findClass(page.root, 'dc-facts'));
      /* 具名改坏: 不画确认记录；本行的“确认”红。 */
      expect(facts).toContain('确认');
      expect(facts).toContain('不等于审查过');
      expect(buttonText(card(page.root), '知道了')!.getAttribute('aria-disabled')).toBe('true');
      expect(buttonText(card(page.root), '我要审查')!.getAttribute('aria-disabled')).not.toBe('true');
      expect(buttonText(card(page.root), '有问题')!.getAttribute('aria-disabled')).not.toBe('true');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D15② 我要审查 asks the secretary the Goal-named question once', async () => {
    const done = await withSecretary();
    const { page, log } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => card(page.root) !== undefined, 10_000);
      const reply = deliveryOf(log);
      const read = callsTo(log, 'goals/read')[0]!.reply as { value: { goal: { objective: string } } };
      press(buttonText(card(page.root), '我要审查'), '我要审查');
      await settle(() => countRoute(log, 'queries/ask') === 1, 10_000);
      await settle(() => callsTo(log, 'queries/ask')[0]?.reply !== undefined, 10_000);
      const call = callsTo(log, 'queries/ask')[0]!;
      /* 具名改坏: 问句不写目标名；本行 question 红。 */
      expect(call.input).toMatchObject({
        sessionRef: reply.value.secretary,
        question: '请审查目标 1「' + read.value.goal.objective
          + '」的交付：实现、改动和规格是否一致，行为有没有偏离。',
      });
      expect(String((call.input as { commandId: string }).commandId)).toMatch(UUID_V4);
      expect((call.reply as { status: string }).status).toBe('queued');
      await settle(() => findLink(page.root, '已请秘书审查，回答在秘书的工作线里') !== undefined, 10_000);
      const link = findLink(page.root, '已请秘书审查，回答在秘书的工作线里');
      /* 具名改坏: 系统行不给链接；本行 link 红。 */
      expect(link).toBeDefined();
      expect(link!.getAttribute('href')).toBe('Member.dc.html?goal=' + done.goal.goalId
        + '&lineProject=' + reply.value.secretary!.projectId + '&lineSession=' + reply.value.secretary!.sessionId);
      expect(link!.getAttribute('title')).toBe('打开秘书的工作线');
      /* 具名改坏: 我要审查也写确认记录；本行红。 */
      expect(countRoute(log, 'goals/accept-delivery')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D15③ 有问题 sends the person intervention and 不说了 clears it', async () => {
    const done = await withSecretary();
    const { page, log } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => card(page.root) !== undefined, 10_000);
      press(buttonText(card(page.root), '有问题'), '有问题');
      await settle(() => findClass(page.root, 'composer-ref') !== undefined, 5_000);
      /* 具名改坏: askLead 仍写“引用”；本行引用条红。 */
      expect(textOf(findClass(page.root, 'composer-ref'))).toContain('有问题：目标 1 的交付');
      expect(textOf(findClass(page.root, 'composer'))).toContain('说说哪里有问题');
      typeInto(page.root, 'composer-input', '改动漏了 README');
      press(sendButton(page.root), '发送');
      await settle(() => countRoute(log, 'messages/send') === 1, 10_000);
      await settle(() => sysLines(page.root).some((text) => text.includes('会先请你确认一个接续的新目标')), 5_000);
      const write = sentWrite(callsTo(log, 'messages/send')[0]);
      /* 具名改坏: 不带 goalRef/entry；本行 input 红。 */
      expect(write.input).toEqual({
        recipient: deliveryOf(log).value.secretary, goalRef: done.goal,
        needsReply: true, entry: 'person_intervention', text: '改动漏了 README',
      });
      expect((callsTo(log, 'messages/send')[0]!.reply as { sendStatus: string }).sendStatus).toBe('sent');
      expect(countRoute(log, 'requests/submit')).toBe(0);
      expect(countRoute(log, 'goals/accept-delivery')).toBe(0);
      expect(descendants(page.root).filter((element) => hasClass(element, 'msg-user'))
        .map((element) => textOf(element)).some((text) => text.includes('有问题：改动漏了 README'))).toBe(true);

      /* 点“有问题”再点“不说了”：problemOpen 必须清掉，下一次发送才走 requests/submit。 */
      press(buttonText(card(page.root), '有问题'), '有问题');
      press(labelled(page.root, '不说了'), '不说了');
      press(buttonText(card(page.root), '问秘书'), '问秘书');
      await settle(() => findClass(page.root, 'composer-ref') !== undefined, 5_000);
      typeInto(page.root, 'composer-input', '问问别的');
      press(sendButton(page.root), '发送');
      await settle(() => countRoute(log, 'requests/submit') === 1, 10_000);
      /* 具名改坏: 清引用不清理 problemOpen；本行 requests/submit 红。 */
      expect(countRoute(log, 'messages/send')).toBe(1);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D15④ no secretary greys the two messages and leaves 知道了 writable', async () => {
    const done = await withoutSecretary();
    const { page, log } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => card(page.root) !== undefined, 10_000);
      const review = buttonText(card(page.root), '我要审查')!;
      const problem = buttonText(card(page.root), '有问题')!;
      /* 具名改坏: 没有秘书仍画成可点；本行 aria/title 红。 */
      expect(review.getAttribute('aria-disabled')).toBe('true');
      expect(review.getAttribute('title')).toBe('这个工作区还没有秘书，发不出去');
      expect(problem.getAttribute('aria-disabled')).toBe('true');
      expect(problem.getAttribute('title')).toBe('这个工作区还没有秘书，发不出去');
      /* 具名改坏: 不把灰按钮的原因写到卡上；本行红。 */
      expect(textOf(card(page.root))).toContain('现在发不出去：这个工作区还没有秘书。');
      const before = log.calls.length;
      press(review, '我要审查');
      press(problem, '有问题');
      expect(log.calls.length).toBe(before);
      press(buttonText(card(page.root), '知道了'), '知道了');
      await settle(() => countRoute(log, 'goals/accept-delivery') === 1, 10_000);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D15⑥ 提交与推送 says the automatic mode does not commit', async () => {
    const done = await withoutSecretary();
    const { page } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => card(page.root) !== undefined, 10_000);
      press(sectionHead(page.root, '没有做的'), '没有做的');
      await settle(() => commitCell(page.root) !== '', 5_000);
      /* 具名改坏: 仍写“还没接通”；本行红。 */
      expect(commitCell(page.root)).toBe('方案确认后自动的目标，平台不替你提交；没有推送');
    } finally {
      await page.restore();
    }
  }, 180_000);

  const doubleClicks = [
    { label: '知道了', route: 'goals/accept-delivery', send: false },
    { label: '我要审查', route: 'queries/ask', send: false },
    { label: '有问题', route: 'messages/send', send: true },
  ] as const;

  it.each(doubleClicks)('D15⑦ 连点「$label」只写一次 $route', async ({ label, route, send }) => {
    const done = await withSecretary();
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const { page, log } = await bootDone(done.world, done.goal.goalId, {
      before: { [route]: async () => { await held; } },
    });
    try {
      await settle(() => card(page.root) !== undefined, 10_000);
      if (send) {
        press(buttonText(card(page.root), '有问题'), '有问题');
        await settle(() => findClass(page.root, 'composer-ref') !== undefined, 5_000);
        typeInto(page.root, 'composer-input', '改动漏了 README');
      }
      const pressIt = () => (send
        ? press(sendButton(page.root), '发送')
        : press(buttonText(card(page.root), label), label));
      pressIt();
      /* 具名改坏: 点下不置进行中；本行的灰按钮断言红，随后第二次请求会让 count 红。 */
      if (send) expect(hasClass(sendButton(page.root)!, 'is-off')).toBe(true);
      else expect(buttonText(card(page.root), label)!.getAttribute('aria-disabled')).toBe('true');
      pressIt();
      release();
      await settle(() => callsTo(log, route).length > 0
        && callsTo(log, route)[0]!.reply !== undefined, 10_000);
      expect(countRoute(log, route)).toBe(1);
    } finally {
      release();
      await page.restore();
    }
  }, 180_000);

  it('D15⑧ a write failure prints the Chinese sentence without the route', async () => {
    const done = await withoutSecretary();
    const { page } = await bootDone(done.world, done.goal.goalId, { unavailable: 'goals/accept-delivery' });
    try {
      await settle(() => card(page.root) !== undefined, 10_000);
      press(buttonText(card(page.root), '知道了'), '知道了');
      await settle(() => sysLines(page.root).some((text) => text.includes('没有成功')), 10_000);
      const line = sysLines(page.root).find((text) => text.includes('没有成功'))!;
      /* 具名改坏: catch 直接印 error.message；本行红。 */
      expect(line).toBe('「知道了」没有成功：暂时写不了，可以重试。');
      expect(line).not.toContain('goals/accept-delivery');
      /* 不带对勾：这一行没有系统行的 svg。 */
      const row = descendants(page.root).find((element) => hasClass(element, 'sys-line')
        && textOf(element).includes('没有成功'))!;
      expect(descendants(row).some((element) => element.tagName.toLowerCase() === 'svg')).toBe(false);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D15⑨ a failed delivery read keeps 提交与推送 honest', async () => {
    const done = await withoutSecretary();
    const { page } = await bootDone(done.world, done.goal.goalId, { unavailable: 'goals/delivery' });
    try {
      await settle(() => sectionHead(page.root, '没有做的') !== undefined, 10_000);
      press(sectionHead(page.root, '没有做的'), '没有做的');
      await settle(() => commitCell(page.root) !== '', 5_000);
      /* 具名改坏: 写回“还没接通”；本行红。 */
      expect(commitCell(page.root)).toBe('交付暂时读不到');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D15⑩ 收起卡片后换目标再换回来，交付卡还在', async () => {
    const done = await withSecretary();
    const { page, log } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => card(page.root) !== undefined);
      press(findElement(page.root, (element) => element.getAttribute('aria-label') === '稍后处理'), '稍后处理');
      await settle(() => card(page.root) === undefined);
      const read = () => countRoute(log, 'goals/read');
      const before = read();
      press(goalSectionRows(page.root)[1], '目标 2');
      await settle(() => goalSectionRows(page.root)[1]!.getAttribute('aria-current') === 'true');
      /* 目标 2 是取消的目标，没有交付卡；先证明确实换到了它。 */
      expect(read()).toBeGreaterThan(before);
      expect(textOf(goalSectionRows(page.root)[1]!)).toContain('S6A goal two');
      const back = read();
      /* 具名改坏: 换目标不清 cardClosed；换回来这张卡不出来，本行红。 */
      press(goalSectionRows(page.root)[0], '目标 1');
      await settle(() => read() > back && card(page.root) !== undefined);
      expect(card(page.root)).toBeDefined();
    } finally {
      await page.restore();
    }
  }, 180_000);
});
