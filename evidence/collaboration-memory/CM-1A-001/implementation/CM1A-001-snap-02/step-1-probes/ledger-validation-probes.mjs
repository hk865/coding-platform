// CM-1A-001 第 1 步：账本校验修复的独立复现探针（协议约束 1.4 / 1.5 / 2.1 / 2.4）。
// 不改动验收方 evidence/ 里的原始探针（acceptance/CM1A-001-snap-01/review-01/standards-repro.mjs），
// 而是把它的三处 participation-start 变异 + 续页 intent 探针按**修复后**的期望重写，
// 并补上本轮新增的账本规则：范围外订阅 / hasMore 与下一页 intent 不一致 /
// 未领取就结算（1.5）/ 旧形状 domain 缺新字段（2.4）/ CAS 到本次没写入的聚合（2.1）。
// 运行：node evidence/collaboration-memory/CM-1A-001/implementation/step-1/ledger-validation-probes.mjs
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
registerHooks({ resolve(spec, ctx, next) {
  if (spec.endsWith('.js') && ctx.parentURL?.startsWith('file:')) {
    const url = new URL(spec.replace(/\.js$/, '.ts'), ctx.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, ctx);
  }
  return next(spec, ctx);
} });
const root = new URL('file:///mnt/d/1.project/Software/agent_platform/');
const { validateParticipationStartCommit, validateCommunicationCommit, validateCommunicationRoutePageCommit } =
  await import(new URL('src/data/state-ledger/ledger-validation.ts', root));
const { buildParticipationStartCommit, buildRoutePageCommit, routePageIntentFor, buildIntentRecordCommit, buildSubscriptionCreateCommit } =
  await import(new URL('src/control/control-engine/records/coordination.ts', root));
const { InMemoryLedger } = await import(new URL('src/data/state-ledger/in-memory-ledger.ts', root));
const { canonicalJson, sha256Hex } = await import(new URL('src/contracts/fingerprint.ts', root));

let sequence = 0;
const deps = { workspaceId: 'w', now: () => '2026-09-13T00:00:00Z', eventId: () => 'event-' + ++sequence };

// ── A. participation-start（先通用、再专用）────────────────────────────────────
const ref = { aggregateType: 'WorkContextBinding', projectId: 'p', workspaceId: 'w', workId: 'work' };
const run = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r' };
const command = { commandId: 'cmd', correlationId: 'corr', identity: { projectId: 'p', idempotencyKey: 'key', actor: { kind: 'system', id: 'sys' } }, aggregateId: 'part', payload: { workContextRef: ref, agentInstanceId: 'agent', roleBinding: {}, runRef: run }, expectedRevision: 1 };
const binding = { ref, revision: 1, schemaVersion: 1, binding: { schemaVersion: 1, workId: 'work', projectId: 'p', workspaceId: 'w', workKind: 'coordination', goalId: 'g', taskId: null, planRef: null, planRevision: null, roleBindingRef: {}, initialRunRef: run, linkedRunRefs: [run], status: 'active', createdAt: deps.now() }, recordedAt: deps.now() };
const batch = buildParticipationStartCommit(command, deps, 'fingerprint', binding);
assert.equal(validateParticipationStartCommit(batch), true, '合法基线必须仍然通过');
assert.equal(validateCommunicationCommit(batch), true);
console.log('A. participation-start baseline: specific=true generic=true');
for (const [name, mutate] of [
  ['empty eventId', b => { b.events[0].eventId = ''; }],
  ['event schemaVersion=2', b => { b.events[0].schemaVersion = 2; }],
  ['link event workspace differs', b => { b.events[1].workspaceId = 'other'; }],
  ['event projectId differs', b => { b.events[0].projectId = 'other'; }],
  ['snapshot projectId differs', b => { b.snapshots[0].ref.projectId = 'other'; }],
  ['identity idempotencyKey empty', b => { b.identity.idempotencyKey = ''; }],
]) {
  const changed = structuredClone(batch);
  mutate(changed);
  const specific = validateParticipationStartCommit(changed);
  const ledger = new InMemoryLedger();
  const receipt = await ledger.commit(changed);
  console.log('   ' + name + ': specific=' + specific + ' generic=' + validateCommunicationCommit(changed) + ' ledger=' + receipt.status + '/' + receipt.code);
  assert.equal(specific, false, name + ' 必须被专用校验拒绝');
  assert.equal(receipt.status, 'rejected', name + ' 必须被账本拒绝');
}

