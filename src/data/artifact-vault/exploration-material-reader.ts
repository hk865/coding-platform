import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import type { ExplorationScope, ExplorationPlan, ExplorationReport, ExplorationReview } from '../../contracts/exploration.js';
import type { ExplorationMaterialSourcePort, ExplorationStoredMaterials } from '../../contracts/exploration-materials.js';

const scopeKey = (scope: ExplorationScope) => canonicalJson([scope.projectId, scope.workspaceId, scope.goalId]);
function belongsTo(value: unknown, scope: ExplorationScope): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record['projectId'] === scope.projectId && record['workspaceId'] === scope.workspaceId && record['goalId'] === scope.goalId;
}

/** Reads the original atomic JSON journals directly; has no in-memory writer or module callback. */
export class ExplorationMaterialReader implements ExplorationMaterialSourcePort {
  constructor(private readonly deps: { directory: string }) {}

  async read(scope: ExplorationScope): Promise<ExplorationStoredMaterials> {
    let plan: ExplorationPlan;
    try {
      plan = JSON.parse(await readFile(join(this.deps.directory, 'plan-' + sha256Hex(scopeKey(scope)) + '.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Error('该目标没有已接受的探索计划');
      throw error;
    }
    if (!belongsTo(plan, scope) || plan.status !== 'accepted') throw Error('该目标没有已接受的探索计划');

    const reports: ExplorationReport[] = [];
    const reviews: ExplorationReview[] = [];
    for (const name of (await readdir(this.deps.directory)).sort()) {
      if (!/^(report|review)-[a-f0-9]{64}\.json$/.test(name)) continue;
      const body: unknown = JSON.parse(await readFile(join(this.deps.directory, name), 'utf8'));
      if (!belongsTo(body, scope)) continue;
      if (name.startsWith('report-')) reports.push(body as ExplorationReport);
      else reviews.push(body as ExplorationReview);
    }
    return { plan, reports, reviews };
  }
}
