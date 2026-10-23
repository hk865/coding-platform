/**
 * PC-2 rows PC-04 (route half) and PC-22 (save rejection): the six prompt-pack
 * editing routes over the real Host HTTP seam and the real disk tree.
 *
 * Expected versions are the frozen pack fixture's literals (base 7 -> 8); every
 * byte comparison is a snapshot of the pack directory before and after the
 * route call. No expected value is taken from the production resolver.
 */
import { describe, expect, it } from 'vitest';
import { mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPC2HostFixture } from '../helpers/PC2-host-fixture.js';
import { SETTINGS_API_PREFIX } from '../../src/app/host-settings-types.js';
import { createDiskPromptPackSource } from '../../src/app/prompt-packs.js';
import {
  PC2_OTHER_WORK_INPUT, PC2_WORK_INPUT, pc2PackCases, pc2PackEntry, snapshotPC2Pack, snapshotPC2Step,
} from '../helpers/PC2-pack-fixture.js';

describe('PC-04 prompt-pack routes', () => {
  it('PC-04 list is platform first and reads a parent template at its literal version', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ packs: cases.parentChain });
    try {
      const list = await fixture.call('prompts/packs/list', {});
      expect(list.status).toBe(200);
      expect(list.body.status).toBe('ready');
      if (list.body.status !== 'ready') return;
      expect(list.body.value.packs.map(pack => pack.packId)).toEqual(['platform', 'pc2-parent']);
      expect(list.body.value.packs[1]).toMatchObject({ packId: 'pc2-parent', extends: 'platform', problems: [] });

      const read = await fixture.call('prompts/templates/read', { packId: 'pc2-parent', templateId: 'base' });
      expect(read.status).toBe(200);
      expect(read.body.status).toBe('ready');
      if (read.body.status !== 'ready') return;
      expect(read.body.value).toEqual({
        templateId: 'base', version: 7, fromPack: 'pc2-parent', text: 'PARENT', slots: {}, mentionsTools: [],
      });
    } finally { await fixture.close(); }
  });

  it('PC-04 template save writes base@8, keeps base.txt and is visible to the next read', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ packs: cases.parentChain });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-parent');
    try {
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/templates/save', {
        packId: 'pc2-parent', templateId: 'base', expectedVersion: 7, text: 'NEW BASE', mentionsTools: ['read'],
      }));
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(200);
      expect(saved.outcome.value.body).toMatchObject({
        status: 'ready',
        value: { templateId: 'base', version: 8, fromPack: 'pc2-parent', text: 'NEW BASE', mentionsTools: ['read'] },
      });
      const after = await snapshotPC2Pack(directory);
      expect(saved.difference.removed).toEqual([]);
      expect(saved.difference.added).toEqual(['templates/base@8.txt']);
      expect(saved.difference.changed).toEqual(['pack.json']);
      const oldBytes = after['templates/base.txt'];
      expect(oldBytes?.kind).toBe('file');
      if (oldBytes?.kind === 'file') expect(oldBytes.bytes.toString('utf8')).toBe('PARENT');
      const newBytes = after['templates/base@8.txt'];
      expect(newBytes?.kind).toBe('file');
      if (newBytes?.kind === 'file') expect(newBytes.bytes.toString('utf8')).toBe('NEW BASE');

      const read = await fixture.call('prompts/templates/read', { packId: 'pc2-parent', templateId: 'base' });
      expect(read.body).toMatchObject({
        status: 'ready', value: { version: 8, fromPack: 'pc2-parent', text: 'NEW BASE', mentionsTools: ['read'] },
      });
    } finally { await fixture.close(); }
  });

  it('PC-04 an invalid save leaves every pack file byte-equal and carries problems', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ packs: cases.parentChain });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-parent');
    try {
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/templates/save', {
        packId: 'pc2-parent', templateId: 'base', expectedVersion: 7, text: '{{pc2_unknown}}', mentionsTools: [],
      }));
      expect(saved.difference.equal).toBe(true);
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(400);
      expect(saved.outcome.value.body.status).toBe('rejected');
      if (saved.outcome.value.body.status !== 'rejected') return;
      expect(saved.outcome.value.body.code).toBe('invalid');
      expect(saved.outcome.value.body.problems).toContainEqual({
        packId: 'pc2-parent', templateId: 'base', reason: 'slot "pc2_unknown" is not declared by template "base"',
      });
    } finally { await fixture.close(); }
  });

  it('PC-04 a stale version is revision_conflict and changes nothing', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ packs: cases.parentChain });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-parent');
    try {
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/templates/save', {
        packId: 'pc2-parent', templateId: 'base', expectedVersion: 6, text: 'STALE', mentionsTools: [],
      }));
      expect(saved.difference.equal).toBe(true);
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(409);
      expect(saved.outcome.value.body).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    } finally { await fixture.close(); }
  });

  it('H-03 a non-string template text is invalid with literal problems and changes no byte', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ packs: cases.parentChain });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-parent');
    try {
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/templates/save', {
        packId: 'pc2-parent', templateId: 'base', expectedVersion: 7, text: 17, mentionsTools: [],
      } as never));
      expect(saved.difference.equal).toBe(true);
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(400);
      expect(saved.outcome.value.body).toEqual({
        status: 'rejected', code: 'invalid', reason: 'text must be a string',
        problems: [{ packId: 'pc2-parent', templateId: 'base', reason: 'text must be a string' }],
      });
    } finally { await fixture.close(); }
  });

  it('H-03 a broken JSON body is invalid with literal problems', async () => {
    const fixture = await openPC2HostFixture();
    try {
      const read = await fixture.request(`${SETTINGS_API_PREFIX}prompts/templates/read`, undefined, {
        rawBody: '{"packId":',
      });
      expect(read.status).toBe(400);
      expect(read.body).toEqual({
        status: 'rejected', code: 'invalid', reason: 'request body is not valid JSON',
        problems: [{ packId: '', templateId: null, reason: 'request body is not valid JSON' }],
      });
    } finally { await fixture.close(); }
  });

  it('H-04 an invalid old body does not block saving a valid replacement version', async () => {
    const pack = pc2PackEntry('pc2-weak-body', { templates: { base: { text: 'BASE {{', version: 7 } } });
    const fixture = await openPC2HostFixture({ packs: [pack] });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-weak-body');
    try {
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/templates/save', {
        packId: 'pc2-weak-body', templateId: 'base', expectedVersion: 7, text: 'REPAIRED', mentionsTools: [],
      }));
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(200);
      expect(saved.outcome.value.body).toMatchObject({
        status: 'ready', value: { templateId: 'base', version: 8, text: 'REPAIRED' },
      });
      expect(saved.difference.added).toEqual(['templates/base@8.txt']);
      expect(saved.difference.changed).toEqual(['pack.json']);
      expect(await readFile(join(directory, 'templates', 'base.txt'), 'utf8')).toBe('BASE {{');
      expect(await readFile(join(directory, 'templates', 'base@8.txt'), 'utf8')).toBe('REPAIRED');
    } finally { await fixture.close(); }
  });

  it('H-04 a stale version is revision_conflict before the text shape is checked', async () => {
    const pack = pc2PackEntry('pc2-stale-first', { templates: { base: { text: 'BASE 7', version: 7 } } });
    const fixture = await openPC2HostFixture({ packs: [pack] });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-stale-first');
    try {
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/templates/save', {
        packId: 'pc2-stale-first', templateId: 'base', expectedVersion: 6, text: 17, mentionsTools: [],
      } as never));
      expect(saved.difference.equal).toBe(true);
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(409);
      expect(saved.outcome.value.body).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    } finally { await fixture.close(); }
  });

  it('H2-02 a user pack with a null templates table is invalid and changes no byte', async () => {
    const pack = pc2PackEntry('pc2-null-templates', { strings: {} });
    const manifest = JSON.parse(pack.manifest.text) as Record<string, unknown>;
    manifest['templates'] = null;
    pack.manifest.text = JSON.stringify(manifest);
    const fixture = await openPC2HostFixture({ packs: [pack] });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-null-templates');
    try {
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/templates/save', {
        packId: 'pc2-null-templates', templateId: 'base', expectedVersion: 2, text: 'REPAIRED', mentionsTools: [],
      }));
      expect(saved.difference).toEqual({ equal: true, added: [], removed: [], changed: [] });
      expect(saved.after).toEqual(saved.before);
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(400);
      expect(saved.outcome.value.body).toEqual({
        status: 'rejected', code: 'invalid', reason: 'the prompt pack would be invalid',
        problems: [{
          packId: 'pc2-null-templates', templateId: null, reason: 'manifest templates must be an object',
        }],
      });
    } finally { await fixture.close(); }
  });

  it('H2-03 a cycle with version 0 and a missing file reports every problem', async () => {
    const pack = pc2PackEntry('pc2-cycle-broken', {
      parent: 'pc2-cycle-broken', templates: { base: { text: 'BASE', version: 0 } },
    });
    pack.templates = {};
    const fixture = await openPC2HostFixture({ packs: [pack] });
    try {
      const read = await fixture.call('prompts/templates/read', {
        packId: 'pc2-cycle-broken', templateId: 'base',
      });
      expect(read.status).toBe(400);
      expect(read.body).toEqual({
        status: 'rejected', code: 'invalid', reason: 'the prompt pack is invalid',
        problems: [
          { packId: 'pc2-cycle-broken', templateId: 'base',
            reason: 'file "templates/base.txt" could not be read' },
          { packId: 'pc2-cycle-broken', templateId: null,
            reason: 'the pack extends chain contains a cycle' },
          { packId: 'pc2-cycle-broken', templateId: null,
            reason: 'pack "pc2-cycle-broken" extends "pc2-cycle-broken" but the chain continues with "platform"' },
          { packId: 'pc2-cycle-broken', templateId: 'base',
            reason: 'template version must be a positive integer' },
          { packId: 'pc2-cycle-broken', templateId: 'base',
            reason: 'template file "templates/base.txt" is missing from the pack' },
        ],
      });
    } finally { await fixture.close(); }
  });

  it('H-05 an existing different template file is unavailable and every file stays', async () => {
    const pack = pc2PackEntry('pc2-collision', { templates: { base: { text: 'BASE 7', version: 7 } } });
    const fixture = await openPC2HostFixture({ packs: [pack] });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-collision');
    try {
      await writeFile(join(directory, 'templates', 'base@8.txt'), 'OLD EIGHT', 'utf8');
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/templates/save', {
        packId: 'pc2-collision', templateId: 'base', expectedVersion: 7, text: 'NEW EIGHT', mentionsTools: [],
      }));
      expect(saved.difference.equal).toBe(true);
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(503);
      expect(saved.outcome.value.body).toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect(await readFile(join(directory, 'templates', 'base@8.txt'), 'utf8')).toBe('OLD EIGHT');
    } finally { await fixture.close(); }
  });

  it('H-05 an existing byte-identical template file is reused', async () => {
    const pack = pc2PackEntry('pc2-reuse', { templates: { base: { text: 'BASE 7', version: 7 } } });
    const fixture = await openPC2HostFixture({ packs: [pack] });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-reuse');
    try {
      await writeFile(join(directory, 'templates', 'base@8.txt'), 'SAME EIGHT', 'utf8');
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/templates/save', {
        packId: 'pc2-reuse', templateId: 'base', expectedVersion: 7, text: 'SAME EIGHT', mentionsTools: [],
      }));
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(200);
      expect(saved.difference.added).toEqual([]);
      expect(saved.difference.removed).toEqual([]);
      expect(saved.difference.changed).toEqual(['pack.json']);
      expect(await readFile(join(directory, 'templates', 'base@8.txt'), 'utf8')).toBe('SAME EIGHT');
    } finally { await fixture.close(); }
  });

  it('H-07 a missing template file and an invalid version are both reported', async () => {
    const pack = pc2PackEntry('pc2-both-broken', { templates: { base: { text: 'BASE', version: 0 } } });
    pack.templates = {};
    const fixture = await openPC2HostFixture({ packs: [pack] });
    try {
      const read = await fixture.call('prompts/templates/read', { packId: 'pc2-both-broken', templateId: 'base' });
      expect(read.status).toBe(400);
      expect(read.body.status).toBe('rejected');
      if (read.body.status !== 'rejected') return;
      expect(read.body.code).toBe('invalid');
      expect(read.body.problems).toEqual([
        { packId: 'pc2-both-broken', templateId: 'base', reason: 'file "templates/base.txt" could not be read' },
        { packId: 'pc2-both-broken', templateId: 'base', reason: 'template version must be a positive integer' },
        { packId: 'pc2-both-broken', templateId: 'base',
          reason: 'template file "templates/base.txt" is missing from the pack' },
      ]);
    } finally { await fixture.close(); }
  });

  it('H-07 a missing strings file keeps its read problem and the validation problem', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ packs: cases.broken['strings-file-missing']! });
    try {
      const read = await fixture.call('prompts/templates/read', {
        packId: 'bad-strings-file-missing', templateId: 'base',
      });
      expect(read.status).toBe(400);
      expect(read.body.status).toBe('rejected');
      if (read.body.status !== 'rejected') return;
      expect(read.body.problems).toEqual([
        { packId: 'bad-strings-file-missing', templateId: null, reason: 'file "absent.json" could not be read' },
        { packId: 'bad-strings-file-missing', templateId: null,
          reason: 'strings file "absent.json" is missing from the pack' },
      ]);
    } finally { await fixture.close(); }
  });

  it('H-08 a prompts/platform directory does not list a second platform pack', async () => {
    const fixture = await openPC2HostFixture();
    try {
      await mkdir(join(fixture.paths.promptsDirectory, 'platform'), { recursive: true });
      const list = await fixture.call('prompts/packs/list', {});
      expect(list.body.status).toBe('ready');
      if (list.body.status !== 'ready') return;
      expect(list.body.value.packs.map(pack => pack.packId)).toEqual(['platform']);
    } finally { await fixture.close(); }
  });

  it('PC-04 unknown pack, template and tool are not_found', async () => {
    const fixture = await openPC2HostFixture();
    try {
      const pack = await fixture.call('prompts/templates/read', { packId: 'pc2-absent', templateId: 'base' });
      expect(pack.status).toBe(404);
      expect(pack.body).toMatchObject({ status: 'rejected', code: 'not_found' });

      const template = await fixture.call('prompts/templates/read', {
        packId: 'platform', templateId: 'not-a-template',
      });
      expect(template.status).toBe(404);
      expect(template.body).toMatchObject({ status: 'rejected', code: 'not_found' });

      const tool = await fixture.call('prompts/tools/read', { packId: 'platform', toolName: 'not_a_tool' });
      expect(tool.status).toBe(404);
      expect(tool.body).toMatchObject({ status: 'rejected', code: 'not_found' });
    } finally { await fixture.close(); }
  });

  it('PC-04 a broken body is invalid with problems and list keeps that pack broken', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ packs: cases.broken['version-0']! });
    try {
      const read = await fixture.call('prompts/templates/read', { packId: 'bad-version-0', templateId: 'base' });
      expect(read.status).toBe(400);
      expect(read.body.status).toBe('rejected');
      if (read.body.status !== 'rejected') return;
      expect(read.body.code).toBe('invalid');
      expect(read.body.problems).toEqual([{
        packId: 'bad-version-0', templateId: 'base', reason: 'template version must be a positive integer',
      }]);

      const list = await fixture.call('prompts/packs/list', {});
      expect(list.status).toBe(200);
      expect(list.body.status).toBe('ready');
      if (list.body.status !== 'ready') return;
      const broken = list.body.value.packs.find(pack => pack.packId === 'bad-version-0');
      expect(broken?.problems).toEqual([{
        packId: 'bad-version-0', templateId: 'base', reason: 'template version must be a positive integer',
      }]);
      // The pack's own broken template keeps its problem; the platform's
      // templates remain listed because the disk tree could still read them.
      expect(broken?.templates).toContainEqual({
        templateId: 'base', version: 0, fromPack: 'bad-version-0',
        problems: [{ packId: 'bad-version-0', templateId: 'base', reason: 'template version must be a positive integer' }],
      });
    } finally { await fixture.close(); }
  });

  it('PC-04 platform save is forbidden and packs/create refuses platform or an existing id', async () => {
    const fixture = await openPC2HostFixture();
    try {
      const platform = await fixture.call('prompts/templates/save', {
        packId: 'platform', templateId: 'base', expectedVersion: 1, text: 'PLATFORM', mentionsTools: [],
      });
      expect(platform.status).toBe(403);
      expect(platform.body).toMatchObject({ status: 'rejected', code: 'forbidden' });

      const created = await fixture.call('prompts/packs/create', { packId: 'pc2-new' });
      expect(created.status).toBe(200);
      expect(created.body).toEqual({
        status: 'ready',
        value: { packId: 'pc2-new', extends: 'platform', templates: [], strings: {}, tools: {} },
      });
      const duplicate = await fixture.call('prompts/packs/create', { packId: 'pc2-new' });
      expect(duplicate.status).toBe(400);
      expect(duplicate.body).toMatchObject({ status: 'rejected', code: 'invalid' });
      const reserved = await fixture.call('prompts/packs/create', { packId: 'platform' });
      expect(reserved.status).toBe(403);
      expect(reserved.body).toMatchObject({ status: 'rejected', code: 'forbidden' });
    } finally { await fixture.close(); }
  });
});

