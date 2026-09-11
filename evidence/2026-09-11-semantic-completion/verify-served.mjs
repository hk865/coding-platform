import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const base='http://127.0.0.1:4498';
const checks=[];
for(const route of ['/','/workbench','/legacy','/app.js']) {
  const response=await fetch(base+route);
  if(response.status!==200) throw Error(route+': '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  checks.push({route,status:response.status,digest:createHash('sha256').update(bytes).digest('hex')});
  if(route!=='/workbench') continue;
  const assets=[...bytes.toString().matchAll(/(?:src|href)="(\/workbench\/assets\/[A-Za-z0-9._-]+)"/g)].map(m=>m[1]);
  if(assets.length<2) throw Error('Missing built workbench assets');
  for(const asset of assets) {
    const response=await fetch(base+asset);
    const served=Buffer.from(await response.arrayBuffer());
    const built=await readFile(join(process.cwd(),'dist/app/public',asset));
    if(response.status!==200 || !served.equals(built)) throw Error('Served artifact differs: '+asset);
    checks.push({route:asset,status:response.status,bytes:served.length,digest:createHash('sha256').update(served).digest('hex'),matchesBuiltBytes:true});
  }
}
await writeFile('evidence/2026-09-11-semantic-completion/served-artifacts.json',JSON.stringify({base,checkedAt:new Date().toISOString(),checks},null,2));
console.log('PASS: root, workbench, legacy and each referenced built asset; served bytes match disk.');
