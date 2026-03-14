/**
 * Sentinel Gateway — Brain Module
 *
 * Persistent Claude session wrapper using the Agent SDK V1 query() function.
 * Maintains a long-running session with automatic rotation every 24 hours,
 * context management, token tracking, and event emission for tool interception.
 */

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { EventEmitter } from "events";
import { homedir } from "os";
import type {
  GatewayConfig,
  GatewayMessage,
  GatewayResponse,
  SessionState,
  TokenUsage,
  ToolCallEvent,
} from "./types";
import { ContextManager } from "./context";
import { buildSoulPrompt } from "./soul";
import { MemoryExtractor } from "./memory-extractor";

// ---------------------------------------------------------------------------
// Cost estimation constants (Sonnet 4.5 pricing as of 2025)
// ---------------------------------------------------------------------------

const COST_PER_INPUT_TOKEN = 3.0 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 15.0 / 1_000_000;
const COST_PER_CACHE_READ = 0.3 / 1_000_000;
const COST_PER_CACHE_WRITE = 3.75 / 1_000_000;

// ---------------------------------------------------------------------------
// Event types emitted by SentinelBrain
// ---------------------------------------------------------------------------

export interface BrainEvents {
  response: (messageId: string, content: string) => void;
  tool_call: (event: ToolCallEvent) => void;
  error: (error: Error, messageId?: string) => void;
  session_rotated: (oldSessionId: string | null, newSessionId: string) => void;
}

// ---------------------------------------------------------------------------
// SentinelBrain
// ---------------------------------------------------------------------------

