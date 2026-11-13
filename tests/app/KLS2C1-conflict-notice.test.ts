/**
 * KLS-2c-1 bad and conflicting knowledge files through a real Host (K06, K06b, K07; KC-1 K08/V1–V5; [2C1-15],
 * [2C1-17], b2 ruling F-3, 121-106 ①②, 4-7, 4-8). A person breaks a module file, or makes two module files conflict,
 * under a running Host. The idle reconcile leaves the architecture read unavailable with the file named, tells the
 * person once in the decision queue (`knowledge_conflict`; the same problems never twice), and (KC-1, KC-3) when the
 * notice has a path claimed by two modules, a duplicate id, a dangling reference or a bad architecture or module file
 * it opens one `knowledge_conflict` exploration follow-up per region and hands each region its places in the round's
 * question — the adviser gets the round's `action_request`, whose text carries the region question and a line per
 * place (the old "please propose a revision" letter is gone; the notice's other places and a bad note stay in the
 * notice only). It makes no card. While the
 * conflict stands the decision queue still reads (stk16 ruling 1–2: only the conflict cards go, `goal_conflict`
 * not_available). The world is `KLS2C-knowledge-host.ts` (idle threshold 0, so every heartbeat reconciles); the
 * adviser comes from `role-lines/open`, its follow-up from `role-lines/operations` (the `followUp` field), its
 * messages from `messages/inbox` and `messages/body`, the cards from `decisions/queue`.
 *
 * **Today (base `7dkc1t-base`) V1 is red at the follow-up read** (`role-lines/operations` has no
 * `knowledge_conflict` follow-up; the old tree still sends the "please propose a revision" `action_request`), **V2 and
 * V4 are red at the request count** (the old tree asks the adviser about a duplicate id and about a path conflict with
 * an issue too: 1 instead of 0), **V5 is red in the request body** (the old letter has neither the region question nor
 * `……`), **V3 is green today as a guard** (no adviser already sends nothing, and the notice is one). After the package lands
 * V1–V5 are green by the draft's §2.2: one place per module-id set, one region per place, and the round's text is the
 * region question plus the truncated place list. KC-3 (121-106 ②, kc3 draft §4 A) turned V2, V4 and V4b: a duplicate
 * id opens the round, and the issues beside a path claim no longer keep it shut.
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

/** A `role_line` row of `role-lines/operations` that carries an exploration follow-up (the view's `followUp`). */
type FollowUpRow = { action: string; followUp?: { kind: string; moduleRefs: { projectId: string; moduleId: string }[];
  reason: string | null; sourceBatchRef: unknown } | null };
/** The workspace's follow-up rows from `role-lines/operations` (the read the DEXC rows filter the same way). */
async function followUps(world: KLS2CHost): Promise<FollowUpRow[]> {
  const rows = readyValue<FollowUpRow[]>(await world.call('role-lines/operations',
    plain(world.scope, { workspace: world.scope })), 'role-lines/operations');
  return rows.filter(row => row.action === 'role_line' && row.followUp !== undefined && row.followUp !== null);
}

/** One region adviser line on `moduleId` (`role-lines/open`), after the opening lines settled. */
async function openRegionAdviser(world: KLS2CHost, moduleId: string, commandId: string): Promise<SessionRef> {
  const opened = await world.call<{ status: string; value?: { session: SessionRef | null } }>('role-lines/open',
    graphWrite(world.scope, { duty: 'adviser', scope: [{ kind: 'region',
      moduleRef: { projectId: world.scope.projectId, moduleId } }] }, commandId));
  if (opened.status !== 'committed' || !opened.value?.session) throw new Error(`role-lines/open: ${JSON.stringify(opened)}`);
  return opened.value.session;
}

/**
 * The opening lines (O1b) settle first, so every later Session comes from the row; then, given a command id, a region
 * adviser directly on `core` (`role-lines/open`).
 */
