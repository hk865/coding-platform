import { afterEach, describe, expect, it } from 'vitest';
import {
  answerDoneAsk, bootDone, composerBox, openDoneDeliveryWorld,
} from './helpers/E3DN-done-world.js';
import { card, sendButton, typeInto } from './helpers/E3D-page.js';
import { buttonText, press, settle, UUID_V4, worldSlot } from './helpers/E3M-world.js';
import { countRoute, descendants, hasClass, textOf } from './helpers/E3N-page.js';

/**
 * E3DN-9 D19 (test sheet §2.6, R10; ruling 2 Done M2): the page's command id
 * is a fresh UUID on every load. The same page on the same Host and Goal is
 * opened twice and asks once each time; the Host keeps a command id's first
 * receipt, so a per-load counter (`goals-ask-1` again) would get the first
 * answer back (same text) or a rejection (other text). Each round is answered
 * through the public Query routes before the page's one `requests/read`.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

const ASKS = [
  { text: '第一次问', answer: 'E3DN D19 第一次的回答' },
  { text: '第二次问', answer: 'E3DN D19 第二次的回答' },
];

describe('E3DN-9 the command id', () => {
  it('D19 the same page opened twice asks twice and gets two new answers', async () => {
    const done = await slot.use('main', () => openDoneDeliveryWorld(), (world) => world.close());
    const seen: Array<{ commandId: unknown; root: unknown; readRoot: unknown; reads: number; answers: string[] }> = [];
    for (const [index, ask] of ASKS.entries()) {
      const { page, log } = await bootDone(done.world, done.goal.goalId, {
        before: { 'requests/read': (pageLog) => answerDoneAsk(done.world, pageLog, `e3dn-d19-${index + 1}`, ask.answer) },
      });
      try {
        await settle(() => card(page.root) !== undefined, 10_000);
        press(buttonText(card(page.root), '问秘书'), '问秘书');
        await settle(() => composerBox(page.root) !== undefined, 5_000);
        typeInto(page.root, 'composer-input', ask.text);
        press(sendButton(page.root), '发送');
        const answers = () => descendants(page.root).filter((element) => hasClass(element, 'msg-agent')).map((element) => textOf(element));
        await settle(() => answers().some((text) => text.includes(ask.answer)), 20_000);
        const submit = log.calls.find((call) => call.route === 'requests/submit')?.input as Record<string, unknown> | undefined;
        const read = log.calls.find((call) => call.route === 'requests/read')?.input as Record<string, unknown> | undefined;
        seen.push({ commandId: submit?.['commandId'], root: (log.submits[0] as { requestRoot?: unknown } | undefined)?.requestRoot,
          readRoot: read?.['requestRoot'], reads: countRoute(log, 'requests/read'), answers: answers() });
      } finally {
        await page.restore();
      }
    }
    const [first, second] = seen;
    /* 具名改坏: `commandId` 改回 `'goals-ask-' + n`（每次加载从 1 数）；本行的“两次不同”红，第二次读到旧回答。 */
    expect(String(first!.commandId)).toMatch(UUID_V4);
    expect(String(second!.commandId)).toMatch(UUID_V4);
    expect(second!.commandId).not.toBe(first!.commandId);
    expect(second!.root).not.toEqual(first!.root);
    expect([first!.reads, second!.reads]).toEqual([1, 1]);
    expect(first!.readRoot).toEqual(first!.root);
    expect(second!.readRoot).toEqual(second!.root);
    expect(second!.answers.some((text) => text.includes(ASKS[1]!.answer))).toBe(true);
    expect(second!.answers.some((text) => text.includes(ASKS[0]!.answer))).toBe(false);
  }, 180_000);
});
