import { it, expect } from 'vitest';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ArtifactOwnerRunRef, ArtifactPutRecord } from '../../src/contracts/artifact.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SqliteArtifactVault } from '../../src/data/artifact-vault/sqlite-artifact-vault.js';
const execute = promisify(execFile);
it('two SQLite processes retain the first reference and owner when the same digest races', async () => {
  const dir=await mkdtemp(join(tmpdir(),'artifact-atomic-'));
  console.log('Retained artifact race evidence:',dir);
  const database=join(dir,'vault.sqlite');
  const seed=new SqliteArtifactVault(database); await seed.close();
  const ownerA: ArtifactOwnerRunRef={aggregateType:'Run',projectId:'project',goalId:'goal-a',runId:'run-a'};
  const ownerB: ArtifactOwnerRunRef={aggregateType:'Run',projectId:'project',goalId:'goal-b',runId:'run-b'};
  const record=(ownerRef: ArtifactOwnerRunRef, revision: string): ArtifactPutRecord=>({contentType:'text/plain',body:'identical body',ownerRef,
    sourceRefs:[{kind:'workspace',refId:'workspace',revision}],requestedAt:'2026-09-15T00:00:00Z'});
  const child=async (name: string,extra: Record<string, unknown>)=>{
    const config=join(dir,name+'.json'); await writeFile(config,JSON.stringify({database,...extra}));
    const out=await execute(process.execPath,[fileURLToPath(new URL('./sqlite-artifact-race-process.mjs', import.meta.url)),config],{timeout:60000,maxBuffer:1024*1024});
    await writeFile(join(dir,name+'.result.json'),out.stdout); return JSON.parse(out.stdout);
  };
  const readyA=join(dir,'ready-a'),readyB=join(dir,'ready-b'),goA=join(dir,'go-a'),goB=join(dir,'go-b');
  const a=child('a',{record:record(ownerA,'first'),ready:readyA,go:goA});
  const b=child('b',{record:record(ownerB,'second'),ready:readyB,go:goB});
  const exists=(p: string)=>access(p).then(()=>true,()=>false);
  const deadline=Date.now()+45000;
  while(!(await exists(readyA))||!(await exists(readyB))){if(Date.now()>=deadline)throw Error('both readers did not reach barrier');await new Promise(r=>setTimeout(r,10));}
  await writeFile(goA,'go'); const first=await a;
  await writeFile(goB,'go'); const second=await b;
  await writeFile(join(dir,'results.json'),JSON.stringify({first,second},null,2));
  expect(first.error,JSON.stringify(first)).toBeUndefined();
  expect(second.error,JSON.stringify(second)).toBeUndefined();
  expect(first.result).toMatchObject({status:'stored',replayed:false,ref:{source:{revision:'first'}}});
  expect(second.result).toEqual({...first.result,replayed:true});
  expect(first.pid).not.toBe(second.pid);
  const reopened=await child('reopen',{ref:first.result.ref,owners:[ownerA,ownerB]});
  expect(new Set([first.pid,second.pid,reopened.pid]).size).toBe(3);
  expect(reopened.result[0]).toMatchObject({status:'ready',record:{body:'identical body',ownerRunRef:ownerA,sourceRefs:[{revision:'first'}]}});
  expect(reopened.result[1]).toMatchObject({status:'rejected',code:'forbidden'});
},120000);