export class SentinelBrain extends EventEmitter {
  private config: GatewayConfig;
  private context: ContextManager;
  private sessionId: string | null = null;
  private sessionCreatedAt: number = Date.now();
  private lastActiveAt: number = Date.now();
  private messageCount = 0;
  private totalTokens = 0;
  private cumulativeUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUSD: 0,
  };
  private isProcessing = false;
  private abortController: AbortController | null = null;
  private sessionFilePath: string;
  private memoryExtractor: MemoryExtractor;

  constructor(config: GatewayConfig) {
    super();
    this.config = config;
    this.context = new ContextManager(config.maxVerbatimTurns);
    this.sessionFilePath = `${config.workspacePath}/gateway-session.json`;
    this.memoryExtractor = new MemoryExtractor({
      memoriesPath: `${homedir()}/.claude/Gateway/memory/brain-memories.jsonl`,
      memoryMdPath: `${homedir()}/.claude/projects/-Users-maxharar--claude/memory/MEMORY.md`,
    });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Main entry point: send a message to the persistent Claude session.
   * Handles context building, session rotation, streaming, and token tracking.
   */
  async sendMessage(msg: GatewayMessage): Promise<GatewayResponse> {
    // Check if session needs rotation (> 24h old)
    if (this.shouldRotate()) {
      await this.rotateSession();
    }

    this.isProcessing = true;
    this.lastActiveAt = Date.now();

    // Add user turn to context
    this.context.addTurn("user", msg.content, {
      compressible: true,
      channel: msg.channel,
    });

    try {
      const result = await this.executeQuery(msg);

      // Add assistant turn to context
      this.context.addTurn("assistant", result.content, {
        compressible: true,
        channel: msg.channel,
      });

      this.messageCount++;

      const response: GatewayResponse = {
        messageId: msg.id,
        channel: msg.channel,
        content: result.content,
        toolCallsMade: result.toolCallsMade,
        usage: this.getLastUsage(),
        timestamp: new Date().toISOString(),
      };

      this.emit("response", msg.id, result.content);

      // Non-blocking memory extraction — fire and forget
      queueMicrotask(() => {
        this.memoryExtractor
          .extract(msg.content, result.content, this.sessionId || "unknown")
          .catch((err) =>
            console.warn(`[Brain] Memory extraction failed: ${err}`)
          );
      });

      return response;
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error(String(error));
      this.emit("error", err, msg.id);
      throw err;
    } finally {
      this.isProcessing = false;
      this.abortController = null;
    }
  }

  /**
   * Resume an existing session from a stored sessionId.
   */
  async resumeSession(): Promise<void> {
    try {
      const file = Bun.file(this.sessionFilePath);
      if (await file.exists()) {
        const data = JSON.parse(await file.text()) as {
          sessionId: string;
          createdAt: number;
          messageCount: number;
          totalTokens: number;
        };
        this.sessionId = data.sessionId;
        this.sessionCreatedAt = data.createdAt;
        this.messageCount = data.messageCount || 0;
        this.totalTokens = data.totalTokens || 0;
        this.lastActiveAt = Date.now();
        console.log(
          `[Brain] Resumed session ${this.sessionId?.slice(0, 8)}... (${this.messageCount} msgs, created ${new Date(this.sessionCreatedAt).toISOString()})`
        );
      } else {
        console.log("[Brain] No saved session found — will start fresh");
      }
    } catch (error) {
      console.warn(`[Brain] Failed to resume session: ${error}`);
    }
  }

  /**
   * Rotate the session: archive the old one, start fresh with compressed context.
   */
  async rotateSession(): Promise<void> {
    const oldSessionId = this.sessionId;
    const summary = this.context.getRecentSummary(10);

    console.log(
      `[Brain] Rotating session. Old: ${oldSessionId?.slice(0, 8) || "none"}, age: ${Math.round((Date.now() - this.sessionCreatedAt) / 3600000)}h, msgs: ${this.messageCount}`
    );

    // Extract session summary into long-term memory before clearing
    if (summary) {
      queueMicrotask(() => {
        this.memoryExtractor
          .extractSessionSummary(oldSessionId || "unknown", summary)
          .catch((err) =>
            console.warn(`[Brain] Session summary extraction failed: ${err}`)
          );
      });
    }

    // Clear context but preserve any non-compressible system turns
    const turnsBeforeReset = this.context.getTurns().filter(
      (t) => !t.metadata.compressible
    );

    this.context.clear();

    // Re-inject non-compressible turns
    for (const turn of turnsBeforeReset) {
      this.context.addTurn(turn.role, turn.content, {
        compressible: false,
        channel: turn.metadata.channel,
      });
    }

    // Inject compressed summary of previous session
    if (summary) {
      this.context.addTurn(
        "system",
        `[Previous session summary — ${this.messageCount} messages over ${Math.round((Date.now() - this.sessionCreatedAt) / 3600000)}h]\n${summary}`,
        { compressible: true, channel: "system" }
      );
    }

    // Reset session state
    this.sessionId = null;
    this.sessionCreatedAt = Date.now();
    this.messageCount = 0;
    this.totalTokens = 0;
    this.cumulativeUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUSD: 0,
    };

    if (oldSessionId) {
      // New sessionId will be captured on the next query()
      this.emit("session_rotated", oldSessionId, "pending");
    }

    this.persistSession();
  }

  /**
   * Whether the session is alive (has a sessionId and is not stale).
   */
  isAlive(): boolean {
    return this.sessionId !== null;
  }

  /**
   * Get current session state snapshot.
   */
  getState(): SessionState {
    return {
      sessionId: this.sessionId,
      createdAt: this.sessionCreatedAt,
      lastActiveAt: this.lastActiveAt,
      messageCount: this.messageCount,
      totalTokens: this.totalTokens,
      isProcessing: this.isProcessing,
      pid: process.pid,
    };
  }

  /**
   * Clean shutdown: abort any running query, persist state.
   */
  async destroy(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.persistSession();
    this.isProcessing = false;
    console.log("[Brain] Destroyed. Session persisted.");
  }

  /**
   * Get the context manager (for external injection of system turns).
   */
  getContext(): ContextManager {
    return this.context;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Execute a Claude query with streaming, tool call emission, and token tracking.
   */
  private async executeQuery(
    msg: GatewayMessage
  ): Promise<{ content: string; toolCallsMade: boolean }> {
    // Build system prompt with recent context
    const recentSummary = this.context.getRecentSummary(5);
    const systemPrompt = buildSoulPrompt(recentSummary || undefined);

    // Find Claude CLI executable (same logic as Telegram bot)
    const claudePath = process.env.CLAUDE_CODE_PATH
      || Bun.which("claude")
      || `${homedir()}/.local/bin/claude`;

    // Build SDK options
    const options: Options = {
      model: this.config.claudeModel,
      cwd: this.config.claudeWorkDir,
      settingSources: ["user", "project"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      systemPrompt,
      resume: this.sessionId || undefined,
      pathToClaudeCodeExecutable: claudePath,
    };

    this.abortController = new AbortController();

    const responseParts: string[] = [];
    let lastUsage: TokenUsage | null = null;
    let toolCallsMade = false;

    try {
      const queryInstance = query({
        prompt: msg.content,
        options: {
          ...options,
          abortController: this.abortController,
        },
      });

      for await (const event of queryInstance) {
        // Abort check
        if (this.abortController?.signal.aborted) {
          console.log("[Brain] Query aborted");
          break;
        }

        // Capture session_id from first event
        if (!this.sessionId && event.session_id) {
          this.sessionId = event.session_id;
          console.log(
            `[Brain] Got session_id: ${this.sessionId!.slice(0, 8)}...`
          );
          this.persistSession();
        }

        // Handle assistant messages
        if (event.type === "assistant") {
          for (const block of event.message.content) {
            // Text content
            if (block.type === "text") {
              responseParts.push(block.text);
            }

            // Tool calls — emit for the security interceptor
            if (block.type === "tool_use") {
              toolCallsMade = true;
              const toolEvent: ToolCallEvent = {
                tool: block.name,
                args: (block.input as Record<string, unknown>) || {},
                sourceChannel: msg.channel,
                sourceTrust: msg.trust,
              };
              this.emit("tool_call", toolEvent);
            }
          }
        }

        // Result — capture usage
        if (event.type === "result") {
          if ("usage" in event && event.usage) {
            const u = event.usage as Record<string, number>;
            lastUsage = {
              inputTokens: u.input_tokens || 0,
              outputTokens: u.output_tokens || 0,
              cacheReadTokens: u.cache_read_input_tokens || 0,
              cacheWriteTokens: u.cache_creation_input_tokens || 0,
            };
            lastUsage.estimatedCostUSD = this.estimateCost(lastUsage);
            this.accumulateUsage(lastUsage);

            console.log(
              `[Brain] Usage: in=${lastUsage.inputTokens} out=${lastUsage.outputTokens} cost=$${lastUsage.estimatedCostUSD?.toFixed(4)}`
            );
          }
        }
      }
    } catch (error) {
      const errStr = String(error).toLowerCase();
      // Suppress abort/cancel errors if we have a response
      if (
        (errStr.includes("abort") || errStr.includes("cancel")) &&
        responseParts.length > 0
      ) {
        console.warn(`[Brain] Suppressed post-response error: ${error}`);
      } else {
        throw error;
      }
    }

    // Store last usage for response object
    this._lastUsage = lastUsage;

    return {
      content: responseParts.join("") || "No response generated.",
      toolCallsMade,
    };
  }

  private _lastUsage: TokenUsage | null = null;

  private getLastUsage(): TokenUsage | undefined {
    return this._lastUsage || undefined;
  }

  /**
   * Check if the session should be rotated based on age.
   */
  private shouldRotate(): boolean {
    if (!this.sessionId) return false;
    return Date.now() - this.sessionCreatedAt > this.config.sessionRotationMs;
  }

  /**
   * Estimate USD cost from token usage.
   */
  private estimateCost(usage: TokenUsage): number {
    return (
      usage.inputTokens * COST_PER_INPUT_TOKEN +
      usage.outputTokens * COST_PER_OUTPUT_TOKEN +
      (usage.cacheReadTokens || 0) * COST_PER_CACHE_READ +
      (usage.cacheWriteTokens || 0) * COST_PER_CACHE_WRITE
    );
  }

  /**
   * Accumulate token usage into cumulative totals.
   */
  private accumulateUsage(usage: TokenUsage): void {
    this.cumulativeUsage.inputTokens += usage.inputTokens;
    this.cumulativeUsage.outputTokens += usage.outputTokens;
    this.cumulativeUsage.cacheReadTokens =
      (this.cumulativeUsage.cacheReadTokens || 0) +
      (usage.cacheReadTokens || 0);
    this.cumulativeUsage.cacheWriteTokens =
      (this.cumulativeUsage.cacheWriteTokens || 0) +
      (usage.cacheWriteTokens || 0);
    this.cumulativeUsage.estimatedCostUSD =
      (this.cumulativeUsage.estimatedCostUSD || 0) +
      (usage.estimatedCostUSD || 0);

    this.totalTokens += usage.inputTokens + usage.outputTokens;
  }

  /**
   * Persist session state to disk for restart recovery.
   */
  private persistSession(): void {
    try {
      const data = {
        sessionId: this.sessionId,
        createdAt: this.sessionCreatedAt,
        messageCount: this.messageCount,
        totalTokens: this.totalTokens,
        cumulativeUsage: this.cumulativeUsage,
        savedAt: new Date().toISOString(),
      };
      Bun.write(this.sessionFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn(`[Brain] Failed to persist session: ${error}`);
    }
  }
}
