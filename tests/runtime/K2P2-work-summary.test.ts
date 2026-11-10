/**
 * Slice K2 P2: the Work line's summary call through the real Workflow and the scripted model
 * (book-k2-slim.frozen §2.2 world F; row K2P2-05).
 *
 * Hand count §2.1: R1 and R2 are 12-large-result Turns; R3–R5 small; R6 is 12 large results and ends at
 * 499,000; R7 starts at 499,000, keeps R6 and R7, and the new summary reaches R5. The Work run budget is the
 * shared budget (1M window) with this row's exception `outputTokens` 8,193 (slice-K2-SPEC :925): every request
 * reports 1 output token but the summary call's 8,192, so R7's own request has 8,193 − 8,192 = 1 left.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { usageOf, type S6AReply } from '../helpers/S6A-host-fixture.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
const kernelRunIdOf = (runRef: unknown): string => 'krun-' + sha256Hex(canonicalJson(runRef as never));
import {
  bigReply, compactions, openK2WorkWorld, type K2KernelRecord, type K2WorkWorld,
} from '../helpers/K2-world.js';

const worlds: K2WorkWorld[] = [];
afterEach(async () => {
  const left = worlds.splice(0);
  await Promise.allSettled(left.map(world => world.close()));
});

const payloadOf = (record: K2KernelRecord): Record<string, unknown> =>
  (record as unknown as { payload: Record<string, unknown> }).payload;
const terminalOf = (records: readonly K2KernelRecord[], runId: string): number => {
  const found = [...records].reverse().find(record => {
    if (record.recordType !== 'agent.event') return false;
    const event = payloadOf(record)['event'] as Record<string, unknown>;
    const meta = event['meta'] as Record<string, unknown>;
    return event['type'] === 'run.completed' && meta['runId'] === runId;
  });
  if (found === undefined) throw new Error(`K2P2-05: no run.completed for ${runId}`);
  return found.position;
};
const userText = (message: { role: string } | undefined): string | null =>
  message === undefined || message.role !== 'user' ? null : (message as unknown as { content: string }).content;
/** Every request but the summary call's reports `outputTokens: 1`; a reply with no report reports the shared 1,000 input. */
const outputOne = (replies: readonly S6AReply[]): S6AReply[] => replies.map(reply => reply.kind === 'fail' ? reply
  : { ...reply, usage: { ...(reply.usage ?? usageOf(1_000)), outputTokens: 1 } });

describe('K2P2-05 the Work summary is admitted once, charged to R7, and replaces the old stubs', () => {
  it('K2P2-05 boundary R5, one summary request, summary + R6 + R7 in the last request', async () => {
    const world = await openK2WorkWorld({
      files: { big: 12, small: true },
      taskIds: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'],
      workBudget: { outputTokens: 8_193 },
    });
    worlds.push(world);
    const r1 = await world.runTask('r1', 'k2p2-05-r1', outputOne(bigReply(12, 100_000, 'R1')));
    await world.runTask('r2', 'k2p2-05-r2', outputOne(bigReply(12, 300_000, 'R2')));
    await world.runTask('r3', 'k2p2-05-r3', outputOne([{ kind: 'text', text: 'R3', usage: usageOf(350_000) }]));
    await world.runTask('r4', 'k2p2-05-r4', outputOne([{ kind: 'text', text: 'R4', usage: usageOf(390_000) }]));
    const r5 = await world.runTask('r5', 'k2p2-05-r5', outputOne([{ kind: 'text', text: 'R5', usage: usageOf(400_000) }]));
    const r6 = await world.runTask('r6', 'k2p2-05-r6', outputOne(bigReply(12, 499_000, 'R6')));

    const summary = '## 目标和验收义务\nA\n## 用户原话和要求\nB\n## 做过的决定和依据\nC\n## 没解决的事\nD\n## 试过什么、结果如何\nE\n## 来源\nF';
    world.world.scriptReplies([{ kind: 'text', text: summary,
      usage: { inputTokens: 1_000, outputTokens: 8_192, cachedInputTokens: 0, costUsdMicros: null } }]);
    const before = world.world.model.requests.length;
    const r7 = await world.runTask('r7', 'k2p2-05-r7', outputOne([{ kind: 'text', text: 'R7', usage: usageOf(1_000) }]));

    const records = await world.records();
    const written = compactions(records);
    expect(written).toHaveLength(2);
    const boundary = terminalOf(records, kernelRunIdOf(r5));
    expect(payloadOf(written[1]!)).toMatchObject({
      outcome: 'compacted', stubs: null, summary: { throughPosition: boundary },
    });
    expect(terminalOf(records, kernelRunIdOf(r1))).toBeLessThan(boundary);
    expect(terminalOf(records, kernelRunIdOf(r6))).toBeGreaterThan(boundary);

    const summaryCalls = world.world.model.requests.slice(before, before + 1);
    expect(summaryCalls).toHaveLength(1);
    const last = userText(summaryCalls[0]?.messages.at(-1));
    expect(last).toContain('请把上面这段对话写成一份压缩摘要');
    // R7 输入 = 摘要 + R6 + R7（§2.4 K2P2-05）：R7 由这条线的脚本队列供答，它的请求是队列的最后一次。
    const r7Request = (await world.requests()).at(-1)!;
    expect(r7Request.messages.filter(message => userText(message)?.includes(summary) === true)).toHaveLength(1);
    // R7 这个 Run 的请求记录（spec :925）：两条，先是摘要请求，再是 R7 那次，它的输出上限 = 8,193 − 8,192 = 1。
    const readPromptRecord = world.world.platform.runtime.readPromptRecord;
    if (readPromptRecord === undefined) throw new Error('K2P2-05: the Host runtime has no readPromptRecord');
    const promptRecord = await readPromptRecord.call(world.world.platform.runtime, world.world.humanContext(), r7);
    expect(promptRecord.status).toBe('ready');
    if (promptRecord.status !== 'ready') return;
    expect(promptRecord.value.requests.map(request => request.requestId))
      .toEqual([summaryCalls[0]!.requestId, r7Request.requestId]);
    expect(promptRecord.value.requests[1]).toMatchObject({ kind: 'work', maxOutputTokens: 1 });
  }, 360_000);
});
