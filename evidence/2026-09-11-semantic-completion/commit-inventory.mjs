import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const files=[...new Set(execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{encoding:'utf8',maxBuffer:20e6}).split('\0').filter(Boolean))];
const rows=files.filter(p=>fs.existsSync(p)&&fs.statSync(p).isFile()).map(p=>({path:p,bytes:fs.statSync(p).size}));
const suspicious=[];
for(const f of rows){if(f.path.startsWith('.pnpm-store/')||f.bytes>5e6)continue; if(!/\.(json|md|txt|ts|js|mjs|yaml|yml|toml|env)$/.test(f.path))continue;
 const body=fs.readFileSync(f.path,'utf8');
 if(/(?:gh[pousr]_[A-Za-z0-9]{30,}|(?<![A-Za-z0-9])sk-(?:proj-)?[A-Za-z0-9_-]{35,}|-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----)/.test(body))suspicious.push(f.path);
}
fs.writeFileSync('evidence/2026-09-11-semantic-completion/commit-inventory.json',JSON.stringify({count:rows.length,totalBytes:rows.reduce((n,r)=>n+r.bytes,0),large:rows.filter(r=>r.bytes>10e6),sensitivePatternPaths:suspicious,localArtifacts:rows.filter(r=>/\.sqlite|\.db$|\.env|pnpm-store|test-results/.test(r.path)).map(r=>r.path)},null,2));
console.log(JSON.stringify({count:rows.length,totalBytes:rows.reduce((n,r)=>n+r.bytes,0),large:rows.filter(r=>r.bytes>10e6),sensitivePatternPaths:suspicious,nonstandardRoot:rows.filter(r=>! /^[\x00-\x7F]*$/.test(r.path.split('/')[0])).map(r=>r.path)}));

