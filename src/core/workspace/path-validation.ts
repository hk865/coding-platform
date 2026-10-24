/** A source path the platform accepts: non-empty, at most 4096 UTF-16 units, no backslash, colon
 *  or NUL, and every `/` segment non-empty and not `.` or `..`. */
export function isSafeSourceRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
    !/[\\:\0]/.test(value) && value.split('/').every(segment => !!segment && segment !== '.' && segment !== '..');
}
