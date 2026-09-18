/** Prove overlap, not admission within an arbitrary per-reader window. The
 * scenario's existing lifecycle deadline bounds queued preparation; cancellation
 * remains a failure rather than being mistaken for the second reader entering. */
export async function waitForReaderOverlap(overlap: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return overlap;
  return new Promise<void>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(Error('Reader overlap cancelled before both providers entered')); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    overlap.then(() => { signal.removeEventListener('abort', abort); if (signal.aborted) abort(); else resolve(); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
