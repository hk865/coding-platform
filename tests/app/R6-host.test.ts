/**
 * R6.1a real HTTP acceptance for the local Host.
 *
 * Stage-1 skeleton contract:
 *   - the static page, the per-instance token chain, the Host/Origin boundary,
 *     the JSON/size/forged-field boundary and the explicit route table are REAL
 *     and must be green here;
 *   - every domain route is intentionally an explicit `unsupported` gap, so the
 *     initialization/file/double-graph/replay/version assertions are EXPECTED
 *     to be red until the phase-2 implementation lands. No test reaches a fake
 *     success and no assertion accepts an empty graph.
 *
 * The build artifacts come from the real `scripts/build-workbench.mjs`, run once
 * into a temporary public dir so the test never depends on a prior `next/dist`.
 *
 * Specification: docs/refactor/tasks/R6-host-workbench-skeleton.md §2-§5.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import { loadWorkbenchCliConfig } from '../../src/app/main.js';
import { ProviderRegistry } from '../../vendor/coding-agent/dist/public-api.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { WorkbenchRuntimeConfiguration } from '../../src/app/runtime-configuration.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { InitialPlanningGoalInput, WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import {
  BOOTSTRAP_SUFFIX,
  CORE_API_PREFIX,
  PLATFORM_TOKEN_HEADER,
  PLATFORM_TOKEN_META_NAME,
  PLATFORM_TOKEN_PLACEHOLDER,
  type BootstrapResponse,
  type BootstrapReviewMaterial,
  type CreateSessionRequest,
  type CoreScope,
  type ExecutionHistoryPage,
  type InitialPlanningGoalInputResult,
  type PreparedQueryExecution,
  type QueryExecutionRecord,
  type QueryJobAnswerSnapshot,
  type MessageBody,
  type OperationReceipt,
  type Page,
  type ReadResult,
  type RoleConfigurationRef,
  type RunRef,
  type SessionCard,
  type SessionHistoryEntry,
  type SessionMessage,
  type SessionPage,
  type SessionRecord,
  type SessionRef,
  type TaskExecutionRecord,
  type TaskGraph,
  type TaskRow,
  type WorkflowAdvanceResult,
  type WorkflowStepReceipt,
} from '../../src/app/core-http-types.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { TargetPlatformOptions } from '../../src/composition/create-platform.js';

const projectDir = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const scope: CoreScope = { projectId: 'r6-host-project', workspaceId: 'r6-host-workspace' };
const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: 'r6-goal' };
const projectRef = { aggregateType: 'Project' as const, projectId: scope.projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, ...scope };
const at = '2026-09-26T00:00:00.000Z';

let publicDir = '';
const temporary: string[] = [];

beforeAll(async () => {
  publicDir = await mkdtemp(join(tmpdir(), 'r6-workbench-public-'));
  temporary.push(publicDir);
  const build = spawnSync(process.execPath, ['scripts/build-workbench.mjs'], {
    cwd: projectDir, encoding: 'utf8', env: { ...process.env, WORKBENCH_OUT_DIR: publicDir },
  });
  if (build.status !== 0) throw new Error(`workbench build failed: ${build.stdout}\n${build.stderr}`);
}, 60_000);

afterAll(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

type Started = { host: LocalWorkbenchHost; base: string; token: string; root: string; database: string };

/** Optional real Host overrides. The defaults are byte-identical to the R6.1a
 * fixture; the R6.1b chain supplies a real Kernel store plus trusted Session
 * role material and reopens the SAME ledger/Kernel directories. */
type StartOverrides = {
  root?: string;
  database?: string;
  kernelStores?: TargetPlatformOptions['kernelStores'];
  review?: BootstrapReviewMaterial;
};

async function startHost(overrides: StartOverrides = {}): Promise<Started> {
  const root = overrides.root ?? await mkdtemp(join(tmpdir(), 'r6-host-ws-'));
  const database = overrides.database ?? await mkdtemp(join(tmpdir(), 'r6-host-db-'));
  if (overrides.root === undefined) temporary.push(root);
  if (overrides.database === undefined) temporary.push(database);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'README.md'), '# real r6 workspace\n');
  await writeFile(join(root, 'src', 'main.ts'), 'export const answer = 42;\n');
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true },
    include: ['src/**/*.ts'],
  }));
  const host = await createLocalWorkbenchHost({
    storage: { kind: 'sqlite', directory: database },
    actor: { kind: 'human', id: 'r6-host-operator' },
    publicDir,
    now: () => at,
    architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
    workspaces: [{ scope, name: 'R6 real workspace', root, workspaceRevision: 1, readPrefixes: ['src', 'README.md', 'tsconfig.json'] }],
    ...(overrides.kernelStores === undefined ? {} : { kernelStores: overrides.kernelStores }),
    review: overrides.review ?? {
      notes: 'trusted startup review',
      policies: [{ policyId: 'policy-1', contentRevision: 1, content: { schemaVersion: 1 } }],
      goals: [{ goalId: 'r6-goal', objective: 'Deliver the first real goal' }],
    },
  });
  const address = await host.listen();
  const token = await readPageToken(address.url);
  return { host, base: address.url, token, root, database };
}

