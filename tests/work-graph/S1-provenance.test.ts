/**
 * Slice 1 §5.3 service row SV14: two different successors share one
 * predecessor; `findSuccessors` returns both and each trace names the
 * predecessor.
 *
 * The row opens the real Memory/SQLite backend through the B2 execution
 * fixture (`createB2ExecutionFixture`, with the extra registrations the real
 * writers need) and builds its "given" through the current public Session
 * creation entry; each successor carries an explicit current
 * continuation provenance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, WorkLinkRelation, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { SessionProvenanceV1 } from '../../src/contracts/core/session.js';
import type { SessionFactsPort } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import {
  createB2ExecutionFixture, type B2ExecutionFixture,
} from '../helpers/B2-execution-fixture.js';
import type { ClaimFixtureKind } from '../helpers/task-claim-fixture.js';
import { checkAllInvariants, invariantStoreOf, readInvariantWorld } from '../state/invariants.js';

import { s1Schemas, sessionOwners, createSession as createNewSession } from '../helpers/S1-session-facts-fixture.js';

/** Frozen service-fixture clock values (spec §5.1). */
const t0 = '2026-10-08T00:00:00.000Z';

/** The per-row registrations the real writers/readers use (G2). */
const ADDITIONAL_SCHEMAS = s1Schemas();

type Opened = {
  b2: B2ExecutionFixture;
  facts: SessionFactsPort;
  ctx: CoreCallContext;
  p: string;
  w: string;
  /** The source/predecessor Session S that holds the failed r0. */
  S: SessionRef;
  A: TaskTriple;
  createChild(
    requestId: string,
    initialLinks: { target: WorkLinkTarget; relation: WorkLinkRelation }[],
    provenance?: SessionProvenanceV1,
  ): Promise<{ ref: SessionRef; operationRef: OperationRef }>;
  assertInvariants(): Promise<void>;
};

const opened: Opened[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t0); });
afterEach(async () => {
  for (const fixture of opened.splice(0)) await fixture.b2.close(); vi.restoreAllMocks(); vi.useRealTimers();
});

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected a ready read, got ${JSON.stringify(result)}`);
  return result.value;
}

function firstPage(limit = 100) {
  return { limit };
}

async function open(kind: ClaimFixtureKind): Promise<Opened> {
  const b2 = await createB2ExecutionFixture(kind, ADDITIONAL_SCHEMAS);
  const base = b2.base;
  const facts = sessionOwners(base).facts;
  const p = base.scope.projectId;
  const w = base.scope.workspaceId;
  const S = base.sessions.first;
  const A = base.tasks.first;

  const fixture: Opened = {
    b2, facts, ctx: base.ctx, p, w, S, A,
    async createChild(requestId, initialLinks, provenanceValue) {
      return provenanceValue === undefined
        ? createNewSession(base, requestId, { initialLinks })
        : createNewSession(base, requestId, { initialLinks, provenance: provenanceValue });
    },
    async assertInvariants() {
      // The invariant world read snapshots the real SQLite ledger; the
      // in-memory backend has no ledger file to read.
      if (base.kind !== 'sqlite') return;
      const world = await readInvariantWorld(invariantStoreOf(base.directory), p);
      const violations = checkAllInvariants(world);
      expect(violations, violations.map(entry => `${entry.invariant} ${entry.message}`).join('\n')).toEqual([]);
    },
  };
  opened.push(fixture);
  return fixture;
}

describe.each(['memory', 'sqlite'] as const)('S1 current Session provenance (%s)', (kind) => {
  it('SV14 two different successors share one predecessor: findSuccessors returns both, each trace contains '
    + 'the predecessor and there is no unique conflict', async () => {
    const f = await open(kind);
    const predecessor = f.S;
    const continuation: SessionProvenanceV1 = {
      schemaVersion: 1, kind: 'continuation', from: predecessor, reason: 'interrupted', task: f.A,
    };
    const first = await f.createChild('sv14-successor-one', [], continuation);
    const second = await f.createChild('sv14-successor-two', [], continuation);
    await f.assertInvariants();
    expect(first.ref.sessionId).not.toBe(second.ref.sessionId);

    const page = ready(await f.facts.findSessionSuccessors(f.ctx, { sessionRef: predecessor, page: firstPage() }));
    expect(page.items).toHaveLength(2);
    expect(page.items.map(item => item.ref).sort((a, b) => a.sessionId.localeCompare(b.sessionId)))
      .toEqual([plainSessionRefToAggregate(first.ref), plainSessionRefToAggregate(second.ref)]
        .sort((a, b) => a.sessionId.localeCompare(b.sessionId)));
    expect(page.nextCursor).toBeNull();
    for (const item of page.items) {
      // Both successors disclose the same predecessor; the reader does not
      // collapse them into a single line head.
      expect(item.provenance).toEqual(continuation);
      expect(item.provenance).toHaveProperty('from', predecessor);
      const trace = ready(await f.facts.readSessionFacts(f.ctx,
        { projectId: item.ref.projectId, sessionId: item.ref.sessionId }));
      expect(trace.predecessor).toEqual(continuation);
    }
  });
});
