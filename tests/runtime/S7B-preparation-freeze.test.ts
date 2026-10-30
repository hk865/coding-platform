/**
 * I-preparation (`7b:1204`, scenario TE3): Work and Query preparations freeze every
 * delivery template the execution may render later. The person's pack gives
 * `intervention-delivery` an "old" text; after preparation the real settings save
 * route writes a "new" text and a person sends a message to the claimed Session.
 * Both model requests must carry the old rendered text, never the new one.
 *
 * D1: 7b:1204 — the row is new; no assertion is removed or loosened.
 * SQLite only: the PC world fixes it (L-11; an exception to S3).
 */
import { describe, expect, it } from 'vitest';
import { createDiskPromptPackSource } from '../../src/app/prompt-packs.js';
import { openPC2HostFixture } from '../helpers/PC2-host-fixture.js';
import { openPC2QueryHistoryFixture, pc2PackEntry } from '../helpers/PC2-pack-fixture.js';
import { openPCWorkFixture, scriptedModel } from '../helpers/PC-platform-fixture.js';
import { sha } from '../helpers/B2-12-recognition-fixture.js';
import { requestText } from '../helpers/WP2-platform-support.js';

const PACK_ID = 's7b-preparation-pack';
const OLD_INTERVENTION = 'S7B OLD intervention {{messageId}}\n{{body}}';
const NEW_INTERVENTION = 'S7B NEW intervention {{messageId}}\n{{body}}';
const BODY = 'S7B person body';
/** `DELIVERY_SET_TEMPLATE_IDS` hand-written: the samples helper is not used here. */
const DELIVERY_IDS = [
  'action-request-delivery', 'inquiry-delivery', 'notify-delivery', 'wait-reply-delivery',
  'wait-expiry-delivery', 'intervention-delivery', 'user-decision-response',
] as const;

const rendered = (template: string, messageId: string): string =>
  template.replace('{{messageId}}', messageId).replace('{{body}}', BODY);

async function saveNewText(host: Awaited<ReturnType<typeof openPC2HostFixture>>): Promise<void> {
  const saved = await host.call('prompts/templates/save', {
    packId: PACK_ID, templateId: 'intervention-delivery', expectedVersion: 1,
    text: NEW_INTERVENTION, mentionsTools: [],
  });
  expect.soft(saved.status, saved.text).toBe(200);
  expect.soft(saved.body).toMatchObject({ status: 'ready', value: { version: 2 } });
}

describe('I-preparation: a Work preparation freezes the delivery text it will render', () => {
  it('the Work model request carries the old intervention text after the new text is saved', async () => {
    const pack = pc2PackEntry(PACK_ID, { templates: { 'intervention-delivery': OLD_INTERVENTION } });
    const host = await openPC2HostFixture({ packs: [pack] });
    let work: Awaited<ReturnType<typeof openPCWorkFixture>> | undefined;
    try {
      work = await openPCWorkFixture({
        promptPacks: createDiskPromptPackSource(host.paths.promptsDirectory),
        selection: { promptPack: PACK_ID },
        model: scriptedModel([{ text: 'S7B Work answer' }]),
      });
      await work.work.prepare();
      await saveNewText(host);
      const sent = await work.base.platform.messages.sendMessage(work.base.ctx, {
        input: { recipient: work.base.sessionRef, text: BODY },
        meta: { requestId: 's7b-work-send', expected: [] },
      });
      expect.soft(sent.status, JSON.stringify(sent)).toBe('committed');
      if (sent.status !== 'committed') return;
      const messageId = sent.value.ref.messageId;
      const started = await work.work.start();
      expect.soft(started.status, JSON.stringify(started)).toBe('ready');
      const content = requestText(work.model);
      expect.soft(content).toContain(rendered(OLD_INTERVENTION, messageId));
      expect.soft(content).not.toContain('S7B NEW');

      const record = await work.work.readPromptRecord();
      expect.soft(record.status, JSON.stringify(record)).toBe('ready');
      if (record.status !== 'ready') return;
      expect.soft(record.value.set.templates.map(template => template.id))
        .toEqual(['work-input', 'base', ...DELIVERY_IDS]);
      const intervention = record.value.set.templates.find(template => template.id === 'intervention-delivery');
      expect.soft(intervention?.digest).toBe(sha(OLD_INTERVENTION));
      expect.soft(intervention === undefined ? undefined : record.value.texts[intervention.digest])
        .toBe(OLD_INTERVENTION);
    } finally {
      await work?.close();
      await host.close();
    }
  }, 60_000);
});

describe('I-preparation: a Query preparation freezes the delivery text it will render', () => {
  it('the standalone semantic Query request carries the old intervention text after the new text is saved', async () => {
    const pack = pc2PackEntry(PACK_ID, { templates: { 'intervention-delivery': OLD_INTERVENTION } });
    const host = await openPC2HostFixture({ packs: [pack] });
    let query: Awaited<ReturnType<typeof openPC2QueryHistoryFixture>> | undefined;
    try {
      query = await openPC2QueryHistoryFixture({
        promptPacks: createDiskPromptPackSource(host.paths.promptsDirectory),
        selection: { promptPack: PACK_ID },
      });
      await saveNewText(host);
      const base = query.fixture.base;
      const sent = await base.platform.messages.sendMessage(base.ctx, {
        input: { recipient: base.sessionRef, text: BODY },
        meta: { requestId: 's7b-query-send', expected: [] },
      });
      expect.soft(sent.status, JSON.stringify(sent)).toBe('committed');
      if (sent.status !== 'committed') return;
      const messageId = sent.value.ref.messageId;
      const started = await query.reused.start();
      expect.soft(started.status, JSON.stringify(started)).toBe('ready');
      const content = requestText(query.fixture.model);
      expect.soft(content).toContain(rendered(OLD_INTERVENTION, messageId));
      expect.soft(content).not.toContain('S7B NEW');
      expect.soft(query.fixture.model.calls()).toBe(2);

      const set = query.reused.manifest.promptSet;
      // This Query follows a completed Work on the Session, so ruling 15 renders the
      // stale-files reminder inside the role slot before base.
      expect.soft(set.templates.map(template => template.id))
        .toEqual(['query-copy-input', 'stale-files-reminder', 'base', ...DELIVERY_IDS]);
      const intervention = set.templates.find(template => template.id === 'intervention-delivery');
      expect.soft(intervention?.digest).toBe(sha(OLD_INTERVENTION));
    } finally {
      await query?.close();
      await host.close();
    }
  }, 60_000);
});
