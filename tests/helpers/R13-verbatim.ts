/**
 * R13 的共用字面量（冻结稿第五节 S4、四·3）和一处读法：命令里有反斜杠，才看得出“照原样”和“被 JSON 转义了一层”的区别。
 * 不碰 store、Host、平台；纯测试和场景都可以用。
 */

/** 命令原文是 printf '%s\n' 'r13 missing \\s export' >&2; exit 5（`\\` 是两个反斜杠字符）。 */
export const R13_COMMAND = "printf '%s\\n' 'r13 missing \\\\s export' >&2; exit 5";
/** bash 在单引号里不动 `\\`：stderr 原文是 r13 missing \\s export 加换行（两个反斜杠，退出码 5）。 */
export const R13_STDERR = 'r13 missing \\\\s export\n';

/** 四·3 执行者那句：返工输入的检查段末尾，至少一条检查读到了输出时出现。 */
export const R13_HINT = '- 上面的检查输出和你读到的文件对不上时，可能是检查本身写错了：给这个目标的参谋（没有参谋就是秘书）'
  + '发 action_request（needsReply 为真），附检查名和这段输出；不要只复跑一份副本就当它通过。';

/**
 * 以 `label` 结尾的第一行之后，紧跟一行围栏（行首可以有空格，至少三个反引号），读到同一行围栏为止，中间的原文照样返回。
 * 标签后面不是围栏、或围栏没有收尾，就是 null。
 */
export function fencedAfter(text: string, label: string): string | null {
  const lines = text.split('\n');
  const at = lines.findIndex(line => line.endsWith(label));
  const fence = at < 0 ? undefined : lines[at + 1];
  if (fence === undefined || !/^ *`{3,}$/.test(fence)) return null;
  const end = lines.indexOf(fence, at + 2);
  return end < 0 ? null : lines.slice(at + 2, end).join('\n');
}