describe('PC-04 disk pack source', () => {
  it('PC-04 the source reads the chain again on every resolve and never falls back', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ packs: cases.childChain });
    try {
      const source = createDiskPromptPackSource(fixture.paths.promptsDirectory);
      const signal = new AbortController().signal;
      const first = await source.resolve('pc2-child', signal);
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      expect(first.value.manifest.packId).toBe('pc2-child');
      expect(first.value.templates.base).toBe('CHILD');
      expect(first.value.origins.base).toEqual({ packId: 'pc2-child', version: 8, mentionsTools: [] });

      const saved = await fixture.call('prompts/templates/save', {
        packId: 'pc2-child', templateId: 'base', expectedVersion: 8, text: 'CHILD AGAIN', mentionsTools: [],
      });
      expect(saved.status).toBe(200);
      const second = await source.resolve('pc2-child', signal);
      expect(second.status).toBe('ready');
      if (second.status !== 'ready') return;
      expect(second.value.templates.base).toBe('CHILD AGAIN');
      expect(second.value.origins.base).toEqual({ packId: 'pc2-child', version: 9, mentionsTools: [] });

      const missing = await source.resolve('pc2-absent', signal);
      expect(missing).toMatchObject({ status: 'rejected', code: 'invalid' });
      if (missing.status === 'rejected') expect(missing.reason).toContain('pc2-absent');
    } finally { await fixture.close(); }
  });
});

