import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SourceCaptureRef } from '../../src/contracts/core/source.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { WorkspaceToolsHandle } from '../../src/core/workspace/workspace-tools.js';
import { gitIn } from '../scenarios/support/git-workspace.js';
import { ready, workspaceToolsFixture, type Entry, type WorkspaceToolsFixtureDefaults } from './workspace-tools-fixture.js';

export type DuplicateCaptureWorldV1 = {
  handle: WorkspaceToolsHandle; workspace: WorkspaceRef; context: CoreCallContext; root: string;
  before: SourceCaptureRef; after: SourceCaptureRef;
  edit(path: string, body: string | Uint8Array): Promise<void>;
};
export type DuplicateGitWorldV1 = {
  handle: WorkspaceToolsHandle; workspace: WorkspaceRef; context: CoreCallContext; root: string;
  commitBefore(): string; commitAfter(): string; runGit(args: string[]): Promise<string>;
};

/** The real worlds of the D rows: one capture pair over a temp root, one two-commit repo plus a working-tree edit. */
export function duplicatePairWorlds(defaults: Omit<WorkspaceToolsFixtureDefaults, 'now'>): {
  capturePair(input: { before: readonly Entry[]; after: readonly Entry[] }): Promise<DuplicateCaptureWorldV1>;
  gitWorld(input: { before: readonly Entry[]; after: readonly Entry[]; working: readonly Entry[] }): Promise<DuplicateGitWorldV1>;
} {
  const workspaceWorld = (entries: readonly Entry[]) =>
    workspaceToolsFixture({ ...defaults })([...entries]);
  // The fixture's `edit` writes the file but does not create a missing parent directory.
  const apply = async (
    root: string, edit: (path: string, body: string | Uint8Array) => Promise<void>, path: string, body: string | Uint8Array,
  ) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await edit(path, body);
  };
  return {
    async capturePair(input) {
      const world = await workspaceWorld(input.before);
      const before = ready(await world.handle.tools.captureSourceChanges(world.context, world.request)).ref;
      for (const [path, body] of input.after) await apply(world.root, world.edit, path, body);
      const after = ready(await world.handle.tools.captureSourceChanges(world.context, world.request)).ref;
      return {
        handle: world.handle, workspace: world.workspace, context: world.context, root: world.root,
        before, after, edit: world.edit,
      };
    },
    async gitWorld(input) {
      const world = await workspaceWorld(input.before);
      const { root } = world;
      gitIn(root, 'init', '--object-format=sha1');
      gitIn(root, 'add', '-A');
      gitIn(root, 'commit', '-q', '-m', 'before');
      const commitBefore = gitIn(root, 'rev-parse', 'HEAD').trim();
      for (const [path, body] of input.after) await apply(root, world.edit, path, body);
      gitIn(root, 'add', '-A');
      gitIn(root, 'commit', '-q', '--allow-empty', '-m', 'after');
      const commitAfter = gitIn(root, 'rev-parse', 'HEAD').trim();
      for (const [path, body] of input.working) await apply(root, world.edit, path, body);
      return {
        handle: world.handle, workspace: world.workspace, context: world.context, root,
        commitBefore: () => commitBefore, commitAfter: () => commitAfter,
        runGit: async args => gitIn(root, ...args),
      };
    },
  };
}
