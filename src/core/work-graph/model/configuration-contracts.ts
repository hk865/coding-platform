/** R3g role-spec slice. Memory remains a separate, unfinished operation family. */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { RoleBindingRefV1 } from '../../../contracts/dispatch.js';
import type { RoleSpecResolutionV1 } from '../../../contracts/role-spec-materials.js';
import type { ActivateRoleSpecRevisionCommand, ActivateRoleSpecRevisionReceipt,
  InstallRoleSpecRevisionCommand, InstallRoleSpecRevisionReceipt, RoleSpecPinV1,
  RoleSpecRevisionSnapshot } from '../../../contracts/role-spec.js';

export type RoleReadOptions = { atLeastCursor?: CommitCursor };

/** `ctx` is a trusted Host/tool boundary, not a substitute for per-operation
 * scope, actor and Store version checks. Only Host human/system may write. */
export interface RoleConfigurationPort {
  installRoleSpec(ctx: CoreCallContext, command: InstallRoleSpecRevisionCommand): Promise<InstallRoleSpecRevisionReceipt>;
  readRoleSpec(ctx: CoreCallContext, input: { pin: RoleSpecPinV1 },
    options?: RoleReadOptions): Promise<ReadResult<RoleSpecRevisionSnapshot>>;
  activateRoleSpec(ctx: CoreCallContext, command: ActivateRoleSpecRevisionCommand): Promise<ActivateRoleSpecRevisionReceipt>;
  /** Resolve against one stable canonical window: current CoordinationPolicy
   * matrix, exact installed RoleSpec and that role's active pointer. `absent`
   * means verified no matrix; missing schemas/facts are never `absent`.
   * declaredPermissions is a trusted Host request to check against the spec's
   * ceiling, not a grant. R4c must intersect the accepted envelope/Host grant.
   * roleBinding.policyRevision records issuance provenance; it does not grant
   * tools or supersede the current matrix/pin/active facts. */
  resolveRoleBinding(ctx: CoreCallContext, input: { roleBinding: RoleBindingRefV1;
    declaredPermissions: { tools: string[]; writeScope: string[] } }): Promise<ReadResult<RoleSpecResolutionV1>>;
}

/** Internal WorkGraph seam. Same role resolver, exact read/absence versions for
 * claim CAS; this is not a second policy implementation or an execution grant. */
export type RoleBindingFacts = {
  result: ReadResult<RoleSpecResolutionV1>;
  guards: readonly import('../../record-store/ports.js').RecordGuard[];
};
export interface RoleBindingFactsPort {
  resolveRoleBindingFacts(ctx: CoreCallContext, input: Parameters<RoleConfigurationPort['resolveRoleBinding']>[1]): Promise<RoleBindingFacts>;
}
