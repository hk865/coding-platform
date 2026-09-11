import { readFileSync, writeFileSync } from 'node:fs';
const path = 'src/control/architecture-reconciler.ts';
let source = readFileSync(path, 'utf8');
const replace = (before, after) => { if (!source.includes(before)) throw Error('Missing migration anchor: ' + before.slice(0, 80)); source = source.replace(before, after); };
replace("import type { InspectionPort, InspectResultV1, CodeGraphPort }", "import type { InspectionPort, InspectResultV1 }");
for (const line of source.split(/\r?\n/).filter(line => /import.*(WorkspaceReadPort|StateLedger|validateArchitectureInspectionIntent|governanceContentDigest|PlanRevisionSnapshot)/.test(line))) replace(line, '');
replace('architectureSourceIssues, architectureSourceDigest', 'architectureSourceDigest');
replace('INSPECTION_MAX_NODES, INSPECTION_MAX_EDGES, ', '');
replace('export type ArchitectureReconcilerDeps = {ledger:StateLedger;vault:ArtifactPort;control:ControlEngine;workspaceReader:WorkspaceReadPort;codeGraph:CodeGraphPort;now:()=>string;eventId:()=>string};', `import type { ArchitectureContextPort } from '../contracts/architecture-context.js';
export type ArchitectureReconcilerDeps = {
  context: ArchitectureContextPort;
  vault: ArtifactPort;
  control: Pick<ControlEngine, 'recordArchitectureInspection' | 'recordArchitectureFinding' | 'recordArchitectureDecisionBrief'>;
  now: () => string;
};`);
const start = source.indexOf('      const issues=validateArchitectureInspectionIntent(intent);');
const end = source.indexOf('      let snapshotRef:', start);
if (start < 0 || end < 0) throw Error('Missing applicability block');
source = source.slice(0, start) + `      const compiled = await this.deps.context.assemble(intent);
      if (compiled.status !== 'ready') return compiled;
      const { baseline, readerRevision, priorRecordedAt, sources } = compiled.materials;
      const at = priorRecordedAt ?? this.deps.now();
` + source.slice(end);
replace('String(reader.revision)', 'String(readerRevision)');
const sourceStart = source.indexOf('        const base=baseline.content.sourceBinding;');
const sourceEnd = source.indexOf('        const before=await this.graph', sourceStart);
if (sourceStart < 0 || sourceEnd < 0) throw Error('Missing source pair block');
source = source.slice(0, sourceStart) + `        if (!sources) throw new ReconcileFailure('workspace_unavailable', 'inspection source pair unavailable');
        const { baseline: base, current } = sources;
` + source.slice(sourceEnd);
writeFileSync(path, source);
for (const file of ['src/harness/persistent-harness.ts', 'src/harness/in-memory-harness.ts']) {
  let text = readFileSync(file, 'utf8');
  text = "import { ArchitectureContextCompiler } from '../context/architecture-context-compiler.js';\n" + text;
  const before = 'new ArchitectureReconcilerImpl({ ledger, vault, control, workspaceReader, codeGraph, now: d.clock, eventId: d.eventId })';
  if (!text.includes(before)) throw Error('Missing harness construction');
  text = text.replace(before, 'new ArchitectureReconcilerImpl({ context: new ArchitectureContextCompiler({ ledger, workspaceReader }), vault, control, now: d.clock })');
  writeFileSync(file, text);
}
