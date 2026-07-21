/**
 * VoiceQueue - Manages speech output to prevent overlapping audio
 *
 * Features:
 * - FIFO queue for voice notifications
 * - Calls VoiceServer /notify endpoint
 * - Waits for speech completion before next item
 * - Supports skip/cancel current speech
 */

// Use Next.js API proxy to avoid CORS issues
const VOICE_SERVER_URL = "/api/voice";
const DEFAULT_VOICE_ID = "s3TPKV1kjDlVtZbl4Ksh"; // Kai - main assistant

interface QueueItem {
  id: string;
  message: string;
  voiceId?: string;
  priority?: number;
}

interface VoiceQueueState {
  isPlaying: boolean;
  currentItem: QueueItem | null;
  queueLength: number;
}

type StateListener = (state: VoiceQueueState) => void;

class VoiceQueueManager {
  private queue: QueueItem[] = [];
  private isPlaying = false;
  private currentItem: QueueItem | null = null;
  private abortController: AbortController | null = null;
  private listeners: Set<StateListener> = new Set();
  private enabled = true;

  /**
   * Add a message to the voice queue
   */
  enqueue(message: string, voiceId?: string, priority = 0): string {
    const id = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const item: QueueItem = {
      id,
      message,
      voiceId: voiceId || DEFAULT_VOICE_ID,
      priority,
    };

    // Insert based on priority (higher priority first)
    const insertIndex = this.queue.findIndex((q) => (q.priority || 0) < priority);
    if (insertIndex === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(insertIndex, 0, item);
    }

    this.notifyListeners();
    this.processQueue();

    return id;
  }

  /**
   * Skip the currently playing speech
   */
  skipCurrent(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isPlaying = false;
    this.currentItem = null;
    this.notifyListeners();
    this.processQueue();
  }

  /**
   * Clear all queued items (doesn't stop current playback)
   */
  clearQueue(): void {
    this.queue = [];
    this.notifyListeners();
  }

  /**
   * Clear all and stop current playback
   */
  stopAll(): void {
    this.clearQueue();
    this.skipCurrent();
  }

  /**
   * Enable or disable voice output
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopAll();
    }
  }

  /**
   * Check if voice is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get current queue state
   */
  getState(): VoiceQueueState {
    return {
      isPlaying: this.isPlaying,
      currentItem: this.currentItem,
      queueLength: this.queue.length,
    };
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    // Immediately notify with current state
    listener(this.getState());

    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  private async processQueue(): Promise<void> {
    if (!this.enabled || this.isPlaying || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.isPlaying = true;
    this.currentItem = item;
    this.notifyListeners();

    try {
      await this.speak(item);
    } catch (error) {
      console.error("Voice playback error:", error);
    } finally {
      this.isPlaying = false;
      this.currentItem = null;
      this.abortController = null;
      this.notifyListeners();

      // Process next item
      this.processQueue();
    }
  }

  private async speak(item: QueueItem): Promise<void> {
    this.abortController = new AbortController();

    try {
      const response = await fetch(`${VOICE_SERVER_URL}/notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: item.message,
          voice_id: item.voiceId,
          voice_enabled: true,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        // If VoiceServer isn't running, fail silently
        if (data.silent) {
          console.log("VoiceServer not running - skipping voice output");
          return;
        }
        throw new Error(`VoiceServer responded with ${response.status}`);
      }

      const data = await response.json();

      // Wait for the estimated speech duration
      // VoiceServer returns duration in seconds
      const durationMs = (data.duration || estimateDuration(item.message)) * 1000;

      await this.waitWithAbort(durationMs);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // Skipped - not an error
        return;
      }
      // Log but don't throw - voice is non-critical
      console.error("Voice playback error (non-fatal):", error);
    }
  }

  private waitWithAbort(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);

      if (this.abortController) {
        this.abortController.signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new DOMException("Aborted", "AbortError"));
        });
      }
    });
  }
}

/**
 * Estimate speech duration based on message length
 * Average speaking rate: ~150 words per minute
 */
function estimateDuration(message: string): number {
  const words = message.split(/\s+/).length;
  const wordsPerSecond = 150 / 60; // 2.5 words per second
  return Math.max(1, words / wordsPerSecond);
}

// Singleton instance
export const voiceQueue = new VoiceQueueManager();

// React hook for using voice queue
export function useVoiceQueue() {
  return voiceQueue;
}
