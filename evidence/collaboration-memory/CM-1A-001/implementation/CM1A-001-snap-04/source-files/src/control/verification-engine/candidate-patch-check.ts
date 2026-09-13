import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Checks that the submitted patch describes the already-applied candidate; does not modify the workspace. */
export interface CandidatePatchCheckPort {
  check(material: { root: string; patchFile: string }): Promise<void>;
}

const execute = promisify(execFile);

/** Actual validation belongs to Verification; Context supplies the registered workspace root. */
export class GitCandidatePatchCheck implements CandidatePatchCheckPort {
  async check(material: { root: string; patchFile: string }): Promise<void> {
    try {
      await execute('git', ['apply', '--reverse', '--check', '--', material.patchFile], {
        cwd: material.root,
        maxBuffer: 4096,
      });
    } catch {
      throw Error('候选补丁与当前工作区不匹配（反向检查失败）');
    }
  }
}
