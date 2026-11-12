/**
 * The pure witness verdict (B06). It reads only stored facts handed in by the
 * owner: no IO, no `RunActivity` read, no re-tally and no `outcomeFor`.
 */
import type { RunActivityFactsV1 } from '../../../contracts/run-activity.js';
import type { WitnessCheckInput, WitnessCheckResult } from '../../../contracts/verification.js';

/**
 * The trivalent effects of one Run: only stored facts, never a new tally.
 * `changed` precedes `unknown` (a confirmed edit and a suspicious edit in the
 * same Run is a FAIL). `changedLines.complete` does not decide `none` (a
 * refused shell clears it to false).
 */
export function effectsOf(facts: RunActivityFactsV1): 'none' | 'changed' | 'unknown' {
    if (facts.status === 'unknown') return 'unknown';
    if (facts.changedFiles.definiteOmitted > 0 || facts.changedFiles.definite.length > 0
        || facts.changedLines.added > 0 || facts.changedLines.deleted > 0) {
        return 'changed';
    }
    if (facts.changedFiles.possible.length > 0 || facts.changedFiles.possibleOmitted > 0
        || facts.changedFiles.possiblyIncomplete || facts.window.turnTerminal !== true
        || facts.window.unresolvedCalls > 0) {
        return 'unknown';
    }
    return 'none';
}

/**
 * The trivalent input plus the owner's paths/source/effects give the outcome.
 * FAIL wins; the cause is `source_not_matched` only for an INCONCLUSIVE verdict
 * on an applicable Run whose source is not matched (a FAIL with a cause is
 * refused by the state machine). An empty `requiredReadPaths` is not a gap and
 * an unmatched source is not a known failure; the function cannot see the path
 * list, so the first fact is structural.
 */
export function runWitnessCheck(input: WitnessCheckInput): WitnessCheckResult {
    const knownFailure = input.report.state === 'absent'
        || (input.reads.state === 'known' && input.reads.paths.length === 0)
        || input.paths.some((verdict) => verdict.state === 'absent')
        || input.effects === 'changed';
    const hasGap = input.run.state !== 'applicable'
        || input.report.state === 'unknown'
        || input.reads.state === 'unknown'
        || input.paths.some((verdict) => verdict.state === 'unknown')
        || input.source !== 'matched'
        || input.effects === 'unknown';
    const outcome = knownFailure ? 'FAIL' : hasGap ? 'INCONCLUSIVE' : 'PASS';
    return {
        outcome,
        incompleteCause: outcome === 'INCONCLUSIVE' && input.run.state === 'applicable' && input.source !== 'matched'
            ? 'source_not_matched' : null,
        missingPaths: input.paths.filter((verdict) => verdict.state === 'absent').map((verdict) => verdict.path),
    };
}
