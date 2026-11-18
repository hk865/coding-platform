/**
 * R6 工具撞墙 a/b/c（冻结稿第六节）：一个 S9 审阅世界、一个审阅 Query 的两批调用，各行共用这一份前置；只走公开入口，
 * 历史读拿公开路由 `executions/history` 比照。每行守的改坏：A1 派发器只打 issue.message；A2 展开了不接外层路径；
 * A3 并列只取第一种；B1 node 仍要 mode；B2 不认顶层 limit；B3 两处 limit 都给时不拒；C3 生句柄透传给读口；C4 不减半。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { answerS9Review, openS9ReviewRound, openS9ReviewWorld, s9ToolResult, type S9ReviewWorld, type S9ToolResult }
  from '../helpers/S9-review-fixture.js';
import { toolOutputJson } from '../scenarios/support/common.js';

type HistoryPage = { items: unknown[]; nextCursor: string | null };
const N = 3;
const call = (name: string, callId: string, args: Record<string, unknown>) => ({ callId, name, args });
/** 一条 30,000 字的路径，规整后是根目录，工具只回一句短拒绝；C4 的两条大记录各用一次。 */
const largeRead = (callId: string) =>
  ({ kind: 'calls' as const, calls: [call('read', callId, { path: './'.repeat(15_000) })] });
const pageOf = (result: S9ToolResult): HistoryPage => (result.output?.[0]?.value as { value?: HistoryPage } | undefined)
  ?.value ?? expect.unreachable(`not a ready page: ${JSON.stringify(result)}`);

let review: S9ReviewWorld;
let route: { first: HistoryPage; second: HistoryPage };
const result = (callId: string): Promise<S9ToolResult> => s9ToolResult(review, callId);
/** A1、A2、B3 共用：派发器拒参数（error、invalid_arguments），回它的消息；消息只在公开的 ToolResult 上。 */
async function refusedArguments(callId: string): Promise<string> {
  const refused = await result(callId);
  expect(refused.status).toBe('error');
  expect(refused.error?.code).toBe('invalid_arguments');
  return (refused as unknown as Extract<ToolResult, { status: 'error' }>).error.message;
}

beforeAll(async () => {
  review = await openS9ReviewWorld();
  const round = await openS9ReviewRound({ review, workReplies: [largeRead('r6-large-1'), largeRead('r6-large-2'),
    { kind: 'text', text: 'R6 subject work done' }] });
  // 路由 limit:200 读出 13 条，最大一条 31,841 字节（都在 48 KiB 以下），前三条 5,259、1,532、1,622 字节；
  // 前 6 条一页 76,959 字节（超 48 KiB），前 3 条 11,571 字节，所以 50→25→12→6→3 停在 n=3。
  const routePage = async (afterCursor: string | null, limit: number) => ready<HistoryPage>(await review.world.post(
    'executions/history', plain(S6A_SCOPE, { runRef: round.subjectRunRef, afterCursor, limit })), 'subject history');
  const first = await routePage(null, N);
  route = { first, second: await routePage(first.nextCursor, 1) };
  const run = { kind: 'run', ref: round.subjectRunRef };
  // 目标节点下只有两个顶层任务 s9-work、s9-gate，没有阶段，所以 limit:1 有下一页。
  const byOne = { mode: 'node', target: { kind: 'goal', ref: review.goal }, relation: 'children', limit: 1 };
  let secondBatch: Promise<void> = Promise.resolve();
  await answerS9Review(review, [{ kind: 'calls', calls: [
    call('look_graph', 'a1', { mode: 'node', target: run, runRef: round.subjectRunRef }),
    call('find_graph', 'a2', { memory: { v: 1, op: 'find', related: { kind: 'module', moduleId: 'm', extra: 1 } } }),
    // 审阅轮没有 history 写法：node 差 2（缺 target、多 runRef），记忆写法差 2（缺 memory、多两个键），path 差 3，input 差 5。
    call('look_graph', 'a3-tie', { runRef: round.subjectRunRef, page: { limit: 5 } }),
    call('look_graph', 'b1-default', { target: run }),
    call('look_graph', 'b1-control', { mode: 'node', target: run }),
    call('look_graph', 'b2-alias', byOne),
    call('look_graph', 'b3-both', { ...byOne, page: { limit: 1 } }),
    call('read_execution_history', 'c4-first', { limit: 50 }),
  ] }], { round, beforeEnd: async () => {
    // 按住第二次模型请求（它带回第一批的结果），取 C4 第一页的句柄排第二批再放行；收尾放第三次请求，第二批的结果才读得到。
    const gate = await review.world.gates.modelRequest(review.reviewLine!);
    secondBatch = gate.reached.then(async request => {
      const handle = (toolOutputJson(request, 'c4-first') as { value?: HistoryPage } | undefined)?.value?.nextCursor;
      await review.world.scripted.script(review.reviewLine!, [
        { kind: 'calls', calls: [call('read_execution_history', 'c3', { afterCursor: 'hc_000000000000', limit: 1 }),
          call('read_execution_history', 'c4-second', { afterCursor: handle, limit: 1 })] },
        { kind: 'calls', calls: [call('submit_exec_review', 'r6-pass',
          { verdict: 'pass', basis: 'R6 basis', report: 'R6 report' })] },
      ]);
    }).finally(() => gate.release());
  } });
  await secondBatch;
}, 180_000);
afterAll(async () => { await review?.close(); });

