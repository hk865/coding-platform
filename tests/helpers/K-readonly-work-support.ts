/**
 * KE6 Work-path support: a real Work execution with an EMPTY write scope whose
 * Host-only ceiling can name the read-only process tool.
 *
 * The shared B2 fixture installs a RoleSpec whose `permissions.tools` is fixed
 * to `['read']`, so `run_readonly_command` is correctly cut by the Role ceiling
 * there (that is KB-08's RoleSpec case). For KB-07/KB-09..KB-11 we need the
 * trusted legacy-template path, where the Host grant is the only ceiling. This
 * helper reuses the SAME real claim/entry/Runtime wiring and only mutates the
 * fixture's trusted configuration: it appends a coordination policy revision
 * without a role matrix (so the RoleSpec resolution is honestly `absent`) and
 * claims the second Task on the still-legacy second Session.
 */
import { join } from 'node:path';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { CoordinationPolicyContentV1 } from '../../src/contracts/human-role-collaboration.js';
import { coordinationPolicyContentDigest } from '../../src/contracts/human-role-collaboration.js';
import type { RuntimeExecutionDependencies, RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { AgentRuntimeService } from '../../src/core/agent-runtime/ports.js';
import {
  B2_AT, createB2RuntimeFixture, createRuntimeHostDouble, type ScriptedModel, type ScriptedReply,
} from './B2-runtime-fixture.js';
import type { TaskClaimFixture } from './task-claim-fixture.js';

const LEGACY_ROLE = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };
const POLICY_ID = 'b2-runtime-policy';
const refKey = (value: object) => canonicalJson(value as unknown as JsonValue);

export type KReadonlyWorkFixture = {
  fixture: TaskClaimFixture;
  runtime: AgentRuntimeService;
  runRef: RunRef;
  sessionRef: TaskClaimFixture['sessions']['second'];
  scripted: ScriptedModel;
  directory: string;
  ctx: CoreCallContext;
  /** The real public Session-history reader this fixture's Runtime was built on. */
  sessionHistory: Pick<RuntimeExecutionDependencies['sessionOperations'], 'readSessionHistory'>;
  close(): Promise<void>;
};

export async function createKReadonlyWorkFixture(options: {
  scriptedReplies: readonly ScriptedReply[];
  /** Host tool grant; defaults to ['read', 'run_readonly_command']. */
  tools?: string[];
  /** Host write scope; a non-empty scope is the write-enabled counterexample. */
  writeScope?: string[];
  /** false omits the explicit L18 `readonlyCommandAccess` grant. */
  readonlyCommandAccess?: boolean;
  /** The workspace read policy; false makes the read only a partial prefix. */
  workspaceHost?: RuntimeExecutionDependencies['workspaceHost'];
  /**
   * An explicit trusted Host binding for this Work, built from the real fixture
   * facts. The D-SWITCH case installs the REAL Host resolution boundary
   * (`createWorkbenchRuntimeHostBindings`) with a switch-off narrowing so the
   * production narrowing is exercised; when absent the documented test double
   * is used.
   */
  host?: (input: { scripted: ScriptedModel; scope: WorkspaceScope; directory: string }) => RuntimeHostBindings;
}): Promise<KReadonlyWorkFixture> {
  const fx = await createB2RuntimeFixture({ scriptedReplies: options.scriptedReplies });

  // Remove the role matrix through real appends: a policy revision without a
  // role catalog plus a moved active pointer. The RoleSpec resolver then returns
  // the honest `absent`, and the legacy Session role must match the Host's
  // legacy template (the fixture's second Session was never repinned).
  const projectId = fx.scope.projectId;
  const policyContent: CoordinationPolicyContentV1 = {
    schemaVersion: 1,
    budget: { maxAutonomousReworks: 0, maxClarifications: 0 },
    allowed: { inScopeRework: false, inScopeTesting: true },
    scope: { changesRequireHumanDecision: ['requirement', 'acceptance', 'baseline'] },
    upgrade: { path: 'manual-decision', note: 'K readonly fixture: legacy Host ceiling' },
  };
  const policyRef2 = { aggregateType: 'CoordinationPolicyRevision' as const, projectId, policyId: POLICY_ID, revision: 2 };
  const activeRef = { aggregateType: 'ProjectCoordinationPolicyActive' as const, projectId };
  const appended = await fx.claimFixture.commitRaw([
    { refKey: refKey(policyRef2), schemaId: 'CoordinationPolicyRevisionSnapshot@1', revision: 1,
      json: JSON.stringify({ ref: policyRef2, revision: 1, schemaVersion: 1, policyId: POLICY_ID, contentRevision: 2,
        content: policyContent, contentDigest: coordinationPolicyContentDigest(policyContent, POLICY_ID, 2), installedAt: B2_AT }) },
    { refKey: refKey(activeRef), schemaId: 'ProjectCoordinationPolicyActiveSnapshot@1', revision: 2,
      json: JSON.stringify({ ref: activeRef, revision: 2, projectId, activeRevision: policyRef2 }) },
  ], [{ refKey: refKey(activeRef), expectedRevision: 1 }]);
  if (appended.status !== 'committed') throw new Error(`K readonly policy append failed: ${JSON.stringify(appended)}`);

  const claimed = await fx.claimFixture.service.claimTask(fx.ctx, await fx.claimFixture.buildRequest({
    input: { taskId: fx.claimFixture.tasks.second.taskId, sessionRef: fx.claimFixture.sessions.second },
    requestId: 'k-readonly-work-claim',
  }));
  if (claimed.status !== 'committed') throw new Error(`K readonly Work claim failed: ${JSON.stringify(claimed)}`);
  const runRef = claimed.value.runRef;

  const tools = options.tools ?? ['read', 'run_readonly_command'];
  const writeScope = options.writeScope ?? [];
  const baseHost = createRuntimeHostDouble({
    runRefs: new Set([refKey(runRef)]), scripted: fx.scripted, root: fx.directory,
    skillRoot: join(fx.directory, 'skills'), scope: fx.scope, role: LEGACY_ROLE, tools, writeScope,
  });
  const host: RuntimeHostBindings = options.host?.({ scripted: fx.scripted, scope: fx.scope, directory: fx.directory }) ?? {
    async resolveConfiguration(ctx, request) {
      const result = await baseHost.resolveConfiguration(ctx, request);
      if (result.status !== 'ready') return result;
      return { ...result, value: {
        ...result.value,
        ...(options.readonlyCommandAccess === false ? {} : { readonlyCommandAccess: 'all_except_denied' as const }),
      } };
    },
  };
  const runtime = fx.rebuild({
    host,
    ...(options.workspaceHost !== undefined
      ? { workspaceHost: options.workspaceHost }
      : options.readonlyCommandAccess === false ? {}
        // L18 layer 1: the tool is granted only when the read is the WHOLE
        // workspace. The base fixture deliberately grants one path; the
        // read-only command cases use the whole-workspace grant.
        : { workspaceHost: {
            ...fx.deps.workspaceHost,
            async authorize(ctx: CoreCallContext, workspace) {
              const current = await fx.deps.workspaceHost.authorize(ctx, workspace);
              if (current.status !== 'ready') return current;
              return { ...current, value: { ...current.value, allowsRead: () => true } };
            },
          } }),
  });
  return {
    fixture: fx.claimFixture, runtime, runRef, sessionRef: fx.claimFixture.sessions.second,
    scripted: fx.scripted, directory: fx.directory, ctx: fx.ctx,
    sessionHistory: fx.deps.sessionOperations, close: () => fx.close(),
  };
}
