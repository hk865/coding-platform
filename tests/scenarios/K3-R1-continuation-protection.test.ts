/**
 * K3 section 3 item 5 (L6, spec 213-222): the current side of a file-diff read
 * never follows a symlink out of the workspace and never opens a protected path.
 *
 * The unit cases pin the WorkspaceTools read seam directly: a symlink (final
 * component) is `not_text`, a protected path is `protected` on the NORMALISED
 * workspace-relative path (`./.env`), and a real path outside the real
 * workspace root is refused. The integration case drives the real R1 flow: an
 * edit call whose path is turned into a symlink to the protected file while the
 * call is in flight. The note must be status only and carry none of the
 * target's bytes.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { toolSchema as z } from '../../vendor/coding-agent/dist/public-api.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import { continuationBriefDigest, renderContinuationBriefZh } from '../../src/contracts/continuation-brief.js';
import { WORKSPACE_DENIED_PREFIXES } from '../../src/core/workspace/denied-prefixes.js';
import { readContinuationCurrentFile } from '../../src/core/workspace/continuation-diff-reads.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { openWorkRoot, preparedOf, redrivePolicy } from './support/common.js';

const roots: string[] = [];

// --- The blocking `edit` stand-in: real class, real capabilities. -----------
type EditCall = { callId: string; arguments: unknown };

class EditSeam {
  private armed = false;
  private gate: Promise<void> = Promise.resolve();
  private openGate: (() => void) | null = null;
  private waiters: Array<() => void> = [];
  readonly calls: EditCall[] = [];

  arm(): void {
    this.armed = true;
    this.calls.length = 0;
    this.gate = new Promise<void>((resolve) => { this.openGate = resolve; });
  }
  release(): void {
    this.armed = false;
    this.openGate?.();
    this.openGate = null;
  }
  async waitForCall(): Promise<void> {
    if (this.calls.length > 0) return;
    await new Promise<void>((resolve) => { this.waiters.push(resolve); });
  }
  private async block(): Promise<void> { if (this.armed) await this.gate; }
  private stub(): ToolDefinition {
    return {
      name: 'edit',
      description: 'K3 stand-in edit (real workspace_write class; blocks until released)',
      inputSchema: z.object({ mode: z.string(), path: z.string() }).loose(),
      // 9(c): keep the REAL class and capabilities (`edit-tool.js:118-128`),
      // change nothing but the blocking handler.
      effectClass: 'workspace_write',
      requiredCapabilities: ['workspace_read', 'workspace_write'],
      independentReadOnly: false,
      defaultTimeoutMs: 15_000,
      outputLimitBytes: 32 * 1024,
      summarize: (argumentsValue) => ({ paths: [String(argumentsValue['path'] ?? '')], cwd: null, commandPreview: 'K3 edit' }),
      handler: {
        execute: async (call) => {
          this.calls.push({ callId: call.callId, arguments: call.arguments });
          for (const waiter of this.waiters.splice(0)) waiter();
          await this.block();
          return { schemaVersion: 1, callId: call.callId, status: 'success', output: [],
            effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } };
        },
      },
    } as ToolDefinition;
  }
  definition(actual: (workspace: never) => ToolDefinition, workspace: never): ToolDefinition {
    return this.armed ? this.stub() : actual(workspace);
  }
}
const seams = vi.hoisted(() => ({ editSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js')>();
  return {
    ...actual,
    createEditToolDefinition: (workspace: Parameters<typeof actual.createEditToolDefinition>[0]): ToolDefinition =>
      (seams.editSeam as EditSeam).definition(actual.createEditToolDefinition as never, workspace as never),
  };
});
const editSeam = new EditSeam();
seams.editSeam = editSeam;

afterEach(async () => {
  editSeam.release();
  await cleanupScenarios();
  await cleanupRestart();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function tempRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `k3-l6-${label}-`));
  roots.push(root);
  return root;
}

const SECRET = 'K3_L6_SECRET_TARGET_MUST_NOT_LEAK\n';
const SECRET_BASELINE = 'K3_L6_DIRTY_BASELINE_MUST_NOT_LEAK\n';

/** The prepared note of a stopped `start`, read through the public materials/open route. */
async function noteOfPrepared(h: HostScenario, prepared: ReturnType<typeof preparedOf>): Promise<string> {
  const read = await h.post<ReadResult<{ body: string }>>('materials/open',
    plain(AG2B_SCOPE, { ref: prepared.envelope.bundleRef, usage: 'historical_explanation' }));
  if (read.status !== 'ready') throw new Error(`the prepared manifest must be openable: ${JSON.stringify(read)}`);
  const manifest = JSON.parse(read.value.body) as { continuationBrief?: Parameters<typeof renderContinuationBriefZh>[0] };
  const brief = manifest.continuationBrief;
  if (brief === undefined) throw new Error('the prepared manifest must carry the continuation brief');
  return renderContinuationBriefZh(brief, continuationBriefDigest(brief));
}

