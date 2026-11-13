/**
 * 乙′-1 写测试方（决定 117）：结构提案自动批准，验收行 Y1–Y9、#1、#9、#11（开工裁定草稿 §3；lead 裁定 Q2(a) `:48`、
 * Q3、Q7）。除 #1、#9 外每行先经公开设置路由 `structural-approval/save` 存好自己的档（null = 出厂默认）。世界：Y1
 * `openS6AHostWorld`；Y2、Y8、Y9 `S7D2-coldstart-world.ts`；Y3–Y7 与 #9 `S8C-proposal-world.ts`；#1 用它的提案世界
 * （含开窗口的生命周期冻结）和 S6B 注记世界，两边都由委托包装去掉 `structuralApproval` 并把 Host 设置存回 auto。
 * #9 用 S8C 的 `freezeAttempt`（`freezePending` 调用的同一 owner 冻结入口，pin 由 `revise` 推走）。只跑 memory，
 * Y3 有回执重放，两个后端（S3）。请知悉经 `decisions/queue` 的 `project_notice` 读；手改文件直接写
 * `.workbench/modules/*.json`（同 KC1）。
 */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostSettingsSnapshot, SettingsResponse } from '../../src/app/host-settings-types.js';
import type { ArchitectureCatalogPinV1 } from '../../src/contracts/architecture-catalog.js';
import type { ProposalResult, StructuralApprovalV1 } from '../../src/contracts/architecture-proposal.js';
import type { NoteVersionSnapshot } from '../../src/contracts/note.js';
import { settingsPost } from '../app/support/S8A-L8-host.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { kls2cModuleFile } from '../helpers/KLS2C-knowledge-host.js';
import type { S6ACardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from '../helpers/S6A-host-fixture.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { openS6BProjectWorld, scribeUnderstanding } from '../helpers/S6B1-fixture.js';
import { dexcCommand, dexcNextCard, dexcProposal, openS7D2ColdStartWorld, type S7D2ColdStartWorld }
  from '../helpers/S7D2-coldstart-world.js';
import { openProposalWorld, type ProposalWorld } from '../helpers/S8C-proposal-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const P = S6A_SCOPE.projectId;
const AUTO = { proposals: 'auto', repairs: 'auto' } as const;
const ASK = { proposals: 'ask', repairs: 'ask' } as const;
const APPLIED = '已自动采用结构提案（设置：结构提案自动批准）：';
const worlds: { close(): Promise<void> }[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});
const kept = <W extends { close(): Promise<void> }>(world: W): W => { worlds.push(world); return world; };

type Host = { base: string; token: string };
const saveBody = async (host: Host, projectId: string, value: unknown) => await (await settingsPost(host.base,
  'structural-approval/save', host.token, { projectId, value })).json() as SettingsResponse<HostSettingsSnapshot>;
async function save(host: Host, value: StructuralApprovalV1 | null): Promise<HostSettingsSnapshot> {
  const answer = await saveBody(host, P, value);
  if (answer.status !== 'ready') throw new Error(`structural-approval/save: ${JSON.stringify(answer)}`);
  return answer.value;
}
const approvalOf = async (world: S6AHostWorld) =>
  readyValue<HostSettingsSnapshot>(await world.settings('snapshot', {}), 'snapshot').structuralApproval;
const summaries = async (ws: S6ACardsWorkspace): Promise<string[]> =>
  (await ws.readNotices({ categories: ['project_notice'] })).notices.map(notice => notice.summary);
const responsibility = (moduleId: string, text: string) => ({ op: 'set_responsibility', moduleId, text });
const addModule = (moduleId: string, path: string) => ({ op: 'add_module', module: { ref: { projectId: P, moduleId },
  name: moduleId, responsibility: `own ${moduleId}`, paths: [path], interfaces: [] } });

