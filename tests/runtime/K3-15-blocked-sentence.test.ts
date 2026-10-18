/**
 * K3-15 (二) / B3 item 6: the required blocked-command sentence and the
 * optional `### 被拦的命令` section of the continuation brief.
 *
 * These are pure-contract rows: the brief is a value, the renderer is the
 * production one. The integration row beside the real `skip_as_done` owner lives
 * in `K3-15-disposition-effects.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  continuationBriefDigest, continuationBriefShapeProblem, renderContinuationBriefZh,
  type ContinuationBriefV1, type ContinuationUnknownCallReviewV1,
} from '../../src/contracts/continuation-brief.js';
import { baseBrief, sha } from '../helpers/K3-continuation-pure-fixture.js';

const SENTENCE = '- 平台拦下原命令；要再跑先请求并得到允许。';
const NOT_LISTED = '- 不在变动清单里，不证明没做。';
const HEADING = '### 被拦的命令';

function review(
  over: Partial<ContinuationUnknownCallReviewV1> = {},
): ContinuationUnknownCallReviewV1 {
  return {
    reviewRef: { aggregateType: 'UnknownCallReview', projectId: 'k3r-project', goalId: 'k3r-goal', runId: 'run-1' },
    revision: 1, origin: 'takeover_unresolved', inventory: 'complete', items: [], itemsOmitted: 0,
    disposition: null,
    workspace: { status: 'unavailable', runBaselineKnown: false, notVisible: [], changedSample: [], changedOmitted: 0 },
    ...over,
  };
}

function render(brief: ContinuationBriefV1): string {
  return renderContinuationBriefZh(brief, continuationBriefDigest(brief));
}

describe('K3-15 (二): the required blocked-command sentence', () => {
  it('renders the 62-byte sentence after the fixed sentence exactly when the record has blocked commands', () => {
    expect(Buffer.byteLength(SENTENCE, 'utf8')).toBe(62);
    const withBlocks = { ...baseBrief(), unknownCallReview: review({ blockedCommands: [
      { alias: 1, reviewRunId: 'run-1', commandSha256: sha('a') },
    ] }) };
    const text = render(withBlocks);
    expect(text).toContain(`${NOT_LISTED}\n${SENTENCE}`);
    expect(text.indexOf(NOT_LISTED)).toBeLessThan(text.indexOf(SENTENCE));
    // The sentence is the last line of the required part, before the ending.
    expect(text.indexOf(SENTENCE)).toBeLessThan(text.indexOf('### 继续之前'));

    const withoutBlocks = { ...baseBrief(), unknownCallReview: review() };
    const before = render(withoutBlocks);
    expect(before).toContain(NOT_LISTED);
    expect(before).not.toContain(SENTENCE);
    // Present-only-when-non-empty: an absent field keeps the old bytes.
    const absent = { ...baseBrief(), unknownCallReview: review() };
    delete (absent.unknownCallReview as { blockedCommands?: unknown }).blockedCommands;
    expect(render(absent)).toBe(before);
  });

  it('accepts the field strictly and rejects bad aliases, digests, states and unknown fields', () => {
    const valid = { ...baseBrief(), unknownCallReview: review({ blockedCommands: [
      { alias: 1, reviewRunId: 'run-1', commandSha256: sha('a') },
    ] }) };
    expect(continuationBriefShapeProblem(valid)).toBeNull();
    const badAlias = { ...baseBrief(), unknownCallReview: review({ blockedCommands: [
      { alias: 33, reviewRunId: 'run-1', commandSha256: sha('a') },
    ] }) };
    expect(continuationBriefShapeProblem(badAlias)).toMatch(/alias/);
    const badDigest = { ...baseBrief(), unknownCallReview: review({ blockedCommands: [
      { alias: 1, reviewRunId: 'run-1', commandSha256: 'A'.repeat(64) },
    ] }) };
    expect(continuationBriefShapeProblem(badDigest)).toMatch(/commandSha256/);
    const withExtraBlocks: NonNullable<ContinuationUnknownCallReviewV1['blockedCommands']> = [
      { alias: 1, reviewRunId: 'run-1', commandSha256: sha('a') },
    ];
    (withExtraBlocks[0] as unknown as Record<string, unknown>)['extra'] = 1;
    const withExtra = { ...baseBrief(), unknownCallReview: review({ blockedCommands: withExtraBlocks }) };
    expect(continuationBriefShapeProblem(withExtra)).toMatch(/unknown field extra/);

    const section: ContinuationBriefV1 = {
      ...baseBrief(),
      blockedCommands: [
        { alias: 1, reviewRunId: 'run-1', requestState: 'pending', declaredForms: ['a'] },
      ],
    };
    expect(continuationBriefShapeProblem(section)).toBeNull();
    const badState = { ...section, blockedCommands: [
      { alias: 1, reviewRunId: 'run-1', requestState: 'used', declaredForms: [] },
    ] };
    expect(continuationBriefShapeProblem(badState)).toMatch(/requestState/);
    const badForms = { ...section, blockedCommands: [
      { alias: 1, reviewRunId: 'run-1', requestState: null, declaredForms: [1] },
    ] };
    expect(continuationBriefShapeProblem(badForms)).toMatch(/declaredForms/);
  });
});

describe('K3-15 (二): the optional blocked-command section', () => {
  it('renders one line per command with the request state, declared forms and the count line', () => {
    const entries = Array.from({ length: 17 }, (_, index) => ({
      alias: index + 1,
      reviewRunId: `run-${String(index + 1)}-0123456789`,
      requestState: index === 0 ? 'pending' as const : index === 1 ? 'allowed' as const
        : index === 2 ? 'denied' as const : index === 3 ? 'denied_final' as const : null,
      declaredForms: index === 0 ? ['a', 'b', 'c', 'd'] : [],
    }));
    const brief: ContinuationBriefV1 = { ...baseBrief(), blockedCommands: entries };
    const text = render(brief);
    expect(text).toContain(`\n${HEADING}\n`);
    expect(text).toContain('- #1@run-1-01：被拦；请求等答复；注明过的写法：a、b、c，等 4 种写法');
    expect(text).toContain('- #2@run-2-01：被拦；允许一次（未用）');
    expect(text).toContain('- #3@run-3-01：被拦；不允许');
    expect(text).toContain('- #4@run-4-01：被拦；不允许，也别再问');
    expect(text).toContain('- #5@run-5-01：被拦');
    expect(text).toContain('- 另有 1 条被拦的命令；跑之前先用 request_command_rerun 请求。');
    // 17 entries: 16 lines, the 17th is only counted.
    expect(text.split('\n').filter(line => line.startsWith('- #')).length).toBe(16);
    // The section sits after the required review part and before the ending.
    expect(text.indexOf(HEADING)).toBeGreaterThan(text.indexOf(NOT_LISTED));
    expect(text.indexOf(HEADING)).toBeLessThan(text.indexOf('### 继续之前'));
  });

  it('cuts each declared form to 160 UTF-8 bytes and shows at most three', () => {
    const brief: ContinuationBriefV1 = { ...baseBrief(), blockedCommands: [{
      alias: 1, reviewRunId: 'run-1', requestState: null,
      declaredForms: ['字'.repeat(100), 'b', 'c'],
    }] };
    const text = render(brief);
    const line = text.split('\n').find(entry => entry.startsWith('- #1@'))!;
    const forms = line.slice(line.indexOf('注明过的写法：') + '注明过的写法：'.length);
    expect(Buffer.byteLength(forms.split('、')[0]!, 'utf8')).toBeLessThanOrEqual(160);
    expect(forms.split('、').slice(1)).toEqual(['b', 'c']);
    expect(line).toContain('注明过的写法：');
    expect(line).not.toContain('等 3 种写法');
  });

  it('no blocked commands means no section and byte-identical output', () => {
    // A record with no blocked commands never writes the field, so the section
    // is absent and the bytes stay the pre-B3 ones.
    const text = render({ ...baseBrief(), unknownCallReview: review() });
    expect(text).not.toContain(HEADING);
    expect(text).not.toContain(SENTENCE);
    // F-039: the complete old bytes are the literal in
    // `K3-15-blocked-sentence-pure.test.ts`, not a second render of the same record.
  });
});
