"use client";

import { useEffect } from "react";
import { voiceQueue } from "@/lib/voice/VoiceQueue";

/**
 * Global keyboard shortcuts handler
 *
 * Shortcuts:
 * - Space (when not in input): Skip current voice playback
 * - V (when not in input): Toggle voice input (handled in VoiceInput)
 * - Escape: Stop listening / cancel operation (handled in VoiceInput)
 * - Cmd+K: Open search (handled in Header)
 */
export function KeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isInput) return;

      // Space - Skip current voice playback
      if (e.code === "Space") {
        const state = voiceQueue.getState();
        if (state.isPlaying) {
          e.preventDefault();
          voiceQueue.skipCurrent();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // This component doesn't render anything
  return null;
}
