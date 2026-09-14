import fs from 'node:fs';

const targets = [
  {
    path: 'src/data/read-model-index/read-model-index.ts',
    typeEnd: 'export class ReadModelIndexImpl',
    methodEnd: '  // context assembly goal phase projection handler',
    plan: 'this.planSnapshots.get(planGraphKey(row.projectId, row.goalId)) ?? null',
  },
  {
    path: 'src/data/read-model-index/sqlite-read-model-index.ts',
    typeEnd: '/** Row shape we read back for a goal status projection',
    methodEnd: '  // Console query surface + projection hooks',
    plan: 'this.readPlanSnapshot(row.projectId, row.goalId)',
  },
];

for (const target of targets) {
  let source = fs.readFileSync(target.path, 'utf8');
  const importLine = `import { buildTaskVerificationView, type ProjectedEvidence, type VerificationProjection } from './verification-projection.js';\n`;
  if (!source.includes(importLine.trim())) {
    const firstImportEnd = source.indexOf('\n', source.indexOf('import '));
    source = source.slice(0, firstImportEnd + 1) + importLine + source.slice(firstImportEnd + 1);
  }
  const typeStart = source.indexOf('/** Projected evidence entry');
  const typeEnd = source.indexOf(target.typeEnd, typeStart);
  if (typeStart < 0 || typeEnd < 0) throw new Error(`type markers missing: ${target.path}`);
  source = source.slice(0, typeStart) + source.slice(typeEnd);

  const methodStart = source.indexOf('  /** Build the TaskVerificationView');
  const methodEnd = source.indexOf(target.methodEnd, methodStart);
  if (methodStart < 0 || methodEnd < 0) throw new Error(`method markers missing: ${target.path}`);
  const method = `  /** Combine storage-specific reads with the shared verification interpretation. */
  private buildVerificationView(row: VerificationProjection): TaskVerificationView {
    return buildTaskVerificationView({
      row,
      planSnapshot: ${target.plan},
      policyExplanation: this.policyExplanation,
      review: reviewProjectionFacts(this.reviewRecords()),
    });
  }

`;
  source = source.slice(0, methodStart) + method + source.slice(methodEnd);
  fs.writeFileSync(target.path, source);
}

console.log(JSON.stringify(targets.map(({ path }) => path)));
