/**
 * Documents/Media Library
 *
 * Core utilities for managing the MEDIA directory containing
 * AI-generated art, documents, and manual uploads.
 */

import { promises as fs } from "fs";
import path from "path";
import { MEDIA_DIR, fileExists, readJson } from "./filesystem";

// =============================================================================
// TYPES
// =============================================================================

export type MediaCategory = "ART" | "DOCUMENTS" | "UPLOADS";

export interface MediaMetadata {
  prompt?: string;
  model?: string;
  workflow?: string;
  dimensions?: string;
  [key: string]: unknown;
}

export interface MediaEntry {
  id: string;
  filename: string;
  path: string;
  category: MediaCategory;
  created: string;
  size: number;
  mimeType: string;
  tags: string[];
  metadata: MediaMetadata;
}

export interface CategoryMeta {
  entries: MediaEntry[];
  lastUpdated: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

export const CATEGORY_DIRS = {
  ART: path.join(MEDIA_DIR, "ART"),
  DOCUMENTS: path.join(MEDIA_DIR, "DOCUMENTS"),
  UPLOADS: path.join(MEDIA_DIR, "UPLOADS"),
} as const;

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function isImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext);
}

function isDocumentFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return [".pdf", ".txt", ".md", ".json"].includes(ext);
}

// =============================================================================
// META.JSON OPERATIONS
// =============================================================================

async function getMetaPath(category: MediaCategory): Promise<string> {
  return path.join(CATEGORY_DIRS[category], "META.json");
}

async function readCategoryMeta(category: MediaCategory): Promise<CategoryMeta> {
  const metaPath = await getMetaPath(category);

  if (!(await fileExists(metaPath))) {
    return { entries: [], lastUpdated: new Date().toISOString() };
  }

  const meta = await readJson<CategoryMeta>(metaPath);
  return meta || { entries: [], lastUpdated: new Date().toISOString() };
}

