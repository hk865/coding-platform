/**
 * The trivalent verdict of each required read path (B06). It never resolves,
 * normalizes, case-folds or stats a path: the read set is already exactly the
 * paths the Runtime proved, so the comparison is a literal `Set.has`.
 */
import { isLiteralSourceFilePath } from '../../workspace/path-validation.js';
import type { WitnessPathVerdict, WitnessReadSet } from '../../../contracts/verification.js';

/**
 * One verdict per required path, in first-seen order. A path that is not one
 * literal source file (unsafe, or a glob) or an unknown read set is `unknown`
 * (the platform cannot judge it, never `absent`/FAIL); otherwise the path is
 * `present`/`absent` on the successful read set. Duplicates keep their first position.
 */
export function pathVerdictsOf(required: readonly string[], reads: WitnessReadSet): WitnessPathVerdict[] {
  const present = reads.state === 'known' ? new Set(reads.paths) : null;
  const verdicts: WitnessPathVerdict[] = [];
  const seen = new Set<string>();
  for (const path of required) {
    if (seen.has(path)) continue;
    seen.add(path);
    if (!isLiteralSourceFilePath(path) || present === null) {
      verdicts.push({ path, state: 'unknown' });
      continue;
    }
    verdicts.push({ path, state: present.has(path) ? 'present' : 'absent' });
  }
  return verdicts;
}
