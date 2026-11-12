/**
 * KLS-2c-1 bad and conflicting knowledge files through a real Host (K06, K06b, K07, K08; [2C1-15], [2C1-17], b2 ruling
 * F-3: the graph is read every round, a workspace that never had one is no issue). A person breaks
 * a module file, or makes two module files conflict, under a running Host. The idle reconcile leaves the architecture
 * read unavailable with the file named, tells the person once in the decision queue (`knowledge_conflict`; the same
 * problems never twice), and asks the region adviser of a conflicting module, when there is one, for an architecture
 * revision (`action_request`, once per adviser, module and notice); it makes no card. While the conflict stands the
 * decision queue still reads (stk16 ruling 1–2: only the conflict cards go, `goal_conflict` not_available). The world is
 * `KLS2C-knowledge-host.ts` (idle threshold 0, so every heartbeat reconciles); the adviser comes from `role-lines/open`,
 * its messages from `messages/inbox` and `messages/body`, the cards from `decisions/queue`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain, startLinesEnded } from '../helpers/AG2b-collaboration-fixture.js';
import {
  kls2cAdopt, kls2cConflict, kls2cModuleFile, KLS2C_NEVER_IDLE_MS, openKLS2CHost, type KLS2CHost,
} from '../helpers/KLS2C-knowledge-host.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';

type SessionRef = { projectId: string; sessionId: string };
type InboxItem = { ref: { messageId: string }; intent?: string };

const worlds: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0).reverse()) await world.close();
  await cleanupRestart();
});

/** A Host world with `core` and `other` adopted through `architecture/adopt-initial`. */
async function adoptedWorld(storage: 'memory' | 'sqlite', kernelStore?: true): Promise<KLS2CHost> {
  const world = await openKLS2CHost({ storage, git: true, ...(kernelStore === undefined ? {} : { kernelStore }) });
  worlds.push(world);
  await kls2cAdopt(world, ['core', 'other']);
  return world;
}

/** A plain route read in the world's scope; `ready` or the row stops. */
const readRoute = async <T>(world: KLS2CHost, suffix: string, input: unknown): Promise<T> =>
  readyValue<T>(await world.call(suffix, plain(world.scope, input)), suffix);

/** The `action_request` messages in one Session's inbox. */
async function actionRequests(world: KLS2CHost, recipient: SessionRef): Promise<InboxItem[]> {
  const page = await readRoute<{ items: InboxItem[] }>(world, 'messages/inbox', { recipient, page: { limit: 100 } });
  return page.items.filter(item => item.intent === 'action_request');
}

/** The `action_request` messages in every Session's inbox of the workspace (`sessions/find`). */
async function everyActionRequest(world: KLS2CHost): Promise<InboxItem[]> {
  const found = await readRoute<{ items: { record: { ref: SessionRef } }[] }>(world, 'sessions/find',
    { workspace: world.scope, includeArchived: true, page: { limit: 100 } });
  const all: InboxItem[] = [];
  for (const card of found.items) {
    all.push(...await actionRequests(world, { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId }));
  }
  return all;
}

/**
 * The opening lines (O1b) settle first, so every later Session comes from the row; then, given a command id, a region
 * adviser directly on `core` (`role-lines/open`).
 */
async function settledLines(world: KLS2CHost, adviserCommand: string | null): Promise<SessionRef | null> {
  await startLinesEnded(async () => await world.call('role-lines/operations', plain(world.scope, { workspace: world.scope })));
  if (adviserCommand === null) return null;
  const opened = await world.call<{ status: string; value?: { session: SessionRef | null } }>('role-lines/open',
    graphWrite(world.scope, { duty: 'adviser', scope: [{ kind: 'region',
      moduleRef: { projectId: world.scope.projectId, moduleId: 'core' } }] }, adviserCommand));
  if (opened.status !== 'committed' || !opened.value?.session) throw new Error(`role-lines/open: ${JSON.stringify(opened)}`);
  return opened.value.session;
}

type QueueRead = { waitingAnswer: { source: { kind: string } }[]; notices: { summary: string }[];
  capabilities: { source: string; availability: string }[] };
/** `decisions/queue` read as the Decide page reads it: the waiting cards and the notices in one read. */
const decideQueue = (world: KLS2CHost): Promise<QueueRead> => readRoute<QueueRead>(world, 'decisions/queue',
  { workspace: world.scope, sections: ['waiting_answer', 'notices'], page: { limit: 100 } });

