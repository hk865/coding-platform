import './process-loader.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
const { createPersistentPlatform } = await import('../../src/composition/persistent-platform.ts');
const { communicationIntentRefFor } = await import('../../src/contracts/coordination.ts');
const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const h = await createPersistentPlatform({ dir: request.stateDir, deps: { clock: () => request.at, eventId: randomUUID }, coordinationPageSize: 1,
  ...(request.driveConsumer ? { coordinationConsumerId: request.driveConsumer } : {}),
  ...(request.sourceTag ? { sourceApplicability: { capture: async query => ({ status: 'sourced', pin: { schemaVersion: 1,
    projectId: query.projectId, workspaceId: query.workspaceId, sourceSet: query.sourceSet, identity: { workspace: request.workspaceId, commit: null },
    manifestDigest: createHash('sha256').update(request.sourceTag).digest('hex') } }) } } : {}) });
try {
  if (request.cancelCommand || request.cancelReadback) {
    const readback = async () => {
      const wait = await h.ledger.load(request.waitRef);
      const intent = await h.ledger.load(request.cancelIntentRef);
      const facts = {};
      let afterCursor = null;
      for (;;) {
        const page = await h.ledger.events({ afterCursor, limit: 1000 });
        for (const { event } of page.events) facts[event.eventType] = (facts[event.eventType] ?? 0) + 1;
        if (!page.hasMore || page.throughCursor === null || page.throughCursor === afterCursor) break;
        afterCursor = page.throughCursor;
      }
      return { wait, intent, facts };
    };
    if (request.cancelCommand) {
      const commit = h.ledger.commit.bind(h.ledger);
      h.ledger.commit = async batch => {
        const receipt = await commit(batch);
        if (batch.commitKind === 'wait-cancel' && receipt.status === 'committed') {
          writeFileSync(request.marker, JSON.stringify({ pid: process.pid, receipt, ...await readback() }), { flush: true });
          process.kill(process.pid, 'SIGKILL');
          await new Promise(() => {});
        }
        return receipt;
      };
      await h.control.cancelCommunication(request.cancelCommand);
      throw Error('wait-cancel commit kill hook was not reached');
    }
    const results = [], observations = [];
    for (let i = 0; i < 8; i++) {
      results.push(await h.drive({ reason: 'cancel-process-recovery', maxIntents: 8 }));
      observations.push(await readback());
    }
    process.stdout.write(JSON.stringify({ pid: process.pid, results, observations, ...await readback() }));
  } else {
  if (request.readyBeforeDrive) {
    writeFileSync(request.readyBeforeDrive, String(process.pid));
    const deadline = Date.now() + 60000;
    while (!existsSync(request.go)) { if (Date.now() > deadline) throw Error('drive barrier timeout'); await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  if (request.intentId) {
    const ref = communicationIntentRefFor(request.projectId, request.workspaceId, request.intentId);
    const loaded = await h.ledger.load(ref);
    const id = 'claim-' + request.consumerId;
    const claim = await h.control.claimCommunicationIntent({ commandId: id, commandType: 'CommunicationClaimIntent', schemaVersion: 1,
      aggregateId: request.intentId, expectedRevision: loaded.snapshot.revision, correlationId: id, submittedAt: request.at,
      identity: { projectId: request.projectId, actor: { kind: 'system', id: request.consumerId }, idempotencyKey: id },
      payload: { workspaceId: request.workspaceId, consumerId: request.consumerId, leaseDurationMs: 1000, now: request.at } });
    if (request.ready) {
      writeFileSync(request.ready, String(process.pid));
      const deadline = Date.now() + 90000;
      while (!existsSync(request.go)) { if (Date.now() > deadline) throw Error('late claim barrier timeout'); await new Promise(r => setTimeout(r, 10)); }
    }
    let settled = null;
    if (request.settle && claim.status === 'claimed') {
      settled = await h.control.settleCommunicationIntent({ commandId: 'settle-' + id, commandType: 'CommunicationSettleIntent', schemaVersion: 1,
        aggregateId: request.intentId, expectedRevision: claim.revision, correlationId: id, submittedAt: request.at,
        identity: { projectId: request.projectId, actor: { kind: 'system', id: request.consumerId }, idempotencyKey: 'settle-' + id },
        payload: { workspaceId: request.workspaceId, consumerId: request.consumerId, leaseGeneration: claim.leaseGeneration,
          outcome: 'quarantine', reason: 'generation witness', settledAt: request.at } });
    }
    process.stdout.write(JSON.stringify({ pid: process.pid, claim, settled }));
  } else {
    const commit = h.ledger.commit.bind(h.ledger);
    h.ledger.commit = async batch => {
      if (batch.commitKind === 'communication-route-page' && request.fault === 'before_page') process.exit(86);
      const receipt = await commit(batch);
      if (batch.commitKind === 'communication-route-page' && receipt.status === 'committed' && request.fault === 'after_page') process.exit(86);
      return receipt;
    };
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await h.drive({ reason: 'process-route-recovery', maxIntents: 3 }));
    process.stdout.write(JSON.stringify({ pid: process.pid, results }));
  }
  }
} finally { await h.close(); }
