/**
 * XWS2P XP-05 — the second workspace's analysis read, search and display.
 *
 * World: XP-02's (`XWS2P-world.ts`, memory), `M1` = `s6a-core` named
 * `first-mod` and `M2` = `second-mod` named `second-mod` with responsibility
 * `second workspace module`. Path targets and the find path branch compare the
 * workspace-projected relative path; name/summary matching keeps the whole
 * project candidate set; the card/hover `paths` are the DISPLAY path
 * (`ws/2/src`), never the internal prefix and never a bare `src`.
 *
 * Named mutations (`src/core/work-graph/views/graph-context-reader.ts:1542–:1558`):
 * 1. the name/summary branch only walks the request workspace's candidates
 *    (`catalogForWorkspace` then `matchedNodes`) → the main workspace's
 *    `graph/find('second-mod')` no longer hits `M2` (assertion 2 red);
 * 2. the path branch uses the raw needle `src` over the whole project catalog
 *    with no workspace filter → the second workspace's `graph/find('src')` hits
 *    `M1` (assertion 1 red). Restore after each.
 *
 * Reversal in the same row: `displayProjectPath` returning its input unchanged →
 * the hover path shows `/@ws:...` (assertion 3 red): display and internal paths
 * are separate.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GraphHoverReadV1 } from '../../src/contracts/work-line.js';
import type { GraphReadPageV1, NodeCardV1 } from '../../src/core/work-graph/model/graph-context-contracts.js';
import {
  addXWS2PSecondModule, xws2pModuleId, findXWS2P, lookXWS2P, openXWS2PWorld, xws2pProjectPath, type XWS2PWorld,
} from '../helpers/XWS2P-world.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan } from '../helpers/S6B1-fixture.js';

const WORLDS: XWS2PWorld[] = [];
afterEach(async () => { await Promise.allSettled(WORLDS.splice(0).map(world => world.close())); });

const moduleIdsOf = (page: GraphReadPageV1<NodeCardV1>): string[] =>
  page.items.flatMap(card => card.node.kind === 'module' && card.node.ref.moduleId !== undefined
    ? [card.node.ref.moduleId] : []);

describe('XP-05 the second workspace read, search and display', () => {
  it('looks, finds and displays the second workspace module without mixing M1', async () => {
    const world = await openXWS2PWorld();
    WORLDS.push(world);
    const setup = await addXWS2PSecondModule(world, {
      moduleId: 'second-mod', name: 'second-mod', summary: 'second workspace module' });
    expect(setup).toMatchObject({ status: 'committed' });
    const secondMod = xws2pModuleId(world.second.scope.workspaceId, 'second-mod');
    const qualified = xws2pProjectPath(world.second.scope.workspaceId, 'src');

    // 1. path target and the find path branch: the second workspace's own projection only.
    const secondLook = await lookXWS2P(world, world.second, 'src');
    expect(secondLook.status).toBe('ready');
    if (secondLook.status !== 'ready') return;
    expect(moduleIdsOf(secondLook.value)).toEqual([secondMod]);
    const secondFindSrc = await findXWS2P(world, world.second, 'src');
    expect(secondFindSrc.status).toBe('ready');
    if (secondFindSrc.status !== 'ready') return;
    expect(moduleIdsOf(secondFindSrc.value)).toContain(secondMod);
    expect(moduleIdsOf(secondFindSrc.value)).not.toContain('s6a-core');

    // 2. name and summary are matched over the whole project, from EITHER workspace.
    const nameFromMain = await findXWS2P(world, world.main, 'second-mod');
    expect(nameFromMain.status).toBe('ready');
    if (nameFromMain.status !== 'ready') return;
    expect(moduleIdsOf(nameFromMain.value)).toContain(secondMod);
    const summaryFromMain = await findXWS2P(world, world.main, 'second workspace module');
    expect(summaryFromMain.status).toBe('ready');
    if (summaryFromMain.status !== 'ready') return;
    expect(moduleIdsOf(summaryFromMain.value)).toContain(secondMod);
    const firstNameFromSecond = await findXWS2P(world, world.second, 'first-mod');
    expect(firstNameFromSecond.status).toBe('ready');
    if (firstNameFromSecond.status !== 'ready') return;
    expect(moduleIdsOf(firstNameFromSecond.value)).toContain('s6a-core');

    // 3. The hover card shows the display path: decoded workspace id, no `/@ws:` prefix.
    // `graph/hover` reads the goal's task graph, so the goal needs an adopted Plan first
    // (the world itself leaves `goals.first` plan-less; the plan adds no module or path).
    await adoptS6BPlan(s6aCardsWorkspace(world.world, S6A_SCOPE), world.world.goals.first, {
      label: 'xws2p-hover', taskIds: ['xws2p-hover'], role: S6A_WORK_ROLE.templateId });
    const hover = readyValue<GraphHoverReadV1>(await world.world.dispatch('graph/hover', world.main.ctx,
      plain(world.main.scope, { goalRef: world.world.goals.first })), 'graph/hover');
    expect(hover.modules.find(module => module.module.moduleId === secondMod)?.paths)
      .toEqual([`${world.second.scope.workspaceId}/src`]);
    expect(hover.modules.find(module => module.module.moduleId === 's6a-core')?.paths).toEqual(['src']);
    expect(qualified).toBe(`/@ws:${encodeURIComponent(world.second.scope.workspaceId)}/src`);
  }, 180_000);
});
