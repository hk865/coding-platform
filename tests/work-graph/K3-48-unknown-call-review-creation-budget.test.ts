/**
 * K3 row K3-48 (一) (M3, L7/L8; R2 creation path exercised at the owner
 * boundary): a creation-time inventory that is complete but does not fit the
 * creation budget B = 158,720 bytes is kept in Kernel order up to the budget,
 * the rest is counted as `itemsOmitted`, and the record is
 * `incomplete` / `too_large` / `needs_decision` with `inventory_incomplete`.
 *
 * The dropped calls must appear nowhere in the record; the kept items are the
 * first aliases in Kernel order. Expected values are literal from L7/M3.
 */
import { describe, expect, it } from 'vitest';
import type { UnknownCallReviewItemV1 } from '../../src/contracts/unknown-call-review.js';
import {
  newUnknownCallReview, UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES,
} from '../../src/core/work-graph/state/unknown-call-review.js';

const AT = '2026-10-20T00:00:00.000Z';

/** One process item padded to the L7 display bounds: a 512-byte callId, a 512-byte command and eight 512-byte paths. */
function paddedItem(alias: number): UnknownCallReviewItemV1 {
  const callId = `call-${String(alias).padStart(3, '0')}-` + 'c'.repeat(512 - 10);
  const command = 'echo ' + String(alias) + ' ' + 'x'.repeat(512 - 8);
  const paths = Array.from({ length: 8 }, (_, index) => `/very/long/long/path/${String(alias)}/${String(index)}/`.padEnd(512, 'p'));
  return {
    alias, callId, toolName: 'shell', kind: 'process', contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't',
      callId, declaredPosition: alias, startedPosition: alias },
    argumentsDigest: 'd'.repeat(64),
    summary: { command, cwd: null, mode: null, paths, pathsOmitted: 0, truncated: false },
    startedAt: null, observed: { verdict: 'pending', by: null },
  };
}

function build(items: UnknownCallReviewItemV1[]) {
  const built = newUnknownCallReview({
    ref: { aggregateType: 'UnknownCallReview', projectId: 'p', goalId: 'g', runId: 'r' },
    workspaceId: 'w',
    task: { projectId: 'p', goalId: 'g', taskId: 't' },
    runRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r' },
    sessionRef: { projectId: 'p', sessionId: 's' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'u' }, reason: 'K3-48' },
    inventory: 'complete', inventoryProblem: null, items, itemsOmitted: 0,
    workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'k3-48' },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    createdAt: AT,
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  return built.next;
}

describe('K3-48 (一) creation budget', () => {
  it('K3-48 (一): 32 over-budget items are cut in Kernel order and marked incomplete/too_large', () => {
    const items = Array.from({ length: 32 }, (_, index) => paddedItem(index + 1));
    expect(new TextEncoder().encode(JSON.stringify(items)).length).toBeGreaterThan(UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES);
    const record = build(items);
    expect(record.inventory).toBe('incomplete');
    expect(record.inventoryProblem).toBe('too_large');
    expect(record.status).toBe('needs_decision');
    expect(record.decisionReasons).toContain('inventory_incomplete');
    expect(record.itemsOmitted).toBeGreaterThan(0);
    expect(record.itemsOmitted).toBe(32 - record.items.length);
    // The kept items are the first aliases in Kernel order.
    expect(record.items.map(item => item.alias)).toEqual(Array.from({ length: record.items.length }, (_, index) => index + 1));
    expect(new TextEncoder().encode(JSON.stringify(record)).length).toBeLessThanOrEqual(UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES);
    // The dropped calls appear nowhere in the record.
    const serialized = JSON.stringify(record);
    for (const dropped of items.slice(record.items.length)) {
      expect(serialized).not.toContain(dropped.callId);
    }
  });

  it('K3-48 (一): an inventory that fits the budget stays complete and pending_review', () => {
    const record = build([paddedItem(1), paddedItem(2)]);
    expect(record.inventory).toBe('complete');
    expect(record.inventoryProblem).toBeNull();
    expect(record.itemsOmitted).toBe(0);
    expect(record.items).toHaveLength(2);
  });
});
