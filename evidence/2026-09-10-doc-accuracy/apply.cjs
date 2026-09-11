const fs=require('node:fs'); const crypto=require('node:crypto'); const path=require('node:path');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const changes=JSON.parse(fs.readFileSync(path.join(__dirname,'changes.json'),'utf8'));
for(const c of changes) {
 const actual=fs.existsSync(c.target)?sha(fs.readFileSync(c.target)):null;
 if(actual!==c.beforeSha256) throw Error('Concurrent modification: '+c.target);
}
for(const c of changes) fs.writeFileSync(c.target,fs.readFileSync(c.staged));
console.log('Applied '+changes.length+' documentation files; input hashes matched.');
