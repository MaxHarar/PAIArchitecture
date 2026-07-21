/**
 * File Serving API Endpoint
 *
 * GET /api/documents/file?id=entry-id
 * GET /api/documents/file?path=/absolute/path/to/file
 *
 * Serves media files from the MEDIA directory with proper content types.
 * This is necessary because ~/.claude files can't be served statically.
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getMediaEntry } from "@/lib/pai/documents";
import { fileExists, MEDIA_DIR } from "@/lib/pai/filesystem";

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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const filePath = searchParams.get("path");

    let targetPath: string | null = null;

    // Case 1: Get by entry ID
    if (id) {
      const entry = await getMediaEntry(id);
      if (!entry) {
        return NextResponse.json({ error: "Entry not found" }, { status: 404 });
      }
      targetPath = entry.path;
    }

    // Case 2: Get by path (must be within MEDIA_DIR for security)
    if (filePath) {
      // Security: Ensure path is within MEDIA_DIR
      const normalizedPath = path.normalize(filePath);
      if (!normalizedPath.startsWith(MEDIA_DIR)) {
        return NextResponse.json(
          { error: "Access denied: path must be within MEDIA directory" },
          { status: 403 }
        );
      }
      targetPath = normalizedPath;
    }

    if (!targetPath) {
      return NextResponse.json(
        { error: "No id or path provided" },
        { status: 400 }
      );
    }

    // Check file exists
    if (!(await fileExists(targetPath))) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Read file
    const buffer = await fs.readFile(targetPath);

    // Determine content type
    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    // Return file with proper headers
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Failed to serve file:", error);
    return NextResponse.json(
      { error: "Failed to serve file" },
      { status: 500 }
    );
  }
}
