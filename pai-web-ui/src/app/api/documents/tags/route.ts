import { NextRequest, NextResponse } from "next/server";
import { updateMediaEntry, getMediaEntries } from "@/lib/pai/documents";

/**
 * PATCH /api/documents/tags
 * Update tags for a media entry
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, tags } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Missing required field: id" },
        { status: 400 }
      );
    }

    if (!Array.isArray(tags)) {
      return NextResponse.json(
        { error: "Tags must be an array" },
        { status: 400 }
      );
    }

    // Normalize tags (lowercase, trimmed, unique)
    const normalizedTags = [...new Set(
      tags
        .map((t: string) => t.trim().toLowerCase())
        .filter((t: string) => t.length > 0)
    )];

    // Update the entry with new tags (function searches all categories)
    const updated = await updateMediaEntry(id, { tags: normalizedTags });

    if (!updated) {
      return NextResponse.json(
        { error: "Entry not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      id,
      tags: normalizedTags,
    });
  } catch (error) {
    console.error("Error updating tags:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update tags" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/documents/tags
 * Get all unique tags across all entries
 */
export async function GET() {
  try {
    const entries = await getMediaEntries();

    // Collect all unique tags
    const allTags = new Set<string>();
    for (const entry of entries) {
      for (const tag of entry.tags) {
        allTags.add(tag);
      }
    }

    // Sort alphabetically
    const sortedTags = [...allTags].sort();

    return NextResponse.json({
      tags: sortedTags,
      count: sortedTags.length,
    });
  } catch (error) {
    console.error("Error fetching tags:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch tags" },
      { status: 500 }
    );
  }
}
