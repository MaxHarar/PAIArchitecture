"use client";

import { useEffect, useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { MediaEntry } from "./DocumentsPanel";

interface ImageLightboxProps {
  entry: MediaEntry;
  onClose: () => void;
  onDelete: () => void;
  onNavigate?: (direction: "prev" | "next") => void;
  onTagsUpdate?: (tags: string[]) => void;
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
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// Check if file is an image
function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

// Category colors
const CATEGORY_COLORS: Record<string, string> = {
  ART: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  DOCUMENTS: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  UPLOADS: "bg-green-500/20 text-green-400 border-green-500/30",
};

export function ImageLightbox({
  entry,
  onClose,
  onDelete,
  onNavigate,
  onTagsUpdate,
}: ImageLightboxProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [localTags, setLocalTags] = useState<string[]>(entry.tags);
  const [copied, setCopied] = useState(false);

  const imageUrl = `/api/documents/file?id=${entry.id}`;

  // Update local tags when entry changes
  useEffect(() => {
    setLocalTags(entry.tags);
  }, [entry.tags]);

  // Copy prompt to clipboard
  const copyPrompt = useCallback(() => {
    if (entry.metadata?.prompt) {
      navigator.clipboard.writeText(entry.metadata.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [entry.metadata?.prompt]);

  // Handle keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if typing in tag input
      if (document.activeElement?.tagName === "INPUT") return;

      const key = e.key.toLowerCase();

      if (key === "escape") {
        if (showDeleteConfirm) {
          setShowDeleteConfirm(false);
        } else if (editingTags) {
          setEditingTags(false);
        } else {
          onClose();
        }
      }

      // Arrow keys / WASD for navigation
      if (onNavigate) {
        if (key === "arrowleft" || key === "a") {
          e.preventDefault();
          onNavigate("prev");
        } else if (key === "arrowright" || key === "d") {
          e.preventDefault();
          onNavigate("next");
        }
      }

      // Delete shortcut
      if ((key === "delete" || key === "backspace") && !editingTags) {
        e.preventDefault();
        setShowDeleteConfirm(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onNavigate, showDeleteConfirm, editingTags]);

  // Prevent body scroll when lightbox is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Add tag
  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !localTags.includes(tag)) {
      const newTags = [...localTags, tag];
      setLocalTags(newTags);
      onTagsUpdate?.(newTags);
    }
    setTagInput("");
  };

  // Remove tag
  const handleRemoveTag = (tag: string) => {
    const newTags = localTags.filter((t) => t !== tag);
    setLocalTags(newTags);
    onTagsUpdate?.(newTags);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl z-10"
        aria-label="Close"
      >
        ✕
      </button>

      {/* Navigation arrows */}
      {onNavigate && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNavigate("prev");
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl z-10 p-2"
            aria-label="Previous"
          >
            ‹
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNavigate("next");
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl z-10 p-2 mr-80"
            aria-label="Next"
          >
            ›
          </button>
        </>
      )}

      {/* Main content */}
      <div
        className="max-w-6xl max-h-[90vh] w-full flex gap-4 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Image/Preview */}
        <div className="flex-1 flex items-center justify-center relative">
          {isImage(entry.mimeType) ? (
            <img
              src={imageUrl}
              alt={entry.filename}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
          ) : (
            <div className="bg-muted rounded-lg p-8 text-center">
              <div className="text-6xl mb-4">
                {entry.mimeType === "application/pdf" ? "📄" : "📝"}
              </div>
              <p className="text-lg font-medium">{entry.filename}</p>
              <a
                href={imageUrl}
                download={entry.filename}
                className="inline-block mt-4 text-pai-400 hover:text-pai-300"
              >
                Download file
              </a>
            </div>
          )}

          {/* Navigation hint */}
          {onNavigate && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/50 text-xs">
              ← A/D or Arrow keys to navigate →
            </div>
          )}
        </div>

        {/* Metadata Panel */}
        <div className="w-80 bg-background/90 backdrop-blur rounded-lg p-4 overflow-y-auto max-h-[80vh]">
          <h3 className="font-semibold mb-4">Details</h3>

          {/* Category */}
          <div className="mb-4">
            <Badge className={`border ${CATEGORY_COLORS[entry.category]}`}>
              {entry.category}
            </Badge>
          </div>

          {/* Filename */}
          <div className="mb-3">
            <p className="text-xs text-muted-foreground">Filename</p>
            <p className="text-sm font-medium break-all">{entry.filename}</p>
          </div>

          {/* Size */}
          <div className="mb-3">
            <p className="text-xs text-muted-foreground">Size</p>
            <p className="text-sm">{formatSize(entry.size)}</p>
          </div>

          {/* Created */}
          <div className="mb-3">
            <p className="text-xs text-muted-foreground">Created</p>
            <p className="text-sm">{formatDate(entry.created)}</p>
          </div>

          {/* Prompt (for art) */}
          {entry.metadata?.prompt && (
            <div className="mb-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Prompt</p>
                <button
                  onClick={copyPrompt}
                  className="text-xs text-pai-400 hover:text-pai-300"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-sm bg-muted p-2 rounded mt-1 max-h-32 overflow-y-auto">
                {entry.metadata.prompt}
              </p>
            </div>
          )}

          {/* Model */}
          {entry.metadata?.model && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground">Model</p>
              <p className="text-sm">{entry.metadata.model}</p>
            </div>
          )}

          {/* Workflow */}
          {entry.metadata?.workflow && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground">Workflow</p>
              <p className="text-sm">{entry.metadata.workflow}</p>
            </div>
          )}

          {/* Tags */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground">Tags</p>
              {onTagsUpdate && (
                <button
                  onClick={() => setEditingTags(!editingTags)}
                  className="text-xs text-pai-400 hover:text-pai-300"
                >
                  {editingTags ? "Done" : "Edit"}
                </button>
              )}
            </div>

            {/* Tag list */}
            <div className="flex flex-wrap gap-1 mb-2">
              {localTags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-xs group"
                >
                  {tag}
                  {editingTags && (
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-1 text-red-400 hover:text-red-300"
                    >
                      ×
                    </button>
                  )}
                </Badge>
              ))}
              {localTags.length === 0 && !editingTags && (
                <span className="text-xs text-muted-foreground">No tags</span>
              )}
            </div>

            {/* Add tag input */}
            {editingTags && (
              <div className="flex gap-1">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  placeholder="Add tag..."
                  className="flex-1 px-2 py-1 text-xs bg-muted border border-border rounded focus:outline-none focus:border-pai-500"
                />
                <button
                  onClick={handleAddTag}
                  className="px-2 py-1 text-xs bg-pai-500/20 hover:bg-pai-500/30 text-pai-400 rounded"
                >
                  Add
                </button>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="mt-6 pt-4 border-t border-border space-y-2">
            <a
              href={imageUrl}
              download={entry.filename}
              className="block w-full text-center py-2 bg-muted hover:bg-muted/80 rounded text-sm transition-colors"
            >
              Download
            </a>

            {/* Delete with confirmation */}
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded text-sm transition-colors"
              >
                Delete
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-center text-muted-foreground">
                  Delete this file permanently?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 py-2 bg-muted hover:bg-muted/80 rounded text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={onDelete}
                    className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white rounded text-sm transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Keyboard shortcuts */}
          <div className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground">
            <p className="font-medium mb-1">Shortcuts</p>
            <p>Esc - Close</p>
            <p>A/D or ←/→ - Navigate</p>
            <p>Del - Delete</p>
          </div>
        </div>
      </div>
    </div>
  );
}
