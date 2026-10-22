/**
 * PC-1b P — ruling 19: frozen prompt bodies are content-addressed. The store
 * writes each distinct text once and the reader verifies every child against
 * its ref without asking for the writer's origin (an earlier run's body is the
 * same body).
 *
 * Every body, title and priority is a hand-written literal; every digest is the
 * SHA-256 of one (node:crypto), never the production helper or the generated
 * pack, so the expectations stay independent of the code under test.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { PromptSetV1 } from '../../src/contracts/prompts/prompt-set.js';
import {
  PROMPT_TEXT_CONTENT_TYPE,
} from '../../src/contracts/prompts/prompt-set.js';
import type {
  MaterialOrigin, RawArtifactPut, RawArtifactRecord, RawArtifactStorePort,
} from '../../src/core/record-store/body-ports.js';
import {
  readPromptTexts, storePromptTexts, type PromptPartsV1,
} from '../../src/core/agent-runtime/prompt-set-texts.js';

const ORIGIN: MaterialOrigin = { kind: 'run', owner: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r1' } };
const EARLIER_ORIGIN: MaterialOrigin = { kind: 'run', owner: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r0' } };
const AT = '2026-10-22T00:00:00.000Z';
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

function refOf(body: string, source: ArtifactRef['source'] = { kind: 'governance', refId: 'platform', revision: '1' }): ArtifactRef {
  return {
    kind: 'artifact', contentType: PROMPT_TEXT_CONTENT_TYPE,
    digest: sha(body), sizeBytes: Buffer.byteLength(body, 'utf8'),
    source,
  };
}

const PARTS: PromptPartsV1 = {
  selection: { modelId: 'pc-model', provider: 'deepseek', model: 'pc-scripted', packId: 'platform', reasoningReplay: 'none' },
  sectionOrder: { work: ['role', 'goal', 'task'] },
  templates: [
    { id: 'work-input', version: 1, packId: 'platform', text: 'SAME_TEXT' },
    { id: 'person-template', version: 2, packId: 'person-a', text: 'SAME_TEXT' },
  ],
  strings: { 'role.executor.label': 'PC_ROLE' },
  base: { templateId: 'base', version: 1, text: 'MERGED_BASE' },
  skills: [{ schemaVersion: 1, id: 'platform-work', title: 'Platform work', kind: 'instruction', priority: 90,
    source: `skill:platform-work@sha256:${sha('SKILL_TEXT')}`, content: 'SKILL_TEXT' }],
};

/** A real put/read store that remembers the first body per content key. */
function memoryStore(): Pick<RawArtifactStorePort, 'put' | 'read'> & { puts: RawArtifactPut[] } {
  const puts: RawArtifactPut[] = [];
  const bodies = new Map<string, string>();
  const refs = new Map<string, ArtifactRef>();
  return {
    puts,
    async put(input) {
      puts.push(input);
      const key = `${input.contentType}|${sha(input.body)}|${String(Buffer.byteLength(input.body, 'utf8'))}`;
      bodies.set(key, input.body);
      refs.set(key, refOf(input.body, input.sourceRefs[0]!));
      return { status: 'ready', value: { ref: refs.get(key)!, replayed: false } };
    },
    async read(ref) {
      const key = `${ref.contentType}|${ref.digest}|${String(ref.sizeBytes)}`;
      const body = bodies.get(key);
      if (body === undefined) return { status: 'rejected', code: 'unavailable', reason: 'PC memory store has no body' };
      const record: RawArtifactRecord = { ref, body, sourceRefs: [], origin: EARLIER_ORIGIN };
      return { status: 'ready', value: record };
    },
  };
}

