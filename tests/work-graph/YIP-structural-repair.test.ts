/**
 * 乙′-2 写测试方（决定 117）：结构性修补自动批准和“扣下”，验收行 Y12–Y16（开工裁定草稿 §3；契约 §3.1 修补、§3.5、
 * §3.7；lead 裁定 Q5 只改名也算、Q6(a) 扣下就是“没有自动采用结构修补”那条通知记录、每步确认的目标照旧出卡）。世界是
 * `S8C-repair-world.ts`（memory，足迹已知：不丢 RunActivity）；每行打开后先经公开设置路由存自己的档，修补暂存时定。
 * 激活由真实 Workflow 的 `complete_task` 一步触发（`workflow/advance`）；卡读 `decisions/queue`，请知悉读 `note_review`
 * 和 `project_notice`；手改模块文件直接写 `.workbench/modules/*.json`（同 KC1、Y5）。
 * 今天（`yip2t-base` = 乙′-1）：Y12、Y14、Y16 红（结构修补和改名照旧出卡，没有扣下通知）；Y13、Y15 是绿的护栏。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { StructuralApprovalV1 } from '../../src/contracts/architecture-proposal.js';
import type { CatalogRepairOpV1 } from '../../src/contracts/note.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { kls2cModuleFile } from '../helpers/KLS2C-knowledge-host.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS8CRepairWorld, plain, type S8CRepairWorld, type S8CStagedRepair } from '../helpers/S8C-repair-world.js';

const P = S6A_SCOPE.projectId;
const ASK: StructuralApprovalV1 = { proposals: 'ask', repairs: 'ask' };
/** Repairs auto, proposals ask: the repair rows follow `repairs` alone. */
const REPAIRS: StructuralApprovalV1 = { proposals: 'ask', repairs: 'auto' };
const worlds: S8CRepairWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

const save = async (w: S8CRepairWorld, value: StructuralApprovalV1) => expect(
  await w.world.settings('structural-approval/save', { projectId: P, value })).toMatchObject({ status: 'ready' });
async function repairWorld(label: string, value: StructuralApprovalV1): Promise<S8CRepairWorld> {
  const w = await openS8CRepairWorld({ label });
  worlds.push(w);
  await save(w, value);
  return w;
}
/** The real check PASS, then the Workflow's own `complete_task` step, which attempts the Goal's repairs. */
async function passAndComplete(w: S8CRepairWorld, staged: S8CStagedRepair): Promise<void> {
  const { next } = await w.pass(staged);
  expect(next).toMatchObject({ kind: 'perform', operation: { kind: 'complete_task' } });
  await w.world.post('workflow/advance', plain(S6A_SCOPE, next!));
}
const repairCardStates = async (w: S8CRepairWorld) => (await w.main.readCards(w.goal))
  .filter(card => card.source.kind === 'repair_approval').map(card => card.state);
const moduleRef = (moduleId: string) => ({ projectId: P, moduleId });
const addModule = (moduleId: string): CatalogRepairOpV1 => ({ op: 'add_module', module: { ref: moduleRef(moduleId),
  name: moduleId, responsibility: `own ${moduleId}`, paths: [`docs/${moduleId}`], interfaces: [] } });

// Y12（契约 §3.1 修补、§3.7；121-109）。今天红在第一句：结构修补照旧出卡，激活停在 approval_pending。乙′-2 落地后暂存时
// 读到 repairs 'auto' 记在注记头上，complete_task 直接激活、没有卡，激活那一版以 structural 进请知悉。
// 改坏“卡判定没用 repairCardLifted”就是今天的行为。
it('Y12 a structural repair staged under repairs auto is activated without a card and noticed as structural', async () => {
  const w = await repairWorld('yip12', REPAIRS);
  const before = await w.readCatalog();
  const staged = await w.writeRepair({ ops: [addModule('yip12')] });
  await passAndComplete(w, staged);
  expect(await repairCardStates(w)).toEqual([]);
  expect(await w.readCatalog()).toBe(before + 1);
  expect(await w.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'accepted' });
  expect((await w.main.readNotices({ categories: ['note_review'] })).notices).toContainEqual(
    expect.objectContaining({ noteClass: 'structural', summary: expect.stringMatching(/^注记 · 激活 · /) }));
}, 180_000);

