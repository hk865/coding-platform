/**
 * The two ports picking injects into its callers: the read-only Session reuse verdict and the pre-claim
 * authorization check. W declares the shapes only; the reuse implementation is B's
 * (`B/session-chooser.ts`'s `createSessionChooser.reusable`, injected by the composition root) and the pre-claim
 * implementation is M's (`W/tasks/pick-authorization.ts`). W may not import B.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef } from '../../../contracts/core/identity.js';
import type { CoreError } from '../../../contracts/core/results.js';
import type { RoleBindingRefV1, TaskTriple } from '../../../contracts/dispatch.js';
import type { SessionCard } from './session-contracts.js';

export type SessionReuseVerdictV1 =
  | { reusable: true }
  | { reusable: false; because: 'workspace' | 'archived' | 'unavailable' | 'occupied' | 'role'
      | 'readonly_copy' | 'archive_requested' | 'waiting' | 'waits_incomplete' };

export interface SessionReusePortV1 {
  reusable(ctx: CoreCallContext, input: { workspaceId: string; sessionRole: RoleConfigurationRef;
    card: SessionCard }): Promise<SessionReuseVerdictV1>;
}

export type PreClaimAuthorizationVerdictV1 =
  | { verdict: 'admitted' } | { verdict: 'refused'; code: CoreError; reason: string }
  | { verdict: 'unavailable'; reason: string };

export interface PreClaimAuthorizationPortV1 {
  check(ctx: CoreCallContext, input: { task: TaskTriple; session: SessionRef; binding: RoleBindingRefV1 })
    : Promise<PreClaimAuthorizationVerdictV1>;
}
