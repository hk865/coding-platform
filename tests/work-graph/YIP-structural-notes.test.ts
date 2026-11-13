/**
 * 乙′-1 写测试方（决定 117）：只因结构性而待审的理解注记（契约 §3.6；开工裁定 §1 第 6 条、§9 Q4，lead 取“理由仅为
 * 结构性”），验收行 Y10、Y11，加 Q4 的一格纯表。世界是 `openS6BProjectWorld`（S6B1，SQLite：开关是 Host 设置，memory
 * 的 Host 没有设置目录，存设置回 `unsupported`，见 `host.ts` 的 `settingsDirectory`）：`S7D1-project-card-world`
 * 第一步就让人采用了书记的理解，再写一条会替掉人确认过的注记，请知悉类别成了 `user_affected`，所以用它底下这一层。
 * 书记这一步照 `scribeUnderstanding` 自己写（它断言结构性的一定待审），只多一个 `contradicts`；写结果读工具结果。
 * 今天 Y10、Y11 红在第一次存设置（路由未发布）；Q4 那格今天是绿的护栏（今天没有放行），类型检查红在新字段。
 */
import { afterEach, expect, it } from 'vitest';
import type { StructuralApprovalV1 } from '../../src/contracts/architecture-proposal.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { admitNoteWrite } from '../../src/core/work-graph/state/note-machine.js';
import { settingsPost } from '../app/support/S8A-L8-host.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { understandingNote } from '../helpers/S4C2-note-card-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS6BProjectWorld, understandingPointer, writeUserProjectUnderstanding } from '../helpers/S6B1-fixture.js';
import { jsonOf } from '../helpers/S7C-member-fixture.js';

type ProjectWorld = Awaited<ReturnType<typeof openS6BProjectWorld>>;
const worlds: ProjectWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

/** The project world with `{proposals:'auto', repairs:'ask'}` saved: notes follow `proposals`, not `repairs`. */
async function projectWorld(): Promise<ProjectWorld> {
  const opened = await openS6BProjectWorld({ backend: 'sqlite' });
  worlds.push(opened);
  const value: StructuralApprovalV1 = { proposals: 'auto', repairs: 'ask' };
  expect(await (await settingsPost(opened.world.base, 'structural-approval/save', opened.world.token,
    { projectId: S6A_SCOPE.projectId, value })).json()).toMatchObject({ status: 'ready' });
  return opened;
}
/** The scribe's next task writes one structural project understanding through `record_note`; the tool's result. */
async function scribeWrites(p: ProjectWorld, label: string, contradicts: string[] = []): Promise<unknown> {
  const pointer = await understandingPointer(p.world);
  const note = understandingNote({ anchor: { kind: 'project' }, topic: 'yip-understanding', structural: true,
    conclusion: `YIP ${label}`, replaces: pointer.noteId === null ? [] : [pointer.noteId] }) as
    Extract<NoteDraftV1, { kind: 'understanding' }>;
  const task = p.scribe.nextTask();
  p.world.scriptReplies([{ kind: 'calls', calls: [{ callId: `yip-${label}`, name: 'record_note', args: { op: 'write',
    kind: 'understanding', topic: note.topic, conclusion: note.conclusion, anchor: note.anchor, sections: note.sections,
    structural: true, replaces: note.replaces, contradicts, expectedPointerRevision: pointer.revision } }] },
  { kind: 'text', text: `YIP scribe wrote ${label}` }]);
  await driveWorkflow(p.world.ag2b, { schemaVersion: 1, goalRef: p.scribe.goal, flowId: `yip-${label}`,
    sessionHint: p.scribe.line.ref, kind: 'select_work', taskId: task.taskId });
  return jsonOf(p.world.model.requests, `yip-${label}`);
}
const noteCards = async (p: ProjectWorld) => (await p.main.readCards())
  .filter(card => card.source.kind === 'note_review' && card.state === 'waiting_answer');

// Y10（§3.6；121-106“待审注记卡可以一起自动批准”）。今天红在存设置；落地后只因结构性待审的写直接收下，没有卡，那一版
// 以 `structural` 进请知悉。改坏：`admitNoteWrite` 不去掉 structural → 红在写结果；`noticeClassOf` 不认 → 红在通知。
it('Y10 the scribe\'s structural understanding is accepted at once and shows in the notices as structural', async () => {
  const p = await projectWorld();
  expect(await scribeWrites(p, 'y10')).toMatchObject({ write: { status: 'accepted', reasons: [] } });
  expect(await noteCards(p)).toEqual([]);
  expect((await p.main.readNotices({ categories: ['note_review'] })).notices).toContainEqual(
    expect.objectContaining({ noteClass: 'structural', summary: expect.stringContaining('YIP y10') }));
}, 120_000);

// Y11（§3.6，lead Q4）。护栏行。今天红在存设置；落地后同时矛盾一条现行注记（人写的理解）的照旧待审，两个原因都在，
// 人的卡在。改坏：不管有没有别的原因，一律去掉 structural → accepted 或原因少了 structural。
it('Y11 a structural understanding that also contradicts a current note still waits for the person', async () => {
  const p = await projectWorld();
  const user = await writeUserProjectUnderstanding(p.world, p.main, 'y11');
  if (user.status !== 'accepted') throw new Error(`Y11: the person's understanding: ${JSON.stringify(user)}`);
  expect(await scribeWrites(p, 'y11', [user.noteId]))
    .toMatchObject({ write: { status: 'pending_review', reasons: ['structural', 'contradiction'] } });
  expect(await noteCards(p)).toHaveLength(1);
}, 120_000);

// Q4 纯表（A5；lead：structural + quota_full 仍是人的卡）。Host 世界里凑不出 quota_full（理解只算目标配额 200 条，
// 项目理解没有目标；配额选项 Host 不转给平台），所以在准入这一层钉。卡出不出由今天不变的 `userReasonsOf` 按头上的
// structural 再算。今天绿（没有放行）；落地后仍绿。改坏：放行时不看别的原因 → accepted。
it('Y11q (Q4) a structural understanding that is also over quota keeps both reasons and stays pending', () => {
  expect(admitNoteWrite({ kind: 'understanding', structural: true, contradicts: [], userNoteReplaced: false,
    anchorFull: false, goalFull: true, isUser: false, structuralAutoApproved: true }))
    .toMatchObject({ status: 'pending_review', reviewReasons: ['structural', 'quota_full'] });
});