// Y13（121-109“在暂存那一刻定”；62-6）。护栏行，今天绿：ask 下暂存的结构修补，之后存了 auto 也照旧出卡、不激活。
// 改坏：激活时或卡源现读开关 → 卡没了、注记被激活（今天的树上用“结构修补不出卡”代它打红，见回复）。
it('Y13 a repair staged under ask keeps its card after repairs is saved as auto', async () => {
  const w = await repairWorld('yip13', ASK);
  const staged = await w.writeRepair({ ops: [addModule('yip13')] });
  await save(w, REPAIRS);
  await passAndComplete(w, staged);
  expect(await repairCardStates(w)).toEqual(['waiting_answer']);
  expect(await w.readNote(staged.noteId)).toMatchObject({ version: 1, storedState: 'staged' });
}, 180_000);

// Y14（§3.4 保护、§3.5 修补没采用、§3.7 激活；lead Q6(a)）。今天红在通知（今天结构修补本来就出卡，没有保护也没有通知）。
// 落地后暂存时记成自动；激活时要改的 s6a-core 文件被人手改过：不激活，发“没有自动采用结构修补”（主体是注记的目标），
// 这条通知记录就是扣下，卡出不出取决于它在不在；人答“收下”照现有路径激活。改坏：激活时不做保护 → 卡没了、注记被激活；
// 卡源不读扣下 → 没卡，一直等。
it('Y14 a hand-edited module file holds the automatic repair: one notice, the card, the person\'s approval activates', async () => {
  const w = await repairWorld('yip14', REPAIRS);
  const before = await w.readCatalog();
  const staged = await w.writeRepair({ ops: [addModule('yip14'),
    { op: 'add_dependency', from: moduleRef('s6a-core'), to: moduleRef('yip14'), reason: 'YIP-14' }] });
  const path = kls2cModuleFile(w.world, 's6a-core');
  const file = JSON.parse(readFileSync(join(w.world.root, path), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(w.world.root, path), `${JSON.stringify({ ...file, responsibility: 'YIP-14 by a person' }, null, 2)}\n`);
  await passAndComplete(w, staged);
  expect(await repairCardStates(w)).toEqual(['waiting_answer']);
  expect((await w.main.readNotices({ goal: w.goal, categories: ['project_notice'] })).notices
    .map(notice => notice.summary).filter(summary => summary.startsWith('没有自动采用结构修补：')))
    .toEqual([`没有自动采用结构修补：会盖掉不是平台写的文件 ${path}；卡留着等你决定`]);
  await w.answerRepairCard(await w.readRepairCard(), 'approve', 'yip14-approve');
  expect(await w.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'accepted' });
  expect(await w.readCatalog()).toBe(before + 1);
}, 180_000);

// Y15（PRODUCT §7 :509、:505；lead：每步确认的目标里修补照旧出卡）。护栏行，今天绿。
// 改坏：自动时连每步确认那一项也一起去掉 → 没卡、注记被激活。
it('Y15 under an every_step Goal a structural repair keeps its card although repairs is auto', async () => {
  const w = await repairWorld('yip15', REPAIRS);
  const { goal } = readyValue<{ goal: { revision: number } }>(await w.main.route('goals/settings', { goalRef: w.goal }),
    'goals/settings');
  expect(await w.main.post('goals/settings/set', graphWrite(S6A_SCOPE, { goalRef: w.goal, autonomy: 'every_step',
    waitForGoalRef: null }, 'yip15-every-step', [{ ref: w.goal, revision: goal.revision }])))
    .toMatchObject({ status: 'committed' });
  const staged = await w.writeRepair({ ops: [addModule('yip15')] });
  await passAndComplete(w, staged);
  expect(await repairCardStates(w)).toEqual(['waiting_answer']);
  expect(await w.readNote(staged.noteId)).toMatchObject({ version: 1, storedState: 'staged' });
}, 180_000);

// Y16（lead Q5：只改名的修补也算结构修补）。今天红在第一句：改名照旧出卡。落地后 repairs 'auto' 下只改名的修补暂存时
// 也记成自动，complete_task 直接激活、没有卡。改坏“改名那一项没有跟着开关放开”就是今天的行为。
it('Y16 (Q5) a rename-only repair under repairs auto is activated without a card', async () => {
  const w = await repairWorld('yip16', REPAIRS);
  const before = await w.readCatalog();
  const staged = await w.writeRepair({ ops: [{ op: 'set_module_name', moduleId: 's6a-core', name: 'YIP-16 core' }] });
  await passAndComplete(w, staged);
  expect(await repairCardStates(w)).toEqual([]);
  expect(await w.readCatalog()).toBe(before + 1);
  expect(await w.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'accepted' });
}, 180_000);