describe('PC-04 save target path check', () => {
  it('PC-04 a linked templates directory is rejected before any write', async () => {
    const pack = pc2PackEntry('pc2-linked-target', {});
    const fixture = await openPC2HostFixture({ packs: [pack] });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-linked-target');
    const outside = join(fixture.paths.directory, 'linked-outside');
    try {
      await mkdir(outside);
      await symlink(outside, join(directory, 'templates'), 'dir');
      const read = await fixture.call('prompts/templates/read', {
        packId: 'pc2-linked-target', templateId: 'base',
      });
      expect(read.body.status).toBe('ready');
      if (read.body.status !== 'ready') return;
      const expectedVersion = read.body.value.version;
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/templates/save', {
        packId: 'pc2-linked-target', templateId: 'base', expectedVersion,
        text: 'ESCAPED', mentionsTools: [],
      }));
      expect(saved.difference.equal).toBe(true);
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(400);
      expect(saved.outcome.value.body).toMatchObject({ status: 'rejected', code: 'invalid' });
      if (saved.outcome.value.body.status === 'rejected')
        expect(saved.outcome.value.body.problems?.[0]?.reason).toContain('resolves outside the pack');
    } finally { await fixture.close(); }
  });

  it('H-06 a templates link to a real directory inside the pack saves there', async () => {
    const pack = pc2PackEntry('pc2-in-pack-link', { templates: { base: { text: 'LINK BASE', version: 7 } } });
    const fixture = await openPC2HostFixture({ packs: [pack] });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-in-pack-link');
    try {
      await rename(join(directory, 'templates'), join(directory, 'real-templates'));
      await symlink(join(directory, 'real-templates'), join(directory, 'templates'), 'dir');
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/templates/save', {
        packId: 'pc2-in-pack-link', templateId: 'base', expectedVersion: 7, text: 'LINK SAVED', mentionsTools: [],
      }));
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(200);
      expect(saved.outcome.value.body).toMatchObject({
        status: 'ready', value: { templateId: 'base', version: 8, text: 'LINK SAVED' },
      });
      expect(await readFile(join(directory, 'real-templates', 'base.txt'), 'utf8')).toBe('LINK BASE');
      expect(await readFile(join(directory, 'real-templates', 'base@8.txt'), 'utf8')).toBe('LINK SAVED');
    } finally { await fixture.close(); }
  });
});

