/**
 * 照原样给模型看的一段文字（命令原文、进程输出、人的原话）：放进 Markdown 代码块，不做 JSON 转义，不缩进文字行，
 * 免得模型照抄时多一层或少一层反斜杠。
 */

/** 照原样放一段文字：围栏的反引号比文字里最长的一串多一个，至少三个；文字行不加缩进。 */
export function verbatimLines(text: string, indent: string): string[] {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(match => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return [`${indent}${fence}`, text.replace(/\r?\n$/, ''), `${indent}${fence}`];
}
