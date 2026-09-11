import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

for (const file of ['src/read-model/read-model-index.ts', 'src/sqlite-read-model/sqlite-read-model-index.ts']) {
  const raw = readFileSync(file, 'utf8');
  let body = raw.replace(/\r\n/g, '\n');
  const change = (from, to, count = 1) => {
    const found = body.split(from).length - 1;
    if (found !== count) throw Error(file + ': expected ' + count + ' matches, got ' + found + ': ' + from.slice(0, 90));
    body = body.split(from).join(to);
  };
  change('import { computeTaskDispositions, planChangeScopeKey }', 'import { planChangeScopeKey }');
  change('import { evidenceApplicability, selectEffectiveEvidenceSet } from "../contracts/evidence.js";', 'import type { EvidenceApplicability } from "../contracts/evidence.js";\nimport type { PolicyExplanationPort } from "../contracts/policy-explanation.js";');
  const filter = `    let effectiveEvidenceIds: string[] = [];
    let blockingEvidenceIds: string[] = [];
    if (planSnapshot !== null && currentAnchor !== null) {
      const effectiveSet = selectEffectiveEvidenceSet(
        sorted.map((pe) => pe.evidence),
        planSnapshot,
        currentAnchor,
      );
      effectiveEvidenceIds = effectiveSet.effectiveEvidenceIds;
      blockingEvidenceIds = Object.values(effectiveSet.blockingByRequirement).flat();
    }`;
  change(`    const evidence: EvidenceBindingView[] = sorted.map((pe) =>
      this.toEvidenceBindingView(pe, planSnapshot, currentAnchor),
    );

` + filter, `    const explanation = this.policyExplanation.explainEvidence({ evidence: sorted.map(pe => pe.evidence), plan: planSnapshot, currentAnchor });
    const evidence: EvidenceBindingView[] = sorted.map((pe, index) =>
      this.toEvidenceBindingView(pe, explanation.bindings[index]!.applicability),
    );
    const { effectiveEvidenceIds, blockingEvidenceIds } = explanation;`);
  change(`    const evidence = sorted.map((pe) => this.p108ToTaskEvidenceEntry(pe, planSnapshot, currentAnchor));
` + filter, `    const explanation = this.policyExplanation.explainEvidence({ evidence: sorted.map(pe => pe.evidence), plan: planSnapshot, currentAnchor });
    const evidence = sorted.map((pe, index) => this.p108ToTaskEvidenceEntry(pe, explanation.bindings[index]!.applicability));
    const { effectiveEvidenceIds, blockingEvidenceIds } = explanation;`);
  change(`    pe: ProjectedEvidence,
    planSnapshot: PlanRevisionSnapshot | null,
    currentAnchor: EffectivityAnchorV1 | null,`, `    pe: ProjectedEvidence,
    applicability: EvidenceApplicability | null,`);
  change(`    const applicability = planSnapshot !== null && currentAnchor !== null
      ? evidenceApplicability(e, planSnapshot, currentAnchor)
      : null;\n`, '');
  change(`    pe: { evidence: EvidenceV1; admittedAt: string; evidenceIndex: number; sourceCursor: CommitCursor },
    planSnapshot: PlanRevisionSnapshot | null,
    currentAnchor: EffectivityAnchorV1 | null,`, `    pe: { evidence: EvidenceV1; admittedAt: string; evidenceIndex: number; sourceCursor: CommitCursor },
    applicability: EvidenceApplicability | null,`);
  change(`    const applicability =
      planSnapshot !== null && currentAnchor !== null ? evidenceApplicability(e, planSnapshot, currentAnchor) : null;\n`, '');
  change('return computeTaskDispositions(source, target, []);', 'return this.policyExplanation.explainPlanChange({ source, target, pausedTaskIds: [] });');
  body = body.replace('time by the PURE evidenceApplicability function against the projected', 'time through Control\'s read-only policy explanation against the projected')
    .replace('parts use the pure functions; they never write back to history', 'parts use Control\'s explanation port; they never write back to history')
    .replace('derived by the pure function; null when no authoritative current anchor', 'provided by Control; null when no authoritative current anchor');
  if (file.startsWith('src/read-model/')) {
    change('export class ReadModelIndexImpl implements ReadModelIndex {', 'export class ReadModelIndexImpl implements ReadModelIndex {\n  constructor(private readonly policyExplanation: PolicyExplanationPort) {}');
    change('/** Factory matching the fixed lane-C entry point (no args yet). */', '/** Composition requires Control\'s stateless display-policy capability. */');
    change('export function createReadModelIndex(): ReadModelIndex {\n  return new ReadModelIndexImpl();', 'export function createReadModelIndex(policyExplanation: PolicyExplanationPort): ReadModelIndex {\n  return new ReadModelIndexImpl(policyExplanation);');
  } else {
    change('export interface SqliteReadModelIndexOptions {', 'export interface SqliteReadModelIndexOptions {\n  policyExplanation: PolicyExplanationPort;');
    change('  constructor(options: SqliteReadModelIndexOptions) {', '  private readonly policyExplanation: PolicyExplanationPort;\n\n  constructor(options: SqliteReadModelIndexOptions) {\n    this.policyExplanation = options.policyExplanation;');
  }
  writeFileSync(file, raw.includes('\r\n') ? body.replace(/\n/g, '\r\n') : body);
  console.log(file);
}

const walk = root => readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(root, entry.name)) : [join(root, entry.name)]);
for (const file of walk('tests').filter(file => file.endsWith('.ts'))) {
  const raw = readFileSync(file, 'utf8');
  let body = raw.replace(/\bnew ReadModelIndexImpl\(\)/g, 'new ReadModelIndexImpl(new ControlPolicyExplanation())')
    .replace(/\bcreateReadModelIndex\(\)/g, 'createReadModelIndex(new ControlPolicyExplanation())')
    .replace(/\b(createSqliteReadModelIndex|new SqliteReadModelIndex)\(\{/g, '$1({ policyExplanation: new ControlPolicyExplanation(),');
  if (body === raw) continue;
  const path = relative(dirname(file), 'src/control/policy-explanation.js').replace(/\\/g, '/');
  body = `import { ControlPolicyExplanation } from '${path}';` + (raw.includes('\r\n') ? '\r\n' : '\n') + body;
  writeFileSync(file, body);
  console.log(file);
}
