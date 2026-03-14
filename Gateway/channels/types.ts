/**
 * Sentinel Gateway -- Channel Adapter Interface
 *
 * Every inbound channel (Telegram, heartbeat, webhooks) implements this
 * interface. The gateway routes requests through the appropriate adapter
 * based on the channel identifier.
 *
 * Auth logic lives in ../auth.ts. Injection defense in ../injection.ts.
 * Channel adapters are intentionally thin — they normalize messages and
 * delegate security to the centralized modules.
 */

import type {
  ChannelId,
  ChannelTrust,
  GatewayMessage,
  GatewayResponse,
} from "../types.ts";

export interface ChannelAdapter {
  /** Unique channel identifier */
  name: ChannelId;

  /** Trust level assigned to this channel */
  trust: ChannelTrust;

  /**
   * Parse an incoming HTTP request into a normalized GatewayMessage.
   * Returns null if the request is malformed or should be ignored.
   */
  parseMessage(req: Request): Promise<GatewayMessage | null>;

  /**
   * Send a response back through this channel.
   * Some channels (webhooks, heartbeat) may no-op here.
   */
  sendResponse(response: GatewayResponse): Promise<void>;

  /**
   * Channel-specific authentication validation.
   * Called AFTER the gateway's central auth layer (auth.ts) passes.
   * This handles channel-specific checks (e.g., Telegram chat_id verification).
   */
  validateAuth(req: Request): Promise<boolean>;
}
