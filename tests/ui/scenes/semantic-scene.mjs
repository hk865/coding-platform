/**
 * The semantic layer's one scene source (batch 9): 15 contacts, 3 flows and the
 * check answer, shared by `ArchOverview.scene.mjs` and `Main.scene.mjs`.
 *
 *   SCENE_SEM=empty   both reads answer an empty page (a new project)
 *   SCENE_SEM=fail    `architecture/semantic-links/check` answers not_found
 *
 * The fields are the real `SemanticLinkV1`/`SemanticFlowV1` shapes; the words are
 * the page's own `arch-overview.ts` table, not copied here.
 */

const sceneReady = (value) => ({ status: 'ready', value });
const MODE = process.env.SCENE_SEM || 'base';

const end = (moduleId, path, symbol = null, status = 'live', retired = []) => ({
  anchor: symbol === null ? { kind: 'file', path } : { kind: 'file', path,
    symbol: { language: 'typescript', qualifiedName: symbol, signatureDigest: 'd', range: { startLine: 10, endLine: 12 }, fileDigest: 'd' } },
  request: symbol === null ? { kind: 'file', path }
    : { kind: 'file', path, symbolRequest: { language: 'typescript', name: symbol } },
  moduleId, unresolved: moduleId === null ? 'not_owned' : null,
  anchorStatus: status, anchorRetiredReasons: retired,
});

const evidence = (path, line, role) => ({ role, at: { path, range: { startLine: line, endLine: line } } });

const link = (n, spec) => ({
  noteId: spec.noteId, version: spec.version === undefined ? 1 : spec.version,
  state: spec.state === undefined ? 'accepted' : spec.state,
  relation: spec.relation, from: spec.from, to: spec.to, via: spec.via ?? null,
  key: spec.key ?? null, evidence: spec.evidence ?? [evidence('src/app/host.ts', 10, 'use')],
  verification: spec.verification ?? { status: 'verified' },
  currentEligible: spec.currentEligible ?? true,
  topic: spec.topic ?? 'M' + n, conclusion: spec.conclusion ?? '第 ' + n + ' 条联系写下的结论',
  source: { kind: 'agent', sessionRef: { projectId: 'p', sessionId: 's' + n }, runRef: null, queryRunRef: null,
    duty: n % 2 === 0 ? 'adviser' : 'executor' },
  goalId: null, confirmedByUser: false, freshness: spec.freshness ?? 'fresh',
});

const APP = 'src/app';
const WG = 'src/core/work-graph';
const AR = 'src/core/agent-runtime';
const UI = 'src/ui';
const CT = 'src/contracts';
const WF = 'src/business/workflow';

