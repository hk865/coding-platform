import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const root='evidence/2026-09-11-source-cleanup/protocol-convergence';
const baseline=JSON.parse(fs.readFileSync(`${root}/baseline.json`,'utf8'));
export function edit(file, transform) {
  const original=fs.readFileSync(file,'utf8'), next=transform(original);
  if(next===original) return;
  const docs=file.startsWith('../agent_learn/agent_dev/agent_platform/');
  const rel=docs?file.slice('../agent_learn/agent_dev/agent_platform/'.length):file;
  const archive=`${root}/history/${docs?'docs/':''}${rel}.txt`;
  if(!fs.existsSync(archive)) {
    const expected=baseline.roots[docs?'docs':'product'].files.find(row=>row.path===rel)?.sha256;
    if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==expected) throw Error(`Concurrent change: ${file}`);
    fs.mkdirSync(path.dirname(archive),{recursive:true});fs.copyFileSync(file,archive,fs.constants.COPYFILE_EXCL);
  }
  if(fs.readFileSync(file,'utf8')!==original)throw Error(`Concurrent write: ${file}`);
  if(next===null)fs.unlinkSync(file);else fs.writeFileSync(file,next);
}
export function replace(body,old,next){if(!body.includes(old))throw Error(`Missing text: ${old.slice(0,100)}`);return body.replace(old,next);}
export function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()&&!['node_modules','public'].includes(e.name)?files(`${dir}/${e.name}`):e.isFile()&&e.name.endsWith('.ts')?[`${dir}/${e.name}`]:[]);}
