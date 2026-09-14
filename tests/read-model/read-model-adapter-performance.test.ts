import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ControlPolicyExplanation } from '../../src/control/control-engine/policy-explanation.js';
import { buildMaterialAccessGrantLedgerCommit } from '../../src/control/control-engine/records/material-access.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import { makeCommitCursor, type EventPage, type PositionedEvent } from '../../src/contracts/ledger.js';
import { materialAccessGrantIdFor, type MaterialAccessGrantedEvent } from '../../src/contracts/material-access.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { projectMaterialAccessEvent } from '../../src/data/read-model-index/material-access-projection.js';
import { ReadModelIndexImpl } from '../../src/data/read-model-index/read-model-index.js';
import { createSqliteReadModelIndex } from '../../src/data/read-model-index/sqlite-read-model-index.js';
import { buildGrantMaterialAccessCommand, buildMaterialAccessGrantV1 } from '../contract-support/fixtures/material-access-fixtures.js';

const PROJECT = 'read-model-performance';
const WORKSPACE = 'workspace';
const GOAL = 'goal';
const AT = '2026-09-14T00:00:00.000Z';
const BASIS = { planRef: null, workspaceRevision: 1, sourceDigest: null };

function digest(index: number): string {
  return index.toString(16).padStart(64, '0');
}

function eventAt(index: number): MaterialAccessGrantedEvent {
  const material: ArtifactRef = {
    kind: 'artifact',
    contentType: 'text/plain',
    digest: digest(index),
    sizeBytes: 32,
    source: { kind: 'artifact', refId: `material-${index}`, revision: '1', digest: digest(index) },
  };
  const reader: RunRef = { aggregateType: 'Run', projectId: PROJECT, goalId: GOAL, runId: `reader-${index}` };
  const grant = buildMaterialAccessGrantV1({
    grantId: materialAccessGrantIdFor(reader, [material], BASIS),
    scope: { projectId: PROJECT, workspaceId: WORKSPACE, goalId: GOAL },
    materials: [material],
    reader,
    issuedBy: { aggregateType: 'Control', projectId: PROJECT, goalId: GOAL },
    purpose: 'fixed adapter benchmark',
    basis: BASIS,
    grantedAt: AT,
  });
  const command = buildGrantMaterialAccessCommand(grant, {
    commandId: `command-${index}`,
    projectId: PROJECT,
    actorKind: 'system',
    actorId: 'benchmark',
    idempotencyKey: `idempotency-${index}`,
    correlationId: `correlation-${index}`,
    submittedAt: AT,
  });
  return buildMaterialAccessGrantLedgerCommit(command, { eventId: `event-${index}`, occurredAt: AT }).events[0]!;
}

function eventPage(count: number): EventPage {
  const events: PositionedEvent[] = Array.from({ length: count }, (_, index) => ({
    cursor: makeCommitCursor(index + 1),
    event: eventAt(index),
  }));
  return { afterCursor: null, throughCursor: events[events.length - 1]!.cursor, events, hasMore: false };
}

async function elapsed<T>(operation: () => Promise<T>): Promise<{ elapsedMs: number; value: T }> {
  const started = performance.now();
  const value = await operation();
  return { elapsedMs: performance.now() - started, value };
}

function instrumentPrepare(db: DatabaseSync): { reset(): void; count(): number } {
  const target = db as unknown as { prepare: (...args: unknown[]) => unknown };
  const original = target.prepare.bind(db);
  let prepares = 0;
  target.prepare = (...args: unknown[]) => {
    prepares += 1;
    return original(...args);
  };
  return { reset: () => { prepares = 0; }, count: () => prepares };
}

function inlineMaterialProjection(event: MaterialAccessGrantedEvent, cursor: ReturnType<typeof makeCommitCursor>) {
  const grant = event.payload.grant;
  const ref = { aggregateType: 'MaterialAccessGrant' as const, projectId: event.projectId, workspaceId: event.workspaceId, goalId: grant.scope.goalId, grantId: grant.grantId };
  return {
    kind: 'grant' as const,
    key: canonicalJson(ref),
    row: {
      ref,
      revision: event.aggregateRevision,
      grant,
      sourceCursor: cursor,
    },
  };
}

