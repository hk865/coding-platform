/**
 * B2-09 (b) / L19a helper: read the REAL `CommandRerunRequest` records through
 * the same public owner read port the composition publishes.
 *
 * The Host route table has no `command-rerun-requests/read` entry (the request
 * is only surfaced while `pending` through `decisions/queue`), so this opens the
 * owner read port over the SAME SQLite ledger and asks it for the Task's
 * requests. It never reads or writes records by hand: `records` and `lookups`
 * are the real SQLite backend, and `listRequests`/`readRequest` are the owner's
 * public read port. Rework 2 item 2: the Task-closure reader is the REQUIRED
 * production `plan-readers.readTaskClosure` over the SAME SQLite backend
 * (never an absent → open default), so a `used` request is returned as
 * recorded.
 */
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import { createCommandRerunRequestService } from '../../src/core/work-graph/tasks/command-rerun-request-service.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import { COMMAND_RERUN_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/command-rerun-request-codecs.js';
import { platformRecordSchemas } from '../state/invariants.js';

/** The invariant registry plus the CRR schemas (and its three lookup indexes). */
function crrSchemas() {
  const base = platformRecordSchemas();
  return {
    records: [...base.records, ...COMMAND_RERUN_REQUEST_RECORD_SCHEMAS.records],
    events: [...base.events, ...COMMAND_RERUN_REQUEST_RECORD_SCHEMAS.events],
    lookups: [...(base.lookups ?? []), ...(COMMAND_RERUN_REQUEST_RECORD_SCHEMAS.lookups ?? [])],
  };
}

/** One Task's requests, all states, paged to the end through the owner read port. */
export async function listCommandRerunRequests(
  database: string,
  ctx: CoreCallContext,
  workspace: WorkspaceScope,
  filter: { goalId: string; taskId: string },
): Promise<CommandRerunRequestV1[]> {
  const backend = await createSqliteRecordBackend({
    path: join(database, 'ledger.sqlite'), schemas: crrSchemas(),
  });
  try {
    const requests = createCommandRerunRequestService({
      records: backend.records,
      lookups: backend.records,
      readTaskClosure: async (_ctx, task) => readTaskClosure(backend.records,
        { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId),
      now: () => new Date().toISOString(),
      eventId: () => 'b2-09b-read-only',
    });
    const items: CommandRerunRequestV1[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page: ReadResult<{ items: CommandRerunRequestV1[]; nextCursor: string | null }> =
        await requests.listRequests(ctx, { workspace, filter,
          page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) } });
      if (page.status !== 'ready') throw new Error(`the CRR read port rejected: ${JSON.stringify(page)}`);
      items.push(...page.value.items);
      if (page.value.nextCursor === null) break;
      cursor = page.value.nextCursor;
    }
    return items;
  } finally {
    await backend.close();
  }
}
