/**
 * Slice 4C-2 U7 (rework): the generic collection-backed card-source adapter.
 *
 * The adapter is the unit under test, so this file feeds it a fake collection:
 * the cache/paging and the direct by-key read are the behaviour, not the notes
 * owner. The real note card lives in `S4C2-U7.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { DecisionSubjectV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import {
  createCollectionCardSource,
  type CardCollectionSourceSpec,
} from '../../src/core/work-graph/views/decision-read-model.js';

const PROJECT = 'P';
const WORKSPACE: WorkspaceScope = { projectId: PROJECT, workspaceId: 'W' };
const GOAL: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 'g1' };
const ctx = (): CoreCallContext => ({
  projectId: PROJECT, workspaceId: 'W',
  principal: { kind: 'host', actor: { kind: 'human', id: 'operator' } },
  materialReader: { kind: 'host', projectId: PROJECT, workspaceId: 'W', actor: { kind: 'human', id: 'operator' } },
  signal: new AbortController().signal,
});

type FakeItem = { id: string; closed: boolean };

/**
 * Hand-built JCS canonical note_review key (test-local, never production), used
 * only by the fake collection's `keyOf`/`project`/`readByKey` internals:
 * `{"kind":"note_review","note":{"ref":{"aggregateType":"NoteHead","noteId":…,"projectId":"P"},"revision":1}}`.
 */
const cardKeyOf = (id: string): string =>
  `{"kind":"note_review","note":{"ref":{"aggregateType":"NoteHead","noteId":${JSON.stringify(id)},"projectId":${JSON.stringify(PROJECT)}},"revision":1}}`;

/** Hand-written literal expectations, independent of `cardKeyOf`. */
const N199_KEY = '{"kind":"note_review","note":{"ref":{"aggregateType":"NoteHead","noteId":"n199","projectId":"P"},"revision":1}}';
const N200_KEY = '{"kind":"note_review","note":{"ref":{"aggregateType":"NoteHead","noteId":"n200","projectId":"P"},"revision":1}}';
const MISSING_KEY = '{"kind":"note_review","note":{"ref":{"aggregateType":"NoteHead","noteId":"n-missing","projectId":"P"},"revision":1}}';

/** 201 items: `n0`..`n200`; `n199` is the one closed item, on page one. */
function items(): FakeItem[] {
  return Array.from({ length: 201 }, (_unused, index) => ({ id: `n${String(index)}`, closed: index === 199 }));
}

function project(item: FakeItem, subject: DecisionSubjectV1): DecisionCardV1 {
  return {
    cardKey: cardKeyOf(item.id), source: { kind: 'note_review', key: cardKeyOf(item.id),
      subject: structuredClone(subject), pins: [] },
    state: 'waiting_answer', subject: structuredClone(subject), senderSessionRef: null, requestRef: null,
    objects: [], options: [],
    answerMessageRef: null, answer: null, application: null, candidateStatus: null, staleReason: null,
    closedReason: null, readOnly: false, actions: ['answer'],
  };
}

type Harness = {
  source: ReturnType<typeof createCollectionCardSource>;
  collectionCalls: () => number;
  byKeyCalls: () => number;
};

function harness(): Harness {
  const collection = items();
  let collectionCalls = 0;
  let byKeyCalls = 0;
  const spec: CardCollectionSourceSpec<FakeItem> = {
    kind: 'note_review',
    serves: ['goal'],
    async readCollection() {
      collectionCalls += 1;
      return { status: 'ready', value: collection };
    },
    keyOf: (item) => cardKeyOf(item.id),
    project: (item, subject) => project(item, subject),
    closedReasonOf: (item) => (item.closed ? 'source_resolved' : null),
    async readByKey(_ctx, { source }) {
      byKeyCalls += 1;
      const item = collection.find((candidate) => cardKeyOf(candidate.id) === source.key);
      if (item === undefined) return { status: 'ready', value: null };
      if (item.closed) return { status: 'ready', value: { closed: 'source_resolved' } };
      return { status: 'ready', value: { item } };
    },
  };
  return {
    source: createCollectionCardSource(spec),
    collectionCalls: () => collectionCalls,
    byKeyCalls: () => byKeyCalls,
  };
}

