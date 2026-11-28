/**
 * BK-E E4 rows E4-01…E4-06 (bke-rulings §2 E4 R-P1…R-P5, §3 row table). Every row goes through a public entry only:
 * the Host's settings/core HTTP routes, one real Run and the real pack files on disk. The first round of production
 * is on this tree: E4-01, E4-02, E4-04 and E4-05 are green in their first-round shape. This round's rework (forwarding
 * a problem's `detail`, the restore-freed version lower bound and the bad-HTTP-input checks) is not on this tree, so
 * E4-03's detail cases, n and l are red today, and the merged E4-04/06/n cell is red at n. Nothing here reads a
 * database, writes a record by hand or changes a production object; the narrow casts sit at the route boundary only.
 *
 * SQLite only: E4-01 needs a real Run re-read from the same SQLite directory (row table: storage row). The other rows
 * are business rows and run on the fixture's in-memory Host.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExecutionsPromptRecordResponse } from '../../src/app/core-http-types.js';
import type {
  HostSettingsSnapshot, PromptPackListV1, SettingsModel, SettingsResponse,
} from '../../src/app/host-settings-types.js';
import type { PromptPackProblemV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { openPC2HostFixture } from '../helpers/PC2-host-fixture.js';
import { pc2PackEntry } from '../helpers/PC2-pack-fixture.js';
import { openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7BWorld, runS7BWait } from '../helpers/S7B-fixture.js';

const worlds: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

// ---------------------------------------------------------------------------
// Response shapes of the fields and routes E4 adds. The types are the public
// contracts; production objects stay untouched.
// ---------------------------------------------------------------------------

type RejectedSettings = Extract<SettingsResponse<never>, { status: 'rejected' }>;

function listedPacks(body: unknown): PromptPackListV1['packs'] {
  const response = body as SettingsResponse<PromptPackListV1>;
  if (response.status !== 'ready')
    throw new Error(`packs/list was not ready: ${JSON.stringify(body)}`);
  return response.value.packs;
}
function listedPack(body: unknown, packId: string): PromptPackListV1['packs'][number] {
  const pack = listedPacks(body).find(entry => entry.packId === packId);
  if (pack === undefined) throw new Error(`packs/list does not list ${packId}: ${JSON.stringify(body)}`);
  return pack;
}
function rejectedBody(body: unknown): RejectedSettings {
  const response = body as SettingsResponse<never>;
  if (response.status !== 'rejected') throw new Error(`the route did not reject: ${JSON.stringify(body)}`);
  return response;
}
function problemsOf(body: unknown): readonly PromptPackProblemV1[] {
  return rejectedBody(body).problems ?? [];
}

const listRoute = '/api/real/settings/prompts/packs/list';
const restoreRoute = '/api/real/settings/prompts/templates/restore';

// ---------------------------------------------------------------------------

describe('BK-E4 prompt reads and model window', () => {
  it('E4-01 executions/prompt-record returns the frozen set and requests, and texts only when asked', async () => {
    // 今天绿：路由和端口已在树上；默认 includeTexts:false 时 texts 为 {}，带 includeTexts:true 时真读正文。
    // 行表 E4-01 / R-P1。
    // 具名变异：把路由/端口的默认值改成 true（`readPromptRecord` 的 options 默认）会让第一条 texts 断言变红。
    const { world } = await openS7BWorld({ backend: 'sqlite' });
    worlds.push(world);
    const wait = await runS7BWait(world, { label: 'bke-e4-01' });

    const plainRecord = await world.post('executions/prompt-record', plain(S6A_SCOPE, { ref: wait.run }));
    expect(plainRecord.httpStatus).toBe(200);
    const record = plainRecord.body as ExecutionsPromptRecordResponse;
    expect(record.status).toBe('ready');
    if (record.status !== 'ready') throw new Error(`executions/prompt-record answered no value: ${JSON.stringify(record)}`);
    expect(record.value.set.templates.length).toBeGreaterThan(0);
    expect(record.value.set.toolNames.length).toBeGreaterThan(0);
    expect(record.value.requests.length).toBeGreaterThan(0);
    expect(record.value.texts).toEqual({});

    // The storage row: the same Run's record is read again after the Host restarts on the same SQLite directory.
    await world.reopen();
    const reopened = await world.post('executions/prompt-record', plain(S6A_SCOPE, { ref: wait.run }));
    expect(reopened.httpStatus).toBe(200);
    expect(reopened.body).toEqual(plainRecord.body);

    const expanded = await world.post('executions/prompt-record',
      plain(S6A_SCOPE, { ref: wait.run, includeTexts: true }));
    expect(expanded.httpStatus).toBe(200);
    const withTexts = expanded.body as ExecutionsPromptRecordResponse;
    expect(withTexts.status).toBe('ready');
    if (withTexts.status !== 'ready') throw new Error(`executions/prompt-record answered no value: ${JSON.stringify(withTexts)}`);
    expect(Object.keys(withTexts.value.texts).length).toBeGreaterThan(0);
  }, 120_000);

  it('E4-02 packs/list lists each pack\'s tools with their nearest declaring pack and read failures', async () => {
    // 今天绿：packs/list 的每包已有 tools，fromPack 取最近声明，读失败给 file_problem。
    // 行表 E4-02 / R-P2。
    // 具名变异：删掉继承遍历（只走 entry.tools）或把 fromPack 填成 entry.packId 会让下面两条断言变红。
    const parent = pc2PackEntry('bke-e4-parent', {
      templates: { base: { text: 'PARENT BASE', version: 7 } },
      tools: { list_files: { description: 'Parent list.', parameters: { prefix: 'P' } } },
    });
    const child = pc2PackEntry('bke-e4-child', {
      parent: parent.packId,
      templates: { base: { text: 'CHILD BASE', version: 8 } },
    });
    const broken = pc2PackEntry('bke-e4-fail', {
      tools: { record_note: { description: 'Broken note.', parameters: {} } },
    });
    // Parent, child and the broken file live on one Host: one list, one chain traversal each.
    const fixture = await openPC2HostFixture({ packs: [parent, child, broken] });
    try {
      // A real disk edit after the fixture opened: the pack still declares the tool, its file is not JSON.
      await writeFile(join(fixture.paths.promptsDirectory, 'bke-e4-fail', 'tools', 'record_note.json'), '{', 'utf8');
      const list = await fixture.request(listRoute, {});
      expect(list.status).toBe(200);

      const platformRow = listedPack(list.body, 'platform');
      expect(platformRow.tools?.find(tool => tool.toolName === 'record_note'))
        .toMatchObject({ fromPack: 'platform' });
      expect(platformRow.tools?.find(tool => tool.toolName === 'record_note')?.description)
        .toEqual(expect.any(String));

      // A pack that changes a tool's description: that tool comes from itself, the other one is inherited.
      const parentRow = listedPack(list.body, 'bke-e4-parent');
      expect(parentRow.tools?.find(tool => tool.toolName === 'list_files')).toMatchObject({
        fromPack: 'bke-e4-parent', description: 'Parent list.',
      });
      expect(parentRow.tools?.find(tool => tool.toolName === 'record_note')).toMatchObject({
        fromPack: 'platform',
      });

      // A pack whose tools are declared only by its parent: the nearest declaration is the parent.
      const childRow = listedPack(list.body, 'bke-e4-child');
      expect(childRow.tools?.find(tool => tool.toolName === 'list_files')).toMatchObject({
        fromPack: 'bke-e4-parent', description: 'Parent list.',
      });
      expect(childRow.tools?.find(tool => tool.toolName === 'record_note')).toMatchObject({
        fromPack: 'platform',
      });

      // A tool file that cannot be read stays listed, without a description, with a file problem.
      const failRow = listedPack(list.body, 'bke-e4-fail');
      const failedTool = failRow.tools?.find(tool => tool.toolName === 'record_note');
      expect(failedTool).toMatchObject({ fromPack: 'bke-e4-fail', description: null });
      expect(failedTool?.problems).toContainEqual(expect.objectContaining({ kind: 'file_problem' }));
    } finally { await fixture.close(); }
  });

  it('E4-03 tool parameters and a Host-built problem carry their kinds', async () => {
    // 今天绿：工具参数差的 kind/detail 和 Host 直构问题的 file_problem 已在树上。
    // 行表 E4-03 / R-P3。
    // 具名变异：把 kind 恒填 template_invalid，或 Host 的 invalidRequest 不填 kind，会让对应断言变红。
    const pack = pc2PackEntry('bke-e4-edits', { templates: { base: { text: 'EDIT BASE', version: 7 } } });
    const fixture = await openPC2HostFixture({ packs: [pack] });
    try {
      const current = await fixture.call('prompts/tools/read', { packId: 'bke-e4-edits', toolName: 'list_files' });
      expect(current.body.status).toBe('ready');
      if (current.body.status !== 'ready') return;
      // The digest is the public read's own value (a platform-signed input).
      const savedTool = await fixture.request('/api/real/settings/prompts/tools/save', {
        packId: 'bke-e4-edits', toolName: 'list_files', expectedDigest: current.body.value.digest,
        entry: { description: 'List files.', parameters: { q: 'x' } },
      });
      expect(savedTool.status).toBe(400);
      const toolProblems = problemsOf(savedTool.body);
      expect(toolProblems[0]).toMatchObject({
        kind: 'tool_parameters_differ', toolName: 'list_files',
      });
      expect(toolProblems[0]?.detail?.extra).toContain('q');
      expect(toolProblems[0]?.detail?.missing).toContain('prefix');

      // A Host-built problem (invalidRequest, not the resolver): expectedVersion is not an integer.
      const savedShape = await fixture.request('/api/real/settings/prompts/templates/save', {
        packId: 'bke-e4-edits', templateId: 'base', expectedVersion: 7.5,
        text: 'EDIT BASE', mentionsTools: [],
      });
      expect(savedShape.status).toBe(400);
      expect(problemsOf(savedShape.body)[0]).toMatchObject({ kind: 'file_problem' });
    } finally { await fixture.close(); }
  });

  it.each([
    {
      label: 'an undeclared slot',
      templateId: 'base', expectedVersion: 7,
      text: 'EDIT BASE {{bke_e4_unknown}}',
      expected: { kind: 'slot_undeclared', detail: { slot: 'bke_e4_unknown' } },
    },
    {
      label: 'a body that does not start with the role section',
      templateId: 'secretary-round', expectedVersion: 1,
      text: '{{goal}}{{role}}{{notes}}{{task_round}}{{task_batched}}{{task_earlier}}',
      expected: { kind: 'role_not_first', detail: { section: 'role' } },
    },
  ] as const)('E4-03 templates/save refuses $label with its kind and detail', async ({
    templateId, expectedVersion, text, expected,
  }) => {
    // 今天绿：两条的 kind 与 detail 都已由解析器转发（slot_undeclared 带 `detail.slot`，role_not_first
    // 带 `detail.section`）。
    // 具名变异：`report` 只收 kind/message 丢掉 detail，两条断言都变红。未执行。
    const pack = pc2PackEntry('bke-e4-edits', { templates: {
      base: { text: 'EDIT BASE', version: 7 },
      'secretary-round': {
        text: '{{role}}{{goal}}{{notes}}{{task_round}}{{task_batched}}{{task_earlier}}', version: 1,
      },
    } });
    const fixture = await openPC2HostFixture({ packs: [pack] });
    try {
      const saved = await fixture.call('prompts/templates/save', {
        packId: 'bke-e4-edits', templateId, expectedVersion, text, mentionsTools: [],
      });
      expect(saved.status).toBe(400);
      expect(problemsOf(saved.body)[0]).toMatchObject(expected);
    } finally { await fixture.close(); }
  });

  it('E4-04 / E4-06 / n restore returns the nearest declaration, then saves start past the freed version', async () => {
    // 今天绿：E4-04/06 在树上——恢复只腾出 9，再存从 10 起、11 续存，@8/@9 不动；只继承的包恢复回 not_found。
    // 今天红只在新增段：父包再存到 11 后，子包再存应从 12 起，今天从 removed 9 起写 10。
    // 具名变异：restore 不确认本包声明，或再存只认 removedVersion 不认 effectiveVersion+1，对应断言变红。
    // 未执行（生产返工不在本树）。
    const parent = pc2PackEntry('bke-e4-b', { templates: { base: { text: 'B BASE', version: 7 } } });
    const child = pc2PackEntry('bke-e4-a', {
      parent: 'bke-e4-b', templates: { base: { text: 'A BASE', version: 7 } },
    });
    const inherited = pc2PackEntry('bke-e4-inherit', { parent: 'bke-e4-b' });
    const late = pc2PackEntry('bke-e4-late', {
      parent: 'bke-e4-b', templates: { base: { text: 'LATE BASE', version: 7 } },
    });
    const noDirectory = pc2PackEntry('bke-e4-missing', {
      parent: 'bke-e4-b', templates: { base: { text: 'MISSING BASE', version: 7 } },
    });
    const fixture = await openPC2HostFixture({ packs: [child, parent, inherited, late, noDirectory] });
    const directory = join(fixture.paths.promptsDirectory, 'bke-e4-a');
    const inheritDirectory = join(fixture.paths.promptsDirectory, 'bke-e4-inherit');
    const lateDirectory = join(fixture.paths.promptsDirectory, 'bke-e4-late');
    const missingDirectory = join(fixture.paths.promptsDirectory, 'bke-e4-missing');
    try {
      // E4-04: two saves, then restore the child's current 9 back to the parent's 7.
      const eight = await fixture.call('prompts/templates/save', {
        packId: 'bke-e4-a', templateId: 'base', expectedVersion: 7, text: 'A BASE EIGHT', mentionsTools: [],
      });
      expect(eight.body).toMatchObject({ status: 'ready', value: { version: 8, fromPack: 'bke-e4-a' } });
      const nine = await fixture.call('prompts/templates/save', {
        packId: 'bke-e4-a', templateId: 'base', expectedVersion: 8, text: 'A BASE NINE', mentionsTools: [],
      });
      expect(nine.body).toMatchObject({ status: 'ready', value: { version: 9, fromPack: 'bke-e4-a' } });

      const restored = await fixture.request(restoreRoute, {
        packId: 'bke-e4-a', templateId: 'base', expectedVersion: 9,
      });
      expect(restored.status).toBe(200);
      expect(restored.body).toMatchObject({
        status: 'ready', value: { templateId: 'base', version: 7, fromPack: 'bke-e4-b' },
      });

      const list = await fixture.request(listRoute, {});
      expect(listedPack(list.body, 'bke-e4-a').templates?.find(entry => entry.templateId === 'base'))
        .toMatchObject({ templateId: 'base', version: 7, fromPack: 'bke-e4-b' });

      const eightFile = join(directory, 'templates', 'base@8.txt');
      expect(existsSync(eightFile)).toBe(true);
      expect(await readFile(eightFile, 'utf8')).toBe('A BASE EIGHT');
      const manifest = JSON.parse(await readFile(join(directory, 'pack.json'), 'utf8')) as {
        restoredVersions?: Record<string, number[]>;
      };
      expect(manifest.restoredVersions?.base).toEqual([9]);

      // E4-06 + n: the restore freed only 9, so this save starts at 10, not at the
      // child's own @8 (effectiveVersion + 1) and not at a blind max + 1.
      const ten = await fixture.call('prompts/templates/save', {
        packId: 'bke-e4-a', templateId: 'base', expectedVersion: 7, text: 'A BASE TEN', mentionsTools: [],
      });
      expect(ten.body).toMatchObject({ status: 'ready', value: { version: 10, fromPack: 'bke-e4-a' } });
      expect(await readFile(eightFile, 'utf8')).toBe('A BASE EIGHT');
      expect(await readFile(join(directory, 'templates', 'base@9.txt'), 'utf8')).toBe('A BASE NINE');
      expect(await readFile(join(directory, 'templates', 'base@10.txt'), 'utf8')).toBe('A BASE TEN');

      // n: the next save continues at 11 and leaves both old files alone.
      const eleven = await fixture.call('prompts/templates/save', {
        packId: 'bke-e4-a', templateId: 'base', expectedVersion: 10, text: 'A BASE ELEVEN', mentionsTools: [],
      });
      expect(eleven.body).toMatchObject({ status: 'ready', value: { version: 11, fromPack: 'bke-e4-a' } });
      expect(await readFile(join(directory, 'templates', 'base@10.txt'), 'utf8')).toBe('A BASE TEN');
      expect(await readFile(join(directory, 'templates', 'base@11.txt'), 'utf8')).toBe('A BASE ELEVEN');

      // n: a pack that only inherits has nothing of its own to restore; a save in it
      // still writes the parent's next version.
      const inheritedRestore = await fixture.call('prompts/templates/restore', {
        packId: 'bke-e4-inherit', templateId: 'base', expectedVersion: 7,
      });
      expect(inheritedRestore.body).toMatchObject({
        status: 'rejected', code: 'not_found', reason: 'the prompt pack does not declare this template',
      });
      const inheritedSave = await fixture.call('prompts/templates/save', {
        packId: 'bke-e4-inherit', templateId: 'base', expectedVersion: 7,
        text: 'INHERIT EIGHT', mentionsTools: [],
      });
      expect(inheritedSave.body).toMatchObject({
        status: 'ready', value: { version: 8, fromPack: 'bke-e4-inherit' },
      });
      expect(await readFile(join(inheritDirectory, 'templates', 'base@8.txt'), 'utf8')).toBe('INHERIT EIGHT');
      // H-05 (an unmarked @8 collision still answers 503 and leaves the old file) lives at
      // tests/app/PC2-H-pack-routes.test.ts:235-249; it is not rerun in this world.

      // E4-09 (1): the parent saves new versions after the child's restore, so the
      // child's next save follows both the parent's effective version and the
      // version the restore removed.
      // Today RED: expected the save to write version 12 at templates/base@12.txt, actual version 10 at templates/base@10.txt — 施工方生产返工今天不在这棵树上
      // Named mutation: n = max(effectiveVersion+1, removedVersion+1) 且目录不存在按空集；未执行（生产返工不在本树）。
      const lateEight = await fixture.call('prompts/templates/save', {
        packId: 'bke-e4-late', templateId: 'base', expectedVersion: 7, text: 'LATE EIGHT', mentionsTools: [],
      });
      expect(lateEight.body).toMatchObject({ status: 'ready', value: { version: 8, fromPack: 'bke-e4-late' } });
      const lateNine = await fixture.call('prompts/templates/save', {
        packId: 'bke-e4-late', templateId: 'base', expectedVersion: 8, text: 'LATE NINE', mentionsTools: [],
      });
      expect(lateNine.body).toMatchObject({ status: 'ready', value: { version: 9, fromPack: 'bke-e4-late' } });
      const lateRestored = await fixture.request(restoreRoute, {
        packId: 'bke-e4-late', templateId: 'base', expectedVersion: 9,
      });
      expect(lateRestored.status).toBe(200);
      expect(lateRestored.body).toMatchObject({
        status: 'ready', value: { templateId: 'base', version: 7, fromPack: 'bke-e4-b' },
      });
      for (const [expectedVersion, version, text] of [
        [7, 8, 'B BASE EIGHT'], [8, 9, 'B BASE NINE'], [9, 10, 'B BASE TEN'], [10, 11, 'B BASE ELEVEN'],
      ] as const) {
        const savedParent = await fixture.call('prompts/templates/save', {
          packId: 'bke-e4-b', templateId: 'base', expectedVersion, text, mentionsTools: [],
        });
        expect(savedParent.body).toMatchObject({ status: 'ready', value: { version, fromPack: 'bke-e4-b' } });
      }
      const lateTwelve = await fixture.call('prompts/templates/save', {
        packId: 'bke-e4-late', templateId: 'base', expectedVersion: 11, text: 'LATE TWELVE', mentionsTools: [],
      });
      expect(lateTwelve.body).toMatchObject({
        status: 'ready', value: { version: 12, fromPack: 'bke-e4-late' },
      });
      const lateList = await fixture.request(listRoute, {});
      expect(listedPack(lateList.body, 'bke-e4-late').templates?.find(entry => entry.templateId === 'base'))
        .toMatchObject({ templateId: 'base', version: 12, fromPack: 'bke-e4-late' });
      expect(await readFile(join(lateDirectory, 'templates', 'base@8.txt'), 'utf8')).toBe('LATE EIGHT');
      expect(await readFile(join(lateDirectory, 'templates', 'base@9.txt'), 'utf8')).toBe('LATE NINE');
      expect(await readFile(join(lateDirectory, 'templates', 'base@12.txt'), 'utf8')).toBe('LATE TWELVE');

      // E4-09 (2): this child declares the template only in its manifest and has no
      // templates/ directory; restore then save succeeds and creates the target.
      // Today RED: expected the save to answer 200 with version 12, actual 503 unavailable ("the prompt templates could not be read") — 施工方生产返工今天不在这棵树上
      // Named mutation: n = max(effectiveVersion+1, removedVersion+1) 且目录不存在按空集；未执行（生产返工不在本树）。
      await rm(join(missingDirectory, 'templates'), { recursive: true, force: true });
      const missingRestored = await fixture.request(restoreRoute, {
        packId: 'bke-e4-missing', templateId: 'base', expectedVersion: 7,
      });
      expect(missingRestored.status).toBe(200);
      expect(missingRestored.body).toMatchObject({
        status: 'ready', value: { templateId: 'base', version: 11, fromPack: 'bke-e4-b' },
      });
      const missingTwelve = await fixture.call('prompts/templates/save', {
        packId: 'bke-e4-missing', templateId: 'base', expectedVersion: 11,
        text: 'MISSING TWELVE', mentionsTools: [],
      });
      expect(missingTwelve.status).toBe(200);
      expect(missingTwelve.body).toMatchObject({
        status: 'ready', value: { version: 12, fromPack: 'bke-e4-missing' },
      });
      expect(await readFile(join(missingDirectory, 'templates', 'base@12.txt'), 'utf8')).toBe('MISSING TWELVE');
    } finally { await fixture.close(); }
  });

  it('E4-05 the snapshot model rows publish the model window; workspaces do not', async () => {
    // 今天绿：settings/snapshot 的 models[] 已带 contextWindowTokens，models/save 不带这个字段。
    // 行表 E4-05 / R-P5：contextWindowTokensOf 是唯一判断，快照 models[] 带出窗口。
    // 具名变异：把快照字段接到常量的固定值，或在 workspaces[] 上也放一份，会让对应断言变红。
    const world = await openS6AHostWorld({ backend: 'memory' });
    worlds.push(world);
    const snapshot = async (): Promise<HostSettingsSnapshot> => {
      const answer = await world.settings('snapshot', {});
      expect(answer.status).toBe('ready');
      if (answer.status !== 'ready') throw new Error('the snapshot was not ready');
      return answer.value;
    };
    const modelRow = (snapshotValue: HostSettingsSnapshot, id: string): SettingsModel | undefined =>
      snapshotValue.models.find(model => model.id === id);
    const before = await snapshot();

    const oneMillion = await world.settings('models/save', {
      id: 'bke-e4-1m', label: 'BK-E 1M', provider: 'deepseek', model: 'deepseek-flash',
    });
    expect(oneMillion.status).toBe('ready');
    const small = await world.settings('models/save', {
      id: 'bke-e4-small', label: 'BK-E small', provider: 'openai', model: 'gpt-4o-mini',
    });
    expect(small.status).toBe('ready');
    const after = await snapshot();

    // 128k is the literal from the ruling, not a read of the constant under test (tests/RULES.md:179).
    expect(modelRow(after, 'bke-e4-1m')?.contextWindowTokens).toBe(1_000_000);
    expect(modelRow(after, 'bke-e4-small')?.contextWindowTokens).toBe(128_000);
    // The budget rows are unchanged, and the window is not a workspace field.
    expect(after.workRunTokenBudget).toEqual(before.workRunTokenBudget);
    expect(after.resourceCaps).toEqual(before.resourceCaps);
    expect(after.workspaces.length).toBeGreaterThan(0);
    for (const workspace of after.workspaces)
      expect(Object.hasOwn(workspace, 'contextWindowTokens')).toBe(false);
  }, 60_000);

  it.each([
    ['a null input', null],
    ['a non-boolean includeTexts', 'yes'],
  ] as const)('E4-l executions/prompt-record refuses %s as invalid', async (_label, includeTexts) => {
    // 今天绿：两条 HTTP 输入都已被路由拒绝成 invalid（input:null 与 includeTexts:'yes'）。
    // 具名变异：路由先取 input.ref 再判对象会让第一项 500；includeTexts 只认严格 false 会让第二项读正文。
    // 未执行（生产返工不在本树）。
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const wait = await runS7BWait(world, { label: 'bke-e4-l' });
    const input = includeTexts === null ? null : { ref: wait.run, includeTexts };
    const answer = await world.post('executions/prompt-record', plain(S6A_SCOPE, input));
    expect(answer.httpStatus).toBe(200);
    expect(answer.body).toMatchObject({ status: 'rejected', code: 'invalid' });
  }, 120_000);
});
