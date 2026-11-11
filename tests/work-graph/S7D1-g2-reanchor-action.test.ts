/**
 * G2-reanchor-action (book `7d1:2016`; start rulings §5 `:1941`, L3.10/L3.11, w4 G2-1-04).
 *
 * The published action is proved at builder level: `createSessionResponsibilityService(...).reanchorSessionResponsibility`
 * over the real Host world (`openS6AHostWorld`) and the real backend captured at the A4 factory seam (`sealInMemory` /
 * `s6b2Backend`). The line and its pins are created and read through the real Host (`sessions/create`,
 * `sessions/link`, `sessions/read`); no graph-session fixture and no fabricated record.
 *
 * Two shapes over the spec's eight reasons: `human_scope_change` moves the `s6a-core` region scope to Goal 1
 * (close+open), then `standby` closes the `s6a-ui` region scope only. The named mutations are an
 * empty `moves` list in the action (nothing moves, and the store refuses the empty event commit) and a return before
 * `records.commit` (the public `sessions/read` still shows the old links).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef, VersionPin, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { SessionWorkLink } from '../../src/contracts/core/session.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import type { ReanchorInputV1 } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import {
  createSessionResponsibilityService, responsibleLinkRef,
} from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { createSessionResponsibilityBasisReader } from '../../src/core/work-graph/tasks/plan-readers.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { s6b2Backend, s6b2Duty, type S6B2Captured } from '../helpers/S6B2-handoff-scene.js';
import { openMaintainerWorld0, type MaintainerWorld } from '../helpers/S8B-maintainer-world.js';
import { knowledgeLinesFor } from '../helpers/KLS2-knowledge-lines.js';

const ADVISER_ROLE = platformRoleProfile('adviser').template;
const CORE = 's6a-core';
const UI = 's6a-ui';

const captured = vi.hoisted((): S6B2Captured => ({ backend: null }));

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const module = await importOriginal() as typeof import('../../src/core/record-store/in-memory-record-store.js');
  const { sealInMemory: seal } = await import('../helpers/S6B2-handoff-scene.js');
  return seal(captured, module);
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const module = await importOriginal() as typeof import('../../src/core/record-store/sqlite-record-store.js');
  const { sealSqlite: seal } = await import('../helpers/S6B2-handoff-scene.js');
  return seal(captured, module);
});

const worlds: S6AHostWorld[] = [];
const maintainers: MaintainerWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  for (const world of maintainers.splice(0)) await world.close().catch(() => undefined);
});

const moduleLink = (card: SessionCard, moduleId: string) =>
  card.links.find(link => link.ref.relation === 'responsible' && link.ref.target.kind === 'module'
    && link.ref.target.ref.moduleId === moduleId);

const goalLinkOf = (card: SessionCard) =>
  card.links.find(link => link.ref.relation === 'responsible' && link.ref.target.kind === 'goal');

/** A real `responsible` link on the line, through the Host's `sessions/link` with `sessions/read`'s pins. */
async function linkTarget(world: S6AHostWorld, session: SessionRef, target: WorkLinkTarget, label: string): Promise<void> {
  const card = await world.readSession(session);
  const linkRef = responsibleLinkRef(session, target);
  const answer = await world.post('sessions/link', graphWrite(S6A_SCOPE, {
    sessionRef: session, target, relation: 'responsible', active: true,
  }, `s7d1-reanchor-link-${label}`, [
    { ref: card.record.ref, revision: card.record.revision }, { ref: linkRef, revision: 0 },
  ]));
  const result = answer.body as WriteResult<SessionWorkLink>;
  if (result.status !== 'committed') throw new Error(`S7D1: the ${label} link did not commit: ${JSON.stringify(result)}`);
}

