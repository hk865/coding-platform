/**
 * PC-1b P — ruling 15: Skill selection at preparation.
 *
 * The platform root is recognised by path and reads its content from the
 * resolved pack; an explicit empty list stays empty; no selection takes today's
 * Kernel default; any other root goes through the public `FileSkillLoader`.
 *
 * Every platform Skill body, title and priority below is a hand-written literal,
 * and each digest is the SHA-256 of that literal (node:crypto), so a selector
 * that read the generated pack instead of the passed texts would fail.
 */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PromptTextsV1 } from '../../src/contracts/prompts/prompt-set.js';
import { PLATFORM_SKILL_RESOURCE_ROOT } from '../../src/core/agent-runtime/platform-skill-root.js';
import {
  DEFAULT_SKILL_SELECTION, selectPromptSkills,
} from '../../src/core/agent-runtime/prompt-set-texts.js';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { customSkillDirectory } from '../helpers/PC-platform-fixture.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Hand-written platform Skill metadata and body literals (deliberately unlike the generated pack). */
const SKILLS = {
  'platform-work': { title: 'Platform work', kind: 'instruction', priority: 90,
    templateId: 'skill-platform-work', content: 'PC_SKILL_WORK_BODY' },
  'platform-secretary': { title: 'Platform secretary', kind: 'instruction', priority: 70,
    templateId: 'skill-platform-secretary', content: 'PC_SKILL_SECRETARY_BODY' },
  'platform-adviser': { title: 'Platform adviser', kind: 'instruction', priority: 60,
    templateId: 'skill-platform-adviser', content: 'PC_SKILL_ADVISER_BODY' },
  'platform-scribe': { title: 'Platform scribe', kind: 'instruction', priority: 50,
    templateId: 'skill-platform-scribe', content: 'PC_SKILL_SCRIBE_BODY' },
  'platform-reviewer': { title: 'Platform reviewer', kind: 'instruction', priority: 40,
    templateId: 'skill-platform-reviewer', content: 'PC_SKILL_REVIEWER_BODY' },
} as const;
type PlatformId = keyof typeof SKILLS;

const TEXTS: PromptTextsV1 = {
  templates: Object.fromEntries(Object.values(SKILLS).map(skill => [skill.templateId, skill.content])),
  strings: { 'role.executor.label': 'PC_SELECTOR_STRING' },
};
const signal = () => new AbortController().signal;
const directories: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => { for (const directory of directories.splice(0)) await directory.close(); });

function expectSkill(id: PlatformId, skill: { id: string; title: string; kind: string; priority: number; content: string; source: string } | undefined): void {
  const expected = SKILLS[id];
  expect(skill).toEqual({ schemaVersion: 1, id, title: expected.title, kind: expected.kind,
    priority: expected.priority, content: expected.content, source: `skill:${id}@sha256:${sha(expected.content)}` });
}

describe('ruling 15: platform root', () => {
  it('takes each selected Skill from the passed texts, with the loader metadata and source form', async () => {
    const selection = { resourceRoot: PLATFORM_SKILL_RESOURCE_ROOT, enabledIds: ['platform-work', 'platform-reviewer'] };
    const result = await selectPromptSkills(selection, TEXTS, { signal: signal(), kernel });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.value.map(skill => skill.id)).toEqual(['platform-work', 'platform-reviewer']);
    expectSkill('platform-work', result.value[0]);
    expectSkill('platform-reviewer', result.value[1]);
  });

  it('recognises the root by path.resolve and keeps an explicit empty list empty', async () => {
    const dotted = { resourceRoot: `${PLATFORM_SKILL_RESOURCE_ROOT}/.`, enabledIds: ['platform-scribe'] };
    const selected = await selectPromptSkills(dotted, TEXTS, { signal: signal() });
    expect(selected.status).toBe('ready');
    if (selected.status === 'ready') expectSkill('platform-scribe', selected.value[0]);

    const empty = await selectPromptSkills({ resourceRoot: PLATFORM_SKILL_RESOURCE_ROOT, enabledIds: [] }, TEXTS, { signal: signal() });
    expect(empty).toEqual({ status: 'ready', value: [] });
  });

  it('normalizes a padded platform id before the lookup (the old loader rule)', async () => {
    const result = await selectPromptSkills({
      resourceRoot: PLATFORM_SKILL_RESOURCE_ROOT, enabledIds: [' platform-secretary '],
    }, TEXTS, { signal: signal() });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.value.map(skill => skill.id)).toEqual(['platform-secretary']);
    expectSkill('platform-secretary', result.value[0]);
  });

  it('rejects an unknown platform id as invalid', async () => {
    const result = await selectPromptSkills({ resourceRoot: PLATFORM_SKILL_RESOURCE_ROOT, enabledIds: ['missing-role'] }, TEXTS, { signal: signal() });
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (result.status === 'rejected') expect(result.reason).toContain('missing-role');
  });
});

describe('ruling 15: custom directory and no selection', () => {
  it('loads any other root through the public FileSkillLoader at preparation time', async () => {
    const directory = await customSkillDirectory('PC_CUSTOM_SKILL_V1');
    directories.push(directory);
    const result = await selectPromptSkills(directory.selection, TEXTS, { signal: signal(), kernel });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({ schemaVersion: 1, id: 'pc-custom', title: 'PC custom skill', kind: 'instruction', priority: 10, content: 'PC_CUSTOM_SKILL_V1' });
    expect(result.value[0]?.source).toBe(`skill:pc-custom@sha256:${sha('PC_CUSTOM_SKILL_V1')}`);
  });

  it('takes today\'s default root and coding-safety when nothing is selected', async () => {
    const roots: string[] = [];
    const requests: string[][] = [];
    const stub = { FileSkillLoader: { async create(root: string) {
      roots.push(root);
      return { async load(_signal: AbortSignal) {
        return { async select(request: { requestedIds: readonly string[] }) {
          requests.push([...request.requestedIds]);
          return [{ schemaVersion: 1, id: 'coding-safety', title: 'Coding safety', kind: 'instruction', priority: 100,
            content: 'PC_SAFETY', source: `skill:coding-safety@sha256:${sha('PC_SAFETY')}` }];
        } };
      } };
    } } } as unknown as typeof kernel;
    const result = await selectPromptSkills(undefined, TEXTS, { signal: signal(), kernel: stub });
    expect(result.status).toBe('ready');
    expect(roots).toEqual([resolve(import.meta.dirname, '../../vendor/coding-agent/resources/skills')]);
    expect(requests).toEqual([['coding-safety']]);
    expect(DEFAULT_SKILL_SELECTION.enabledIds).toEqual(['coding-safety']);
  });
});
