/**
 * The Session activity read port's scope: a caller of any principal is held to its bound project
 * before the read and to the stored Session's workspace after decoding it, as `tasks/planning-question-reader.ts`
 * does. The Session comes from the real Session operations owner of the task-claim fixture, whose records also
 * register the activity schemas (as A1-b wires them); the reader runs on them. Memory only (S3: a refusal).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_ACTIVITY_SCHEMAS, createSessionActivityReader } from '../../src/core/work-graph/sessions/session-activity.js';
import { createTaskClaimFixture, type TaskClaimFixture } from '../helpers/task-claim-fixture.js';

describe('rejects: a Session activity read outside the caller scope', () => {
  let f: TaskClaimFixture | undefined;
  afterEach(async () => { await f?.close(); f = undefined; });

  it.each([
    ['another project', { projectId: 'p-other' }, 'the Session belongs to another project'],
    ['another workspace', { workspaceId: 'w-other' }, 'the Session belongs to another workspace'],
  ] as const)('refuses a caller bound to %s', async (_name, bound, reason) => {
    f = await createTaskClaimFixture('memory', SESSION_ACTIVITY_SCHEMAS);
    const session = await f.createSession('s6b-activity-scope');
    const reader = createSessionActivityReader({ records: f.records });
    expect(await reader.readSessionActivity({ ...f.ctx, ...bound }, { session }))
      .toEqual({ status: 'rejected', code: 'forbidden', reason });
  });
});
