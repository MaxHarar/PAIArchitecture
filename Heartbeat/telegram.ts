/**
 * PAI Heartbeat - Telegram Integration
 *
 * Lightweight Telegram message sender for the heartbeat system.
 * Uses the same bot token as the main Sentinel Telegram bot.
 */

const TELEGRAM_API = "https://api.telegram.org";

/**
 * Send a plain text message via Telegram.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode: "MarkdownV2" | "HTML" | undefined = undefined
): Promise<boolean> {
  try {
    const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
    };
    if (parseMode) body.parse_mode = parseMode;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Telegram send failed: ${response.status} ${errText}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`Telegram send error: ${err}`);
    return false;
  }
}
