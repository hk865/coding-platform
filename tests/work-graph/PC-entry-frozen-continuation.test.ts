/**
 * PC-1b P (ruling 17): the Work entry re-renders the continuation brief from
 * the template text and string table frozen in the saved manifest's
 * `promptSet`, never from the pack the fixture can change afterwards. The
 * second case fails only the ENTRY's prompt-text read: the driver's earlier
 * read of the same frozen set succeeds.
 *
 * Both cases reach the entry through public steps (prepare, start, the real
 * requeue/continuation claim, prepare, start). No manifest is hand-written, and
 * every injected text is a literal.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import { PROMPT_TEXT_CONTENT_TYPE } from '../../src/contracts/prompts/prompt-set.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { openPCWorkFixture, scriptedModel } from '../helpers/PC-platform-fixture.js';

/** Literal copies of the pack's continuation template with a distinguishable tail. */
const CONTINUATION_TEMPLATE_FROZEN = '## 接续说明\n{{marker}}{{body}}{{blockedOmission}}{{bodyOmission}}'
  + '{{anomalies}}{{review}}{{blocked}}\n\nPC-FROZEN-CONTINUATION-A\n';
const CONTINUATION_TEMPLATE_AFTER = '## 接续说明\n{{marker}}{{body}}{{blockedOmission}}{{bodyOmission}}'
  + '{{anomalies}}{{review}}{{blocked}}\n\nPC-FROZEN-CONTINUATION-B\n';
const SUMMARY_LEAD_FROZEN = 'PC-FROZEN-BRIEF-LEAD-A';
const SUMMARY_LEAD_AFTER = 'PC-FROZEN-BRIEF-LEAD-B';

const withContinuationPack = (pack: ResolvedPromptPackV1, text: string, lead: string): ResolvedPromptPackV1 =>
  ({ ...pack,
    templates: { ...pack.templates, 'continuation-brief': text },
    strings: { ...pack.strings, 'brief.summary.lead': lead } });

/** The user message the scripted model received, i.e. the frozen manifest input. */
function userText(fixture: Awaited<ReturnType<typeof openPCWorkFixture>>): string {
  return (fixture.model.lastRequest()?.messages ?? [])
    .map(message => message.role === 'user' ? message.content : '').join('\n');
}

describe('PC entry frozen continuation-brief text (ruling 17)', () => {
  it('re-renders the saved brief from the frozen template and strings after the pack changes', async () => {
    // The first Run ends `crashed` (a real requeueable ending); the continuation
    // then reuses the real public requeue/claim path.
    const fixture = await openPCWorkFixture({
      model: scriptedModel([
        { beforeReply: async () => { throw new Error('PC base crash'); } },
        { text: 'PC continuation answer' },
      ]),
    });
    try {
      await fixture.work.prepare();
      expect((await fixture.work.start()).status).toBe('ready');

      const continuation = await fixture.continuation();
      fixture.packs.replace(withContinuationPack(
        fixture.packs.snapshot(), CONTINUATION_TEMPLATE_FROZEN, SUMMARY_LEAD_FROZEN));
      await continuation.prepare();

      const prepared = await continuation.preparedTexts();
      expect(prepared.texts.templates['continuation-brief']).toBe(CONTINUATION_TEMPLATE_FROZEN);
      expect(prepared.texts.strings['brief.summary.lead']).toBe(SUMMARY_LEAD_FROZEN);
      expect(prepared.input).toContain(SUMMARY_LEAD_FROZEN);

      // Change the pack AFTER preparation: the entry must re-render with the
      // frozen template AND the frozen string table, not these values.
      fixture.packs.replace(withContinuationPack(
        fixture.packs.snapshot(), CONTINUATION_TEMPLATE_AFTER, SUMMARY_LEAD_AFTER));
      expect(fixture.packs.snapshot().templates['continuation-brief']).toBe(CONTINUATION_TEMPLATE_AFTER);

      const started = await continuation.start();
      expect(started.status).toBe('ready');
      expect(userText(fixture)).toContain(SUMMARY_LEAD_FROZEN);
      expect(userText(fixture)).not.toContain(SUMMARY_LEAD_AFTER);
    } finally {
      await fixture.close();
    }
  });

  it('answers unavailable when only the entry cannot read the frozen prompt text', async () => {
    const fixture = await openPCWorkFixture({
      model: scriptedModel([
        { beforeReply: async () => { throw new Error('PC base crash'); } },
        { text: 'PC unreachable continuation answer' },
      ]),
    });
    try {
      await fixture.work.prepare();
      expect((await fixture.work.start()).status).toBe('ready');
      const continuation = await fixture.continuation();
      await continuation.prepare();
      const prepared = await continuation.preparedTexts();
      // The driver's earlier read covers every frozen child once: templates,
      // the string table, the base and each Skill.
      const driverReads = prepared.set.templates.length + 2 + prepared.set.skills.length;
      let promptTextReads = 0;

      // Fault injection: the driver's earlier read succeeds; from the first read
      // that exceeds it (the entry's own re-render) every prompt text fails.
      const original = RawArtifactBodyStore.prototype.read;
      const spy = vi.spyOn(RawArtifactBodyStore.prototype, 'read').mockImplementation(
        function (this: RawArtifactBodyStore, ref: ArtifactRef) {
          if (ref.contentType === PROMPT_TEXT_CONTENT_TYPE) {
            promptTextReads += 1;
            // Exactly the entry's FIRST read fails; the driver's whole earlier
            // read (and any later read) is served by the real store.
            if (promptTextReads === driverReads + 1) {
              return Promise.resolve({ status: 'rejected', code: 'unavailable',
                reason: 'PC injected entry prompt-text read failure' });
            }
          }
          return original.call(this, ref);
        });
      try {
        const started = await continuation.start();
        expect(started).toMatchObject({ status: 'rejected', code: 'unavailable' });
        if (started.status !== 'rejected') throw new Error(JSON.stringify(started));
        // The entry's OWN unreadable-template branch answered, not a later catch:
        // the reason names the frozen template and the injected read failure.
        expect(started.reason).toBe(
          'the frozen continuation-brief template could not be read: PC injected entry prompt-text read failure');
        // The whole driver read succeeded; the entry's first own read failed.
        expect(promptTextReads).toBe(driverReads + 1);
        // The continuation never reached the model: only the base Run's reply was used.
        expect(fixture.model.calls()).toBe(1);
      } finally {
        spy.mockRestore();
      }
    } finally {
      await fixture.close();
    }
  });
});
