/** 从固定只读资源根安全加载 M5 Skill 资源。 */
import { createHash } from "node:crypto";
import { open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { skillContextSchema, type SkillContext } from "../../core/context/types/context-types.js";
import { SkillProviderError } from "../../core/ports/skill_provider/skill-provider-port.js";
import { SkillRegistry } from "../registry/skill-registry.js";

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(1),
    kind: z.enum(["instruction", "reference"]),
    priority: z.number().int(),
    contentFile: z.literal("content.md"),
  })
  .strict();

export interface FileSkillLoaderOptions {
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
}

export class FileSkillLoader {
  readonly #root: string;
  readonly #maxFileBytes: number;
  readonly #maxTotalBytes: number;

  private constructor(root: string, options: FileSkillLoaderOptions) {
    this.#root = root;
    this.#maxFileBytes = options.maxFileBytes ?? 256 * 1024;
    this.#maxTotalBytes = options.maxTotalBytes ?? 1024 * 1024;
  }

  static async create(
    root: string,
    options: FileSkillLoaderOptions = {},
  ): Promise<FileSkillLoader> {
    const resolved = await realpath(root);
    const info = await stat(resolved);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new SkillProviderError("resource_invalid", "Skill resource root 必须是普通目录");
    }
    return new FileSkillLoader(resolved, options);
  }

  async load(signal: AbortSignal): Promise<SkillRegistry> {
    if (signal.aborted) throw new SkillProviderError("cancelled", "Skill 加载已取消");
    const entries = (await readdir(this.#root, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    );
    const registry = new SkillRegistry();
    let totalBytes = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) {
        throw new SkillProviderError("resource_invalid", `Skill 目录 ${entry.name} 非法`);
      }
      if (signal.aborted) throw new SkillProviderError("cancelled", "Skill 加载已取消");
      const directory = path.join(this.#root, entry.name);
      const manifestPath = path.join(directory, "skill.json");
      const contentPath = path.join(directory, "content.md");
      for (const filePath of [manifestPath, contentPath]) {
        const fileInfo = await stat(filePath);
        if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || fileInfo.size > this.#maxFileBytes) {
          throw new SkillProviderError("resource_invalid", `Skill ${entry.name} 资源非法或过大`);
        }
        totalBytes += fileInfo.size;
      }
      if (totalBytes > this.#maxTotalBytes) {
        throw new SkillProviderError("resource_invalid", "Skill 资源总大小超过上限");
      }
      const manifestHandle = await open(manifestPath, "r");
      const contentHandle = await open(contentPath, "r");
      let manifestText: string;
      let content: string;
      try {
        manifestText = await manifestHandle.readFile({ encoding: "utf8" });
        content = await contentHandle.readFile({ encoding: "utf8" });
      } finally {
        await Promise.all([manifestHandle.close(), contentHandle.close()]);
      }
      const manifest = manifestSchema.parse(JSON.parse(manifestText) as unknown);
      if (manifest.id !== entry.name || content.trim().length === 0) {
        throw new SkillProviderError(
          "resource_invalid",
          `Skill ${entry.name} manifest/content 非法`,
        );
      }
      const digest = createHash("sha256").update(content, "utf8").digest("hex");
      const skill: SkillContext = skillContextSchema.parse({
        schemaVersion: 1,
        id: manifest.id,
        title: manifest.title,
        content,
        kind: manifest.kind,
        priority: manifest.priority,
        source: `skill:${manifest.id}@sha256:${digest}`,
      });
      registry.register(skill);
    }
    return registry.freeze();
  }
}
