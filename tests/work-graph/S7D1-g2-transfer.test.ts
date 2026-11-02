/**
 * G2-transfer-basis and G2-transfer-claims (book `7d1:2014-2015`; start rulings §5 `:1939-1940`, w4 G2-1-10).
 *
 * G2-transfer-basis reads the basis literal from the real `SessionResponsibilityBasisPort.readResponsibilityBasis`
 * (`session-facts-contracts.ts:114`) over the real world for the Goal, project and module targets: each arm is exactly
 * its own kind and fields, never `incomplete/work_responsibility_unresolved`. The named mutation that makes this row
 * red is restoring the old non-task branch in `createSessionResponsibilityBasisReader` (`plan-readers.ts`) that answers
 * `incomplete('work_responsibility_unresolved: this work link has no Task basis')`. The transfer commit itself is the
 * next row's rule (w4 G2-1-10).
 *
 * G2-transfer-claims is a service row on memory and SQLite: one transfer commit closes the old claim and opens the
 * new (read back through `sessions/read` and a refused re-link), and a claim conflict commits nothing — the source and
 * destination cards stay byte-for-byte what `sessions/read` answered before. The named mutation is `claimChanges: []` in
 * `writePrepared`, which leaves the old claim on the source and takes no new one.
 *
 * The Host's published `responsibilities` owner is not duty-wired in this tree (W's composition-root wiring); both
 * transfers therefore go through the frozen route entry: the world's `transfer` step posts the real
 * `sessions/transfer-responsibility` route with the four pins `sessions/read` answers. No builder owner and no captured
 * backend takes part.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ResponsibilityBasisV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { createSessionResponsibilityBasisReader } from '../../src/core/work-graph/tasks/plan-readers.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7D1RoleLineWorld, type S7D1RoleLineWorld } from '../helpers/S7D1-role-line-world.js';

const worlds: S7D1RoleLineWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

const moduleScope = { kind: 'region' as const, moduleRef: { projectId: S6A_SCOPE.projectId, moduleId: 's6a-core' } };
const projectScope = { kind: 'project' as const };

const linkOf = (card: Awaited<ReturnType<S7D1RoleLineWorld['readCard']>>, target: string) =>
  card.links.find(link => link.ref.relation === 'responsible' && link.ref.target.kind === target);

describe('G2-transfer-basis', () => {
  it.each(['goal', 'project', 'module'] as const)(
    'G2-transfer-basis (%s arm): the real reader answers that kind and never the unresolved basis', async arm => {
      const world = await openS7D1RoleLineWorld({ backend: 'memory' });
      worlds.push(world);
      const input = arm === 'goal' ? { sessionRef: world.lines.second.ref, target: world.targets.goal }
        : arm === 'project' ? { sessionRef: world.lines.first.ref, target: world.targets.project }
          : { sessionRef: world.lines.secretary.ref, target: world.targets.module };
      const expected: ResponsibilityBasisV1 = arm === 'goal'
        ? { kind: 'goal', goalRef: world.goalB, goalRevision: 1 }
        : arm === 'project' ? { kind: 'project', projectRef: { projectId: S6A_SCOPE.projectId } }
          : { kind: 'module', moduleRef: { projectId: S6A_SCOPE.projectId, moduleId: 's6a-core' }, catalogRevision: 1 };

      const basis = createSessionResponsibilityBasisReader(world.world.platform.disconnect.records);
      const read = await basis.readResponsibilityBasis(world.world.humanContext(), input);
      if (read.status !== 'ready') throw new Error(`the ${arm} basis is not ready: ${JSON.stringify(read)}`);
      expect(read.status).toBe('ready');
      expect(read.value.basis).toEqual(expected);
      expect(read.value.terminal).toBe(false);
      expect(read.value.writerStopped).toBe(true);
      expect(JSON.stringify(read.value.basis)).not.toContain('work_responsibility_unresolved');
    });
});

describe('G2-transfer-claims', () => {
  it.each(['memory', 'sqlite'] as const)(
    'G2-transfer-claims (%s): one commit moves the claim, and a claim conflict writes nothing', async backend => {
      const world = await openS7D1RoleLineWorld({ backend });
      worlds.push(world);

      // One transfer closes the source's adviser/project claim and opens the destination's in the same commit.
      const moved = (await world.transfer({
        from: world.lines.first, to: world.lines.second, target: world.targets.project,
        requestId: 's7d1-transfer-project',
      })).result;
      if (moved.status !== 'committed') throw new Error(`the transfer was not committed: ${JSON.stringify(moved)}`);
      expect(moved.value.from.until).not.toBeNull();
      expect(moved.value.to.since).not.toBeNull();

      const fromCard = await world.readCard(world.lines.first);
      const toCard = await world.readCard(world.lines.second);
      const fromProject = linkOf(fromCard, 'project');
      const toProject = linkOf(toCard, 'project');
      expect(fromProject?.until).not.toBeNull();
      expect(toProject?.until).toBeNull();
      expect(toProject?.since).not.toBeNull();

      // The old claim is gone and the new one is held: the source's re-link is refused by the destination's claim.
      const reopen = await world.openLink({
        line: world.lines.first, target: world.targets.project, requestId: 's7d1-transfer-project-reopen',
      });
      expect(reopen.result).toMatchObject({
        status: 'rejected', code: 'revision_conflict',
        scopeOwned: { duty: 'adviser', target: projectScope, holder: world.lines.second.ref },
      });

      // A conflict: the first adviser already holds the adviser claim on the module; the secretary's link moves to the
      // second adviser, whose new claim would need that slot. Nothing commits and both ends keep their links.
      const firstModule = await world.openLink({
        line: world.lines.first, target: world.targets.module, requestId: 's7d1-transfer-claim-module',
      });
      expect(firstModule.result.status).toBe('committed');
      const beforeSource = await world.readCard(world.lines.secretary);
      const beforeDestination = await world.readCard(world.lines.second);
      const conflict = (await world.transfer({
        from: world.lines.secretary, to: world.lines.second, target: world.targets.module,
        requestId: 's7d1-transfer-claim-conflict',
      })).result;
      expect(conflict).toMatchObject({
        status: 'rejected', code: 'revision_conflict',
        scopeOwned: { duty: 'adviser', target: moduleScope, holder: world.lines.first.ref },
      });
      expect(await world.readCard(world.lines.secretary)).toEqual(beforeSource);
      expect(await world.readCard(world.lines.second)).toEqual(beforeDestination);
    });
});
