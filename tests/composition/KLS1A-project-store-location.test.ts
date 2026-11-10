/**
 * KLS-1a project store location, paths and Kernel entry (P1-P3, L1-L5).
 *
 * The four names and the Kernel entry are pure functions (A5); the location rows
 * call the real `projectStoreLocation` and the real `gitCommonDir`, injecting only
 * the mount detector. L4b keeps the real mount detector and injects one file-system
 * fault instead: `realpath` of the candidate fails with EIO, and `/proc/mounts`
 * reads a fixed table so an ancestor's drive would be judged reliable. No store,
 * platform or Host is imported here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { initGitWorkspace } from '../scenarios/support/git-workspace.js';
import {
  PROJECT_HASH, PROJECT_ID, WORKSPACE_HASH, WORKSPACE_ID, cleanupRestart, locationModule, pathsModule,
  tempDir, workspaceModule, type LoadedModule,
} from '../helpers/KLS1A-project-store-fixture.js';

/** L4b's file-system fault; every other call goes to the real module. */
const fault = vi.hoisted(() => ({ realpathOf: null as string | null, mounts: null as string | null }));
vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  const realRealpath = original.realpath as (...args: unknown[]) => Promise<string>;
  const realReadFile = original.readFile as (...args: unknown[]) => Promise<unknown>;
  return {
    ...original,
    realpath: (path: unknown, ...rest: unknown[]) => path === fault.realpathOf
      ? Promise.reject(Object.assign(new Error(`EIO: i/o error, realpath '${String(path)}'`), { code: 'EIO' }))
      : realRealpath(path, ...rest),
    readFile: (path: unknown, ...rest: unknown[]) => fault.mounts !== null && path === '/proc/mounts'
      ? Promise.resolve(fault.mounts)
      : realReadFile(path, ...rest),
  };
});

afterEach(cleanupRestart);
afterEach(() => { fault.realpathOf = null; fault.mounts = null; });

const unreliableReason = (candidate: string): string =>
  'the project store is kept in the local data directory because ' + candidate
  + ' is on a network or mounted drive whose file locks are unreliable';
const unknownReason = (candidate: string): string =>
  'the project store is kept in the local data directory because the drive type of ' + candidate
  + ' could not be determined';

type PathCase = [string, (module: LoadedModule) => unknown, unknown];

const pathCases: PathCase[] = [
  ['the five paths', module => module.projectStorePaths?.('/tmp/p'), {
    directory: '/tmp/p', ledger: '/tmp/p/ledger.sqlite', artifacts: '/tmp/p/artifacts.sqlite',
    index: '/tmp/p/index.sqlite', snapshots: '/tmp/p/knowledge-snapshots.sqlite',
  }],
  ['the Kernel directory', module => module.kernelStoreDirectory?.(module.projectStorePaths?.('/tmp/p')),
    '/tmp/p/kernel-stores'],
  ['the Kernel entry', module => module.kernelStoreEntry?.('/tmp/p/kernel-stores', PROJECT_ID, WORKSPACE_ID), {
    adapterId: `host-settings-kernel-${WORKSPACE_HASH}`, storeKey: `host-settings-kernel-${WORKSPACE_HASH}`,
    workspace: { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID },
    databasePath: `/tmp/p/kernel-stores/${WORKSPACE_HASH}.sqlite`,
  }],
];

describe('project store paths', () => {
  it.each(pathCases)('P1: %s has one spelling', async (_name, run, expected) => {
    expect(run(await pathsModule())).toEqual(expected);
  });
});

const mounts = 'rootfs / ext4 rw 0 0\nC:\\134 /mnt/c 9p rw 0 0\nserver:/x /mnt/nfs nfs4 rw 0 0\n';

describe('mount reliability', () => {
  it.each([
    ['the longest matching mount is ext4', mounts, '/home/u/repo/.git', 'reliable'],
    ['a 9p mount wins over /', mounts, '/mnt/c/repo/.git', 'unreliable'],
    ['an nfs4 mount', mounts, '/mnt/nfs/a', 'unreliable'],
    ['no mount line matches', '', '/x', 'unknown'],
  ])('P2: %s', async (_name, text, path, expected) => {
    const { reliabilityFromMounts } = await locationModule();
    expect(reliabilityFromMounts?.(text, path)).toBe(expected);
  });

  it.each([
    ['drive type 4 is a network drive', '4\r\n', 'unreliable'],
    ['drive type 3 is fixed', '3', 'reliable'],
    ['drive type 2 is removable', '2', 'reliable'],
    ['drive type 6 is a ram disk', '6', 'reliable'],
    ['drive type 5 is unknown', '5', 'unknown'],
    ['an empty answer is unknown', '', 'unknown'],
    ['a word is not a drive type', 'Remote', 'unknown'],
  ])('P3: %s', async (_name, text, expected) => {
    const { reliabilityFromDriveType } = await locationModule();
    expect(reliabilityFromDriveType?.(text)).toBe(expected);
  });
});

