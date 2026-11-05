/** A source path the platform accepts: non-empty, at most 4096 UTF-16 units, no backslash, colon
 *  or NUL, and every `/` segment non-empty and not `.` or `..`. */
export function isSafeSourceRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
    !/[\\:\0]/.test(value) && value.split('/').every(segment => !!segment && segment !== '.' && segment !== '..');
}

/** A source path that names one literal file (decision 121-10): the lexical rule above and no `*` or `?`, so a
 *  glob is refused. A trailing `/` is already refused above (an empty segment); `[` and `]` stay legal file-name
 *  characters. It never checks that the file exists: a plan may name a file it will create. */
export function isLiteralSourceFilePath(value: unknown): value is string {
  return isSafeSourceRelativePath(value) && !/[*?]/.test(value);
}
