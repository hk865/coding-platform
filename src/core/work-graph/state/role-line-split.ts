/**
 * The role-line split planner (pure; imports only `src/contracts` and this directory). One strict-subrange proof:
 * the moved scopes are goals the line holds or child regions of a region it holds, both sides stay non-empty, and
 * every moved scope has a known burden. It never creates a module and never re-derives the too-long/too-slow flags.
 */
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import type { NoteScopeV1 } from '../../../contracts/note.js';
import type { RoleLineSplitSavedV1, RoleScopeV1 } from '../../../contracts/role-lines.js';
import { sameRef } from './ref-equality.js';
import { SCRIBE_SLOT_NOTE_LIMIT, type RoleLinePositionV1 } from './role-line-position.js';
import { regionContains } from './role-scope.js';

export function planRoleLineSplit(input: {
  line: { session: SessionRef; duty: 'adviser' | 'scribe'; scopes: readonly RoleScopeV1[] };
  positions: readonly RoleLinePositionV1[];
  catalog: AdoptedArchitecture | null;
  /** `propose_role_split`'s `move`; `null` = the planner chooses (maintenance path). */
  move: readonly RoleScopeV1[] | null;
  tooLong: boolean; tooSlow: boolean;
}): Omit<RoleLineSplitSavedV1, 'source'> | null {
  const { line, positions, catalog } = input;

  /** A goal the line holds exactly, or a region strictly inside a region the line holds; never a project. */
  function strictlyInside(scope: RoleScopeV1): boolean {
    if (scope.kind === 'goal') return line.scopes.some(held => sameRef(held, scope));
    if (scope.kind !== 'region') return false;
    const child = scope.moduleRef;
    return line.scopes.some(held => held.kind === 'region' && held.moduleRef.projectId === child.projectId
      && held.moduleRef.moduleId !== child.moduleId && regionContains(catalog, held.moduleRef.moduleId, child.moduleId));
  }

  /** The note scope a scribe position counts: `moduleId`/`goalId` against the role scope's refs. */
  function sameNoteScope(note: NoteScopeV1, scope: RoleScopeV1): boolean {
    if (note.kind === 'region') return scope.kind === 'region' && scope.moduleRef.moduleId === note.moduleId;
    if (note.kind === 'goal') return scope.kind === 'goal' && scope.goalRef.goalId === note.goalId;
    return false;
  }

  /** The duty's own position: an adviser reads goal/region positions, a scribe reads its note-count positions. */
  function burdenKnown(scope: RoleScopeV1): boolean {
    if (line.duty === 'scribe') {
      return positions.some(entry => entry.kind === 'scribe' && entry.current !== null && sameNoteScope(entry.scope, scope));
    }
    if (scope.kind === 'goal') {
      return positions.some(entry => entry.kind === 'goal' && sameRef(entry.goalRef, scope.goalRef)
        && entry.position.inProgress);
    }
    return scope.kind === 'region' && positions.some(entry => entry.kind === 'region'
      && sameRef(entry.moduleRef, scope.moduleRef) && entry.position.status !== 'unknown');
  }

  /**
   * The maintenance path's choice (`move === null`); the result still goes through the same proof. An adviser with
   * two or more goals keeps the first in `line.scopes` order and moves the rest; otherwise it moves the known child
   * region with the largest burden under one of its `descend` regions (tie: the smaller `moduleId`). A scribe over
   * `SCRIBE_SLOT_NOTE_LIMIT` moves the child module or goal with the largest known count (tie: the smaller scope key).
   */
  function chosenMove(): readonly RoleScopeV1[] | null {
    let best: { scope: RoleScopeV1; size: number; key: string } | null = null;
    const better = (size: number, key: string): boolean =>
      best === null || size > best.size || (size === best.size && key < best.key);
    if (line.duty === 'adviser') {
      const goals = line.scopes.filter(scope => scope.kind === 'goal');
      if (goals.length >= 2) return goals.slice(1);
      for (const parent of positions) {
        if (parent.kind !== 'region' || parent.position.status !== 'descend') continue;
        if (!line.scopes.some(held => held.kind === 'region' && sameRef(held.moduleRef, parent.moduleRef))) continue;
        for (const child of parent.position.children) {
          const known = positions.find(entry => entry.kind === 'region' && sameRef(entry.moduleRef, child));
          if (known?.kind !== 'region' || known.position.status === 'unknown') continue;
          if (better(known.position.burden, child.moduleId)) {
            best = { scope: { kind: 'region', moduleRef: child }, size: known.position.burden, key: child.moduleId };
          }
        }
      }
    } else {
      const over = positions.some(entry => entry.kind === 'scribe' && entry.current !== null
        && entry.current > SCRIBE_SLOT_NOTE_LIMIT && line.scopes.some(held => sameNoteScope(entry.scope, held)));
      if (!over) return null;
      for (const entry of positions) {
        if (entry.kind !== 'scribe' || entry.current === null) continue;
        const scope: RoleScopeV1 | undefined = entry.scope.kind === 'goal'
          ? line.scopes.find(held => held.kind === 'goal' && sameNoteScope(entry.scope, held))
          : entry.scope.kind === 'region'
            ? { kind: 'region', moduleRef: { projectId: line.session.projectId, moduleId: entry.scope.moduleId } }
            : undefined;
        if (scope === undefined || !strictlyInside(scope)) continue;
        const key = canonicalKey(scope);
        if (better(entry.current, key)) best = { scope, size: entry.current, key };
      }
    }
    return best === null ? null : [best.scope];
  }

  const move = input.move ?? chosenMove();
  if (move === null || move.length === 0) return null;
  if (new Set(move.map(scope => canonicalKey(scope))).size !== move.length) return null;
  if (!move.every(scope => strictlyInside(scope) && burdenKnown(scope))) return null;
  const keep = line.scopes.filter(scope => !move.some(moved => sameRef(moved, scope)));
  if (keep.length === 0) return null;
  const reason = input.move !== null ? 'agent_proposal' : input.tooLong ? 'too_long' : 'too_slow';
  return { move: [...move], keep, reason };
}
