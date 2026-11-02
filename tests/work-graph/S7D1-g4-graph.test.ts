/**
 * `G4-graph` (book :2035, `:204-210`, §3.2 item 5): `graph/look` with `relation: 'neighbours'` builds Goal↔Session
 * adjacency in both directions from the already-loaded cards. A session's open project link adds no edge, because
 * the graph has no project node.
 * Named mutation (not run here): revert the `goal` arm of `neighboursOf` to `break`; the Goal→Session edge empties
 * and the reverse edge disappears.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GraphNodeRefV1 } from '../../src/contracts/graph-context.js';
import type { GraphReadPageV1, NodeCardV1 } from '../../src/core/work-graph/model/graph-context-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { asRecord } from '../helpers/S6A-host-fixture.js';
import { openS7D1RoleLineWorld, type S7D1RoleLineWorld } from '../helpers/S7D1-role-line-world.js';

const worlds: S7D1RoleLineWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

describe('G4-graph: Goal↔Session neighbours from the loaded cards', () => {
  it('the Goal lists its linked Session, the Session lists the Goal, and its project link adds no edge', async () => {
    const lines = await openS7D1RoleLineWorld({ backend: 'memory' });
    worlds.push(lines);
    const goal = lines.world.goals.first;
    const session = { projectId: lines.lines.first.ref.projectId, sessionId: lines.lines.first.ref.sessionId };
    const opened = await lines.openLink({ line: lines.lines.first, target: { kind: 'goal', ref: goal },
      requestId: 's7d1-g4-goal-link' });
    expect(opened.result.status).toBe('committed');

    const look = async (node: GraphNodeRefV1): Promise<GraphNodeRefV1[]> => {
      const body = asRecord((await lines.world.post('graph/look', plain(lines.world.scope, {
        goalRef: goal, target: { kind: 'node', node }, relation: 'neighbours',
        page: { afterCursor: null, limit: 100 },
      }))).body);
      expect(body['status']).toBe('ready');
      const page = asRecord(body['value']) as unknown as GraphReadPageV1<NodeCardV1>;
      return page.items.map(item => item.node);
    };

    expect(await look({ kind: 'goal', ref: goal })).toContainEqual({ kind: 'session', ref: session });
    const fromSession = await look({ kind: 'session', ref: session });
    expect(fromSession).toContainEqual({ kind: 'goal', ref: goal });
    // The same Session's open responsible project link contributes no node: only its goal and task links remain.
    expect(fromSession.map(node => node.kind)).toEqual(['goal', 'task']);
  }, 120_000);
});