async function readPageToken(base: string): Promise<string> {
  const response = await fetch(base);
  expect(response.status).toBe(200);
  const html = await response.text();
  const match = new RegExp(`<meta name="${PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(html);
  if (match?.[1] === undefined) throw new Error('the page did not expose the runtime token meta');
  return match[1];
}

const coreUrl = (base: string, suffix: string): string => new URL(CORE_API_PREFIX + suffix, base).toString();

async function coreGet(base: string, suffix: string, token?: string, origin?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers[PLATFORM_TOKEN_HEADER] = token;
  if (origin !== undefined) headers.origin = origin;
  return fetch(coreUrl(base, suffix), { headers });
}

async function corePost(base: string, suffix: string, token: string | undefined, body: unknown): Promise<Response> {
  return fetch(coreUrl(base, suffix), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { [PLATFORM_TOKEN_HEADER]: token }) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const graphWrite = (input: unknown, requestId: string, expected: unknown[] = []) =>
  ({ scope, request: { input, meta: { requestId, expected } } });
const plain = (input: unknown) => ({ scope, input });

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};

/** Extract the formal assistant outputs from saved original-history entries by
 * their original record type/fields (`agent.event` -> `assistant.message_completed`
 * -> message.content). It never uses a whole-JSON substring, so text that an
 * input context legitimately quoted from an earlier work is not counted as an
 * output of this window. */
function assistantOutputs(items: SessionHistoryEntry[]): { recordId: string; text: string; position: number }[] {
  const outputs: { recordId: string; text: string; position: number }[] = [];
  for (const item of items) {
    const body = item.body;
    if (!('text' in body) || typeof body.text !== 'string') continue;
    let parsed: unknown;
    try { parsed = JSON.parse(body.text); } catch { continue; }
    const envelope = asRecord(parsed);
    if (envelope['recordType'] !== 'agent.event') continue;
    const event = asRecord(asRecord(envelope['payload'])['event']);
    if (event['type'] !== 'assistant.message_completed') continue;
    const message = asRecord(asRecord(event['payload'])['message']);
    const content = message['content'];
    if (typeof content === 'string' && content.length > 0) {
      outputs.push({ recordId: item.recordId, text: content, position: item.source.position });
    }
  }
  return outputs;
}

function planDraft(): unknown {
  return {
    schemaVersion: 2, planId: 'r6-plan', planRevision: 1, goalId: goalRef.goalId, stages: [],
    tasks: [
      { taskId: 'implement', title: 'Implement', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'implement', role: 'builder', instruction: 'Implement the R6 path' }],
    obligations: [{ obligationId: 'obligation-1', title: 'Deliver', requirementLevel: 'required', taskIds: ['implement', 'gate'],
      verificationRequirements: [{ requirementId: 'check-1', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

describe('R6.1a Host HTTP/static shell', () => {
  it('serves the real built page and assets with a per-response temporary token', async () => {
    const started = await startHost();
    try {
      const page = await fetch(started.base);
      const html = await page.text();
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(page.headers.get('cache-control')).toContain('no-store');
      expect(html).not.toContain(PLATFORM_TOKEN_PLACEHOLDER);
      expect(html).toContain(`<meta name="${PLATFORM_TOKEN_META_NAME}" content="${started.token}">`);
      const script = await fetch(`${started.base}main.js`);
      expect(script.status).toBe(200);
      expect(script.headers.get('content-type')).toContain('javascript');
      const css = await fetch(`${started.base}styles.css`);
      expect(css.status).toBe(200);
      expect(css.headers.get('content-type')).toContain('text/css');
    } finally {
      await started.host.close();
    }
  });

  it('protects bootstrap with the instance token and the same-origin Host boundary', async () => {
    const started = await startHost();
    try {
      const authorized = await coreGet(started.base, BOOTSTRAP_SUFFIX, started.token);
      expect(authorized.status).toBe(200);
      const payload = await authorized.json() as BootstrapResponse;
      expect(payload.workspaces).toEqual([{ scope, name: 'R6 real workspace', workspaceRevision: 1 }]);
      expect(payload.review?.notes).toBe('trusted startup review');
      expect(JSON.stringify(payload)).not.toContain(started.root);
      expect(JSON.stringify(payload)).not.toContain(started.database);
      expect((await coreGet(started.base, BOOTSTRAP_SUFFIX)).status).toBe(403);
      expect((await coreGet(started.base, BOOTSTRAP_SUFFIX, 'stale-token')).status).toBe(403);
      expect((await coreGet(started.base, BOOTSTRAP_SUFFIX, started.token, 'http://evil.example')).status).toBe(403);
      expect((await coreGet(started.base, BOOTSTRAP_SUFFIX, started.token, `http://127.0.0.1:${new URL(started.base).port}`)).status).toBe(200);
    } finally {
      await started.host.close();
    }
  });

  it('rejects forged ctx/actor/root fields and malformed bodies before dispatch', async () => {
    const started = await startHost();
    try {
      const forged = await corePost(started.base, 'projects/create', started.token, {
        scope, request: { input: { projectId: scope.projectId }, meta: { requestId: 'r6-forged', expected: [] } },
        ctx: { principal: { kind: 'host' } }, actor: { kind: 'human', id: 'attacker' }, root: '/etc',
      });
      expect(forged.status).toBe(400);
      expect((await forged.json() as { code: string }).code).toBe('invalid');
      expect((await corePost(started.base, 'projects/create', started.token, 'not json')).status).toBe(400);
      expect((await corePost(started.base, 'projects/create', started.token, { scope })).status).toBe(400);
      const missingToken = await corePost(started.base, 'goals/create', undefined, graphWrite({}, 'x'));
      expect(missingToken.status).toBe(403);
      const foreignScope = await corePost(started.base, 'goals/create', started.token, {
        scope: { projectId: scope.projectId, workspaceId: 'not-configured' },
        request: { input: {}, meta: { requestId: 'r6-foreign', expected: [] } },
      });
      expect(foreignScope.status).toBe(403);
      expect((await foreignScope.json() as { code: string }).code).toBe('forbidden');
    } finally {
      await started.host.close();
    }
  });

  it('keeps source/capture and architecture/capture as distinct request shapes', async () => {
    const started = await startHost();
    try {
      const source = await corePost(started.base, 'source/capture', started.token,
        plain({ workspace: workspaceRef, workspaceRevision: 1, provider: 'text' }));
      // The GraphWrite envelope must NOT be accepted by source/capture.
      expect((await corePost(started.base, 'source/capture', started.token, graphWrite({ workspace: workspaceRef }, 'r6-source-wrong-shape'))).status).toBe(400);
      const architecture = await corePost(started.base, 'architecture/capture', started.token,
        graphWrite({ workspace: scope, mappings: [], previous: null }, 'r6-architecture-capture'));
      // The plain envelope must NOT be accepted by architecture/capture.
      expect((await corePost(started.base, 'architecture/capture', started.token, plain({ workspace: scope }))).status).toBe(400);
    } finally {
      await started.host.close();
    }
  });

  it('is idempotent on close and rejects new requests afterwards', async () => {
    const started = await startHost();
    await started.host.close();
    await expect(started.host.close()).resolves.toBeUndefined();
    await expect(started.host.listen()).rejects.toThrow(/closed/);
    await expect(fetch(started.base)).rejects.toThrow();
  });
});

