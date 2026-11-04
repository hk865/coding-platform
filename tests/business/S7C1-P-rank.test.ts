/**
 * Book §5 `P-rank` (`book-7c.md:1367`; §3.2 items 2–5 `:330–410`): the six-key order, the hint absent, the filter
 * table and one real module-link key.
 *
 * The pure part calls the frozen comparator over `PickCandidateV1` literals: 1 responsible task, 2 responsible
 * module, 3 same-goal history, 4 duty (constant after the filter, so it has no field), 5 latest activity (later
 * first), 6 Session key (projectId then sessionId, ascending). `pickBasisRank` is the winner's deciding key against
 * the runner-up (LD-30); fewer than two candidates is `'none'`.
 *
 * The service part drives the real factory `chooseSession`/`reusable` over the real directory world: one `it.each`
 * holds the filter's six states (occupied, waiting, archived, readonly copy, other duty, archive request) and one
 * call proves the non-null `sessionHint` is not a ranking key while the module link (key 2) decides (A-09, DS-08).
 * Expected verdicts are the frozen `SessionReuseVerdictV1` literals, not strings copied from production.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PickBasisV1 } from '../../src/contracts/pick-basis.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import type { SessionReuseVerdictV1 } from '../../src/core/work-graph/model/pick-ports.js';
import { plainSessionRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { readGoal } from '../helpers/A2-restart-fixture.js';
import {
  S6A_GOAL_1, S6A_SCOPE, S6A_WORK_ROLE, WORKFLOW, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import {
  openS7C1DirectoryDelta, pickChooser, pickOwned, type S7C1DirectoryDeltaWorld,
} from '../helpers/S7C1-p-directory-delta.js';
import { sessionRecord } from '../helpers/S2C-line-facts-samples.js';
import {
  comparePickCandidates, firstPickKey, pickBasisRank, type PickCandidateV1,
} from '../../src/business/workflow/pick-ranking.js';

const PURE_PROJECT = 's7c1p-pure-project';

/** One SessionCard shell for the pure comparator: only the record's ref and creation time matter here. */
function pickCardOf(sessionId: string, createdAt = '2026-10-01T00:00:00.000Z',
  projectId = PURE_PROJECT): SessionCard {
  return {
    record: sessionRecord({ ref: { aggregateType: 'Session', projectId, sessionId }, createdAt }),
    availability: 'idle', links: [], recommendationReasons: [], roleFacts: null,
  };
}

function candidateOf(input: {
  sessionId: string; projectId?: string; createdAt?: string;
  responsibleTask?: boolean; responsibleModule?: boolean; sameGoalRun?: boolean;
  activityAt: string;
}): PickCandidateV1 {
  return {
    card: pickCardOf(input.sessionId, input.createdAt, input.projectId),
    responsibleTask: input.responsibleTask === true,
    responsibleModule: input.responsibleModule === true,
    sameGoalRun: input.sameGoalRun === true,
    activityAt: input.activityAt,
  };
}

const ids = (ranked: readonly PickCandidateV1[]): string[] =>
  ranked.map(candidate => candidate.card.record.ref.sessionId);

describe('P-rank: the six-key order (book-7c.md:1367)', () => {
  const table: readonly {
    what: string;
    build: () => readonly PickCandidateV1[];
    order: readonly string[];
    basis: PickBasisV1['rank'];
  }[] = [
    {
      what: 'A > B > C: keys 1, 2 and 3 decide in order',
      // A holds the task link, B the module link, C neither but a same-goal Run: each loses to the earlier key.
      build: () => [
        candidateOf({ sessionId: 's7c1p-a', responsibleTask: true, activityAt: '2026-10-01T00:00:03.000Z' }),
        candidateOf({ sessionId: 's7c1p-b', responsibleModule: true, activityAt: '2026-10-01T00:00:02.000Z' }),
        candidateOf({ sessionId: 's7c1p-c', sameGoalRun: true, activityAt: '2026-10-01T00:00:01.000Z' }),
      ],
      order: ['s7c1p-a', 's7c1p-b', 's7c1p-c'],
      basis: 'responsible_task',
    },
    {
      what: 'activity (5) is compared before the Session key (6)',
      // The later activity has the larger Session key, so only the pinned 5-before-6 order makes it win.
      build: () => [
        candidateOf({ sessionId: 's7c1p-z', activityAt: '2026-10-01T00:00:09.000Z' }),
        candidateOf({ sessionId: 's7c1p-a', activityAt: '2026-10-01T00:00:01.000Z' }),
      ],
      order: ['s7c1p-z', 's7c1p-a'],
      basis: 'latest_activity',
    },
    {
      what: 'key 3 decides alone: a same-goal Run outranks later activity',
      // Keys 1 and 2 agree; the history holder's earlier activity must not matter once key 3 decides.
      build: () => [
        candidateOf({ sessionId: 's7c1p-history', sameGoalRun: true, activityAt: '2026-10-01T00:00:01.000Z' }),
        candidateOf({ sessionId: 's7c1p-none', activityAt: '2026-10-01T00:00:09.000Z' }),
      ],
      order: ['s7c1p-history', 's7c1p-none'],
      basis: 'same_goal_history',
    },
    {
      what: 'key 6 decides by projectId before sessionId',
      // All five earlier keys agree: the smaller projectId wins although its sessionId is the larger one.
      build: () => [
        candidateOf({ sessionId: 's7c1p-a', projectId: 's7c1p-pure-project-z',
          activityAt: '2026-10-01T00:00:05.000Z' }),
        candidateOf({ sessionId: 's7c1p-z', projectId: 's7c1p-pure-project-a',
          activityAt: '2026-10-01T00:00:05.000Z' }),
      ],
      order: ['s7c1p-z', 's7c1p-a'],
      basis: 'session_key',
    },
    {
      what: 'key 6 decides by sessionId when the projectId agrees',
      // All five earlier keys agree and the projectId agrees: the smaller sessionId wins.
      build: () => [
        candidateOf({ sessionId: 's7c1p-z', activityAt: '2026-10-01T00:00:05.000Z' }),
        candidateOf({ sessionId: 's7c1p-a', activityAt: '2026-10-01T00:00:05.000Z' }),
      ],
      order: ['s7c1p-a', 's7c1p-z'],
      basis: 'session_key',
    },
  ];

  it.each(table)('$what', ({ build, order, basis }) => {
    const ranked = [...build()].sort(comparePickCandidates);
    expect(ids(ranked)).toEqual(order);
    expect(pickBasisRank(ranked)).toBe(basis);
  });
});

