"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MediaGrid } from "./MediaGrid";
import { UploadZone } from "./UploadZone";
import { ImageLightbox } from "./ImageLightbox";

export interface MediaEntry {
  id: string;
  filename: string;
  path: string;
  category: "ART" | "DOCUMENTS" | "UPLOADS";
  created: string;
  size: number;
  mimeType: string;
  tags: string[];
  metadata: {
    prompt?: string;
    model?: string;
    workflow?: string;
    dimensions?: string;
    [key: string]: unknown;
  };
}

interface CategoryStats {
  count: number;
  totalSize: number;
}

interface DocumentsData {
  entries: MediaEntry[];
  total: number;
  stats: {
    ART: CategoryStats;
    DOCUMENTS: CategoryStats;
    UPLOADS: CategoryStats;
  };
}

export function DocumentsPanel() {
  const [data, setData] = useState<DocumentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [lightboxEntry, setLightboxEntry] = useState<MediaEntry | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Show toast notification
  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Fetch documents
  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const url = new URL("/api/documents", window.location.origin);
      if (activeCategory !== "all") {
        url.searchParams.set("category", activeCategory);
      }
      if (searchQuery) {
        url.searchParams.set("search", searchQuery);
      }

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to fetch documents");
      const data = await res.json();
      setData(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [activeCategory, searchQuery]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Handle file upload
  const handleUpload = async (file: File) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", "UPLOADS");

      const res = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");

      showToast(`Uploaded ${file.name}`, "success");
      fetchDocuments();
    } catch (err) {
      console.error("Upload failed:", err);
      showToast("Upload failed", "error");
    }
  };

  // Handle delete
  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/documents?id=${id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Delete failed");

      showToast("File deleted", "success");
      fetchDocuments();
      setLightboxEntry(null);
      setSelectedIndex(-1);
    } catch (err) {
      console.error("Delete failed:", err);
      showToast("Delete failed", "error");
    }
  };

  // Scan Downloads for new art
  const handleScanDownloads = async () => {
    try {
      setScanning(true);
      const res = await fetch("/api/documents/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "ART",
          scanPath: "~/Downloads",
          metadata: {
            source: "auto-scan",
            scannedAt: new Date().toISOString(),
          },
        }),
      });

      if (!res.ok) throw new Error("Scan failed");

      const result = await res.json();
      if (result.count > 0) {
        showToast(`Found ${result.count} new images`, "success");
        fetchDocuments();
      } else {
        showToast("No new images found", "success");
      }
    } catch (err) {
      console.error("Scan failed:", err);
      showToast("Scan failed", "error");
    } finally {
      setScanning(false);
    }
  };

  // Filter entries by category
  const getFilteredEntries = useCallback(() => {
    if (!data) return [];
    if (activeCategory === "all") return data.entries;
    return data.entries.filter((e) => e.category === activeCategory);
  }, [data, activeCategory]);

  // Count by category
  const getCategoryCount = (category: string) => {
    if (!data) return 0;
    if (category === "all") return data.total;
    return data.stats[category as keyof typeof data.stats]?.count || 0;
  };

  // Keyboard navigation
  useEffect(() => {
    const entries = getFilteredEntries();
    const gridCols = 5; // Approximate columns in grid

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if lightbox is open (lightbox handles its own keys)
      if (lightboxEntry) return;

      // Ignore if typing in search input
      if (document.activeElement?.tagName === "INPUT") return;

      const key = e.key.toLowerCase();

      // Arrow keys + WASD navigation
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(key)) {
        e.preventDefault();

        if (entries.length === 0) return;

        let newIndex = selectedIndex;

        if (key === "arrowleft" || key === "a") {
          newIndex = selectedIndex <= 0 ? entries.length - 1 : selectedIndex - 1;
        } else if (key === "arrowright" || key === "d") {
          newIndex = selectedIndex >= entries.length - 1 ? 0 : selectedIndex + 1;
        } else if (key === "arrowup" || key === "w") {
          newIndex = selectedIndex - gridCols;
          if (newIndex < 0) newIndex = Math.max(0, entries.length + newIndex);
        } else if (key === "arrowdown" || key === "s") {
          newIndex = selectedIndex + gridCols;
          if (newIndex >= entries.length) newIndex = newIndex - entries.length;
        }

        // Initialize selection if not set
        if (selectedIndex === -1) {
          newIndex = 0;
        }

        setSelectedIndex(newIndex);
      }

      // Enter to open lightbox
      if (key === "enter" && selectedIndex >= 0 && selectedIndex < entries.length) {
        e.preventDefault();
        setLightboxEntry(entries[selectedIndex]);
      }

      // Delete key
      if ((key === "delete" || key === "backspace") && selectedIndex >= 0 && selectedIndex < entries.length) {
        e.preventDefault();
        if (confirm("Delete this file?")) {
          handleDelete(entries[selectedIndex].id);
        }
      }

      // Escape to deselect
      if (key === "escape") {
        setSelectedIndex(-1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, lightboxEntry, getFilteredEntries, handleDelete]);

  // Navigate in lightbox
  const handleLightboxNavigate = useCallback(
    (direction: "prev" | "next") => {
      const entries = getFilteredEntries();
      if (entries.length === 0 || !lightboxEntry) return;

      const currentIndex = entries.findIndex((e) => e.id === lightboxEntry.id);
      let newIndex;

      if (direction === "prev") {
        newIndex = currentIndex <= 0 ? entries.length - 1 : currentIndex - 1;
      } else {
        newIndex = currentIndex >= entries.length - 1 ? 0 : currentIndex + 1;
      }

      setLightboxEntry(entries[newIndex]);
      setSelectedIndex(newIndex);
    },
    [getFilteredEntries, lightboxEntry]
  );

  // Handle entry click from grid
  const handleEntryClick = useCallback(
    (entry: MediaEntry) => {
      const entries = getFilteredEntries();
      const index = entries.findIndex((e) => e.id === entry.id);
      setSelectedIndex(index);
      setLightboxEntry(entry);
    },
    [getFilteredEntries]
  );

  if (loading && !data) {
    return (
      <div className="p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4"></div>
          <div className="h-10 bg-muted rounded w-full"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-48 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-4">
        <Card className="border-red-500/30 bg-red-500/10">
          <CardContent className="pt-4">
            <p className="text-red-400">Error: {error}</p>
            <button
              onClick={fetchDocuments}
              className="mt-2 text-sm text-pai-400 hover:text-pai-300"
            >
              Try again
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filteredEntries = getFilteredEntries();

  return (
    <div ref={containerRef} className="p-4 h-full flex flex-col" tabIndex={0}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Documents & Media</h2>
        <div className="flex items-center gap-3">
          {/* Scan Downloads Button */}
          <button
            onClick={handleScanDownloads}
            disabled={scanning}
            className="text-xs px-3 py-1.5 bg-pai-500/20 hover:bg-pai-500/30 text-pai-400 rounded-lg transition-colors disabled:opacity-50"
          >
            {scanning ? "Scanning..." : "Scan Downloads"}
          </button>
          <div className="text-xs text-muted-foreground">
            {data?.total || 0} items
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search files... (use arrows/WASD to navigate)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-pai-500"
        />
      </div>

      {/* Category Tabs */}
      <Tabs value={activeCategory} onValueChange={(v) => { setActiveCategory(v); setSelectedIndex(-1); }}>
        <TabsList className="mb-4">
          <TabsTrigger value="all">
            All
            <Badge variant="secondary" className="ml-2 text-xs">
              {getCategoryCount("all")}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="ART">
            Art
            <Badge variant="secondary" className="ml-2 text-xs">
              {getCategoryCount("ART")}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="DOCUMENTS">
            Docs
            <Badge variant="secondary" className="ml-2 text-xs">
              {getCategoryCount("DOCUMENTS")}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="UPLOADS">
            Uploads
            <Badge variant="secondary" className="ml-2 text-xs">
              {getCategoryCount("UPLOADS")}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* Content - same for all tabs, just filtered */}
        <div className="flex-1 overflow-y-auto">
          {/* Upload Zone - show on UPLOADS tab */}
          {activeCategory === "UPLOADS" && (
            <div className="mb-4">
              <UploadZone onUpload={handleUpload} />
            </div>
          )}

          {/* Media Grid */}
          <MediaGrid
            entries={filteredEntries}
            onEntryClick={handleEntryClick}
            loading={loading}
            selectedIndex={selectedIndex}
          />

          {/* Empty State */}
          {filteredEntries.length === 0 && !loading && (
            <div className="text-center text-muted-foreground py-12">
              <p>No files found</p>
              {activeCategory === "ART" && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs">Use the /art skill to generate images</p>
                  <button
                    onClick={handleScanDownloads}
                    className="text-xs px-3 py-1.5 bg-pai-500/20 hover:bg-pai-500/30 text-pai-400 rounded-lg transition-colors"
                  >
                    Scan Downloads for Art
                  </button>
                </div>
              )}
              {activeCategory === "UPLOADS" && (
                <p className="text-xs mt-2">
                  Drag and drop files above to upload
                </p>
              )}
            </div>
          )}

          {/* Keyboard shortcuts help */}
          {filteredEntries.length > 0 && (
            <div className="mt-4 text-center text-xs text-muted-foreground">
              <span className="opacity-60">
                Navigate: Arrow keys or WASD | Open: Enter | Delete: Del/Backspace | Deselect: Esc
              </span>
            </div>
          )}
        </div>
      </Tabs>

      {/* Lightbox */}
      {lightboxEntry && (
        <ImageLightbox
          entry={lightboxEntry}
          onClose={() => setLightboxEntry(null)}
          onDelete={() => handleDelete(lightboxEntry.id)}
          onNavigate={handleLightboxNavigate}
          onTagsUpdate={(tags) => {
            // Update tags via API then refresh
            handleUpdateTags(lightboxEntry.id, tags);
          }}
        />
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg z-50 transition-all ${
            toast.type === "error"
              ? "bg-red-500 text-white"
              : "bg-pai-500 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );

  // Update tags helper
  async function handleUpdateTags(id: string, tags: string[]) {
    try {
      const res = await fetch("/api/documents/tags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, tags }),
      });

      if (!res.ok) throw new Error("Failed to update tags");

      showToast("Tags updated", "success");
      fetchDocuments();

      // Update lightbox entry with new tags
      if (lightboxEntry && lightboxEntry.id === id) {
        setLightboxEntry({ ...lightboxEntry, tags });
      }
    } catch (err) {
      console.error("Failed to update tags:", err);
      showToast("Failed to update tags", "error");
    }
  }
}
