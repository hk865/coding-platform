/**
 * PC-2 row PC-23: the prompt directory is never inside a workspace (host.ts).
 *
 * State is reached only through the frozen fixture: a real Host start over a
 * temporary directory tree, and the settings route for opening a workspace.
 * Expected messages are the production reason text naming both paths.
 */
import { describe, expect, it } from 'vitest';
import { copyFile, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  openPC2DirectoryCase, openPC2HostFixture, type PC2DirectoryRelation,
} from '../helpers/PC2-host-fixture.js';
import { pc2PackEntry } from '../helpers/PC2-pack-fixture.js';

const RELATIONS: readonly PC2DirectoryRelation[] = ['settings-inside', 'prompts-inside', 'equal', 'symlink'];
const REGISTRATIONS = ['configured', 'restored'] as const;

describe('PC-23 start-up and opening checks', () => {
  for (const registration of REGISTRATIONS) {
    for (const relation of RELATIONS) {
      it(`PC-23 ${registration} ${relation} root fails start and names both paths`, async () => {
        const setup = await openPC2DirectoryCase(relation, registration);
        try {
          // The profile below writes one pack into its own prompts directory;
          // the expected real prompt path is the symlink target for `symlink`.
          const expectedPrompts = relation === 'symlink'
            ? join(setup.root, 'linked-prompts') : setup.promptsDirectory;
          let error: Error | undefined;
          try { await setup.start(); }
          catch (caught) { error = caught as Error; }
          expect(error).toBeInstanceOf(Error);
          expect(error?.message).toContain(setup.root);
          expect(error?.message).toContain(expectedPrompts);
          expect(error?.message).toContain('prompt directory');
        } finally { await setup.close(); }
      });
    }
  }

  it('PC-23 opening an ancestor of prompts is invalid and an unrelated directory opens', async () => {
    const fixture = await openPC2HostFixture();
    try {
      const ancestor = await fixture.call('workspaces/open', {
        path: fixture.paths.settingsDirectory, writeAllowed: false, commandsAllowed: false,
      });
      expect(ancestor.status).toBe(400);
      expect(ancestor.body.status).toBe('rejected');
      if (ancestor.body.status === 'rejected') {
        expect(ancestor.body.code).toBe('invalid');
        expect(ancestor.body.reason).toContain(fixture.paths.promptsDirectory);
        expect(ancestor.body.reason).toContain('would cover the prompt directory');
      }

      const unrelated = await fixture.call('workspaces/open', {
        path: fixture.paths.unrelated, writeAllowed: false, commandsAllowed: false,
      });
      expect(unrelated.status).toBe(200);
      expect(unrelated.body.status).toBe('ready');
    } finally { await fixture.close(); }
  });

  it('H-01 a configured root that cannot be resolved fails start naming the root and prompts', async () => {
    const fixture = await openPC2HostFixture({ start: false });
    try {
      const root = join(fixture.paths.directory, 'missing-root');
      let error: Error | undefined;
      try {
        await fixture.start({
          settings: { settingsDirectory: fixture.paths.settingsDirectory },
          workspaces: [{
            scope: fixture.scope, name: 'Missing root', root, workspaceRevision: 1, readPrefixes: ['.'],
          }],
        });
      } catch (caught) { error = caught as Error; }
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toContain(root);
      expect(error?.message).toContain(fixture.paths.promptsDirectory);
      expect(error?.message).toContain('prompt directory');
    } finally { await fixture.close(); }
  });

  it('H-02 every restored root is checked before any restore runs', async () => {
    const fixture = await openPC2HostFixture({ start: false });
    try {
      const area = join(fixture.paths.directory, 'restore-order');
      const rootA = join(area, 'a');
      const rootB = join(area, 'b');
      const settingsDirectory = join(area, 'settings');
      const promptsDirectory = join(settingsDirectory, 'prompts');
      const staging = join(fixture.paths.directory, 'restore-staging');
      await mkdir(rootA, { recursive: true });
      await mkdir(rootB, { recursive: true });
      await mkdir(promptsDirectory, { recursive: true });
      // Both roots are registered through the public route; the settings file
      // is copied unchanged into the directory used by the checked start.
      await fixture.start({ settings: { settingsDirectory: staging }, workspaces: [] });
      for (const root of [rootA, rootB]) {
        const opened = await fixture.call('workspaces/open', {
          path: root, writeAllowed: false, commandsAllowed: false,
        });
        expect(opened.status).toBe(200);
      }
      await fixture.stop();
      await copyFile(join(staging, 'host-settings.json'), join(settingsDirectory, 'host-settings.json'));
      // A now resolves but cannot be restored as a workspace; B now resolves
      // through a link to the prompts parent. Neither restore may run before
      // B's check rejects the start.
      await rm(rootA, { recursive: true });
      await writeFile(rootA, 'not a directory', 'utf8');
      await rm(rootB, { recursive: true });
      await symlink(settingsDirectory, rootB, 'dir');
      let error: Error | undefined;
      try {
        await fixture.start({ settings: { settingsDirectory }, workspaces: [] });
      } catch (caught) { error = caught as Error; }
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toContain(settingsDirectory);
      expect(error?.message).toContain(promptsDirectory);
      expect(error?.message).toContain('prompt directory');
    } finally { await fixture.close(); }
  });

  it('H-11 a sibling whose name is a string prefix of prompts opens', async () => {
    const fixture = await openPC2HostFixture();
    try {
      const sibling = join(fixture.paths.settingsDirectory, 'prompt');
      await mkdir(sibling, { recursive: true });
      const opened = await fixture.call('workspaces/open', {
        path: sibling, writeAllowed: false, commandsAllowed: false,
      });
      expect(opened.status).toBe(200);
      expect(opened.body.status).toBe('ready');
    } finally { await fixture.close(); }
  });

  it('H-11 a registered root that later resolves over prompts is invalid when reopened', async () => {
    const fixture = await openPC2HostFixture();
    try {
      const root = join(fixture.paths.directory, 'moved-root');
      await mkdir(root, { recursive: true });
      const first = await fixture.call('workspaces/open', {
        path: root, writeAllowed: false, commandsAllowed: false,
      });
      expect(first.status).toBe(200);
      await rm(root, { recursive: true });
      await symlink(fixture.paths.settingsDirectory, root, 'dir');
      const again = await fixture.call('workspaces/open', {
        path: root, writeAllowed: false, commandsAllowed: false,
      });
      expect(again.status).toBe(400);
      expect(again.body.status).toBe('rejected');
      if (again.body.status !== 'rejected') return;
      expect(again.body.code).toBe('invalid');
      expect(again.body.reason).toContain(fixture.paths.promptsDirectory);
      expect(again.body.reason).toContain('would cover the prompt directory');
    } finally { await fixture.close(); }
  });

  it('PC-23 a prompts/mine link to a workspace is rejected by the pack path check', async () => {
    const fixture = await openPC2HostFixture();
    try {
      const pack = pc2PackEntry('pc2-mine', { templates: { base: 'MINE' } });
      await fixture.linkPack(pack);
      const read = await fixture.call('prompts/templates/read', { packId: 'pc2-mine', templateId: 'base' });
      expect(read.status).toBe(400);
      expect(read.body.status).toBe('rejected');
      if (read.body.status === 'rejected') {
        expect(read.body.code).toBe('invalid');
        expect(read.body.problems?.length).toBeGreaterThan(0);
        expect(read.body.problems?.some(entry => entry.reason.includes('outside the prompt directory'))).toBe(true);
      }
    } finally { await fixture.close(); }
  });
});