describe('K3 L6 symlink and protection reads', () => {
  it('K3-04 (L6): a symlink named by an edit call is not_text and its target is never read', async () => {
    const root = await tempRoot('symlink');
    await writeFile(join(root, '.env'), SECRET);
    await symlink('.env', join(root, 'src-link.ts'));

    const read = await readContinuationCurrentFile(root, 'src-link.ts', WORKSPACE_DENIED_PREFIXES);

    expect(read).toEqual({ status: 'unavailable', reason: 'not_text' });
  });

  it('K3-04 (L6): a protected path is protected on the normalised workspace-relative path', async () => {
    const root = await tempRoot('protected');
    await writeFile(join(root, '.env'), SECRET);

    const read = await readContinuationCurrentFile(root, './.env', WORKSPACE_DENIED_PREFIXES);

    expect(read).toEqual({ status: 'unavailable', reason: 'protected' });
  });

  it('K3-04 (L6): a real path outside the real workspace root is refused', async () => {
    const root = await tempRoot('escape');
    const outside = await tempRoot('outside');
    await writeFile(join(outside, 'file.txt'), 'outside the root\n');
    await symlink(outside, join(root, 'escape-dir'));

    const read = await readContinuationCurrentFile(root, 'escape-dir/file.txt', WORKSPACE_DENIED_PREFIXES);

    expect(read).toEqual({ status: 'unavailable', reason: 'the path is outside the workspace root' });
  });

  it('K3-04 (L6): a directory symlink into a protected directory is protected and its target is never read', async () => {
    const root = await tempRoot('symlink-dir');
    await mkdir(join(root, 'hidden-tests'));
    await writeFile(join(root, 'hidden-tests', 'a.txt'), SECRET);
    await symlink('hidden-tests', join(root, 'pub'));

    const read = await readContinuationCurrentFile(root, 'pub/a.txt', WORKSPACE_DENIED_PREFIXES);

    expect(read).toEqual({ status: 'unavailable', reason: 'protected' });
  });

  it('K3-04 (L6): an edit path replaced by a symlink to a protected file is status only with no target bytes in the note', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    await writeFile(join(h.root, '.env'), SECRET);
    const toStart = await h.advance(h.select('k3-l6-link', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    const prepared = preparedOf(toStart.next);

    editSeam.arm();
    const model = createScriptedModel([{ kind: 'calls', calls: [
      { callId: 'k3-l6-link-edit', name: 'edit', args: { mode: 'replace', path: 'src/module.ts',
        oldText: 'SCENARIO_GIT_BASELINE', newText: 'K3_L6_LINK_CHANGED' } }] }]);
    const root = await openWorkRoot(h, model);
    let running: Promise<unknown> | null = null;
    try {
      running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: 'k3-l6-link-start' });
      await editSeam.waitForCall();
      // While the edit is in flight, the path becomes a symlink to the protected file.
      await rm(join(h.root, 'src', 'module.ts'));
      await symlink('.env', join(h.root, 'src', 'module.ts'));
      await h.restart({ crash: true });
    } finally {
      editSeam.release();
      await running?.catch(() => undefined);
      await root.close();
    }

    const toContinue = await h.advance(h.select('k3-l6-link', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    const note = await noteOfPrepared(h, preparedOf(toContinue.next));

    expect(note).toContain('src/module.ts');
    // No diff and no bytes of the protected target anywhere.
    expect(note).not.toContain(SECRET.trim());
    expect(note).toContain('不是文本文件');
  }, 180_000);

  it('K3-04 (L6): an edit path under a public directory symlinked to a protected directory is protected, no target bytes in the note', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    await mkdir(join(h.root, 'hidden-tests'));
    await writeFile(join(h.root, 'hidden-tests', 'module.ts'), SECRET);
    const toStart = await h.advance(h.select('k3-l6-dir-link', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    const prepared = preparedOf(toStart.next);

    editSeam.arm();
    const model = createScriptedModel([{ kind: 'calls', calls: [
      { callId: 'k3-l6-dir-link-edit', name: 'edit', args: { mode: 'replace', path: 'src/module.ts',
        oldText: 'SCENARIO_GIT_BASELINE', newText: 'K3_L6_DIR_LINK_CHANGED' } }] }]);
    const root = await openWorkRoot(h, model);
    let running: Promise<unknown> | null = null;
    try {
      running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: 'k3-l6-dir-link-start' });
      await editSeam.waitForCall();
      // While the edit is in flight, the public directory becomes a symlink to
      // the protected directory; the path's real target is protected content.
      await rm(join(h.root, 'src'), { recursive: true, force: true });
      await symlink('hidden-tests', join(h.root, 'src'));
      await h.restart({ crash: true });
    } finally {
      editSeam.release();
      await running?.catch(() => undefined);
      await root.close();
    }

    const toContinue = await h.advance(h.select('k3-l6-dir-link', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    const note = await noteOfPrepared(h, preparedOf(toContinue.next));

    expect(note).toContain('src/module.ts');
    // No diff and no bytes of the protected target anywhere.
    expect(note).not.toContain(SECRET.trim());
    expect(note).toContain('受保护路径');
  }, 180_000);

  it('K3-04 (L6): a path with a baseline entry is status only (baseline_dirty), never reading HEAD or a baseline blob', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    // Dirty at Run start: the start baseline records `present` with a blob id.
    await writeFile(join(h.root, 'src', 'module.ts'), SECRET_BASELINE);
    const toStart = await h.advance(h.select('k3-l6-dirty', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    const prepared = preparedOf(toStart.next);

    editSeam.arm();
    const model = createScriptedModel([{ kind: 'calls', calls: [
      { callId: 'k3-l6-dirty-edit', name: 'edit', args: { mode: 'replace', path: 'src/module.ts',
        oldText: 'K3_L6_DIRTY', newText: 'K3_L6_DIRTY_CHANGED' } }] }]);
    const root = await openWorkRoot(h, model);
    let running: Promise<unknown> | null = null;
    try {
      running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: 'k3-l6-dirty-start' });
      await editSeam.waitForCall();
      await writeFile(join(h.root, 'src', 'module.ts'), 'K3_L6_DIRTY_CHANGED\n');
      await h.restart({ crash: true });
    } finally {
      editSeam.release();
      await running?.catch(() => undefined);
      await root.close();
    }

    const toContinue = await h.advance(h.select('k3-l6-dirty', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    const note = await noteOfPrepared(h, preparedOf(toContinue.next));

    expect(note).toContain('src/module.ts');
    expect(note).toContain('开始时这个路径不是干净的基准');
    expect(note).not.toContain(SECRET_BASELINE.trim());
  }, 180_000);
});

