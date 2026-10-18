/**
 * K3-35 (四) (L5, L13, L20): a workspace whose working tree differs from HEAD in
 * more than 2,000 files still prepares; its recorded start baseline is
 * `unavailable/too_many_changes`.
 *
 * Reached through the real preparation service `createExecutionPreparation`.
 * The context assembler is a narrow double (these rows never render context);
 * the workspace host, role resolution, Host configuration and body store are
 * minimal public-boundary doubles. No database is read.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunRef, TaskAttemptRef, TaskBudgetV1, TaskTriple, RoleBindingRefV1 } from '../../src/contracts/dispatch.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { RoleSpecResolutionV1 } from '../../src/contracts/role-spec-materials.js';
import type { ContextAssembler } from '../../src/core/agent-runtime/context-assembler.js';
import type { ResolvedRuntimeConfiguration } from '../../src/core/agent-runtime/execution-contracts.js';
import type { ExecutionPreparationDependencies } from '../../src/core/agent-runtime/execution-preparation.js';
import { createExecutionPreparation, loadPreparedManifest, WORKSPACE_BASELINE_CONTENT_TYPE } from '../../src/core/agent-runtime/execution-preparation.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';

const AT = '2026-10-16T00:00:00.000Z';
const TASK: TaskTriple = { projectId: 'p', goalId: 'g', taskId: 't' };
const RUN_REF: RunRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'k335-run' };
const ATTEMPT_REF: TaskAttemptRef = { aggregateType: 'TaskAttempt', projectId: 'p', goalId: 'g', taskId: 't', attemptId: 'a1' };
const PLAN_REF = { aggregateType: 'PlanRevision' as const, projectId: 'p', planId: 'pl' };
const ROLE_REVISION = { aggregateType: 'RoleSpecRevision' as const, projectId: 'p', roleId: 'builder', revision: 1 };
const ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'k335-binding', templateId: 'builder', templateRevision: '1',
  bindingVersion: 1, policyRevision: 'legacy-template',
};
const BUDGET: TaskBudgetV1 = { tokenBudget: 4096, deadline: null };
const CTX: CoreCallContext = {
  projectId: 'p', workspaceId: 'w',
  principal: { kind: 'host', actor: { kind: 'human', id: 'k335' } },
  materialReader: { kind: 'host', projectId: 'p', workspaceId: 'w', actor: { kind: 'human', id: 'k335' } },
  signal: new AbortController().signal,
};

const roots: string[] = [];
const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function roleResolution(): Extract<RoleSpecResolutionV1, { status: 'resolved' }> {
  return {
    status: 'resolved', roleId: 'builder', revision: ROLE_REVISION,
    spec: {
      schemaVersion: 1, platformDuty: 'executor', label: 'Builder', purpose: 'Execute.',
      responsibility: ['execution'], requiredMaterials: [], optionalMaterials: [],
      permissions: { tools: ['read'], writeScope: 'workspace' },
      budget: { source: 'task-budget', scope: 'assigned-task' },
      requiredOutputs: [],
      exit: { success: 'done', stop: 'stop', handoff: 'report' },
    },
  };
}

function hostConfiguration(): ResolvedRuntimeConfiguration {
  return {
    configurationRevision: 'k335-host@1',
    model: {
      configuration: { revision: 'm@1', provider: 'scripted', model: 'k335', baseUrl: 'http://127.0.0.1' },
      client: {} as unknown as ResolvedRuntimeConfiguration['model']['client'],
    },
    budget: { contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: 4,
      maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512 },
    hostTemplate: null,
    tools: ['read'], writeScope: ['.'],
    skills: { resourceRoot: 'skills', enabledIds: [] },
    systemInstruction: 'executor',
    deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
  };
}

function executionRecord(): TaskExecutionRecord {
  const plan = {
    ref: PLAN_REF, revision: 1,
    assignments: [{ taskId: 't', role: 'builder', instruction: 'Implement.' }],
  } as unknown as PlanRevisionSnapshot;
  const claim: TaskClaim = {
    task: TASK, planRef: plan.ref, workspaceId: 'w',
    sessionRef: { projectId: 'p', sessionId: 's' }, sessionRevision: 1, generation: 1,
    runRef: RUN_REF, attemptRef: ATTEMPT_REF,
    outboxRef: { aggregateType: 'DispatchOutboxEntry', projectId: 'p', goalId: 'g', taskId: 't', attemptId: 'a1' },
    claimedAt: AT,
  };
  const run = {
    ref: RUN_REF, revision: 1, schemaVersion: 1, task: TASK, attemptId: 'a1', planRef: plan.ref,
    roleBinding: ROLE_BINDING, budget: BUDGET, workspaceSnapshot: { workspaceId: 'w', revision: 1 },
    status: 'starting', outcome: null, exitCode: null, lastEventSeq: 0, lastRuntimeEventId: '',
    lastFactEventId: '', envelope: null, startedAt: null, endedAt: null,
  };
  const outbox = {
    ref: claim.outboxRef, revision: 1, schemaVersion: 1, status: 'pending', claim,
  };
  const session = {
    ref: { aggregateType: 'Session', projectId: 'p', sessionId: 's' }, revision: 1,
    kernel: { adapterId: 'k335', kernelSessionId: 'ks-1' }, lifecycle: 'active', health: 'available',
    role: { kind: 'role_spec', pin: { ref: ROLE_REVISION, digest: 'role-digest' } },
    workspaceId: 'w', lastExecutionRef: null, occupancy: null, historyCursor: null,
    createdAt: AT, archivedAt: null,
  };
  const attempt = {
    ref: ATTEMPT_REF, revision: 1, schemaVersion: 1, runId: RUN_REF.runId, planRef: plan.ref,
    status: 'claimed', startedAt: null, endedAt: null, endOutcome: null,
  };
  return { run, attempt, outbox, plan, session, lease: null, readThrough: null } as unknown as TaskExecutionRecord;
}

/** A context assembler double: preparation rows never render a model input. */
function assemblerDouble(): ContextAssembler {
  return {
    async assembleTask() {
      return { status: 'ready', value: {
        input: 'k335-input', continuationBrief: null, sessionBasis: undefined, selectedTaskInputs: [],
        binding: {
          schemaVersion: 1, formatVersion: 's3-context-v1', callKind: 'work', duty: 'executor',
          residentBudgetBytes: 4096, residentBytes: 0, totalBytes: 0, sections: [], sources: [],
          inputSelections: [], extensions: {
            notes: { availability: 'not_implemented', rows: [] },
            anomalies: { availability: 'not_implemented', rows: [] },
            footprint: { availability: 'not_implemented', rows: [] },
            goalSettings: { availability: 'not_implemented', autonomy: null },
            decisions: { availability: 'not_implemented', rows: [] },
          },
        },
      } } as never;
    },
  } as unknown as ContextAssembler;
}