// Y1（契约 §2.3；121-109“默认是自动批准”）。今天红在第一句。改坏：默认写成 ask → 第一句；存 null 不删 → 最后一句。
it('Y1 the snapshot shows the factory default; a save is kept per project; null goes back to it', async () => {
  const world = kept(await openS6AHostWorld({ backend: 'memory' }));
  expect(await approvalOf(world)).toEqual({ saved: {}, defaults: AUTO });
  const asked = { proposals: 'ask', repairs: 'auto' } as const;
  expect((await save(world, asked)).structuralApproval.saved).toEqual({ [P]: asked });
  expect((await save(world, null)).structuralApproval.saved).toEqual({});
}, 120_000);

// Y1r（A6；守产品规则：两个开关各只有 auto、ask（121-109），设置属于“这个项目”（开工裁定 §5））。今天红在之后的快照。
// 改坏：去掉 `structuralApprovalOf` 校验 → (a)(b) 回 ready；去掉“项目开着”的检查 → (c) 回 ready。
describe('rejects: structural-approval/save', () => {
  it.each([
    ['(a) a mode that is neither auto nor ask', P, { proposals: 'yes', repairs: 'auto' }, 'invalid'],
    ['(b) a value without repairs', P, { proposals: 'auto' }, 'invalid'],
    ['(c) a project not open on this Host', 'yip-not-open', ASK, 'not_found'],
  ] as const)('Y1r %s', async (_case, projectId, value, code) => {
    const world = kept(await openS6AHostWorld({ backend: 'memory' }));
    expect(await saveBody(world, projectId, value)).toMatchObject({ status: 'rejected', code });
    expect(await approvalOf(world)).toEqual({ saved: {}, defaults: AUTO });
  }, 120_000);
});

/** The cold start walked to `completed` under `ask`, then `value` saved; the free `src` region line and the pin. */
async function walkedThenSaved(value: StructuralApprovalV1 | null) {
  const cold = kept(await openS7D2ColdStartWorld({ backend: 'memory' }));
  await save(cold.host, ASK);
  await cold.initialize();
  const { final } = await cold.walkToCompleted();
  const entry = (final.explorations ?? []).find(candidate => candidate.queryRunRef.runId.endsWith(':src'))!;
  const src = await cold.lineOf(entry.sessionRef, 'yip-src');
  await cold.waitFor('the src line free', async () => (await cold.host.readSession(src.ref)).record.occupancy === null);
  await save(cold.host, value);
  return { cold, src, pin: await cold.pin() };
}
/** `deepen` of `src` with its round scripted; waits (bounded) for the 已自动采用 notices. */
async function deepened(cold: S7D2ColdStartWorld, src: S6ASession, replies: S6AReply[], id: string): Promise<string[]> {
  await cold.host.scripted.script(src, replies);
  expect((await dexcCommand(cold.host, 'deepen', id, { module: { projectId: P, moduleId: 'src' } })).result)
    .toMatchObject({ status: 'committed' });
  let applied: string[] = [];
  await cold.waitFor('the 已自动采用 notice', async () =>
    (applied = (await summaries(cold.main)).filter(summary => summary.startsWith(APPLIED))).length > 0);
  return applied;
}

