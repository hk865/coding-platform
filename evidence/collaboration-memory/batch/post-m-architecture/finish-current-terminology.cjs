const fs = require('node:fs');
const path = require('node:path');
const changed = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'vendor', 'fixtures', 'testing', 'dist', 'notices'].includes(entry.name)) continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (/\.(?:ts|tsx|md)$/.test(entry.name)) {
      const before = fs.readFileSync(target, 'utf8');
      let after = before
        .replace(/\bRW-\d+\b/g, '')
        .replace(/CM-1A-001/g, 'coordination runtime')
        .replace(/CM-1B-001/g, 'collaboration routing')
        .replace(/CM-1C-001/g, 'architecture collaboration')
        .replace(/LANE-A\/LANE-B/g, 'combined projection')
        .replace(/lane-A\/lane-B/gi, 'combined projection')
        .replace(/LANE-A/g, 'fact projection').replace(/LANE-B/g, 'detail projection')
        .replace(/lane-A/g, 'fact projection').replace(/lane-B/g, 'detail projection')
        .replace(/\bFrozen\b/g, 'Versioned').replace(/\bFROZEN\b/g, 'VERSIONED');
      if (after !== before) { fs.writeFileSync(target, after); changed.push(target.replaceAll('\\', '/')); }
    }
  }
};
walk('src');
fs.writeFileSync('evidence/collaboration-memory/batch/post-m-architecture/current-terminology-files.json', JSON.stringify({ changed, exclusions: ['fixtures/testing historical identifiers', 'notices provenance', 'vendor'] }, null, 2) + '\n');
console.log(JSON.stringify({ files: changed.length }));
