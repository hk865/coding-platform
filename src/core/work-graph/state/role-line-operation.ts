/**
 * 7D2 O1b (v4 §2.2 item 3): the `role_line` operation's pure step machine and identities. The step table is exactly
 * `pending→reserved→created→registered→linked→done`, with `failed` from every non-terminal state; the split's
 * `planned→admitted→created→linked→done` table is O1b's `role-line-operations.ts`. The vocabulary is O1a's
 * `role-line-action.ts` (TS-10 item 3: this file imports only contracts and state).
 */
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { RoleLineActionV1, RoleLineStepStateV1 } from './role-line-action.js';

export const START_LINES_PHASES = ['reserve', 'create', 'register', 'link', 'done', 'waiting', 'failed'] as const;
export const ROLE_LINE_CHANGE_SCOPE_PHASE = 'change_scope';

const STEP_NEXT: Readonly<Record<RoleLineStepStateV1, readonly RoleLineStepStateV1[]>> = {
  pending: ['reserved', 'failed'], reserved: ['created', 'failed'], created: ['registered', 'failed'],
  registered: ['linked', 'failed'], linked: ['done', 'failed'], done: [], failed: [] };

export function roleLineOperationRef(projectId: string, commandKey: string, commandId: string): OperationRef {
  const digest = sha256Hex(canonicalJson({ projectId, commandKey, commandId } as unknown as JsonValue));
  return { aggregateType: 'CoreOperation', projectId, operationId: `role-line-${digest}` };
}
export function roleLineChildCommandId(operationId: string, key: string): string {
  return `${operationId}:${key}`;
}
/** One step move. A split's seat reservation is its `admitted` (v4 :2528, :3255; O2B-R1-04): `reserved` on a
 *  `planned` split moves the action's phase with it, in the same write. */
export function roleLineStepTransition(action: RoleLineActionV1, index: number,
  next: { state: RoleLineStepStateV1; childOperation?: OperationRef | null }):
  { ok: true; action: RoleLineActionV1 } | { ok: false; reason: string } {
  const step = action.steps[index];
  if (step === undefined) return { ok: false, reason: 'the step does not exist' };
  if (!STEP_NEXT[step.state].includes(next.state)) return { ok: false, reason: `${step.state}->${next.state}` };
  const steps = action.steps.map((entry, at) => at === index
    ? { ...entry, state: next.state, ...(next.childOperation === undefined ? {} : { childOperation: next.childOperation }) }
    : entry);
  const admitted = action.action === 'role_line_split' && action.phase === 'planned' && next.state === 'reserved';
  return { ok: true, action: { ...action, ...(admitted ? { phase: 'admitted' } : {}), steps } };
}
