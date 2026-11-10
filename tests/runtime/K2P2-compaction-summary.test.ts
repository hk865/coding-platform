/**
 * Slice K2 P2: the summary call and its checks, through the real Host request driver and the scripted model
 * (book-k2-slim.frozen §2.2 world D/E; rows K2P2-01/02/03).
 *
 * The three ratios and their hand counts are §2.1: W = 1,000,000; trigger 400,000; target 200,000;
 * tailBudget 100,000. A large reply is 600,000 ASCII bytes; a small round is a 100-byte read. No row reads
 * the database or imports compaction.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { usageOf } from '../helpers/S6A-host-fixture.js';
import { compactions, openK2QueryWorld, type K2KernelRecord, type K2QueryWorld, type K2Reply } from '../helpers/K2-world.js';

/** P2: the Host starts a round-end handoff in its lifecycle pass, after the round reads ended. */
async function successorsOf(world: { world: { post(suffix: string, body: unknown): Promise<{ body: unknown }> } },
  sessionRef: unknown, expected: number): Promise<unknown[]> {
  let items: unknown[] = [];
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const answer = await world.world.post('sessions/successors', plain(S6A_SCOPE, { sessionRef, page: { limit: 10 } }));
    items = (answer.body as { value: { items: unknown[] } }).value.items;
    if (items.length >= expected) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return items;
}
const worlds: K2QueryWorld[] = [];
afterEach(async () => {
  const left = worlds.splice(0);
  await Promise.allSettled(left.map(world => world.close()));
});

type Ratios = NonNullable<Parameters<typeof openK2QueryWorld>[0]>['compaction'];
const openSummary = async (compaction?: Ratios): Promise<K2QueryWorld> => {
  const world = await openK2QueryWorld(compaction === undefined ? {} : { compaction });
  worlds.push(world);
  return world;
};

const payloadOf = (record: K2KernelRecord): Record<string, unknown> =>
  (record as unknown as { payload: Record<string, unknown> }).payload;
const textOf = (message: ModelRequest['messages'][number] | undefined): string | null => {
  if (message === undefined || message.role !== 'user') return null;
  return (message as unknown as { content: string }).content;
};
const large = (inputTokens: number): readonly K2Reply[] => [
  { kind: 'calls', calls: [{ callId: 'small', name: 'read', args: { path: 'small.txt' } }] },
  { kind: 'text', text: 'a'.repeat(600_000), usage: usageOf(inputTokens) },
];
const short = (inputTokens: number): readonly K2Reply[] => [{ kind: 'text', text: 'short', usage: usageOf(inputTokens) }];



const SIX = '## 目标和验收义务\nA\n## 用户原话和要求\nB\n## 做过的决定和依据\nC\n## 没解决的事\nD\n## 试过什么、结果如何\nE\n## 来源\nF';

/** World D through Q5: two large replies, then three short rounds, the last reporting 400,000. */
async function worldD(compaction?: Ratios): Promise<K2QueryWorld> {
  const world = await openSummary(compaction);
  await world.round('q1', large(100_000));
  await world.round('q2', large(300_000));
  await world.round('q3', short(350_000));
  await world.round('q4', short(390_000));
  await world.round('q5', short(400_000));
  return world;
}

describe('K2P2-01 the summary call is the same model and tools, sees the boundary history, and is blocked', () => {
  it('K2P2-01 writes compacted with a summary through Q2 and no stubs; the line gains no Turn', async () => {
    const world = await worldD();
    const beforeTurns = (await world.records()).filter(record => record.recordType === 'turn.started').length;
    const q6 = await world.round('q6', [
      { kind: 'text', text: SIX, usage: { inputTokens: 1_000, outputTokens: 8_192, cachedInputTokens: 0, costUsdMicros: null } },
      { kind: 'text', text: 'Q6', usage: usageOf(1_000) },
    ]);
    const summaryRequest = q6.requests[0];
    expect(summaryRequest).toBeDefined();
    expect(textOf(summaryRequest!.messages.at(-1))).toBe(`请把上面这段对话写成一份压缩摘要。之后这条线只看这份摘要和最近几轮的原文，更早的原文不再交给你；原记录不会删除。

只回答摘要正文，不要调用工具。摘要按顺序分成下面六段，每段用给定的标题，一段都不能少；某段没有内容就写“无”。

## 目标和验收义务
## 用户原话和要求
## 做过的决定和依据
## 没解决的事
## 试过什么、结果如何
## 来源

写的时候：
- 用户的原话照抄，不改写；你推测的，标“推测”。
- “没解决的事”写待处理的请求、在等的回复、待放行的事和未决问题。
- “试过什么、结果如何”也写失败的和排除的路。
- 注记和当前理解只写链接，不抄内容。
- 计划和派工只写引用和版本；下一轮照旧重读正式事实。
- 还在等批准的，不能写成已批准。
- 已经撤下的结论，不要从旧摘要里再写回来。
- “来源”一行一条，只用下面四种写法：
  - 文件 <工作区相对路径>
  - 文件 <路径> 提交 <40–64 位小写十六进制>
  - 消息 <messageId>
  - 检查 <goalId>/<taskId>/<runId>/<roundId>
  提交只能写成“文件在某个提交里的版本”，不要单写提交号。`);
    const written = compactions(await world.records());
    expect(written).toHaveLength(1);
    expect(payloadOf(written[0]!)['outcome']).toBe('compacted');
    expect(payloadOf(written[0]!)['stubs']).toBeNull();
    expect(payloadOf(written[0]!)['summary']).not.toBeNull();
    const afterTurns = (await world.records()).filter(record => record.recordType === 'turn.started').length;
    expect(afterTurns).toBe(beforeTurns + 1);
  }, 300_000);
});

