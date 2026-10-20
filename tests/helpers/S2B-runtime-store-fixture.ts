/**
 * Slice 2B BE1r Runtime/store fixture (lead decision P7).
 *
 * What it builds and through which public calls:
 *   - the shared `createB2RuntimeFixture` construction: one real RecordStore
 *     (memory or SQLite), the real accepted RoleSpec/coordination policy, the
 *     real Session owner, the real claim and the full real Runtime/Kernel wiring
 *     (`B2-runtime-fixture.ts`); this file adds no second construction;
 *   - the extra schema registrations a caller asks for (`additionalSchemas`,
 *     for example `CONTROL_RECORD_SCHEMAS` for the R4 renderer);
 *   - the live store handle (`records`), kept and exported, including across the
 *     SQLite `reopen()`;
 *   - the public activity reads through `createActivityReadModel`, bound to the
 *     live store and re-creatable over any caller-supplied store;
 *   - the goal executed-files reads through `createGoalExecutedFilesReader`,
 *     same binding, re-bound to the reopened store's handle.
 *
 * Nothing here writes a RunActivity/business fact directly: every fact comes
 * from the shared real construction or a real public service.
 */
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { GoalExecutedFilesPort } from '../../src/core/work-graph/model/decision-contracts.js';
import { createActivityReadModel, type ActivityReadPort } from '../../src/core/work-graph/views/activity-read-model.js';
import { createGoalExecutedFilesReader } from '../../src/core/work-graph/tasks/goal-executed-files-reader.js';
import type { TaskClaimFixture } from './task-claim-fixture.js';
import {
  createB2RuntimeFixture,
  type B2RuntimeFixture,
  type ScriptedReply,
} from './B2-runtime-fixture.js';
import type { TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { ClaimFixtureKind } from './task-claim-fixture.js';

/** The live store handle: the B2 fixture's records port plus 2A's ordered lookup. */
export type S2BStore = TaskClaimFixture['records'] & RecordOrderedLookupPort;

/** The two public reads the BE1r rows assert through (`ActivityReadPort` calendar + runs). */
export type S2BActivityReads = Pick<ActivityReadPort, 'readActivityCalendar' | 'readRunActivities'>;

export type S2BRuntimeStoreFixtureOptions = {
  kind?: ClaimFixtureKind;
  scriptedReplies?: readonly ScriptedReply[];
  taskBudget?: TaskBudgetV1;
  host?: RuntimeHostBindings;
  beforeReply?: (request: ModelRequest, index: number, signal: AbortSignal) => Promise<void>;
  /** Extra registrations (for example `CONTROL_RECORD_SCHEMAS` for the R4 renderer). */
  additionalSchemas?: RecordBackendSchemas;
};

export type S2BRuntimeStoreFixture = B2RuntimeFixture & {
  /** The live store handle; reassigned by `reopen()` for SQLite. */
  records: S2BStore;
  /** `createActivityReadModel` over the live store. */
  activity: S2BActivityReads;
  /** `createActivityReadModel` over any caller-supplied (possibly faulty) store. */
  activityWith(records: S2BStore, readRecordCap?: number): S2BActivityReads;
  /** `createGoalExecutedFilesReader` over the live store. */
  goalExecutedFiles: GoalExecutedFilesPort;
  /** `createGoalExecutedFilesReader` over any caller-supplied store. */
  goalExecutedFilesWith(records: S2BStore): GoalExecutedFilesPort;
};

/**
 * Real Runtime/Kernel/store fixture with the BE1r extras. The construction is
 * `createB2RuntimeFixture`'s; this wrapper keeps only the exposed store handle,
 * the optional extra schema group, the two read-model bindings and their
 * rebinding after the SQLite `reopen()`.
 */
export async function createS2BRuntimeStoreFixture(
  options: S2BRuntimeStoreFixtureOptions = {},
): Promise<S2BRuntimeStoreFixture> {
  const base = await createB2RuntimeFixture({ ...options });
  let records = base.records as S2BStore;
  const now = (): string => base.deps.now();

  /** The public activity reads over any store (test faults pass their own). */
  function activityWith(target: S2BStore, readRecordCap?: number): S2BActivityReads {
    return createActivityReadModel({ records: target, now,
      ...(readRecordCap === undefined ? {} : { readRecordCap }) });
  }
  /** The public goal executed-files reads over any store. */
  function goalExecutedFilesWith(target: S2BStore): GoalExecutedFilesPort {
    return createGoalExecutedFilesReader({ records: target });
  }

  const fixture: S2BRuntimeStoreFixture = {
    ...base,
    records,
    activity: activityWith(records),
    activityWith,
    goalExecutedFiles: goalExecutedFilesWith(records),
    goalExecutedFilesWith,
    async reopen() {
      await base.reopen();
      records = base.records as S2BStore;
      fixture.records = records;
      fixture.deps = base.deps;
      fixture.entry = base.entry;
      fixture.modelRequests = base.modelRequests;
      fixture.runtime = base.runtime;
      fixture.activity = activityWith(records);
      fixture.goalExecutedFiles = goalExecutedFilesWith(records);
    },
  };
  return fixture;
}
