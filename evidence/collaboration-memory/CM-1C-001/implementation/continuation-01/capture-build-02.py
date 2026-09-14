from pathlib import Path
import hashlib,json
r=Path('/mnt/d/1.project/Software/agent_platform');o=r/'evidence/collaboration-memory/CM-1C-001/implementation/CM1C-001-snap-02'
s=json.loads((o/'source-snapshot.json').read_text());files={}
for tree in ['dist','vendor/coding-agent/dist']:
 for p in sorted((r/tree).rglob('*')):
  if p.is_file():files[str(p.relative_to(r))]=hashlib.sha256(p.read_bytes()).hexdigest()
(o/'build-artifacts.json').write_text(json.dumps(dict(sourceFingerprintSha256=s['sourceFingerprintSha256'],fileCount=len(files),fileHashes=files),indent=2)+'\n')
print('build files:',len(files))
