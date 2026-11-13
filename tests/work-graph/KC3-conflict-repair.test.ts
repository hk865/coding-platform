/**
 * KC-3 who gets the repair round (121-106 ②; user kc-user-decisions-1112 :8; lead next1113c KC-3 Q1, Q2; draft §3 K1 ①,
 * K2, K7), on `openKC3World` (KLS2C-knowledge-host.ts; files broken as a person would). Today (`kc3t-base`) the K1, K2
 * and Q1 entries are red at the follow-up read (knowledge/ops.ts:148-149 opens a round only for a path-only conflict
 * with no issue) and K7 at the re-proposed follow-up's text (exploration-control.ts:197-204 keeps only the person's
 * reason); the Q2 entries are green guards. After KC-3 they are green by draft §2.2, §2.7 and Q1/Q2.
 */
import { afterEach, expect, it } from 'vitest';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';
import {
  kls2cAnswer, kls2cConflict, kls2cEditModule, kls2cFollowUps, kls2cModuleFile, kls2cProposal, kls2cProposalCard,
  openKC3World, type KLS2CHost,
} from '../helpers/KLS2C-knowledge-host.js';

const worlds: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0).reverse()) await world.close();
  await cleanupRestart();
});

/** A person rewrites `architecture.json` with `modules` as its roots. */
function roots(world: KLS2CHost, modules: string[]): void {
  const path = '.workbench/architecture.json';
  world.edit(path, `${JSON.stringify({ ...JSON.parse(world.read(path)!.toString('utf8')) as object, modules }, null, 2)}\n`);
}

// 区域参谋在 core 和 other 上各一位。每格先等这一趟对账的通知（续轮在同一趟写下），再读续轮的区域和文字。具名改坏：K1/K2——ops
// 照旧只为双认领开轮（今天的树）→ 续轮 []；K2——按 moduleIds[1]（ghost，没有参谋）找 → 续轮 []；Q1a——坏文件按它在记录里的
// 模块找 → 区域 other；Q1b——坏文件不跟重号走、取最小号 → 区域 core、other；Q2——这一种也开轮 → 多一个续轮（每格点名的模块都有参谋）。
it.each([
  ['K1 a duplicate module id: its module\'s region', (w: KLS2CHost) => { kls2cConflict(w, 'same_id'); },
    ['core'], '2 个模块文件都写了模块号 core：一个模块号只能有一个文件，删掉或改掉多余的'],
  ['K2 a dangling reference: the referring module\'s region', (w: KLS2CHost) => {
    kls2cEditModule(w, kls2cModuleFile(w, 'core'), { dependsOn: [{ to: 'ghost', reason: 'k' }] });
  }, ['core'], '模块 core 引用了不存在的模块 ghost：改 core 的 contains 或 dependsOn，或补上 ghost 的模块文件'],
  ['Q1 a bad file alone: the region of the smallest module id in the record', (w: KLS2CHost) => {
    w.edit(kls2cModuleFile(w, 'other'), '{ "id": "other", not json');
  }, ['core'], '文件读不出：'],
  ['Q1 a bad file beside a duplicate id: the duplicate\'s module', (w: KLS2CHost) => {
    kls2cEditModule(w, kls2cModuleFile(w, 'core'), { id: 'other' });
    w.edit('.workbench/modules/kc3-q1.json', 'not json');
  }, ['other'], '2 个模块文件都写了模块号 other'],
  ['Q2 module_without_file only notifies', (w: KLS2CHost) => { w.remove(kls2cModuleFile(w, 'other')); }, null, ''],
  ['Q2 unreachable only notifies', (w: KLS2CHost) => { roots(w, ['core']); }, null, ''],
  ['Q2 partial_contains only notifies', (w: KLS2CHost) => {
    kls2cEditModule(w, kls2cModuleFile(w, 'core'), { contains: [] });
  }, null, ''],
  ['Q2 cycle only notifies', (w: KLS2CHost) => {
    const [core, other] = [kls2cModuleFile(w, 'core'), kls2cModuleFile(w, 'other')];
    kls2cEditModule(w, core, { dependsOn: [{ to: 'other', reason: 'k' }] });
    kls2cEditModule(w, other, { dependsOn: [{ to: 'core', reason: 'k' }] });
  }, null, ''],
] as const)('%s', async (_, breakFiles, region, text) => {
  const { world } = await openKC3World(undefined, ['core', 'other']);
  worlds.push(world);
  breakFiles(world);
  await world.idle();
  expect(await world.notices('knowledge_conflict')).toHaveLength(1);
  expect((await kls2cFollowUps(world)).map(follow => [follow.kind, follow.moduleRefs.map(ref => ref.moduleId),
    follow.reason?.includes(text)])).toEqual(region === null ? [] : [['knowledge_conflict', region, true]]);
}, 120_000);

