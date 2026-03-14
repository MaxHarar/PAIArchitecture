/**
 * Sentinel Gateway — Context Window Management
 *
 * Manages conversation history with smart compression for long-running sessions.
 * Non-compressible turns (security rules, autonomy framework) survive all compression.
 * Persistence is handled by state.ts — this module keeps the in-memory structure.
 */

import type { ChannelId } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  /** Unique turn index (monotonically increasing) */
  index: number;
  /** Who said it */
  role: "user" | "assistant" | "system";
  /** The content */
  content: string;
  /** Metadata */
  metadata: TurnMetadata;
  /** Timestamp */
  timestamp: number;
}

export interface TurnMetadata {
  /** If false, this turn MUST survive compression (security rules, etc.) */
  compressible: boolean;
  /** Source channel */
  channel: ChannelId;
  /** Whether this turn has been compressed into a summary */
  compressed?: boolean;
  /** Original turn count if this is a compressed summary */
  summarizedTurnCount?: number;
}

// ---------------------------------------------------------------------------
// Context Manager
// ---------------------------------------------------------------------------

export class ContextManager {
  private turns: ConversationTurn[] = [];
  private nextIndex = 0;
  private maxVerbatimTurns: number;

  constructor(maxVerbatimTurns = 30) {
    this.maxVerbatimTurns = maxVerbatimTurns;
  }