const rejects = [
  { name: 'A1: a union error names the closest writing and the extra key', check: async () =>
    expect(await refusedArguments('a1')).toBe('工具参数不符合 schema：(根): Unrecognized key: "runRef"') },
  { name: 'A2: a nested union error keeps its outer path', check: async () =>
    expect(await refusedArguments('a2')).toBe('工具参数不符合 schema：memory.related: Unrecognized key: "extra"') },
  { name: 'A3: tied closest writings are all listed, joined by 或', check: async () =>
    expect(await refusedArguments('a3-tie')).toBe('工具参数不符合 schema：target: Invalid input: expected object, received '
      + 'undefined; (根): Unrecognized key: "runRef" 或 memory: Invalid input: expected object, received undefined; '
      + '(根): Unrecognized keys: "runRef", "page"') },
  { name: 'B3: limit and page.limit together are refused, naming page.limit', check: async () =>
    expect(await refusedArguments('b3-both')).toContain('page.limit') },
  { name: 'C3: a handle this Run never returned is refused with the recovery reason', check: async () => {
    const refused = await result('c3');
    const value = refused.output?.[0]?.value as { status?: string; code?: string; reason?: string } | undefined;
    expect(refused.status).toBe('error');
    expect(value).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(value?.reason).toContain('afterCursor null');
  } },
];
const reads = [
  { name: 'B1: a node look without mode reads the same page as the mode:node control', check: async () =>
    expect(pageOf(await result('b1-default')).items).toEqual(pageOf(await result('b1-control')).items) },
  { name: 'B2: a top-level limit pages the node look', check: async () => {
    const page = pageOf(await result('b2-alias'));
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
  } },
  { name: 'C4: a page over 48 KiB halves to n=3, returns a handle, and the next page follows it', check: async () => {
    const firstResult = await result('c4-first');
    const first = pageOf(firstResult);
    expect(first.items).toHaveLength(N);
    expect(first.nextCursor).toMatch(/^hc_[0-9a-f]{12}$/);
    expect(Buffer.byteLength(JSON.stringify(firstResult))).toBeLessThanOrEqual(49_152);
    expect(first.items).toEqual(route.first.items);
    const second = pageOf(await result('c4-second'));
    expect(second.items).toHaveLength(1);
    expect(second.items).toEqual(route.second.items);
  } },
];

describe('R6 tool walls: the same one review Query answers both batches', () => {
  describe('rejects: invalid arguments and handles the Run never returned', () => {
    it.each(rejects)('$name', async ({ check }) => { await check(); });
  });
  it.each(reads)('$name', async ({ check }) => { await check(); });
});