describe('PC-22 save rejects an illegal section order', () => {
  it('PC-22 role-not-first and a duplicated section are invalid with no file changes', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ packs: cases.orderChain });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-order');
    try {
      for (const text of [
        PC2_WORK_INPUT.replace('{{role}}{{goal}}', '{{goal}}{{role}}'),
        `${PC2_WORK_INPUT}{{reminders}}`,
      ]) {
        const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/templates/save', {
          packId: 'pc2-order', templateId: 'work-input', expectedVersion: 7, text, mentionsTools: [],
        }));
        expect(saved.difference.equal).toBe(true);
        expect(saved.outcome.status).toBe('returned');
        if (saved.outcome.status !== 'returned') return;
        expect(saved.outcome.value.status).toBe(400);
        expect(saved.outcome.value.body.status).toBe('rejected');
        if (saved.outcome.value.body.status !== 'rejected') return;
        expect(saved.outcome.value.body.code).toBe('invalid');
        expect(saved.outcome.value.body.problems?.map(problem => problem.templateId)).toEqual(['work-input']);
      }
      // The visible file still carries exactly the fixture's text.
      expect(await readFile(join(directory, 'templates', 'work-input.txt'), 'utf8')).toBe(PC2_OTHER_WORK_INPUT);
    } finally { await fixture.close(); }
  });

  it('H-10 a call template with a footprint section is invalid and keeps every byte', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ packs: cases.orderChain });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-order');
    try {
      // The effective version comes from the public read route, as a client
      // would take it; the expected problem and byte equality stay literals.
      const read = await fixture.call('prompts/templates/read', {
        packId: 'pc2-order', templateId: 'query-copy-input',
      });
      expect(read.body.status).toBe('ready');
      if (read.body.status !== 'ready') return;
      const expectedVersion = read.body.value.version;
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/templates/save', {
        packId: 'pc2-order', templateId: 'query-copy-input', expectedVersion,
        text: '{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}', mentionsTools: [],
      }));
      expect(saved.difference.equal).toBe(true);
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(400);
      expect(saved.outcome.value.body.status).toBe('rejected');
      if (saved.outcome.value.body.status !== 'rejected') return;
      expect(saved.outcome.value.body.code).toBe('invalid');
      expect(saved.outcome.value.body.problems).toEqual([{
        packId: 'pc2-order', templateId: 'query-copy-input',
        reason: 'slot "footprint" is not declared by template "query-copy-input"',
      }]);
    } finally { await fixture.close(); }
  });
});
