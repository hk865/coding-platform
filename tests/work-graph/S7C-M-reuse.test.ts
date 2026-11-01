/**
 * M-reuse (`book-7c.md:1352`, H-03): a member request returns an existing idle executor line only when the line has
 * exactly one open `responsible` link, to the requested Task, and P's real `reusable` verdict (the one body over the
 * Host's directory, Session facts and responsibility owners) says it is reusable.
 *
 * The caller is FX-02's real tool-bearing Work Run (`startS7C1ToolLine`), whose accepted envelope carries
 * `create_member` and `createMember: true`; the row reads the owner result the Runtime served the model. The idle
 * candidate lines are real `sessions/create` calls with the Task's executor Role; the negatives add a second open link
 * and a link to another Task, and the same `create_member` entry has to leave them alone. Only the real tool call and
 * public reads are used.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { MemberRequestResultV1 } from '../../src/core/work-graph/tasks/member-service.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import { jsonOf, openS7C1World, startS7C1ToolLine, type S7C1World } from '../helpers/S7C-member-fixture.js';

let world: S7C1World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

/** The requested Tasks' plan assignment, read back by the owner as the executor Role. */
const EXECUTOR_ROLE = { kind: 'legacy_template' as const, templateId: 's7c-executor', templateRevision: '1' };

async function servedResult(target: S7C1World): Promise<MemberRequestResultV1> {
  const caller = target.lines.adviser;
  if (caller === null) throw new Error('S7C reuse: the world was opened without its adviser caller line');
  return jsonOf(await target.world.scripted.requests(caller), 's7c-tool-call') as MemberRequestResultV1;
}

describe('M-reuse: the exact idle executor line', () => {
  it('returns the exact idle executor line as reused', async () => {
    // The double-link candidate names the requested Task first, but it has two open links: not an exact match.
    world = await openS7C1World();
    const [first, second, third] = world.tasks;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('S7C reuse: the world has fewer than three Tasks');
    }
    const extra = await sessionOf(world.world, await createS6BLine(world.main, {
      label: 's7c-reuse-extra', role: EXECUTOR_ROLE, tasks: [second, third],
    }));
    await startS7C1ToolLine(world, { task: second });
    const extraRequest = await servedResult(world);
    expect(extraRequest.status).not.toBe('reused');
    if (extraRequest.status === 'reused') expect(extraRequest.session).not.toEqual(extra.ref);
    expect((await world.world.readSession(extra)).record.occupancy).toBeNull();
    await world.close(); world = undefined;

    // The wrong-task negative: one open link, but to a different Task; no exact line exists for the requested Task.
    world = await openS7C1World();
    const other = await sessionOf(world.world, await createS6BLine(world.main, {
      label: 's7c-reuse-other', role: EXECUTOR_ROLE, tasks: [world.tasks[0]!],
    }));
    await startS7C1ToolLine(world, { task: world.tasks[2]! });
    const otherRequest = await servedResult(world);
    expect(otherRequest.status).not.toBe('reused');
    if (otherRequest.status === 'reused') expect(otherRequest.session).not.toEqual(other.ref);
    expect((await world.world.readSession(other)).record.occupancy).toBeNull();
    await world.close(); world = undefined;

    // The exact line: one open responsible link, to the requested Task, the executor Role, idle.
    world = await openS7C1World();
    const exact = await sessionOf(world.world, await createS6BLine(world.main, {
      label: 's7c-reuse-exact', role: EXECUTOR_ROLE, tasks: [world.tasks[1]!],
    }));
    await startS7C1ToolLine(world, { task: world.tasks[1]! });
    const reused = await servedResult(world);
    expect(reused).toMatchObject({ status: 'reused' });
    if (reused.status !== 'reused') return;
    expect(reused.session).toEqual(exact.ref);
    expect(reused.operation.aggregateType).toBe('CoreOperation');
  });
});