// Y2（§3.1 生命周期冻结、§3.2、§3.5 已采用）。今天红在第一次存设置；落地后续轮的批冻结时读到“自动”，同一趟采用、
// 提交后发通知、不出卡。Astra 审后 3：冻结提交停在真实的提交闸门上时把开关存回 ask，放行后这一批仍照冻结前读到的
// “自动”采用。改坏：`freezeProposals` 不调自动采用，或冻结提交之后才读开关（读到 ask）→ 等不到通知。
it('Y2 a deepen round\'s batch is applied as it freezes: no card, pin +1, one notice, the new file', async () => {
  const { cold, src, pin } = await walkedThenSaved(null);
  const freeze = commitBarrier.hold(byIdentityPrefix('architecture-proposal-freeze:'), 'Y2 freeze commit');
  const applying = deepened(cold, src, dexcProposal('yip2', pin, [responsibility('src', 'YIP-2 src')], 'YIP-2'), 'yip2');
  await freeze.reached;
  await save(cold.host, ASK);
  freeze.release();
  const applied = await applying;
  expect(applied).toHaveLength(1);
  expect(applied[0]).toContain('；模块 src');
  expect(await cold.proposalCards()).toEqual([]);
  expect((await cold.pin()).catalogRef.revision).toBe(pin.catalogRef.revision + 1);
  expect(JSON.parse(readFileSync(join(cold.host.root, kls2cModuleFile(cold.host, 'src')), 'utf8')))
    .toMatchObject({ responsibility: 'YIP-2 src' });
}, 300_000);

// #11（next1113b 裁定 Q3：采用提交之后再发“已自动采用”；契约 §3.5）。护栏行。按住的是自动采用自己的提交时，
// 通知一条也读不到；放行后正好一条。改坏：把通知挪到 `finishCatalogRevision` 之前并删掉提交后那条 → 按住时就能读到。
it('#11 the 已自动采用 notice appears only after the auto-adoption commit lands', async () => {
  const { cold, src, pin } = await walkedThenSaved(null);
  const apply = commitBarrier.hold(byIdentityPrefix('architecture-proposal-auto-apply:'), '#11 auto-apply commit');
  const applying = deepened(cold, src, dexcProposal('yip11', pin, [responsibility('src', 'YIP-11 src')], 'YIP-11'),
    'yip11');
  try {
    await apply.reached;
    expect((await summaries(cold.main)).filter(summary => summary.startsWith(APPLIED))).toEqual([]);
  } finally {
    apply.release();
  }
  const applied = await applying;
  expect(applied).toHaveLength(1);
  expect((await summaries(cold.main)).filter(summary => summary.startsWith(APPLIED))).toHaveLength(1);
}, 300_000);

// Y8（§3.1 粗切分照旧出卡；4-18，PRODUCT :510）。护栏行。粗切分立即冻结时 segment 是 `coarse_split`，提案照旧
// 待人：人答之前 pin 不动、不自动采用；人答“采用”之后 pin 才 +1。改坏：去掉 `segment !== 'coarse_split'` →
// 粗切分的提案被自动采用，pin 在人答之前就 +1（卡片可能还来自别的提案，所以看 pin 而不是等不到卡）。
it('Y8 under the factory default the coarse split still asks the person, and approving it applies', async () => {
  const cold = kept(await openS7D2ColdStartWorld({ backend: 'memory' }));
  await save(cold.host, null);
  await cold.initialize();
  const before = await cold.pin();
  await cold.advanceTo('coarse_split');
  await cold.waitFor('the coarse proposal tool result', async () => (await cold.host.scripted.requests(cold.lines.adviser))
    .some(request => request.messages.some(message => message.role === 'tool'
      && message.callId === 'c1t-coarse-split')));
  expect((await cold.pin()).catalogRef.revision).toBe(before.catalogRef.revision);
  const card = await dexcNextCard(cold);
  const pin = await cold.pin();
  await cold.approve(card, 'yip8-approve');
  expect((await cold.pin()).catalogRef.revision).toBe(pin.catalogRef.revision + 1);
}, 300_000);

