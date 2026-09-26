/** A1 assembly demonstration. Run after `node --run build` in next/.
 * Only Project/Workspace bootstrap rows are seeded. Every architecture,
 * Session, relationship and lifecycle result below uses the public platform.
 * No model is called; this is not the complete execution/consultation product. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTargetPlatform } from '../dist/composition/create-platform.js';
import { createSqliteRecordBackend } from '../dist/core/record-store/sqlite-record-store.js';
import { GOAL_RECORD_SCHEMAS, canonicalRefKey, encodeProjectSnapshot,
  encodeWorkspaceSnapshot } from '../dist/core/work-graph/persistence/record-codecs.js';

if (process.argv.slice(2).some(arg => arg !== '--keep')) {
  throw Error('Usage: node scripts/graph-session-demo.mjs [--keep]');
}
const keep = process.argv.includes('--keep');
const directory = await mkdtemp(join(tmpdir(), 'next-graph-session-demo-'));
const projectId = 'graph-session-demo';
const scope = { projectId, workspaceId: 'demo-workspace' };
const project = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace = { ref: { aggregateType: 'Workspace', ...scope }, revision: 1 };
const actor = { kind: 'human', id: 'demo-operator' };
const ctx = { ...scope, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', ...scope, actor }, signal: new AbortController().signal };
const target = { kind: 'module', ref: { projectId, moduleId: 'source-tools' } };
const role = { kind: 'legacy_template', templateId: 'source-investigator', templateRevision: '1' };
const log = (step, details) => console.log(JSON.stringify({ step, ...details }));
const valueOf = (result, status, label) => {
  if (result.status !== status) throw Error(`${label}: ${JSON.stringify(result)}`);
  return result.value;
};
const discovery = { workspace: scope, target, includeArchived: false, page: { limit: 10 } };
const historyRequest = sessionRef => ({ sessionRef, afterCursor: null, throughCursor: null, limit: 10 });
let platform;

try {
  const at = new Date().toISOString();
  const schemas = { ...GOAL_RECORD_SCHEMAS, events: [...GOAL_RECORD_SCHEMAS.events,
    { eventType: 'DemoScopeInitialized', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }] };
  const seedStore = createSqliteRecordBackend({ path: join(directory, 'ledger.sqlite'), schemas });
  try {
    const result = await seedStore.records.commit({ identityKey: 'demo-scope', fingerprint: 'demo-scope-v1',
      guards: [project, workspace].map(record => ({ refKey: canonicalRefKey(record.ref), expectedRevision: null })),
      records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace)],
      events: [{ eventId: 'demo-scope-event', eventType: 'DemoScopeInitialized', schemaVersion: 1, occurredAt: at,
        json: JSON.stringify({ eventId: 'demo-scope-event', eventType: 'DemoScopeInitialized', schemaVersion: 1, occurredAt: at }) }],
      claims: [], indexGuards: [], indexChanges: [] });
    assert.equal(result.status, 'committed', 'trusted demo bootstrap must commit');
  } finally { await seedStore.close(); }
  log('演示启动数据', { directory, initializedOnly: ['Project', 'Workspace'],
    note: '未注入 Catalog、Session、关联或生命周期记录；角色为模板引用，未宣称装配 Skill。' });

  const options = { storage: { kind: 'sqlite', directory }, workspace: {
    async resolveRoot(requested) {
      return requested.projectId === scope.projectId && requested.workspaceId === scope.workspaceId
        ? { status: 'ready', value: { root: directory, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'unknown demo workspace' };
    },
    async authorize() { return { status: 'rejected', code: 'forbidden', reason: 'demo grants no source access' }; },
  }, kernelStores: { entries: [{ adapterId: 'demo-kernel', storeKey: 'demo-kernel-store', workspace: scope,
    databasePath: join(directory, 'kernel.sqlite') }] } };
  platform = await createTargetPlatform(options);
  const first = valueOf(await platform.runtime.createSession(ctx, { workspace: scope, role,
    recommendedRefs: [], initialLinks: [], meta: { requestId: 'first-session-before-catalog', expected: [] } }),
  'completed', 'create first Kernel Session');
  const sessionRef = { projectId, sessionId: first.ref.sessionId };
  const originalHistory = valueOf(await platform.runtime.readSessionHistory(ctx, historyRequest(sessionRef)),
    'ready', 'read original Kernel history');
  assert.equal(originalHistory.items[0]?.kind, 'session_created');
  log('正式架构前创建 Session', { sessionRef, kernel: first.kernel, historyRecords: originalHistory.items.length });

  const adopted = valueOf(await platform.architecture.adoptInitialArchitecture(ctx, { meta: {
    requestId: 'adopt-demo-catalog', expected: [project, workspace].map(({ ref, revision }) => ({ ref, revision })),
  }, input: { baselineId: 'demo-baseline', description: 'Source tool responsibility', constraints: [],
    catalog: { requireDag: true, dependencies: [], modules: [{ ref: target.ref, name: 'Source tools',
      responsibility: 'Read and compare source files', paths: ['src/source-tools'], interfaces: [] }] } } }),
  'committed', 'adopt formal architecture');
  const linkRef = { ...sessionRef, aggregateType: 'SessionWorkLink', target, relation: 'responsible' };
  valueOf(await platform.sessions.linkSessionWork(ctx, { meta: { requestId: 'link-first-session', expected: [
    { ref: first.ref, revision: first.revision }, { ref: linkRef, revision: 0 },
  ] }, input: { sessionRef, target, relation: 'responsible', active: true } }), 'committed', 'link Session');
  const second = valueOf(await platform.runtime.createSession(ctx, { workspace: scope, role, recommendedRefs: [],
    initialLinks: [{ target, relation: 'participates' }], meta: { requestId: 'second-module-session', expected: [] } }),
  'completed', 'create second linked Kernel Session');
  assert.notEqual(first.kernel.kernelSessionId, second.kernel.kernelSessionId);
  const found = valueOf(await platform.sessions.findSessions(ctx, discovery), 'ready', 'find module Sessions');
  assert.equal(found.items.length, 2);
  assert.ok(found.items.every(card => card.availability === 'idle'));
  log('同一模块发现两个独立 Session', { baseline: adopted.baseline.ref,
    sessions: found.items.map(card => ({ ref: card.record.ref, availability: card.availability })) });

  const beforeArchive = valueOf(await platform.sessions.readSession(ctx, sessionRef), 'ready', 'read before archive');
  const archived = valueOf(await platform.sessions.archiveSession(ctx, { meta: { requestId: 'archive-first-session',
    expected: [{ ref: beforeArchive.record.ref, revision: beforeArchive.record.revision }] },
  input: { sessionRef, reason: 'Leave the active consultation set explicitly' } }), 'committed', 'archive Session');
  const active = valueOf(await platform.sessions.findSessions(ctx, discovery), 'ready', 'read active set');
  assert.deepEqual(active.items.map(card => card.record.ref.sessionId), [second.ref.sessionId]);
  const historical = valueOf(await platform.sessions.findSessions(ctx, { ...discovery, includeArchived: true }),
    'ready', 'read historical associations');
  assert.equal(historical.items.length, 2);
  assert.deepEqual(historical.items.find(card => card.record.ref.sessionId === sessionRef.sessionId)?.links, beforeArchive.links);
  await platform.close();
  platform = await createTargetPlatform(options);
  const archivedHistory = valueOf(await platform.runtime.readSessionHistory(ctx, historyRequest(sessionRef)),
    'ready', 'read archived original history after reopen');
  assert.deepEqual(archivedHistory.items, originalHistory.items);
  assert.deepEqual(valueOf(await platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } }),
    'ready', 'read preserved architecture'), adopted);
  log('归档并重开数据库', { activeSessions: active.items.length, includingArchived: historical.items.length,
    originalHistoryPreserved: true, moduleAndLinksPreserved: true });

  const reactivated = valueOf(await platform.sessions.reactivateSession(ctx, { meta: {
    requestId: 'reactivate-first-session', expected: [{ ref: archived.ref, revision: archived.revision }],
  }, input: { sessionRef, reason: 'Make the existing context discoverable again' } }), 'committed', 'reactivate Session');
  assert.deepEqual(reactivated.kernel, first.kernel);
  assert.equal(valueOf(await platform.sessions.findSessions(ctx, discovery), 'ready', 'find reactivated Sessions').items.length, 2);
  assert.deepEqual(valueOf(await platform.runtime.readSessionHistory(ctx, historyRequest(sessionRef)),
    'ready', 'read reactivated history').items, originalHistory.items);
  log('重新启用完成', { lifecycle: reactivated.lifecycle, sameKernelSession: true,
    limitations: '装配演示不调用模型；真实执行、咨询、Skill 装配和暂停恢复尚未接通。' });
} finally {
  try { await platform?.close(); }
  finally {
    if (keep) log('保留演示数据', { directory });
    else { await rm(directory, { recursive: true, force: true }); log('已清理自有临时目录', { directory }); }
  }
}
