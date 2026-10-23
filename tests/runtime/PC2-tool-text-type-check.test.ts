/**
 * PC-2 ruling 20 (reader half): the expected content type is verified before the
 * body cache. A tool entry that reuses an already-read template prompt-text ref
 * shares its digest and size but names another type; the reader must reject it
 * instead of returning the cached template body as a tool text.
 *
 * Pure reader input: every body, digest and refusal reason is hand-written.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { PromptSetV1 } from '../../src/contracts/prompts/prompt-set.js';
import { PROMPT_TEXT_CONTENT_TYPE } from '../../src/contracts/prompts/prompt-set.js';
import type {
  MaterialOrigin, RawArtifactStorePort,
} from '../../src/core/record-store/body-ports.js';
import { readPromptTexts } from '../../src/core/agent-runtime/prompt-set-texts.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const ORIGIN: MaterialOrigin = { kind: 'run', owner: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r1' } };
const TOOL_BODY = '{"description":"X","parameters":{}}';
const STRINGS_BODY = '{}';
const BASE_BODY = 'PC2 BASE';

function refOf(body: string): ArtifactRef {
  return {
    kind: 'artifact', contentType: PROMPT_TEXT_CONTENT_TYPE,
    digest: sha(body), sizeBytes: Buffer.byteLength(body, 'utf8'),
    source: { kind: 'governance', refId: 'platform', revision: '1' },
  };
}

describe('PC-2 ruling 20: a prompt-text ref cannot satisfy a tool-text read', () => {
  it('rejects a tool entry whose ref has the cached template body and another content type', async () => {
    const templateRef = refOf(TOOL_BODY);
    const set: PromptSetV1 = {
      schemaVersion: 1, modelId: 'pc2-model', provider: 'deepseek', model: 'pc2-scripted',
      packId: 'platform', reasoningReplay: 'none',
      sectionOrder: { work: ['role'] },
      // The template is read first, so its body is in the reader's cache when
      // the tool entry below points at the SAME ref.
      templates: [{ id: 'base-twin', version: 1, packId: 'platform',
        digest: templateRef.digest, ref: templateRef }],
      strings: { digest: sha(STRINGS_BODY), ref: refOf(STRINGS_BODY) },
      base: { templateId: 'base', version: 1, digest: sha(BASE_BODY), ref: refOf(BASE_BODY) },
      skills: [],
      toolNames: ['read'],
      tools: [{ name: 'read', packId: 'platform', digest: templateRef.digest, ref: templateRef }],
    };
    expect(set.tools[0]?.ref).toEqual(set.templates[0]?.ref);
    const bodies = new Map<string, string>([
      [sha(TOOL_BODY), TOOL_BODY], [sha(STRINGS_BODY), STRINGS_BODY], [sha(BASE_BODY), BASE_BODY],
    ]);
    const store: Pick<RawArtifactStorePort, 'read'> = {
      async read(ref) {
        const body = bodies.get(ref.digest);
        if (body === undefined) return { status: 'rejected', code: 'unavailable', reason: 'PC2 no such body' };
        return { status: 'ready', value: { ref, body, sourceRefs: [], origin: ORIGIN } };
      },
    };
    expect(await readPromptTexts(store, set)).toEqual({
      status: 'rejected', code: 'invalid',
      reason: 'the frozen tool text read does not match its reference',
    });
  });
});
