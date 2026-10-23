/**
 * PC-2 row PC-25 (route half): tool texts in a person's pack are read with the
 * canonical-body digest and saved to a new versioned file; a stale digest is a
 * revision conflict and an invalid entry changes no byte.
 *
 * The expected digests are SHA-256 of the hand-written canonical bodies below.
 */
import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPC2HostFixture } from '../helpers/PC2-host-fixture.js';
import { pc2PackCases, pc2PackEntry, snapshotPC2Step } from '../helpers/PC2-pack-fixture.js';

const CHILD_DIGEST = '39e126f52d4cb503fc4f7a2d1a5fc4b2f70e541ba278c2f5cb2a0fa50014a7fa';
const SAVED_BODY = '{"description":"Saved note.","parameters":{}}';
const SAVED_DIGEST = '64b6622afb502db230dbc2f16b170e60546b5ff33154ab5935ae8bd23b06d851';
const SAVED_FILE = 'tools/record_note@64b6622afb502db2.json';

describe('PC-25 prompt tool routes', () => {
  it('PC-25 read returns the effective entry and its hand-computed digest', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ packs: cases.toolChain });
    try {
      const read = await fixture.call('prompts/tools/read', { packId: 'pc2-tool-child', toolName: 'record_note' });
      expect(read.status).toBe(200);
      expect(read.body).toEqual({
        status: 'ready',
        value: {
          toolName: 'record_note', fromPack: 'pc2-tool-child',
          entry: { description: 'Child note.', parameters: {} }, digest: CHILD_DIGEST,
        },
      });
    } finally { await fixture.close(); }
  });

  it('PC-25 save writes record_note@<first 16 hex>.json and the next read sees it', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ packs: cases.toolChain });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-tool-child');
    try {
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/tools/save', {
        packId: 'pc2-tool-child', toolName: 'record_note', expectedDigest: CHILD_DIGEST,
        entry: { description: 'Saved note.', parameters: {} },
      }));
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(200);
      expect(saved.outcome.value.body).toEqual({
        status: 'ready',
        value: {
          toolName: 'record_note', fromPack: 'pc2-tool-child',
          entry: { description: 'Saved note.', parameters: {} }, digest: SAVED_DIGEST,
        },
      });
      expect(saved.difference.added).toEqual([SAVED_FILE]);
      expect(saved.difference.changed).toEqual(['pack.json']);
      const body = saved.after[SAVED_FILE];
      expect(body?.kind).toBe('file');
      if (body?.kind === 'file') expect(body.bytes.toString('utf8')).toBe(SAVED_BODY);
      expect(await readFile(join(directory, 'tools', 'record_note.json'), 'utf8'))
        .toBe('{"description":"Child note.","parameters":{}}');

      const read = await fixture.call('prompts/tools/read', { packId: 'pc2-tool-child', toolName: 'record_note' });
      expect(read.body).toEqual({
        status: 'ready',
        value: {
          toolName: 'record_note', fromPack: 'pc2-tool-child',
          entry: { description: 'Saved note.', parameters: {} }, digest: SAVED_DIGEST,
        },
      });
    } finally { await fixture.close(); }
  });

  it('PC-25 a stale digest is revision_conflict and an invalid entry leaves bytes equal', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ packs: cases.toolChain });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-tool-child');
    try {
      const stale = await snapshotPC2Step(directory, () => fixture.call('prompts/tools/save', {
        packId: 'pc2-tool-child', toolName: 'record_note', expectedDigest: SAVED_DIGEST,
        entry: { description: 'Stale.', parameters: {} },
      }));
      expect(stale.difference.equal).toBe(true);
      expect(stale.outcome.status).toBe('returned');
      if (stale.outcome.status !== 'returned') return;
      expect(stale.outcome.value.status).toBe(409);
      expect(stale.outcome.value.body).toMatchObject({ status: 'rejected', code: 'revision_conflict' });

      const invalid = await snapshotPC2Step(directory, () => fixture.call('prompts/tools/save', {
        packId: 'pc2-tool-child', toolName: 'record_note', expectedDigest: CHILD_DIGEST,
        entry: { description: 'Note.', parameters: { extra: 'x' } },
      }));
      expect(invalid.difference.equal).toBe(true);
      expect(invalid.outcome.status).toBe('returned');
      if (invalid.outcome.status !== 'returned') return;
      expect(invalid.outcome.value.status).toBe(400);
      expect(invalid.outcome.value.body.status).toBe('rejected');
      if (invalid.outcome.value.body.status !== 'rejected') return;
      expect(invalid.outcome.value.body.code).toBe('invalid');
      expect(invalid.outcome.value.body.problems).toEqual([{
        packId: 'pc2-tool-child', templateId: null, toolName: 'record_note',
        reason: 'tool record_note parameters differ',
      }]);
    } finally { await fixture.close(); }
  });

  it('H2-02 a user pack with a null tools table is invalid and changes no byte', async () => {
    const parent = pc2PackEntry('pc2-null-tools-parent', {
      tools: { record_note: { description: 'Parent note.', parameters: {} } },
    });
    const pack = pc2PackEntry('pc2-null-tools', { parent: 'pc2-null-tools-parent' });
    const manifest = JSON.parse(pack.manifest.text) as Record<string, unknown>;
    manifest['tools'] = null;
    pack.manifest.text = JSON.stringify(manifest);
    const fixture = await openPC2HostFixture({ packs: [pack, parent] });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-null-tools');
    try {
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/tools/save', {
        packId: 'pc2-null-tools', toolName: 'record_note',
        expectedDigest: '11e9733378fd7a4c71fa2fdfd4151f08d5d37830955c1236e3391997c42811dc',
        entry: { description: 'Saved note.', parameters: {} },
      }));
      expect(saved.difference).toEqual({ equal: true, added: [], removed: [], changed: [] });
      expect(saved.after).toEqual(saved.before);
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(400);
      expect(saved.outcome.value.body).toEqual({
        status: 'rejected', code: 'invalid', reason: 'the prompt pack would be invalid',
        problems: [{
          packId: 'pc2-null-tools', templateId: null, reason: 'manifest tools must be an object',
        }],
      });
    } finally { await fixture.close(); }
  });

  it('H-03 a non-string tool description is invalid with literal problems and changes no byte', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ packs: cases.toolChain });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-tool-child');
    try {
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/tools/save', {
        packId: 'pc2-tool-child', toolName: 'record_note', expectedDigest: CHILD_DIGEST,
        entry: { description: 17, parameters: {} },
      } as never));
      expect(saved.difference.equal).toBe(true);
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(400);
      expect(saved.outcome.value.body).toEqual({
        status: 'rejected', code: 'invalid',
        reason: 'entry must carry a description and named string parameters',
        problems: [{
          packId: 'pc2-tool-child', templateId: null, toolName: 'record_note',
          reason: 'entry must carry a description and named string parameters',
        }],
      });
    } finally { await fixture.close(); }
  });

  it('H-05 an existing different tool file is unavailable and every file stays', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ packs: cases.toolChain });
    const directory = join(fixture.paths.promptsDirectory, 'pc2-tool-child');
    try {
      await writeFile(join(directory, SAVED_FILE), 'OLD TOOL', 'utf8');
      const saved = await snapshotPC2Step(directory, () => fixture.call('prompts/tools/save', {
        packId: 'pc2-tool-child', toolName: 'record_note', expectedDigest: CHILD_DIGEST,
        entry: { description: 'Saved note.', parameters: {} },
      }));
      expect(saved.difference.equal).toBe(true);
      expect(saved.outcome.status).toBe('returned');
      if (saved.outcome.status !== 'returned') return;
      expect(saved.outcome.value.status).toBe(503);
      expect(saved.outcome.value.body).toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect(await readFile(join(directory, SAVED_FILE), 'utf8')).toBe('OLD TOOL');
    } finally { await fixture.close(); }
  });

  it('PC-25 platform save is forbidden and an unknown pack or tool is not_found', async () => {
    const fixture = await openPC2HostFixture();
    try {
      const platform = await fixture.call('prompts/tools/save', {
        packId: 'platform', toolName: 'record_note', expectedDigest: CHILD_DIGEST,
        entry: { description: 'Platform.', parameters: {} },
      });
      expect(platform.status).toBe(403);
      expect(platform.body).toMatchObject({ status: 'rejected', code: 'forbidden' });

      const pack = await fixture.call('prompts/tools/read', { packId: 'pc2-absent', toolName: 'record_note' });
      expect(pack.status).toBe(404);
      expect(pack.body).toMatchObject({ status: 'rejected', code: 'not_found' });

      const tool = await fixture.call('prompts/tools/read', { packId: 'platform', toolName: 'not_a_tool' });
      expect(tool.status).toBe(404);
      expect(tool.body).toMatchObject({ status: 'rejected', code: 'not_found' });
    } finally { await fixture.close(); }
  });
});