async function writeCategoryMeta(
  category: MediaCategory,
  meta: CategoryMeta
): Promise<void> {
  const metaPath = await getMetaPath(category);
  meta.lastUpdated = new Date().toISOString();
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Get all media entries, optionally filtered by category
 */
export async function getMediaEntries(
  category?: MediaCategory
): Promise<MediaEntry[]> {
  const categories: MediaCategory[] = category
    ? [category]
    : ["ART", "DOCUMENTS", "UPLOADS"];

  const allEntries: MediaEntry[] = [];

  for (const cat of categories) {
    const meta = await readCategoryMeta(cat);
    allEntries.push(...meta.entries);
  }

  // Sort by created date, newest first
  return allEntries.sort(
    (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
  );
}

/**
 * Get a single media entry by ID
 */
export async function getMediaEntry(id: string): Promise<MediaEntry | null> {
  const entries = await getMediaEntries();
  return entries.find((e) => e.id === id) || null;
}

/**
 * Add a new media entry to the catalog
 */
export async function addMediaEntry(
  entry: Omit<MediaEntry, "id">
): Promise<MediaEntry> {
  const meta = await readCategoryMeta(entry.category);

  const newEntry: MediaEntry = {
    ...entry,
    id: generateId(),
  };

  meta.entries.push(newEntry);
  await writeCategoryMeta(entry.category, meta);

  return newEntry;
}

/**
 * Update an existing media entry
 */
export async function updateMediaEntry(
  id: string,
  updates: Partial<MediaEntry>
): Promise<MediaEntry | null> {
  // Find which category the entry is in
  for (const category of ["ART", "DOCUMENTS", "UPLOADS"] as MediaCategory[]) {
    const meta = await readCategoryMeta(category);
    const index = meta.entries.findIndex((e) => e.id === id);

    if (index !== -1) {
      meta.entries[index] = { ...meta.entries[index], ...updates };
      await writeCategoryMeta(category, meta);
      return meta.entries[index];
    }
  }

  return null;
}

/**
 * Delete a media entry (and optionally the file)
 */
export async function deleteMediaEntry(
  id: string,
  deleteFile: boolean = true
): Promise<boolean> {
  for (const category of ["ART", "DOCUMENTS", "UPLOADS"] as MediaCategory[]) {
    const meta = await readCategoryMeta(category);
    const index = meta.entries.findIndex((e) => e.id === id);

    if (index !== -1) {
      const entry = meta.entries[index];

      // Delete the actual file if requested
      if (deleteFile && (await fileExists(entry.path))) {
        try {
          await fs.unlink(entry.path);
        } catch (err) {
          console.error(`Failed to delete file: ${entry.path}`, err);
        }
      }

      // Remove from meta
      meta.entries.splice(index, 1);
      await writeCategoryMeta(category, meta);
      return true;
    }
  }

  return false;
}

/**
 * Scan a directory for uncataloged files and add them
 */
export async function catalogFromDirectory(
  scanPath: string,
  category: MediaCategory,
  metadata: MediaMetadata = {}
): Promise<MediaEntry[]> {
  const newEntries: MediaEntry[] = [];

  try {
    const files = await fs.readdir(scanPath);
    const meta = await readCategoryMeta(category);
    const existingPaths = new Set(meta.entries.map((e) => e.path));

    for (const file of files) {
      const filePath = path.join(scanPath, file);
      const stat = await fs.stat(filePath);

      // Skip directories and already-cataloged files
      if (stat.isDirectory() || existingPaths.has(filePath)) {
        continue;
      }

      // Only process images for ART category
      if (category === "ART" && !isImageFile(file)) {
        continue;
      }

      const entry: MediaEntry = {
        id: generateId(),
        filename: file,
        path: filePath,
        category,
        created: stat.mtime.toISOString(),
        size: stat.size,
        mimeType: getMimeType(file),
        tags: [],
        metadata: {
          ...metadata,
          autoImported: true,
        },
      };

      meta.entries.push(entry);
      newEntries.push(entry);
    }

    if (newEntries.length > 0) {
      await writeCategoryMeta(category, meta);
    }
  } catch (err) {
    console.error(`Failed to scan directory: ${scanPath}`, err);
  }

  return newEntries;
}

/**
 * Save an uploaded file to the appropriate category
 */
export async function saveUploadedFile(
  buffer: Buffer,
  filename: string,
  category: MediaCategory,
  metadata: MediaMetadata = {}
): Promise<MediaEntry> {
  const targetDir = CATEGORY_DIRS[category];

  // Ensure directory exists
  await fs.mkdir(targetDir, { recursive: true });

  // Generate unique filename if collision
  let targetFilename = filename;
  let counter = 1;
  while (await fileExists(path.join(targetDir, targetFilename))) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    targetFilename = `${base}-${counter}${ext}`;
    counter++;
  }

  const targetPath = path.join(targetDir, targetFilename);

  // Write file
  await fs.writeFile(targetPath, buffer);

  // Get file stats
  const stat = await fs.stat(targetPath);

  // Create entry
  const entry = await addMediaEntry({
    filename: targetFilename,
    path: targetPath,
    category,
    created: new Date().toISOString(),
    size: stat.size,
    mimeType: getMimeType(targetFilename),
    tags: [],
    metadata,
  });

  return entry;
}

/**
 * Search entries by filename or tags
 */
export async function searchMediaEntries(
  query: string,
  category?: MediaCategory
): Promise<MediaEntry[]> {
  const entries = await getMediaEntries(category);
  const lowerQuery = query.toLowerCase();

  return entries.filter((entry) => {
    // Search filename
    if (entry.filename.toLowerCase().includes(lowerQuery)) {
      return true;
    }

    // Search tags
    if (entry.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))) {
      return true;
    }

    // Search prompt (for art)
    if (entry.metadata.prompt?.toLowerCase().includes(lowerQuery)) {
      return true;
    }

    return false;
  });
}

/**
 * Get category statistics
 */
export async function getCategoryStats(): Promise<
  Record<MediaCategory, { count: number; totalSize: number }>
> {
  const stats: Record<MediaCategory, { count: number; totalSize: number }> = {
    ART: { count: 0, totalSize: 0 },
    DOCUMENTS: { count: 0, totalSize: 0 },
    UPLOADS: { count: 0, totalSize: 0 },
  };

  for (const category of ["ART", "DOCUMENTS", "UPLOADS"] as MediaCategory[]) {
    const meta = await readCategoryMeta(category);
    stats[category].count = meta.entries.length;
    stats[category].totalSize = meta.entries.reduce((sum, e) => sum + e.size, 0);
  }

  return stats;
}

/**
 * Initialize empty META.json files for all categories
 */
export async function initializeMediaDirectories(): Promise<void> {
  for (const [category, dir] of Object.entries(CATEGORY_DIRS)) {
    await fs.mkdir(dir, { recursive: true });

    const metaPath = path.join(dir, "META.json");
    if (!(await fileExists(metaPath))) {
      await fs.writeFile(
        metaPath,
        JSON.stringify(
          { entries: [], lastUpdated: new Date().toISOString() },
          null,
          2
        )
      );
    }
  }
}