async function page(h: Harness, cursor?: string, goalRef: GoalRef | null = GOAL,
  attempt?: { cache: Map<string, unknown> }) {
  const result = await h.source.readPage(ctx(), {
    workspace: WORKSPACE, ...(goalRef === null ? {} : { goalRef }),
    page: { limit: 200, ...(cursor === undefined ? {} : { cursor }), ...(attempt === undefined ? {} : { attempt }) },
  });
  if (result.status !== 'ready') throw new Error(`collection page is not ready: ${JSON.stringify(result)}`);
  return result.value;
}

describe('S4C2 U7 generic collection card source', () => {
  it('U7-a assembles once, pages by offset and closes an item through closedReasonOf', async () => {
    const h = harness();
    const attempt = { cache: new Map<string, unknown>() };
    const first = await page(h, undefined, GOAL, attempt);
    expect(first.availability).toBe('available');
    expect(first.items).toHaveLength(200);
    expect(first.nextCursor).toBe('200');
    expect(h.collectionCalls()).toBe(1);
    // Page one ends at n199: the close check is applied to the assembled set.
    expect(first.items[199]).toMatchObject({ cardKey: N199_KEY, state: 'closed',
      closedReason: 'source_resolved', readOnly: true, actions: [], options: [] });

    const second = await page(h, '200', GOAL, attempt);
    expect(second.items.map((card) => card.cardKey)).toEqual([N200_KEY]);
    expect(second.items[0]).toMatchObject({ state: 'waiting_answer', closedReason: null });
    expect(second.nextCursor).toBeNull();
    // The second page is served from the same attempt cache.
    expect(h.collectionCalls()).toBe(1);
  });

  it('U7-b reads item 200 by key with zero collection reads and answers not_found for a missing key', async () => {
    const h = harness();
    const found = await h.source.readByKey?.(ctx(), {
      workspace: WORKSPACE,
      source: { kind: 'note_review', key: N200_KEY, subject: { kind: 'goal', goalRef: GOAL }, pins: [] },
    });
    expect(found).toMatchObject({ status: 'ready', value: { cardKey: N200_KEY, state: 'waiting_answer' } });
    expect(h.collectionCalls()).toBe(0);
    expect(h.byKeyCalls()).toBe(1);

    const missing = await h.source.readByKey?.(ctx(), {
      workspace: WORKSPACE,
      source: { kind: 'note_review', key: MISSING_KEY, subject: { kind: 'goal', goalRef: GOAL }, pins: [] },
    });
    expect(missing).toEqual({ status: 'ready', value: null });
    expect(h.collectionCalls()).toBe(0);

    const closed = await h.source.readByKey?.(ctx(), {
      workspace: WORKSPACE,
      source: { kind: 'note_review', key: N199_KEY, subject: { kind: 'goal', goalRef: GOAL }, pins: [] },
    });
    expect(closed).toMatchObject({ status: 'ready', value: { cardKey: N199_KEY, state: 'closed',
      closedReason: 'source_resolved', readOnly: true, actions: [], options: [] } });
  });

  it('U7-c answers an empty page without a goal and never reads the collection', async () => {
    const h = harness();
    const empty = await page(h, undefined, null);
    expect(empty).toEqual({ availability: 'available', items: [], nextCursor: null, sourceCursor: null });
    expect(h.collectionCalls()).toBe(0);
  });

  it('U7-d keeps two goals in one attempt apart by the cache key', async () => {
    const h = harness();
    const attempt = { cache: new Map<string, unknown>() };
    await page(h, undefined, GOAL, attempt);
    await page(h, undefined, { ...GOAL, goalId: 'g2' }, attempt);
    expect(h.collectionCalls()).toBe(2);
    await page(h, undefined, GOAL, attempt);
    expect(h.collectionCalls()).toBe(2);
  });
});
