/**
 * K3 group 2 part 3 support: a composition root on a `HostScenario`'s files
 * whose Runtime grant includes the builtin `shell`, for the K3-21
 * `second_auto_cleanup` chain (L23 example 1: Run A must end by RUN-25 with a
 * `process` item in its review record).
 *
 * `openWorkRoot` (./common.ts) keeps the AG2b grant, which has no `shell`
 * (`AG2B_WORK_TOOLS`), so a scripted `shell` call is refused at the Kernel before
 * it can stay in flight. This helper copies `openWorkRoot`'s composition and
 * wraps its Runtime configuration to add the `shell` tool and the explicit
 * `shellWorkspaceAccess: 'all_except_denied'` the preparation requires
 * (`execution-preparation.ts:277-279`). The file's `vi.mock` of
 * `createShellToolDefinition` supplies the blocking stand-in; without it the
 * real shell would need bwrap.
 *
 * The Workflow runs on this root too (the prepared manifest must carry the
 * `shell` grant, which is fixed at `prepare`), so `prepareOn` drives the
 * Workflow exactly as `HostScenario.advance` does, without the invariant reads.
 */
import { join } from 'node:path';
import type { RecordCommitObserver } from '../../../src/composition/commit-observer.js';
import { createTargetPlatform } from '../../../src/composition/create-platform.js';
import type { WorkflowAdvanceInput } from '../../../src/business/workflow/contracts.js';
import {
  AG2B_AT, AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING, permissionRevision,
} from '../../helpers/AG2b-collaboration-fixture.js';
import type { ScriptedModel } from '../../helpers/B2-runtime-fixture.js';
import {
  AG2B_WORK_TOOLS, ag2bWorkRuntime, ag2bWorkspaceBindings, hostCtx, type HostScenario, type Platform,
} from '../harness.js';
import { storeDirOf } from '../../helpers/KLS1B-host-store.js';

/** `openWorkRoot` (./common.ts) with a `shell` grant and whole-workspace process access. */
export async function openShellWorkRoot(h: HostScenario, model: ScriptedModel,
  observer?: RecordCommitObserver): Promise<Platform> {
  const base = ag2bWorkRuntime(() => model, { tools: [...AG2B_WORK_TOOLS, 'shell'] });
  // A-07: both resolutions overlay the SAME grant; the pre-claim check has no Run.
  const overlay = (resolved: Awaited<ReturnType<typeof base.resolveConfiguration>>) => {
    if (resolved.status !== 'ready') return resolved;
    return { status: 'ready' as const,
      value: { ...resolved.value, shellWorkspaceAccess: 'all_except_denied' as const } };
  };
  const runtime = {
    ...base,
    async resolveConfiguration(context: Parameters<typeof base.resolveConfiguration>[0],
      request: Parameters<typeof base.resolveConfiguration>[1]) {
      return overlay(await base.resolveConfiguration(context, request));
    },
    async resolveRoleConfiguration(context: Parameters<typeof base.resolveConfiguration>[0],
      input: Parameters<NonNullable<typeof base.resolveRoleConfiguration>>[1]) {
      return overlay(await base.resolveRoleConfiguration!(context, input));
    },
  };
  return await createTargetPlatform({
    storage: { kind: 'sqlite', directory: storeDirOf(h.database) },
    workspace: ag2bWorkspaceBindings(h.root, { value: 1 }, permissionRevision(h.stepActor(), AG2B_SCOPE, ['.'])),
    now: () => AG2B_AT,
    kernelStores: { entries: [{ adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store', workspace: AG2B_SCOPE,
      databasePath: join(h.database, 'kernel.sqlite') }] },
    runtime,
    ...(observer === undefined ? {} : { commitObserver: observer }),
    workflow: { consumerId: AG2B_CONSUMER_ID, bindings: [{ workspace: AG2B_SCOPE, sessionRole: AG2B_WORK_ROLE,
      roleBinding: AG2B_WORK_ROLE_BINDING, budget: { tokenBudget: 1_000_000, deadline: null } }] },
  });
}

/** Drive a root's Workflow until the next `perform` is a `start`; answer it (unperformed). */
export async function prepareOn(platform: Platform, input: WorkflowAdvanceInput): Promise<WorkflowAdvanceInput> {
  let current = input;
  for (let step = 0; step < 64; step += 1) {
    if (current.kind === 'perform' && current.operation.kind === 'start') return current;
    const result = await platform.workflow.advanceWork(hostCtx(), current);
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    if (result.value.state === 'completed' || result.value.next === null) {
      throw new Error(`the Workflow settled without a start: ${JSON.stringify(result.value)}`);
    }
    current = result.value.next;
  }
  throw new Error('the Workflow did not reach a start within the step guard');
}