describe('R6.1a domain routes (expected red until phase 2)', () => {
  it('initializes an empty SQLite and reads the adopted/observed double graph and real files over HTTP', async () => {
    const started = await startHost();
    try {
      const project = await corePost(started.base, 'projects/create', started.token,
        graphWrite({ projectId: scope.projectId }, 'r6-project-1', [{ ref: projectRef, revision: 0 }]));
      expect(project.status).toBe(200);
      expect(await project.json()).toMatchObject({ status: 'committed', replayed: false, value: { ref: projectRef, revision: 1 } });

      const workspace = await corePost(started.base, 'workspaces/register', started.token,
        graphWrite({ workspace: scope }, 'r6-workspace-1', [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }]));
      expect(await workspace.json()).toMatchObject({ status: 'committed', value: { ref: workspaceRef, revision: 1 } });

      const policy = await corePost(started.base, 'completion-policies/install', started.token,
        graphWrite({ policyId: 'policy-1', contentRevision: 1, content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } },
          'r6-policy-install-1', [{ ref: projectRef, revision: 1 }, { ref: { aggregateType: 'CompletionPolicyRevision', projectId: scope.projectId, policyId: 'policy-1', revision: 1 }, revision: 0 }]));
      const policyPayload = await policy.json() as { status: string; value: { ref: unknown; contentDigest: string } };
      expect(policyPayload).toMatchObject({ status: 'committed' });
      const activation = await corePost(started.base, 'completion-policies/activate', started.token,
        graphWrite({ target: { ref: policyPayload.value.ref, digest: policyPayload.value.contentDigest } }, 'r6-policy-activate-1',
          [{ ref: projectRef, revision: 1 }, { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: scope.projectId }, revision: 0 }]));
      expect(await activation.json()).toMatchObject({ status: 'committed' });

      const goal = await corePost(started.base, 'goals/create', started.token,
        graphWrite({ goalId: goalRef.goalId, workspace: scope, objective: 'Deliver the first real goal' }, 'r6-goal-1',
          [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }]));
      expect(await goal.json()).toMatchObject({ status: 'committed' });

      const adopted = await corePost(started.base, 'architecture/adopt-initial', started.token,
        graphWrite({ baselineId: 'r6-baseline', description: 'R6 adopted structure', constraints: [], catalog: { requireDag: true, dependencies: [], modules: [
          { ref: { projectId: scope.projectId, moduleId: 'r6-host' }, name: 'R6 Host', responsibility: 'Serve the workbench', paths: ['src'], interfaces: [] },
        ] } }, 'r6-adopt-1', [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }]));
      expect(await adopted.json()).toMatchObject({ status: 'committed' });

      const proposed = await corePost(started.base, 'plans/propose', started.token,
        graphWrite({ goalRef, basedOn: null, draft: planDraft(), reason: { text: 'Initial R6 plan', sources: [] } }, 'r6-propose-1'));
      const proposalPayload = await proposed.json() as { status: string; value: { ref: unknown; revision: number; kind: string; issues: unknown[] } };
      expect(proposalPayload).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2', issues: [] } });

      const applied = await corePost(started.base, 'plans/apply', started.token,
        graphWrite({ proposalRef: proposalPayload.value.ref, expectedProposalRevision: proposalPayload.value.revision, decisionRefs: [] }, 'r6-apply-1'));
      expect(await applied.json()).toMatchObject({ status: 'committed' });

      const goalRead = await corePost(started.base, 'goals/read', started.token, plain(goalRef));
      expect(goalRead.status).toBe(200);
      expect(await goalRead.json()).toMatchObject({ status: 'ready', value: { goal: { objective: 'Deliver the first real goal' } } });

      // The adopted catalog is a distinct read from the observed source graph.
      const adoptedRead = await corePost(started.base, 'architecture/read', started.token, plain({ selection: { kind: 'current' } }));
      expect(adoptedRead.status).toBe(200);
      expect(await adoptedRead.json()).toMatchObject({ status: 'ready', value: { catalog: { catalog: { modules: [{ ref: { moduleId: 'r6-host' } }] } } } });

      const observedCapture = await corePost(started.base, 'architecture/capture', started.token,
        graphWrite({ workspace: scope, mappings: [{ id: 'r6-host', kind: 'module', paths: ['src'] }], previous: null }, 'r6-observed-1',
          [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }]));
      const observedPayload = await observedCapture.json() as { status: string; value: unknown };
      expect(observedPayload).toMatchObject({ status: 'committed' });
      const observedQuery = await corePost(started.base, 'architecture/query', started.token,
        plain({ selection: { kind: 'observed', capture: observedPayload.value }, depth: 1, relations: ['dependency'], page: { limit: 50 } }));
      expect(observedQuery.status).toBe(200);
      expect(await observedQuery.json()).toMatchObject({ status: 'ready', value: { noVerdict: true } });

      const tasks = await corePost(started.base, 'tasks/query', started.token, plain({ goalRef }));
      expect(tasks.status).toBe(200);
      expect(await tasks.json()).toMatchObject({ status: 'ready', value: { plan: { ref: { planId: 'r6-plan' } } } });

      const capture = await corePost(started.base, 'source/capture', started.token,
        plain({ workspace: workspaceRef, workspaceRevision: 1, provider: 'text', prefix: 'src' }));
      expect(capture.status).toBe(200);
      const capturePayload = await capture.json() as { status: string; value?: { ref: unknown } };
      expect(capturePayload.status).toBe('ready');
      expect(capturePayload.value).toBeDefined();

      const file = await corePost(started.base, 'files/read', started.token,
        plain({ workspace: workspaceRef, path: 'README.md', maxBytes: 1024, version: { kind: 'working_tree' } }));
      expect(file.status).toBe(200);
      expect(await file.json()).toMatchObject({ status: 'ready', value: { path: 'README.md', content: '# real r6 workspace\n' } });

      const denied = await corePost(started.base, 'files/read', started.token,
        plain({ workspace: workspaceRef, path: 'secrets.txt', maxBytes: 1024, version: { kind: 'working_tree' } }));
      expect(denied.status).toBe(200);
      expect(await denied.json()).toMatchObject({ status: 'rejected' });

      const queried = await corePost(started.base, 'source/query', started.token,
        plain({ capture: capturePayload.value?.ref, query: { kind: 'paths' }, cursor: null, limit: 10 }));
      expect(queried.status).toBe(200);
      expect(await queried.json()).toMatchObject({ status: 'ready' });
    } finally {
      await started.host.close();
    }
  });

  it('replays the original write receipt and preserves a real version conflict after reopen', async () => {
    const started = await startHost();
    const first = graphWrite({ projectId: scope.projectId }, 'r6-replay-1', [{ ref: projectRef, revision: 0 }]);
    try {
      const committed = await corePost(started.base, 'projects/create', started.token, first);
      expect(committed.status).toBe(200);
      const original = await committed.json() as { status: string; cursor?: unknown };
      expect(original).toMatchObject({ status: 'committed' });
      await started.host.close();

      const reopened = await createLocalWorkbenchHost({
        storage: { kind: 'sqlite', directory: started.database },
        actor: { kind: 'human', id: 'r6-host-operator' },
        publicDir, now: () => at,
        architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
        workspaces: [{ scope, name: 'R6 real workspace', root: started.root, workspaceRevision: 1, readPrefixes: ['src', 'README.md', 'tsconfig.json'] }],
      });
      const address = await reopened.listen();
      const token = await readPageToken(address.url);
      try {
        const replay = await corePost(address.url, 'projects/create', token, first);
        expect(replay.status).toBe(200);
        expect(await replay.json()).toMatchObject({ status: 'committed', replayed: true, cursor: original.cursor });
        const conflict = await corePost(address.url, 'workspaces/register', token,
          graphWrite({ workspace: scope }, 'r6-conflict-1', [{ ref: projectRef, revision: 99 }, { ref: workspaceRef, revision: 0 }]));
        expect(conflict.status).toBe(409);
        expect(await conflict.json()).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      } finally {
        await reopened.close();
      }
    } finally {
      await started.host.close();
    }
  });

  // R6.1b-1: one REAL normal chain. It asserts the final success behavior, so in
  // phase 1 the first red is the explicit `unsupported` body of `sessions/create`;
  // every later Kernel/message/reopen step is unreached and is reported as such.
  it('carries a real Session, Host message and original Kernel history through an explicit reopen', async () => {
    const role: RoleConfigurationRef = {
      kind: 'role_spec',
      pin: {
        ref: { aggregateType: 'RoleSpecRevision', projectId: scope.projectId, roleId: 'r6-builder', revision: 1 },
        digest: 'a'.repeat(64),
      },
    };
    const root = await mkdtemp(join(tmpdir(), 'r6b-host-ws-'));
    const database = await mkdtemp(join(tmpdir(), 'r6b-host-db-'));
    temporary.push(root, database);
    const kernelStores: TargetPlatformOptions['kernelStores'] = {
      entries: [{
        adapterId: 'r6b-kernel-adapter', storeKey: 'r6b-kernel-store', workspace: scope,
        databasePath: join(database, 'kernel.sqlite'),
      }],
    };
    const review: BootstrapReviewMaterial = {
      notes: 'trusted R6.1b review',
      sessionRoles: [{ scope, label: 'Builder', role }],
    };
    const createBody = plain({
      workspace: scope, role, recommendedRefs: [], initialLinks: [],
      meta: { requestId: 'r6b-session-create-1', expected: [] },
    } satisfies CreateSessionRequest);
    const messageText = 'R6.1b real Host message body';

    const started = await startHost({ root, database, kernelStores, review });
    try {
      expect(await (await corePost(started.base, 'projects/create', started.token,
        graphWrite({ projectId: scope.projectId }, 'r6b-project-1', [{ ref: projectRef, revision: 0 }]))).json())
        .toMatchObject({ status: 'committed' });
      expect(await (await corePost(started.base, 'workspaces/register', started.token,
        graphWrite({ workspace: scope }, 'r6b-workspace-1',
          [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }]))).json())
        .toMatchObject({ status: 'committed' });

      const created = await corePost(started.base, 'sessions/create', started.token, createBody);
      expect(created.status).toBe(200);
      const receipt = await created.json() as OperationReceipt<SessionRecord>;
      expect(receipt.status).toBe('completed');
      if (receipt.status !== 'completed') throw new Error('real Host Session creation did not complete');
      const sessionRef: SessionRef = { projectId: receipt.value.ref.projectId, sessionId: receipt.value.ref.sessionId };
      const operationRef = receipt.operationRef;

      const found = await corePost(started.base, 'sessions/find', started.token,
        plain({ workspace: scope, includeArchived: false, page: { limit: 10 } }));
      expect(await found.json()).toMatchObject({ status: 'ready', value: {
        items: [{ record: { ref: { sessionId: sessionRef.sessionId } } }] } });

      const read = await corePost(started.base, 'sessions/read', started.token, plain(sessionRef));
      expect(await read.json()).toMatchObject({ status: 'ready', value: {
        record: { ref: { sessionId: sessionRef.sessionId } } } });

      const operation = await corePost(started.base, 'sessions/operation', started.token, plain(operationRef));
      expect(await operation.json()).toMatchObject({ status: 'ready', value: {
        ref: { operationId: operationRef.operationId }, phase: 'completed' } });

      const replay = await corePost(started.base, 'sessions/create', started.token, createBody);
      expect(await replay.json()).toMatchObject({ status: 'completed', replayed: true, value: {
        ref: { sessionId: sessionRef.sessionId } } });

      const sent = await corePost(started.base, 'messages/send', started.token,
        graphWrite({ recipient: sessionRef, text: messageText }, 'r6b-message-1', []));
      const sentBody = await sent.json() as WriteResult<SessionMessage>;
      expect(sentBody).toMatchObject({ status: 'committed', value: {
        status: 'pending', recipient: { sessionId: sessionRef.sessionId } } });
      if (sentBody.status !== 'committed') throw new Error('real Host message send did not commit');
      const messageRef = sentBody.value.ref;

      const inbox = await corePost(started.base, 'messages/inbox', started.token,
        plain({ recipient: sessionRef, page: { limit: 10 } }));
      expect(await inbox.json()).toMatchObject({ status: 'ready', value: {
        items: [{ ref: { messageId: messageRef.messageId }, status: 'pending' }], nextCursor: null } });

      // Reading never acks: the message must still be pending afterwards.
      const message = await corePost(started.base, 'messages/read', started.token, plain(messageRef));
      expect(await message.json()).toMatchObject({ status: 'ready', value: {
        ref: { messageId: messageRef.messageId }, status: 'pending' } });

      const body = await corePost(started.base, 'messages/body', started.token, plain({ messageRef, part: 'message' }));
      expect(await body.json()).toMatchObject({ status: 'ready', value: {
        text: messageText, part: 'message', usage: 'message' } });

      const history = await corePost(started.base, 'sessions/history', started.token,
        plain({ sessionRef, afterCursor: null, throughCursor: null, limit: 10 }));
      const historyBody = await history.json() as ReadResult<Page<SessionHistoryEntry>>;
      expect(historyBody).toMatchObject({ status: 'ready', value: {
        nextCursor: null, items: [{ kind: 'session_created', source: { position: 1 } }] } });
    } finally {
      await started.host.close();
    }

    const reopened = await startHost({ root, database, kernelStores, review });
    try {
      const found = await corePost(reopened.base, 'sessions/find', reopened.token,
        plain({ workspace: scope, includeArchived: false, page: { limit: 10 } }));
      const foundBody = await found.json() as ReadResult<SessionPage<SessionCard>>;
      expect(foundBody).toMatchObject({ status: 'ready', value: {
        items: [{ record: { ref: { projectId: scope.projectId } } }] } });
      if (foundBody.status !== 'ready') throw new Error('reopened Session directory is unavailable');
      expect(foundBody.value.items).toHaveLength(1);
      const reopenedRecord = foundBody.value.items[0]!.record;
      const reopenedRef: SessionRef = { projectId: reopenedRecord.ref.projectId, sessionId: reopenedRecord.ref.sessionId };

      const inbox = await corePost(reopened.base, 'messages/inbox', reopened.token,
        plain({ recipient: reopenedRef, page: { limit: 10 } }));
      const inboxBody = await inbox.json() as ReadResult<{ items: SessionMessage[]; nextCursor: string | null }>;
      expect(inboxBody).toMatchObject({ status: 'ready', value: {
        items: [{ status: 'pending' }], nextCursor: null } });
      if (inboxBody.status !== 'ready') throw new Error('reopened inbox is unavailable');
      const reopenedMessageRef = inboxBody.value.items[0]!.ref;

      const body = await corePost(reopened.base, 'messages/body', reopened.token,
        plain({ messageRef: reopenedMessageRef, part: 'message' }));
      expect(await body.json()).toMatchObject({ status: 'ready', value: { text: messageText } });

      const history = await corePost(reopened.base, 'sessions/history', reopened.token,
        plain({ sessionRef: reopenedRef, afterCursor: null, throughCursor: null, limit: 10 }));
      const historyBody = await history.json() as ReadResult<Page<SessionHistoryEntry>>;
      expect(historyBody).toMatchObject({ status: 'ready', value: {
        nextCursor: null, items: [{ kind: 'session_created' }] } });
    } finally {
      await reopened.host.close();
    }
  });
});


