import type { CoreRejection } from '../../contracts/core/results.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { TaskTriple } from '../../contracts/dispatch.js';
import type { GoalSnapshot } from '../../contracts/ledger.js';
import { sameJson as sameCanonical } from '../../contracts/fingerprint.js';
import type { SessionCard } from '../../core/work-graph/model/session-contracts.js';
import type { WorkflowDependencies } from './ports.js';
import type { Binding, Owned } from './workflow.js';

export type SessionChoice =
  | { kind: 'reuse'; card: SessionCard }
  | { kind: 'create' }
  | { kind: 'waiting'; reason: string }
  | { kind: 'rejection'; rejection: CoreRejection };

export function roleReusable(card: SessionCard, workspaceId: string, binding: Binding): boolean {
  const record = card.record;
  return record.workspaceId === workspaceId
    && record.lifecycle === 'active'
    && record.health === 'available'
    && record.occupancy === null
    && sameCanonical(record.role, binding.sessionRole);
}

export function createSessionChooser(
  deps: Pick<WorkflowDependencies, 'sessions' | 'sessionFacts' | 'responsibilities'>,
) {
  /**
   * Rule 7: a readonly copy, an archive-requested or a waiting Session is never
   * chosen for NEW work or Query claims. The original yielded-wait continuation
   * claim does not pass through here and keeps its legitimate reuse.
   */
  async function chooseExcluded(owned: Owned, card: SessionCard): Promise<boolean> {
    const record = card.record;
    if (record.provenance?.kind === 'readonly_copy') return true;
    if (record.archiveRequest !== null && record.archiveRequest !== undefined) return true;
    if (deps.sessionFacts !== undefined) {
      const facts = await deps.sessionFacts.readSessionFacts(owned.ctx, {
        projectId: record.ref.projectId, sessionId: record.ref.sessionId,
      });
      if (facts.status === 'ready' && facts.value.wait !== null) return true;
    }
    return false;
  }

  /**
   * E16 (§4.1 S:799): a Task transferred to a chosen Session carries an OPEN
   * responsible link on that Session, and its next pickup is claimed there
   * first (before the hint and the directory order). Ordinary drops leave no
   * open link, so the existing `chooseSession` order stays. The lookup is only
   * attempted when the responsibility owner is installed; an unreadable target
   * page falls through to the existing selection instead of failing it.
   */
  async function responsibleSessionFor(
    owned: Owned, goal: GoalSnapshot, binding: Binding, task: TaskTriple,
  ): Promise<SessionCard | null> {
    if (deps.responsibilities === undefined) return null;
    if (deps.sessions.findSessions === undefined) return null;
    const workspaceId = goal.workspaceRef.workspaceId;
    const target = { kind: 'task' as const, ref: task };
    let cursor: string | null = null;
    for (let page = 0; page < 8; page += 1) {
      const found = await deps.sessions.findSessions(owned.ctx, {
        workspace: { projectId: owned.projectId, workspaceId },
        target,
        includeArchived: false,
        page: cursor === null ? { limit: 50 } : { limit: 50, cursor },
      });
      if (found.status !== 'ready') return null;
      for (const card of found.value.items) {
        if (!roleReusable(card, workspaceId, binding)) continue;
        const openResponsible = card.links.some((link) => link.ref.relation === 'responsible'
          && link.until === null && sameCanonical(link.ref.target, target));
        if (!openResponsible) continue;
        if (await chooseExcluded(owned, card)) continue;
        return card;
      }
      if (found.value.nextCursor === null) break;
      cursor = found.value.nextCursor;
    }
    return null;
  }

  async function chooseSession(
    owned: Owned, goal: GoalSnapshot, binding: Binding, sessionHint: SessionRef | null, task: TaskTriple | null,
  ): Promise<SessionChoice> {
    const workspaceId = goal.workspaceRef.workspaceId;
    if (task !== null) {
      const transferred = await responsibleSessionFor(owned, goal, binding, task);
      if (transferred !== null) return { kind: 'reuse', card: transferred };
    }
    if (sessionHint !== null) {
      const read = await deps.sessions.readSession(owned.ctx, sessionHint);
      if (read.status === 'ready') {
        const card = read.value;
        if (roleReusable(card, workspaceId, binding) && !await chooseExcluded(owned, card)) {
          return { kind: 'reuse', card };
        }
        if (card.record.workspaceId === workspaceId && card.record.occupancy !== null) {
          return { kind: 'waiting', reason: `the continued Session is busy with a ${card.record.occupancy.kind}` };
        }
      } else if (read.status === 'rejected' && (read.code === 'cancelled' || read.code === 'forbidden')) {
        return { kind: 'rejection', rejection: read };
      }
    }
    let cursor: string | null = null;
    for (let page = 0; page < 8; page += 1) {
      const found = await deps.sessions.findSessions(owned.ctx, {
        workspace: { projectId: owned.projectId, workspaceId },
        role: binding.sessionRole,
        includeArchived: false,
        page: cursor === null ? { limit: 50 } : { limit: 50, cursor },
      });
      if (found.status !== 'ready') {
        if (found.status === 'rejected' && (found.code === 'cancelled' || found.code === 'forbidden')) {
          return { kind: 'rejection', rejection: found };
        }
        return { kind: 'waiting', reason: 'the Session directory is not readable' };
      }
      for (const card of found.value.items) {
        if (roleReusable(card, workspaceId, binding) && !await chooseExcluded(owned, card)) {
          return { kind: 'reuse', card };
        }
      }
      if (found.value.nextCursor === null) break;
      cursor = found.value.nextCursor;
    }
    return { kind: 'create' };
  }

  return { chooseSession, responsibleSessionFor, chooseExcluded };
}
