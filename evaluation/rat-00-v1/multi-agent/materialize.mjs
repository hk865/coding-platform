import { cp, copyFile, lstat, mkdir, readdir } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const [id,rawTarget]=process.argv.slice(2);
if(!/^MA-0[1-8]$/.test(id||'')||!rawTarget)throw new Error('Usage: node materialize.mjs MA-01 /absolute/fresh/workspace');
if(!isAbsolute(rawTarget))throw new Error('Workspace target must be absolute');
const target=resolve(rawTarget);if(target===resolve(root)||target.startsWith(resolve(root)+sep))throw new Error('Target must be outside fixture assets');
try { await lstat(target); throw new Error('Target must not exist'); } catch(e) { if(e.code!=='ENOENT')throw e; }
async function rejectLinks(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isSymbolicLink())throw new Error('Symlinks forbidden in visible inputs');if(entry.isDirectory())await rejectLinks(path);else if(!entry.isFile())throw new Error('Only regular visible files allowed');}}
await rejectLinks(join(root,'base'));
const task=join(root,'public',id,'TASK.md');if(!(await lstat(task)).isFile()||(await lstat(task)).isSymbolicLink())throw new Error('Task must be a regular file');
await mkdir(target,{recursive:true});await cp(join(root,'base'),target,{recursive:true,dereference:false});await copyFile(task,join(target,'TASK.md'));
console.log(JSON.stringify({scenarioId:id,workspace:target,visibleInputs:['base/**','public/'+id+'/TASK.md'],hiddenInputsCopied:false,isolationStatus:'NOT_ESTABLISHED_BY_COPY',realExecution:'NOT_RUN'}));