describe('G2-reanchor-action', () => {
  it.each([
    { shape: 'human_scope_change/move', reason: 'human_scope_change' as const, close: CORE, opensGoal: true },
    { shape: 'standby/close-only', reason: 'standby' as const, close: UI, opensGoal: false },
  ])('G2-reanchor-action ($shape): the action moves or closes exactly its named region scope',
    async ({ reason, close, opensGoal }) => {
      const world = await openS6AHostWorld({ backend: 'memory' });
      worlds.push(world);
      const ws = s6aCardsWorkspace(world, S6A_SCOPE);
      await governS6B(world, ws, { first: world.goals.first, second: world.goals.second });
      const line = await createS6BLine(ws, { label: 's7d1-reanchor-line', role: ADVISER_ROLE });
      const session: SessionRef = line.ref;
      const goalTarget: WorkLinkTarget = { kind: 'goal', ref: world.goals.first };
      const closeTarget: WorkLinkTarget = { kind: 'module', ref: { projectId: S6A_SCOPE.projectId, moduleId: close } };
      // A close-only shape finds another scope already open; a move shape opens the Goal itself.
      if (!opensGoal) await linkTarget(world, session, goalTarget, 'goal-precondition');
      await linkTarget(world, session, closeTarget, close);

      const owner = createSessionResponsibilityService({
        records: s6b2Backend(captured).records,
        lookups: s6b2Backend(captured).records,
        basis: createSessionResponsibilityBasisReader(s6b2Backend(captured).records,
          knowledgeLinesFor({ root: world.root, ...S6A_SCOPE, records: s6b2Backend(captured).records })),
        duty: s6b2Duty,
        now: () => world.clock.now(),
      });

      const before = await world.readSession(session);
      const closeLink = moduleLink(before, close);
      if (closeLink === undefined) throw new Error(`no ${close} link: ${JSON.stringify(before.links)}`);
      const goalRef = responsibleLinkRef(session, goalTarget);
      const request: ReanchorInputV1 = {
        session,
        close: [closeLink.ref],
        open: opensGoal ? [{ target: goalTarget }] : [],
        reason,
      };
      const pins: VersionPin[] = [
        { ref: before.record.ref, revision: before.record.revision },
        { ref: closeLink.ref, revision: closeLink.revision },
      ];
      const moved = await owner.reanchorSessionResponsibility(world.humanContext(), {
        input: request, meta: { requestId: `s7d1-reanchor-${reason}`, expected: pins },
      });
      if (moved.status !== 'committed') throw new Error(`the reanchor ${reason} was not committed: ${JSON.stringify(moved)}`);
      expect(moved.value.session.ref).toEqual(before.record.ref);
      expect(moved.value.session.revision).toBe(before.record.revision + 1);
      expect(moved.value.closed).toEqual([closeLink.ref]);
      expect(moved.value.opened).toEqual(opensGoal ? [goalRef] : []);
      expect(moved.value.owners).toEqual(opensGoal ? [{
        link: goalRef,
        claimKey: 'role-scope:{"duty":"adviser","projectId":"ag2b-collab-project","target":{"goalRef":{"aggregateType":"Goal","goalId":"ag2b-goal","projectId":"ag2b-collab-project"},"kind":"goal"}}',
      }] : []);

      const after = await world.readSession(session);
      expect(after.record.revision).toBe(before.record.revision + 1);
      expect(moduleLink(after, close)?.until).not.toBeNull();
      expect(goalLinkOf(after)?.since).not.toBeNull();
      expect(goalLinkOf(after)?.until).toBeNull();
    });
});

describe('M-09', () => {
  it('M-09 (memory): an executor reanchor projects the new module maintainer key and releases the old one', async () => {
    const world = await openMaintainerWorld0({ backend: 'memory' });
    maintainers.push(world);
    const source = world.lines.L1;
    const from = world.module('M');
    const to = world.module('M2');
    const opened = await world.link({ line: source, target: from, requestId: 'm09-open' });
    if (opened.result.status !== 'committed') throw new Error(`the M link did not commit: ${JSON.stringify(opened.result)}`);
    const before = await world.readCard(source);

    const moved = await world.platform.responsibilities.reanchorSessionResponsibility(world.ctx, {
      input: {
        session: source.ref,
        close: [opened.result.value.ref],
        open: [{ target: to }],
        reason: 'human_scope_change',
      },
      meta: {
        requestId: 'm09-reanchor',
        expected: [
          { ref: before.record.ref, revision: before.record.revision },
          { ref: opened.result.value.ref, revision: opened.result.value.revision },
        ],
      },
    });
    if (moved.status !== 'committed') throw new Error(`the M-09 reanchor was not committed: ${JSON.stringify(moved)}`);
    expect(moved.value.closed).toEqual([opened.result.value.ref]);
    expect(moved.value.owners).toEqual([{
      link: responsibleLinkRef(source.ref, to),
      claimKey: 'module-maintainer:{"moduleId":"M2","projectId":"p1"}',
    }]);

    // The old M key is released: another executor's real link open now commits, and the M2 key stays held.
    const released = await world.link({ line: world.lines.L3, target: from, requestId: 'm09-m-released' });
    expect(released.result).toMatchObject({ status: 'committed', replayed: false });
    const held = await world.link({ line: world.lines.L2, target: to, requestId: 'm09-m2-held' });
    expect(held.result).toMatchObject({ status: 'rejected', code: 'revision_conflict',
      scopeOwned: { duty: 'executor', target: { kind: 'region',
        moduleRef: { projectId: 'p1', moduleId: 'M2' } }, holder: source.ref } });
  });
});
