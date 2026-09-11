type Scope = { projectId: string; workspaceId: string };
type Preview = { kind?: string; path?: string; sha256?: string };
/** Reuse the Explorer boundary so references cannot bypass scope, symlink or private-path checks. */
export async function resolveFileReferences(scope: Scope, raw: unknown, read: (input: Record<string,string>) => Promise<unknown>): Promise<string> {
  if (raw === undefined) return '';
  if (!Array.isArray(raw) || raw.length > 8) throw Error('最多引用 8 个文件');
  const references: string[] = [], seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('文件引用格式错误');
    const value = item as Record<string,unknown>;
    if (typeof value['path'] !== 'string' || !value['path'] || value['path'].length > 4096 || /[\r\n\0]/.test(value['path']) || typeof value['sha256'] !== 'string' || !/^[a-f0-9]{64}$/.test(value['sha256'])) throw Error('文件引用缺少有效路径或版本摘要');
    const preview = await read({...scope,path:value['path']}) as Preview;
    if (preview.kind !== 'text' || !preview.path || preview.sha256 !== value['sha256']) throw Error('引用文件已变化或无法读取，请重新打开并添加：'+value['path']);
    if (seen.has(preview.path)) continue;
    seen.add(preview.path);
    references.push(`- ${JSON.stringify(preview.path)} (SHA-256: ${preview.sha256})`);
  }
  return references.length ? '\n\n用户选择的项目文件引用（路径与提交时版本；内容尚未载入，请按任务需要使用文件读取工具）：\n'+references.join('\n') : '';
}
