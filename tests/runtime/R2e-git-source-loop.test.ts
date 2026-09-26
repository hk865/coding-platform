/**
 * R2e.2 real B2 Runtime consumption of the Git project_source wire.
 *
 * This uses the existing `createB2RuntimeFixture` (real TaskClaim/prepare/start, frozen Kernel,
 * scripted local ModelClient) with the public `workspaceHost`/`sourcePolicyFor` overrides bound
 * to the fixture's registered root. A real temporary Git repository is built inside that root.
 * The scripted model actually calls `project_source` Git read and Git compare, and the next
 * model request is checked for the complete typed result. At the skeleton stage the request
 * reaches the bound capability and stops at `unsupported`, so the target-contract assertions
 * are RED exactly there; the real prepare/start, Kernel loop and fixture cleanup stay exercised.
 */
import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { GitWorkingTreeComparison, GitWorkspaceComparison, WorkspaceFile, WorkspaceResult } from '../../src/core/workspace/ports.js';
import { createB2RuntimeFixture, type B2RuntimeFixture, type ScriptedReply } from '../helpers/B2-runtime-fixture.js';

const exec = promisify(execFile);
const fixtures: B2RuntimeFixture[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(fixture => fixture.close())); });

const runGit = async (root: string, args: string[]) => (await exec('git', ['-C', root, ...args], { windowsHide: true })).stdout;
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

/** Decode only the JSON the real Kernel inserted into the next model request. */
function toolResult<T>(request: ModelRequest, callId: string): T {
  const message = request.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
  expect(message, `Missing Kernel result for ${callId}`).toBeDefined();
  if (!message || message.role !== 'tool') throw Error(`Missing tool result for ${callId}`);
  expect(message.result.status, JSON.stringify(message.result)).toBe('success');
  const output = message.result.output.find(part => part.kind === 'json');
  if (!output || output.kind !== 'json') throw Error(`No JSON result for ${callId}`);
  const result = output.value as unknown as WorkspaceResult<T>;
  expect(result.status, JSON.stringify(result)).toBe('ready');
  if (result.status !== 'ready') throw Error(`${result.code}: ${result.reason}`);
  return result.value;
}

