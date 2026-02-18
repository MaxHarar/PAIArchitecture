"use client";

import { useState, useCallback } from "react";

interface UploadZoneProps {
  onUpload: (file: File) => void;
  accept?: string;
  maxSize?: number; // in bytes
}

const DEFAULT_ACCEPT = "image/*,.pdf,.txt,.md,.json";
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB

export function UploadZone({
  onUpload,
  accept = DEFAULT_ACCEPT,
  maxSize = DEFAULT_MAX_SIZE,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const validateAndUpload = useCallback(
    (file: File) => {
      setError(null);

      // Check size
      if (file.size > maxSize) {
        setError(`File too large. Max size: ${Math.round(maxSize / 1024 / 1024)}MB`);
        return;
      }

      onUpload(file);
    },
    [maxSize, onUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        // Upload first file (could extend to batch upload)
        validateAndUpload(files[0]);
      }
    },
    [validateAndUpload]
  );

  const handleClick = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        validateAndUpload(file);
      }
    };
    input.click();
  }, [accept, validateAndUpload]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`
        border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all
        ${
          isDragging
            ? "border-pai-500 bg-pai-500/10"
            : "border-border hover:border-pai-500/50 hover:bg-muted/50"
        }
      `}
    >
      <div className="flex flex-col items-center gap-2">
        <div className="text-2xl">📤</div>
        <p className="text-sm text-muted-foreground">
          {isDragging ? (
            "Drop file here..."
          ) : (
            <>
              Drag & drop files here or{" "}
              <span className="text-pai-400">click to browse</span>
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          Images, PDFs, text files up to {Math.round(maxSize / 1024 / 1024)}MB
        </p>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
