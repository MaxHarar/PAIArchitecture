"use client";

import { useEffect, useRef } from "react";
import { MediaCard } from "./MediaCard";
import type { MediaEntry } from "./DocumentsPanel";

interface MediaGridProps {
  entries: MediaEntry[];
  onEntryClick: (entry: MediaEntry) => void;
  loading?: boolean;
  selectedIndex?: number;
}

export function MediaGrid({ entries, onEntryClick, loading, selectedIndex = -1 }: MediaGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && gridRef.current) {
      const cards = gridRef.current.querySelectorAll("[data-media-card]");
      const selectedCard = cards[selectedIndex] as HTMLElement;
      if (selectedCard) {
        selectedCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [selectedIndex]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div
            key={i}
            className="aspect-square bg-muted rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div ref={gridRef} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {entries.map((entry, index) => (
        <MediaCard
          key={entry.id}
          entry={entry}
          onClick={() => onEntryClick(entry)}
          isSelected={index === selectedIndex}
        />
      ))}
    </div>
  );
}
