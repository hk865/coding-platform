/**
 * KLS-3b (test writer, decision 117): the gap row #50 of run `7d2-gapkls3b`, cell N13 of `7d2-kls3bmut` ("settleLine
 * 二次关闭", start rulings draft v2 §2.4). `settleLine` is the one writer of a line's status: it closes an open line
 * once (`merged` or `removed`), and a second call on the closed line answers `invalid` "the line is already closed"
 * instead of writing another revision. The world is `openKLS2AWorld` (a real platform over a real git root, memory):
 * the line comes from the public owner `projects.registerLine` (`registerKLS2ALine`, as the KLS-3a1 rows), and both
 * settles call the owner port directly — no Host route publishes a line's end, and the Host itself only ever judges
 * `open` lines (draft §2.4, §2.5), so this coordination guard has no route of its own. Expected values are the
 * rulings' literals: `committed` with `removed` and a non-empty `closedAt`; then `rejected`/`invalid` with the exact
 * reason. The same Workspace pin is used both times (an end writes no other record).
 *
 * Green today; the named mutation deletes the `if (facts.line.status !== 'open')` refusal
 * (`src/core/work-graph/configuration/line-service.ts:185`) — the second settle commits again (revision 3, a new
 * `closedAt`) and the row fails at the second answer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openKLS2AWorld, registerKLS2ALine, type KLS2AWorld } from '../helpers/KLS2A-knowledge-world.js';
import { must } from '../helpers/KLS3A1-gap-world.js';

const worlds: KLS2AWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

describe('KLS-3b #50 settleLine closes a line once', () => {
  it('#50 a second settleLine on the closed line is refused as already closed', async () => {
    const world = await openKLS2AWorld();
    worlds.push(world);
    must('the line', await registerKLS2ALine(world, world.root, 'kls3b-50-line'));
    const [, pin] = await world.scopePins();
    const settle = async (requestId: string) => await world.platform.projects.settleLine(world.ctx(), {
      input: { workspaceId: world.workspaceId, folder: world.root, status: 'removed' },
      meta: { requestId, expected: [pin!] },
    });
    const first = await settle('kls3b-50-first');
    if (first.status !== 'committed') throw new Error(`the first settleLine: ${JSON.stringify(first)}`);
    expect([first.value.status, typeof first.value.closedAt, first.value.closedAt !== '' && first.value.closedAt !== null])
      .toEqual(['removed', 'string', true]);
    expect(await settle('kls3b-50-second')).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'the line is already closed' });
  });
});