it('serves Git read and compare to a real B2 Kernel/model loop through project_source', async () => {
  const replies: ScriptedReply[] = [];
  const fx = await createB2RuntimeFixture({ scriptedReplies: replies });
  fixtures.push(fx);

  // A real Git repository in the fixture's registered root.
  await runGit(fx.directory, ['init', '-q']);
  await runGit(fx.directory, ['config', 'user.name', 'B2 Git test']);
  await runGit(fx.directory, ['config', 'user.email', 'b2-git@example.invalid']);
  await mkdir(join(fx.directory, 'docs'), { recursive: true });
  await writeFile(join(fx.directory, 'docs/history.txt'), 'original history\n');
  await runGit(fx.directory, ['add', 'docs/history.txt']);
  await runGit(fx.directory, ['commit', '-q', '-m', 'history base']);
  const commit1 = (await runGit(fx.directory, ['rev-parse', 'HEAD'])).trim();
  await writeFile(join(fx.directory, 'docs/history.txt'), 'updated history\n');
  await runGit(fx.directory, ['add', 'docs/history.txt']);
  await runGit(fx.directory, ['commit', '-q', '-m', 'history update']);
  const commit2 = (await runGit(fx.directory, ['rev-parse', 'HEAD'])).trim();

  replies.push(
    { kind: 'calls', calls: [{ callId: 'git-read', name: 'project_source', args: {
      action: 'read', path: 'docs/history.txt', maxBytes: 8192, version: { kind: 'git', commit: commit1 } } }] },
    { kind: 'calls', calls: [{ callId: 'git-compare', name: 'project_source', args: {
      action: 'compare', before: { kind: 'git', commit: commit1 }, after: { kind: 'git', commit: commit2 }, prefix: 'docs' } }] },
    { kind: 'text', text: 'read and compared Git history' },
  );

  // The trusted Host override binds the fixture's real registered root and read scope; the
  // source policy is the same mount and grant the Runtime source factory consumes.
  const allowsRead = (path: string) => path === 'b2-read.txt' || path === 'docs' || path.startsWith('docs/');
  const runtime = fx.rebuild({
    workspaceHost: {
      async resolveRoot(scope) {
        return scope.projectId === fx.scope.projectId && scope.workspaceId === fx.scope.workspaceId
          ? { status: 'ready', value: { root: fx.directory, workspaceRevision: 1 } }
          : { status: 'rejected', code: 'forbidden', reason: 'unknown test scope' };
      },
      async authorize(ctx, scope) {
        if (ctx.projectId !== fx.scope.projectId || ctx.workspaceId !== fx.scope.workspaceId
            || scope.projectId !== ctx.projectId || scope.workspaceId !== ctx.workspaceId)
          return { status: 'rejected', code: 'forbidden', reason: 'test scope mismatch' };
        return { status: 'ready', value: { subjectKey: 'b2-git-reader', permissionRevision: 'b2-git@1', allowsRead } };
      },
    },
    sourcePolicyFor: async () => ({ root: fx.directory, permissionRevision: 'b2-git@1', allowsRead }),
  });

  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 'r2e-git-prepare' });
  expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
  if (prepared.status !== 'ready') return;
  const started = await runtime.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'r2e-git-consumer', requestId: 'r2e-git-start' });
  expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready' });
  expect(fx.scripted.calls()).toBe(3);

  // Both Git actions were schema-valid and actually dispatched by the Kernel tool loop.
  const finalRequest = fx.scripted.requests[2]!;
  for (const callId of ['git-read', 'git-compare']) {
    const message = finalRequest.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
    if (!message || message.role !== 'tool') throw Error(`missing dispatches tool result for ${callId}`);
    expect(message.result.status, `${callId} must be a dispatched tool result`).toBe('success');
  }

  // The existing public execution reader observes a normal terminal: Run ended, occupancy released.
  const record = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(record.status, JSON.stringify(record)).toBe('ready');
  if (record.status !== 'ready') return;
  expect(record.value.run.status).toBe('ended');
  expect(record.value.session.occupancy).toBeNull();

  // The model really received the tool, and the next request carries its complete typed result.
  const read = toolResult<WorkspaceFile>(fx.scripted.requests[1]!, 'git-read');
  expect(read).toMatchObject({
    path: 'docs/history.txt', content: 'original history\n', digest: sha256('original history\n'),
    sizeBytes: Buffer.byteLength('original history\n'), digestBasis: 'raw_bytes', version: { kind: 'git', commit: commit1 },
  });
  const comparison = toolResult<GitWorkspaceComparison>(fx.scripted.requests[2]!, 'git-compare');
  expect(comparison).toMatchObject({
    before: { kind: 'git', commit: commit1 }, after: { kind: 'git', commit: commit2 },
    scope: { kind: 'git_regular_files', selectionVersion: 'authorized-regular-blob-v1', prefix: 'docs' },
    comparison: 'git_tree_content_and_mode', complete: true,
  });
  expect(comparison.changes).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'modified', path: 'docs/history.txt' }),
  ]));
});


/**
 * The mixed normal chain: one fixed Git commit against the modified working tree, in both
 * directions. The same real B2 prepare/start, frozen Kernel and scripted model are reused; both
 * `project_source` calls must reach the bound capability and the next model request must carry the
 * complete typed result (original commit OID, raw-byte digest, owner-executable mode and input
 * direction). Phase one stops at the explicit `unsupported` mixed seam, so the target-contract
 * assertions below are RED exactly there; prepare/start, tool dispatch, the terminal release and
 * both schema-valid dispatches stay green.
 */
