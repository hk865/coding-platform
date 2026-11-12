/**
 * KLS-2c-1 crash child (`crashAt` in `KLS2C-knowledge-host.ts`; K17–K20b). Like `K3-07-host-child.mjs` it runs the
 * built Host (`dist/`), so `npm run build` comes first. `KLS2C_CONFIG` names a JSON file with the project store
 * directory, the actor, the public directory, the idle threshold and the workspaces; `KLS2C_HOLD` is the named
 * boundary (`committed` | `applied`) where the Host's `knowledgeWriteHold` prints `held:<point>` and never lets go.
 * Every other boundary passes. Once the Host listens, the first stdout line is `{"ready":true,"url":...}`.
 */
import { readFile } from 'node:fs/promises';
import { createLocalWorkbenchHost } from '../../dist/app/host.js';

const configPath = process.env.KLS2C_CONFIG;
const holdAt = process.env.KLS2C_HOLD;
if (configPath === undefined || (holdAt !== 'committed' && holdAt !== 'applied')) {
  process.stderr.write('KLS2C_CONFIG and KLS2C_HOLD (committed | applied) are required\n');
  process.exit(2);
}

try {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const host = await createLocalWorkbenchHost({
    storage: { kind: 'sqlite', directory: config.database },
    actor: config.actor,
    publicDir: config.publicDir,
    workspaces: config.workspaces,
    linkBatchIdleMs: config.idleMs,
    knowledgeWriteHold: point => {
      if (point !== holdAt) return Promise.resolve();
      process.stdout.write(`held:${point}\n`);
      return new Promise(() => {});
    },
  });
  const address = await host.listen();
  process.stdout.write(`${JSON.stringify({ ready: true, url: address.url })}\n`);
  await new Promise(() => {});
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
}
