/**
 * Group H (slice 2A) QE4: the HTTP route behind the real decision reads.
 *
 * QA-14 drives the REAL `CORE_ROUTE_SPECS` `decisions/queue` route through
 * `parseCoreRouteRequest` + `dispatchCoreRoute` over the REAL
 * `createPlatformCoreRouteBindings`. The decision read model is the real
 * `createDecisionReadModel` the S5 fixture composes; the 5,001 waiting cards
 * are QA-05's dataset, built through the real public mailbox/decision services
 * on both backends. The only double is the QA-14 storage wrapper (L-fixtures
 * exception 2), which makes the real records port reject reads.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import {
  createPlatformCoreRouteBindings, dispatchCoreRoute, parseCoreRouteRequest,
} from '../../src/app/core-routes.js';
import {
  GOAL_C, OPERATOR, PLAN_C1, WORKSPACE_SCOPE, openS5DecisionFixture, type S5DecisionFixture,
} from '../helpers/S5-decision-fixture.js';
import { workContext } from '../helpers/S5-user-message-support.js';
import { owners } from '../helpers/S5-application-support.js';
import { sendUserDecision, startRun, S2A_SCALE_TIMEOUT_MS } from '../helpers/S2A-queue-fixture.js';
import { failingReadRecords, S2A_ROUTE_READ_FAILURE_REASON } from '../helpers/S2A-route-storage-support.js';

const QA14_CARDS = 5_001;
const QA14_PAGE_LIMIT = 50;
/** ceil(5001 / 50), hand-computed. */
const QA14_PAGES = 101;

/** A typed real platform supplies the shape; only the composed decision read is exercised. */
const noWorkspace = {
  async resolveRoot() {
    return { status: 'rejected' as const, code: 'not_found' as const, reason: 'no route fixture workspace IO' };
  },
  async authorize() {
    return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'no route fixture workspace IO' };
  },
};

describe.each(['memory', 'sqlite'] as const)('S2A decision queue route (QE4, %s)', (kind) => {
  let f: S5DecisionFixture;
  let composed: Awaited<ReturnType<typeof createTargetPlatform>>;
  let successBindings: ReturnType<typeof createPlatformCoreRouteBindings>;
  let failingBindings: ReturnType<typeof createPlatformCoreRouteBindings>;
  /** The 5,001 sent requests' card keys, from the messages the fixture actually sent. */
  const sentKeys: string[] = [];

  beforeAll(async () => {
    f = await openS5DecisionFixture(kind, { duties: ['adviser'], operatorActor: { ...OPERATOR } });
    const cRun = (await startRun(f, 's2a-qa14-c', GOAL_C, PLAN_C1, 'c-work')).run;
    const cCtx = workContext(f, cRun);
    for (let index = 0; index < QA14_CARDS; index += 1) {
      const sent = await sendUserDecision(f, cCtx, GOAL_C, `s2a-qa14-send-${String(index)}`);
      sentKeys.push(decisionSourceKey({ kind: 'message', messageRef: sent.ref }));
    }
    composed = await createTargetPlatform({ storage: { kind: 'memory' }, workspace: noWorkspace });
    successBindings = createPlatformCoreRouteBindings({ ...composed, decisions: owners(f).reads });
    failingBindings = createPlatformCoreRouteBindings({ ...composed, decisions: owners(f, failingReadRecords(f.records)).reads });
  }, S2A_SCALE_TIMEOUT_MS);

  afterAll(async () => {
    await composed.close();
    await f.close();
  });

  const routePage = (bindings: ReturnType<typeof createPlatformCoreRouteBindings>, cursor?: string) =>
    dispatchCoreRoute(bindings, 'decisions/queue', f.ctx, parseCoreRouteRequest('decisions/queue', {
      scope: WORKSPACE_SCOPE,
      input: {
        workspace: WORKSPACE_SCOPE, goalRef: GOAL_C, sections: ['waiting_answer'],
        page: cursor === undefined ? { limit: QA14_PAGE_LIMIT } : { limit: QA14_PAGE_LIMIT, cursor },
      },
    })) as Promise<ReadResult<DecisionQueueReadV1>>;

  it('QA-14 (a) - the route returns the first page and a cursor, then pages to all 5,001 cards', async () => {
    const first = await routePage(successBindings);
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') throw new Error(`QA-14 first page was not ready: ${JSON.stringify(first)}`);
    expect(first.value.counts.waitingAnswer).toBe(QA14_CARDS);
    expect(first.value.waitingAnswer).toHaveLength(QA14_PAGE_LIMIT);
    expect(typeof first.value.nextCursor).toBe('string');

    const seen = new Set<string>();
    let total = 0;
    let pages = 0;
    let cursor: string | null = first.value.nextCursor;
    for (const card of first.value.waitingAnswer) {
      expect(seen.has(card.cardKey)).toBe(false);
      seen.add(card.cardKey);
    }
    total += first.value.waitingAnswer.length;
    pages += 1;
    while (cursor !== null) {
      const page = await routePage(successBindings, cursor);
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') throw new Error(`QA-14 continuation was not ready: ${JSON.stringify(page)}`);
      pages += 1;
      expect(page.value.counts.waitingAnswer).toBe(QA14_CARDS);
      total += page.value.waitingAnswer.length;
      for (const card of page.value.waitingAnswer) {
        expect(seen.has(card.cardKey)).toBe(false);
        seen.add(card.cardKey);
      }
      cursor = page.value.nextCursor;
    }
    expect(pages).toBe(QA14_PAGES);
    expect(total).toBe(QA14_CARDS);
    expect([...seen].sort()).toEqual([...sentKeys].sort());
  }, S2A_SCALE_TIMEOUT_MS);

  it('QA-14 (b) - a storage read failure is carried out of the route, never an empty ready queue', async () => {
    const result = await routePage(failingBindings);
    expect(result).toEqual({ status: 'rejected', code: 'unavailable', reason: S2A_ROUTE_READ_FAILURE_REASON });
  }, S2A_SCALE_TIMEOUT_MS);
});
