/**
 * nr's one new route (test spec `nr-tests.frozen.md` §测试文件, `nr-build.frozen.md` §3.4 NR-06 and §3.1: the owner
 * is the published `platform.nodeCommits`, its write is `commitNode`). The table's own name pattern is
 * `binding = owner method`, `owner = <platform member>.<method>` (e.g. `tasks/requeue` → `claims.requeueTask`).
 * NR-T10 (`goals/delivery`'s secretary, then `queries/ask`) is acc's route and is not written here (reply question 1).
 *
 * Red today (7c862a02): `nodes/commit` is not in CORE_ROUTE_SPECS. Green when nr publishes the route.
 */
import { describe, expect, it } from 'vitest';
import { CORE_ROUTE_SPECS } from '../../src/app/core-routes.js';

describe('nr route table', () => {
  it('nodes/commit is a graph_write bound to nodeCommits.commitNode', () => {
    expect(Object.entries(CORE_ROUTE_SPECS).find(([suffix]) => suffix === 'nodes/commit')?.[1])
      .toEqual({ kind: 'graph_write', binding: 'commitNode', owner: 'nodeCommits.commitNode' });
  });
});
