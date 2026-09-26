/**
 * Shared formal target validation for Session creation and later link changes.
 *
 * A `module` target delegates to the architecture catalog's narrow
 * `readCatalogModuleFacts` seam: it proves the module belongs to the CURRENT
 * adopted catalog and returns the exact record guards the caller must join into
 * its own CAS. A `task` target is the single Goal + active accepted Plan
 * membership check R4b already owned, extracted here so creation and later
 * `linkSessionWork` use exactly one implementation. A WorkContext target stays
 * `unsupported`. There is no second module authority and no provider framework.
 *
 * Closing an EXISTING link does not call this module: a formerly valid target
 * may be absent now and the closure must still be recordable.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope, WorkLinkTarget } from '../../../contracts/core/identity.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { GoalRecordTransactionPort, RecordGuard, StoreFailure } from '../../record-store/ports.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { readCatalogModuleFacts } from '../architecture/catalog-service.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';

export type TargetCheck =
  | { ok: true; guards: RecordGuard[] }
  | { ok: false; rejection: CoreRejection };

type UnknownRecord = Record<string, unknown>;

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function canonicalOf(value: unknown): string | null {
  try {
    return canonicalJson(value as JsonValue);
  } catch {
    return null;
  }
}
function reject(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function mapStoreFailure(failure: StoreFailure): CoreRejection {
  switch (failure.code) {
    case 'invalid':
      return reject('invalid', failure.reason);
    case 'not_found':
      return reject('not_found', failure.reason);
    case 'idempotency_conflict':
      return reject('idempotency_conflict', failure.reason);
    case 'revision_conflict':
      return reject('revision_conflict', failure.reason);
    case 'unique_conflict':
      return reject('revision_conflict', failure.reason);
    case 'unsupported':
      return reject('unsupported', failure.reason);
    case 'corrupt':
      return reject('unavailable', `the record store reported damage: ${failure.reason}`);
    default:
      return reject('unavailable', failure.reason);
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
  if (!isObject(parsed)) return null;
  const ref = parsed['ref'];
  if (!isObject(ref) || ref['aggregateType'] !== 'PlanRevision' || ref['projectId'] !== projectId) return false;
  const goalRef = parsed['goalRef'];
  if (!isObject(goalRef) || goalRef['projectId'] !== projectId || goalRef['goalId'] !== goalId) return false;
  const tasks = parsed['tasks'];
  if (!Array.isArray(tasks)) return false;
  return tasks.some((task) => isObject(task) && task['taskId'] === taskId);
}

/** Canonical Task target validation (Goal + active accepted Plan), returning the
 * exact Goal/Plan guards the caller must CAS. */
export async function validateTaskTarget(
  records: GoalRecordTransactionPort,
  scope: WorkspaceScope,
  taskRef: { projectId: string; goalId: string; taskId: string },
): Promise<TargetCheck> {
  const goalKey = canonicalOf({ aggregateType: 'Goal', projectId: scope.projectId, goalId: taskRef.goalId });
  if (goalKey === null) return { ok: false, rejection: reject('invalid', 'the Task target Goal ref cannot be canonically encoded') };
  const goalRead = await records.readMany([goalKey]);
  if (goalRead.status !== 'ready') return { ok: false, rejection: mapStoreFailure(goalRead) };
  const goalRecord = goalRead.value.records.find((record) => record.refKey === goalKey);
  if (goalRecord === undefined) {
    return { ok: false, rejection: reject('not_found', `the Task target Goal ${taskRef.goalId} does not exist`) };
  }
  const goal = decodeGoalSnapshot(goalRecord);
  if (goal.status !== 'decoded') {
    return { ok: false, rejection: reject('unavailable', `the Task target Goal is damaged: ${goal.reason}`) };
  }
  if (goal.value.ref.projectId !== scope.projectId) {
    return { ok: false, rejection: reject('forbidden', 'the Task target Goal belongs to another project') };
  }
  if (goal.value.workspaceRef.projectId !== scope.projectId ||
    goal.value.workspaceRef.workspaceId !== scope.workspaceId) {
    return { ok: false, rejection: reject('forbidden', 'the Task target Goal belongs to another workspace') };
  }
  const active = goal.value.activePlanRevision;
  if (active === null) {
    return { ok: false, rejection: reject('not_found', 'the Task target Goal has no active accepted Plan revision') };
  }
  const planKey = canonicalOf(active);
  if (planKey === null) return { ok: false, rejection: reject('invalid', 'the active Plan revision ref cannot be canonically encoded') };
  const planRead = await records.readMany([planKey]);
  if (planRead.status !== 'ready') return { ok: false, rejection: mapStoreFailure(planRead) };
  const planRecord = planRead.value.records.find((record) => record.refKey === planKey);
  if (planRecord === undefined) {
    return { ok: false, rejection: reject('not_found', 'the active accepted Plan revision does not exist') };
  }
  const member = planContainsTask(planRecord.json, scope.projectId, taskRef.goalId, taskRef.taskId);
  if (member === null) {
    return { ok: false, rejection: reject('unavailable', 'the active accepted Plan revision is damaged') };
  }
  if (!member) {
    return {
      ok: false,
      rejection: reject('not_found', `the Task ${taskRef.taskId} is not a member of the active accepted Plan revision`),
    };
  }
  return {
    ok: true,
    guards: [
      { refKey: goalKey, expectedRevision: goalRecord.revision },
      { refKey: planKey, expectedRevision: planRecord.revision },
    ],
  };
}

/**
 * Validate one formal target and return the record guards it contributes. Only
 * an `active` activation calls this; closing an existing link never does.
 */
export async function validateWorkLinkTarget(
  records: GoalRecordTransactionPort,
  ctx: CoreCallContext,
  scope: WorkspaceScope,
  target: WorkLinkTarget,
): Promise<TargetCheck> {
  if (target.ref.projectId !== scope.projectId) {
    return { ok: false, rejection: reject('forbidden', 'the work link target belongs to another project') };
  }
  if (target.kind === 'module') {
    const facts = await readCatalogModuleFacts(records, ctx, target.ref);
    if (facts.status === 'ready') return { ok: true, guards: [...facts.value.guards] };
    if (facts.status === 'not_found') {
      return { ok: false, rejection: reject('not_found', `the module ${target.ref.moduleId} is not in the current formal catalog`) };
    }
    if (facts.status === 'not_ready') {
      return { ok: false, rejection: reject('incomplete', 'the current formal catalog is not readable at the required watermark') };
    }
    return { ok: false, rejection: facts };
  }
  if (target.kind === 'task') return validateTaskTarget(records, scope, target.ref);
  return {
    ok: false,
    rejection: reject('unsupported', 'a WorkContext target still has no canonical provider in this batch'),
  };
}
