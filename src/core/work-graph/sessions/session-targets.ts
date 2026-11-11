/**
 * Shared formal target validation for Session creation and later link changes.
 *
 * A `module` target delegates to the architecture catalog's narrow
 * `readCatalogModuleFacts` seam: it proves the module belongs to the CURRENT
 * adopted catalog and returns the exact record guards the caller must join into
 * its own CAS. A `task` target is the single Goal + active accepted Plan
 * membership check R4b already owned, extracted here so creation and later
 * `linkSessionWork` use exactly one implementation. A `goal` target proves the
 * Goal is in this project and returns its revision guard; no workspace, Plan or
 * lifecycle check applies. A `project` target proves the project id only and
 * adds no guard. A WorkContext target stays `unsupported`. There is no second
 * module authority and no provider framework.
 *
 * Closing an EXISTING link does not call this module: a formerly valid target
 * may be absent now and the closure must still be recordable.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope, WorkLinkTarget } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { GoalRecordTransactionPort, RecordGuard, StoreFailure } from '../../record-store/ports.js';
import { canonicalJson, canonicalOf, type JsonValue } from '../../../contracts/fingerprint.js';
import { isRecord } from '../../../contracts/validation/common.js';
import type { catalogModuleFactsOnce } from '../architecture/catalog-service.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';

export type TargetCheck =
  | { ok: true; guards: RecordGuard[] }
  | { ok: false; rejection: CoreRejection };

function mapStoreFailure(failure: StoreFailure): CoreRejection {
  switch (failure.code) {
    case 'invalid':
      return rejected('invalid', failure.reason);
    case 'not_found':
      return rejected('not_found', failure.reason);
    case 'idempotency_conflict':
      return rejected('idempotency_conflict', failure.reason);
    case 'revision_conflict':
      return rejected('revision_conflict', failure.reason);
    case 'unique_conflict':
      return rejected('revision_conflict', failure.reason);
    case 'unsupported':
      return rejected('unsupported', failure.reason);
    case 'corrupt':
      return rejected('unavailable', `the record store reported damage: ${failure.reason}`);
    default:
      return rejected('unavailable', failure.reason);
  }
}

/** Membership of a Task in the accepted Plan body the Store already validated. */
function planContainsTask(planJson: string, projectId: string, goalId: string, taskId: string): boolean | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(planJson);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const ref = parsed['ref'];
  if (!isRecord(ref) || ref['aggregateType'] !== 'PlanRevision' || ref['projectId'] !== projectId) return false;
  const goalRef = parsed['goalRef'];
  if (!isRecord(goalRef) || goalRef['projectId'] !== projectId || goalRef['goalId'] !== goalId) return false;
  const tasks = parsed['tasks'];
  if (!Array.isArray(tasks)) return false;
  return tasks.some((task) => isRecord(task) && task['taskId'] === taskId);
}

/**
 * The one Goal record read inside `sessions`: canonical key, one `readMany`, then the existing
 * `decodeGoalSnapshot`. Both the target check and the reanchor facts call this, so no `sessions` file
 * imports `tasks`.
 */
export async function readGoalRecord(records: GoalRecordTransactionPort, goalRef: GoalRef):
  Promise<{ status: 'ready'; goal: GoalSnapshot } | CoreRejection> {
  const goalKey = canonicalJson(goalRef as unknown as JsonValue);
  const read = await records.readMany([goalKey]);
  // The same exit as `readGoal`'s `readBatch`: a Goal read answers `incomplete` for an unsupported read
  // window and `unavailable` with the code for every other non-ready answer, never the write-failure mapping.
  if (read.status !== 'ready') {
    if (read.code === 'not_found') return rejected('not_found', read.reason);
    if (read.code === 'invalid') return rejected('invalid', read.reason);
    if (read.code === 'unsupported') return rejected('incomplete', read.reason);
    return rejected('unavailable', `${read.code}: ${read.reason}`);
  }
  const record = read.value.records.find((entry) => entry.refKey === goalKey);
  if (record === undefined) return rejected('not_found', `goal ${goalRef.goalId} does not exist`);
  const decoded = decodeGoalSnapshot(record);
  if (decoded.status !== 'decoded') {
    return rejected('unavailable', `goal ${goalRef.goalId} is corrupt: ${decoded.reason}`);
  }
  return { status: 'ready', goal: decoded.value };
}

/** The Goal target read both arms use: the one shared record read, then the project equality. */
type GoalTargetFacts = { goal: GoalSnapshot; guard: RecordGuard };

