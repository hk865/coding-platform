/**
 * KC-3 what the repair round's batch does (121-106 ② ③ ⑤; user kc-user-decisions-1112 :4, :9; lead next1113c KC-3 Q4 and
 * 乙′'s protection; draft §2.2–§2.6, §3 K1 ②③, K3–K5), on `openKC3World` (KLS2C-knowledge-host.ts). Today (`kc3t-base`)
 * every row but K5 is red at the card wait (a duplicate id or a bad file opens no round, knowledge/ops.ts:148-149); K5 at
 * the rows (no `willRevert`; on the current base the person's edit is no change, so `other`'s file is not listed). After
 * KC-3 they are green by draft §2: the round's trial, freeze and approval read the recorded base, the conflict batch's
 * writer has `replace`, the files carry `willRevert`, and `autoApprovalBlockOf` still holds a write over the person's file.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  armedSeam, kls2cAnswer, kls2cBatchFiles, kls2cConflict, kls2cEditModule, kls2cModuleFile, kls2cNoticesAtLeast, kls2cPin,
  kls2cProposal, kls2cProposalCard, kls2cRecover, kls2cRecoveryItems, kls2cReviseResponsibility, KLS2C_SCOPE, openKC3World,
  type KLS2CHost,
} from '../helpers/KLS2C-knowledge-host.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';

const worlds: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0).reverse()) await world.close();
  await cleanupRestart();
});

const SET_CORE = [{ op: 'set_responsibility', moduleId: 'core', text: 'KC3 修好' }];
const NOT_JSON = '{ "id": "core", not json';

/** The world with its repair round's one script queued: the proposal on the pin read before any file broke. */
async function scriptedWorld(...args: Parameters<typeof openKC3World>): ReturnType<typeof openKC3World> {
  const opened = await openKC3World(...args);
  worlds.push(opened.world);
  opened.world.script(kls2cProposal('kc3-repair', opened.pin, SET_CORE, '整张写回'));
  return opened;
}

/** The module ids the module files on disk write, sorted; a file that is not JSON is `?`. */
const idsOnDisk = (world: KLS2CHost): string[] => readdirSync(join(world.root, '.workbench/modules')).map(name => {
  try { return (JSON.parse(readFileSync(join(world.root, '.workbench/modules', name), 'utf8')) as { id: string }).id; }
  catch { return '?'; }
}).sort();

// K1 ②③、Q4：卡上多出的那份、记录里没有的坏文件是 delete、willRevert false；K3：记录里有这个模块的坏文件按记录改回（lead 11-13
// 收下施工方的写者偏离：坏文件的名字给记录里缺文件的模块，剩下的才删），是 modify、willRevert true（改前不是平台写的）。批准后
// 整张写回：盘上每个号一个能解的文件，版本加 1。具名改坏：批准不传 replace（writeModule 照旧拒）或不传 recorded（闸门拒）→
// 盘上还是坏的、版本读不出，红在最后一句；坏文件留着不删（Q4 取乙）→ 卡上少这一行；试算不认 base → 没有卡，红在等卡。
it.each([
  ['K1 a duplicate module id', (w: KLS2CHost) => {
    kls2cConflict(w, 'same_id');
    return { moduleId: 'core', action: 'delete', willRevert: false };
  }],
  ['K3 a module file that is not JSON', (w: KLS2CHost) => {
    const path = kls2cModuleFile(w, 'core');
    w.edit(path, NOT_JSON);
    return { path, moduleId: 'core', action: 'modify', source: 'uncommitted', willRevert: true };
  }],
  ['Q4 a bad file the record does not know', (w: KLS2CHost) => {
    w.edit('.workbench/modules/kc3-q4.json', 'not json');
    return { path: '.workbench/modules/kc3-q4.json', action: 'delete', source: 'uncommitted', willRevert: false };
  }],
] as const)('%s: the card deletes it (or reverts it when the record has its module) and approving the card writes the '
  + 'whole architecture back', async (_, breakFiles) => {
  const { world, pin } = await scriptedWorld();
  const deleted = breakFiles(world);
  const card = await kls2cProposalCard(world);
  expect(await kls2cBatchFiles(world, card)).toContainEqual(expect.objectContaining(deleted));
  expect(await kls2cAnswer(world, card, 'approve', '', 'kc3-repair-approve')).toMatchObject({ status: 'ready' });
  await world.idle();
  expect([idsOnDisk(world), (await kls2cPin(world)).catalogRef.revision]).toEqual([['core', 'other'], pin.catalogRef.revision + 1]);
}, 180_000);

