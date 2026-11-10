/**
 * The one copy of the member/chain line seams (frozen build §10): the line
 * identity read, the run-control submit and the requeue visibility rule.
 * Member builds it; Chain imports it from the same file. Nothing here touches
 * the DOM or a page's local state.
 */
import type { SessionRef } from '../../contracts/core/identity.js';
import type { SubmittedControl } from '../../contracts/control-intent.js';
import type { TaskRow } from '../../contracts/task-graph.js';
import type { LineControlV1, WorkLineDetailV1 } from '../../contracts/work-line.js';
import {
  committedRouteValue, createHostClient, readyRouteValue,
} from '../host-client.js';
import type { CoreScope } from '../host-client.js';
import type { LineKey } from './nav.js';

/** The Host client type the seam takes; the tree has no exported name for it. */
export type UiClient = ReturnType<typeof createHostClient>;

/** `lines/read`'s two shapes: a line, or the heads of a branched line. */
export type LineReadValue = WorkLineDetailV1 | { kind: 'branched'; heads: SessionRef[] };

/** The only `lines/read` call both pages make. */
export async function readLine(
  client: UiClient, scope: CoreScope, key: LineKey,
): Promise<LineReadValue> {
  return readyRouteValue<LineReadValue>(
    await client.post('lines/read', scope, { workspace: scope, key }), 'lines/read',
  );
}

/** The only `controls/submit` call both pages make: the control's own pins are
 * the expected versions, and the request id is made once per click. */
export async function submitRunControl(
  client: UiClient, scope: CoreScope, control: LineControlV1,
  kind: 'pause' | 'resume' | 'cancel',
): Promise<SubmittedControl> {
  const runRef = control.target.runRef;
  if (runRef === undefined) throw new Error('this control names no Run');
  return committedRouteValue<SubmittedControl>(await client.write('controls/submit', scope, {
    input: { runRef, kind, reason: null },
    meta: { requestId: crypto.randomUUID(), expected: control.pins },
  }), 'controls/submit');
}

/** X3: 重新入队 is shown only for a failed Task whose public requeue actors
 * include the person; the owner still decides. */
export function requeueVisible(task: TaskRow): boolean {
  return task.effectivePhase === 'failed'
    && (task.failure?.requeueActors ?? []).includes('human');
}