// ── B. communication-route-page（协议约束 1.4 / 1.5 / 2.1 / 2.4）───────────────
const projectId = 'p'; const workspaceId = 'w'; const topic = 'topic'; const cursor = 'c0000000009';
const subRef = (id) => ({ aggregateType: 'Subscription', projectId, workspaceId, subscriptionId: id });
const workCtx = { aggregateType: 'WorkContextBinding', projectId, workspaceId, workId: 'w-c' };
const subSnap = (id) => ({ ref: subRef(id), revision: 2, schemaVersion: 1, subscription: { schemaVersion: 1, subscriptionId: id, projectId, workspaceId, ownerWorkContextRef: workCtx, ownerParticipationRef: { aggregateType: 'WorkParticipation', projectId, workspaceId, workId: 'w-c', participationId: 'p-c' }, topics: [topic], startCursor: 'c0000000001', routedThroughCursor: cursor, status: 'active', createdAt: deps.now(), cancelledAt: null }, recordedAt: deps.now() });
const deliveryOf = (id, subId) => ({ schemaVersion: 1, deliveryId: id, projectId, workspaceId, origin: { kind: 'subscription', subscriptionRef: subRef(subId), sourceTopic: topic, sourceCursor: cursor }, targetWorkContextRef: workCtx, bodyRef: null, sourceRefs: [], createdAt: deps.now() });
const KEY_A = canonicalJson(subRef('sub-a'));
const KEY_B = canonicalJson(subRef('sub-b'));
const baseId = routePageIntentFor({ projectId, workspaceId, topic, cursor, now: deps.now() }).intentId;
const contId = (position) => baseId + '-p' + sha256Hex(position).slice(0, 8);
const contIntent = (position, scope) => ({ ...routePageIntentFor({ projectId, workspaceId, topic, cursor, now: deps.now() }), intentId: contId(position), domain: { kind: 'route_page', sourceTopic: topic, sourceCursor: cursor, subscriptionPosition: position, subscriptionScope: scope } });
const seedIntent = async (ledger, intent, idempotencyKey) => {
  const seedCommand = { ...command, identity: { ...command.identity, idempotencyKey } };
  return ledger.commit(buildIntentRecordCommit({ command: seedCommand, deps, fingerprint: 'seed-' + idempotencyKey, intent }));
};
/** 用真实 subscription-create 提交把订阅种进账本（否则页对订阅的 CAS@1 会因聚合不存在而冲突）。 */
const seedSubscription = async (ledger, id) => {
  const seedCommand = {
    ...command,
    aggregateId: id,
    identity: { ...command.identity, idempotencyKey: 'seed-sub-' + id },
    payload: { workspaceId, ownerWorkContextRef: workCtx, ownerParticipationRef: { aggregateType: 'WorkParticipation', projectId, workspaceId, workId: 'w-c', participationId: 'p-c' }, topics: [topic], startCursor: 'c0000000001' },
  };
  return ledger.commit(buildSubscriptionCreateCommit({ command: seedCommand, deps, fingerprint: 'seed-sub-' + id }));
};
const pageCommit = (priorIntent, extra) => buildRoutePageCommit({
  command: { ...command, identity: { ...command.identity, idempotencyKey: 'page' } },
  deps, fingerprint: 'page-fingerprint',
  prior: { ref: { aggregateType: 'CommunicationIntent', projectId, workspaceId, intentId: priorIntent.intentId }, revision: 1, schemaVersion: 1, intent: priorIntent, recordedAt: deps.now() },
  deliveries: extra.deliveries ?? [], subscriptions: extra.subscriptions ?? [], waits: [], nextIntent: extra.nextIntent ?? null,
});
const leased = (domain, intentId = baseId) => ({ ...routePageIntentFor({ projectId, workspaceId, topic, cursor, now: deps.now() }), intentId, domain, status: 'leased', leaseGeneration: 1, leaseOwner: 'consumer-1' });

