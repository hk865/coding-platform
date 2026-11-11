/**
 * P2-answer (slice 9 G1; rulings §4.2 P2, TS §3.2 "答案与 strict 解析"; book 1244; SPEC §3.3, S9-19):
 * `parseExecReviewAnswer` takes the whole text as exactly one JSON object with exactly the five keys
 * `schemaVersion`/`kind`/`verdict`/`basis`/`report`; `schemaVersion` 1, `kind` `exec_review`, `verdict` `pass` or
 * `fix`, a non-empty `basis` of at most 4096 UTF-8 bytes, a non-empty `report`, the whole text at most 16 KiB (16384
 * bytes); anything else is `invalid`. `execReviewAnswerText` is the one writer.
 *
 * World `W-pure` (rule sheet A5). The texts are written here, not by the writer; sizes are counted in UTF-8 bytes,
 * the fillers use the three-byte `中` so a character count and a byte count differ, and the whole-text cases carry a
 * report under 16384 bytes on its own, so a cap on `report` alone does not reject 16385.
 *
 * Named mutations: drop the `hasOnlyKeys` check (the unknown-member case `findings` is accepted, red); count only
 * `report` against the 16 KiB cap (the 16385-byte whole text is accepted, red).
 */
import { describe, expect, it } from 'vitest';
import { execReviewAnswerText, parseExecReviewAnswer } from '../../src/contracts/exec-review.js';

const bytes = (text: string): number => new TextEncoder().encode(text).length;
/** A string of exactly `size` UTF-8 bytes. */
const filler = (size: number): string => '中'.repeat(Math.floor(size / 3)) + 'x'.repeat(size % 3);
const answer = (fields: Record<string, unknown> = {}): string => JSON.stringify({
  schemaVersion: 1, kind: 'exec_review', verdict: 'pass', basis: 'b', report: 'r', ...fields });
/** A pass answer whose whole text is exactly `size` bytes; only `report` grows. */
const wholeOf = (size: number): string => {
  const text = answer({ report: filler(size - bytes(answer({ report: '' }))) });
  if (bytes(text) !== size) throw new Error(`P2: the whole text is ${bytes(text)} bytes, not ${size}`);
  return text;
};
const basisOf = (size: number): string => {
  const basis = filler(size);
  if (bytes(basis) !== size) throw new Error(`P2: the basis is ${bytes(basis)} bytes, not ${size}`);
  return basis;
};

describe('P2-answer: the strict exec review answer', () => {
  it('writes the five keys in this order and nothing else', () => {
    expect(execReviewAnswerText({ verdict: 'pass', basis: 'b', report: 'r' }))
      .toBe('{"schemaVersion":1,"kind":"exec_review","verdict":"pass","basis":"b","report":"r"}');
  });

  it.each([
    ['pass', answer(), { verdict: 'pass', basis: 'b', report: 'r' }],
    ['fix', answer({ verdict: 'fix' }), { verdict: 'fix', basis: 'b', report: 'r' }],
    ['a 4096-byte basis', answer({ basis: basisOf(4096) }), { verdict: 'pass', basis: basisOf(4096), report: 'r' }],
    ['a 16384-byte whole text', wholeOf(16384),
      { verdict: 'pass', basis: 'b', report: (JSON.parse(wholeOf(16384)) as { report: string }).report }],
  ])('parses %s', (_case, text, form) => {
    expect(parseExecReviewAnswer(text)).toEqual({ status: 'parsed', ...form });
  });

  it.each([
    { verdict: 'pass' as const, basis: 'b', report: 'r' },
    { verdict: 'fix' as const, basis: 'b', report: 'r' },
  ])('reads back what the writer wrote ($verdict)', (form) => {
    expect(parseExecReviewAnswer(execReviewAnswerText(form))).toEqual({ status: 'parsed', ...form });
  });

  it.each([
    ['an unknown member', answer({ findings: [] })],
    ['the plan review kind', answer({ kind: 'plan_review' })],
    ['an empty basis', answer({ basis: '' })],
    ['an empty report', answer({ report: '' })],
    ['a 4097-byte basis', answer({ basis: basisOf(4097) })],
    ['a 16385-byte whole text', wholeOf(16385)],
    ['text before the object', `Verdict: ${answer()}`],
    ['text after the object', `${answer()}\nThat is all.`],
    ['a code fence', `\`\`\`json\n${answer()}\n\`\`\``],
  ])('rejects %s as invalid', (_case, text) => {
    expect(parseExecReviewAnswer(text)).toMatchObject({ status: 'rejected', code: 'invalid' });
  });
});
