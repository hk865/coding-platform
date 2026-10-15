/**
 * Group K2's LE4 Host-scenario support (slice 2C, spec §5.1 LE4; P8).
 *
 * Thin helpers over the REAL Host routes on the existing KE3 framework
 * (`tests/scenarios/harness.ts`) plus group K1's shared readers
 * (`tests/helpers/S2C-K-scenario-support.ts`). Every dataset is built through
 * the real public routes; no record is written directly.
 */
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { GraphHoverReadV1, TaskHoverV1 } from '../../src/contracts/work-line.js';
import type { ScriptedReply } from './B2-runtime-fixture.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, plain } from './AG2b-collaboration-fixture.js';
import type { HostScenario } from '../scenarios/harness.js';

/** The two tool-group replies a Run needs to be paused at its first safe point (2C-23's script). */
export const PAUSE_ON_SECOND_REPLY: readonly ScriptedReply[] = [
  { kind: 'calls', calls: [{ callId: 's2c-k2-g1', name: 'read', args: { path: 'src/module.ts' } }] },
  { kind: 'calls', calls: [{ callId: 's2c-k2-g2', name: 'read', args: { path: 'src/module.ts' } }] },
];

/** `graph/hover` through the live Host (the whole Goal's node set, one read). */
export function hoverGoal(h: HostScenario): Promise<ReadResult<GraphHoverReadV1>> {
  return h.post<ReadResult<GraphHoverReadV1>>('graph/hover', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
}

/** The one task hover of a Goal's hover read. */
export function taskHoverOf(hover: GraphHoverReadV1, taskId: string): TaskHoverV1 {
  const task = hover.tasks.find(candidate => candidate.task.taskId === taskId);
  if (task === undefined) throw new Error(`graph/hover: no task ${taskId}`);
  return task;
}

/** The `sessions/read` Session ref (projectId + sessionId) of a session card. */
export function sessionRefOfCard(session: { ref: { projectId: string; sessionId: string } }): SessionRef {
  return { projectId: session.ref.projectId, sessionId: session.ref.sessionId };
}
