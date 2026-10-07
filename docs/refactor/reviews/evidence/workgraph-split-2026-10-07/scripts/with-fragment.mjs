// node with-fragment.mjs <module-target.json> <target.json>
// SCRATCH COPY ONLY: writes target.json's submodules (id, path, dependencies) into the WorkGraph entry of the given
// module-target.json, so `node scripts/check-boundaries.mjs` checks the submodule rules on the moved tree. The real
// module-target.json is not touched by task D (TASK-D-PLAN.md §0).
import { readFileSync, writeFileSync } from 'node:fs';

const [modulePath, targetPath] = process.argv.slice(2);
const modules = JSON.parse(readFileSync(modulePath, 'utf8'));
const target = JSON.parse(readFileSync(targetPath, 'utf8'));
const workGraph = modules.modules.find((m) => m.id === 'WorkGraph');
workGraph.submodules = target.submodules.map((s) => ({ id: s.id, path: s.path, dependencies: s.dependencies }));
writeFileSync(modulePath, JSON.stringify(modules, null, 2) + '\n');
