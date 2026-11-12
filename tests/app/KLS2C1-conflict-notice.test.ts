/**
 * KLS-2c-1 bad and conflicting knowledge files through a real Host (K06, K06b, K07, K08; [2C1-15], [2C1-17], b2 ruling
 * F-3: the graph is read every round, a workspace that never had one is no issue). A person breaks
 * a module file, or makes two module files conflict, under a running Host. The idle reconcile leaves the architecture
 * read unavailable with the file named, tells the person once in the decision queue (`knowledge_conflict`; the same
 * problems never twice), and asks the region adviser of a conflicting module, when there is one, for an architecture
 * revision (`action_request`, once per adviser, module and notice); it makes no card. The world is
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

/** The structural proposal cards waiting for the person (`decisions/queue`). */
async function proposalCards(world: KLS2CHost): Promise<number> {
  const queue = await readRoute<{ waitingAnswer: { source: { kind: string } }[] }>(world, 'decisions/queue',
    { workspace: world.scope, sections: ['waiting_answer'], page: { limit: 100 } });
  return queue.waitingAnswer.filter(card => card.source.kind === 'structural_proposal').length;
}

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
  // The three opening lines (O1b) settle first, so every later Session comes from this row.
  await startLinesEnded(async () => await world.call('role-lines/operations', plain(world.scope, { workspace: world.scope })));
  let adviser: SessionRef | null = null;
  if (withAdviser) {
    const opened = await world.call<{ status: string; value?: { session: SessionRef | null } }>('role-lines/open',
      graphWrite(world.scope, { duty: 'adviser', scope: [{ kind: 'region',
        moduleRef: { projectId: world.scope.projectId, moduleId: 'core' } }] }, 'kls2c1-k08-adviser'));
    if (opened.status !== 'committed' || !opened.value?.session) throw new Error(`role-lines/open: ${JSON.stringify(opened)}`);
    adviser = opened.value.session;
  }
  const other = kls2cModuleFile(world, 'other');
  const otherText = world.read(other)?.toString('utf8') ?? '';
  kls2cConflict(world, 'same_id');
  await world.idle();
  expect(await world.notices('knowledge_conflict')).toHaveLength(1);
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
  // 不新造卡（冲突前没有结构提案卡，实跑核过）。冲突没清时 decisions/queue 的待回答段要读架构，回 unavailable
  // （2a-1 的读回闸门，b2 裁定第一节第 3 条不改它），所以人把文件改回、再过一轮之后再数。
  world.edit(other, otherText);
  await world.idle();
  expect(await proposalCards(world)).toBe(0);
}, 120_000);
