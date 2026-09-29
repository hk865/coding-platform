const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Run `operation` with a 1-based attempt counter.
 *
 * maxAttempts includes the first attempt. On success the resolved value is
 * returned as-is. On failure the loop sleeps exactly `delayMs` (constant, no
 * backoff) only between remaining attempts, and the final failure rethrows the
 * original Error object unchanged.
 */
export async function retry(operation, options) {
  const maxAttempts = options && options.maxAttempts != null ? options.maxAttempts : 1;
  const delayMs = options && options.delayMs != null ? options.delayMs : 0;
  const sleep = (options && options.sleep) || defaultSleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      await sleep(delayMs);
    }
  }
}
