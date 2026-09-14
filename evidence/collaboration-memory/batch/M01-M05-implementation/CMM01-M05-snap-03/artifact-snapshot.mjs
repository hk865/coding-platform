import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const files={};function scan(path){for(const e of readdirSync(path,{withFileTypes:true})){const p=path+'/'+e.name;if(e.isDirectory())scan(p);else if(e.isFile())files[p]=createHash('sha256').update(readFileSync(p)).digest('hex');}}
scan('vendor/coding-agent/dist');scan('dist');const sorted=Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));const data={count:Object.keys(files).length,sha256:createHash('sha256').update(JSON.stringify(sorted)).digest('hex'),files:sorted};writeFileSync(process.argv[2],JSON.stringify(data,null,2));console.log({count:data.count,sha256:data.sha256});
