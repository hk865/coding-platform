/**
 * nr's one new route (test spec `nr-tests.frozen.md` §测试文件, `nr-build.frozen.md` §3.4 NR-06 and §3.1: the owner
 * is the published `platform.nodeCommits`, its write is `commitNode`). The table's own name pattern is
 * `binding = owner method`, `owner = <platform member>.<method>` (e.g. `tasks/requeue` → `claims.requeueTask`).
 *
 * acc adds its two delivery routes and ACC-T07's existing `queries/ask` route row here (`acc-build.frozen.md`
 * §3.5, [ACC-15]; `acc-tests.frozen.md:44`): the read joins the Goal display, the current GoalPhase and the duty
 * recipient; the write is the person's confirmation record.
 *
 * The rows: nr's `nodes/commit`, and acc's `goals/delivery`, `goals/accept-delivery` and `queries/ask` (ACC-T07's
 * action), each bound in CORE_ROUTE_SPECS like the other core routes.
 */
import { describe, expect, it } from 'vitest';
import { CORE_ROUTE_SPECS } from '../../src/app/core-routes.js';

describe('nr route table', () => {
  it('nodes/commit is a graph_write bound to nodeCommits.commitNode', () => {
    expect(Object.entries(CORE_ROUTE_SPECS).find(([suffix]) => suffix === 'nodes/commit')?.[1])
      .toEqual({ kind: 'graph_write', binding: 'commitNode', owner: 'nodeCommits.commitNode' });
  });
});

const specOf = (suffix: string): unknown =>
  Object.entries(CORE_ROUTE_SPECS).find(([name]) => name === suffix)?.[1];

type RouteSpec = { kind: string; binding: string; owner: string };
const ACC_ROUTES: ReadonlyArray<readonly [string, RouteSpec]> = [
  ['queries/ask', { kind: 'plain', binding: 'askLine', owner: 'workflow.askLine' }],
  ['goals/delivery', { kind: 'plain', binding: 'readGoalDelivery', owner: 'delivery.readGoalDelivery' }],
  ['goals/accept-delivery',
    { kind: 'graph_write', binding: 'acceptGoalDelivery', owner: 'goalDelivery.acceptDelivery' }],
];

describe('acc route table', () => {
  it.each(ACC_ROUTES)('%s is bound like the other core routes', (suffix, expected) => {
    expect(specOf(suffix)).toEqual(expected);
  });
});
