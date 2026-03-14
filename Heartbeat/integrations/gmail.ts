/**
 * Gmail Integration
 *
 * Uses Gmail API with OAuth2 via google-auth-library + googleapis.
 *
 * Required setup:
 *   1. Google Cloud project with Gmail API enabled
 *   2. OAuth2 credentials (client_id, client_secret)
 *   3. Run OAuth flow to generate tokens (Max does this manually)
 *
 * Env keys in ~/.claude/.env:
 *   GMAIL_CLIENT_ID      — OAuth2 client ID
 *   GMAIL_CLIENT_SECRET   — OAuth2 client secret
 *
 * Token storage: ~/.claude/gmail-tokens/
 *   tokens.json           — access_token, refresh_token, expiry_date
 *
 * Pattern follows existing Garmin integration at ~/.claude/garmin-tokens/
 */

import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import {
  BaseIntegration,
  type IntegrationResult,
  type TestResult,
  log,
} from "./base.ts";

const TOKEN_DIR = resolve(process.env.HOME || "~", ".claude", "gmail-tokens");
const TOKEN_PATH = resolve(TOKEN_DIR, "tokens.json");

interface GmailTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
}

interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
}

type TriageDecision = "handle_autonomously" | "escalate_to_max" | "ignore";

interface TriageResult {
  emailId: string;
  decision: TriageDecision;
  reason: string;
}

export class GmailIntegration extends BaseIntegration {
  readonly name = "gmail";
  readonly requiredEnvKeys = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"];

  // ---------------------------------------------------------------------------
  // OAuth helpers
  // ---------------------------------------------------------------------------

  private loadTokens(): GmailTokens | null {
    if (!existsSync(TOKEN_PATH)) return null;
    try {
      return JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
    } catch {
      return null;
    }
  }

  private saveTokens(tokens: GmailTokens): void {
    if (!existsSync(TOKEN_DIR)) {
      mkdirSync(TOKEN_DIR, { recursive: true });
    }
    writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const tokens = this.loadTokens();
    if (!tokens) throw new Error("No Gmail OAuth tokens found. Run OAuth flow first.");

    // Check if token is expired (with 5 min buffer)
    if (tokens.expiry_date && Date.now() > tokens.expiry_date - 300_000) {
      // Refresh the token
      const refreshed = await this.refreshAccessToken(tokens);
      this.saveTokens(refreshed);
      return { Authorization: `Bearer ${refreshed.access_token}` };
    }

    return { Authorization: `Bearer ${tokens.access_token}` };
  }

