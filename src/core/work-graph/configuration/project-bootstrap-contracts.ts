/**
 * R5a Project/Workspace registration and CompletionPolicy configuration ports.
 *
 * These two small ports are the only missing domain writers for a fresh Store:
 * a trusted Host creates the first Project, registers Workspaces and installs /
 * activates a project's CompletionPolicy. They group existing WorkGraph
 * configuration operations; they are NOT a new platform manager and hold no
 * business state machine of their own.
 *
 * `GraphWrite`, `CoreCallContext`, `WriteResult`, `WorkspaceScope` and the
 * Snapshot/Pin shapes are imported from their existing owners and are never
 * restated here.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type {
  CompletionPolicyContentV1,
  CompletionPolicyPin,
  CompletionPolicyRevisionSnapshot,
  ProjectCompletionPolicyActiveSnapshot,
} from '../../../contracts/governance.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { GraphWrite } from '../tasks/contracts.js';

/**
 * Trusted Host Project/Workspace registration.
 *
 * `ctx.projectId` is the operation scope; it starts the scope chain because
 * creating a Project is the one operation that cannot require an existing
 * Project record. `registerWorkspace` additionally requires `ctx.workspaceId`
 * to equal `input.workspace.workspaceId` and the same project. Registering a
 * Workspace records an authorized domain registration; it does not open the
 * directory, create it, clone a repository or touch Host root mapping.
 */
export interface ProjectRegistrationPort {
  createProject(
    ctx: CoreCallContext,
    request: GraphWrite<{ projectId: string }>,
  ): Promise<WriteResult<ProjectSnapshot>>;
  registerWorkspace(
    ctx: CoreCallContext,
    request: GraphWrite<{ workspace: WorkspaceScope }>,
  ): Promise<WriteResult<WorkspaceSnapshot>>;
  /**
   * R6 execution entry: one exact read of the already-registered Project and
   * Workspace snapshots so a reopened Host can build Query submit pins from the
   * real record revisions. It is a plain read (no GraphWrite envelope): it
   * writes nothing, opens no CAS/event, scans no other graph and never assumes
   * revision 1. The exact records are located by their existing ledger keys and
   * decoded through the shared record codecs.
   */
  readWorkspaceRegistration(
    ctx: CoreCallContext,
    scope: WorkspaceScope,
  ): Promise<ReadResult<{ project: ProjectSnapshot; workspace: WorkspaceSnapshot }>>;
}

/**
 * Trusted Host CompletionPolicy configuration.
 *
 * `installCompletionPolicy` writes one immutable revision row (row revision 1)
 * and never activates it; `activateCompletionPolicy` moves only that project's
 * active pointer with an exact pin + active CAS. Activating is not a runtime
 * Role switch and never rewrites an already accepted Plan's policy pin.
 */
export interface CompletionPolicyConfigurationPort {
  installCompletionPolicy(
    ctx: CoreCallContext,
    request: GraphWrite<{
      policyId: string;
      contentRevision: number;
      content: CompletionPolicyContentV1;
    }>,
  ): Promise<WriteResult<CompletionPolicyRevisionSnapshot>>;
  activateCompletionPolicy(
    ctx: CoreCallContext,
    request: GraphWrite<{ target: CompletionPolicyPin }>,
  ): Promise<WriteResult<ProjectCompletionPolicyActiveSnapshot>>;
}

/**
 * Trusted deps for the two services. `records` is the same physical WorkGraph
 * backend the Goal/Plan writers use; `now`/`eventId` are materialized only for
 * a request that is not an exact replay. The Host supplies these, never model
 * input: no root, permission predicate, Store, actor or callback is accepted.
 */
export type ProjectBootstrapDependencies = {
  records: GoalRecordTransactionPort;
  now(): string;
  eventId(): string;
};

/** The public grouping the composition root publishes as `platform.projects`
 * and `platform.completionPolicies`. */
export type ProjectBootstrapServices = {
  projects: ProjectRegistrationPort;
  completionPolicies: CompletionPolicyConfigurationPort;
};
