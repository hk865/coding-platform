/** Readable Session labels: the known SessionCard, role keys and labels, availability text and short identities. */

import type { CoreScope, SessionCard, SessionRecord, SessionRef } from '../../../app/core-http-types.js';
import type { ScopeState } from '../../state/scope-state.js';
import { sameSession } from '../../state/values.js';
import { sessionRolesForScope } from './requests.js';

/** The exact SessionCard known for a member, from a matching detail read or the
 * directory page. A wrong/missing card is a real unknown, never a blind pick. */
export function sessionCardFor(scope: ScopeState, ref: SessionRef): SessionCard | null {
  const mainRead = scope.mainSessionRead;
  if (mainRead !== null && sameSession(mainRead.session, ref))
    return mainRead.result.status === 'ready' ? mainRead.result.value : null;
  const read = scope.sessionRead;
  if (read !== null && sameSession(read.session, ref) && read.result.status === 'ready') return read.result.value;
  const found = scope.sessionFind;
  if (found !== null && found.status === 'ready') {
    return found.value.items.find(card => card.record.ref.sessionId === ref.sessionId) ?? null;
  }
  return null;
}

/** One stable lookup key for a configured Role (label lookup + disambiguation). */
export function roleConfigKey(role: SessionRecord['role']): string {
  return role.kind === 'legacy_template'
    ? `legacy:${role.templateId}@${role.templateRevision}`
    : `spec:${role.pin.ref.projectId}/${role.pin.ref.roleId}@${role.pin.ref.revision}#${role.pin.digest}`;
}
export function roleLabelsForScope(scope: CoreScope): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of sessionRolesForScope(scope)) map.set(roleConfigKey(entry.role), entry.label);
  return map;
}
/** Readable member name: trusted role-config label when supplied, else the short
 * Session id. A full identity stays in the row title / detail, never invented. */
export function memberLabel(scope: ScopeState, ref: SessionRef): string {
  const card = sessionCardFor(scope, ref);
  if (card === null) return shortIdentity(ref.sessionId);
  return roleLabelsForScope(scope.config.scope).get(roleConfigKey(card.record.role)) ?? roleLabel(card.record.role);
}

export const AVAILABILITY_LABEL: Record<SessionCard['availability'], string> = {
  idle: '待命', busy: '工作中', recoverable: '可恢复', unavailable: '不可用',
};

export function roleLabel(role: SessionRecord['role']): string {
  return role.kind === 'role_spec'
    ? `${role.pin.ref.roleId}@${String(role.pin.ref.revision)}`
    : `模板 ${role.templateId}`;
}

export const shortIdentity = (value: string): string => value.length > 28 ? `${value.slice(0, 15)}…${value.slice(-10)}` : value;