/** A git work tree whose working tree differs from HEAD in >2000 paths. */
async function dirtyGitWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'k3-35-'));
  roots.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'k3-35@example.invalid');
  git('config', 'user.name', 'K3 35');
  await writeFile(join(root, 'seed.txt'), 'seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
  for (let index = 0; index < 2001; index += 1) {
    await writeFile(join(root, `untracked-${String(index).padStart(4, '0')}.txt`), 'x\n');
  }
  return root;
}

function preparation(root: string, world: K3ReviewCardWorld) {
  // F-054: the row runs on both backends. The Task has no review record, so the
  // required Task-review reader is the real owner over this world's one real
  // record store (an empty page, not a built result); the body store is the
  // same world's real store, read back through the public prepared manifest.
  const bodies = world.fixture.bodies;
  const deps: ExecutionPreparationDependencies = {
    executions: { readExecution: async () => ({ status: 'ready', value: executionRecord() }) },
    roles: { resolveRoleBindingFacts: async () => ({ result: { status: 'ready', value: roleResolution() }, guards: [] }) },
    bodies,
    unknownCallReviews: world.reviews,
    host: { resolveConfiguration: async () => ({ status: 'ready', value: hostConfiguration() }) },
    workspaceHost: {
      resolveRoot: async () => ({ status: 'ready', value: { root, workspaceRevision: 1 } }),
      authorize: async () => ({ status: 'ready', value: {
        subjectKey: 'k335', permissionRevision: 'k335@1', allowsRead: () => true,
      } }),
    },
    now: () => AT,
    newId: () => 'k335-id',
    // Item 2: the dependency is REQUIRED; this row has no blocked command, so
    // the production closure reader is never invoked. It is present (never an
    // absent default) and fails loudly if the assumption stops holding.
    readTaskClosure: async () => {
      throw new Error('unreachable: the K3-35 workspace-baseline row has no blocked command');
    },
  };
  return { bodies, preparation: createExecutionPreparation(deps, assemblerDouble()) };
}

describe('K3-35 (四) workspace baseline capacity', () => {
  it.each(['memory', 'sqlite'] as const)('(%s) K3-35 (四) prepare succeeds and records an unavailable too_many_changes baseline for a >2000-change workspace', async kind => {
    const root = await dirtyGitWorkspace();
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const { bodies, preparation: prepare } = preparation(root, world);
    const prepared = await prepare.prepare(CTX, { runRef: RUN_REF, requestId: 'k335-prepare' });
    if (prepared.status !== 'ready') throw new Error(`prepare: ${JSON.stringify(prepared)}`);

    const loaded = await loadPreparedManifest(bodies, prepared.value);
    if (loaded.status !== 'ready') throw new Error(`manifest: ${loaded.status}`);
    expect(loaded.value.manifest.workspaceBaseline).toEqual({
      status: 'unavailable', reason: 'too_many_changes', detail: expect.any(String),
    });
    expect(WORKSPACE_BASELINE_CONTENT_TYPE).toBe('application/vnd.platform.workspace-baseline+json');
  });
});
