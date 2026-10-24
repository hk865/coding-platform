/**
 * The Host's `SecretaryProfilePort` over its LIVE query-profile list.
 *
 * The port is built in `A/host.ts` over a getter for the live
 * `runtimeProfiles` array, so a settings install that replaces the profiles is
 * visible to the next command without a restart; a direct platform may pass its
 * own port over the same configured list.
 *
 * `forSession` is synchronous by the frozen `SecretaryProfilePort` signature: it
 * returns the first configured profile of the workspace whose `sessionRole`
 * equals the Session's role (canonical equality, configuration order), or null.
 * It runs no duty test — whether a Session may receive a request is the duty
 * resolver's decision at admission. `forNewLine` is asynchronous and asks the
 * real resolver, because a `role_spec` profile's duty needs its pinned body.
 */
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { WorkspaceScope } from '../contracts/core/identity.js';
import type { ReadResult } from '../contracts/core/results.js';
import { sameJson } from '../contracts/fingerprint.js';
import type {
  SecretaryProfilePort, SecretaryProfileV1,
} from '../core/work-graph/model/request-contracts.js';
import type { SessionDutyResolver } from '../business/workflow/ports.js';
import type { WorkbenchQueryProfile } from './runtime-configuration.js';

export type SecretaryProfilesDependencies = {
  /** The Host's LIVE list: a settings install replaces it in place. */
  profiles(): readonly WorkbenchQueryProfile[];
  /** The real trusted duty resolver (`src/composition/session-duty.ts`). */
  duty: SessionDutyResolver;
};


function profileOf(profile: WorkbenchQueryProfile): SecretaryProfileV1 {
  return {
    profileId: profile.id,
    sessionRole: structuredClone(profile.sessionRole),
    roleBinding: structuredClone(profile.roleBinding),
    runtimeBudget: structuredClone(profile.runtimeBudget),
    budget: structuredClone(profile.budget),
    consumerId: profile.consumerId,
  };
}

function inWorkspace(profile: WorkbenchQueryProfile, workspace: WorkspaceScope): boolean {
  return profile.scope.projectId === workspace.projectId
    && profile.scope.workspaceId === workspace.workspaceId;
}

export function createSecretaryProfiles(deps: SecretaryProfilesDependencies): SecretaryProfilePort {
  return {
    forSession({ workspace, sessionRole }) {
      // The first configured profile of this workspace with the exact role.
      // Whether the Session is a secretary is admission's duty question, not
      // this lookup's.
      const match = deps.profiles().find(profile =>
        inWorkspace(profile, workspace) && sameJson(profile.sessionRole, sessionRole));
      return match === undefined ? null : profileOf(match);
    },

    async forNewLine(ctx: CoreCallContext, { workspace }): Promise<ReadResult<SecretaryProfileV1 | null>> {
      for (const profile of deps.profiles()) {
        if (!inWorkspace(profile, workspace)) continue;
        let duty;
        try {
          duty = await deps.duty(profile.sessionRole, ctx);
        } catch (error) {
          return { status: 'rejected', code: 'unavailable',
            reason: `the secretary duty read failed: ${error instanceof Error ? error.message : String(error)}` };
        }
        if (duty.status === 'rejected') {
          return { status: 'rejected', code: 'unavailable',
            reason: `the secretary duty read failed: ${duty.reason}` };
        }
        // A missing or not-ready role read is no secretary evidence either: the
        // port answers `unavailable`, never a guessed profile.
        if (duty.status !== 'ready') {
          return { status: 'rejected', code: 'unavailable',
            reason: `the secretary duty read is not available (${duty.status})` };
        }
        if (duty.value === 'secretary') return { status: 'ready', value: profileOf(profile) };
      }
      return { status: 'ready', value: null };
    },
  };
}
