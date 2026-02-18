import path from "path";
import { MEMORY_DIR, readFile, listDirectories, listFiles, fileExists } from "./filesystem";

export interface WorkEntry {
  id: string;
  path: string;
  title: string;
  description?: string;
  created?: string;
  updated?: string;
  status?: string;
  tags?: string[];
  files: string[];
}

export interface LearningEntry {
  id: string;
  path: string;
  category: string;
  filename: string;
  content: string;
  size: number;
}

export interface StateEntry {
  id: string;
  path: string;
  filename: string;
  content: unknown;
  updated: string;
}

// Parse YAML frontmatter from META.yaml
function parseMetaYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/^([a-zA-Z_-]+):\s*(.+)?$/);
    if (match) {
      const [, key, value] = match;
      if (value) {
        // Handle arrays (simple format)
        if (value.startsWith("[") && value.endsWith("]")) {
          result[key] = value
            .slice(1, -1)
            .split(",")
            .map((v) => v.trim().replace(/['"]/g, ""));
        } else {
          result[key] = value.replace(/['"]/g, "").trim();
        }
      }
    }
  }

  return result;
}

export async function getWorkEntries(): Promise<WorkEntry[]> {
  const workDir = path.join(MEMORY_DIR, "WORK");
  const dirs = await listDirectories(workDir);
  const entries: WorkEntry[] = [];

  for (const dir of dirs) {
    const entryPath = path.join(workDir, dir);
    const metaPath = path.join(entryPath, "META.yaml");

    let meta: Record<string, unknown> = {};
    const metaContent = await readFile(metaPath);
    if (metaContent) {
      meta = parseMetaYaml(metaContent);
    }

    const files = await listFiles(entryPath);

    entries.push({
      id: dir,
      path: entryPath,
      title: (meta.title as string) || dir,
      description: meta.description as string,
      created: meta.created as string,
      updated: meta.updated as string,
      status: meta.status as string,
      tags: meta.tags as string[],
      files: files.filter((f) => f !== "META.yaml"),
    });
  }

  // Sort by updated date (newest first)
  return entries.sort((a, b) => {
    if (!a.updated && !b.updated) return 0;
    if (!a.updated) return 1;
    if (!b.updated) return -1;
    return new Date(b.updated).getTime() - new Date(a.updated).getTime();
  });
}

export async function getLearningEntries(): Promise<LearningEntry[]> {
  const learningDir = path.join(MEMORY_DIR, "LEARNING");
  const categories = await listDirectories(learningDir);
  const entries: LearningEntry[] = [];

  for (const category of categories) {
    const categoryPath = path.join(learningDir, category);
    const files = await listFiles(categoryPath, ".md");

    for (const file of files) {
      const filePath = path.join(categoryPath, file);
      const content = await readFile(filePath);

      if (content) {
        entries.push({
          id: `${category}/${file}`,
          path: filePath,
          category,
          filename: file,
          content: content.slice(0, 500) + (content.length > 500 ? "..." : ""),
          size: content.length,
        });
      }
    }
  }

  return entries;
}

export async function getStateEntries(): Promise<StateEntry[]> {
  const stateDir = path.join(MEMORY_DIR, "STATE");
  const files = await listFiles(stateDir);
  const entries: StateEntry[] = [];

  for (const file of files) {
    const filePath = path.join(stateDir, file);
    const content = await readFile(filePath);

    if (content) {
      let parsed: unknown = content;

      // Try to parse JSON files
      if (file.endsWith(".json")) {
        try {
          parsed = JSON.parse(content);
        } catch {
          parsed = content;
        }
      }

      // Get file stats for updated time
      const { stat } = await import("fs/promises");
      let updated = new Date().toISOString();
      try {
        const stats = await stat(filePath);
        updated = stats.mtime.toISOString();
      } catch {
        // ignore
      }

      entries.push({
        id: file,
        path: filePath,
        filename: file,
        content: parsed,
        updated,
      });
    }
  }

  return entries;
}

export async function getWorkEntryDetails(id: string): Promise<WorkEntry | null> {
  const workDir = path.join(MEMORY_DIR, "WORK");
  const entryPath = path.join(workDir, id);

  if (!(await fileExists(entryPath))) {
    return null;
  }

  const metaPath = path.join(entryPath, "META.yaml");
  let meta: Record<string, unknown> = {};
  const metaContent = await readFile(metaPath);
  if (metaContent) {
    meta = parseMetaYaml(metaContent);
  }

  const files = await listFiles(entryPath);

  return {
    id,
    path: entryPath,
    title: (meta.title as string) || id,
    description: meta.description as string,
    created: meta.created as string,
    updated: meta.updated as string,
    status: meta.status as string,
    tags: meta.tags as string[],
    files: files.filter((f) => f !== "META.yaml"),
  };
}