  /**
   * Add a conversation turn to history.
   */
  addTurn(
    role: "user" | "assistant" | "system",
    content: string,
    metadata: { compressible: boolean; channel: ChannelId }
  ): void {
    this.turns.push({
      index: this.nextIndex++,
      role,
      content,
      metadata: {
        compressible: metadata.compressible,
        channel: metadata.channel,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Build the context window for the next Claude call.
   *
   * Strategy:
   * 1. Non-compressible system turns are ALWAYS included (security, autonomy rules)
   * 2. Last `maxVerbatimTurns` turns kept verbatim
   * 3. Older compressible turns summarized into a single compressed block
   * 4. Autonomy/security rules re-injected as the most recent system message
   *
   * @param maxTokens - Optional token budget (rough estimate: 4 chars = 1 token)
   * @returns Ordered conversation turns for the Claude call
   */
  buildContext(maxTokens?: number): ConversationTurn[] {
    const result: ConversationTurn[] = [];

    // Step 1: Collect ALL non-compressible system turns
    const permanentTurns = this.turns.filter(
      (t) => !t.metadata.compressible && t.role === "system"
    );

    // Step 2: Get the tail of conversation (last N turns)
    const recentCutoff = Math.max(0, this.turns.length - this.maxVerbatimTurns);
    const recentTurns = this.turns.slice(recentCutoff);

    // Step 3: Compress older compressible turns into a summary block
    const olderTurns = this.turns
      .slice(0, recentCutoff)
      .filter((t) => t.metadata.compressible);

    if (olderTurns.length > 0) {
      const summary = this.compressTurns(olderTurns);
      result.push({
        index: -1,
        role: "system",
        content: `[Compressed context — ${olderTurns.length} earlier turns]\n${summary}`,
        metadata: {
          compressible: true,
          channel: "system",
          compressed: true,
          summarizedTurnCount: olderTurns.length,
        },
        timestamp: olderTurns[0]!.timestamp,
      });
    }

    // Step 4: Add permanent system turns (deduplicated from recent)
    const recentIndices = new Set(recentTurns.map((t) => t.index));
    for (const turn of permanentTurns) {
      if (!recentIndices.has(turn.index)) {
        result.push(turn);
      }
    }

    // Step 5: Add recent turns verbatim
    result.push(...recentTurns);

    // Step 6: Apply token budget if specified
    if (maxTokens) {
      return this.trimToTokenBudget(result, maxTokens);
    }

    return result;
  }

  /**
   * Summarize the last N turns into a human-readable string.
   * Used for soul prompt injection.
   */
  getRecentSummary(n = 5): string {
    const recent = this.turns.slice(-n);
    if (recent.length === 0) return "";

    return recent
      .map((t) => {
        const channelTag =
          t.metadata.channel !== "system" ? ` [${t.metadata.channel}]` : "";
        const preview =
          t.content.length > 200
            ? t.content.slice(0, 200) + "..."
            : t.content;
        return `${t.role.toUpperCase()}${channelTag}: ${preview}`;
      })
      .join("\n");
  }

  /**
   * Total number of turns in history.
   */
  getTurnCount(): number {
    return this.turns.length;
  }

  /**
   * Get raw turns array (for persistence by state.ts).
   */
  getTurns(): ConversationTurn[] {
    return this.turns;
  }

  /**
   * Load turns from persistence (called by state.ts on startup).
   */
  loadTurns(turns: ConversationTurn[]): void {
    this.turns = turns;
    this.nextIndex =
      turns.length > 0 ? Math.max(...turns.map((t) => t.index)) + 1 : 0;
  }

  /**
   * Clear all turns (used on session rotation).
   */
  clear(): void {
    this.turns = [];
    this.nextIndex = 0;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Compress a set of turns into a summary string.
   *
   * This is a LOCAL compression (no LLM call) — extracts key information
   * from the conversation to maintain continuity. For a production system,
   * you would call Claude to summarize, but that adds latency and cost.
   */
  private compressTurns(turns: ConversationTurn[]): string {
    const lines: string[] = [];

    // Group by rough time windows (1-hour blocks)
    const HOUR_MS = 60 * 60 * 1000;
    let currentWindowStart = turns[0]!.timestamp;
    let windowTurns: ConversationTurn[] = [];

    for (const turn of turns) {
      if (turn.timestamp - currentWindowStart > HOUR_MS) {
        // Summarize previous window
        if (windowTurns.length > 0) {
          lines.push(this.summarizeWindow(windowTurns));
        }
        currentWindowStart = turn.timestamp;
        windowTurns = [turn];
      } else {
        windowTurns.push(turn);
      }
    }

    // Summarize last window
    if (windowTurns.length > 0) {
      lines.push(this.summarizeWindow(windowTurns));
    }

    return lines.join("\n");
  }

  /**
   * Summarize a time window of turns into a brief line.
   */
  private summarizeWindow(turns: ConversationTurn[]): string {
    const time = new Date(turns[0]!.timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const userTurns = turns.filter((t) => t.role === "user");
    const assistantTurns = turns.filter((t) => t.role === "assistant");
    const channels = [
      ...new Set(
        userTurns.map((t) => t.metadata.channel).filter((c) => c !== "system")
      ),
    ];

    // Extract topic hints from user messages (first 80 chars of each)
    const topics = userTurns
      .map((t) => {
        const cleaned = t.content.replace(/\s+/g, " ").trim();
        return cleaned.length > 80 ? cleaned.slice(0, 80) + "..." : cleaned;
      })
      .join("; ");

    const channelStr = channels.length > 0 ? ` via ${channels.join(",")}` : "";
    return `[${time}${channelStr}] ${userTurns.length} msgs, ${assistantTurns.length} responses. Topics: ${topics || "N/A"}`;
  }

  /**
   * Trim context to fit within a token budget.
   * Rough estimate: 1 token ~= 4 characters.
   */
  private trimToTokenBudget(
    turns: ConversationTurn[],
    maxTokens: number
  ): ConversationTurn[] {
    const CHARS_PER_TOKEN = 4;
    const maxChars = maxTokens * CHARS_PER_TOKEN;

    let totalChars = 0;
    for (const turn of turns) {
      totalChars += turn.content.length;
    }

    if (totalChars <= maxChars) return turns;

    // Keep non-compressible turns, trim from the oldest compressible ones
    const result: ConversationTurn[] = [];
    let budget = maxChars;

    // First pass: reserve space for non-compressible turns
    const nonCompressible = turns.filter((t) => !t.metadata.compressible);
    for (const turn of nonCompressible) {
      budget -= turn.content.length;
    }

    // Second pass: add compressible turns from most recent backwards
    const compressible = turns.filter((t) => t.metadata.compressible);
    const included: ConversationTurn[] = [];

    for (let i = compressible.length - 1; i >= 0; i--) {
      const turn = compressible[i]!;
      if (budget >= turn.content.length) {
        included.unshift(turn);
        budget -= turn.content.length;
      }
    }

    // Merge: non-compressible + included compressible, sorted by index
    result.push(...nonCompressible, ...included);
    result.sort((a, b) => a.index - b.index);

    return result;
  }
}
