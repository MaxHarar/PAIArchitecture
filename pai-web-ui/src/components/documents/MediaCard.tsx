"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { MediaEntry } from "./DocumentsPanel";

interface MediaCardProps {
  entry: MediaEntry;
  onClick: () => void;
  isSelected?: boolean;
}

// Format file size
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Format date
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

// Check if file is an image
function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

// Get icon for non-image files
function getFileIcon(mimeType: string): string {
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("text/")) return "📝";
  if (mimeType === "application/json") return "{}";
  return "📁";
}

// Category colors
const CATEGORY_COLORS: Record<string, string> = {
  ART: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  DOCUMENTS: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  UPLOADS: "bg-green-500/20 text-green-400 border-green-500/30",
};

export function MediaCard({ entry, onClick, isSelected = false }: MediaCardProps) {
  const [imageError, setImageError] = useState(false);

  const imageUrl = `/api/documents/file?id=${entry.id}`;

  return (
    <div
      data-media-card
      onClick={onClick}
      className={`
        group relative aspect-square bg-muted rounded-lg overflow-hidden cursor-pointer transition-all
        ${
          isSelected
            ? "ring-2 ring-pai-500 ring-offset-2 ring-offset-background scale-[1.02]"
            : "border border-border hover:border-pai-500/50 hover:scale-[1.02]"
        }
      `}
    >
      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute top-2 left-2 z-10 w-5 h-5 bg-pai-500 rounded-full flex items-center justify-center">
          <span className="text-white text-xs">✓</span>
        </div>
      )}

      {/* Image or File Icon */}
      {isImage(entry.mimeType) && !imageError ? (
        <img
          src={imageUrl}
          alt={entry.filename}
          className="w-full h-full object-cover"
          onError={() => setImageError(true)}
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-4xl bg-muted">
          {getFileIcon(entry.mimeType)}
        </div>
      )}

      {/* Hover Overlay */}
      <div className={`absolute inset-0 bg-black/60 transition-opacity flex flex-col justify-between p-2 ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        {/* Top: Category Badge */}
        <div className="flex justify-end">
          <Badge className={`text-xs border ${CATEGORY_COLORS[entry.category]}`}>
            {entry.category}
          </Badge>
        </div>

        {/* Bottom: File Info */}
        <div>
          <p className="text-xs text-white font-medium truncate">
            {entry.filename}
          </p>
          <div className="flex items-center justify-between text-[10px] text-gray-400 mt-1">
            <span>{formatSize(entry.size)}</span>
            <span>{formatDate(entry.created)}</span>
          </div>
          {entry.metadata?.prompt && (
            <p className="text-[10px] text-gray-400 mt-1 line-clamp-2">
              {entry.metadata.prompt}
            </p>
          )}
        </div>
      </div>

      {/* Tags (bottom left, always visible) */}
      {entry.tags.length > 0 && !isSelected && (
        <div className="absolute bottom-1 left-1 flex gap-1 group-hover:hidden">
          {entry.tags.slice(0, 2).map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="text-[10px] px-1 py-0"
            >
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