// Y9（§3.2 多批，4-20）。今天红在第一次存设置；落地后同一新模块号、内容不同的两份冻结成两批，按批号采用第一批就停，
// 另一批的卡留着。改坏：少了“另有 N 份” → 红在通知；后面的批被关成 stale → 红在卡。
it('Y9 two incompatible proposals of one round: one is applied, the other\'s card waits, the notice counts it', async () => {
  const { cold, src, pin } = await walkedThenSaved(null);
  const call = (id: string) => ({ callId: `yip9-${id}`, name: 'propose_architecture_revision', args: {
    baseCatalogPin: pin, ops: [addModule('yip9', `src/yip9${id}`)], responsibilityMoves: [], reason: `YIP-9 ${id}` } });
  const applied = await deepened(cold, src, [{ kind: 'calls', calls: [call('a'), call('b')] },
    { kind: 'text', text: 'YIP-9' }], 'yip9');
  expect(applied).toHaveLength(1);
  expect(applied[0]!.endsWith('；另有 1 份提案留在卡上')).toBe(true);
  expect((await cold.pin()).catalogRef.revision).toBe(pin.catalogRef.revision + 1);
  expect((await cold.proposalCards()).map(card => card.state)).toEqual(['waiting_answer']);
}, 300_000);

async function proposalWorld(value: StructuralApprovalV1 | null, backend: 'memory' | 'sqlite' = 'memory') {
  const world = kept(await openProposalWorld({ backend }));
  await save(world.staff.world, value);
  return world;
}
/** One adviser Work Run with one `propose_architecture_revision` call; the tool's result. */
const propose = async (world: ProposalWorld, pin: ArchitectureCatalogPinV1, op: Record<string, unknown>, reason: string):
Promise<ProposalResult> => (await world.proposeWithStatus([{ baseCatalogPin: pin, ops: [op], reason }]))[0]!.result;
const corePath = async (world: ProposalWorld): Promise<string> =>
  (await world.readCatalog()).modules.find(module => module.ref.moduleId === 's6a-core')!.paths[0]!;

/**
 * Q2（lead 11-13）的公开选项路径：`createTargetPlatform` 的 `structuralApproval` 缺席 = 从不自动批准
 * （`create-platform.ts:485-490`）。Host 总会注入这一项，白名单内只有这个委托包装能去掉它：包装调用真实工厂，只删
 * `structuralApproval`、其余选项原样；每格打开世界后再把 Host 设置存回 auto，所以“待人”只能来自选项缺席。
 */
const structuralApprovalOmitted = vi.hoisted(() => ({ value: false }));
vi.mock('../../src/composition/create-platform.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/composition/create-platform.js')>();
  return { ...actual, openTargetPlatform: async (options: Parameters<typeof actual.openTargetPlatform>[0]) => {
    if (!structuralApprovalOmitted.value) return await actual.openTargetPlatform(options);
    const without = { ...options };
    delete without.structuralApproval;
    return await actual.openTargetPlatform(without);
  } };
});
async function withoutStructuralApproval<T>(open: () => Promise<T>): Promise<T> {
  structuralApprovalOmitted.value = true;
  try {
    return await open();
  } finally {
    structuralApprovalOmitted.value = false;
  }
}

