import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGuiService} from '../../src/app/service.js';
import type {MemoryReadResult} from '../../src/contracts/memory.js';

const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
it('host maintains a stable profile, isolates projects and requires selected-version copying across reopen',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cm1b-host-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  let app=await createGuiService(dir);cleanup.push(()=>app.close());
  const a={projectId:'acceptance-alpha',workspaceId:'workspace-main'},b={projectId:'acceptance-beta',workspaceId:'workspace-main'};
  const profilePath='/api/real/memory/profile/',projectPath='/api/real/memory/project/';
  const read=async(path:string,scope:Record<string,unknown>={})=>{
    const result=await app.action(path+'view',scope) as MemoryReadResult;
    expect(result.status).toBe('ready');if(result.status!=='ready')throw Error(result.reason);return result.snapshot;
  };
  const empty=await read(profilePath);expect(empty.scope.kind).toBe('profile');
  const save={requestId:'user-reply',expectedRevision:0,edits:[{operation:'remember',entryId:'reply',content:'Reply briefly.'}]};
  expect(await app.action(profilePath+'maintain',save)).toMatchObject({status:'committed',revision:1});
  expect(await app.action(projectPath+'maintain',{...a,requestId:'project',expectedRevision:0,
    edits:[{operation:'remember',entryId:'build',content:'Check the project build before handoff.'}]})).toMatchObject({status:'committed'});
  expect((await read(projectPath,b)).entries).toHaveLength(0);
  await expect(app.action(projectPath+'copy',{...b,requestId:'copy',expectedRevision:0,sourceProjectId:a.projectId,sourceEntryId:'build',sourceRevision:1})).rejects.toThrow('permission');
  expect(await app.action(projectPath+'copy',{...b,requestId:'copy',expectedRevision:0,sourceProjectId:a.projectId,sourceEntryId:'build',sourceRevision:1,allowCopy:true})).toMatchObject({status:'committed'});
  expect((await read(projectPath,b)).entries[0]?.source).toMatchObject({kind:'copy',scope:{kind:'project',projectId:a.projectId},entryId:'build',revision:1});
  expect(await app.action(projectPath+'maintain',{...a,requestId:'source-change',expectedRevision:1,edits:[{operation:'remove',entryId:'build',expectedEntryRevision:1}]})).toMatchObject({status:'committed'});
  expect(await app.action(projectPath+'copy',{...b,requestId:'copy',expectedRevision:0,sourceProjectId:a.projectId,sourceEntryId:'build',sourceRevision:1,allowCopy:true})).toMatchObject({status:'committed',replayed:true});
  expect(await app.action(projectPath+'copy',{...b,requestId:'copy',expectedRevision:0,sourceProjectId:a.projectId,sourceEntryId:'build',sourceRevision:2,allowCopy:true})).toMatchObject({status:'rejected',code:'idempotency_conflict'});
  await expect(app.action(projectPath+'maintain',{...a,requestId:'forge',expectedRevision:1,actor:{kind:'system',id:'model'},edits:[]})).rejects.toThrow('authority');
  const before=await read(profilePath);await app.close();app=await createGuiService(dir);
  expect(await read(profilePath)).toEqual(before);
  expect(await app.action(profilePath+'maintain',save)).toMatchObject({status:'committed',replayed:true,revision:1});
  await app.addProject({projectId:'new-empty-project',workspaceId:'new-workspace'});
  expect(await read(profilePath)).toEqual(before);
  expect((await read(projectPath,{projectId:'new-empty-project',workspaceId:'new-workspace'})).entries).toEqual([]);
},30_000);
