/**
 * PC-1b P — ruling 14: the review instruction is rendered from the resolved
 * pack, and its template, base and platform Skill are frozen in the manifest's
 * `promptSet`.
 *
 * The world is the frozen PC fixture's real K3 review run; the `shell` stand-in
 * is the existing `shellSeam` mock every K3 test installs. Every injected text,
 * title and priority is a hand-written literal, and every digest is the SHA-256
 * of one (node:crypto), so a renderer or selector that read the generated pack
 * instead of the resolved one would fail.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { PLATFORM_SKILL_RESOURCE_ROOT } from '../../src/core/agent-runtime/platform-skill-root.js';
import { openPCK3ReviewFixture } from '../helpers/PC-platform-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const BASE = 'PC_REVIEW_BASE_A';
const INSTRUCTION = 'PC_REVIEW_INSTRUCTION';
const REVIEW_TEMPLATE = '## PC review A\n\n### Workspace\n{{workspaceLines}}\n\n'
  + '### Written\n{{writtenLines}}\n\n### Calls{{items}}\n\nPC_REVIEW_TEMPLATE_A\n';
const STATUS_LEAD = 'PC_REVIEW_STATUS_LEAD_A';
const SKILL = 'PC_SECRETARY_BODY_A';

describe('ruling 14: a review-purpose Work Run renders from the resolved pack', () => {
  it('uses the injected review strings, base and Skill and freezes them', async () => {
    const fixture = await openPCK3ReviewFixture({
      systemInstruction: INSTRUCTION,
      skills: { resourceRoot: PLATFORM_SKILL_RESOURCE_ROOT, enabledIds: ['platform-secretary'] },
    });
    try {
      const pack = fixture.packs.snapshot();
      fixture.packs.replace({ ...pack,
        templates: { ...pack.templates,
          base: BASE,
          'unknown-call-review': REVIEW_TEMPLATE,
          'skill-platform-secretary': SKILL,
        },
        strings: { ...pack.strings, 'k3.workspace.statusLead': STATUS_LEAD } });
      await fixture.work.prepare();
      const prepared = await fixture.work.preparedTexts();

      expect(prepared.input).toContain(STATUS_LEAD);
      expect(prepared.texts.strings['k3.workspace.statusLead']).toBe(STATUS_LEAD);
      expect(prepared.texts.templates['unknown-call-review']).toBe(REVIEW_TEMPLATE);
      expect(prepared.set.templates.find(template => template.id === 'unknown-call-review')).toMatchObject({
        id: 'unknown-call-review', version: 1, packId: 'platform', digest: sha(REVIEW_TEMPLATE),
      });
      // PC-2 platform pack v2: the platform base version is 2.
      expect(prepared.texts.base).toEqual({ templateId: 'base', version: 2, text: `${BASE}\n\n${INSTRUCTION}` });
      expect(prepared.set.base).toMatchObject({ templateId: 'base', version: 2, digest: sha(`${BASE}\n\n${INSTRUCTION}`) });
      expect(prepared.texts.skills).toEqual([{ schemaVersion: 1, id: 'platform-secretary',
        title: 'Platform secretary', kind: 'instruction', priority: 70,
        source: `skill:platform-secretary@sha256:${sha(SKILL)}`, content: SKILL }]);
      expect(prepared.set.skills).toHaveLength(1);
      expect(prepared.set.skills[0]).toMatchObject({ schemaVersion: 1, id: 'platform-secretary',
        title: 'Platform secretary', kind: 'instruction', priority: 70,
        source: `skill:platform-secretary@sha256:${sha(SKILL)}`, digest: sha(SKILL) });
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
