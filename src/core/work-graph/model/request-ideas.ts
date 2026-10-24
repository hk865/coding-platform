/**
 * The one rule of an answer's ideas (slice-6 spec L7): no idea, or 2 to 3 of
 * them; each title one non-empty line of at most `IDEA_TITLE_MAX_CODEPOINTS`
 * code points, each detail at most `IDEA_DETAIL_MAX_CODEPOINTS` code points.
 * The secretary answer check, the stored answer's codec and the idea selection
 * all read it here, so the three never disagree. Pure.
 */
import { codePoints, isRecord } from '../../../contracts/validation/common.js';
import { IDEA_DETAIL_MAX_CODEPOINTS, IDEA_TITLE_MAX_CODEPOINTS } from './request-contracts.js';

/** One idea is no choice, and more than three is not a short list. */
export function validIdeaCount(count: number): boolean {
  return count === 0 || count === 2 || count === 3;
}

/** The problems of an `ideas` value named `path`; empty when the value keeps the rule. */
export function ideasIssues(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return [`${path} must be an array`];
  const issues: string[] = [];
  if (!validIdeaCount(value.length)) {
    issues.push(`${path} must hold 0, 2 or 3 ideas`);
  }
  value.forEach((idea, index) => {
    if (!isRecord(idea) || typeof idea['title'] !== 'string' || typeof idea['detail'] !== 'string') {
      issues.push(`${path}[${index}] must carry string title and detail`);
      return;
    }
    const title = idea['title'];
    if (title.length === 0 || title.includes('\n') || title.includes('\r')) {
      issues.push(`${path}[${index}].title must be one non-empty line`);
    } else if (codePoints(title) > IDEA_TITLE_MAX_CODEPOINTS) {
      issues.push(`${path}[${index}].title exceeds ${IDEA_TITLE_MAX_CODEPOINTS} code points`);
    }
    // The bounds count code points, not UTF-16 units.
    if (codePoints(idea['detail']) > IDEA_DETAIL_MAX_CODEPOINTS) {
      issues.push(`${path}[${index}].detail exceeds ${IDEA_DETAIL_MAX_CODEPOINTS} code points`);
    }
  });
  return issues;
}
