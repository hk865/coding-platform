/**
 * P6I T7 (p6i-rework-rulings.md item 1 and "写测试方" T7): the stage driver settles a refused preparation only when
 * the preparer marked the refusal lasting, and never judges by the bare code. The marked causes are the proven ones:
 * a template render error or a missing prompt pack (`invalid`) and an input that does not fit (`capacity`). Every
 * bare refusal, whatever its code, waits or backs off as before; that includes a configuration `unsupported` or
 * `forbidden` and a Session read over its limit `capacity`.
 *
 * The builder's two names are assumed in the adapter below; the lead aligns them at stacking (the ruling leaves the
 * shape to the builder). The adapter looks them up at run time, so a name this tree lacks fails the row by name.
 */
import { describe, expect, it } from 'vitest';
import * as rejections from '../../src/contracts/core/rejections.js';
import type { CoreError, CoreRejection } from '../../src/contracts/core/results.js';

/** One exported function of `module`, by name; a missing export fails the row naming it. */
function exported(module: object, name: string): (...args: unknown[]) => unknown {
  const value = (module as Record<string, unknown>)[name];
  if (typeof value !== 'function') throw new Error(`P6I T7: ${name} is not exported`);
  return value as (...args: unknown[]) => unknown;
}

/** Assumed: the stage driver's one test of a refused preparation. */
const isLastingPreparationRefusal = (refusal: CoreRejection): boolean =>
  exported(rejections, 'isLastingRejection')(refusal) as boolean;
/** Assumed: the preparer's mark on a refusal whose cause it proved lasting. */
const lastingRejection = (code: CoreError, reason: string): CoreRejection =>
  exported(rejections, 'lastingRejection')(code, reason) as CoreRejection;

describe('P6I T7: the stage driver settles only a marked refusal', () => {
  it.each([
    'invalid', 'forbidden', 'not_found', 'unsupported', 'capacity', 'revision_conflict', 'idempotency_conflict',
    'busy', 'unavailable', 'incomplete', 'cancelled', 'source_stale', 'cycle', 'dependency_blocked',
  ] as const)('a bare %s refusal is not settled', code => {
    expect(isLastingPreparationRefusal(rejections.rejected(code, `P6I bare ${code}`))).toBe(false);
  });

  it.each([
    ['invalid', 'required slot "body" is empty in template "wait-reply-delivery"'],
    ['invalid', 'the prompt pack p6i-pack could not be resolved: prompt pack p6i-pack is not available'],
    ['capacity', 'the bounded Query manifest is too large'],
  ] as const)('a %s refusal the preparer marked lasting is settled (%s)', (code, reason) => {
    expect(isLastingPreparationRefusal(lastingRejection(code, reason))).toBe(true);
  });
});
