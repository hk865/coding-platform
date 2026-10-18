/**
 * K3 rework 2 item 12.2 (decision 75): the ONE set of `RunRef`, `TaskTriple`
 * and `SessionMessageRef` field checks the UCR and CRR record codecs share.
 *
 * The label is part of the decoded rejection reason, so the caller passes it:
 * the UCR decoder says "review task"/"review runRef", the CRR decoder says
 * "task"/"request runRef". No field, range or event rule lives here; a codec
 * still owns its own aggregate shape.
 */
import { hasOnlyKeys, isObject, nonEmpty } from './codec-fields.js';

export function runRefProblem(value: unknown, label: string): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'runId'])
    || value['aggregateType'] !== 'Run'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return `${label} must be a complete RunRef`;
  }
  return null;
}
export function taskTripleProblem(value: unknown, label: string): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['projectId', 'goalId', 'taskId'])
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['taskId'])) {
    return `${label} must be a complete TaskTriple`;
  }
  return null;
}
export function sessionMessageRefProblem(value: unknown, label: string): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'workspaceId', 'messageId'])
    || value['aggregateType'] !== 'SessionMessage'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId']) || !nonEmpty(value['messageId'])) {
    return `${label} must be a complete SessionMessageRef`;
  }
  return null;
}
