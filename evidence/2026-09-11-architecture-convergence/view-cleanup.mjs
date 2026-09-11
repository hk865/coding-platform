import { readFileSync, writeFileSync } from 'node:fs';
for (const file of ['src/app/governance.ts', 'src/data/read-model-index/governance-view.ts', 'src/contracts/governance-view.ts']) {
  let source = readFileSync(file, 'utf8');
  source = source.replace(/\/\*\* 与 describeRef 同一口径的短标签（供视图说明文字引用某个 revision）。 \*\/\n(?=function isVersioned)/, '');
  source = source.replace(/\/\*\*[\s\S]*?\*\//g, text => text.includes('该种类**生效引用聚合**的地址') ? '' : text);
  source = source.replace(/  \/\/ -+ \/\/\n  \/\/ 命令构造[^\n]+\n  \/\/ -+ \/\/\n\n(?=  private async kindView)/, '');
  source = source.replace(/\/\*\* 事件扫描上限[^\n]+\n/, '');
  source = source.replace(/\/\/ -+ \/\/\n\/\/ 事实抽取[^\n]+\n\/\/ -+ \/\/\n\n(?=type GovernancePin)/, '');
  const importPattern = /import\s+(type\s+)?\{([^}]+)\}\s+from\s+(['"][^'"]+['"]);/g;
  const body = source.replace(importPattern, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  source = source.replace(importPattern, (full, isType, names, from) => {
    const kept = names.split(',').map(s => s.trim()).filter(Boolean).filter(name => {
      const local = name.replace(/^type\s+/, '').split(/\s+as\s+/).at(-1).trim();
      return new RegExp('\\b' + local + '\\b').test(body);
    });
    if (!kept.length) return '';
    return `import ${isType ?? ''}{\n  ${kept.join(',\n  ')}\n} from ${from};`;
  });
  source = source.replace(/\n{3,}/g, '\n\n');
  writeFileSync(file, source);
}
