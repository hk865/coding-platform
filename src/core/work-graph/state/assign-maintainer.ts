/**
 * The assign command's one pure decision (L9; 8B-04/8B-05).
 *
 * The owner reads the target line, its duty, the module's maintainer and the module's catalog membership; this file
 * orders the frozen checks and names the write shape: open the line's own link, move the existing owner's link, or
 * refuse. The trusted caller's proof binding is checked by the owner BEFORE these facts exist, so this facts type has
 * no caller field (R-02). `maintainerOf`'s two-owner read is already an `unavailable` rejection, so no arm here picks
 * between two lines. Nothing is inferred from the maintainer read except the `from` side.
 */
import type { SessionRef, WorkLinkTarget } from '../../../contracts/core/identity.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { SessionRecord, SessionWorkLink } from '../../../contracts/core/session.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { roleLineDutyOf } from '../../../contracts/role-lines.js';

export type AssignMaintainerFactsV1 = {
  line: SessionRecord;
  duty: PlatformDutyV1 | 'unknown';
  maintainer: { status: 'none' } | { status: 'assigned'; line: SessionRef; link: SessionWorkLink };
  /** The target line's own responsible link to this module, from the real read. null = absent. */
  lineLink: SessionWorkLink | null;
  /** The existing owner line and link when `maintainer` names another line; null otherwise. */
  from: { session: SessionRecord; link: SessionWorkLink } | null;
  moduleInCatalog: boolean;
};

export type AssignMaintainerRefusalV1 = CoreRejection | { kind: 'already_owner'; link: SessionWorkLink };

export type AssignMaintainerDecisionV1 =
  | { decision: { kind: 'open'; line: SessionRecord; currentLink: SessionWorkLink | null } }
  | { decision: { kind: 'move'; from: SessionRecord; sourceLink: SessionWorkLink;
      to: SessionRecord; target: WorkLinkTarget; destinationLink: SessionWorkLink | null } }
  | { refuse: AssignMaintainerRefusalV1 };

/** The frozen order: catalog, active executor line, then the maintainer's three states. */
export function assignMaintainerDecision(facts: AssignMaintainerFactsV1): AssignMaintainerDecisionV1 {
  if (!facts.moduleInCatalog) {
    return { refuse: rejected('not_found', 'the module is not in the current catalog') };
  }
  if (facts.line.lifecycle !== 'active' || roleLineDutyOf(facts.duty) !== 'executor') {
    return { refuse: rejected('invalid', 'the maintainer line must be an active executor line') };
  }
  if (facts.maintainer.status === 'none') {
    return { decision: { kind: 'open', line: facts.line, currentLink: facts.lineLink } };
  }
  const owner = facts.maintainer.line;
  if (owner.projectId === facts.line.ref.projectId && owner.sessionId === facts.line.ref.sessionId) {
    return { refuse: { kind: 'already_owner', link: facts.maintainer.link } };
  }
  if (facts.from === null) {
    return { refuse: rejected('unavailable', 'the existing maintainer owner could not be read') };
  }
  return { decision: {
    kind: 'move',
    from: facts.from.session,
    sourceLink: facts.from.link,
    to: facts.line,
    target: facts.maintainer.link.ref.target,
    destinationLink: facts.lineLink,
  } };
}
