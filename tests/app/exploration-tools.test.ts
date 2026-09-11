import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import { createExplorationTools } from '../../src/execution/worker-runtime/exploration-tools.js';
const roots:string[]=[];
afterEach(async()=>{for(const r of roots.splice(0)) await rm(r,{recursive:true,force:true});});
async function harness(){
 const root=await mkdtemp(join(tmpdir(),'analysis-tools-')); roots.push(root);
 await mkdir(join(root,'src'));await mkdir(join(root,'.git')); await mkdir(join(root,'dist'));
 await writeFile(join(root,'src/main.ts'),'// function pretend() {}\nimport { readFile } from "node:fs";\nexport function actual(){\n return readFile("a");\n}\n');
 await writeFile(join(root,'dist/useful.txt'),'needle is part of installed output\n');
 await writeFile(join(root,'.git/private'),'needle private\n');
 await symlink('/etc/passwd',join(root,'escape'));
 const ws=await WorkspaceSandbox.create(root,{deniedPrefixes:['.git']});
 const tools=createExplorationTools(ws);
 const run=async(name:string,args:Record<string,unknown>)=>{
  const tool=tools.find(t=>t.name===name)!;
  const result=await tool.handler.execute({schemaVersion:1,callId:'test',name,arguments:args} as never,{signal:new AbortController().signal} as never);
  return result;
 };
 return {root,run,tools};
}
it('enumerates tracked-like and installed files, excludes denied paths and links',async()=>{
 const {run}=await harness();const r=await run('list_files',{});
 expect(r.status).toBe('success');const data=JSON.stringify(r);
 expect(data).toContain('dist/useful.txt');expect(data).toContain('src/main.ts');
 expect(data).not.toContain('private');expect(data).not.toContain('escape');
});
it('literal search returns source line and digest, supports bounded windows',async()=>{
 const {run}=await harness();const r=await run('search',{query:'needle',maxResults:1});
 expect(r.status).toBe('success');expect(JSON.stringify(r)).toContain('dist/useful.txt');
 expect(JSON.stringify(r)).toContain('"line":1');expect(JSON.stringify(r)).not.toContain('needle private');
 expect((await run('search',{query:'needle',paths:['../secret']})).status).toBe('error');
});
it('uses actual TypeScript AST, not comment/text matching, and invalidates changed sources',async()=>{
 const {root,run}=await harness();let r=await run('symbols',{path:'src/main.ts'});
 expect(r.status).toBe('success');const data=JSON.stringify(r);
 expect(data).toContain('typescript-ast');expect(data).toContain('"name":"actual"');
 expect(data).not.toContain('"name":"pretend"');expect(data).toContain('readFile');
 await writeFile(join(root,'src/main.ts'),'export function replacement() {}\n');
 r=await run('symbols',{path:'src/main.ts'});expect(JSON.stringify(r)).toContain('replacement');expect(JSON.stringify(r)).not.toContain('"name":"actual"');
});
it('Python AST parses declarations/imports/calls without executing project source',async()=>{
 const {root,run}=await harness();
 await writeFile(join(root,'script.py'),'from pathlib import Path\ntext = "def pretend(): pass"\ndef actual():\n  Path("MUST_NOT_EXIST").write_text("unsafe")\nactual()\n');
 const r=await run('symbols',{path:'script.py'});expect(r.status).toBe('success');
 expect(JSON.stringify(r)).toContain('python-ast');expect(JSON.stringify(r)).toContain('"name":"actual"');
 expect(JSON.stringify(r)).not.toContain('"name":"pretend"');
 const listed=await run('list_files',{});expect(JSON.stringify(listed)).not.toContain('MUST_NOT_EXIST');
});
it('unsupported syntax is explicitly a text fallback, never a fabricated AST/call graph',async()=>{
 const {root,run}=await harness();await writeFile(join(root,'sample.hpp'),'#include <Eigen/Core>\nclass Pose {};\n');
 const r=await run('symbols',{path:'sample.hpp'});expect(r.status).toBe('success');
 expect(JSON.stringify(r)).toContain('text-fallback');expect(JSON.stringify(r)).toContain('"ast":false');
});
it('rejects escapes and symlink reads; AST parser errors are explicit',async()=>{
 const {root,run}=await harness();
 expect((await run('symbols',{path:'escape'})).status).toBe('error');
 expect((await run('symbols',{path:'/etc/passwd'})).status).toBe('error');
 expect((await run('symbols',{path:'.git/private'})).status).toBe('error');
 await writeFile(join(root,'invalid.ts'),'function (');const r=await run('symbols',{path:'invalid.ts'});
 expect(JSON.stringify(r)).toContain('parse_error');
});

it('search/list/symbols apply the same sensitive-path policy as read',async()=>{
 const {root,run}=await harness();await mkdir(join(root,'nested'));
 await writeFile(join(root,'nested/credentials.json'),'needle SECRET\n');await writeFile(join(root,'nested/.env'),'needle KEY\n');
 expect(JSON.stringify(await run('list_files',{}))).not.toContain('credentials.json');
 expect(JSON.stringify(await run('search',{query:'needle'}))).not.toContain('SECRET');
 expect((await run('search',{query:'needle',paths:['nested/credentials.json']})).status).toBe('error');
 expect((await run('symbols',{path:'nested/.env'})).status).toBe('error');
});
it('scoped inventories start in the requested directory and honor cancellation',async()=>{
 const {root}=await harness();const ws=await WorkspaceSandbox.create(root);
 const result=await ws.listFiles(1,{prefix:'src'});expect(result.paths).toEqual(['src/main.ts']);expect(result.truncated).toBe(false);
 await expect(ws.listFiles(1,{prefix:'../outside'})).rejects.toThrow();
 const controller=new AbortController();controller.abort();await expect(ws.listFiles(20000,{signal:controller.signal})).rejects.toThrow('取消');
});
it('extended tools need explicit read registration; unknown and side-effecting calls remain denied',async()=>{
 const {DefaultPermissionPolicy}=await import('../../vendor/coding-agent/dist/public-api.js');
 const operation={runId:'r',callId:'c',tool:'symbols',effectClass:'read_only' as const,arguments:{},paths:['src/main.ts'],cwd:null,commandPreview:null,capabilities:['workspace_read' as const],workspaceIdentity:'w',workspaceRevision:'v',sandboxProfileVersion:'s'};
 expect(new DefaultPermissionPolicy().evaluate(operation).decision).toBe('deny');
 const policy=new DefaultPermissionPolicy({registeredReadOnlyTools:['symbols']});
 expect(policy.evaluate(operation).decision).toBe('allow');
 expect(policy.evaluate({...operation,tool:'unknown'}).decision).toBe('deny');
 expect(policy.evaluate({...operation,effectClass:'process'}).decision).toBe('deny');
 expect(policy.evaluate({...operation,paths:['nested/credentials.json']}).decision).toBe('deny');
});