describe('K2P2-02 a failed summary writes failed and leaves the view unchanged', () => {
  it('K2P2-02 (a1) failed then 499,999 does not hand off', async () => {
    const world = await worldD();
    await world.round('q6', [
      { kind: 'error', code: 'provider_request_failed', retryable: false } as unknown as K2Reply,
      { kind: 'text', text: 'Q6', usage: usageOf(499_999) },
    ]);
    const written = compactions(await world.records());
    expect(written).toHaveLength(1);
    expect(payloadOf(written[0]!)['outcome']).toBe('failed');
    await world.world.post('workflow/advance', plain(S6A_SCOPE, {
      schemaVersion: 1, goalRef: world.goal, flowId: 'k2-02a1', sessionHint: null, kind: 'select_work' }));
    const successors = await world.world.post('sessions/successors', plain(S6A_SCOPE, {
      sessionRef: world.line.ref, page: { limit: 10 } }));
    expect((successors.body as { value: { items: unknown[] } }).value.items).toEqual([]);
  }, 300_000);

  it('K2P2-02 (a2) failed then 500,000 hands off because wouldCompactNext is false', async () => {
    const world = await worldD();
    await world.round('q6', [
      { kind: 'error', code: 'provider_request_failed', retryable: false } as unknown as K2Reply,
      { kind: 'text', text: 'Q6', usage: usageOf(500_000) },
    ]);
    await world.world.post('workflow/advance', plain(S6A_SCOPE, {
      schemaVersion: 1, goalRef: world.goal, flowId: 'k2-02a2', sessionHint: null, kind: 'select_work' }));
    expect(await successorsOf(world, world.line.ref, 1)).toHaveLength(1);
  }, 300_000);

  it.each([
    ['section_missing:2', '## 目标和验收义务\nA\n## 做过的决定和依据\nC\n## 没解决的事\nD\n## 试过什么、结果如何\nE\n## 来源\nF', { inputTokens: 1_000, outputTokens: 1, cachedInputTokens: 0, costUsdMicros: null }],
    ['over_cap', SIX, { inputTokens: 1_000, outputTokens: 8_193, cachedInputTokens: 0, costUsdMicros: null }],
  ] as const)('K2P2-02 (%s) writes the named failure', async (reason, text, usage) => {
    const world = await worldD();
    await world.round('q6', [{ kind: 'text', text, usage }, { kind: 'text', text: 'Q6', usage: usageOf(1_000) }]);
    const written = compactions(await world.records());
    expect(written).toHaveLength(1);
    expect(payloadOf(written[0]!)).toMatchObject({ outcome: 'failed', failure: { reason } });
  }, 300_000);
});

describe('K2P2-03 a second summary keeps the old summary as its first history message', () => {
  it('K2P2-03 the new summary starts at the old summary and covers Q5', async () => {
    const world = await openSummary();
    await world.round('q1', large(100_000));
    await world.round('q2', short(200_000));
    await world.round('q3', short(300_000));
    await world.round('q4', short(350_000));
    await world.round('q5', short(400_000));
    await world.round('q6', [
      { kind: 'text', text: SIX, usage: { inputTokens: 1_000, outputTokens: 8_192, cachedInputTokens: 0, costUsdMicros: null } },
      ...large(499_000),
    ]);
    const q7 = await world.round('q7', [
      { kind: 'text', text: SIX, usage: { inputTokens: 1_000, outputTokens: 8_192, cachedInputTokens: 0, costUsdMicros: null } },
      { kind: 'text', text: 'Q7', usage: usageOf(1_000) },
    ]);
    const written = compactions(await world.records());
    expect(written).toHaveLength(2);
    expect(payloadOf(written[1]!)['summary']).not.toBeNull();
    expect(payloadOf(written[1]!)['stubs']).toBeNull();
    expect(textOf(q7.requests[0]!.messages[0])).toContain(SIX);
  }, 360_000);
});
