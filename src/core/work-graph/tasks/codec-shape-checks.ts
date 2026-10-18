/**
 * The `RunRef` and `TaskTriple` field checks are shared with the strict record
 * codecs; `SessionMessageRef` keeps its own protocol here.
 *
 * The label is part of the decoded rejection reason, so the caller passes it:
 * the UCR decoder says "review task"/"review runRef", the CRR decoder says
 * "task"/"request runRef". No field, range or event rule lives here; a codec
 * still owns its own aggregate shape.
 */
import { hasOnlyKeys, isObject, nonEmpty } from './codec-fields.js';

export { runRefProblem, taskTripleProblem } from '../persistence/rework-codecs.js';

export function sessionMessageRefProblem(value: unknown, label: string): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'workspaceId', 'messageId'])
    || value['aggregateType'] !== 'SessionMessage'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId']) || !nonEmpty(value['messageId'])) {
    return `${label} must be a complete SessionMessageRef`;
  }
  return null;
}
