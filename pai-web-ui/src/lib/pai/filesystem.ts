import { promises as fs } from "fs";
import path from "path";
import { homedir } from "os";

export const PAI_ROOT = path.join(homedir(), ".claude");
export const SKILLS_DIR = path.join(PAI_ROOT, "skills");
export const MEMORY_DIR = path.join(PAI_ROOT, "MEMORY");
export const MEDIA_DIR = path.join(PAI_ROOT, "MEDIA");
export const SETTINGS_FILE = path.join(PAI_ROOT, "settings.json");

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  const content = await readFile(filePath);
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function listDirectories(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export async function listFiles(
  dirPath: string,
  extension?: string
): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => {
        if (!entry.isFile()) return false;
        if (extension && !entry.name.endsWith(extension)) return false;
        return true;
      })
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