describe.each(['memory', 'sqlite'] as const)('%s', storage => {
  it('K06 a module file that is not JSON: the architecture read is unavailable naming it, one knowledge_conflict notice', async () => {
    const world = await adoptedWorld(storage);
    const broken = kls2cModuleFile(world, 'other');
    world.edit(broken, '{ "id": "other", not json');
    await world.idle();
    const read = await world.call<{ status: string; code?: string; reason?: string }>('architecture/read',
      plain(world.scope, { selection: { kind: 'current' } }));
    expect(read).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(read.reason).toContain(broken);
    // [2C1-17] 第 8 步：坏文件进 issues，issues 不空就出一条。
    // 具名改坏：第 8 步只在 conflicts 不空时出通知（坏文件不进通知）→ 红在这一句（0 条）。
    const notices = await world.notices('knowledge_conflict');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.summary).toContain(broken);
    await world.idle();
    // [2C1-15]：同样的问题身份相同，不再通知。
    expect(await world.notices('knowledge_conflict')).toHaveLength(1);
  }, 120_000);
});

it('K06b a workspace that never had a graph has no notice; an architecture.json a person puts in, naming a module with no file, is one knowledge_conflict at the next round', async () => {
  const first = await openKLS2CHost({ storage: 'sqlite', git: true });
  worlds.push(first);
  await first.idle();
  // b2 裁定 F-3：从没采用过架构的工作区读回“没有图”，不算问题。
  // 具名改坏：第 8 步整图读不成就记问题、不排除“没有图” → 红在这一句（1 条）。
  expect(await first.notices('knowledge_conflict')).toEqual([]);
  await worlds.pop()?.close();
  // 人放进一个能解析、但点名了没有模块文件的模块的 architecture.json：第 7 步认它是好文件，只有整图读认得出图坏。
  first.edit('.workbench/architecture.json',
    `${JSON.stringify({ modules: ['ghost'], crossWorkspace: { dependsOn: [], contains: [] } }, null, 2)}\n`);
  // 下一轮正好一轮：同一个库和根上再起 Host，空闲阈值够不着，只跑启动对账（它在 Host 起来之前做完）。
  const world = await openKLS2CHost({ storage: 'sqlite', git: true, database: first.database, root: first.root,
    idleMs: KLS2C_NEVER_IDLE_MS });
  worlds.push(world);
  // b2 裁定 F-3：每轮都读整图，人放进坏文件后的第一轮就出一条。
  // 具名改坏：整图读只在上一轮索引里有图文件时才做 → 红在这一句（0 条）。
  const notices = await world.notices('knowledge_conflict');
  expect(notices).toHaveLength(1);
  expect(notices[0]?.summary).toContain('.workbench/architecture.json');
}, 180_000);

it.each([
  ['① 两个模块文件都写 "id":"core"', 'same_id'],
  ['② 两个模块的 paths 都有 src/core', 'same_path'],
] as const)('K07 a semantic conflict between two module files is one knowledge_conflict naming both: %s', async (_, kind) => {
  const world = await adoptedWorld('memory');
  const [core, other] = kls2cConflict(world, kind);
  await world.idle();
  // [2C1-17] 第 8 步：knowledgeConflictsOf 的冲突进 conflicts，summary 列两个文件。
  // 具名改坏：对账不调 knowledgeConflictsOf（只看坏文件）→ ① 只剩整图读失败那一处、② 没有通知，两条都红在 summary。
  const summaries = (await world.notices('knowledge_conflict')).map(notice => notice.summary);
  expect(summaries).toHaveLength(1);
  expect(summaries[0]).toContain(core);
  expect(summaries[0]).toContain(other);
}, 120_000);