// #1（lead 11-13 Q2 `:48`；契约 §2.4“不传就不自动批准”；`create-platform.ts:485-490`）。公开选项路径：平台没有
// `structuralApproval` 时，立即冻结的提案、生命周期冻结的批、只因结构性待审的理解注记都照旧待人。改坏：三处
// `?? 默认` 改成 `?? {proposals:'auto',repairs:'auto'}` → 提案/批被采用、注记被收下。
it('#1 a platform built without structuralApproval never auto-approves: proposal, frozen batch and note wait',
  async () => {
    const proposals = kept(await withoutStructuralApproval(() => openProposalWorld()));
    await save(proposals.staff.world, null);
    const result = await propose(proposals, proposals.pin, responsibility('s6a-core', 'YIP-1'), 'YIP-1');
    expect(result).toMatchObject({ status: 'needs_decision' });
    if (result.status !== 'needs_decision') throw new Error(`#1: no card without the option: ${JSON.stringify(result)}`);
    expect((await proposals.cardByKey(result.cardKey)).state).toBe('waiting_answer');

    const notes = kept(await withoutStructuralApproval(() => openS6BProjectWorld({ backend: 'memory' })));
    await save(notes.world, null);
    const written = await scribeUnderstanding(notes.world, notes.scribe, { label: 'yip1', structural: true });
    const versions = readyValue<{ items: NoteVersionSnapshot[] }>(await notes.world.platform.notes.listCurrentVersions(
      notes.world.humanContext(), { anchor: { kind: 'project' }, limit: 100, cursor: null }), 'note versions');
    expect(versions.items.find(item => item.noteId === written.note.noteId))
      .toMatchObject({ state: 'pending_review', reviewReasons: ['structural'] });
    expect((await notes.main.readCards()).filter(card =>
      card.source.kind === 'note_review' && card.state === 'waiting_answer')).toHaveLength(1);

    // `proposal-service.ts:681`：生命周期冻结那一支（开窗口，批已 pending），选项缺席时冻结后批仍留在卡上。
    const lifecycle = kept(await withoutStructuralApproval(() => openProposalWorld({ batchWindow: true })));
    await save(lifecycle.staff.world, null);
    const queued = await propose(lifecycle, lifecycle.pin, responsibility('s6a-core', 'YIP-1 lifecycle'),
      'YIP-1 lifecycle');
    if (queued.status !== 'pending_batch') throw new Error(`#1: no pending batch: ${JSON.stringify(queued)}`);
    expect(await lifecycle.freezeAttempt(lifecycle.pin, [queued.proposalRef])).toMatchObject({ status: 'ready' });
    expect(await lifecycle.proposalCardCount()).toBe(1);
    expect(await lifecycle.currentPin()).toEqual(lifecycle.pin);
  }, 300_000);

// Y3、Y3b（§3.1 立即冻结、§2.1 applied、§3.8 回放）。今天红在存设置；落地后工作轮的提案在同一次调用里采用、回新 pin、
// 不出卡，重放回同一个 applied。改坏：`writeProposal` 新提交那一支不调 afterFreeze → 第一句；`replayPropose` 没改 → 最后一句。
describe.each(['memory', 'sqlite'] as const)('Y3 (%s)', backend => {
  it('Y3 + Y3b an adviser\'s Work proposal is applied in the same call with the new pin; its replay is the same', async () => {
    const world = await proposalWorld(null, backend);
    const result = await propose(world, world.pin, responsibility('s6a-core', 'YIP-3'), 'YIP-3');
    expect(result).toEqual({ status: 'applied', proposalRef: expect.objectContaining({ aggregateType: 'ArchitectureProposal' }),
      catalogPin: await world.currentPin() });
    expect(await world.proposalCardCount()).toBe(0);
    expect(await world.replayPropose()).toEqual(result);
  }, 120_000);
});

// Astra 审后 1（必须改）：自动采用的提交落了、知识文件没写成，第一次调用就报 `unavailable`（`knowledge-write.ts`
// 写入契约：记录已提交、文件没写成从不当成功），不折成卡已经出不来的 `needs_decision`。故障：模块目录只读，提交照常，
// 写文件失败。改坏：`autoApplyBatch` 把它折成 null → `needs_decision`。
it('Y3f an auto-applied batch whose commit lands but whose file write fails is reported at once, not as a card', async () => {
  const world = await proposalWorld(null);
  const modules = dirname(join(world.staff.world.root, kls2cModuleFile(world.staff.world, 's6a-core')));
  chmodSync(modules, 0o555);
  const result = await propose(world, world.pin, responsibility('s6a-core', 'YIP-3f'), 'YIP-3f')
    .finally(() => chmodSync(modules, 0o755));
  expect(result).toMatchObject({ status: 'rejected', code: 'unavailable',
    reason: expect.stringContaining('记录已提交、知识文件没写成') });
}, 120_000);

