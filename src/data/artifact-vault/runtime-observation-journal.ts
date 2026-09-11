import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomicFile } from '../../storage/atomic-file.js';
import type { RuntimeObservationSource } from '../../contracts/runtime-observations.js';

export type RuntimeObservationJournalOptions<T> = {
  keyFor(record: T): string;
  serialize(record: T): string;
  /** Coding runs previously serialized per run; query runs used one queue. */
  writeOrder: 'per_record' | 'global';
  compare?: (first: T, second: T) => number;
};

/** ArtifactVault storage for public runtime observations. The cache contains
 * only file contents loaded from disk or successfully atomically replaced.
 * Generic serialization preserves each producer's existing wire bytes without
 * importing its runtime implementation, controller, or mutable record type. */
export class RuntimeObservationJournal<T> {
  private readonly committed = new Map<string, T>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly loadIssues = new Map<string, string>();
  private readonly ambiguous: T[] = [];
  readonly observations: RuntimeObservationSource<T>;

  constructor(private readonly directory: string, private readonly options: RuntimeObservationJournalOptions<T>) {
    // This object closes over Data storage only; callers never receive Runtime.
    this.observations = Object.freeze({ all: () => this.readCommitted(), integrityIssues: () => [...this.loadIssues.values()] });
  }

  async init(): Promise<T[]> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.committed.clear(); this.loadIssues.clear(); this.ambiguous.length = 0;
    const loaded = new Map<string, T[]>();
    for (const file of await readdir(this.directory)) if (/^[a-f0-9]{64}\.json$/.test(file)) {
      const record = JSON.parse(await readFile(join(this.directory, file), 'utf8')) as T;
      const key = this.options.keyFor(record), rows = loaded.get(key) ?? [];
      rows.push(record); loaded.set(key, rows);
      if (file !== key + '.json') this.loadIssues.set(key, 'Runtime observation filename does not match identity: ' + key);
      if (rows.length > 1) this.loadIssues.set(key, 'Multiple persisted runtime observations share identity: ' + key);
    }
    for (const [key, rows] of loaded) {
      // Preserve every conflicting observation for read-side qualification,
      // but do not return it as an executable/recoverable Runtime record.
      if (this.loadIssues.has(key)) this.ambiguous.push(...rows);
      else this.committed.set(key, rows[0]!);
    }
    // Recovery walks the original directory/insertion order, independent of
    // how the public read view sorts records for consumers.
    return structuredClone([...this.committed.values()]);
  }

  save(record: T): Promise<void> {
    // Capture bytes now, before an active producer can mutate the next version.
    const key = this.options.keyFor(record), body = this.options.serialize(record);
    if (this.loadIssues.has(key)) return Promise.reject(Error(this.loadIssues.get(key)));
    const snapshot = JSON.parse(body) as T;
    const queue = this.options.writeOrder === 'global' ? 'global' : key;
    const work = (this.writes.get(queue) ?? Promise.resolve()).then(async () => {
      await writeAtomicFile(join(this.directory, key + '.json'), body);
      this.committed.set(key, snapshot);
    });
    // A failed write remains visible to its caller, but does not poison the
    // next save: this is the existing runtime queue failure behavior.
    this.writes.set(queue, work.catch(() => {}));
    return work;
  }

  async flush(): Promise<void> { await Promise.all(this.writes.values()); }

  private readCommitted(): T[] {
    const records = [...this.committed.values(), ...this.ambiguous];
    if (this.options.compare) records.sort(this.options.compare);
    return structuredClone(records);
  }
}