// B1 合法末页：范围固定为单条订阅、本页处理它、没有续页。
{
  const intent = leased({ kind: 'route_page', sourceTopic: topic, sourceCursor: cursor, subscriptionPosition: null, subscriptionScope: [{ subscriptionRef: subRef('sub-a'), expectedRevision: 1 }] });
  const ledger = new InMemoryLedger();
  assert.equal((await seedIntent(ledger, intent, 'seed-ok')).status, 'committed');
  assert.equal((await seedSubscription(ledger, 'sub-a')).status, 'committed');
  const page = pageCommit(intent, { deliveries: [{ ref: { aggregateType: 'Delivery', projectId, workspaceId, deliveryId: 'd-1' }, revision: 1, schemaVersion: 1, delivery: deliveryOf('d-1', 'sub-a'), recordedAt: deps.now() }], subscriptions: [subSnap('sub-a')] });
  const receipt = await ledger.commit(page);
  console.log('B1 legal last page: validator=' + validateCommunicationRoutePageCommit(page) + ' ledger=' + receipt.status);
  assert.equal(receipt.status, 'committed');
}
// B2 范围外订阅 → 拒绝
{
  const intent = leased({ kind: 'route_page', sourceTopic: topic, sourceCursor: cursor, subscriptionPosition: null, subscriptionScope: [{ subscriptionRef: subRef('sub-a'), expectedRevision: 1 }] });
  const ledger = new InMemoryLedger();
  await seedIntent(ledger, intent, 'seed-out');
  await seedSubscription(ledger, 'sub-c');
  const page = pageCommit(intent, { subscriptions: [subSnap('sub-c')] });
  const receipt = await ledger.commit(page);
  console.log('B2 out-of-scope subscription: ledger=' + receipt.status + '/' + receipt.code);
  assert.equal(receipt.status, 'rejected');
}
// B3 范围里还有剩余订阅，却没有下一页 intent → 拒绝
{
  const intent = leased({ kind: 'route_page', sourceTopic: topic, sourceCursor: cursor, subscriptionPosition: null, subscriptionScope: [{ subscriptionRef: subRef('sub-a'), expectedRevision: 1 }, { subscriptionRef: subRef('sub-b'), expectedRevision: 1 }] });
  const ledger = new InMemoryLedger();
  await seedIntent(ledger, intent, 'seed-more');
  await seedSubscription(ledger, 'sub-a');
  const page = pageCommit(intent, { deliveries: [{ ref: { aggregateType: 'Delivery', projectId, workspaceId, deliveryId: 'd-2' }, revision: 1, schemaVersion: 1, delivery: deliveryOf('d-2', 'sub-a'), recordedAt: deps.now() }], subscriptions: [subSnap('sub-a')] });
  const receipt = await ledger.commit(page);
  console.log('B3 hasMore but no next intent: ledger=' + receipt.status + '/' + receipt.code);
  assert.equal(receipt.status, 'rejected');
}
// B4 末页却登记了续页 intent → 拒绝
{
  const scope = [{ subscriptionRef: subRef('sub-a'), expectedRevision: 1 }];
  const intent = leased({ kind: 'route_page', sourceTopic: topic, sourceCursor: cursor, subscriptionPosition: null, subscriptionScope: scope });
  const ledger = new InMemoryLedger();
  await seedIntent(ledger, intent, 'seed-last');
  await seedSubscription(ledger, 'sub-a');
  const page = pageCommit(intent, { deliveries: [{ ref: { aggregateType: 'Delivery', projectId, workspaceId, deliveryId: 'd-3' }, revision: 1, schemaVersion: 1, delivery: deliveryOf('d-3', 'sub-a'), recordedAt: deps.now() }], subscriptions: [subSnap('sub-a')], nextIntent: contIntent(KEY_A, scope) });
  const receipt = await ledger.commit(page);
  console.log('B4 last page with a spurious next intent: ledger=' + receipt.status + '/' + receipt.code);
  assert.equal(receipt.status, 'rejected');
}
// B5 未领取就结算（协议约束 1.5）→ 拒绝
{
  const domain = { kind: 'route_page', sourceTopic: topic, sourceCursor: cursor, subscriptionPosition: null, subscriptionScope: [] };
  const intent = { ...routePageIntentFor({ projectId, workspaceId, topic, cursor, now: deps.now() }), domain }; // pending / generation 0 / 无 owner
  const ledger = new InMemoryLedger();
  await seedIntent(ledger, intent, 'seed-unclaimed');
  const page = pageCommit(intent, {});
  const receipt = await ledger.commit(page);
  console.log('B5 settle without a real claim: ledger=' + receipt.status + '/' + receipt.code);
  assert.equal(receipt.status, 'rejected');
}
// B6 旧形状 route_page domain（缺新字段）→ 拒绝，不补猜值（协议约束 2.4）
{
  const legacy = { ...routePageIntentFor({ projectId, workspaceId, topic, cursor, now: deps.now() }), domain: { kind: 'route_page', sourceTopic: topic, sourceCursor: cursor, afterSubscriptionRef: null, routedThroughCursor: null } };
  const ledger = new InMemoryLedger();
  await seedIntent(ledger, legacy, 'seed-legacy');
  const page = pageCommit(legacy, {});
  const receipt = await ledger.commit(page);
  console.log('B6 legacy-shaped route_page domain: ledger=' + receipt.status + '/' + receipt.code);
  assert.equal(receipt.status, 'rejected');
}
// B7 CAS 到本次没有写入的聚合（协议约束 2.1）→ 拒绝
{
  const domain = { kind: 'route_page', sourceTopic: topic, sourceCursor: cursor, subscriptionPosition: null, subscriptionScope: [] };
  const intent = leased(domain);
  const ledger = new InMemoryLedger();
  await seedIntent(ledger, intent, 'seed-cas');
  const page = pageCommit(intent, {});
  const changed = { ...page, expectedVersions: [...page.expectedVersions, { ref: subRef('sub-elsewhere'), revision: 0 }] };
  const receipt = await ledger.commit(changed);
  console.log('B7 CAS on an aggregate this page does not write: ledger=' + receipt.status + '/' + receipt.code);
  assert.equal(receipt.status, 'rejected');
}
// B8 续页 intent 的 id 由调用方手写（非派生）→ 拒绝
{
  const domain = { kind: 'route_page', sourceTopic: topic, sourceCursor: cursor, subscriptionPosition: null, subscriptionScope: [] };
  const intent = leased(domain);
  const ledger = new InMemoryLedger();
  await seedIntent(ledger, intent, 'seed-hand');
  await seedSubscription(ledger, 'sub-a');
  const page = pageCommit(intent, { deliveries: [{ ref: { aggregateType: 'Delivery', projectId, workspaceId, deliveryId: 'd-4' }, revision: 1, schemaVersion: 1, delivery: deliveryOf('d-4', 'sub-a'), recordedAt: deps.now() }], subscriptions: [subSnap('sub-a')], nextIntent: { ...contIntent(KEY_A, []), intentId: 'next-page' } });
  const receipt = await ledger.commit(page);
  console.log('B8 hand-written continuation id: ledger=' + receipt.status + '/' + receipt.code);
  assert.equal(receipt.status, 'rejected');
}
console.log('ALL STEP-1 PROBES AS EXPECTED');
