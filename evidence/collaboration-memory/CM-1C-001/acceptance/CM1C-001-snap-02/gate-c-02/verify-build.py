import json,pathlib,hashlib
root=pathlib.Path('/mnt/d/1.project/Software/agent_platform'); pack=root/'evidence/collaboration-memory/CM-1C-001/implementation/CM1C-001-snap-02'
origin=json.loads((pack/'build-artifacts.json').read_text('utf-8-sig')); errors=[];fold=hashlib.sha256()
actual_paths={str(p.relative_to(root)) for d in ['dist','vendor/coding-agent/dist'] for p in (root/d).rglob('*') if p.is_file()}
if actual_paths!=set(origin['fileHashes']):errors.append('build-file-set mismatch')
for p,h in sorted(origin['fileHashes'].items()):
 actual=hashlib.sha256((root/p).read_bytes()).hexdigest()
 if actual!=h:errors.append(p)
 fold.update((p+'\0'+actual+'\n').encode())
logs={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (pack/'logs').iterdir() if p.is_file()}
results=(pack/'logs/results.txt').read_text().strip()
print(json.dumps({'buildFiles':len(origin['fileHashes']),'buildFingerprint':fold.hexdigest(),'sourceFingerprint':origin['sourceFingerprintSha256'],'results':results,'logHashes':logs,'errors':errors},indent=2))
assert not errors and len(origin['fileHashes'])==origin['fileCount']==666
assert origin['sourceFingerprintSha256']=='cf2c775c1cebdc296a4deefc42d495f2102c2eaea14a2464c7e605d39febcc95'
assert results=='types=0 ui=0 boundaries=0 build=0 tests=0 docs=0'