/**
 * PC-2 ruling 19/20, PC-26 (Q half): the frozen tool texts. A person's pack
 * changes a tool description and a parameter text; preparation freezes the
 * canonical body and its digest, the model request carries it, a later pack
 * change does not reach the start, and the record carries the body.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PROMPT_TOOL_TEXT_CONTENT_TYPE } from '../../src/contracts/prompts/prompt-set.js';
import { openPCWorkFixture, scriptedModel } from '../helpers/PC-platform-fixture.js';
import { pc2PackEntry, pc2ResolvedSource } from '../helpers/PC2-pack-fixture.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const NOTE_BODY = JSON.stringify({ description: 'PC2 note text', parameters: {} });
const LIST_BODY = JSON.stringify({ description: 'PC2 list text', parameters: { prefix: 'PC2 prefix text' } });

function packWithTexts(note: string, list: string, prefix: string) {
  return pc2PackEntry('pc2-tools', {
    tools: {
      record_note: { description: note, parameters: {} },
      list_files: { description: list, parameters: { prefix } },
    },
  });
}

describe('PC-26 the frozen tool texts reach the request and the record', () => {
  it('PC-26 freezes the canonical body, sends the prepared text and keeps it after the pack changes', async () => {
    const pack = packWithTexts('PC2 note text', 'PC2 list text', 'PC2 prefix text');
    const source = await pc2ResolvedSource([pack]);
    const fixture = await openPCWorkFixture({
      promptPacks: source,
      selection: { promptPack: pack.packId },
      tools: ['read', 'record_note', 'list_files'],
      model: scriptedModel([{ text: 'PC2 tool texts answer' }]),
    });
    try {
      await fixture.work.prepare();
      const prepared = await fixture.work.preparedTexts();
      // Hand-computed canonical bodies and digests, sorted by name.
      expect(prepared.set.tools.map(entry => entry.name)).toEqual([
        'code_index', 'cpp_index', 'list_files', 'project_source', 'python_index',
        'record_note', 'search', 'source_excerpt', 'symbols',
      ]);
      expect(prepared.set.tools.find(entry => entry.name === 'record_note')).toMatchObject({
        name: 'record_note', packId: pack.packId, digest: sha(NOTE_BODY),
      });
      expect(prepared.set.tools.find(entry => entry.name === 'list_files')).toMatchObject({
        name: 'list_files', packId: pack.packId, digest: sha(LIST_BODY),
      });
      expect(prepared.texts.tools['record_note']).toEqual({ description: 'PC2 note text', parameters: {} });
      expect(prepared.texts.tools['list_files']).toEqual({
        description: 'PC2 list text', parameters: { prefix: 'PC2 prefix text' },
      });

      // The pack changes AFTER preparation; the start must still send the frozen texts.
      source.replace({ ...source.snapshot(), tools: {
        ...source.snapshot().tools,
        record_note: { description: 'PC2 LATER note', parameters: {} },
        list_files: { description: 'PC2 LATER list', parameters: { prefix: 'PC2 LATER prefix' } },
      } });
      await fixture.work.start();
      const tools = fixture.model.requests[0]?.tools ?? [];
      expect(tools.find(tool => tool.name === 'record_note')?.description).toBe('PC2 note text');
      expect(tools.find(tool => tool.name === 'list_files')?.description).toBe('PC2 list text');
      expect(tools.find(tool => tool.name === 'list_files')?.inputSchema).toMatchObject({
        properties: { prefix: { description: 'PC2 prefix text' } },
      });

      const record = await fixture.work.readPromptRecord();
      expect(record.status).toBe('ready');
      if (record.status !== 'ready') throw new Error('PC-26 readPromptRecord failed');
      expect(record.value.texts[sha(NOTE_BODY)]).toBe(NOTE_BODY);
      expect(record.value.texts[sha(LIST_BODY)]).toBe(LIST_BODY);
    } finally {
      await fixture.close();
    }
  });

  it('PC-26 a store failure on only the tool-text content type is the preparation\'s unavailable', async () => {
    const pack = packWithTexts('PC2 note text', 'PC2 list text', 'PC2 prefix text');
    const source = await pc2ResolvedSource([pack]);
    const fixture = await openPCWorkFixture({
      promptPacks: source,
      failPutContentType: PROMPT_TOOL_TEXT_CONTENT_TYPE,
      selection: { promptPack: pack.packId },
      tools: ['read', 'record_note', 'list_files'],
      model: scriptedModel([{ text: 'PC2 store failure answer' }]),
    });
    try {
      const prepared = await fixture.runtime.prepareExecution(fixture.base.ctx, {
        runRef: fixture.work.runRef, requestId: 'pc2-tools-store-failure',
      });
      expect(prepared).toMatchObject({ status: 'rejected', code: 'unavailable' });
      if (prepared.status !== 'rejected') throw new Error('PC-26 expected a rejection');
      expect(prepared.reason).toContain('prompt text');
    } finally {
      await fixture.close();
    }
  });
});
