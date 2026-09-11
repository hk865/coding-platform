import fs from 'node:fs';
import ts from '../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
const file='src/data/source-workspace-reader.ts',original=fs.readFileSync(file,'utf8');
const start=original.indexOf('/** Fresh source snapshots');
if(start<0)throw Error('missing source reader class');
let context=original.slice(start).replace('class SourceWorkspaceReader','class SourceGraphContextCompiler')
 .replace('rootFor:(projectId:string,workspaceId:string)=>string;','source:ArchitectureSourceCapturePort;')
 .replace('    const index=await workspaceProjectIndex(this.deps.rootFor(query.projectId,query.workspaceId));\n','')
 .replace('const source=await captureArchitectureSource(index,{projectId:query.projectId,workspaceId:query.workspaceId,workspaceRevision:query.workspaceRevision},binding.mappings,binding.configPath??undefined);',
 "const source=await this.deps.source.capture({projectId:query.projectId,workspaceId:query.workspaceId,workspaceRevision:query.workspaceRevision,mappings:binding.mappings,...(binding.configPath?{configPath:binding.configPath}:{})});")
 .replace('finally{index.dispose();}','');
const imports=original.slice(0,original.indexOf('export async function workspaceProjectIndex'))
 .split('\n').filter(line=>!line.includes('vendor/')&&!line.includes('ProjectSourceIndex')&&!line.includes('readSourceIdentity')&&!line.includes('captureArchitectureSource')).join('\n')
 +"\nimport type { ArchitectureSourceCapturePort } from '../contracts/architecture-source.js';\n";
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
fs.writeFileSync('src/context/source-graph-context.ts',printer.printFile(ts.createSourceFile('context.ts',imports+context,ts.ScriptTarget.Latest,true)));
const helper=original.slice(original.indexOf('export async function workspaceProjectIndex'),start);
fs.writeFileSync(file,`import { WorkspaceSandbox, DefaultPermissionPolicy } from '../../vendor/coding-agent/dist/public-api.js';
import type { ArchitectureSourceCapturePort } from '../contracts/architecture-source.js';
import { ProjectSourceIndex } from './project-source-index.js';
import { readSourceIdentity } from './source-identity.js';
import { captureArchitectureSource } from './architecture-source.js';
${helper}
export class ProjectArchitectureSourceReader implements ArchitectureSourceCapturePort {
  constructor(private readonly rootFor: (projectId: string, workspaceId: string) => string) {}
  async capture(request: Parameters<ArchitectureSourceCapturePort['capture']>[0]) {
    const index = await workspaceProjectIndex(this.rootFor(request.projectId, request.workspaceId));
    try { return await captureArchitectureSource(index, request, request.mappings, request.configPath); }
    finally { index.dispose(); }
  }
}
`);