it('compares a fixed Git version with the modified working tree in both directions through a real B2 Kernel/model loop', async () => {
  const replies: ScriptedReply[] = [];
  const fx = await createB2RuntimeFixture({ scriptedReplies: replies });
  fixtures.push(fx);

  await runGit(fx.directory, ['init', '-q']);
  await runGit(fx.directory, ['config', 'user.name', 'B2 Git test']);
  await runGit(fx.directory, ['config', 'user.email', 'b2-git@example.invalid']);
  await mkdir(join(fx.directory, 'docs'), { recursive: true });

  const modifiedBase = 'modified base body\n';
  const modifiedAfter = 'modified after body\n';
  const modeBody = '#!/bin/sh\necho mode\n';
  const deletedBody = 'deleted body\n';
  await writeFile(join(fx.directory, 'docs/modified.txt'), modifiedBase);
  await writeFile(join(fx.directory, 'docs/mode.sh'), modeBody);
  await writeFile(join(fx.directory, 'docs/deleted.txt'), deletedBody);
  await runGit(fx.directory, ['add', 'docs/modified.txt', 'docs/mode.sh', 'docs/deleted.txt']);
  await runGit(fx.directory, ['commit', '-q', '-m', 'mixed text baseline']);
  const commit = (await runGit(fx.directory, ['rev-parse', 'HEAD'])).trim();

  // The current working tree holds one content edit, one mode-only edit, one addition and one deletion.
  await writeFile(join(fx.directory, 'docs/modified.txt'), modifiedAfter);
  await chmod(join(fx.directory, 'docs/mode.sh'), 0o755);
  await rm(join(fx.directory, 'docs/deleted.txt'));
  const addedBody = 'added body\n';
  await writeFile(join(fx.directory, 'docs/added.txt'), addedBody);

  replies.push(
    { kind: 'calls', calls: [{ callId: 'mixed-git-first', name: 'project_source', args: {
      action: 'compare', before: { kind: 'git', commit }, after: { kind: 'working_tree' }, prefix: 'docs' } }] },
    { kind: 'calls', calls: [{ callId: 'mixed-tree-first', name: 'project_source', args: {
      action: 'compare', before: { kind: 'working_tree' }, after: { kind: 'git', commit }, prefix: 'docs' } }] },
    { kind: 'text', text: 'compared the working tree against the fixed Git version' },
  );

  // The trusted Host override binds the fixture's real registered root and read scope; the source
  // policy is the same mount and grant the Runtime source factory consumes.
  const allowsRead = (path: string) => path === 'b2-read.txt' || path === 'docs' || path.startsWith('docs/');
  const runtime = fx.rebuild({
    workspaceHost: {
      async resolveRoot(scope) {
        return scope.projectId === fx.scope.projectId && scope.workspaceId === fx.scope.workspaceId
          ? { status: 'ready', value: { root: fx.directory, workspaceRevision: 1 } }
          : { status: 'rejected', code: 'forbidden', reason: 'unknown test scope' };
      },
      async authorize(ctx, scope) {
        if (ctx.projectId !== fx.scope.projectId || ctx.workspaceId !== fx.scope.workspaceId
            || scope.projectId !== ctx.projectId || scope.workspaceId !== ctx.workspaceId)
          return { status: 'rejected', code: 'forbidden', reason: 'test scope mismatch' };
        return { status: 'ready', value: { subjectKey: 'b2-git-reader', permissionRevision: 'b2-git@1', allowsRead } };
      },
    },
    sourcePolicyFor: async () => ({ root: fx.directory, permissionRevision: 'b2-git@1', allowsRead }),
  });

  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 'r2e-mixed-prepare' });
  expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
  if (prepared.status !== 'ready') return;
  const started = await runtime.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'r2e-mixed-consumer', requestId: 'r2e-mixed-start' });
  expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready' });
  expect(fx.scripted.calls()).toBe(3);

  // Both mixed actions were schema-valid and actually dispatched by the Kernel tool loop.
  const finalRequest = fx.scripted.requests[2]!;
  for (const callId of ['mixed-git-first', 'mixed-tree-first']) {
    const message = finalRequest.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
    if (!message || message.role !== 'tool') throw Error(`missing dispatched tool result for ${callId}`);
    expect(message.result.status, `${callId} must be a dispatched tool result`).toBe('success');
  }

  // The existing public execution reader observes a normal terminal: Run ended, occupancy released.
  const record = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(record.status, JSON.stringify(record)).toBe('ready');
  if (record.status !== 'ready') return;
  expect(record.value.run.status).toBe('ended');
  expect(record.value.session.occupancy).toBeNull();

  // Raw-byte identities computed from the real baseline and working-tree bodies. The historical
  // side is the blob's raw-byte SHA-256 (never a Git object id); mode is owner-executable normalized.
  const modified = { digest: sha256(modifiedAfter), digestBasis: 'raw_bytes', sizeBytes: Buffer.byteLength(modifiedAfter), mode: '100644' };
  const modifiedBefore = { digest: sha256(modifiedBase), digestBasis: 'raw_bytes', sizeBytes: Buffer.byteLength(modifiedBase), mode: '100644' };
  const modeIdentity = { digest: sha256(modeBody), digestBasis: 'raw_bytes', sizeBytes: Buffer.byteLength(modeBody) };
  const deleted = { digest: sha256(deletedBody), digestBasis: 'raw_bytes', sizeBytes: Buffer.byteLength(deletedBody), mode: '100644' };
  const added = { digest: sha256(addedBody), digestBasis: 'raw_bytes', sizeBytes: Buffer.byteLength(addedBody), mode: '100644' };

  // Git first, then the current working tree: the original commit OID and direction are preserved,
  // and every identity is the raw-byte digest with the exact owner-executable mode.
  const gitFirst = toolResult<GitWorkingTreeComparison>(fx.scripted.requests[1]!, 'mixed-git-first');
  expect(gitFirst).toMatchObject({
    before: { kind: 'git', commit }, after: { kind: 'working_tree' },
    scope: { kind: 'text_files', selectionVersion: 'readable-regular-utf8-no-nul-v1', prefix: 'docs', digestBasis: 'raw_bytes' },
    comparison: 'git_worktree_raw_content_and_mode', complete: true, currentness: 'not_rechecked',
  });
  expect(gitFirst.observedAt).toEqual(expect.any(String));
  expect(gitFirst.changes).toHaveLength(4);
  expect(gitFirst.changes).toEqual(expect.arrayContaining([
    { kind: 'modified', path: 'docs/modified.txt', before: modifiedBefore, after: modified },
    { kind: 'modified', path: 'docs/mode.sh', before: { ...modeIdentity, mode: '100644' }, after: { ...modeIdentity, mode: '100755' } },
    { kind: 'added', path: 'docs/added.txt', after: added },
    { kind: 'deleted', path: 'docs/deleted.txt', before: deleted },
  ]));

  // The reverse call keeps the opposite direction and swaps every before/after identity.
  const treeFirst = toolResult<GitWorkingTreeComparison>(fx.scripted.requests[2]!, 'mixed-tree-first');
  expect(treeFirst).toMatchObject({
    before: { kind: 'working_tree' }, after: { kind: 'git', commit },
    scope: { kind: 'text_files', selectionVersion: 'readable-regular-utf8-no-nul-v1', prefix: 'docs', digestBasis: 'raw_bytes' },
    comparison: 'git_worktree_raw_content_and_mode', complete: true, currentness: 'not_rechecked',
  });
  expect(treeFirst.changes).toHaveLength(4);
  expect(treeFirst.changes).toEqual(expect.arrayContaining([
    { kind: 'modified', path: 'docs/modified.txt', before: modified, after: modifiedBefore },
    { kind: 'modified', path: 'docs/mode.sh', before: { ...modeIdentity, mode: '100755' }, after: { ...modeIdentity, mode: '100644' } },
    { kind: 'added', path: 'docs/deleted.txt', after: deleted },
    { kind: 'deleted', path: 'docs/added.txt', before: added },
  ]));
});