  private async refreshAccessToken(tokens: GmailTokens): Promise<GmailTokens> {
    const clientId = this.env("GMAIL_CLIENT_ID");
    const clientSecret = this.env("GMAIL_CLIENT_SECRET");

    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Token refresh failed: ${resp.status} ${text}`);
    }

    const data = await resp.json() as Record<string, unknown>;
    return {
      access_token: data.access_token as string,
      refresh_token: tokens.refresh_token, // refresh_token doesn't change
      expiry_date: Date.now() + ((data.expires_in as number) || 3600) * 1000,
      token_type: (data.token_type as string) || "Bearer",
    };
  }

  // ---------------------------------------------------------------------------
  // Gmail API helpers
  // ---------------------------------------------------------------------------

  private async gmailGet(path: string): Promise<unknown> {
    const headers = await this.getAuthHeaders();
    const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      headers,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Gmail API ${path}: ${resp.status} ${text}`);
    }
    return resp.json();
  }

  private async gmailPost(path: string, body: unknown): Promise<unknown> {
    const headers = await this.getAuthHeaders();
    const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Gmail API POST ${path}: ${resp.status} ${text}`);
    }
    return resp.json();
  }

  // ---------------------------------------------------------------------------
  // Core interface
  // ---------------------------------------------------------------------------

  async check(): Promise<IntegrationResult> {
    // Fetch unread messages from inbox
    const listData = (await this.gmailGet(
      "messages?q=is:unread+in:inbox&maxResults=10"
    )) as { messages?: Array<{ id: string; threadId: string }> };

    if (!listData.messages || listData.messages.length === 0) {
      return this.ok({ unreadCount: 0, emails: [] });
    }

    // Fetch details for each message
    const emails: EmailSummary[] = [];
    for (const msg of listData.messages.slice(0, 10)) {
      try {
        const detail = (await this.gmailGet(
          `messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
        )) as {
          id: string;
          threadId: string;
          snippet: string;
          payload?: {
            headers?: Array<{ name: string; value: string }>;
          };
        };

        const getHeader = (name: string) =>
          detail.payload?.headers?.find(
            (h) => h.name.toLowerCase() === name.toLowerCase()
          )?.value || "";

        emails.push({
          id: detail.id,
          threadId: detail.threadId,
          from: getHeader("From"),
          subject: getHeader("Subject"),
          snippet: detail.snippet,
          date: getHeader("Date"),
        });
      } catch (err) {
        log.warn(`Failed to fetch message ${msg.id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return this.ok({ unreadCount: emails.length, emails });
  }

  async act(action: string, params: Record<string, unknown>): Promise<IntegrationResult> {
    switch (action) {
      case "send":
        return this.send(
          params.to as string,
          params.subject as string,
          params.body as string
        );
      case "triage":
        return this.triage(params.emailId as string);
      default:
        return this.ok({ error: `Unknown action: ${action}` });
    }
  }

  async test(): Promise<TestResult> {
    const missing = this.checkEnvKeys();
    const tokensExist = existsSync(TOKEN_PATH);

    if (missing.length > 0) {
      return {
        integration: this.name,
        configured: false,
        healthy: false,
        missing,
        message: `Missing env keys: ${missing.join(", ")}`,
      };
    }

    if (!tokensExist) {
      return {
        integration: this.name,
        configured: true,
        healthy: false,
        message: `OAuth tokens not found at ${TOKEN_PATH}. Run OAuth flow.`,
      };
    }

    // Validate token structure
    const tokens = this.loadTokens();
    if (!tokens?.access_token || !tokens?.refresh_token) {
      return {
        integration: this.name,
        configured: true,
        healthy: false,
        message: "Token file exists but is missing access_token or refresh_token.",
      };
    }

    return {
      integration: this.name,
      configured: true,
      healthy: true,
      message: "Gmail integration configured. OAuth tokens present.",
    };
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private async send(to: string, subject: string, body: string): Promise<IntegrationResult> {
    if (!to || !subject) {
      throw new Error("send requires 'to' and 'subject' params");
    }

    // Build RFC 2822 message
    const rawMessage = [
      `To: ${to}`,
      `Subject: ${subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      body || "",
    ].join("\r\n");

    // Base64url encode
    const encoded = Buffer.from(rawMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const result = await this.gmailPost("messages/send", { raw: encoded });
    log.info("Email sent", { to, subject });
    return this.ok(result);
  }

  private async triage(emailId: string): Promise<IntegrationResult> {
    if (!emailId) throw new Error("triage requires 'emailId' param");

    // Fetch full message for triage analysis
    const detail = (await this.gmailGet(
      `messages/${emailId}?format=full`
    )) as {
      id: string;
      snippet: string;
      payload?: {
        headers?: Array<{ name: string; value: string }>;
        body?: { data?: string };
        parts?: Array<{ mimeType: string; body?: { data?: string } }>;
      };
    };

    const getHeader = (name: string) =>
      detail.payload?.headers?.find(
        (h) => h.name.toLowerCase() === name.toLowerCase()
      )?.value || "";

    const from = getHeader("From").toLowerCase();
    const subject = getHeader("Subject").toLowerCase();

    // Simple rule-based triage (v1 — will be replaced with LLM triage)
    let decision: TriageDecision;
    let reason: string;

    // Automated newsletters, marketing, notifications
    const ignorePatterns = [
      "noreply@",
      "no-reply@",
      "notifications@",
      "marketing@",
      "newsletter@",
      "unsubscribe",
    ];
    const escalatePatterns = [
      "urgent",
      "asap",
      "important",
      "action required",
      "deadline",
    ];

    if (ignorePatterns.some((p) => from.includes(p) || subject.includes(p))) {
      decision = "ignore";
      reason = "Automated/marketing email detected";
    } else if (
      escalatePatterns.some((p) => subject.includes(p) || from.includes(p))
    ) {
      decision = "escalate_to_max";
      reason = "Urgent or action-required keywords detected";
    } else {
      decision = "handle_autonomously";
      reason = "Standard email, no urgency signals";
    }

    const triageResult: TriageResult = {
      emailId,
      decision,
      reason,
    };

    return this.ok(triageResult);
  }
}

// ---------------------------------------------------------------------------
// CLI entry point: bun run gmail.ts --test
// ---------------------------------------------------------------------------
if (import.meta.main) {
  const gmail = new GmailIntegration();

  if (process.argv.includes("--test")) {
    gmail.safeTest().then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.healthy ? 0 : 1);
    });
  } else {
    console.log("Usage: bun run gmail.ts --test");
    console.log("  --test  Verify OAuth credentials exist");
  }
}