// Q7（lead：只看开关，不看 Run 所属目标的档位）。今天红在存设置；落地后每步确认的目标里，参谋工作轮的提案照样采用。
// 改坏：自动判定也读目标的 autonomy → needs_decision。
it('Y3q (Q7) under an every_step Goal the switch alone decides: the proposal is applied', async () => {
  const world = await proposalWorld(null);
  const { goal } = readyValue<{ goal: { revision: number } }>(await world.staff.main.route('goals/settings',
    { goalRef: world.staff.goal }), 'goals/settings');
  expect(await world.staff.main.post('goals/settings/set', graphWrite(S6A_SCOPE, { goalRef: world.staff.goal,
    autonomy: 'every_step', waitForGoalRef: null }, 'yip-q7', [{ ref: world.staff.goal, revision: goal.revision }])))
    .toMatchObject({ status: 'committed' });
  expect(await propose(world, world.pin, responsibility('s6a-core', 'YIP-Q7'), 'YIP-Q7')).toMatchObject({ status: 'applied' });
}, 120_000);

// Y4（§3.1，62-6；PRODUCT :513）。今天红在第一次存设置；落地后 ask 下出的卡改存出厂默认后还在、pin 不动，人答“采用”
// 照常采用（护栏）。改坏：存设置时扫描在等的批，或卡源现读开关 → 卡没了。
it('Y4 a card made under ask still waits after the save goes back to auto; the person\'s approval applies it', async () => {
  const world = await proposalWorld(ASK);
  const result = await propose(world, world.pin, responsibility('s6a-core', 'YIP-4'), 'YIP-4');
  if (result.status !== 'needs_decision') throw new Error(`Y4: no card under ask: ${JSON.stringify(result)}`);
  await save(world.staff.world, null);
  await world.staff.world.settleDetached();
  const card = await world.cardByKey(result.cardKey);
  expect(card.state).toBe('waiting_answer');
  expect(await world.currentPin()).toEqual(world.pin);
  await world.answer(card, 'approve', 'yip4-approve');
  expect((await world.read(result.proposalRef)).proposal).toMatchObject({ state: 'applied' });
}, 120_000);

// Y5（§3.4 保护、§3.5 没采用；121-106 第 5 条）。今天红在存设置；落地后要改的模块文件被人手改过，不采用、卡在、
// 通知写明路径、文件不动。改坏：不做保护，或只查 architecture.json → applied、文件被盖。
it('Y5 a proposal that would overwrite a file the platform did not write keeps its card and says which', async () => {
  const world = await proposalWorld(null);
  const path = kls2cModuleFile(world.staff.world, 's6a-core');
  const file = JSON.parse(readFileSync(join(world.staff.world.root, path), 'utf8')) as Record<string, unknown>;
  const edited = `${JSON.stringify({ ...file, responsibility: 'YIP-5 changed by a person' }, null, 2)}\n`;
  writeFileSync(join(world.staff.world.root, path), edited);
  expect(await propose(world, world.pin, responsibility('s6a-core', 'YIP-5'), 'YIP-5')).toMatchObject({ status: 'needs_decision' });
  expect(await world.proposalCardCount()).toBe(1);
  expect(await summaries(world.staff.main)).toContain(`没有自动采用结构提案：会盖掉不是平台写的文件 ${path}；卡留着等你决定`);
  expect(readFileSync(join(world.staff.world.root, path), 'utf8')).toBe(edited);
}, 120_000);

// Y6（§3.4 新增冲突；PRODUCT :510）。今天红在存设置；落地后新模块认领 s6a-core 的路径，写后多出冲突，不采用、卡在。
// 冲突数手算是 2（`knowledgeConflictsOf` 给认领同一路径的两个模块各记一处）；新文件名随机，只核头尾和 s6a-core 的文件。
// 改坏：不做写前写后比较 → applied。
it('Y6 a proposal whose write adds a double claim keeps its card and names the new conflicts', async () => {
  const world = await proposalWorld(null);
  expect(await propose(world, world.pin, addModule('yip6', await corePath(world)), 'YIP-6'))
    .toMatchObject({ status: 'needs_decision' });
  expect(await world.proposalCardCount()).toBe(1);
  const declined = (await summaries(world.staff.main)).filter(summary => summary.startsWith('没有自动采用结构提案：'));
  expect(declined).toHaveLength(1);
  expect(declined[0]).toMatch(/^没有自动采用结构提案：写后会新增 2 处冲突：.+；卡留着等你决定$/);
  expect(declined[0]).toContain(kls2cModuleFile(world.staff.world, 's6a-core'));
}, 120_000);

