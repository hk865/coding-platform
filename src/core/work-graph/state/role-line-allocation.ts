// the one initializer; an owner never constructs the empty pool
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { ProjectScope, SessionRef } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import type { RoleLineAllocationV1, RoleLineAllocationPendingV1, RoleLineDutyV1 } from '../../../contracts/role-lines.js';
export function allocationNext(input: { projectRef: ProjectScope; duty: RoleLineDutyV1;
  current: RoleLineAllocationV1 | null; change:
  | { kind: 'reserve'; operationRef: OperationRef }
  | { kind: 'convert'; operationRef: OperationRef; sessionRef: SessionRef }
  | { kind: 'add_holder'; sessionRef: SessionRef }
  | { kind: 'cancel_reservation'; operationRef: OperationRef }
  | { kind: 'release_holder'; sessionRef: SessionRef }
  | { kind: 'move_holder'; from: SessionRef; to: SessionRef } }): RoleLineAllocationPendingV1 {
  const current = input.current;
  const holders: { sessionRef: SessionRef; since: CommitCursor | null }[] =
    (current?.holders ?? []).map((holder) => ({ ...holder }));
  let reservations: { operationRef: OperationRef; reservedAt: CommitCursor | null }[] =
    (current?.reservations ?? []).map((reservation) => ({ ...reservation }));
  const change = input.change;
  const holderKey = (session: SessionRef): string => canonicalKey(session);
  const operationKey = (operation: OperationRef): string => canonicalKey(operation);
  switch (change.kind) {
    case 'reserve':
      if (!reservations.some((entry) => operationKey(entry.operationRef) === operationKey(change.operationRef))) {
        reservations.push({ operationRef: change.operationRef, reservedAt: null });
      }
      break;
    case 'convert':
      reservations = reservations.filter((entry) => operationKey(entry.operationRef) !== operationKey(change.operationRef));
      if (!holders.some((holder) => holderKey(holder.sessionRef) === holderKey(change.sessionRef))) {
        holders.push({ sessionRef: change.sessionRef, since: null });
      }
      break;
    case 'add_holder':
      if (!holders.some((holder) => holderKey(holder.sessionRef) === holderKey(change.sessionRef))) {
        holders.push({ sessionRef: change.sessionRef, since: null });
      }
      break;
    case 'cancel_reservation':
      reservations = reservations.filter((entry) => operationKey(entry.operationRef) !== operationKey(change.operationRef));
      break;
    case 'release_holder':
      for (let index = holders.length - 1; index >= 0; index -= 1) {
        if (holderKey(holders[index]!.sessionRef) === holderKey(change.sessionRef)) holders.splice(index, 1);
      }
      break;
    case 'move_holder': {
      const fromIndex = holders.findIndex((holder) => holderKey(holder.sessionRef) === holderKey(change.from));
      const toPresent = holders.some((holder) => holderKey(holder.sessionRef) === holderKey(change.to));
      if (fromIndex !== -1 && !toPresent) {
        const [moved] = holders.splice(fromIndex, 1);
        holders.push({ sessionRef: change.to, since: moved!.since });
      }
      break;
    }
  }
  return {
    ref: { aggregateType: 'RoleLineAllocation', projectId: input.projectRef.projectId, duty: input.duty },
    revision: (current?.revision ?? 0) + 1,
    projectRef: input.projectRef,
    duty: input.duty,
    holders,
    reservations,
  };
}