// K4（用户 :4“以上次采用的架构作底”）：记录已采用到第 2 版，再弄出重号；修复轮在第 2 版的 pin 上提，批冻在这个 pin 上。
// 具名改坏：试算的 exactKeys 不认 base（工具 invalid）或规划器仍读当前窗口（unavailable）→ 没有卡，红在等卡。
it('K4 the repair round proposes on the last adopted revision and its batch is frozen on that pin', async () => {
  const { world, pin: first } = await openKC3World();
  worlds.push(world);
  await kls2cReviseResponsibility(world, 'other', 'own other v2', 'kc3-k4-revise');
  const adopted = await kls2cPin(world);
  world.script(kls2cProposal('kc3-k4', adopted, SET_CORE, '删一份'));
  kls2cConflict(world, 'same_id');
  const [batch, member] = (await kls2cProposalCard(world)).objects.map(object => (object as { pin: { ref: unknown } }).pin.ref);
  const read = readyValue<{ proposal: { baseCatalogPin: unknown }; batchRef: unknown }>(await world.call(
    'architecture/proposals/read', plain(world.scope, { proposalRef: member })), 'architecture/proposals/read');
  expect([adopted.catalogRef.revision, read.proposal.baseCatalogPin, read.batchRef])
    .toEqual([first.catalogRef.revision + 1, adopted, batch]);
}, 180_000);

// K5（草稿 §2.6；用户 :9 问 3 甲）：每行带 willRevert，只有“底是记录、modify、改前不是平台写的”为 true。双认领：整张写回把人改的
// other 改回（true），core 是平台写的（false）。具名改坏：willRevert 只看 action === 'modify' → core 那行 true，红在这里。
it('K5 the card marks the person\'s file the approval would revert, and not the platform\'s', async () => {
  const { world } = await scriptedWorld();
  const [core, other] = kls2cConflict(world, 'same_path');
  const row = (path: string, moduleId: string, source: string, willRevert: boolean) =>
    ({ workspaceId: KLS2C_SCOPE.workspaceId, path, moduleId, action: 'modify', source, willRevert });
  expect(await kls2cBatchFiles(world, await kls2cProposalCard(world))).toEqual([row(core, 'core', 'platform', false),
    row(other, 'other', 'uncommitted', true)].sort((left, right) => (left.path < right.path ? -1 : 1)));
}, 180_000);

// 乙′ 的保护照旧（lead next1113c KC-3 另加一条；乙′ 契约 §3.4、:91）：两个开关都存“自动”，人手改坏的 core 文件会被这张修复批
// 按记录改回——不自动采用，卡留着、卡上列这个 modify（willRevert true），发一条“没有自动采用结构提案”（lead 11-13 第 2 条：
// 修复批是结构提案批，归 proposals 开关，请知悉照契约 :91），人的文件原样。具名改坏：冲突批跳过 autoApprovalBlockOf（或写者放开
// 先于保护）→ 没有卡、坏文件被改掉，红在等卡和最后一句。
it('乙′ under the automatic switches a repair that reverts the person\'s bad file waits for the person', async () => {
  const { world } = await scriptedWorld({ proposals: 'auto', repairs: 'auto' });
  const path = kls2cModuleFile(world, 'core');
  world.edit(path, NOT_JSON);
  const card = await kls2cProposalCard(world);
  expect(await kls2cBatchFiles(world, card)).toContainEqual(expect.objectContaining(
    { path, moduleId: 'core', action: 'modify', source: 'uncommitted', willRevert: true }));
  // The notice goes out after the freeze commit that shows the card (乙′ §3.2), so it is read within a few heartbeats.
  let declined: string[] = [];
  for (let round = 0; round < 10 && declined.length === 0; round += 1) {
    if (round > 0) await world.idle();
    declined = (await world.notices()).map(notice => notice.summary).filter(summary => summary.startsWith('没有自动采用'));
  }
  expect(declined).toEqual([`没有自动采用结构提案：会盖掉不是平台写的文件 ${path}；卡留着等你决定`]);
  expect(world.read(path)?.toString('utf8')).toBe(NOT_JSON);
}, 180_000);

/** The structural cards waiting now (`decisions/queue`). */
const structuralCards = async (world: KLS2CHost): Promise<unknown[]> => readyValue<{ waitingAnswer: { source: { kind: string } }[] }>(
  await world.call('decisions/queue', plain(world.scope, { workspace: world.scope, sections: ['waiting_answer'],
    page: { limit: 100 } })), 'decisions/queue').waitingAnswer.filter(card => card.source.kind === 'structural_proposal');