// K7（草稿 §2.7）：冲突批答“不对，重新提”，新 repropose 续轮的文字同时有原冲突那一处和人的理由。用只有双认领的冲突造卡（今天
// 就开轮出卡），今天红在最后一句：exploration-control.ts:197-204 只存人的理由；具名改坏就是今天的树。
it('K7 "不对，重新提" on a conflict card: the new round carries the conflict place and the person\'s reason', async () => {
  const { world, pin } = await openKC3World();
  worlds.push(world);
  world.script(kls2cProposal('kc3-k7', pin, [{ op: 'set_responsibility', moduleId: 'core', text: 'KC3 K7' }], 'K7'));
  kls2cConflict(world, 'same_path');
  const card = await kls2cProposalCard(world);
  expect(await kls2cAnswer(world, card, 'repropose', '换个修法', 'kc3-k7-repropose')).toMatchObject({ status: 'ready' });
  const again = (await kls2cFollowUps(world)).find(follow => follow.kind === 'repropose');
  expect([again?.reason?.includes('模块 core、other 都认领了 src/core'), again?.reason?.includes('换个修法')])
    .toEqual([true, true]);
}, 180_000);

type KC3Session = { projectId: string; sessionId: string };
/** The lines the exploration rounds of `role-lines/operations` ran on, in round order. */
async function roundLines(world: KLS2CHost): Promise<string[]> {
  return readyValue<{ action: string; explorations?: { sessionRef: KC3Session }[] }[]>(await world.call(
    'role-lines/operations', plain(world.scope, { workspace: world.scope })), 'role-lines/operations')
    .flatMap(row => (row.explorations ?? []).map(entry => entry.sessionRef.sessionId));
}

// Astra 2（lead 收）：修复卡出来以后，人把原来那位参谋的线归档；再答“不对，重新提”，新一轮找不到原区域线，开一条新的参谋线——
// 这条线登记时也以记录作底核它的模块（坏文件还在），于是第二轮真的跑起来、出第二张卡。具名改坏：开区域线不带 base（建线照读
// 当前文件，被闸门拒）→ 新线建不成，没有第二张卡，红在等卡。
it('A2 the adviser line archived after the card: "不对，重新提" opens a new adviser line on the record and a second card',
  async () => {
    const { world, pin } = await openKC3World();
    worlds.push(world);
    const ops = [{ op: 'set_responsibility', moduleId: 'core', text: 'KC3 A2' }];
    world.script(kls2cProposal('kc3-a2', pin, ops, 'A2'));
    kls2cConflict(world, 'same_id');
    const card = await kls2cProposalCard(world);
    const [adviser] = await roundLines(world);
    const session = { projectId: world.scope.projectId, sessionId: adviser! };
    const read = readyValue<{ record: { ref: unknown; revision: number } }>(await world.call('sessions/read',
      plain(world.scope, session)), 'sessions/read');
    expect(await world.call('sessions/archive', graphWrite(world.scope, { sessionRef: session, reason: 'KC3 A2' },
      'kc3-a2-archive', [{ ref: read.record.ref, revision: read.record.revision }]))).toMatchObject({ status: 'committed' });
    world.script(kls2cProposal('kc3-a2b', pin, ops, 'A2 again'));
    expect(await kls2cAnswer(world, card, 'repropose', '换个修法', 'kc3-a2-repropose')).toMatchObject({ status: 'ready' });
    const second = await kls2cProposalCard(world);
    const lines = await roundLines(world);
    expect([second.cardKey === card.cardKey, lines.length, lines.at(-1) === adviser]).toEqual([false, 2, false]);
  }, 240_000);