type Because = Extract<SessionReuseVerdictV1, { reusable: false }>['because'];

describe('P-rank: the factory filter table and the hint (book-7c.md:1367)', () => {
  let world: S7C1DirectoryDeltaWorld;

  beforeAll(async () => {
    world = await openS7C1DirectoryDelta({ backend: 'memory' });
  });
  afterAll(async () => {
    if (world !== undefined) await world.close();
  });

  const table: readonly {
    what: string; pick: (value: S7C1DirectoryDeltaWorld) => S6ASession; because: Because;
  }[] = [
    { what: 'occupied', pick: value => value.sessions.claimedNotStarted!.session, because: 'occupied' },
    // The book's plain waiting arm: one real Work wait, complete chain, no incomplete read.
    { what: 'waiting', pick: value => value.delta.waiting.session, because: 'waiting' },
    // DR-04's waiting send plus nine real forwards is the incomplete chain A-06 names: the wait read cannot prove
    // the tail, so the frozen verdict is `waits_incomplete`; the sender is never reusable either way.
    { what: 'waiting (incomplete chain)', pick: value => value.delta.wait.sender, because: 'waits_incomplete' },
    { what: 'archived', pick: value => value.delta.archived.session, because: 'archived' },
    { what: 'readonly copy', pick: value => value.sessions.readonlyCopy!.session, because: 'readonly_copy' },
    { what: 'other duty', pick: value => value.delta.otherDuty.session, because: 'role' },
    { what: 'archive requested', pick: value => value.delta.archiveRequested.session, because: 'archive_requested' },
  ];

  it.each(table)('the filter table: $what -> $because', async ({ pick, because }) => {
    const session = pick(world);
    const card = await world.world.readSession(session);
    const verdict = await pickChooser(world.world).reusable(world.ctx, {
      workspaceId: S6A_SCOPE.workspaceId, sessionRole: S6A_WORK_ROLE, card,
    });
    expect(verdict).toEqual({ reusable: false, because });
  });

  it('the hint is not a ranking key: the hinted idle card loses to the module link (A-09, DS-08)', async () => {
    const chooser = pickChooser(world.world);
    const hint = world.sessions.idlePerson!;
    const hintCard = await world.world.readSession(hint.session);
    // What today's hint branch would reuse: idle, available, the bound duty, no exclusion.
    expect(await chooser.reusable(world.ctx, {
      workspaceId: S6A_SCOPE.workspaceId, sessionRole: S6A_WORK_ROLE, card: hintCard,
    })).toEqual({ reusable: true });

    const goal = await readGoal(world.world.ag2b, S6A_GOAL_1);
    const result = await chooser.chooseSession(pickOwned(world.world), goal, WORKFLOW.bindings[0]!, hint.session.ref,
      null, 's6a-core');
    expect(result.kind).toBe('reuse');
    if (result.kind !== 'reuse') throw new Error(`P-rank: the chooser did not reuse: ${JSON.stringify(result)}`);
    expect(plainSessionRefKey(result.card.record.ref)).toBe(world.delta.moduleLinked.key);
    expect(result.basis.rank).toBe('responsible_module');
    // The directory still contains FX-03's nine-hop wait line, so the basis truthfully carries its A-06 mark.
    expect(result.basis.incomplete).toEqual(['waits']);
    // The hinted card itself still exists as a reusable candidate; it is simply not the winner.
    expect(plainSessionRefKey(result.card.record.ref)).not.toBe(plainSessionRefKey(hint.session.ref));
  });
});
