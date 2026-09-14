import {execFileSync} from 'node:child_process';
import {openSync,closeSync,readFileSync,existsSync} from 'node:fs';
const out='evidence/collaboration-memory/CM-1C-001/implementation/CM1C-001-snap-01';
const snap=JSON.parse(readFileSync(out+'/source-snapshot.json'));
const prior=JSON.parse(readFileSync(out+'/adopted-source-snapshot.json'));
const path=out+'/baseline-to-delivery.patch';if(existsSync(path))throw Error('Patch already exists');
const fd=openSync(path,'wx');try{execFileSync('git',['diff','--binary','--no-ext-diff',prior.head,'--',...Object.keys(snap.fileHashes)],{stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}
console.log('Frozen files/documents already copied and verified; supplemental tracked-source Git patch completed. delivery-files.json is the exact B snapshot delta, including untracked additions.');
