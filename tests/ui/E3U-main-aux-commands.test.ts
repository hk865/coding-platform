import { afterEach, describe, expect, it } from 'vitest';
import { findAllClass } from './helpers/boot-page.js';
import { auxPanel, countRoute, onMain, pickTab, textOf } from './helpers/E3N-page.js';
import { openW1 } from './helpers/E3N-world.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3U T-B15 (test sheet e3main-b-tests §1.3; wiring S33–S35, ruling B-07 (b)):
 * no backend gives the prototype's fixed command list, so 命令 shows the empty
 * state 还没接通, none of the prototype's commands, and the three command
 * routes stay unread.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

/** The prototype's fixed commands (Main.dc.html `axRepo`): names, command lines and one output line. */
const SAMPLES = ['类型检查', 'npm run typecheck', '状态机单元测试', '全部测试', '边界检查', 'npm run build', '0 个错误'];

describe('E3U Main right panel: 命令', () => {
  it('T-B15 命令 shows 还没接通 and reads no command route', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    await onMain(opened.world, async (page, log) => {
      await pickTab(page, log, '命令');
      const panel = auxPanel(page.root)!;
      expect(textOf(panel)).toContain('还没接通');
      expect(findAllClass(panel, 'cmd')).toHaveLength(0);
      expect(findAllClass(panel, 'cmd-out')).toHaveLength(0);
      for (const sample of SAMPLES) expect(textOf(panel)).not.toContain(sample);
      /* 具名改坏: `src/ui/boot.ts` 的 `readAuxPanel` 在命令页调 `commands/read`；这一句红。 */
      expect(countRoute(log, 'commands/read')).toBe(0);
      expect(countRoute(log, 'commands/start')).toBe(0);
      expect(countRoute(log, 'commands/stop')).toBe(0);
    });
  }, 60_000);
});
