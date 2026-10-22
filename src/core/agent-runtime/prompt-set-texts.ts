/**
 * Storing and reading the prepared prompt texts (slice 6-7 spec §2, rulings 14,
 * 15 and 19). The manifest carries only the `PromptSetV1` references and
 * digests; the texts themselves live in the content-addressed body store.
 *
 * `storePromptTexts` writes every used template, the merged string table, the
 * merged base and each Skill content, once per distinct text (F17), then builds
 * the set from the returned refs. `readPromptTexts` is the reverse: it reads a
 * child body by its ref, verifies it against that ref and never asks whose
 * origin it is (a body may have been written by an earlier run).
 */
import { resolve } from 'node:path';
import type { ArtifactRef } from '../../contracts/artifact.js';
import type { SourceRefV1 } from '../../contracts/dispatch.js';
import type { BaseSystemPromptInput } from '../../../vendor/coding-agent/dist/public-api.js';
import { FileSkillLoader as KernelFileSkillLoader } from '../../../vendor/coding-agent/dist/public-api.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import { checkPromptBody, PROMPT_TEXT_CONTENT_TYPE, type PromptSetV1, type PromptTextsV1 } from '../../contracts/prompts/prompt-set.js';
import { PLATFORM_SKILLS } from '../../contracts/prompts/platform-skills.js';
import {
  createPlatformPromptPackSource, type PromptPackSourcePort, type ResolvedPromptPackV1,
} from '../../contracts/prompts/prompt-pack.js';
import { sha256Hex } from '../../contracts/fingerprint.js';
import type { MaterialOrigin, RawArtifactStorePort } from '../record-store/body-ports.js';
import { PLATFORM_SKILL_RESOURCE_ROOT } from './platform-skill-root.js';

/** A Kernel `SkillContext` as the Runtime materializes it (public-api does not re-export the type). */
export type PromptSkillV1 = {
  schemaVersion: 1;
  id: string;
  title: string;
  kind: 'instruction' | 'reference';
  priority: number;
  source: string;
  content: string;
};

/** One used template: its pack identity and the exact text that was read. */
export type PromptTemplatePartV1 = { id: string; version: number; packId: string; text: string };

/**
 * P's input to `storePromptTexts`: the frozen selection, the projected call-kind
 * section order, every template the renderers read (in first-read order), the
 * merged string table, the merged base and the selected Skills.
 */
export type PromptPartsV1 = {
  selection: {
    modelId: string;
    provider: string;
    model: string;
    packId: string;
    reasoningReplay: 'current_run' | 'none';
  };
  sectionOrder: PromptSetV1['sectionOrder'];
  templates: readonly PromptTemplatePartV1[];
  strings: Readonly<Record<string, string>>;
  base: { templateId: string; version: number; text: string };
  skills: readonly PromptSkillV1[];
};

/** The texts a preparation reads, plus the ids read through the resolved pack. */
export type TrackedPromptTextsV1 = {
  texts: PromptTextsV1;
  /** Template ids in first-read order; every read goes through the resolved pack. */
  usedTemplates: () => string[];
};

/**
 * Wraps a resolved pack as the narrow `PromptTextsV1` every renderer takes and
 * records each template read. Tracking is by observation, never by a code list:
 * a renderer that does not read a template leaves it out of the set.
 */