describe('project store location', () => {
  let repo: string;
  let plain: string;
  let repoCandidate: string;
  let plainCandidate: string;

  const candidateOf = async (repoRoot: string): Promise<string> =>
    join(await realpath(repoRoot), '.git', 'workbench', 'projects', PROJECT_HASH);

  it.each(['git-common', 'workspace-local'] as const)('L3: an unreliable %s candidate falls back to user data',
    async kind => {
      const root = kind === 'git-common' ? repo : plain;
      const candidate = kind === 'git-common' ? repoCandidate : plainCandidate;
      const { projectStoreLocation } = await locationModule();
      const location = await projectStoreLocation?.(PROJECT_ID, root, {
        mountReliability: async (checked: string) => checked === candidate ? 'unreliable' : 'reliable',
        userDataRoot: () => '/data',
      });
      expect(location?.status).toBe('ready');
      expect(location.value.place).toBe('user-data');
      expect(location.value.directory).toBe(`/data/projects/${PROJECT_HASH}`);
      expect(location.value.reason).toBe(unreliableReason(candidate));
    });

  it('L4: an undetermined drive type falls back to user data without throwing', async () => {
    const { projectStoreLocation } = await locationModule();
    const location = await projectStoreLocation?.(PROJECT_ID, plain, {
      mountReliability: async () => 'unknown', userDataRoot: () => '/data',
    });
    expect(location?.status).toBe('ready');
    expect(location.value.place).toBe('user-data');
    expect(location.value.directory).toBe(`/data/projects/${PROJECT_HASH}`);
    expect(location.value.reason).toBe(unknownReason(plainCandidate));
  });

  it('L4b: a candidate whose drive cannot be read (EIO) falls back to user data, not to an ancestor\'s drive',
    async () => {
      fault.realpathOf = plainCandidate;
      fault.mounts = 'rootfs / ext4 rw 0 0\n';
      const { projectStoreLocation } = await locationModule();
      const location = await projectStoreLocation?.(PROJECT_ID, plain, { userDataRoot: () => '/data' });
      expect(location?.status).toBe('ready');
      expect(location.value.place).toBe('user-data');
      expect(location.value.directory).toBe(`/data/projects/${PROJECT_HASH}`);
      expect(location.value.reason).toBe(unknownReason(plainCandidate));
    });

  beforeEach(async () => {
    repo = await tempDir('kls1a-repo-');
    await initGitWorkspace(repo);
    plain = await tempDir('kls1a-plain-');
    repoCandidate = await candidateOf(repo);
    plainCandidate = join(plain, '.workbench', 'local', 'projects', PROJECT_HASH);
  });

  it('L1: a git repository keeps the store under the common dir, named by projectId', async () => {
    const { projectStoreLocation } = await locationModule();
    const location = await projectStoreLocation?.(PROJECT_ID, repo, {
      mountReliability: async () => 'reliable',
    });
    expect(location?.status).toBe('ready');
    expect(location.value.place).toBe('git-common');
    expect(location.value.directory).toBe(repoCandidate);
    expect(location.value.reason).toBeNull();
  });

  it('L2: a plain root keeps the store under .workbench/local, named by projectId', async () => {
    const { projectStoreLocation } = await locationModule();
    const location = await projectStoreLocation?.(PROJECT_ID, plain, {
      mountReliability: async () => 'reliable',
    });
    expect(location?.status).toBe('ready');
    expect(location.value.place).toBe('workspace-local');
    expect(location.value.directory).toBe(plainCandidate);
    expect(location.value.reason).toBeNull();
  });
});

describe('git common dir', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await tempDir('kls1a-common-');
    await initGitWorkspace(repo);
  });

  it.each([
    ['the repository root', () => repo],
    ['a subdirectory', () => join(repo, 'src')],
  ])('L5: %s answers the common dir', async (_name, at) => {
    const { gitCommonDir } = await workspaceModule();
    expect(await gitCommonDir?.(at())).toBe(await realpath(join(repo, '.git')));
  });

  it('L5: a plain directory answers null', async () => {
    const { gitCommonDir } = await workspaceModule();
    const plain = await tempDir('kls1a-not-git-');
    expect(await gitCommonDir?.(plain)).toBeNull();
  });
});
