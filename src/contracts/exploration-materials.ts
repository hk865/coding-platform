import type { ExplorationScope, ExplorationPlan, ExplorationReport, ExplorationReview } from './exploration.js';

/** Persisted observations only. Reading this repository never makes a report applicable or grants access. */
export type ExplorationStoredMaterials = {
  plan: ExplorationPlan;
  reports: ExplorationReport[];
  reviews: ExplorationReview[];
};

export interface ExplorationMaterialSourcePort {
  read(scope: ExplorationScope): Promise<ExplorationStoredMaterials>;
}