// Y7（§3.4；计划 §3.4 改正：写前就有的冲突不挡）。今天红在存设置；落地后人的目录修订先造一处双认领（平台写的文件），
// 只碰 s6a-dest 的提案照样采用。改坏：改成“写后有冲突就不采用” → needs_decision。
it('Y7 a conflict that was there before the write does not hold back an unrelated proposal', async () => {
  const world = await proposalWorld(null);
  const { pin } = await world.revise([addModule('yip7-twin', await corePath(world))]);
  expect(await propose(world, pin, responsibility('s6a-dest', 'YIP-7'), 'YIP-7')).toMatchObject({ status: 'applied' });
}, 120_000);

// Astra 审后 2（应改）：冲突按身份 (kind, moduleId) 比，少了参与文件是旧冲突变小，不算新增。手算：人的目录修订让
// s6a-core、yip7b-a、yip7b-b 三个平台写的模块认领同一路径（三处冲突，各列三个文件）；提案删掉 yip7b-b，写后剩
// s6a-core、yip7b-a 两处，各列两个文件，身份都在、没有新文件 → applied。改坏：整条冲突比较 → 两处“新增”，needs_decision。
it('Y7b removing one of three claimers of a path is applied: a conflict with fewer files is not a new one', async () => {
  const world = await proposalWorld(null);
  const path = await corePath(world);
  const { pin } = await world.revise([addModule('yip7b-a', path), addModule('yip7b-b', path)]);
  expect(await propose(world, pin, { op: 'remove_module', moduleId: 'yip7b-b' }, 'YIP-7b'))
    .toMatchObject({ status: 'applied' });
}, 120_000);

// #9（next1113b 裁定 :122：晚到的待批提案在 pin 移动后每一趟都 `source_stale`，改成一次提交关成 `stale`）。开窗口提
// 一份（`pending_batch`，还没冻成批）；人的目录修订把 pin 推走；下一趟冻结不再回 `source_stale`，而是一次提交把
// 它关成 `stale` 并回空表，再一趟还是空表。改坏：`freezeProposals` 试算回 `source_stale` 时原样返回、不调
// `closeStalePending` → 提案停在 `pending`，红在 stale 那句。
// `freezeAttempt` 是 `freezePending` 调用的同一 owner 冻结入口；pin 由 `revise` 推走。
it('#9 a pending proposal on a pin that moves is closed stale by the next freeze, which then completes', async () => {
  const world = kept(await openProposalWorld({ batchWindow: true }));
  const result = await propose(world, world.pin, responsibility('s6a-core', 'YIP-9 late'), 'YIP-9 late');
  if (result.status !== 'pending_batch') throw new Error(`YIP-9: no pending batch: ${JSON.stringify(result)}`);
  const { pin } = await world.revise([addModule('yip9-twin', 'src/yip9-twin')]);
  expect(pin.catalogRef.revision).toBe(world.pin.catalogRef.revision + 1);
  const frozen = await world.freezeAttempt(world.pin, [result.proposalRef]);
  expect((await world.read(result.proposalRef)).proposal).toMatchObject({ state: 'stale' });
  expect(frozen).toEqual({ status: 'ready', value: [] });
  expect(await world.freezeAttempt(world.pin, [result.proposalRef])).toEqual({ status: 'ready', value: [] });
}, 120_000);
