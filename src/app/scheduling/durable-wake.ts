/** Coalesce scans, never work records. A wake during a scan forces another pass;
 * recreating this object loses no authority because each pass reads durable facts. */
export class DurableWake {
  private readonly entries = new Map<string, { dirty: boolean; work: Promise<void> }>();
  private closing = false;
  request(key: string, scan: () => Promise<void>): Promise<void> {
    if (this.closing) return Promise.resolve();
    const existing = this.entries.get(key);
    if (existing) { existing.dirty = true; return existing.work; }
    const entry = { dirty: true, work: Promise.resolve() };
    this.entries.set(key, entry);
    entry.work = Promise.resolve().then(async () => {
      try {
        while (entry.dirty && !this.closing) { entry.dirty = false; await scan(); }
      } finally { this.entries.delete(key); }
    });
    return entry.work;
  }
  async close(): Promise<void> {
    this.closing = true;
    await Promise.allSettled([...this.entries.values()].map(entry => entry.work));
  }
}
