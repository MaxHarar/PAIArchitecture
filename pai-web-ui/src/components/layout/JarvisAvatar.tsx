"use client";

import { useEffect, useState } from "react";
import { activityState, type AvatarRole } from "@/lib/activity/ActivityStateManager";

interface JarvisAvatarProps {
  size?: number; // Size in pixels (default 48)
  showTooltip?: boolean; // Show activity tooltip (default true)
}

// Avatar role to display name mapping
const ROLE_LABELS: Record<AvatarRole, string> = {
  default: "Jarvis - Ready",
  architect: "Jarvis - Architecting",
  engineer: "Jarvis - Engineering",
  researcher: "Jarvis - Researching",
  analyst: "Jarvis - Analyzing",
  planner: "Jarvis - Planning",
  fitness: "Jarvis - Fitness Mode",
  artist: "Jarvis - Creating Art",
};

export function JarvisAvatar({ size = 48, showTooltip = true }: JarvisAvatarProps) {
  const [currentRole, setCurrentRole] = useState<AvatarRole>('default');
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Subscribe to activity state changes
  useEffect(() => {
    const unsubscribe = activityState.subscribe((state) => {
      setCurrentRole(state.currentRole);
      setImageLoaded(false); // Reset loaded state for new image
    });
    return unsubscribe;
  }, []);

  // Preload all avatars on mount for instant switching
  useEffect(() => {
    const roles: AvatarRole[] = [
      'default', 'architect', 'engineer', 'researcher',
      'analyst', 'planner', 'fitness', 'artist'
    ];

    roles.forEach(role => {
      const img = new Image();
      img.src = `/api/documents/file?path=/Users/maxharar/.claude/MEDIA/ART/jarvis-avatars/${role}.png`;
    });
  }, []);

  const avatarUrl = `/api/documents/file?path=/Users/maxharar/.claude/MEDIA/ART/jarvis-avatars/${currentRole}.png`;
  const tooltipText = ROLE_LABELS[currentRole];

  // Fallback to gradient "J" if image fails
  if (imageError) {
    return (
      <div
        className="rounded-lg bg-gradient-to-br from-pai-500 to-pai-700 flex items-center justify-center"
        style={{ width: size, height: size }}
        title={showTooltip ? "Jarvis Avatar (fallback)" : undefined}
      >
        <span className="text-white font-bold" style={{ fontSize: size * 0.5 }}>
          J
        </span>
      </div>
    );
  }

  return (
    <div
      className="relative rounded-lg overflow-hidden transition-all duration-300 hover:scale-105"
      style={{ width: size, height: size }}
      title={showTooltip ? tooltipText : undefined}
    >
      <img
        src={avatarUrl}
        alt={tooltipText}
        className="w-full h-full object-cover transition-opacity duration-300"
        style={{ opacity: imageLoaded ? 1 : 0 }}
        onLoad={() => setImageLoaded(true)}
        onError={() => setImageError(true)}
      />

      {/* Loading state */}
      {!imageLoaded && !imageError && (
        <div className="absolute inset-0 bg-muted animate-pulse" />
      )}
    </div>
  );
}
