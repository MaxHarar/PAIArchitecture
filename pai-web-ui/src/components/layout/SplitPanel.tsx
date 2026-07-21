"use client";

import * as React from "react";

interface SplitPanelProps {
  left: React.ReactNode;
  right: React.ReactNode;
  leftWidth?: number; // percentage
}

export function SplitPanel({ left, right, leftWidth = 40 }: SplitPanelProps) {
  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* Left panel - Chat */}
      <div
        className="border-r border-border overflow-hidden flex flex-col"
        style={{ width: `${leftWidth}%` }}
      >
        {left}
      </div>

      {/* Right panel - Activity */}
      <div
        className="overflow-hidden flex flex-col"
        style={{ width: `${100 - leftWidth}%` }}
      >
        {right}
      </div>
    </div>
  );
}