// Astra 1（lead 收）：重号修复批准时记录已提交、删多余文件之前停下（写日志 pending，下一轮对账出“没确认落盘”）；“恢复”逐项
// 补写，多余那份被删掉，保留的模块照读。具名改坏：恢复按模块号从事件重建一个删除 → 重建出保留模块的内容，不是 null，回
// unavailable，红在恢复那句。
it('A1 a duplicate-id repair stopped after its records: 恢复 deletes the extra file and the kept module reads', async () => {
  const seam = armedSeam('committed');
  const { world, pin } = await openKC3World(undefined, undefined, seam.seam);
  worlds.push(world);
  world.script(kls2cProposal('kc3-a1', pin, SET_CORE, '整张写回'));
  kls2cConflict(world, 'same_id');
  const card = await kls2cProposalCard(world);
  const extra = (await kls2cBatchFiles(world, card) as { path: string; action: string }[])
    .find(file => file.action === 'delete')!.path;
  seam.fail();
  await kls2cAnswer(world, card, 'approve', '', 'kc3-a1-approve');
  expect(world.read(extra)).not.toBeNull();
  const [notice] = await kls2cNoticesAtLeast(world, 'knowledge_write_unconfirmed', 1);
  const items = (await kls2cRecoveryItems(world, notice!.noticeId)).value?.items ?? [];
  expect(items.map(item => [item.kind, item.path])).toContainEqual(['write_unconfirmed', extra]);
  for (const item of items) {
    expect(await kls2cRecover(world, notice!.noticeId, item.itemNo)).toMatchObject({ status: 'committed' });
  }
  await world.idle();
  expect([world.read(extra), idsOnDisk(world), (await kls2cPin(world)).catalogRef.revision])
    .toEqual([null, ['core', 'other'], pin.catalogRef.revision + 1]);
}, 180_000);

// Astra 备注 3（lead 升为必须改；用户问 3 甲“卡上列会改回、会删的文件”：人批的是卡上列的那些）：卡出来以后人又手改了那个坏
// 文件，批准时这次计划改的文件已经不是卡上那份——按 source_stale 关掉这张卡，一个文件都不写。具名改坏：批准不比冻结时的清单
// 摘要 → 照写，人的新内容被盖掉，红在文件那句。
it('A3 a hand edit after the card: approving it closes the card stale and writes no file', async () => {
  const { world } = await scriptedWorld();
  const path = kls2cModuleFile(world, 'core');
  world.edit(path, NOT_JSON);
  const card = await kls2cProposalCard(world);
  const edited = '{ "id": "core", still not json';
  world.edit(path, edited);
  expect(await kls2cAnswer(world, card, 'approve', '', 'kc3-a3-approve')).toMatchObject({ status: 'ready' });
  const member = (card.objects[1] as { pin: { ref: unknown } }).pin.ref;
  const read = readyValue<{ proposal: { state: string } }>(await world.call('architecture/proposals/read',
    plain(world.scope, { proposalRef: member })), 'architecture/proposals/read');
  expect([world.read(path)?.toString('utf8'), read.proposal.state, (await structuralCards(world)).length])
    .toEqual([edited, 'stale', 0]);
}, 180_000);

// Astra 备注 4（lead 收）：悬空也走到底——core 的 dependsOn 指向不存在的 ghost，修复轮出卡，卡上 core 是会改回的 modify，批准后
// core 按记录整张写回（没有那条引用），架构读得出、版本加 1。具名改坏：写者不给修复批 replace 或批准不以记录作底 → 批不了，
// 红在最后一句。
it('N4 a dangling reference: the repair card approved writes core back without it and the architecture reads', async () => {
  const { world, pin } = await scriptedWorld();
  const core = kls2cModuleFile(world, 'core');
  kls2cEditModule(world, core, { dependsOn: [{ to: 'ghost', reason: 'k' }] });
  const card = await kls2cProposalCard(world);
  expect(await kls2cBatchFiles(world, card)).toContainEqual(expect.objectContaining(
    { path: core, moduleId: 'core', action: 'modify', willRevert: true }));
  expect(await kls2cAnswer(world, card, 'approve', '', 'kc3-n4-approve')).toMatchObject({ status: 'ready' });
  await world.idle();
  expect([(JSON.parse(world.read(core)!.toString('utf8')) as { dependsOn: unknown[] }).dependsOn,
    (await kls2cPin(world)).catalogRef.revision]).toEqual([[], pin.catalogRef.revision + 1]);
}, 180_000);