describe('read-model adapter fixed-scale performance evidence', () => {
  it('records advance, query and data-growth behavior for both adapters', async () => {
    const sizes = [64, 256, 1024];
    const rows = [];
    for (const size of sizes) {
      const page = eventPage(size);
      const selected = eventAt(size - 1);
      const memory = new ReadModelIndexImpl(new ControlPolicyExplanation());
      const memoryAdvance = await elapsed(() => memory.advance(page));
      const memoryView = await elapsed(() => memory.materialAccessGrants({ projectId: PROJECT, limit: size }));
      const memoryCandidate = await elapsed(() => memory.materialAccessCandidates({
        reader: { aggregateType: 'Run', projectId: PROJECT, goalId: GOAL, runId: `reader-${size - 1}` },
        material: selected.payload.grant.materials[0]!,
      }));

      const dir = mkdtempSync(join(tmpdir(), 'read-model-performance-'));
      const path = join(dir, 'read-model.sqlite');
      const sqlite = createSqliteReadModelIndex({ path, policyExplanation: new ControlPolicyExplanation() });
      try {
        const db = (sqlite as unknown as { db: DatabaseSync }).db;
        const counter = instrumentPrepare(db);
        const sqliteAdvance = await elapsed(() => sqlite.advance(page));
        const advancePrepareCalls = counter.count();
        counter.reset();
        const sqliteView = await elapsed(() => sqlite.materialAccessGrants({ projectId: PROJECT, limit: size }));
        const viewPrepareCalls = counter.count();
        counter.reset();
        const sqliteCandidate = await elapsed(() => sqlite.materialAccessCandidates({
          reader: { aggregateType: 'Run', projectId: PROJECT, goalId: GOAL, runId: `reader-${size - 1}` },
          material: selected.payload.grant.materials[0]!,
        }));
        const candidatePrepareCalls = counter.count();
        expect(sqliteView.value).toEqual(memoryView.value);
        expect(sqliteCandidate.value).toEqual(memoryCandidate.value);
        rows.push({
          events: size,
          memory: { advanceMs: memoryAdvance.elapsedMs, listQueryMs: memoryView.elapsedMs, candidateQueryMs: memoryCandidate.elapsedMs },
          sqlite: { advanceMs: sqliteAdvance.elapsedMs, listQueryMs: sqliteView.elapsedMs, candidateQueryMs: sqliteCandidate.elapsedMs, prepareCalls: { advance: advancePrepareCalls, listQuery: viewPrepareCalls, candidateQuery: candidatePrepareCalls } },
        });
      } finally {
        await sqlite.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }

    const sample = eventAt(0);
    const iterations = 100_000;
    let baselineValue: unknown;
    let sharedValue: unknown;
    const baselineStarted = performance.now();
    for (let index = 0; index < iterations; index++) baselineValue = inlineMaterialProjection(sample, makeCommitCursor(index + 1));
    const baselineMs = performance.now() - baselineStarted;
    const sharedStarted = performance.now();
    for (let index = 0; index < iterations; index++) sharedValue = projectMaterialAccessEvent(sample, makeCommitCursor(index + 1));
    const sharedMs = performance.now() - sharedStarted;
    expect(sharedValue).toEqual(baselineValue);

    const report = {
      fixture: { sizes, query: 'material access exact scope and candidate lookup', sqliteStorage: 'temporary file', ruleIterations: iterations },
      adapterMeasurements: rows,
      equivalentRuleBaseline: { inlineBeforeExtractionMs: baselineMs, sharedProjectionMs: sharedMs },
      measurementLimits: [
        'Wall-clock values include host filesystem and runtime scheduling noise; compare scale trends, not isolated sub-millisecond differences.',
        'SQLite prepareCalls counts prepare invocations made after construction. Constructor schema/index setup and already-prepared checkpoint statements are excluded.',
        'Database page reads are not exposed by node:sqlite, so this report does not claim physical read counts.',
      ],
      cacheDecision: 'No Redis or other cache introduced; projection authority, revocation visibility and restart behavior remain local to the committed event/read-model stores.',
    };
    if (process.env['READ_MODEL_ADAPTER_BENCHMARK_OUTPUT']) {
      writeFileSync(process.env['READ_MODEL_ADAPTER_BENCHMARK_OUTPUT'], `${JSON.stringify(report, null, 2)}\n`);
    }
    expect(rows).toHaveLength(sizes.length);
  }, 120_000);
});
