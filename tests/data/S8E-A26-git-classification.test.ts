/**
 * §10 item 1 / book item 5 / Codex review item 5: a real Git failure is told apart from
 * "not a git repository" by a bounded diagnostic (exit status plus a cut of stderr), never by
 * the exit code alone; a cut listing reports the complete records actually read as "at least n".
 *
 * The fixtures are real temporary repositories written and committed with real `git`; the
 * production path under test is the real Workspace access factory and the observation capture.
 */
import { afterEach, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import { OBSERVATION_INVENTORY_CAPACITY } from '../../src/core/workspace/project-source-snapshot.js';
import { formatProjectListingCapacity } from '../../src/core/workspace/git-read.js';
import {
  git,
  observe,
  tempRoot,
  write,
  type ObservationWorld,
} from '../helpers/observation-source-fixture.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function committedRepo(): Promise<string> {
  const root = await tempRoot('s8e-a26-git-classification-', roots);
  await write(join(root, 'a.ts'), 'export const a = 1;\n');
  await git(root, 'init', '-q');
  await git(root, 'config', 'user.email', 'observation@example.test');
  await git(root, 'config', 'user.name', 'Observation Test');
  await git(root, 'add', 'a.ts');
  await git(root, 'commit', '-qm', 'fixture');
  return root;
}

const workspace: WorkspaceRef = {
  aggregateType: 'Workspace', projectId: 's8e-a26-project', workspaceId: 'workspace-main',
};

const world: ObservationWorld = {
  workspace,
  actor: { kind: 'human', id: 'a26-reader' },
  workspaceRevision: 1,
  subjectKey: 'host:a26-reader',
  permissionRevision: 'read-policy-1',
};

it('A-26 classifies a corrupt repository config as git unusable with a bounded exit-status diagnostic', async () => {
  const root = await committedRepo();
  // A real repository whose local config can no longer be parsed: Git itself still exits 128,
  // but its stderr says "bad config", not "not a git repository".
  await write(join(root, '.git/config'), 'not a git config line\n');

  const observed = await observe(world, root);
  expect(observed.inventory.source).toBe('skip_list');
  expect(observed.inventory.reason).not.toBe('不是 git 仓库');
  const reason = observed.inventory.reason ?? '';
  expect(reason.startsWith('git 不能用：')).toBe(true);
  // The exit status and a cut of Git's own stderr, not the old exit-code-only guess.
  expect(reason).toContain('128');
  expect(reason).toContain('bad config line');
  // Bounded: at most 200 characters of diagnostic behind the fixed record literal.
  expect(reason.length).toBeLessThanOrEqual('git 不能用：'.length + 200);
});

it('A-26 keeps a real non-repository directory as "not a git repository"', async () => {
  const root = await tempRoot('s8e-a26-git-classification-', roots);
  await write(join(root, 'a.ts'), 'export const a = 1;\n');

  const observed = await observe(world, root);
  expect(observed.inventory).toEqual({ source: 'skip_list', reason: '不是 git 仓库' });
});

it('A-26 classifies a listing command failure the same way, not as "not a git repository"', async () => {
  const root = await committedRepo();
  // The probe succeeds (`rev-parse --is-inside-work-tree` never reads the index) while the
  // listing command itself fails; this exercises the listing's own classification.
  await write(join(root, '.git/index'), 'garbage\n');

  const observed = await observe(world, root);
  expect(observed.inventory.source).toBe('skip_list');
  expect(observed.inventory.reason).not.toBe('不是 git 仓库');
  const reason = observed.inventory.reason ?? '';
  expect(reason.startsWith('git 不能用：')).toBe(true);
  expect(reason).toContain('128');
  expect(reason).toContain('index file');
  expect(reason.length).toBeLessThanOrEqual('git 不能用：'.length + 200);
});

it('A-26 formats the capacity message from the complete count and whether the listing was cut', () => {
  // A cut listing reports the complete NUL records actually read, never a made-up 60,001.
  expect(formatProjectListingCapacity(17, true)).toBe(OBSERVATION_INVENTORY_CAPACITY + ' (at least 17)');
  // A complete listing over the cap keeps the observed count.
  expect(formatProjectListingCapacity(60001, false)).toBe(OBSERVATION_INVENTORY_CAPACITY + ' (reached 60001)');
});
