/**
 * An optional upper bound on a test's wait for a held point (lead, 2026-10-30). `TEST_HOLD_LIMIT_MS` is set only for
 * one-row runs while a row goes RED, GREEN and through its named mutation, and for the launcher's run of a group's
 * tests on the base source. There a hold that never fires would otherwise wait for the test's own limit (120-600 s);
 * with the variable it fails after that many milliseconds, naming the hold. Unset (the full suite, the scale batch)
 * the promise is returned unchanged.
 */
export function limitHold<T>(reached: Promise<T>, label: string): Promise<T> {
  const limit = Number(process.env['TEST_HOLD_LIMIT_MS']);
  if (!Number.isFinite(limit) || limit <= 0) return reached;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} was not reached within ${limit} ms (TEST_HOLD_LIMIT_MS)`)), limit);
    timer.unref?.();
  });
  void reached.then(() => clearTimeout(timer), () => clearTimeout(timer));
  const bounded = Promise.race([reached, late]);
  // A hold the test never awaits must not become an unhandled rejection; an awaited one still throws.
  bounded.catch(() => undefined);
  return bounded;
}
