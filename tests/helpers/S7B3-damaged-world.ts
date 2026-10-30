/**
 * Q fixture Q2 (fixture spec v2.2 §2.3): Q1's world, then a source with a real Kernel history (none for
 * `empty`, a real `unavailable` line for `retired`), archived, with the A2 store seam for `corrupt`/`missing`/
 * `transient`; the frozen pages are `(0, position)` and `(position - 1, 1)` for `missing`.
 */
import { vi } from 'vitest';
import type { CompletedHistoryBoundaryV1 } from '../../src/core/agent-runtime/context-types.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import * as kernelStoreModule from '../../src/core/agent-runtime/kernel-store-locator.js';
import { advanceUntil, driveWorkflow } from './A2-restart-fixture.js';
import { AG2B_WORK_TASK_ID, graphWrite } from './AG2b-collaboration-fixture.js';
import { ready } from './S7A-fixture.js';
import { sendS7A2PersonMessage } from './S7A2-fixture.js';
import { withBe2KernelStoreFaults } from './S2B-be2-reconcile-support.js';
import { S6A_SCOPE, type S6ASession } from './S6A-request-fixture.js';
import { openS7BPlanningWorld, type S7BPlanningWorld } from './S7B3-planning-world.js';

export type S7B3Defect = 'corrupt' | 'missing' | 'transient' | 'empty' | 'retired' | 'none';
export type S7BDamagedWorld = { world: S7BPlanningWorld['world']; source: S6ASession; messageRef: SessionMessageRef; defect: S7B3Defect };
/** Open Q2 for one `defect`: memory, SQLite for `retired`; a failure closes the world. */
export async function openS7BDamagedWorld(input: { defect: S7B3Defect }): Promise<S7BDamagedWorld> {
  const { defect } = input;
  const active = defect === 'corrupt' || defect === 'missing' || defect === 'transient';
  let armed = false, session = '', after = 0, limit = 0;
  const decide = (read: { sessionId: string; after: number; limit: number }) => {
    const hit = armed && read.sessionId === session && read.after === after && read.limit === limit;
    if (!hit) return 'pass' as const;
    return defect === 'transient' ? 'transient' as const
      : defect === 'missing' ? 'missing' as const : 'corrupt' as const;
  };
  const real = kernelStoreModule.createKernelStoreRegistry;
  const spy = active ? vi.spyOn(kernelStoreModule, 'createKernelStoreRegistry')
    .mockImplementation(async options => withBe2KernelStoreFaults(await real(options), { read: decide })) : null;
  let planning: S7BPlanningWorld;
  try {
    planning = await openS7BPlanningWorld({ backend: defect === 'retired' ? 'sqlite' : 'memory' });
  } finally {
    spy?.mockRestore();
  }
  const { world } = planning;
  try {
    let source = planning.sessionRef;
    let messageRef = planning.messageRef;
    if (defect === 'retired') {
      source = await world.makeUnavailableSecretary('q2-retired');
      const sent = await sendS7A2PersonMessage(world, {
        label: 's7b3-damaged-retired', recipient: source.ref, goal: planning.goalRef,
      });
      messageRef = sent.ref;
    } else {
      if (defect !== 'empty') {
        await world.scripted.script(source, [{ kind: 'text', text: `S7B3 ${defect} run` }]);
        const claim = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: planning.goalRef,
          flowId: `s7b3-damaged-${defect}`, sessionHint: source.ref, kind: 'select_work',
          taskId: AG2B_WORK_TASK_ID }, 'claim_task');
        await driveWorkflow(world.ag2b, claim, { stopBefore: 'claim_task' });
      }
      const card = await world.readSession(source);
      ready<unknown>(await world.post('sessions/archive-line', graphWrite(S6A_SCOPE, {
        sessionRef: source.ref, reason: `S7B3 ${defect} source`, wait: null,
        tasks: defect === 'empty' ? [] : [{ target: { kind: 'task',
          ref: { projectId: source.ref.projectId, goalId: planning.goalRef.goalId, taskId: AG2B_WORK_TASK_ID } },
          disposition: { kind: 'drop' } }],
      }, `s7b3-archive-${defect}`, [{ ref: card.record.ref, revision: card.record.revision }])), 'the archive');
    }
    if (active) {
      const boundary = ready<CompletedHistoryBoundaryV1>(
        await world.platform.runtime.readCompletedBoundary?.(world.humanContext(), { sessionRef: source.ref }),
        'the source boundary');
      session = (await world.readSession(source)).record.kernel.kernelSessionId;
      after = defect === 'missing' ? boundary.position - 1 : 0;
      limit = defect === 'missing' ? 1 : boundary.position;
      armed = true;
    }
    return { world, source, messageRef, defect };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}
