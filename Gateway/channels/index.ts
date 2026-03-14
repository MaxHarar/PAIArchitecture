/**
 * Sentinel Gateway -- Channel Registry
 *
 * Central registry for all channel adapters. The gateway routes
 * incoming requests through the appropriate adapter based on
 * the channel identifier from auth.ts.
 */

import type { ChannelId } from "../types.ts";
import type { ChannelAdapter } from "./types.ts";
import { TelegramAdapter } from "./telegram.ts";
import { HeartbeatAdapter } from "./heartbeat.ts";
import { WebhookAdapter } from "./webhook.ts";

// ---------------------------------------------------------------------------
// Adapter Instances (singletons)
// ---------------------------------------------------------------------------

const telegramAdapter = new TelegramAdapter();
const heartbeatAdapter = new HeartbeatAdapter();
const webhookAdapter = new WebhookAdapter();

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Map of channel IDs to their adapter instances.
 * External webhook sources (gmail, sentry, etc.) all route through
 * the single WebhookAdapter which handles source detection internally.
 */
const adapters = new Map<ChannelId, ChannelAdapter>([
  ["telegram", telegramAdapter],
  ["heartbeat", heartbeatAdapter],
  ["webhook", webhookAdapter],
  ["gmail", webhookAdapter],
  ["x-twitter", webhookAdapter],
  ["sentry", webhookAdapter],
  ["vercel", webhookAdapter],
]);

/**
 * Get the channel adapter for a given channel ID.
 * Returns undefined if no adapter is registered for the channel.
 */
export function getAdapter(channel: ChannelId): ChannelAdapter | undefined {
  return adapters.get(channel);
}

/**
 * Get all unique channel adapters.
 * (Deduplicates the webhook adapter which is registered under multiple IDs.)
 */
export function getAllAdapters(): ChannelAdapter[] {
  return [...new Set(adapters.values())];
}

// Re-export for convenience
export type { ChannelAdapter } from "./types.ts";
export { TelegramAdapter } from "./telegram.ts";
export { HeartbeatAdapter } from "./heartbeat.ts";
export { WebhookAdapter } from "./webhook.ts";