// ---------------------------------------------------------------------------
// R6 execution entry: one REAL normal chain over the local HTTP Host.
//
// Stage one (this batch) declares the trusted runtime configuration factory, the
// narrow registration read, the 11 routes and the UI seams, but leaves the new
// algorithms explicitly `unsupported`. The chain below is the final acceptance
// shape: it loads a real temporary startup JSON, assembles the runtime through
// the narrow controlled ProviderRegistry/SecretSource seam, then consumes the
// public Query/initial-Plan/Workflow owners. Its FIRST RED is the first new
// unsupported algorithm reached; every later step is reported as unreached.
// Specification: docs/refactor/tasks/R6-execution-entry-skeleton.md §3-§5.
// ---------------------------------------------------------------------------

const R6X_SECRET_VAR = 'R6X_CONTROLLED_SECRET';
const R6X_SECRET_VALUE = 'r6x-controlled-secret-value';
const R6X_QUERY_INSTRUCTION = 'R6 execution trusted read-only query guidance';
const R6X_WORK_INSTRUCTION = 'R6 execution trusted static work guidance';
const execGoalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: 'r6x-goal' };
const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: scope.projectId, workspaceId: scope.workspaceId, queryJobId: 'r6x-job' };
const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: scope.projectId, workspaceId: scope.workspaceId, queryJobId: 'r6x-job', runId: 'r6x-run' };
const querySessionRole = { kind: 'legacy_template' as const, templateId: 'advisor', templateRevision: '1' };
const queryRoleBinding = { schemaVersion: 1 as const, bindingId: 'r6x-query-role-binding', templateId: 'advisor',
  templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const workRoleBinding = { schemaVersion: 1 as const, bindingId: 'r6x-work-role-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const r6xRuntimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };

function executionPlanAnswer(): string {
  return JSON.stringify({
    schemaVersion: 2, kind: 'plan', summary: 'Initial plan from the real coordination answer',
    plan: {
      schemaVersion: 2, stages: [],
      tasks: [
        { taskId: 'r6x-work-1', title: 'First ordinary work', requirementLevel: 'required', taskKind: 'work',
          disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
        { taskId: 'r6x-work-2', title: 'Second ordinary work', requirementLevel: 'required', taskKind: 'work',
          disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
        { taskId: 'r6x-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
          disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
        { taskId: 'r6x-future', title: 'Optional future', requirementLevel: 'optional', taskKind: 'work',
          disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only' },
      ],
      assignments: [
        { taskId: 'r6x-work-1', role: 'builder', instruction: 'Do the first ordinary work' },
        { taskId: 'r6x-work-2', role: 'builder', instruction: 'Do the second ordinary work' },
      ],
      obligations: [{ obligationId: 'r6x-obligation', title: 'Deliver the execution-entry plan work',
        requirementLevel: 'required', taskIds: ['r6x-work-1', 'r6x-work-2', 'r6x-gate'],
        verificationRequirements: [{ requirementId: 'r6x-static', requirementLevel: 'required',
          kind: 'static', description: 'Registered static command check' }] }],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
      taskRelations: [], inputRequirements: [],
    },
  });
}

type R6xStarted = {
  host: LocalWorkbenchHost; base: string; token: string; root: string; database: string;
  scripted: ReturnType<typeof createScriptedModel>;
};
type R6xOverrides = { root?: string; database?: string };

async function startRuntimeHost(overrides: R6xOverrides = {}): Promise<R6xStarted> {
  const root = overrides.root ?? await mkdtemp(join(tmpdir(), 'r6x-host-ws-'));
  const database = overrides.database ?? await mkdtemp(join(tmpdir(), 'r6x-host-db-'));
  const configDir = await mkdtemp(join(tmpdir(), 'r6x-host-config-'));
  if (overrides.root === undefined) temporary.push(root);
  if (overrides.database === undefined) temporary.push(database);
  temporary.push(configDir);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'module.ts'), 'export const r6xMarker = "R6_EXECUTION_SOURCE";\n');
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true }, include: ['src/**/*.ts'],
  }));
  const skillsRoot = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));
  const scripted = createScriptedModel([
    { kind: 'calls', calls: [{ callId: 'r6x-source-1', name: 'project_source',
      args: { action: 'read', path: 'src/module.ts', maxBytes: 8192, version: { kind: 'working_tree' } } }] },
    { kind: 'text', text: executionPlanAnswer() },
    { kind: 'text', text: 'R6 execution first work result' },
    { kind: 'text', text: 'R6 execution second work result' },
  ]);
  const registry = new ProviderRegistry().register({
    id: 'deepseek', secretEnvironmentVariable: R6X_SECRET_VAR, defaultBaseUrl: 'https://invalid.test',
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: () => scripted.client,
  });
  const runtime: WorkbenchRuntimeConfiguration = {
    schemaVersion: 1,
    bindings: [
      { id: 'r6x-query-binding', label: 'R6 query runtime', scope, role: querySessionRole,
        configurationRevision: 'r6x-query-host@1',
        model: { revision: 'r6x-query-model@1', provider: 'deepseek', model: 'r6x-scripted-query',
          secretEnvironmentVariable: R6X_SECRET_VAR },
        grant: { budget: r6xRuntimeBudget, hostTemplate: { templateId: 'advisor', revision: '1', digest: sha256Hex(R6X_QUERY_INSTRUCTION) },
          tools: ['read', 'project_source'], writeScope: [], skills: { resourceRoot: skillsRoot, enabledIds: [] },
          systemInstruction: R6X_QUERY_INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null } },
      { id: 'r6x-work-binding', label: 'R6 work runtime', scope, role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
        configurationRevision: 'r6x-work-host@1',
        model: { revision: 'r6x-work-model@1', provider: 'deepseek', model: 'r6x-scripted-work',
          secretEnvironmentVariable: R6X_SECRET_VAR },
        grant: { budget: r6xRuntimeBudget, hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex(R6X_WORK_INSTRUCTION) },
          tools: ['read'], writeScope: [], skills: { resourceRoot: skillsRoot, enabledIds: [] },
          systemInstruction: R6X_WORK_INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null } },
    ],
    queryProfiles: [{ id: 'r6x-investigate', label: 'R6 只读调查', scope, runtimeBindingId: 'r6x-query-binding',
      sessionRole: querySessionRole, roleBinding: queryRoleBinding, runtimeBudget: r6xRuntimeBudget,
      budget: { maxTokens: 200000, deadline: null }, consumerId: 'r6x-consumer' }],
  };
  // The trusted check permission revision must equal the Host workspace
  // permission generation exactly. It is derived here with the SAME algorithm as
  // app/host.ts (subject + scope + sorted read prefixes), never a guessed
  // constant: check-execution/evidence compare the value for equality.
  const permissionRevision = `host-permission-v1:${sha256Hex(JSON.stringify({
    subject: { kind: 'human', id: 'r6x-operator' },
    scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
    readPrefixes: [...new Set(['src'])].sort(),
  }))}`;
  const checks: TrustedCheckConfiguration = {
    configurationRevision: 'r6x-checks-1', workspace: workspaceRef, executor: { kind: 'human', id: 'r6x-operator' },
    permissionRevision, sourceAccess: 'verification_workspace', processAccess: 'all_except_denied',
    deniedPrefixes: ['.git'],
    checks: [{ checkId: 'r6x-echo', kind: 'static', command: 'echo R6X_CHECK_OK', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: 'r6x-consumer',
    bindings: [{ workspace: scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: workRoleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  const configPath = join(configDir, 'workbench.json');
  await writeFile(configPath, JSON.stringify({
    sqliteDirectory: database,
    actor: { kind: 'human', id: 'r6x-operator' },
    workspaces: [{ scope, name: 'R6 execution workspace', root, workspaceRevision: 1, readPrefixes: ['src'] }],
    architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
    kernelStores: { entries: [{ adapterId: 'r6x-kernel', storeKey: 'r6x-kernel-store', workspace: scope,
      databasePath: join(database, 'kernel.sqlite') }] },
    runtime, checks, workflow,
  }));
  const loaded = await loadWorkbenchCliConfig(configPath);
  const host = await createLocalWorkbenchHost({
    ...loaded,
    publicDir,
    now: () => at,
    runtimeProvider: { registry, secretSource: { get: (name: string) => name === R6X_SECRET_VAR ? R6X_SECRET_VALUE : undefined } },
  });
  const address = await host.listen();
  const token = await readPageToken(address.url);
  return { host, base: address.url, token, root, database, scripted };
}

describe('R6 execution entry (expected red at the first stage-one unsupported)', () => {
  it('loads a real startup JSON and consumes the trusted runtime through the public Query/Workflow owners', async () => {
    const started = await startRuntimeHost();
    try {
      const bootstrap = await coreGet(started.base, BOOTSTRAP_SUFFIX, started.token);
      expect(bootstrap.status).toBe(200);
      const bootstrapBody = await bootstrap.json() as BootstrapResponse;
      expect(bootstrapBody.execution.queryProfiles).toHaveLength(1);
      expect(bootstrapBody.execution.queryProfiles[0]?.id).toBe('r6x-investigate');
      expect(bootstrapBody.execution.workflowScopes).toEqual([scope]);
      const serializedBootstrap = JSON.stringify(bootstrapBody);
      expect(serializedBootstrap).not.toContain(R6X_SECRET_VALUE);
      expect(serializedBootstrap).not.toContain(R6X_SECRET_VAR);
      expect(serializedBootstrap).not.toContain('systemInstruction');
      expect(serializedBootstrap).not.toContain('r6x-query-binding');
      expect(serializedBootstrap).not.toContain('r6x-query-host@1');

      expect((await corePost(started.base, 'projects/create', started.token,
        graphWrite({ projectId: scope.projectId }, 'r6x-project-1', [{ ref: projectRef, revision: 0 }]))).status).toBe(200);
      expect(await (await corePost(started.base, 'workspaces/register', started.token,
        graphWrite({ workspace: scope }, 'r6x-workspace-1',
          [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }]))).json())
        .toMatchObject({ status: 'committed' });
      expect(await (await corePost(started.base, 'goals/create', started.token,
        graphWrite({ goalId: execGoalRef.goalId, workspace: scope, objective: 'Deliver the execution-entry goal' },
          'r6x-goal-1', [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }]))).json())
        .toMatchObject({ status: 'committed' });

      // FIRST RED (stage one): the narrow registration read is the first new
      // unsupported algorithm. Everything below is the stage-two final shape.
      const registration = await corePost(started.base, 'workspaces/registration', started.token, plain(scope));
      expect(registration.status).toBe(200);
      const registrationBody = await registration.json() as ReadResult<{ project: ProjectSnapshot; workspace: WorkspaceSnapshot }>;
      expect(registrationBody).toMatchObject({ status: 'ready', value: {
        project: { ref: projectRef, revision: 1 }, workspace: { ref: workspaceRef, revision: 1 } } });
      if (registrationBody.status !== 'ready') throw new Error(`registration read was not ready: ${JSON.stringify(registrationBody)}`);

      const intent: QueryJobIntentV1 = {
        schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId: scope.projectId, workspaceId: scope.workspaceId,
        goalId: execGoalRef.goalId, question: 'Read the project sources and propose the initial plan',
        focusTaskRefs: [], budget: { maxTokens: 200000, deadline: null }, multiTurn: { maxRounds: 1 },
        correlationId: 'r6x-corr',
        execution: { kind: 'initial_coordination', roleBinding: queryRoleBinding, runtimeBudget: r6xRuntimeBudget },
      };
      expect(await (await corePost(started.base, 'queries/submit', started.token,
        graphWrite({ queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent }, 'r6x-submit',
          [{ ref: projectRef, revision: registrationBody.value.project.revision },
            { ref: workspaceRef, revision: registrationBody.value.workspace.revision },
            { ref: execGoalRef, revision: 1 }, { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }]))).json())
        .toMatchObject({ status: 'committed', value: { job: { job: { queryJobId: queryJobRef.queryJobId } } } });

      const created = await corePost(started.base, 'sessions/create', started.token,
        plain({ workspace: scope, role: querySessionRole, recommendedRefs: [], initialLinks: [], meta: { requestId: 'r6x-session', expected: [] } }));
      const createdBody = await created.json() as OperationReceipt<SessionRecord>;
      expect(createdBody.status).toBe('completed');
      if (createdBody.status !== 'completed') throw new Error('Query Session creation did not complete');
      const sessionRef = createdBody.value.ref;

      expect(await (await corePost(started.base, 'queries/claim', started.token,
        graphWrite({ queryRunRef, sessionRef }, 'r6x-claim',
          [{ ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
            { ref: sessionRef, revision: createdBody.value.revision }]))).json())
        .toMatchObject({ status: 'committed' });

      const prepared = await corePost(started.base, 'queries/prepare', started.token, plain({ queryRunRef, requestId: 'r6x-prepare' }));
      const preparedBody = await prepared.json() as ReadResult<PreparedQueryExecution>;
      expect(preparedBody).toMatchObject({ status: 'ready' });
      if (preparedBody.status !== 'ready') throw new Error(`Query preparation was not ready: ${JSON.stringify(preparedBody)}`);

      const startRequest = { prepared: preparedBody.value, consumerId: 'r6x-consumer', requestId: 'r6x-start' };
      const startedQuery = await corePost(started.base, 'queries/start', started.token, plain(startRequest));
      const startedBody = await startedQuery.json() as ReadResult<QueryExecutionRecord>;
      expect(startedBody).toMatchObject({ status: 'ready' });
      if (startedBody.status !== 'ready') throw new Error(`Query start was not ready: ${JSON.stringify(startedBody)}`);
      const answerRef = startedBody.value.answer?.ref;
      if (answerRef === undefined) throw new Error('the initial_coordination QueryRun did not record an answer');

      // The original start replay must not add a model call.
      const callsAfterStart = started.scripted.calls();
      expect(await (await corePost(started.base, 'queries/start', started.token, plain(startRequest))).json())
        .toMatchObject({ status: 'ready' });
      expect(started.scripted.calls()).toBe(callsAfterStart);

      const answerRead = await corePost(started.base, 'queries/answer', started.token, plain(answerRef));
      const answerBody = await answerRead.json() as ReadResult<QueryJobAnswerSnapshot>;
      expect(answerBody).toMatchObject({ status: 'ready', value: { answer: { stale: false } } });
      if (answerBody.status !== 'ready') throw new Error(`the official answer was not ready: ${JSON.stringify(answerBody)}`);
      const opened = await corePost(started.base, 'materials/open', started.token,
        plain({ ref: answerBody.value.answer.bodyRef, usage: 'historical_explanation' }));
      expect(await opened.json()).toMatchObject({ status: 'ready' });

      const planningInput: InitialPlanningGoalInput = {
        schemaVersion: 1, goalRef: execGoalRef, flowId: 'r6x-flow', sessionHint: null, executeWithinRequest: true,
        kind: 'planning_answer',
        request: { meta: { requestId: 'r6x-planning-answer', expected: [] },
          input: { answerRef, reason: { text: 'Initial plan from the real coordination answer', sources: [] } } },
      };
      const planning = await corePost(started.base, 'workflow/goal-input', started.token, plain(planningInput));
      const planningBody = await planning.json() as InitialPlanningGoalInputResult;
      expect(planningBody).toMatchObject({ status: 'ready', value: { state: 'proposed', next: { kind: 'goal_input' } } });
      if (planningBody.status !== 'ready' || planningBody.value.next === null)
        throw new Error(`the planning answer did not hand off: ${JSON.stringify(planningBody)}`);

      const installed = await corePost(started.base, 'completion-policies/install', started.token,
        graphWrite({ policyId: 'r6x-policy', contentRevision: 1,
          content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } },
          'r6x-policy-install', [{ ref: projectRef, revision: 1 },
            { ref: { aggregateType: 'CompletionPolicyRevision', projectId: scope.projectId, policyId: 'r6x-policy', revision: 1 }, revision: 0 }]));
      const installedBody = await installed.json() as WriteResult<{ ref: unknown; contentDigest: string }>;
      expect(installedBody).toMatchObject({ status: 'committed' });
      if (installedBody.status !== 'committed') throw new Error('CompletionPolicy install failed');
      expect(await (await corePost(started.base, 'completion-policies/activate', started.token,
        graphWrite({ target: { ref: installedBody.value.ref, digest: installedBody.value.contentDigest } }, 'r6x-policy-active',
          [{ ref: projectRef, revision: 1 },
            { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: scope.projectId }, revision: 0 }]))).json())
        .toMatchObject({ status: 'committed' });
      expect(await (await corePost(started.base, 'architecture/adopt-initial', started.token,
        graphWrite({ baselineId: 'r6x-baseline', description: 'R6 execution-entry boundary', constraints: [],
          catalog: { requireDag: true, dependencies: [], modules: [{ ref: { projectId: scope.projectId, moduleId: 'r6x' },
            name: 'R6 execution entry', responsibility: 'Consume the answer and advance', paths: ['src'], interfaces: [] }] } },
          'r6x-adopt', [{ ref: projectRef, revision: 1 },
            { ref: workspaceRef, revision: registrationBody.value.workspace.revision }]))).json())
        .toMatchObject({ status: 'committed' });

      const adopted = await corePost(started.base, 'workflow/goal-input', started.token, plain(planningBody.value.next.input));
      const adoptedBody = await adopted.json() as InitialPlanningGoalInputResult;
      expect(adoptedBody).toMatchObject({ status: 'ready', value: { state: 'advance', next: { kind: 'work' } } });
      if (adoptedBody.status !== 'ready' || adoptedBody.value.next === null || adoptedBody.value.next.kind !== 'work')
        throw new Error(`adoption did not hand off: ${JSON.stringify(adoptedBody)}`);

      let advanceInput: WorkflowAdvanceInput = adoptedBody.value.next.input;
      const receipts: WorkflowStepReceipt[] = [];
      let finalState = '';
      for (let guard = 0; guard < 64; guard += 1) {
        const advanced = await corePost(started.base, 'workflow/advance', started.token, plain(advanceInput));
        const body = await advanced.json() as WorkflowAdvanceResult;
        expect(body).toMatchObject({ status: 'ready' });
        if (body.status !== 'ready') throw new Error(`advance was not ready: ${JSON.stringify(body)}`);
        if (body.value.receipt !== null) receipts.push(body.value.receipt);
        if (body.value.state === 'completed') { finalState = 'completed'; break; }
        if (body.value.next === null) { finalState = body.value.state; break; }
        advanceInput = body.value.next;
      }
      expect(finalState).toBe('completed');
      const graph = await corePost(started.base, 'tasks/query', started.token, plain({ goalRef: execGoalRef }));
      const graphBody = await graph.json() as ReadResult<TaskGraph>;
      expect(graphBody).toMatchObject({ status: 'ready', value: {
        completion: { status: 'recorded', snapshot: { phase: 'COMPLETED' }, selectedPlanMatches: true } } });
      expect(JSON.stringify(receipts)).not.toContain(R6X_SECRET_VALUE);
      if (graphBody.status !== 'ready') throw new Error('the completed Goal task graph was not ready');

      // R6 Task-execution -> original Session/history consumer: read each real
      // work Run through the two new plain passthrough routes, then the second
      // work's bounded run window and the shared claim Session's full saved
      // history. Every fact comes from the original owner reads; no locator or
      // Kernel record is seeded and no writer is invented.
      const callsBeforeReads = started.scripted.calls();
      const workRows = new Map<string, TaskRow>();
      for (const taskId of ['r6x-work-1', 'r6x-work-2']) {
        const row = graphBody.value.tasks.find(candidate => candidate.ref.taskId === taskId);
        if (row === undefined || row.execution === null) throw new Error(`completed work ${taskId} has no execution RunRef`);
        workRows.set(taskId, row);
      }
      const executionRecords = new Map<string, Extract<ReadResult<TaskExecutionRecord>, { status: 'ready' }>>();
      for (const [taskId, row] of workRows) {
        const runRef = row.execution as RunRef;
        const read = await corePost(started.base, 'executions/read', started.token, plain(runRef));
        expect(read.status).toBe(200);
        const body = await read.json() as ReadResult<TaskExecutionRecord>;
        expect(body).toMatchObject({ status: 'ready', value: {
          run: { ref: runRef, task: { taskId } },
          outbox: { claim: { task: { taskId }, runRef } } } });
        if (body.status !== 'ready') throw new Error(`executions/read was not ready for ${taskId}`);
        executionRecords.set(taskId, body);
      }
      const firstExecution = executionRecords.get('r6x-work-1');
      const secondExecution = executionRecords.get('r6x-work-2');
      if (firstExecution === undefined || secondExecution === undefined) throw new Error('both work executions must be readable');
      // The two works reuse one claim Session but are two different Runs.
      expect(firstExecution.value.outbox.claim.sessionRef).toEqual(secondExecution.value.outbox.claim.sessionRef);
      expect(firstExecution.value.outbox.claim.runRef.runId).not.toBe(secondExecution.value.outbox.claim.runRef.runId);

      // Second work's run window: a small legal limit forces a real continuation
      // along the same request object; the first work's output must not appear.
      const secondRunRef = secondExecution.value.run.ref;
      const secondLocator = secondExecution.value.run.executionHistory;
      if (secondLocator === undefined) throw new Error('the second work Run has no persisted execution-history locator');
      const windowRecords: SessionHistoryEntry[] = [];
      let windowCursor: string | null = null;
      let sawWindowCursor = false;
      for (let guard = 0; guard < 32; guard += 1) {
        const response = await corePost(started.base, 'executions/history', started.token,
          plain({ runRef: secondRunRef, afterCursor: windowCursor, limit: 1 }));
        expect(response.status).toBe(200);
        const body = await response.json() as ReadResult<ExecutionHistoryPage>;
        expect(body).toMatchObject({ status: 'ready' });
        if (body.status !== 'ready') throw new Error(`executions/history was not ready: ${JSON.stringify(body)}`);
        expect(body.value.executionIdentity).toEqual({
          runId: secondLocator.kernel.runId, turnId: secondLocator.kernel.turnId });
        windowRecords.push(...body.value.items);
        windowCursor = body.value.nextCursor;
        if (windowCursor !== null) { sawWindowCursor = true; continue; }
        break;
      }
      expect(sawWindowCursor).toBe(true);
      expect(windowRecords.length).toBeGreaterThan(0);
      expect(windowRecords.every(entry => Number.isSafeInteger(entry.source.position))).toBe(true);
      const windowOutputs = assistantOutputs(windowRecords);
      expect(windowOutputs.map(output => output.text)).toContain('R6 execution second work result');
      expect(windowOutputs.map(output => output.text)).not.toContain('R6 execution first work result');
      const secondOutput = windowOutputs.find(output => output.text === 'R6 execution second work result');
      if (secondOutput === undefined) throw new Error('the second work output record was not found');
      expect(secondOutput.recordId.length).toBeGreaterThan(0);

      // Full claim Session history: follow the original cursor across pages and
      // reach both works' real saved records. It is strictly larger than the
      // second run window, and the first work's record is in the Session but not
      // in that window. Order/identity come from the original data.
      const claimSessionRef = secondExecution.value.outbox.claim.sessionRef;
      const sessionRecords: SessionHistoryEntry[] = [];
      let sessionCursor: string | null = null;
      for (let guard = 0; guard < 64; guard += 1) {
        const response = await corePost(started.base, 'sessions/history', started.token,
          plain({ sessionRef: claimSessionRef, afterCursor: sessionCursor, throughCursor: null, limit: 2 }));
        expect(response.status).toBe(200);
        const body = await response.json() as ReadResult<Page<SessionHistoryEntry>>;
        expect(body).toMatchObject({ status: 'ready' });
        if (body.status !== 'ready') throw new Error(`sessions/history was not ready: ${JSON.stringify(body)}`);
        sessionRecords.push(...body.value.items);
        sessionCursor = body.value.nextCursor;
        if (sessionCursor === null) break;
      }
      const sessionOutputs = assistantOutputs(sessionRecords);
      expect(sessionOutputs.map(output => output.text)).toContain('R6 execution first work result');
      expect(sessionOutputs.map(output => output.text)).toContain('R6 execution second work result');
      const firstSessionOutput = sessionOutputs.find(output => output.text === 'R6 execution first work result');
      const secondSessionOutput = sessionOutputs.find(output => output.text === 'R6 execution second work result');
      if (firstSessionOutput === undefined || secondSessionOutput === undefined)
        throw new Error('both work outputs must be in the Session history');
      expect(firstSessionOutput.position).toBeLessThan(secondSessionOutput.position);
      expect(sessionRecords.some(entry => entry.recordId === firstSessionOutput.recordId)).toBe(true);
      expect(windowRecords.some(entry => entry.recordId === firstSessionOutput.recordId)).toBe(false);
      expect(sessionRecords.length).toBeGreaterThan(windowRecords.length);
      // The reads never start a model, create a Run/Session, refresh a budget or
      // re-run the Workflow.
      expect(started.scripted.calls()).toBe(callsBeforeReads);
    } finally {
      await started.host.close();
    }

    const reopened = await startRuntimeHost({ root: started.root, database: started.database });
    try {
      const registration = await corePost(reopened.base, 'workspaces/registration', reopened.token, plain(scope));
      expect(await registration.json()).toMatchObject({ status: 'ready' });
      const goal = await corePost(reopened.base, 'goals/read', reopened.token, plain(execGoalRef));
      expect(await goal.json()).toMatchObject({ status: 'ready' });
      const job = await corePost(reopened.base, 'queries/read', reopened.token, plain(queryJobRef));
      expect(await job.json()).toMatchObject({ status: 'ready' });
    } finally {
      await reopened.host.close();
    }
  });
});