async function readGoalTarget(records: GoalRecordTransactionPort, scope: WorkspaceScope, goalRef: GoalRef):
  Promise<{ ok: true; value: GoalTargetFacts } | { ok: false; rejection: CoreRejection }> {
  const no = (rejection: CoreRejection) => ({ ok: false as const, rejection });
  const goalKey = canonicalOf(goalRef);
  if (goalKey === null) return no(rejected('invalid', 'the Goal target ref cannot be canonically encoded'));
  const read = await readGoalRecord(records, goalRef);
  if (read.status !== 'ready') return no(read);
  if (read.goal.ref.projectId !== scope.projectId) return no(rejected('forbidden', 'the Goal target is foreign'));
  return { ok: true, value: { goal: read.goal, guard: { refKey: goalKey, expectedRevision: read.goal.revision } } };
}

/** Canonical Task target validation (Goal + active accepted Plan), returning the
 * exact Goal/Plan guards the caller must CAS. */
export async function validateTaskTarget(
  records: GoalRecordTransactionPort,
  scope: WorkspaceScope,
  taskRef: { projectId: string; goalId: string; taskId: string },
): Promise<TargetCheck> {
  const goal = await readGoalTarget(records, scope, {
    aggregateType: 'Goal', projectId: scope.projectId, goalId: taskRef.goalId,
  });
  if (!goal.ok) return goal;
  if (goal.value.goal.workspaceRef.projectId !== scope.projectId ||
    goal.value.goal.workspaceRef.workspaceId !== scope.workspaceId) {
    return { ok: false, rejection: rejected('forbidden', 'the Task target Goal belongs to another workspace') };
  }
  const active = goal.value.goal.activePlanRevision;
  if (active === null) {
    return { ok: false, rejection: rejected('not_found', 'the Task target Goal has no active accepted Plan revision') };
  }
  const planKey = canonicalOf(active);
  if (planKey === null) return { ok: false, rejection: rejected('invalid', 'the active Plan revision ref cannot be canonically encoded') };
  const planRead = await records.readMany([planKey]);
  if (planRead.status !== 'ready') return { ok: false, rejection: mapStoreFailure(planRead) };
  const planRecord = planRead.value.records.find((record) => record.refKey === planKey);
  if (planRecord === undefined) {
    return { ok: false, rejection: rejected('not_found', 'the active accepted Plan revision does not exist') };
  }
  const member = planContainsTask(planRecord.json, scope.projectId, taskRef.goalId, taskRef.taskId);
  if (member === null) {
    return { ok: false, rejection: rejected('unavailable', 'the active accepted Plan revision is damaged') };
  }
  if (!member) {
    return {
      ok: false,
      rejection: rejected('not_found', `the Task ${taskRef.taskId} is not a member of the active accepted Plan revision`),
    };
  }
  return {
    ok: true,
    guards: [
      goal.value.guard,
      { refKey: planKey, expectedRevision: planRecord.revision },
    ],
  };
}

/**
 * Validate one formal target and return the record guards it contributes. Only
 * an `active` activation calls this; closing an existing link never does.
 * KLS-2b A.1 #5: a module is checked in the project view of the files; `modules` is the caller's
 * `catalogModuleFactsOnce`, so the module targets of one call share one read of the files.
 */
export async function validateWorkLinkTarget(
  records: GoalRecordTransactionPort,
  ctx: CoreCallContext,
  scope: WorkspaceScope,
  target: WorkLinkTarget,
  modules: ReturnType<typeof catalogModuleFactsOnce>,
): Promise<TargetCheck> {
  if (target.ref.projectId !== scope.projectId) {
    return { ok: false, rejection: rejected('forbidden', 'the work link target belongs to another project') };
  }
  if (target.kind === 'module') {
    const facts = await modules(target.ref);
    if (facts.status === 'ready') return { ok: true, guards: [...facts.value.guards] };
    if (facts.status === 'not_found') {
      return { ok: false, rejection: rejected('not_found', `the module ${target.ref.moduleId} is not in the current formal catalog`) };
    }
    if (facts.status === 'not_ready') {
      return { ok: false, rejection: rejected('incomplete', 'the current formal catalog is not readable at the required watermark') };
    }
    return { ok: false, rejection: facts };
  }
  if (target.kind === 'goal') {
    const goal = await readGoalTarget(records, scope, target.ref);
    if (!goal.ok) return goal;
    return { ok: true, guards: [goal.value.guard] };
  }
  if (target.kind === 'project') return { ok: true, guards: [] };
  if (target.kind === 'task') return validateTaskTarget(records, scope, target.ref);
  return {
    ok: false,
    rejection: rejected('unsupported', 'a WorkContext target still has no canonical provider in this batch'),
  };
}
