/**
 * FT-1: the T tool world. One real Host opens through the frozen S7A Work
 * world, with a caller binding for the formal duty, its grant, a Plan task
 * assigned to that duty and a Session responsible for it. `start()` drives the
 * real `workflow/advance` claim/prepare/start and returns the frozen prepared
 * manifest's tool names, the names the model was offered and the tool results
 * the Kernel recorded. A caller scripts its own model replies on `line` before
 * calling `start()`; with no reply queued, `start()` queues one text answer.
 *
 * The base seeded Run keeps its own builder tool table. The handoff authority
 * lives only on this world's caller binding, so T can prepare it while
 * `handoffs` is still unbound; a real `hand_off` start waits for T+L2.
 *
 * `createMember` is set on the caller binding's grant before the real Host
 * constructs its bindings, through the one complete-configuration wrapper
 * (the pattern of tests/helpers/S7C-member-fixture.ts:61); the binding's tool
 * merge channel carries names only. `narrowGrant()` arms a delegating wrapper
 * on the real configuration resolver: the next preparation reports
 * `createMember: false` while the `create_member` name stays in `tools`.
 *
 * The `create_member` factory is wrapped (and returned unchanged) to capture
 * the Work `CoreCallContext` the driver actually passes; `start().context` is
 * that context, never a test-built one.
 */
import { vi } from 'vitest';
import * as runtimeConfigurationModule from '../../src/app/runtime-configuration.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import * as memberTools from '../../src/core/agent-runtime/member-tools.js';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { AttentionScopeV1 } from '../../src/app/attention-observer.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleBindingRefV1, RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { ModelRequest, ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import { advanceUntil, driveWorkflow, readExecution } from './A2-restart-fixture.js';
import { plain } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';
import {
  S6A_SCOPE, type S6ABackend, type S6AExtraBinding, type S6ASession,
} from './S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from './S6B1-fixture.js';
import {
  bindingOf, claimedRunOf, openS7AWorkWorld, ready, runS7ASameSessionAgain, sessionOf,
} from './S7A-fixture.js';
import { withConfiguredHost } from './S7C-member-fixture.js';

export type S7CDuty = 'executor' | 'adviser' | 'scribe';

export type S7CToolWorldOptions = {
  duty: S7CDuty;
  grantTools: readonly string[];
  createMember?: boolean;
  attention?: readonly AttentionScopeV1[];
  backend?: S6ABackend;
};

/** One real started Run and the public facts the tool rows read from it. */
export type S7CToolStart = {
  readonly run: RunRef;
  readonly execution: TaskExecutionRecord;
  /** `permissions.tools` of the frozen prepared manifest (`materials/open`). */
  readonly toolNames: readonly string[];
  /** The names the Kernel offered the model in this Run's first request. */
  readonly offeredToolNames: readonly string[];
  /** Every tool result in this Run, in request/message order. */
  readonly results: readonly ToolResult[];
  readonly result: ToolResult | null;
  /** The real Work context the driver passed to `createMemberTools`. */
  readonly context: CoreCallContext | null;
};

export type S7CToolWorld = {
  readonly world: S6AHostWorld;
  readonly main: S6ACardsWorkspace;
  readonly goal: GoalRef;
  readonly plan: PlanRevisionSnapshot;
  readonly tasks: readonly TaskTriple[];
  readonly line: S6ASession;
  /** The effective caller binding the Host built (tools after the merge). */
  readonly binding: WorkbenchRuntimeBinding;
  readonly duty: S7CDuty;
  readonly grantTools: readonly string[];
  /** A real Work Run of the duty line: first call claims the first task, later calls the next one. */
  readonly start: () => Promise<S7CToolStart>;
  /** T-05: the next preparation of this caller binding reports `createMember: false`. */
  readonly narrowGrant: () => void;
};

function dutyWorkflowOf(id: string, duty: S7CDuty): WorkflowHostConfiguration['bindings'][number] {
  const role = platformRoleProfile(duty).template;
  const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: `${id}-workflow`,
    templateId: role.templateId, templateRevision: role.templateRevision, bindingVersion: 1,
    policyRevision: 'legacy-template' };
  return { workspace: S6A_SCOPE, sessionRole: structuredClone(role), roleBinding,
    budget: { tokenBudget: 1_000_000, deadline: null } };
}

