import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const path = 'src/app/governance.ts';
const original = readFileSync(path, 'utf8');
const baseline = JSON.parse(readFileSync('evidence/2026-09-11-architecture-convergence/baseline.json', 'utf8'));
const expected = baseline.roots.product.files.find(f => f.path === path).sha256;
if (createHash('sha256').update(original).digest('hex') !== expected) throw Error('Governance changed since baseline; stop and coordinate');
const source = original.replaceAll('\r\n', '\n');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const fn = (name, next) => section(`function ${name}(`, `function ${next}(`);
const types = section('export type GovernanceKindV1', 'export type GovernanceEntryDeps');
const typeNames = [...types.matchAll(/export type (\w+)/g)].map(m => m[1]);
const contractImports = `import type { ActorRef } from './command-event.js';
import type { AggregateRef } from './ledger.js';
import type { CompletionPolicyRevisionRef, ArchitectureBaselineRevisionRef } from './governance.js';
import type { CoordinationPolicyRevisionRef } from './human-role-collaboration.js';
import type { ArchitectureEvolutionPolicyRevisionRef } from './architecture-evolution-policy.js';
import { projectRoleSpecActiveRefFor, type RoleSpecPinV1, type RoleSpecRevisionRef, type RoleSpecRevisionSnapshot } from './role-spec.js';
import { canonicalJson, type JsonValue } from './fingerprint.js';
`;
const readiness = `export type RoleSpecPinReadinessV1 = {
  status: 'ready' | 'spec_not_installed' | 'spec_not_activated' | 'stale';
  roleId: string;
  message: string;
};
export interface GovernanceRolePolicyExplanationPort {
  roleSpecPinReadiness(facts: { roleId: string; pin: RoleSpecPinV1; pinnedSpec: RoleSpecRevisionSnapshot | null; activeRevision: RoleSpecRevisionRef | null }): RoleSpecPinReadinessV1;
}
export interface GovernanceViewPort {
  view(scope: GovernanceScopeV1): Promise<GovernanceViewV1>;
}
`;
const shared = fn('activeRefFor', 'activeRevisionOf') + fn('activeRevisionOf', 'parseKind') + fn('sameRef', 'mergeInstalled');
writeFileSync('src/contracts/governance-view.ts', '// Governance presentation and command-result wire shapes. No state or admission policy.\n' + contractImports + '\n' + readiness + '\n' + types + shared.replaceAll('function ', 'export function '));
const readMethods = section('  async view(', '  private defaultSource(') + section('  private async kindView(', '\n}\n\n// ------------------------------------------------------------------------ //\n// 事实抽取');
const events = section('type GovernanceEventScanV1', 'type GovernancePinV1');
const readHelpers = fn('mergeInstalled', 'describeRef') + fn('describeRef', 'short') + fn('isRecord', 'isVersionedGovernanceFixture');
const readerImports = `import type { ActorRef, CommitCursor } from '../../contracts/command-event.js';
import type { EventPage, StateLedger } from '../../contracts/ledger.js';
import type { DomainEvent } from '../../contracts/events.js';
import type { ProjectCompletionPolicyActiveSnapshot, ProjectArchitectureBaselineActiveSnapshot } from '../../contracts/governance.js';
import { P15_COORDINATION_BUDGET_MAX, type CoordinationRoleMatrixV1, type ProjectCoordinationPolicyActiveSnapshot, type CoordinationPolicyRevisionSnapshot } from '../../contracts/human-role-collaboration.js';
import type { ProjectArchitectureEvolutionPolicyActiveSnapshot } from '../../contracts/architecture-evolution-policy.js';
import { ROLE_SPEC_REVISION, projectRoleSpecActiveRefFor, roleSpecRevisionRefFor, roleSpecContentDigest, type RoleSpecContentV1, type RoleSpecPinV1, type RoleSpecRevisionRef, type RoleSpecRevisionSnapshot, type ProjectRoleSpecActiveSnapshot } from '../../contracts/role-spec.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import { GOVERNANCE_KINDS, activeRefFor, activeRevisionOf, sameRef, type GovernanceViewPort, type GovernanceRolePolicyExplanationPort, type RoleSpecPinReadinessV1, ${typeNames.map(n => 'type ' + n).join(', ')} } from '../../contracts/governance-view.js';
export type GovernanceReadModelDeps = {
  ledger: () => Pick<StateLedger, 'load' | 'events'>;
  defaults: { RoleSpecs?: readonly { roleId: string; content: RoleSpecContentV1 }[] };
  entryRoles: readonly { roleId: string; purpose: string }[];
  policyExplanation: GovernanceRolePolicyExplanationPort;
};
const MAX_SCAN_PAGES = 20;
const SCAN_PAGE_SIZE = 1000;
`;
writeFileSync('src/data/read-model-index/governance-view.ts', '// Reads committed governance facts on demand. No stored authority, writes or admission decisions.\n' + readerImports + '\nexport class GovernanceReadModel implements GovernanceViewPort {\n  constructor(private readonly deps: GovernanceReadModelDeps) {}\n' + readMethods.replaceAll('evaluateRoleSpecPinReadiness(', 'this.deps.policyExplanation.roleSpecPinReadiness(') + '\n}\n\n' + events + readHelpers);
let app = source;
app = app.replace(section('  async view(', '  private defaultSource('), '  view(scope: GovernanceScopeV1): Promise<GovernanceViewV1> {\n    return this.deps.views.view(scope);\n  }\n\n');
app = app.replace(section('  private async kindView(', '\n}\n\n// ------------------------------------------------------------------------ //\n// 事实抽取'), '');
app = app.replace(events, '');
app = app.replace(types, `import { GOVERNANCE_KINDS, activeRefFor, activeRevisionOf, sameRef, type GovernanceViewPort, ${typeNames.map(n => 'type ' + n).join(', ')} } from '../contracts/governance-view.js';\n// Existing importers retain the same wire types during this responsibility move.\nexport type { ${typeNames.join(', ')} } from '../contracts/governance-view.js';\n\n`);
app = app.replace("export type GovernanceEntryDeps = {", "export type GovernanceEntryDeps = {\n  views: GovernanceViewPort;");
for (const text of [shared, fn('mergeInstalled', 'describeRef'), fn('describeRef', 'short'), fn('refLabelOf', 'isVersionedGovernanceFixture')]) {
  if (text === shared) for (const chunk of [fn('activeRefFor', 'activeRevisionOf'), fn('activeRevisionOf', 'parseKind'), fn('sameRef', 'mergeInstalled')]) app = app.replace(chunk, '');
  else app = app.replace(text, '');
}
app = app.replace(/import \{ evaluateRoleSpecPinReadiness, type RoleSpecPinReadinessV1 \} from [^\n]+\n/, '');
app = app.replace('const MAX_SCAN_PAGES = 20;\nconst SCAN_PAGE_SIZE = 1000;\n', '');
app = app.slice(app.indexOf('import type { ActorRef'));
app = '// Human governance commands and HTTP receipts; queries delegate to GovernanceViewPort.\n' + app;
writeFileSync(path, app);
for (const p of ['src/ui/src/features/governance.tsx', ...['governance','role-spec-governance','role-material-run','rework-dispatch','plan-changes'].map(n => `tests/app/${n}.test.ts`)]) {
  const body = readFileSync(p, 'utf8');
  writeFileSync(p, body.replaceAll("app/governance.js'", "contracts/governance-view.js'"));
}
console.log('Governance contract/read-model extraction completed; app source matched baseline.');
