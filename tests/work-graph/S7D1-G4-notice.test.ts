/**
 * G4-notice: `notifyProject` is the one trusted platform writer; the real `createDecisionReadModel` is built with
 * the real `createProjectNoticeSource` injected (the fixture's A4 seam). One identity called twice keeps one
 * record; a changed payload is `idempotency_conflict`; a notice before A's saved position and one after it are
 * shown only from the second in A while B (no mark behind) shows both; a missing kind, an empty summary and an
 * unknown kind are `invalid`, each with a fresh creation operation that has not written a notice. Every notice is
 * read through `decisions/queue`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NotifyProjectInputV1, ProjectNoticeV1 } from '../../src/contracts/role-lines.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import { notifyProject } from '../../src/core/work-graph/communication/project-notice-service.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { S6A_SECRETARY_ROLE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import type { S6B2Captured } from '../helpers/S6B2-handoff-scene.js';
import {
  openS7D1ProjectCardWorld, writeS7D1ProjectNotice, type S7D1ProjectNoticeStep,
} from '../helpers/S7D1-project-card-world.js';

const captured = vi.hoisted((): S6B2Captured => ({ backend: null }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const module = await importOriginal() as typeof import('../../src/core/record-store/in-memory-record-store.js');
  const { sealInMemory } = await import('../helpers/S6B2-handoff-scene.js');
  return sealInMemory(captured, module);
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const module = await importOriginal() as typeof import('../../src/core/record-store/sqlite-record-store.js');
  const { sealSqlite } = await import('../helpers/S6B2-handoff-scene.js');
  return sealSqlite(captured, module);
});

describe.each(['memory', 'sqlite'] as const)('the project notice writer and its one source (%s)', (backend) => {
  let opened: Awaited<ReturnType<typeof openS7D1ProjectCardWorld>>;
  let step: S7D1ProjectNoticeStep;
  let refusalOperation: OperationRef;
  beforeAll(async () => {
    opened = await openS7D1ProjectCardWorld({ backend });
    step = await writeS7D1ProjectNotice(opened, { captured });
    const refusalLine = await createS6BLine(opened.a, { label: 's7d1-notice-refusal', role: S6A_SECRETARY_ROLE });
    refusalOperation = ready<{ ref: OperationRef }>(await opened.a.route('sessions/operation', refusalLine.operation),
      'the refusal line creation operation').ref;
  }, 180_000);
  afterAll(async () => { await opened?.world.close(); });
  const deps = () => ({ records: step.records, now: () => opened.world.clock.now() });

  it('replays one identity, refuses a changed payload, and pages the two notices per workspace mark', async () => {
    const firstKey = `project_notice:${step.notice.ref.noticeId}`;
    // The same identity twice (step 6's write plus these replays) still yields one record.
    const replay = await notifyProject(deps(), step.noticeInput);
    expect(replay).toMatchObject({ status: 'committed', value: {
      ref: { noticeId: step.notice.ref.noticeId }, since: step.notice.since, summary: step.notice.summary } });
    expect(await notifyProject(deps(), step.noticeInput)).toMatchObject({ status: 'committed',
      value: { ref: { noticeId: step.notice.ref.noticeId } } });
    const bAfterReplay = await opened.b.readNotices({ categories: ['project_notice'] });
    expect(bAfterReplay.notices.map((notice) => notice.itemKey)).toEqual([firstKey]);

    // A changed summary under the same identity is the command executor's fingerprint conflict.
    expect(await notifyProject(deps(), { ...step.noticeInput, summary: 'a changed project notice' }))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });

    // The second notice uses another real creation operation, so it is after A's saved position.
    const second = await notifyProject(deps(), { ...step.noticeInput, operation: step.operations.adviser,
      summary: 'S7D1 G4 second project notice' });
    if (second.status !== 'committed') throw new Error(`the second notice did not commit: ${JSON.stringify(second)}`);
    const secondKey = `project_notice:${(second.value as ProjectNoticeV1).ref.noticeId}`;
    const aPage = await opened.a.readNotices({ categories: ['project_notice'] });
    const bPage = await opened.b.readNotices({ categories: ['project_notice'] });
    expect(aPage.notices.map((notice) => notice.itemKey)).toEqual([secondKey]);
    expect(bPage.notices.map((notice) => notice.itemKey)).toEqual([firstKey, secondKey]);
    // A's saved position is the first notice; B never marked, so its own mark is behind it.
    expect(step.marks.a.project_notice).toMatchObject({ kind: 'commit', itemKey: firstKey,
      cursor: step.notice.since });
  });

  it.each([
    { name: 'a missing kind', input: () => {
      const { kind: _kind, ...rest } = step.noticeInput;
      return rest as unknown as NotifyProjectInputV1;
    } },
    { name: 'an empty summary', input: () => ({ ...step.noticeInput, operation: refusalOperation, summary: '' }) },
    { name: 'an unknown kind', input: () => ({ ...step.noticeInput, operation: refusalOperation,
      kind: 'not_a_project_notice_kind' as NotifyProjectInputV1['kind'] }) },
  ])('$name is invalid and writes nothing', async ({ input }) => {
    const before = await opened.a.readNotices({ categories: ['project_notice'] });
    expect(await notifyProject(deps(), input())).toMatchObject({ status: 'rejected', code: 'invalid' });
    const after = await opened.a.readNotices({ categories: ['project_notice'] });
    expect(after.notices).toEqual(before.notices);
  });
});
