// Run from product root: node evidence/collaboration-memory/CM-1A-001/acceptance/CM1A-001-snap-01/review-01/standards-repro.mjs
// Isolated boundary probes. No production source or test files are modified.
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
const root = new URL('../../../../../../', import.meta.url);
const { validateParticipationStartCommit, validateCommunicationCommit, validateCommunicationRoutePageCommit } = await import(new URL('src/data/state-ledger/ledger-validation.ts', root));
const { buildParticipationStartCommit, buildRoutePageCommit, routePageIntentFor, buildIntentRecordCommit } = await import(new URL('src/control/control-engine/records/coordination.ts', root));
const { InMemoryLedger } = await import(new URL('src/data/state-ledger/in-memory-ledger.ts', root));
const ref = { aggregateType: 'WorkContextBinding', projectId: 'p', workspaceId: 'w', workId: 'work' };
const run = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r' };
const command = { commandId: 'cmd', correlationId: 'corr', identity: { projectId: 'p', idempotencyKey: 'key', actor: { kind: 'system', id: 'sys' } }, aggregateId: 'part', payload: { workContextRef: ref, agentInstanceId: 'agent', roleBinding: {}, runRef: run }, expectedRevision: 1 };
let sequence = 0;
const deps = { workspaceId: 'w', now: () => '2026-09-13T00:00:00Z', eventId: () => 'event-' + ++sequence };
const binding = { ref, revision: 1, schemaVersion: 1, binding: { schemaVersion: 1, workId: 'work', projectId: 'p', workspaceId: 'w', workKind: 'coordination', goalId: 'g', taskId: null, planRef: null, planRevision: null, roleBindingRef: {}, initialRunRef: run, linkedRunRefs: [run], status: 'active', createdAt: deps.now() }, recordedAt: deps.now() };
const batch = buildParticipationStartCommit(command, deps, 'fingerprint', binding);
assert.equal(validateParticipationStartCommit(batch), true);
console.log('participation baseline: accepted');
for (const [name, mutate] of [
  ['empty eventId', b => { b.events[0].eventId = ''; }],
  ['event schemaVersion=2', b => { b.events[0].schemaVersion = 2; }],
  ['link event workspace differs', b => { b.events[1].workspaceId = 'other'; }],
]) {
  const changed = structuredClone(batch);
  mutate(changed);
  const accepted = validateParticipationStartCommit(changed);
  console.log(name + ': accepted=' + accepted + ', generic=' + validateCommunicationCommit(changed));
  assert.equal(accepted, true, 'Known defect changed; review snapshot/result before reuse');
  const isolatedLedger = new InMemoryLedger();
  const seedIdentity = { ...command.identity, idempotencyKey: 'binding-seed' };
  const seed = await isolatedLedger.commit({
    commitKind: 'work-context-bind', schemaVersion: 1, identity: seedIdentity, fingerprint: 'binding-seed',
    expectedVersions: [{ ref, revision: 0 }], snapshots: [binding], outboxIntents: [],
    events: [{ ...batch.events[0], eventId: deps.eventId(), eventType: 'WorkContextBound',
      aggregateType: 'WorkContextBinding', aggregateId: 'work', aggregateRevision: 1,
      idempotencyKey: seedIdentity.idempotencyKey, payload: { binding: binding.binding } }],
  });
  assert.equal(seed.status, 'committed');
  const receipt = await isolatedLedger.commit(changed);
  console.log(name + ': actual Ledger.commit=' + receipt.status);
  assert.equal(receipt.status, 'committed');
}
const intent = routePageIntentFor({ projectId: 'p', workspaceId: 'w', topic: 'topic', cursor: 'c0000000001', now: deps.now() });
const prior = { ref: { aggregateType: 'CommunicationIntent', projectId: 'p', workspaceId: 'w', intentId: intent.intentId }, revision: 1, schemaVersion: 1, intent, recordedAt: deps.now() };
const input = { command, deps, fingerprint: 'fingerprint', prior, deliveries: [], subscriptions: [], waits: [], nextIntent: null };
const finalPage = buildRoutePageCommit(input);
assert.equal(validateCommunicationRoutePageCommit(finalPage), true);
const continuation = buildRoutePageCommit({ ...input, nextIntent: { ...intent, intentId: 'next-page' } });
assert.equal(validateCommunicationRoutePageCommit(continuation), false);
console.log('route final-page validator=true; continuation validator=false');
const ledger = new InMemoryLedger();
const seedCommand = { ...command, identity: { ...command.identity, idempotencyKey: 'seed' } };
const seed = await ledger.commit(buildIntentRecordCommit({ command: seedCommand, deps, fingerprint: 'seed-fingerprint', intent }));
assert.equal(seed.status, 'committed');
const rejected = await ledger.commit(continuation);
assert.deepEqual(rejected, { status: 'rejected', code: 'invalid_commit' });
console.log('continuation actual Ledger.commit=' + JSON.stringify(rejected));
const accepted = await ledger.commit(finalPage);
assert.equal(accepted.status, 'committed');
console.log('same ledger final-page commit=' + accepted.status);
console.log('All defect-reproduction assertions passed. These are negative boundary probes, not A03 end-to-end coverage.');