const L = [
  link(1, { noteId: 'sem-1', topic: '启动核对', relation: 'calls', from: end(APP, APP + '/core-routes.ts', 'register'),
    to: end(WG, WG + '/state/task-machine.ts', 'advance'), key: { kind: 'literal', text: 'ledger.commit' },
    evidence: [evidence(APP + '/host.ts', 10, 'use'), evidence(WG + '/state/task-machine.ts', 20, 'wire')],
    conclusion: 'Host 起进程以后调用 WorkGraph 的状态机推进。' }),
  link(2, { noteId: 'sem-2', topic: '启动核对', relation: 'injects', from: end(APP, APP + '/host.ts', 'start'),
    to: end(WG, WG + '/state/task-machine.ts', 'advance'), via: end(CT, CT + '/access.ts', 'beforeCall'),
    evidence: [evidence(APP + '/host.ts', 12, 'use')], verification: { status: 'broken', missing: [0] },
    currentEligible: false, conclusion: 'Host 注入状态机，接线那一条证据找不到了。' }),
  link(3, { noteId: 'sem-3', topic: '消息一条', relation: 'message', from: end(AR, AR + '/runtime.ts', 'run'),
    to: end(WG, WG + '/notes/notes.ts', 'write'), key: { kind: 'literal', text: 'note.changed' },
    verification: { status: 'unverifiable', reason: 'key_not_literal' }, currentEligible: false }),
  link(4, { noteId: 'sem-4', topic: '查不了预算', relation: 'data', from: end(UI, UI + '/boot.ts', 'read'),
    to: end(APP, APP + '/host.ts', 'start'), key: { kind: 'literal', text: 'cursor' },
    verification: { status: 'unchecked', reason: 'budget' }, currentEligible: false }),
  link(5, { noteId: 'sem-5', topic: '存疑待核', relation: 'callback', from: end(CT, CT + '/access.ts', 'beforeCall'),
    to: end(WG, WG + '/state/task-machine.ts', 'advance'), via: end(CT, CT + '/hooks.ts', 'onSelected'),
    verification: { status: 'unchecked', reason: 'refs_pending' }, currentEligible: false }),
  link(6, { noteId: 'sem-6', topic: '过时的联系', relation: 'calls', from: end(WG, WG + '/views/views.ts', 'show'),
    to: end(AR, AR + '/runtime.ts', 'run'), currentEligible: false, freshness: 'stale' }),
  link(7, { noteId: 'sem-7', topic: '一端没了', relation: 'spawns', from: end(APP, APP + '/host.ts', 'start'),
    to: end(WF, WF + '/workflow.ts', 'run', 'retired', ['symbol_missing']), currentEligible: false }),
  link(8, { noteId: 'sem-8', topic: '待审', relation: 'data', from: end(WG, WG + '/persistence/persistence.ts', 'save'),
    to: end(CT, CT + '/access.ts', 'beforeCall'), currentEligible: false, state: 'pending_review' }),
  link(9, { noteId: 'sem-9', topic: '没登记', relation: 'calls', version: null, from: end(UI, UI + '/nav.ts', 'go'),
    to: end(APP, APP + '/server.ts', 'serve'), currentEligible: false }),
  link(10, { noteId: 'sem-10', topic: '启动核对之二', relation: 'calls', from: end(APP, APP + '/core-routes.ts', 'register'),
    to: end(WG, WG + '/state/task-machine.ts', 'advance') }),
  link(11, { noteId: 'sem-11', topic: '归不到模块', relation: 'message', from: end(null, 'src/elsewhere/a.ts'),
    to: end(null, 'src/elsewhere/b.ts'), currentEligible: false }),
  link(12, { noteId: 'sem-12', topic: 'UI 读 Host', relation: 'data', from: end(UI, UI + '/boot.ts', 'read'),
    to: end(APP, APP + '/host.ts', 'start') }),
  link(13, { noteId: 'sem-13', topic: 'Workflow 调用', relation: 'calls', from: end(WF, WF + '/workflow.ts', 'run'),
    to: end(WG, WG + '/state/task-machine.ts', 'advance') }),
  link(14, { noteId: 'sem-14', topic: 'Runtime 起进程', relation: 'spawns', from: end(AR, AR + '/runtime.ts', 'run'),
    to: end('vendor/coding-agent', 'vendor/coding-agent/dist/public-api.js', 'spawn') }),
  link(15, { noteId: 'sem-15', topic: '契约数据', relation: 'data', from: end(CT, CT + '/access.ts', 'beforeCall'),
    to: end(AR, AR + '/execution-inputs.ts', 'read') }),
];

const step = (n, item, problem = null) => ({ link: item === null ? 'sem-withdrawn' : item.noteId, item, problem });
const FL = [
  { noteId: 'f-flow-1', version: 1, state: 'accepted', topic: '启动时核对没结束的执行',
    conclusion: '启动、调用、回调按顺序走完。', source: L[0].source, goalId: null,
    steps: [step(1, L[0]), step(2, L[1]), step(3, L[9])], gapsAfter: [1, 2], currentEligible: false, freshness: 'stale' },
  { noteId: 'f-flow-2', version: 1, state: 'accepted', topic: '检查进程被打断时',
    conclusion: '中间那一步不在了。', source: L[2].source, goalId: null,
    steps: [step(1, L[2]), step(2, null, 'not_current'),
      step(3, link(90, { noteId: 'sem-90', relation: 'calls', from: end(WG, WG + '/state/task-machine.ts', 'advance'),
        to: end(WG, WG + '/model/model.ts', 'read') }))], gapsAfter: [], currentEligible: false, freshness: 'unchecked' },
  { noteId: 'f-flow-3', version: 1, state: 'accepted', topic: '工作台读一个目标',
    conclusion: '每一步都对得上。', source: L[3].source, goalId: null,
    steps: [step(1, L[11]), step(2, L[14])], gapsAfter: [], currentEligible: true, freshness: 'fresh' },
];

/** The one semantic answer for a route, or undefined when the route is not ours. */
export function semanticReply(route, input) {
  if (route === 'architecture/semantic-links') {
    const cursor = input?.cursor ?? null;
    if (MODE === 'empty' || cursor !== null) return sceneReady({ items: [], next: null, catalogRevision: 1 });
    return sceneReady({ items: L, next: null, catalogRevision: 1 });
  }
  if (route === 'architecture/semantic-flows') {
    const cursor = input?.cursor ?? null;
    if (MODE === 'empty' || cursor !== null) return sceneReady({ items: [], next: null, catalogRevision: 1 });
    return sceneReady({ items: FL, next: null, catalogRevision: 1 });
  }
  if (route === 'architecture/semantic-links/check') {
    if (MODE === 'fail') return { status: 'rejected', code: 'not_found', reason: 'the scene withdrew it' };
    const items = Array.isArray(input?.items) ? input.items : [];
    return sceneReady({ items: items.map((item) => ({ noteId: item.noteId, version: item.version,
      verification: { status: 'verified' } })) });
  }
  return undefined;
}
