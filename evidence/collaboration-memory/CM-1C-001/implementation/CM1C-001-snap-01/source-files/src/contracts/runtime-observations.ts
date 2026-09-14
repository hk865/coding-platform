/** Read-only Data view of already persisted public execution observations.
 * Reading never calls a live runtime or exposes its mutable working records. */
export interface RuntimeObservationSource<T> {
  all(): T[];
  /** Disk identity conflicts are diagnostics, never silent last-file-wins. */
  integrityIssues?(): string[];
}
