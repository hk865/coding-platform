/**
 * SHT-1 owner row：shell 工具给模型看的两段文字。
 * 121-112 的规则是命令不按时间停；模型要能从说明里看到这一点，并知道可以自己用
 * `timeout <seconds>` 限时。只读定义，不跑命令。
 */
import { expect, it } from 'vitest';
import { createShellToolDefinition, toolSchema as z } from '../../vendor/coding-agent/dist/public-api.js';
import type { ProcessSandbox } from '../../vendor/coding-agent/dist/public-api.js';

it('SHT-1 shell 说明写明命令不按时间停，并能用 timeout <seconds> 自己限时', () => {
  const definition = createShellToolDefinition({} as ProcessSandbox);
  expect(definition.description).toContain(
    'Commands are not stopped by time; memory and process limits still apply.',
  );
  const schema = z.toJSONSchema(definition.inputSchema) as unknown as {
    properties: { timeoutMs: { description: string } };
  };
  expect(schema.properties.timeoutMs.description).toContain(
    'The platform never stops the command at this time',
  );
  expect(schema.properties.timeoutMs.description).toContain(
    'prefix it with `timeout <seconds>`',
  );
});
