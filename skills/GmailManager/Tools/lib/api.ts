/**
 * Gmail API Wrapper
 * Handles authentication, token refresh, and API calls
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';

const CONFIG_PATH = `${homedir()}/.claude/skills/GmailManager/Config/settings.json`;
const TOKEN_PATH = `${homedir()}/.claude/skills/GmailManager/State/oauth-tokens.json`;

interface Config {
  oauth: {
    clientId: string;
    clientSecret: string;
    scopes: string[];
  };
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload?: {
    headers: Array<{ name: string; value: string }>;
    body?: { data?: string };
  };
  internalDate: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: string;
  messagesTotal?: number;
  messagesUnread?: number;
}

export class GmailAPI {
  private config: Config;
  private tokens: Tokens | null = null;

  constructor() {
    this.config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    this.loadTokens();
  }

  private loadTokens(): void {
    if (existsSync(TOKEN_PATH)) {
      this.tokens = JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'));
    }
  }

  private saveTokens(): void {
    if (this.tokens) {
      writeFileSync(TOKEN_PATH, JSON.stringify(this.tokens, null, 2));
    }
  }

  private async refreshTokenIfNeeded(): Promise<void> {
    if (!this.tokens) {
      throw new Error('Not authenticated. Run gmail-auth.ts first.');
    }

    // Refresh if token expires in less than 5 minutes
    if (Date.now() > this.tokens.expiry_date - 300000) {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: this.tokens.refresh_token,
          client_id: this.config.oauth.clientId,
          client_secret: this.config.oauth.clientSecret,
          grant_type: 'refresh_token'
        })
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(`Token refresh failed: ${data.error}`);
      }

      this.tokens.access_token = data.access_token;
      this.tokens.expiry_date = Date.now() + (data.expires_in * 1000);
      this.saveTokens();
    }
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    await this.refreshTokenIfNeeded();

    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.tokens!.access_token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Gmail API error: ${error.error?.message || response.statusText}`);
    }

    return response.json();
  }

  async getProfile(): Promise<{ emailAddress: string; messagesTotal: number; threadsTotal: number }> {
    return this.request('/profile');
  }

  async listLabels(): Promise<GmailLabel[]> {
    const data = await this.request<{ labels: GmailLabel[] }>('/labels');
    return data.labels || [];
  }

  async listMessages(query: string, maxResults = 100): Promise<{ messages: Array<{ id: string; threadId: string }>; nextPageToken?: string }> {
    const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
    return this.request(`/messages?${params}`);
  }

  async getMessage(id: string, format: 'full' | 'metadata' | 'minimal' = 'metadata'): Promise<GmailMessage> {
    return this.request(`/messages/${id}?format=${format}`);
  }

  async batchGetMessages(ids: string[], format: 'full' | 'metadata' | 'minimal' = 'metadata'): Promise<GmailMessage[]> {
    // Process in batches of 100 (Gmail API limit)
    const results: GmailMessage[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const messages = await Promise.all(batch.map(id => this.getMessage(id, format)));
      results.push(...messages);
    }
    return results;
  }

  async trashMessage(id: string): Promise<void> {
    await this.request(`/messages/${id}/trash`, { method: 'POST' });
  }

  async batchTrash(ids: string[]): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const id of ids) {
      try {
        await this.trashMessage(id);
        success++;
      } catch {
        failed++;
      }
    }

    return { success, failed };
  }

  async modifyLabels(id: string, addLabels: string[], removeLabels: string[]): Promise<void> {
    await this.request(`/messages/${id}/modify`, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds: addLabels, removeLabelIds: removeLabels })
    });
  }

  async createLabel(name: string): Promise<GmailLabel> {
    return this.request('/labels', {
      method: 'POST',
      body: JSON.stringify({
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show'
      })
    });
  }

  getHeader(message: GmailMessage, name: string): string | undefined {
    return message.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;
  }
}
