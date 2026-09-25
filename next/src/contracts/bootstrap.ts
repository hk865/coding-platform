// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
export type BootstrapManifestRef = {
    aggregateType: "BootstrapManifest";
    /** derived from the canonical source digest; stable across replays */
    manifestId: string;
};
