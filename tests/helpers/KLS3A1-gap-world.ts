/**
 * KLS-3a1 gap rows (7D2 GAPKLS3A1): the local helpers the line rows use. `tests/work-graph/KLS3A1-lines.test.ts`
 * is outside this run's whitelist and does not export them, so they are copied here from its `:41-75` (same shapes)
 * instead of imported.
 */
import { expect } from 'vitest';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import { kls3a1Checkout, type KLS2AWorld } from './KLS2A-knowledge-world.js';

/** The value of a successful answer; any other answer stops the row with its body. */
export function must<T>(label: string, answer: { status: string; value?: T }): T {
  if (!['committed', 'completed', 'ready'].includes(answer.status)) throw new Error(`${label}: ${JSON.stringify(answer)}`);
  return answer.value as T;
}

/** `projects.registerLine` for the checkout at `folder`, as the Host sends it (`pins` = the pin both racers read first). */
export async function registerLine(world: KLS2AWorld, folder: string, requestId: string,
  workspaceId = world.workspaceId, pins?: readonly VersionPin[]) {
  const { line, head } = kls3a1Checkout(folder);
  const declared = pins ?? await world.scopePins(workspaceId);
  return await world.platform.projects.registerLine(world.ctx('host', workspaceId),
    { input: { workspaceId, line, forkPoint: head }, meta: { requestId, expected: [declared[1]!] } });
}

/** The line record the rulings give for a checkout (`createdAt` aside); shared by the platform and Host rows. */
export function lineRecordFor(scope: { projectId: string; workspaceId: string },
  line: { repoKey: string; folder: string; branch: string; firstCommit: string | null }, forkPoint: string | null) {
  return { ref: { aggregateType: 'Line', projectId: scope.projectId, workspaceId: scope.workspaceId,
    lineRef: JSON.stringify([scope.workspaceId, line.folder]) },
  revision: 1, ...line, forkPoint, status: 'open', createdAt: expect.any(String), closedAt: null };
}

/** The line record for `folder`, from the test's own git. */
export function expectedLine(world: KLS2AWorld, folder: string) {
  const { line, head } = kls3a1Checkout(folder);
  return lineRecordFor(world, line, head);
}