describe('ruling 19: storing the frozen prompt texts', () => {
  it('stores each distinct content once and builds the set from the returned refs', async () => {
    const store = memoryStore();
    const result = await storePromptTexts(store, ORIGIN, PARTS, AT);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    const set: PromptSetV1 = result.value;
    // Four distinct texts: SAME_TEXT (twice), the string table, the merged base, the Skill.
    expect(store.puts.map(put => put.body)).toEqual(['SAME_TEXT', '{"role.executor.label":"PC_ROLE"}', 'MERGED_BASE', 'SKILL_TEXT']);
    expect(store.puts.filter(put => put.body === 'SAME_TEXT')).toHaveLength(1);
    expect(set.templates.map(template => [template.id, template.version, template.packId, template.digest])).toEqual([
      ['work-input', 1, 'platform', sha('SAME_TEXT')],
      ['person-template', 2, 'person-a', sha('SAME_TEXT')],
    ]);
    expect(set.templates[0]?.ref).toEqual(set.templates[1]?.ref);
    expect(set.strings.digest).toBe(sha('{"role.executor.label":"PC_ROLE"}'));
    expect(set.base).toEqual({ templateId: 'base', version: 1, digest: sha('MERGED_BASE'), ref: refOf('MERGED_BASE') });
    expect(set.skills[0]).toEqual({ schemaVersion: 1, id: 'platform-work', title: 'Platform work',
      kind: 'instruction', priority: 90, source: `skill:platform-work@sha256:${sha('SKILL_TEXT')}`,
      digest: sha('SKILL_TEXT'), ref: refOf('SKILL_TEXT', { kind: 'governance', refId: 'platform', revision: '1' }) });
    expect(set).toMatchObject({ schemaVersion: 1, modelId: 'pc-model', provider: 'deepseek', model: 'pc-scripted',
      packId: 'platform', reasoningReplay: 'none', sectionOrder: { work: ['role', 'goal', 'task'] } });
  });
});

describe('ruling 19: reading the frozen prompt texts', () => {
  it('reads every child by its ref and does not require the child origin to be this run', async () => {
    const store = memoryStore();
    const stored = await storePromptTexts(store, ORIGIN, PARTS, AT);
    expect(stored.status).toBe('ready');
    if (stored.status !== 'ready') return;
    const read = await readPromptTexts(store, stored.value);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.templates).toEqual({ 'work-input': 'SAME_TEXT', 'person-template': 'SAME_TEXT' });
    expect(read.value.strings).toEqual({ 'role.executor.label': 'PC_ROLE' });
    expect(read.value.base).toEqual({ templateId: 'base', version: 1, text: 'MERGED_BASE' });
    expect(read.value.skills).toEqual([{ schemaVersion: 1, id: 'platform-work', title: 'Platform work', kind: 'instruction',
      priority: 90, source: `skill:platform-work@sha256:${sha('SKILL_TEXT')}`, content: 'SKILL_TEXT' }]);
  });

  it('rejects a same-length tampered body and keeps a separate length negative', async () => {
    const store = memoryStore();
    const stored = await storePromptTexts(store, ORIGIN, PARTS, AT);
    if (stored.status !== 'ready') throw new Error('store failed');
    // Same UTF-8 length as SAME_TEXT (9 bytes), different digest: only the
    // digest check can tell them apart.
    const TAMPERED = 'DIFF_TEXT';
    expect(Buffer.byteLength(TAMPERED, 'utf8')).toBe(9);
    const tampered: Pick<RawArtifactStorePort, 'read'> = {
      async read(ref) {
        if (ref.digest === sha('SAME_TEXT')) {
          return { status: 'ready', value: { ref, body: TAMPERED, sourceRefs: [], origin: EARLIER_ORIGIN } };
        }
        return store.read(ref);
      },
    };
    expect(await readPromptTexts(tampered, stored.value)).toMatchObject({ status: 'rejected', code: 'invalid' });

    // A separate length negative: the digest matches the true strings body,
    // but the ref claims one more byte.
    const stringsBody = JSON.stringify(PARTS.strings);
    const wrongSize = { ...stored.value.strings.ref, sizeBytes: stored.value.strings.ref.sizeBytes + 1 };
    const lengthSet: PromptSetV1 = {
      ...stored.value, strings: { digest: stored.value.strings.digest, ref: wrongSize },
    };
    const lengthReader: Pick<RawArtifactStorePort, 'read'> = {
      async read(ref) {
        if (ref.digest === stored.value.strings.digest) {
          return { status: 'ready', value: { ref, body: stringsBody, sourceRefs: [], origin: EARLIER_ORIGIN } };
        }
        return store.read(ref);
      },
    };
    expect(await readPromptTexts(lengthReader, lengthSet)).toMatchObject({ status: 'rejected', code: 'invalid' });

    const missing: Pick<RawArtifactStorePort, 'read'> = { async read() {
      return { status: 'rejected', code: 'unavailable', reason: 'PC store read failure' };
    } };
    expect(await readPromptTexts(missing, stored.value)).toMatchObject({ status: 'rejected', code: 'unavailable' });
  });
});
