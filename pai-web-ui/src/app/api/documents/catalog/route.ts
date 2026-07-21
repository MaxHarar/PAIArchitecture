/**
 * Document Catalog API Endpoint
 *
 * POST /api/documents/catalog
 * Body: { category: string, scanPath?: string, filepath?: string, metadata?: object }
 *
 * Used by art skill hook for auto-cataloging and manual batch imports.
 *
 * Returns: { success: boolean, entries: MediaEntry[], count: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { homedir } from "os";
import path from "path";
import {
  catalogFromDirectory,
  addMediaEntry,
  initializeMediaDirectories,
  type MediaCategory,
  type MediaMetadata,
} from "@/lib/pai/documents";
import { fileExists } from "@/lib/pai/filesystem";
import { promises as fs } from "fs";

// Initialize directories on first request
let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initializeMediaDirectories();
    initialized = true;
  }
}

// Expand ~ to home directory
function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(homedir(), p.slice(2));
  }
  return p;
}

export async function POST(request: NextRequest) {
  await ensureInitialized();

  try {
    const body = await request.json();
    const {
      category = "ART",
      scanPath,
      filepath,
      metadata = {},
    } = body as {
      category?: MediaCategory;
      scanPath?: string;
      filepath?: string;
      metadata?: MediaMetadata;
    };

    // Case 1: Catalog a single file
    if (filepath) {
      const expandedPath = expandPath(filepath);

      if (!(await fileExists(expandedPath))) {
        return NextResponse.json(
          { error: `File not found: ${expandedPath}` },
          { status: 404 }
        );
      }

      const stat = await fs.stat(expandedPath);
      const filename = path.basename(expandedPath);

      const entry = await addMediaEntry({
        filename,
        path: expandedPath,
        category,
        created: stat.mtime.toISOString(),
        size: stat.size,
        mimeType: getMimeType(filename),
        tags: [],
        metadata,
      });

      return NextResponse.json({
        success: true,
        entries: [entry],
        count: 1,
      });
    }

    // Case 2: Scan a directory for files
    if (scanPath) {
      const expandedPath = expandPath(scanPath);

      if (!(await fileExists(expandedPath))) {
        return NextResponse.json(
          { error: `Directory not found: ${expandedPath}` },
          { status: 404 }
        );
      }

      const entries = await catalogFromDirectory(expandedPath, category, metadata);

      return NextResponse.json({
        success: true,
        entries,
        count: entries.length,
      });
    }

    // Case 3: Default - scan ~/Downloads for art
    if (category === "ART") {
      const downloadsPath = path.join(homedir(), "Downloads");
      const entries = await catalogFromDirectory(downloadsPath, "ART", {
        ...metadata,
        source: "auto-catalog",
      });

      return NextResponse.json({
        success: true,
        entries,
        count: entries.length,
      });
    }

    return NextResponse.json(
      { error: "No filepath or scanPath provided" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Failed to catalog:", error);
    return NextResponse.json(
      { error: "Failed to catalog files" },
      { status: 500 }
    );
  }
}

// Helper function to determine MIME type
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
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
  return mimeTypes[ext] || "application/octet-stream";
}
