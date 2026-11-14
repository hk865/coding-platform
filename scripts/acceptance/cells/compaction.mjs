// The compaction scenario (single, not a ninth scenario; s9-b06-rulings-1112.md:28 S9-2; slice-K2-SPEC.md:787-793):
// its own Host and ledger like WA/WB, the ratios lowered in that Host's start configuration `runtime.compaction`
// (draft §6.3: not a settings route; `runtime-configuration.ts:186-190`, kept by the settings rebuild
// `host.ts:2084-2086`). One secretary line with more than three rounds. The only public trace of a compaction is the
// `context_compacted` record in `sessions/history` (`session-activity.ts:68-74`); its payload carries the summary
// whose six headings are fixed (`compaction.ts:43-44`).
import { ready } from '../lib/http.mjs';
import { workbenchConfig } from '../lib/host.mjs';
import { broken, chooseModel, openProject, sessionHistory, sessionQueries, submitRequest, waitRequest } from '../lib/flows.mjs';

const HEADINGS = ['## 目标和验收义务', '## 用户原话和要求', '## 做过的决定和依据', '## 没解决的事', '## 试过什么、结果如何', '## 来源'];
const lib = n => `// Module ${n}: text utilities, part ${n}.\n${Array.from({ length: 60 }, (_, i) =>
  `export function helper${n}_${i}(text) {\n  // Normalizes the text in step ${i} of module ${n}.\n  return String(text).trim().slice(0, ${i + 10});\n}\n`).join('')}`;
const FILES = { 'README.md': '# g6 compaction\n\nA library of text helpers.\n', ...Object.fromEntries([1, 2, 3, 4, 5].map(n => [`lib/m${n}.js`, lib(n)])) };
const ROUNDS = [
  '先读 lib/m1.js 和 lib/m2.js，告诉我它们各做什么，有没有重复。',
  '再读 lib/m3.js，和前两个比，命名规律是什么？',
  '再读 lib/m4.js 和 lib/m5.js，整体总结五个文件的结构。',
  '根据前面读到的，提一个合并重复 helper 的方案（只说方案，不改文件）。',
  '把方案里第一步再说细一点：先合并哪几个函数？',
];

const def = {
  id: 'compaction', host: 'compaction', rows: ['K2-P2'],
  checks: [
    { id: 'compacted', rows: ['K2-P2'], text: '线上出现“已压缩”（context_compacted，outcome=compacted）' },
    { id: 'six-sections', rows: ['K2-P2'], text: '摘要六段齐全' },
    { id: 'accepted', rows: ['K2-P2'], text: '“摘要消息 + 用户消息”相连 DeepSeek 收不收（压缩后的下一轮正常结束）' },
    { id: 'cache-after', rows: ['K2-P2'], text: '压缩后第一次请求的缓存命中（只量，不承诺）' },
  ],
};

async function run(ctx, rec) {
  const cell = ctx.cfg.cells.compaction;
  const host = await ctx.start('compaction', workbenchConfig({ settingsModels: ctx.cfg.host.settingsModels,
    runtime: { schemaVersion: 1, bindings: [], queryProfiles: [], compaction: { triggerRatio: cell.triggerRatio, targetRatio: cell.targetRatio } } }));
  try {
    const project = await openProject(ctx, host, 'compaction', FILES);
    rec.facts.project = project;
    rec.facts.model = await chooseModel(ctx, host, project, cell.modelId ?? null);
    const first = await submitRequest(project, ROUNDS[0]);
    if (first?.status !== 'queued') throw broken(ctx, `requests/submit: ${first?.code} ${first?.reason}`);
    let view = await waitRequest(ctx, project, first.requestRoot);
    for (const text of ROUNDS.slice(1)) {
      await submitRequest(project, text, { continues: first.requestRoot });
      view = await waitRequest(ctx, project, first.requestRoot);
    }
    // The round's own Session (the submit receipt's `secretary` is null when the request waited for a secretary).
    const secretary = view.rounds.map(round => round.session).find(session => session !== null && session !== undefined);
    if (secretary === undefined) throw broken(ctx, 'no secretary Session took the rounds (requests/read rounds have no session)');
    const history = await sessionHistory(project, secretary);
    const compactions = history.filter(item => item.kind === 'context_compacted')
      .map(item => ({ cursor: item.cursor, at: item.recordedAt, position: item.source.position, payload: JSON.parse(item.body?.text ?? 'null')?.payload ?? null }));
    rec.note(`秘书线 ${view.rounds.length} 轮；压缩记录 ${compactions.map(entry => `${entry.payload?.outcome}/${entry.payload?.summary === null ? 'stubs' : 'summary'}`).join(', ') || '无'}；触发 ${cell.triggerRatio}、目标 ${cell.targetRatio}`);
    const compacted = compactions.filter(entry => entry.payload?.outcome === 'compacted');
    if (compacted.length === 0) {
      rec.fail('compacted', compactions.length === 0 ? '没有 context_compacted 记录' : `只有 ${compactions.map(entry => `${entry.payload?.outcome}/${entry.payload?.failure?.reason}`).join(', ')}`);
      return;
    }
    rec.pass('compacted', `context_compacted ${compacted.length} 条（${compacted.map(entry => `${entry.cursor}:${entry.payload.summary === null ? 'stubs' : 'summary'}`).join(', ')}）`);
    // The record that really carries a summary (a stubs-only record has `summary: null`, `compaction.ts:209`) (#21).
    const done = compacted.find(entry => typeof entry.payload.summary?.text === 'string');
    if (done === undefined) {
      for (const id of ['six-sections', 'accepted', 'cache-after']) rec.uncover(id, 'env-unavailable', '这条线的压缩只走到第一步（stubs），没有走到摘要');
      return;
    }
    const summary = done.payload.summary.text;
    rec.check('six-sections', HEADINGS.every(heading => summary.split('\n').includes(heading)),
      `摘要（${done.cursor}）${summary.length} 字；缺的段：${HEADINGS.filter(heading => !summary.split('\n').includes(heading)).join(' ') || '无'}`);
    // The first ordinary request on the compacted context: the first `model.request_started` after that record in the
    // same history (the summary call runs in its own Kernel Session, `compaction.ts:314`), matched to its request row.
    const startedAfter = history.filter(item => item.source.position > done.position && item.kind === 'agent_event')
      .map(item => { try { return JSON.parse(item.body?.text ?? 'null')?.payload?.event ?? null; } catch { return null; } })
      .find(event => event?.type === 'model.request_started');
    const rows = (await sessionQueries(project, secretary)).flatMap(snapshot =>
      (snapshot.run?.executionState?.requests ?? []).map(request => ({ request, snapshot })));
    const next = startedAfter === undefined ? undefined : rows.find(row => row.request.requestId === startedAfter.payload.requestId);
    if (next === undefined) {
      const why = startedAfter === undefined ? '摘要之后这条线没有再发请求' : `摘要后第一次请求 ${startedAfter.payload.requestId} 在请求行里找不到`;
      rec.uncover('accepted', 'not-run', why);
      rec.uncover('cache-after', 'not-run', why);
      return;
    }
    // Second review #14: only that request's own fact answers "does DeepSeek accept summary + user message": reported
    // usage is accepted; an unknown one is judged after its Query reached its end, from where the failure came. What
    // the round did later (an invalid answer closing it) is noted, not judged here.
    const closeCode = view.rounds.find(round => round.ref.queryJobId === next.snapshot.ref.queryJobId)?.closeCode ?? null;
    if (next.request.usageStatus === 'reported') {
      rec.pass('accepted', `摘要后第一次请求 ${next.request.requestId}：usage reported（那一轮之后 ${next.snapshot.run?.status}${closeCode ? `，close ${closeCode}` : ''}，另记）`);
    } else {
      const ref = next.snapshot.ref;
      const job = ready(await project.host.client.read('queries/read', project.scope,
        { aggregateType: 'QueryJob', projectId: ref.projectId, workspaceId: ref.workspaceId, queryJobId: ref.queryJobId }));
      rec.fail('accepted', `摘要后第一次请求 ${next.request.requestId}：usage ${next.request.usageStatus}；Query ${job?.run?.run?.status}，close ${
        job?.job?.job?.closeReason?.code ?? '-'}：${job?.job?.job?.closeReason?.message ?? ''}`);
    }
    if (next.request.usageStatus !== 'reported') rec.uncover('cache-after', 'not-run', '摘要后第一次请求没有用量读数');
    else rec.pass('cache-after', `摘要后第一次请求 ${next.request.requestId}：输入 ${next.request.inputTokens}，缓存命中 ${next.request.cachedInputTokens}（只量，不承诺）`);
  } finally {
    await ctx.close('compaction');
  }
}

export default { ...def, run };
