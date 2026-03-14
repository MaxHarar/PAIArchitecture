/**
 * PAI Autonomy Framework
 *
 * Three-tier escalation system that governs what Sentinel can do independently
 * vs. what requires Max's explicit approval.
 *
 * Levels:
 *   AUTONOMOUS  - Sentinel does it without asking
 *   ASK_FIRST   - Sentinel asks Max via Telegram and waits for approval
 *   NEVER       - Hard block, cannot be overridden
 */

import { logEscalation } from "./logger.ts";

// ---------------------------------------------------------------------------
// Action classifications
// ---------------------------------------------------------------------------

const AUTONOMOUS_PATTERNS: RegExp[] = [
  /read.*(email|mail|inbox)/i,
  /check.*(mention|notification|alert)/i,
  /monitor.*(site|service|endpoint|url)/i,
  /generate.*(report|summary|brief)/i,
  /read.*(log|metric|stat)/i,
  /internal.*(analysis|review)/i,
  /fetch.*(weather|news|data)/i,
  /search.*(note|file|doc)/i,
  /summarize/i,
  /list.*(task|item|project)/i,
  /query.*(fitness|health|garmin)/i,
  /draft/i,
  /log.*(action|metric|entry)/i,
  /send.*(briefing|checkin|recap|notification)/i,
];

const ASK_FIRST_PATTERNS: RegExp[] = [
  /deploy.*(prod|production|live)/i,
  /send.*(email|message).*(to|external)/i,
  /post.*(twitter|x\.com|social)/i,
  /create.*(repo|repository)/i,
  /delete.*(repo|repository)/i,
  /spend|purchase|buy|subscribe/i,
  /modify.*(config|setting|pai)/i,
  /push.*(git|code|branch)/i,
  /merge.*(pr|pull)/i,
  /publish/i,
  /move.*(calendar|event)/i,
  /cancel.*(event|meeting)/i,
  /change.*(training|plan)/i,
];

const NEVER_PATTERNS: RegExp[] = [
  /delete.*(user.*data|database|all)/i,
  /force.*push.*(main|master)/i,
  /financial.*transaction/i,
  /transfer.*(money|fund|payment)/i,
  /modify.*(security|auth|credential|password|key)/i,
  /rm\s+-rf/i,
  /drop.*(table|database)/i,
  /format.*(disk|drive)/i,
];

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type AutonomyLevel = "autonomous" | "ask_first" | "never";

/**
 * Classify an action into an autonomy level.
 *
 * NEVER is checked first (hard block), then ASK_FIRST, then AUTONOMOUS.
 * Unknown actions default to ASK_FIRST for safety.
 */
export function canDo(action: string): AutonomyLevel {
  // NEVER takes absolute priority
  for (const pattern of NEVER_PATTERNS) {
    if (pattern.test(action)) return "never";
  }

  // ASK_FIRST next
  for (const pattern of ASK_FIRST_PATTERNS) {
    if (pattern.test(action)) return "ask_first";
  }

  // AUTONOMOUS only if explicitly matched
  for (const pattern of AUTONOMOUS_PATTERNS) {
    if (pattern.test(action)) return "autonomous";
  }

  // Unknown actions default to ASK_FIRST (safe default)
  return "ask_first";
}

// ---------------------------------------------------------------------------
// Telegram escalation
// ---------------------------------------------------------------------------

const TELEGRAM_API = "https://api.telegram.org";

/**
 * Send a Telegram message asking Max for approval.
 * Returns the approval status.
 *
 * In the current implementation, this sends the question and returns false
 * (defaulting to "not approved") because true interactive polling requires
 * the Telegram bot's callback infrastructure. For now, this logs the
 * escalation and notifies Max -- he can then act through the Telegram bot.
 */
export async function escalate(
  action: string,
  context: string,
  botToken: string,
  chatId: string,
  dryRun: boolean = false
): Promise<boolean> {
  const message =
    `*Sentinel Escalation*\n\n` +
    `*Action:* ${escapeMarkdown(action)}\n` +
    `*Context:* ${escapeMarkdown(context)}\n\n` +
    `Reply to the Sentinel bot to approve or deny\\.`;

  if (dryRun) {
    console.log(`[DRY RUN] Would escalate to Telegram: ${action}`);
    logEscalation(action, context, false);
    return false;
  }

  try {
    const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "MarkdownV2",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Telegram escalation failed: ${response.status} ${text}`);
      logEscalation(action, context, false);
      return false;
    }

    // Log that we escalated. Default to not-approved since we cannot
    // wait for interactive response in a cron context.
    logEscalation(action, `Escalated to Telegram: ${context}`, false);
    return false;
  } catch (err) {
    console.error(`Escalation error: ${err}`);
    logEscalation(action, `Escalation failed: ${err}`, false);
    return false;
  }
}

/**
 * Escape special MarkdownV2 characters for Telegram.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}
