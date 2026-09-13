import pathlib,json,hashlib
root=pathlib.Path('/mnt/d/1.project/Software/agent_platform'); pack=root/'evidence/collaboration-memory/CM-1B-001/implementation/CM1B-001-snap-01'
origin=json.loads((pack/'build-origin.json').read_text('utf-8-sig')); errors=[]; fold=hashlib.sha256()
actual_paths={str(p.relative_to(root)) for d in ['dist','vendor/coding-agent/dist'] for p in (root/d).rglob('*') if p.is_file()}
if actual_paths!=set(origin['files']):errors.append('build-file-set mismatch')
for p,h in sorted(origin['files'].items()):
 actual=hashlib.sha256((root/p).read_bytes()).hexdigest()
 if actual!=h:errors.append(p)
 fold.update((p+'\0'+actual+'\n').encode())
logs={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (pack/'logs').iterdir() if p.is_file()}
rc=(pack/'logs/full-regression.exit-code').read_text().strip()
print(json.dumps({'buildFiles':len(origin['files']),'buildFingerprint':fold.hexdigest(),'expected':origin['sha256'],'sourceFingerprint':origin['sourceFingerprintSha256'],'fullExit':rc,'logHashes':logs,'errors':errors},indent=2))
assert not errors and len(origin['files'])==origin['fileCount'] and fold.hexdigest()==origin['sha256'] and rc=='0'
assert origin['sourceFingerprintSha256']=='ba2841a9f018b2c3a22cd2d87eb40ae71a06e7eb0ba27e37121b9b24116d1eea'