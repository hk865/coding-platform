// pure; G2-2's handoff imports the one rule
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { HandoffSeatFactsV1, SessionWorkLink } from '../../../contracts/core/session.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import { roleLineDutyOf } from '../../../contracts/role-lines.js';
import { openResponsibleLinkOf } from './session-availability.js';
import { openScopeLinkOf } from './session-archive-release.js';
export type SeatInheritanceV1 =
  | { kind: 'borrow'; handoff: OperationRef; source: SessionRef }
  | { kind: 'none'; reason: 'no_parent' | 'not_our_parent' | 'other_duty' | 'not_full' | 'not_first_create' };
export function residualResponsibilityOf(links: readonly SessionWorkLink[], namedTasks: readonly TaskTriple[],
  duty: PlatformDutyV1 | 'unknown'): 'task' | 'work' | 'scope' | false {
  const named = new Set(namedTasks.map((task) => canonicalKey(task)));
  const rest = links.filter((link) => link.until === null && link.ref.relation === 'responsible'
    && !(link.ref.target.kind === 'task' && named.has(canonicalKey(link.ref.target.ref))));
  const open = openResponsibleLinkOf(rest);            // the one task/work body (:288-294)
  if (open !== false) return open;
  return openScopeLinkOf(rest, duty) === false ? false : 'scope';
}
export function seatInheritanceOf(input: { parentOperation: OperationRef | null;
  operation: HandoffSeatFactsV1 | null; duty: PlatformDutyV1; sourceDuty: PlatformDutyV1 | 'unknown';
  namedTasks: readonly TaskTriple[]; sourceLinks: readonly SessionWorkLink[];
  createCommandId: string }): SeatInheritanceV1 {
  if (input.parentOperation === null) return { kind: 'none', reason: 'no_parent' };
  const operation = input.operation;
  if (operation === null || operation.action.kind !== 'handoff' || canonicalKey(operation.ref) !== canonicalKey(input.parentOperation))
    return { kind: 'none', reason: 'not_our_parent' };
  const duty = roleLineDutyOf(input.duty);
  const sourceDuty = input.sourceDuty === 'unknown' ? null : roleLineDutyOf(input.sourceDuty);
  if (duty === null || sourceDuty === null || duty !== sourceDuty) return { kind: 'none', reason: 'other_duty' };
  const firstCreate = operation.action.input.assignments.findIndex((entry) => entry.target.kind === 'create');
  const progress = firstCreate === -1 ? undefined : operation.progress.assignments[firstCreate];
  if (firstCreate === -1 || progress === undefined || progress.createInput === null || progress.createInput.commandId !== input.createCommandId)
    return { kind: 'none', reason: 'not_first_create' };
  const residual = residualResponsibilityOf(input.sourceLinks, input.namedTasks, input.sourceDuty);
  if (residual === 'task' || residual === 'work') return { kind: 'none', reason: 'not_full' };
  return { kind: 'borrow', handoff: input.parentOperation, source: operation.action.input.source };
}
