import { afterEach, expect, it } from 'vitest';
import { cleanupScenarios } from '../scenarios/harness.js';
import { click } from './helpers/E3N-interact.js';
import { openDeferredWorld, openUnknownWorld } from './helpers/E3D-world.js';
import { bootE3N, callsOf, count, openedPage } from './helpers/E3N-page.js';
import {
  card, cardButton, isOff, sectionRows, settle, stepConfirm, typeInto,
} from './helpers/E3D-page.js';

/**
 * Y7/Y9 (the 29th row, 5.6-10, 5.10-2): a failed direct write keeps its step
 * open with the button-side sentence; the in-flight confirm is off and a second
 * click sends one request.
 */
afterEach(async () => { await cleanupScenarios(); });

it('⑤ the attest step keeps the lease sentence and retries to a committed write', async () => {
  const h = await openUnknownWorld();
  const { page, log } = await bootE3N(h.host, 'Decide', {
    rejectOnce: { route: 'executions/resolve-unknown', code: 'busy',
      reason: 'this Host does not hold the Host instance lease; only that Host attests (L-1)' },
  });
  try {
    await openedPage(log);
    await settle(() => sectionRows(page.root, '要决定').length > 0, 8_000);
    click(sectionRows(page.root, '要决定')[0]!);
    await settle(() => cardButton(page.root, '核对未知结果') !== undefined, 3_000);
    click(cardButton(page.root, '核对未知结果')!);
    await settle(() => stepConfirm(page.root) !== undefined, 2_000);
    typeInto(page.root, 'dc-reason', '看过记录，按中断处理');
    await settle(() => !isOff(stepConfirm(page.root)), 2_000);
    click(stepConfirm(page.root)!);
    await settle(() => (card(page.root)?.textContent ?? '').includes('这台 Host 没有执行租约'), 8_000);
    expect(card(page.root)!.textContent).toContain('这台 Host 没有执行租约，只有持有租约的 Host 能认定。');
    expect(isOff(stepConfirm(page.root))).toBe(false);
    /* 在途/失败后“返回”不清步骤，重试前先清失败行；第二次请求发出并成功。 */
    const before = count(log, 'executions/resolve-unknown');
    click(stepConfirm(page.root)!);
    await settle(() => count(log, 'executions/resolve-unknown') > before
      && (callsOf(log, 'executions/resolve-unknown').at(-1)?.reply as { status?: string } | undefined)?.status === 'committed', 8_000);
    await settle(() => stepConfirm(page.root) === undefined, 8_000);
    expect(stepConfirm(page.root)).toBeUndefined();
    expect(count(log, 'executions/resolve-unknown')).toBe(before + 1);
  } finally {
    await page.restore();
  }
}, 300_000);

it('⑥ a plan write\'s TaskLease refusal keeps the disposition step open', async () => {
  const h = await openDeferredWorld();
  const { page, log } = await bootE3N(h.host, 'Decide', { search: '?goal=ag2b-goal',
    rejectOnce: { route: 'plans/apply', code: 'busy', reason: 'task ag2b-work still holds its TaskLease' },
  });
  try {
    await openedPage(log);
    await settle(() => sectionRows(page.root, '要决定').length > 0, 8_000);
    click(sectionRows(page.root, '要决定').at(-1)!);
    await settle(() => cardButton(page.root, '恢复任务') !== undefined, 3_000);
    click(cardButton(page.root, '恢复任务')!);
    await settle(() => stepConfirm(page.root) !== undefined, 2_000);
    click(stepConfirm(page.root)!);
    await settle(() => (card(page.root)?.textContent ?? '').includes('任务还占着执行租约'), 8_000);
    expect(card(page.root)!.textContent).toContain('任务还占着执行租约，等它释放再点一次。');
    expect(stepConfirm(page.root), 'the step stays open').toBeDefined();
    expect(count(log, 'plans/propose')).toBe(1);
    expect(count(log, 'plans/apply')).toBe(1);
  } finally {
    await page.restore();
  }
}, 300_000);
