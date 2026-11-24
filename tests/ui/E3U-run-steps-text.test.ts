import { describe, expect, it } from 'vitest';
import {
  RUN_STEPS_NOT_ENTERED_TEXT, RUN_STEPS_NOT_STARTED_TEXT, runStepsSentenceOf, runStepsUnknownText,
} from '../../src/ui/adapters/run-steps.js';

/**
 * E3U 1A row ④ (ui-batches 156): `not_started`, `not_entered` and `unknown`
 * each write one Chinese sentence; `unknown` names the reason in Chinese and
 * never prints the code. This is the public projection module's contract
 * (level 2/3), not a Host world.
 *
 * Named mutation for a later builder: make `runStepsUnknownText` return the
 * reason code (e.g. `history_damaged`) instead of its Chinese word; the two
 * `unknown` rows fail on both the word and the code assertion.
 */

/** One non-empty Chinese sentence: Han text and punctuation only, one final 。. */
function expectOneChineseSentence(text: string): void {
  expect(text.length).toBeGreaterThan(0);
  expect(text).toMatch(/\p{Script=Han}/u);
  expect(text).not.toMatch(/[A-Za-z0-9_]/);
  expect(text.match(/。/g)).toHaveLength(1);
  expect(text.endsWith('。')).toBe(true);
}

describe('E3U 1A row ④ the three non-step sentences', () => {
  it('not_started is one sentence with its own literal', () => {
    expect(RUN_STEPS_NOT_STARTED_TEXT).toBe('这一次还没开始。');
    expect(runStepsSentenceOf({ kind: 'not_started' })).toBe(RUN_STEPS_NOT_STARTED_TEXT);
    expectOneChineseSentence(RUN_STEPS_NOT_STARTED_TEXT);
  });

  it('not_entered is one sentence with its own literal', () => {
    expect(RUN_STEPS_NOT_ENTERED_TEXT).toBe('这一次没进入执行。');
    expect(runStepsSentenceOf({ kind: 'not_entered' })).toBe(RUN_STEPS_NOT_ENTERED_TEXT);
    expectOneChineseSentence(RUN_STEPS_NOT_ENTERED_TEXT);
  });

  it.each([
    { reason: 'history_damaged' as const, word: '原始记录损坏' },
    { reason: 'no_history_locator' as const, word: '没有这次执行的位置记录' },
  ])('unknown $reason writes “$word” and never the code', ({ reason, word }) => {
    const text = runStepsUnknownText(reason);
    expect(text).toContain(word);
    expect(text).not.toContain(reason);
    expect(runStepsSentenceOf({ kind: 'unknown', reason, detail: 'ignored' })).toBe(text);
    expectOneChineseSentence(text);
  });
});