it.each([
  ['① 有直接认领 core 的区域参谋：它收到一条 action_request，点名 propose_architecture_revision', true],
  ['② 没有参谋：通知照出，没有人收到 action_request', false],
] as const)('K08 a conflict asks the region adviser for a revision: %s', async (_, withAdviser) => {
  const world = await adoptedWorld('memory', true);
  const adviser = await settledLines(world, withAdviser ? 'kls2c1-k08-adviser' : null);
  kls2cConflict(world, 'same_id');
  await world.idle();
  expect(await world.notices('knowledge_conflict')).toHaveLength(1);
  // 不新造卡（冲突前没有结构提案卡，实跑核过）。stk16 裁定第 1、2 条：冲突在场时决定队列照读，同一次读里有这条通知，
  // 只有目标冲突卡读不了（`goal_conflict` 是 not_available）。
  // 具名改坏：架构读 unavailable 就整次返回（去掉调查第三节 A）→ 红在这一句（`decisions/queue` 不是 ready）。
  const queue = await decideQueue(world);
  expect([queue.waitingAnswer.filter(card => card.source.kind === 'structural_proposal'),
    queue.notices.filter(item => item.summary.includes('知识文件有')).length,
    queue.capabilities.find(entry => entry.source === 'goal_conflict')?.availability]).toEqual([[], 1, 'not_available']);
  if (adviser === null) {
    // [2C1-17]：没有区域参谋就只通知（冲突前所有 Session 的收件箱里没有 action_request，实跑核过）。
    expect(await everyActionRequest(world)).toEqual([]);
    return;
  }
  // [2C1-17] + 定稿第二节 regionAdviserOf：冲突模块 core 的区域参谋收到 action_request。
  // 具名改坏：对账不发 action_request → 只有条目 ① 红在这一句（0 条）。
  const requests = await actionRequests(world, adviser);
  expect(requests).toHaveLength(1);
  const body = await readRoute<{ text: string }>(world, 'messages/body', { messageRef: requests[0]?.ref, part: 'message' });
  expect(body.text).toContain('propose_architecture_revision');
  await world.idle();
  // 同一个（参谋、模块、通知身份）只发一次。
  expect(await actionRequests(world, adviser)).toHaveLength(1);
}, 120_000);

// b2 Astra 1（lead 收）：“从没采用过”看平台记录里的采用事实，不看磁盘和上一轮索引；已采用的工作区缺图，每一轮都是同一处问题。
it('K08b adopted, then architecture.json deleted and a path claimed by two modules: round after round the same problem '
  + 'list, one knowledge_conflict notice and one request to the adviser', async () => {
  const world = await adoptedWorld('memory', true);
  const adviser = (await settledLines(world, 'kls2c1-k08b-adviser'))!;
  await world.idle();
  // 两处改动在同一个同步段里：屏障放行时这一轮已经跑完，下一轮要等下一次心跳（计时器），读文件之前还有 I/O。
  world.remove('.workbench/architecture.json');
  const [core, other] = kls2cConflict(world, 'same_path');
  await world.idle();
  // 具名改坏：第 8 步改回“磁盘或上一轮索引里有 architecture.json 才记”→ 第二轮只剩路径冲突、身份变了，红在这一句（2 条）。
  const notices = await world.notices('knowledge_conflict');
  expect(notices.map(notice => ['.workbench/architecture.json', core, other]
    .every(path => notice.summary.includes(path)))).toEqual([true]);
  expect(await actionRequests(world, adviser)).toHaveLength(1);
  await world.idle();
  expect([await world.notices('knowledge_conflict'), (await actionRequests(world, adviser)).length]).toEqual([notices, 1]);
}, 120_000);

// b2 Astra 2（lead 收）：路径多到一条消息装不下时，正文按邮箱上限截断，模块、原因和 propose_architecture_revision 都在。
it('K08c a conflict listing more paths than one message holds still asks the adviser once, the instruction whole and '
  + 'the left-out paths counted', async () => {
  const world = await adoptedWorld('memory', true);
  const adviser = (await settledLines(world, 'kls2c1-k08c-adviser'))!;
  const copy = world.read(kls2cModuleFile(world, 'core'))?.toString('utf8') ?? '';
  await world.idle();
  // 200 份 core 模块文件的副本，文件名约 100 个字符：同 id 冲突的路径合起来超过邮箱的 16 KiB（同一个同步段，理由同 K08b）。
  for (let i = 0; i < 200; i += 1) world.edit(`.workbench/modules/${'k'.repeat(96)}${String(i).padStart(3, '0')}.json`, copy);
  await world.idle();
  // 具名改坏：正文照旧拼全部路径、不截断 → 邮箱回 capacity，红在这一句（0 条）。
  const requests = await actionRequests(world, adviser);
  expect(requests).toHaveLength(1);
  const body = await readRoute<{ text: string }>(world, 'messages/body', { messageRef: requests[0]?.ref, part: 'message' });
  expect([body.text.includes('模块 core'), body.text.includes('duplicate_module_id'),
    body.text.includes('propose_architecture_revision'), /还有 \d+ 条路径没列出/.test(body.text)])
    .toEqual([true, true, true, true]);
  await world.idle();
  expect(await actionRequests(world, adviser)).toHaveLength(1);
}, 120_000);
