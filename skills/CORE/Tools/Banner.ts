#!/usr/bin/env bun

/**
 * Sentinel Banner — Terminal HUD Interface
 * Matches Sentinel Dashboard aesthetic: cyan on void, boot-sequence style
 *
 * Responsive: Full (85+) → Medium (70+) → Compact (55+) → Minimal (45+) → Ultra (<45)
 */

import { readFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const HOME = process.env.HOME!;
const CLAUDE_DIR = join(HOME, ".claude");

// ═══════════════════════════════════════════════════════════════════════════
// Terminal Width Detection
// ═══════════════════════════════════════════════════════════════════════════

function getTerminalWidth(): number {
  // Fast path: process.stdout.columns is zero-cost
  if (process.stdout.columns && process.stdout.columns > 0) {
    return process.stdout.columns;
  }

  let width: number | null = null;

  const kittyWindowId = process.env.KITTY_WINDOW_ID;
  if (kittyWindowId) {
    try {
      const result = spawnSync("kitten", ["@", "ls"], { encoding: "utf-8" });
      if (result.stdout) {
        const data = JSON.parse(result.stdout);
        for (const osWindow of data) {
          for (const tab of osWindow.tabs) {
            for (const win of tab.windows) {
              if (win.id === parseInt(kittyWindowId)) {
                width = win.columns;
                break;
              }
            }
          }
        }
      }
    } catch {}
  }

  if (!width || width <= 0) {
    try {
      const result = spawnSync("sh", ["-c", "stty size </dev/tty 2>/dev/null"], { encoding: "utf-8" });
      if (result.stdout) {
        const cols = parseInt(result.stdout.trim().split(/\s+/)[1]);
        if (cols > 0) width = cols;
      }
    } catch {}
  }

  if (!width || width <= 0) {
    try {
      const result = spawnSync("tput", ["cols"], { encoding: "utf-8" });
      if (result.stdout) {
        const cols = parseInt(result.stdout.trim());
        if (cols > 0) width = cols;
      }
    } catch {}
  }

  if (!width || width <= 0) {
    width = parseInt(process.env.COLUMNS || "100") || 100;
  }

  return width;
}

// ═══════════════════════════════════════════════════════════════════════════
// ANSI Helpers
// ═══════════════════════════════════════════════════════════════════════════

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const ITALIC = "\x1b[3m";

const rgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;

// Box drawing (only h and v used in Sentinel banner)
const BOX = {
  h: "\u2500", v: "\u2502",
};

// Reticle corners (heavy)
const RETICLE = {
  tl: "\u250F", // ┏
  tr: "\u2513", // ┓
  bl: "\u2517", // ┗
  br: "\u251B", // ┛
  h: "\u2501",  // ━
};

// ═══════════════════════════════════════════════════════════════════════════
// Sentinel Design System (from Sentinel Dashboard globals.css)
// ═══════════════════════════════════════════════════════════════════════════

const SC = {
  // Primary cyan spectrum
  cyan:       rgb(0, 212, 255),     // #00D4FF — primary brand
  cyanBright: rgb(51, 223, 255),    // #33DFFF — bright accent
  cyanDim:    rgb(0, 153, 187),     // #0099BB — muted cyan

  // Text hierarchy
  text:       rgb(224, 240, 255),   // #E0F0FF — primary text
  muted:      rgb(107, 138, 173),   // #6B8AAD — secondary text

  // Border
  border:     rgb(0, 70, 90),       // frame borders (approx sentinel-border)

  // Status
  online:     rgb(34, 197, 94),     // #22c55e — green
};

// ═══════════════════════════════════════════════════════════════════════════
// Stats Collection
// ═══════════════════════════════════════════════════════════════════════════

interface SystemStats {
  name: string;
  catchphrase: string;
  repoUrl: string;
  skills: number;
  workflows: number;
  hooks: number;
  paiVersion: string;
  algorithmVersion: string;
}

function getStats(): SystemStats {
  let name = "Sentinel";
  let paiVersion = "3.0";
  let algorithmVersion = "0.2";
  let catchphrase = "Jarvis here, ready to go.";
  let repoUrl = "github.com/MaxHarar/PAIArchitecture";
  let skills = 0, workflows = 0, hooks = 0;

  // Single settings.json read for all fields
  try {
    const settings = JSON.parse(readFileSync(join(CLAUDE_DIR, "settings.json"), "utf-8"));
    name = settings.daidentity?.displayName || settings.daidentity?.name || "Sentinel";
    paiVersion = settings.pai?.version || "2.0";
    catchphrase = settings.daidentity?.startupCatchphrase || catchphrase;
    repoUrl = settings.pai?.repoUrl || repoUrl;
    if (settings.counts) {
      skills = settings.counts.skills || 0;
      workflows = settings.counts.workflows || 0;
      hooks = settings.counts.hooks || 0;
    }
  } catch {}

  try {
    const latestPath = join(CLAUDE_DIR, "skills/PAI/Components/Algorithm/LATEST");
    const latestContent = readFileSync(latestPath, "utf-8").trim();
    algorithmVersion = latestContent.replace(/^v/i, "");
  } catch {}

  catchphrase = catchphrase.replace(/\{name\}/gi, name);

  return { name, catchphrase, repoUrl, skills, workflows, hooks, paiVersion, algorithmVersion };
}

// ═══════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════

function visibleLength(str: string): number {
  return str.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padEnd(str: string, width: number): string {
  return str + " ".repeat(Math.max(0, width - visibleLength(str)));
}

function center(str: string, width: number): string {
  const visible = visibleLength(str);
  const left = Math.floor((width - visible) / 2);
  return " ".repeat(Math.max(0, left)) + str + " ".repeat(Math.max(0, width - visible - left));
}

// ═══════════════════════════════════════════════════════════════════════════
// Sentinel Shield Mark
// ═══════════════════════════════════════════════════════════════════════════

// Large shield: 20 wide × 10 tall
function getLargeShield(): string[] {
  const B = "\u2588"; // Full block
  return [
    // Top bar — bright scanline
    `${SC.cyanBright}${B.repeat(4)}${SC.cyan}${B.repeat(12)}${SC.cyanBright}${B.repeat(4)}${RESET}`,
    `${SC.cyanBright}${B.repeat(4)}${SC.cyan}${B.repeat(12)}${SC.cyanBright}${B.repeat(4)}${RESET}`,
    // Open frame
    `${SC.cyan}${B.repeat(4)}${RESET}            ${SC.cyan}${B.repeat(4)}${RESET}`,
    `${SC.cyan}${B.repeat(4)}${RESET}            ${SC.cyan}${B.repeat(4)}${RESET}`,
    // Inner core — bright sentinel eye
    `${SC.cyan}${B.repeat(4)}${RESET}  ${SC.cyanBright}${B.repeat(8)}${RESET}  ${SC.cyan}${B.repeat(4)}${RESET}`,
    `${SC.cyan}${B.repeat(4)}${RESET}  ${SC.cyanBright}${B.repeat(8)}${RESET}  ${SC.cyan}${B.repeat(4)}${RESET}`,
    // Open frame
    `${SC.cyan}${B.repeat(4)}${RESET}            ${SC.cyan}${B.repeat(4)}${RESET}`,
    // Bottom bar — dimming
    `${SC.cyanDim}${B.repeat(20)}${RESET}`,
    // Taper
    `    ${SC.cyanDim}${B.repeat(12)}${RESET}`,
    // Point
    `        ${SC.cyanDim}${B.repeat(4)}${RESET}`,
  ];
}

// Small shield: 10 wide × 5 tall
function getSmallShield(): string[] {
  const B = "\u2588";
  return [
    `${SC.cyanBright}${B.repeat(10)}${RESET}`,
    `${SC.cyan}${B.repeat(2)}${RESET}      ${SC.cyan}${B.repeat(2)}${RESET}`,
    `${SC.cyan}${B.repeat(2)}${RESET}  ${SC.cyanBright}${B.repeat(2)}${RESET}  ${SC.cyan}${B.repeat(2)}${RESET}`,
    `${SC.cyan}${B.repeat(2)}${RESET}      ${SC.cyan}${B.repeat(2)}${RESET}`,
    `${SC.cyanDim}${B.repeat(10)}${RESET}`,
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared Layout for Full + Medium Banners
// ═══════════════════════════════════════════════════════════════════════════

function buildInfoLines(stats: SystemStats): string[] {
  return [
    `${SC.muted}"${RESET}${ITALIC}${SC.cyan}${stats.catchphrase}${RESET}${SC.muted}"${RESET}`,
    `${SC.border}${BOX.h.repeat(24)}${RESET}`,
    `${SC.online}\u25C9${RESET}  ${SC.text}CORE${RESET}         ${BOLD}${SC.online}ONLINE${RESET}`,
    `${SC.cyan}\u25C9${RESET}  ${SC.text}NEURAL${RESET}       ${BOLD}${SC.cyan}ACTIVE${RESET}`,
    `${SC.border}${BOX.h.repeat(24)}${RESET}`,
    `${SC.cyanDim}\u2B22${RESET}  ${SC.muted}System${RESET}     ${SC.text}v${stats.paiVersion}${RESET}`,
    `${SC.cyanDim}\u2699${RESET}  ${SC.muted}Algorithm${RESET}  ${SC.text}v${stats.algorithmVersion}${RESET}`,
    `${SC.cyan}\u2726${RESET}  ${SC.muted}Skills${RESET}     ${BOLD}${SC.cyanBright}${stats.skills}${RESET}`,
    `${SC.cyan}\u21BB${RESET}  ${SC.muted}Workflows${RESET}  ${SC.text}${stats.workflows}${RESET}`,
    `${SC.cyanDim}\u21AA${RESET}  ${SC.muted}Hooks${RESET}      ${SC.text}${stats.hooks}${RESET}`,
  ];
}

function buildLargeBannerBody(stats: SystemStats, width: number, minPad: number): string[] {
  const logo = getLargeShield();
  const LOGO_WIDTH = 20;
  const SEPARATOR = `${SC.border}${BOX.v}${RESET}`;
  const infoLines = buildInfoLines(stats);

  const gap = "   ";
  const gapAfter = "  ";
  const totalContentWidth = LOGO_WIDTH + gap.length + 1 + gapAfter.length + 28;
  const leftPad = Math.floor((width - totalContentWidth) / 2);
  const pad = " ".repeat(Math.max(minPad, leftPad));
  const emptyLogoSpace = " ".repeat(LOGO_WIDTH);
  const logoTopPad = Math.ceil((infoLines.length - logo.length) / 2);

  const bodyLines: string[] = [];
  for (let i = 0; i < infoLines.length; i++) {
    const logoIndex = i - logoTopPad;
    const logoRow = (logoIndex >= 0 && logoIndex < logo.length) ? logo[logoIndex] : emptyLogoSpace;
    bodyLines.push(`${pad}${padEnd(logoRow, LOGO_WIDTH)}${gap}${SEPARATOR}${gapAfter}${infoLines[i]}`);
  }
  return bodyLines;
}

function buildHeader(stats: SystemStats, width: number): { headerLine: string; headerVisLen: number } {
  const nameStr = stats.name.length <= 10
    ? stats.name.toUpperCase().split("").join(" ")
    : stats.name.toUpperCase();
  return {
    headerLine: `${BOLD}${SC.cyan}${nameStr}${RESET}`,
    headerVisLen: nameStr.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FULL SENTINEL BANNER (85+ cols) — Frame + Shield + System Status
// ═══════════════════════════════════════════════════════════════════════════

function createSentinelBanner(stats: SystemStats, width: number): string {
  const { headerLine, headerVisLen } = buildHeader(stats, width);

  const frameWidth = 70;
  const framePad = " ".repeat(Math.floor((width - frameWidth) / 2));

  const lines: string[] = [""];

  // Top border
  lines.push(`${framePad}${SC.border}${RETICLE.tl}${RETICLE.h.repeat(frameWidth - 2)}${RETICLE.tr}${RESET}`);
  lines.push("");

  // Header + subtitle
  lines.push(`${" ".repeat(Math.floor((width - headerVisLen) / 2))}${headerLine}`);
  const subtitleText = "Personal AI Interface";
  lines.push(`${" ".repeat(Math.floor((width - subtitleText.length) / 2))}${SC.muted}${subtitleText}${RESET}`);
  lines.push("");

  // Body
  lines.push(...buildLargeBannerBody(stats, width, 2));
  lines.push("");

  // Footer URL
  const urlLine = `${SC.border}\u2192${RESET} ${SC.cyanDim}${stats.repoUrl}${RESET}`;
  const urlLen = stats.repoUrl.length + 3;
  lines.push(`${" ".repeat(Math.floor((width - urlLen) / 2))}${urlLine}`);
  lines.push("");

  // Bottom border
  lines.push(`${framePad}${SC.border}${RETICLE.bl}${RETICLE.h.repeat(frameWidth - 2)}${RETICLE.br}${RESET}`);
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// MEDIUM BANNER (70-84 cols) — No frame, full content
// ═══════════════════════════════════════════════════════════════════════════

function createSentinelMediumBanner(stats: SystemStats, width: number): string {
  const { headerLine, headerVisLen } = buildHeader(stats, width);

  const lines: string[] = [""];

  // Header (no frame)
  lines.push(`${" ".repeat(Math.max(0, Math.floor((width - headerVisLen) / 2)))}${headerLine}`);
  const subtitleText = "Personal AI Interface";
  lines.push(`${" ".repeat(Math.max(0, Math.floor((width - subtitleText.length) / 2)))}${SC.muted}${subtitleText}${RESET}`);
  lines.push("");

  // Body
  lines.push(...buildLargeBannerBody(stats, width, 1));

  lines.push("");
  const urlLine = `${SC.border}\u2192${RESET} ${SC.cyanDim}${stats.repoUrl}${RESET}`;
  const urlPad = " ".repeat(Math.max(0, Math.floor((width - stats.repoUrl.length - 3) / 2)));
  lines.push(`${urlPad}${urlLine}`);
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPACT BANNER (55-69 cols) — Small shield, condensed stats
// ═══════════════════════════════════════════════════════════════════════════

function createSentinelCompactBanner(stats: SystemStats, width: number): string {
  const logo = getSmallShield();
  const LOGO_WIDTH = 10;
  const SEPARATOR = `${SC.border}${BOX.v}${RESET}`;

  const shortCatchphrase = stats.catchphrase.length > 20
    ? stats.catchphrase.slice(0, 17) + "..."
    : stats.catchphrase;

  const infoLines = [
    `${SC.muted}"${RESET}${SC.cyan}${shortCatchphrase}${RESET}${SC.muted}"${RESET}`,
    `${SC.border}${BOX.h.repeat(18)}${RESET}`,
    `${SC.cyanDim}\u2B22${RESET} ${SC.muted}v${stats.paiVersion}${RESET} ${SC.cyanDim}\u2699${RESET} ${SC.text}v${stats.algorithmVersion}${RESET}`,
    `${SC.cyan}\u2726${RESET} ${SC.muted}SK${RESET} ${SC.cyanBright}${stats.skills}${RESET}  ${SC.cyan}\u21BB${RESET} ${SC.text}${stats.workflows}${RESET}  ${SC.cyanDim}\u21AA${RESET} ${SC.text}${stats.hooks}${RESET}`,
    `${SC.online}\u25C9${RESET} ${BOLD}${SC.online}ONLINE${RESET}`,
    `${SC.border}${BOX.h.repeat(18)}${RESET}`,
  ];

  const gap = "  ";
  const gapAfter = " ";
  const totalContentWidth = LOGO_WIDTH + gap.length + 1 + gapAfter.length + 20;
  const leftPad = Math.floor((width - totalContentWidth) / 2);
  const pad = " ".repeat(Math.max(1, leftPad));
  const emptyLogoSpace = " ".repeat(LOGO_WIDTH);
  const logoTopPad = Math.floor((infoLines.length - logo.length) / 2);

  const lines: string[] = [""];

  // Condensed header — no tracking at compact size
  const nameStr = stats.name.toUpperCase();
  const headerPad = " ".repeat(Math.max(0, Math.floor((width - nameStr.length) / 2)));
  lines.push(`${headerPad}${BOLD}${SC.cyan}${nameStr}${RESET}`);
  lines.push("");

  // Main content
  for (let i = 0; i < infoLines.length; i++) {
    const logoIndex = i - logoTopPad;
    const logoRow = (logoIndex >= 0 && logoIndex < logo.length) ? logo[logoIndex] : emptyLogoSpace;
    lines.push(`${pad}${padEnd(logoRow, LOGO_WIDTH)}${gap}${SEPARATOR}${gapAfter}${infoLines[i]}`);
  }
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// MINIMAL BANNER (45-54 cols) — Very condensed
// ═══════════════════════════════════════════════════════════════════════════

function createSentinelMinimalBanner(stats: SystemStats, width: number): string {
  const logo = getSmallShield();
  const LOGO_WIDTH = 10;

  const infoLines = [
    `${SC.cyan}${stats.name}${RESET}${SC.muted}@pai${RESET}`,
    `${SC.muted}v${stats.paiVersion}${RESET} ${SC.cyanDim}\u2699${RESET}${SC.text}v${stats.algorithmVersion}${RESET}`,
    `${SC.border}${BOX.h.repeat(14)}${RESET}`,
    `${SC.cyan}\u2726${RESET}${SC.text}${stats.skills}${RESET} ${SC.cyan}\u21BB${RESET}${SC.text}${stats.workflows}${RESET} ${SC.cyanDim}\u21AA${RESET}${SC.text}${stats.hooks}${RESET}`,
    ``,
  ];

  const gap = " ";
  const totalContentWidth = LOGO_WIDTH + gap.length + 16;
  const leftPad = Math.floor((width - totalContentWidth) / 2);
  const pad = " ".repeat(Math.max(1, leftPad));

  const lines: string[] = [""];

  for (let i = 0; i < logo.length; i++) {
    lines.push(`${pad}${padEnd(logo[i], LOGO_WIDTH)}${gap}${infoLines[i] || ""}`);
  }
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// ULTRA-COMPACT BANNER (<45 cols) — Text only
// ═══════════════════════════════════════════════════════════════════════════

function createSentinelUltraBanner(stats: SystemStats, width: number): string {
  const nameStr = `${BOLD}${SC.cyan}${stats.name.toUpperCase()}${RESET}`;

  const lines: string[] = [""];
  lines.push(center(nameStr, width));
  lines.push(center(`${SC.muted}v${stats.paiVersion}${RESET} ${SC.cyanDim}\u2699${RESET}${SC.text}v${stats.algorithmVersion}${RESET}`, width));
  lines.push(center(`${SC.border}${BOX.h.repeat(Math.min(20, width - 4))}${RESET}`, width));
  lines.push(center(`${SC.cyan}\u2726${RESET}${SC.text}${stats.skills}${RESET} ${SC.cyan}\u21BB${RESET}${SC.text}${stats.workflows}${RESET} ${SC.cyanDim}\u21AA${RESET}${SC.text}${stats.hooks}${RESET}`, width));
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Banner Selection — Width-based routing
// ═══════════════════════════════════════════════════════════════════════════

const BREAKPOINTS = {
  FULL: 85,
  MEDIUM: 70,
  COMPACT: 55,
  MINIMAL: 45,
};

type DesignName = "sentinel" | "sentinel-medium" | "sentinel-compact" | "sentinel-minimal" | "sentinel-ultra";
const ALL_DESIGNS: DesignName[] = ["sentinel", "sentinel-medium", "sentinel-compact", "sentinel-minimal", "sentinel-ultra"];

function createBanner(forceDesign?: string): string {
  const width = getTerminalWidth();
  const stats = getStats();

  if (forceDesign) {
    switch (forceDesign) {
      case "sentinel": return createSentinelBanner(stats, width);
      case "sentinel-medium": return createSentinelMediumBanner(stats, width);
      case "sentinel-compact": return createSentinelCompactBanner(stats, width);
      case "sentinel-minimal": return createSentinelMinimalBanner(stats, width);
      case "sentinel-ultra": return createSentinelUltraBanner(stats, width);
      // Legacy design names — backward compat
      case "navy": return createSentinelBanner(stats, width);
      case "navy-medium": return createSentinelMediumBanner(stats, width);
      case "navy-compact": return createSentinelCompactBanner(stats, width);
      case "navy-minimal": return createSentinelMinimalBanner(stats, width);
      case "navy-ultra": return createSentinelUltraBanner(stats, width);
      case "electric": return createSentinelBanner(stats, width);
      case "teal": return createSentinelBanner(stats, width);
      case "ice": return createSentinelBanner(stats, width);
    }
  }

  // Width-based responsive routing
  if (width >= BREAKPOINTS.FULL) return createSentinelBanner(stats, width);
  if (width >= BREAKPOINTS.MEDIUM) return createSentinelMediumBanner(stats, width);
  if (width >= BREAKPOINTS.COMPACT) return createSentinelCompactBanner(stats, width);
  if (width >= BREAKPOINTS.MINIMAL) return createSentinelMinimalBanner(stats, width);
  return createSentinelUltraBanner(stats, width);
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const testMode = args.includes("--test");
const designArg = args.find(a => a.startsWith("--design="))?.split("=")[1];

try {
  if (testMode) {
    for (const design of ALL_DESIGNS) {
      console.log(`\n${"═".repeat(60)}`);
      console.log(`  DESIGN: ${design.toUpperCase()}`);
      console.log(`${"═".repeat(60)}`);
      console.log(createBanner(design));
    }
  } else {
    console.log(createBanner(designArg));
  }
} catch (e) {
  console.error("Banner error:", e);
}