async function settledLines(world: KLS2CHost, adviserCommand: string | null): Promise<SessionRef | null> {
  await startLinesEnded(async () => await world.call('role-lines/operations', plain(world.scope, { workspace: world.scope })));
  return adviserCommand === null ? null : await openRegionAdviser(world, 'core', adviserCommand);
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

it('V1 one path claimed by two modules opens one knowledge_conflict follow-up for the region adviser, and the round\'s '
  + 'action_request carries the region question with the place (121-106 ①; 4-7; draft §2.2)', async () => {
  const world = await adoptedWorld('memory', true);
  const adviser = (await settledLines(world, 'kc1t-v1-adviser'))!;
  kls2cConflict(world, 'same_path');
  await world.idle();
  // stk16 裁定第 1、2 条（K08 原来的护栏，不能丢）：冲突在场时决定队列照读，同一次读里有这条通知、没有结构提案卡。
  // 双认领不弄坏架构图（它是 knowledgeConflictsOf 的冲突，不是 architectureOfFiles 的 invalid），所以 `goal_conflict`
  // 这一格今天仍是 available；同 id 的不可读那条护栏在 V2。具名改坏：架构读 unavailable 就整次返回 → 红在这次读。
  const queue = await decideQueue(world);
  expect([queue.waitingAnswer.filter(card => card.source.kind === 'structural_proposal'),
    queue.notices.filter(item => item.summary.includes('知识文件有')).length]).toEqual([[], 1]);
  // 具名改坏：续轮 key 带上触发或时间 → 2 个；区域取 moduleIds 最后一个（other 没有参谋）→ 0 个。
  // 今天红在这一句：旧树没有 knowledge_conflict 续轮，`followUps` 是 []（旧树发的是“请提修订”的信）。
  const follows = await followUps(world);
  expect(follows.map(row => row.followUp)).toMatchObject([{ kind: 'knowledge_conflict',
    moduleRefs: [{ projectId: world.scope.projectId, moduleId: 'core' }], sourceBatchRef: null }]);
  // 具名改坏：对账不发续轮 / 续轮不开 QueryRun → 红在请求数（0 条）。
  const requests = await actionRequests(world, adviser);
  expect(requests).toHaveLength(1);
  const body = await readRoute<{ text: string }>(world, 'messages/body', { messageRef: requests[0]?.ref, part: 'message' });
  expect([body.text.includes('Please act: explore only the region core'),
    body.text.includes('模块 core、other 都认领了 src/core'),
    body.text.includes('propose_architecture_revision')]).toEqual([true, true, true]);
  await world.idle();
  // 121-106 ①：同一个通知一轮，第二次心跳仍各 1（通知、续轮、请求）。
  expect([(await world.notices('knowledge_conflict')).length, (await followUps(world)).length,
    (await actionRequests(world, adviser)).length]).toEqual([1, 1, 1]);
}, 120_000);

it('V1b one place is handed to the first module\'s region adviser only, even when both modules have one (4-7)',
  async () => {
  const world = await adoptedWorld('memory', true);
  await settledLines(world, null);
  const coreAdviser = await openRegionAdviser(world, 'core', 'kc1t-v1b-core');
  const otherAdviser = await openRegionAdviser(world, 'other', 'kc1t-v1b-other');
  kls2cConflict(world, 'same_path');
  await world.idle();
  // 具名改坏：一处交给每个认领模块的参谋（regionAdvisersOf 问全部 moduleIds、given 按每个模块取参谋）→
  // 续轮的区域变成 core、other，红在第二句；other 的收件仍为空，是这一格守的公开行为。
  expect([(await actionRequests(world, coreAdviser)).length, (await actionRequests(world, otherAdviser)).length,
    (await everyActionRequest(world)).length]).toEqual([1, 0, 1]);
  const follows = await followUps(world);
  expect(follows.map(row => row.followUp)).toMatchObject([{ kind: 'knowledge_conflict',
    moduleRefs: [{ projectId: world.scope.projectId, moduleId: 'core' }], sourceBatchRef: null }]);
}, 120_000);

it('V2 a duplicate module id opens the repair round too: one notice, one follow-up and one request (121-106 ②, KC-3)',
  async () => {
    const world = await adoptedWorld('memory', true);
    const adviser = (await settledLines(world, 'kc1t-v2-adviser'))!;
    kls2cConflict(world, 'same_id');
    await world.idle();
    expect(await world.notices('knowledge_conflict')).toHaveLength(1);
    // stk16 裁定第 1、2 条（K08 ① 原来的护栏，跟同 id 这一格走）：同一次读里有通知、没有结构提案卡，图读不出时目标冲突
    // 卡读不了。具名改坏：架构读 unavailable 就整次返回 → 红在这一句（`decisions/queue` 不是 ready）。
    const queue = await decideQueue(world);
    expect([queue.waitingAnswer.filter(card => card.source.kind === 'structural_proposal'),
      queue.notices.filter(item => item.summary.includes('知识文件有')).length,
      queue.capabilities.find(entry => entry.source === 'goal_conflict')?.availability]).toEqual([[], 1, 'not_available']);
    // KC-3（121-106 ②）：重号也开修复轮，交给 core 所在区域的参谋。具名改坏：恢复“只有双认领才开”的条件 → 0 个续轮 / 0 条请求。
    expect([(await followUps(world)).length, (await everyActionRequest(world)).length,
      (await actionRequests(world, adviser)).length]).toEqual([1, 1, 1]);
  }, 120_000);

it('V3 no region adviser: the notice still comes, nobody gets a follow-up or a request ([2C1-17])', async () => {
  const world = await adoptedWorld('memory', true);
  await settledLines(world, null);
  kls2cConflict(world, 'same_path');
  await world.idle();
  // 今天绿（护栏）：没有参谋时旧树也只通知；落地后它守“没有参谋就不开续轮”。
  expect(await world.notices('knowledge_conflict')).toHaveLength(1);
  expect([(await followUps(world)).length, (await everyActionRequest(world)).length]).toEqual([0, 0]);
}, 120_000);

// b2 Astra 1（lead 收）：“从没采用过”看平台记录里的采用事实，不看磁盘和上一轮索引；已采用的工作区缺图，每一轮都是同一处问题。
it('V4 adopted, then architecture.json deleted and a path claimed by two modules: the notice stays one (its identity '
  + 'does not move) and the round opens for the path claim once (包计划 §3.4-5; KC-3)', async () => {
  const world = await adoptedWorld('memory', true);
  const adviser = (await settledLines(world, 'kc1t-v4-adviser'))!;
  await world.idle();
  // 两处改动在同一个同步段里：屏障放行时这一轮已经跑完，下一轮要等下一次心跳（计时器），读文件之前还有 I/O。
  world.remove('.workbench/architecture.json');
  const [core, other] = kls2cConflict(world, 'same_path');
  await world.idle();
  // 具名改坏：第 8 步改回“磁盘或上一轮索引里有 architecture.json 才记”→ 第二轮只剩路径冲突、身份变了，红在这一句（2 条）。
  const notices = await world.notices('knowledge_conflict');
  expect(notices.map(notice => ['.workbench/architecture.json', core, other]
    .every(path => notice.summary.includes(path)))).toEqual([true]);
  // KC-3：缺图这一处只留在通知里，不再挡住路径冲突的修复轮。
  expect([(await followUps(world)).length, (await actionRequests(world, adviser)).length]).toEqual([1, 1]);
  await world.idle();
  // 同一个通知只开一轮：第二次心跳仍是一条通知、一个续轮、一条请求。
  expect([await world.notices('knowledge_conflict'), (await followUps(world)).length,
    (await actionRequests(world, adviser)).length]).toEqual([notices, 1, 1]);
}, 120_000);

// KC-3: a bad note is not a repair target; the round opens for the path claim beside it, and the note stays a
// recovery item of the notice only (kc3 draft §1, §4 A).
it('V4b a path conflict plus a bad note file: the round opens for the path conflict, the note is not in its text', async () => {
  const world = await adoptedWorld('memory', true);
  const adviser = (await settledLines(world, 'kc1t-v4b-adviser'))!;
  const note = `.workbench/notes/${world.scope.workspaceId}/not-a-note.md`;
  world.edit(note, 'this is not a knowledge note\n');
  await world.idle();   // the bad note alone is one notice; it has no conflict to repair
  const [core, other] = kls2cConflict(world, 'same_path');
  await world.idle();
  const notices = await world.notices('knowledge_conflict');
  const withBoth = notices.filter(notice => [note, core, other].every(path => notice.summary.includes(path)));
  expect(withBoth).toHaveLength(1);
  // 具名改坏：坏注记也算修复目标 → 问题文字里出现注记路径，红在最后一句。
  expect([(await followUps(world)).length, (await actionRequests(world, adviser)).length]).toEqual([1, 1]);
  const request = (await actionRequests(world, adviser))[0];
  const body = await readRoute<{ text: string }>(world, 'messages/body', { messageRef: request?.ref, part: 'message' });
  expect([body.text.includes('src/core'), body.text.includes(note)]).toEqual([true, false]);
}, 120_000);

// b2 Astra 2（lead 收）：路径多到一条消息装不下时，正文按邮箱上限截断，区域问句、省略号和工具名都在。
it('V5 a path-only conflict whose place is longer than one message still asks the adviser once, the region question '
  + 'whole and the place cut with "……" (draft §2.2-4)', async () => {
  const world = await adoptedWorld('memory', true);
  const adviser = (await settledLines(world, 'kc1t-v5-adviser'))!;
  const core = kls2cModuleFile(world, 'core');
  const copy = JSON.parse(world.read(core)?.toString('utf8') ?? '{}') as Record<string, unknown>;
  await world.idle();
  // 200 个不同号的模块文件，paths 都是 src/core，文件名约 100 个字符；它们也写进 architecture.json 的 modules，
  // 于是这一轮只有“同一个路径被几个模块认领”一处问题（没有 module_without_file 把续轮关掉）。
  const ids: string[] = [];
  for (let i = 0; i < 200; i += 1) {
    const id = `m${String(i).padStart(3, '0')}`;
    ids.push(id);
    world.edit(`.workbench/modules/${'k'.repeat(96)}${String(i).padStart(3, '0')}.json`,
      `${JSON.stringify({ ...copy, id }, null, 2)}\n`);
  }
  const architecturePath = '.workbench/architecture.json';
  const architecture = JSON.parse(world.read(architecturePath)?.toString('utf8') ?? '{}') as Record<string, unknown>;
  architecture['modules'] = [...(architecture['modules'] as string[]), ...ids].sort();
  world.edit(architecturePath, `${JSON.stringify(architecture, null, 2)}\n`);
  await world.idle();
  // 具名改坏：正文照旧拼全部路径、不截断 → 邮箱回 capacity，红在请求数（0 条）；不截断只发长文 → 红在字节数。
  // 今天红在这里：旧树发的是“请提修订”的信，既没有区域问句也没有“……”（且 201 个号只按第一个号发一封）。
  const requests = await actionRequests(world, adviser);
  expect(requests).toHaveLength(1);
  const body = await readRoute<{ text: string }>(world, 'messages/body', { messageRef: requests[0]?.ref, part: 'message' });
  expect([Buffer.byteLength(body.text, 'utf8') <= 16384,
    body.text.includes('Please act: explore only the region core'),
    body.text.includes('……'), body.text.includes('propose_architecture_revision')]).toEqual([true, true, true, true]);
  await world.idle();
  expect(await actionRequests(world, adviser)).toHaveLength(1);
}, 120_000);
