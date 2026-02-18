/**
 * Documents API Endpoint
 *
 * GET /api/documents?category=ART
 * Returns: { entries: MediaEntry[], total: number, stats: {...} }
 *
 * POST /api/documents (upload)
 * Body: FormData with file + metadata
 * Returns: { success: boolean, entry: MediaEntry }
 *
 * DELETE /api/documents?id=entry-id
 * Returns: { success: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getMediaEntries,
  deleteMediaEntry,
  saveUploadedFile,
  getCategoryStats,
  initializeMediaDirectories,
  searchMediaEntries,
  type MediaCategory,
} from "@/lib/pai/documents";

// Initialize directories on first request
let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initializeMediaDirectories();
    initialized = true;
  }
}

export async function GET(request: NextRequest) {
  await ensureInitialized();

  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") as MediaCategory | null;
    const search = searchParams.get("search");

    let entries;
    if (search) {
      entries = await searchMediaEntries(search, category || undefined);
    } else {
      entries = await getMediaEntries(category || undefined);
    }

    const stats = await getCategoryStats();

    return NextResponse.json({
      entries,
      total: entries.length,
      stats,
    });
  } catch (error) {
    console.error("Failed to get documents:", error);
    return NextResponse.json(
      { error: "Failed to get documents" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  await ensureInitialized();

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const category = (formData.get("category") as MediaCategory) || "UPLOADS";
    const metadataStr = formData.get("metadata") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Parse metadata if provided
    let metadata = {};
    if (metadataStr) {
      try {
        metadata = JSON.parse(metadataStr);
      } catch {
        // Ignore invalid JSON
      }
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Save file and create entry
    const entry = await saveUploadedFile(
      buffer,
      file.name,
      category,
      metadata
    );

    return NextResponse.json({
      success: true,
      entry,
    });
  } catch (error) {
    console.error("Failed to upload file:", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  await ensureInitialized();

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "No entry ID provided" },
        { status: 400 }
      );
    }

    const deleted = await deleteMediaEntry(id, true);

    return NextResponse.json({
      success: deleted,
    });
  } catch (error) {
    console.error("Failed to delete entry:", error);
    return NextResponse.json(
      { error: "Failed to delete entry" },
      { status: 500 }
    );
  }
}