/** FT-1: one real Work start with the caller binding's grant. */
export async function openS7CToolWorld(options: S7CToolWorldOptions): Promise<S7CToolWorld> {
  const duty = options.duty;
  const backend = options.backend ?? 'memory';
  const role = platformRoleProfile(duty).template;
  const instruction = `S7C T ${duty} trusted guidance`;
  const bindingId = duty === 'executor' ? 's7c-t-executor-binding'
    : duty === 'adviser' ? 's7a-adviser-binding' : 's6a-scribe-binding';
  const grantTools = [...options.grantTools];
  const createMember = options.createMember === true;
  const extra: S6AExtraBinding = duty === 'executor'
    ? { binding: bindingOf(bindingId, role, instruction, grantTools), workflow: dutyWorkflowOf(bindingId, duty) }
    : { binding: bindingOf(bindingId, role, instruction, grantTools), mergeTools: grantTools };
  let narrowed = false;
  let configuredBinding: WorkbenchRuntimeBinding | undefined;

  const realBindings = runtimeConfigurationModule.createWorkbenchRuntimeHostBindings;
  const runtimeSpy = vi.spyOn(runtimeConfigurationModule, 'createWorkbenchRuntimeHostBindings')
    .mockImplementation((configuration, dependencies, narrowing) => {
      const bindings = realBindings(configuration, dependencies, narrowing);
      const resolve = bindings.resolveConfiguration.bind(bindings);
      return {
        ...bindings,
        async resolveConfiguration(ctx, request) {
          const result = await resolve(ctx, request);
          if (!narrowed || result.status !== 'ready'
            || !runtimeConfigurationModule.sameRoleConfiguration(request.role, role)) return result;
          return { status: 'ready', value: { ...result.value, createMember: false } };
        },
      };
    });
  let opened: Awaited<ReturnType<typeof openS7AWorkWorld>>;
  try {
    opened = await withConfiguredHost(() => openS7AWorkWorld({
      backend,
      extraBindings: [extra],
      extraHostOptions: options.attention === undefined ? {} : { attention: [...options.attention] },
    }), original => async hostOptions => {
      const configuration = hostOptions.runtimeConfiguration;
      if (configuration === undefined) throw new Error('S7C T: the Host was opened without its runtime configuration');
      const binding = configuration.bindings.find(candidate => candidate.id === bindingId);
      if (binding === undefined) throw new Error(`S7C T: the Host configuration has no ${bindingId}`);
      binding.grant = { ...binding.grant, platformDuty: duty, createMember };
      configuredBinding = binding;
      return await original(hostOptions);
    });
  } finally {
    runtimeSpy.mockRestore();
  }
  const world = opened.world;
  try {
    // The wrapper recorded the merged binding it handed the Host.
    if (configuredBinding === undefined) throw new Error(`S7C T: the Host configuration has no ${bindingId}`);

    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = (await main.createGoal(`s7c-t-${duty}-goal`, `S7C T ${duty} tool goal`)).ref;
    const planned = await adoptS6BPlan(main, goal, { label: `s7c-t-${duty}`,
      taskIds: [`s7c-t-${duty}-1`, `s7c-t-${duty}-2`], role: role.templateId });
    const line = await sessionOf(world, await createS6BLine(main, { label: `s7c-t-${duty}-line`,
      role, tasks: planned.tasks }));
    let starts = 0;

    async function startToolRun(): Promise<S7CToolStart> {
      const before = (await world.scripted.requests(line)).length;
      const captured: CoreCallContext[] = [];
      const original = memberTools.createMemberTools;
      const spy = vi.spyOn(memberTools, 'createMemberTools').mockImplementation(config => {
        captured.push(config.context);
        return original(config);
      });
      let run: RunRef;
      try {
        if (starts === 0) {
          if (await world.scripted.pending(line) === 0) {
            await world.scripted.script(line, [{ kind: 'text', text: 'S7C T tool answer' }]);
          }
          const claimInput = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal,
            flowId: `s7c-t-${duty}-first`, sessionHint: line.ref, kind: 'select_work',
            taskId: planned.tasks[0]!.taskId }, 'claim_task');
          const receipts: WorkflowStepReceipt[] = [];
          await driveWorkflow(world.ag2b, claimInput, { stopBefore: 'claim_task', receipts });
          run = claimedRunOf(receipts, 'the T tool Run').run;
        } else {
          run = (await runS7ASameSessionAgain(world, line)).run;
        }
      } finally {
        spy.mockRestore();
      }
      starts += 1;
      const requests: ModelRequest[] = (await world.scripted.requests(line)).slice(before);
      const offeredToolNames = requests[0]?.tools.map(tool => tool.name) ?? [];
      const results = requests.flatMap(request => request.messages.flatMap(message =>
        message.role === 'tool' ? [message.result] : []));
      const execution = await readExecution(world.ag2b, run);
      const bundleRef = execution.run.envelope?.bundleRef;
      if (bundleRef === undefined) throw new Error('S7C T: the Run has no frozen prepared manifest');
      const artifact = ready<{ body: string }>(await world.post('materials/open',
        plain(S6A_SCOPE, { ref: bundleRef, usage: 'historical_explanation' })), 'the T Run manifest');
      const manifest = JSON.parse(artifact.body) as PreparedTaskManifestV1;
      return { run, execution, toolNames: manifest.permissions.tools, offeredToolNames, results,
        result: results[results.length - 1] ?? null, context: captured[captured.length - 1] ?? null };
    }

    return { world, main, goal, plan: planned.plan, tasks: planned.tasks, line, binding: configuredBinding,
      duty, grantTools, start: startToolRun, narrowGrant: () => { narrowed = true; } };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}