export function trackPromptTexts(pack: { templates: Readonly<Record<string, string>>; strings: Readonly<Record<string, string>> }): TrackedPromptTextsV1 {
  const used: string[] = [];
  const seen = new Set<string>();
  const templates = new Proxy({ ...pack.templates }, {
    get(target, property, receiver) {
      if (typeof property === 'string' && Object.hasOwn(target, property) && !seen.has(property)) {
        seen.add(property);
        used.push(property);
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  return { texts: { templates, strings: pack.strings }, usedTemplates: () => [...used] };
}

function rejected(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}

/**
 * Ruling 14 item 2: the pack is resolved ONCE, before anything renders. An
 * absent source uses the ruling-30 default installation (the generated platform
 * pack) — this is not a fallback for a named pack: any rejection of the requested
 * pack becomes `invalid`, names the pack and keeps the source's reason.
 */
export async function resolvePromptPack(
  source: PromptPackSourcePort | undefined,
  packId: string,
  signal: AbortSignal,
): Promise<{ status: 'ready'; value: ResolvedPromptPackV1 } | CoreRejection> {
  source ??= createPlatformPromptPackSource();
  let resolved;
  try {
    resolved = await source.resolve(packId, signal);
  } catch (error) {
    if (signal.aborted) return rejected('cancelled', 'the preparation was cancelled while the prompt pack was resolved');
    return rejected('invalid', `the prompt pack ${packId} could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (resolved.status === 'rejected') {
    return rejected('invalid', `the prompt pack ${packId} could not be resolved: ${resolved.reason}`);
  }
  return { status: 'ready', value: resolved.value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(entry => typeof entry === 'string');
}

type StoredText = { digest: string; ref: ArtifactRef };

/**
 * Stores every part once per distinct text and returns the frozen `PromptSetV1`.
 * A failed put is `unavailable`, exactly like a failed manifest store.
 */
export async function storePromptTexts(
  bodies: Pick<RawArtifactStorePort, 'put'>,
  origin: MaterialOrigin,
  parts: PromptPartsV1,
  requestedAt: string,
): Promise<{ status: 'ready'; value: PromptSetV1 } | CoreRejection> {
  const byText = new Map<string, StoredText>();
  // The body store wants provenance: the pack and the base template version
  // name where these texts came from. §4's signature has no sourceRefs argument.
  const sourceRefs: SourceRefV1[] = [{ kind: 'governance', refId: parts.selection.packId, revision: String(parts.base.version) }];
  const store = async (text: string): Promise<StoredText | CoreRejection> => {
    const hit = byText.get(text);
    if (hit !== undefined) return hit;
    let put;
    try {
      put = await bodies.put({ body: text, contentType: PROMPT_TEXT_CONTENT_TYPE, sourceRefs, origin, requestedAt });
    } catch (error) {
      return rejected('unavailable', `storing a prompt text failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (put.status !== 'ready') return rejected('unavailable', `storing a prompt text failed: ${put.reason}`);
    const stored = { digest: sha256Hex(text), ref: put.value.ref };
    byText.set(text, stored);
    return stored;
  };

  const templates: PromptSetV1['templates'] = [];
  for (const template of parts.templates) {
    const stored = await store(template.text);
    if ('status' in stored) return stored;
    templates.push({ id: template.id, version: template.version, packId: template.packId,
      digest: stored.digest, ref: stored.ref });
  }
  const strings = await store(JSON.stringify(parts.strings));
  if ('status' in strings) return strings;
  const base = await store(parts.base.text);
  if ('status' in base) return base;
  const skills: PromptSetV1['skills'] = [];
  for (const skill of parts.skills) {
    const stored = await store(skill.content);
    if ('status' in stored) return stored;
    skills.push({ schemaVersion: 1, id: skill.id, title: skill.title, kind: skill.kind,
      priority: skill.priority, source: skill.source, digest: stored.digest, ref: stored.ref });
  }
  return {
    status: 'ready',
    value: {
      schemaVersion: 1,
      ...parts.selection,
      sectionOrder: parts.sectionOrder,
      templates,
      strings: { digest: strings.digest, ref: strings.ref },
      base: { templateId: parts.base.templateId, version: parts.base.version,
        digest: base.digest, ref: base.ref },
      skills,
    },
  };
}

/**
 * Reads every body the set references and verifies it against its ref. The
 * origin is never checked (ruling 19): content addressing makes a body written
 * by an earlier run the same body. A body that cannot be read is `unavailable`;
 * a body that does not match its ref is `invalid`.
 */
export async function readPromptTexts(
  bodies: Pick<RawArtifactStorePort, 'read'>,
  set: PromptSetV1,
): Promise<{ status: 'ready'; value: PromptTextsV1 & { base: BaseSystemPromptInput; skills: PromptSkillV1[] } } | CoreRejection> {
  const cache = new Map<string, string>();
  const read = async (ref: ArtifactRef, what: string): Promise<string | CoreRejection> => {
    const key = `${ref.contentType}|${ref.digest}|${String(ref.sizeBytes)}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let stored;
    try {
      stored = await bodies.read(ref);
    } catch (error) {
      return rejected('unavailable', `reading ${what} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (stored.status !== 'ready') return rejected('unavailable', `${what} is not readable`);
    const body = checkPromptBody(ref, stored.value, PROMPT_TEXT_CONTENT_TYPE);
    if (body === null) return rejected('invalid', `${what} does not match its reference`);
    cache.set(key, body);
    return body;
  };

  const templates: Record<string, string> = {};
  for (const template of set.templates) {
    const text = await read(template.ref, `the frozen template ${template.id}`);
    if (typeof text !== 'string') return text;
    templates[template.id] = text;
  }
  const stringsText = await read(set.strings.ref, 'the frozen string table');
  if (typeof stringsText !== 'string') return stringsText;
  let strings: unknown;
  try { strings = JSON.parse(stringsText); } catch { return rejected('invalid', 'the frozen string table is not valid JSON'); }
  if (!isStringRecord(strings)) return rejected('invalid', 'the frozen string table is not a string table');
  const baseText = await read(set.base.ref, 'the frozen base prompt');
  if (typeof baseText !== 'string') return baseText;
  const skills: PromptSkillV1[] = [];
  for (const skill of set.skills) {
    const content = await read(skill.ref, `the frozen Skill ${skill.id}`);
    if (typeof content !== 'string') return content;
    skills.push({ schemaVersion: 1, id: skill.id, title: skill.title, kind: skill.kind,
      priority: skill.priority, source: skill.source, content });
  }
  return {
    status: 'ready',
    value: {
      templates,
      strings,
      base: { templateId: set.base.templateId, version: set.base.version, text: baseText },
      skills,
    },
  };
}

/** Today's no-selection default (observed-model-run.ts): the Kernel's shipped Skill directory. */
export const DEFAULT_SKILL_SELECTION: { resourceRoot: string; enabledIds: string[] } = {
  resourceRoot: resolve(import.meta.dirname, '../../../vendor/coding-agent/resources/skills'),
  enabledIds: ['coding-safety'],
};

export type PromptSkillSelectionV1 = { resourceRoot: string; enabledIds: string[] };

/**
 * Ruling 15: the platform root uses the resolved pack's Skill templates and
 * `PLATFORM_SKILLS` metadata; any other root goes through the Kernel's public
 * loader; an explicit empty selection stays empty; no selection takes today's
 * default. An unknown platform id is `invalid`.
 */
export async function selectPromptSkills(
  selection: PromptSkillSelectionV1 | undefined,
  texts: PromptTextsV1,
  options: { signal: AbortSignal; kernel?: typeof import('../../../vendor/coding-agent/dist/public-api.js') },
): Promise<{ status: 'ready'; value: PromptSkillV1[] } | CoreRejection> {
  if (selection === undefined) selection = DEFAULT_SKILL_SELECTION;
  if (selection.enabledIds.length === 0) return { status: 'ready', value: [] };
  if (resolve(selection.resourceRoot) === PLATFORM_SKILL_RESOURCE_ROOT) {
    const known = new Map(PLATFORM_SKILLS.map(skill => [skill.id, skill]));
    const skills: PromptSkillV1[] = [];
    for (const requestedId of selection.enabledIds) {
      // The old loader normalized the requested ids before selecting; keep that
      // rule here so an explicit ` platform-secretary ` still names the Skill.
      const id = requestedId.trim();
      const entry = known.get(id);
      if (entry === undefined) return rejected('invalid', `the platform Skill ${id} is not available`);
      const content = texts.templates[entry.templateId];
      if (content === undefined) return rejected('invalid', `the prompt pack has no template ${entry.templateId} for Skill ${id}`);
      skills.push({ schemaVersion: 1, id: entry.id, title: entry.title, kind: entry.kind,
        priority: entry.priority, content, source: `skill:${entry.id}@sha256:${sha256Hex(content)}` });
    }
    return { status: 'ready', value: skills };
  }
  // Direct preparation callers need no injected Kernel: the public loader is the
  // same one production passes, so a custom directory is readable either way.
  const fileSkillLoader = options.kernel?.FileSkillLoader ?? KernelFileSkillLoader;
  try {
    const loader = await fileSkillLoader.create(selection.resourceRoot);
    const registry = await loader.load(options.signal);
    const selected = await registry.select({ schemaVersion: 1, requestedIds: selection.enabledIds }, { signal: options.signal });
    return { status: 'ready', value: selected.map(skill => ({ schemaVersion: 1, id: skill.id, title: skill.title,
      kind: skill.kind, priority: skill.priority, content: skill.content, source: skill.source })) };
  } catch (error) {
    const code = isRecord(error) && typeof error['code'] === 'string' ? error['code'] : undefined;
    const reason = error instanceof Error ? error.message : String(error);
    if (code === 'cancelled') return rejected('cancelled', reason);
    if (code === 'not_found' || code === 'resource_invalid' || code === 'invalid_request') return rejected('invalid', reason);
    return rejected('unavailable', reason);
  }
}

