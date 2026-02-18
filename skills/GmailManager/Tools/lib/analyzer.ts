/**
 * Email Analyzer
 * Analyzes inbox patterns, identifies newsletters, top senders
 */

import { GmailAPI, GmailMessage } from './api';

export interface SenderStats {
  email: string;
  name: string;
  count: number;
  hasUnsubscribe: boolean;
  oldestDate: Date;
  newestDate: Date;
}

export interface InboxStats {
  total: number;
  unread: number;
  starred: number;
  spam: number;
  trash: number;
  newsletters: number;
  byAge: {
    lastWeek: number;
    lastMonth: number;
    lastYear: number;
    older: number;
  };
}

export class EmailAnalyzer {
  private api: GmailAPI;

  constructor(api: GmailAPI) {
    this.api = api;
  }

  async getInboxStats(): Promise<InboxStats> {
    const profile = await this.api.getProfile();
    const labels = await this.api.listLabels();

    const findLabel = (name: string) => labels.find(l => l.name === name);

    // Get counts by age
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    const [lastWeek, lastMonth, lastYear] = await Promise.all([
      this.api.listMessages(`after:${this.formatDate(weekAgo)}`, 1),
      this.api.listMessages(`after:${this.formatDate(monthAgo)}`, 1),
      this.api.listMessages(`after:${this.formatDate(yearAgo)}`, 1)
    ]);

    // Count newsletters (messages with List-Unsubscribe header)
    const newsletters = await this.api.listMessages('list:*', 500);

    return {
      total: profile.messagesTotal,
      unread: findLabel('UNREAD')?.messagesUnread || 0,
      starred: findLabel('STARRED')?.messagesTotal || 0,
      spam: findLabel('SPAM')?.messagesTotal || 0,
      trash: findLabel('TRASH')?.messagesTotal || 0,
      newsletters: newsletters.messages?.length || 0,
      byAge: {
        lastWeek: lastWeek.messages?.length || 0,
        lastMonth: lastMonth.messages?.length || 0,
        lastYear: lastYear.messages?.length || 0,
        older: profile.messagesTotal - (lastYear.messages?.length || 0)
      }
    };
  }

  async getTopSenders(limit = 20): Promise<SenderStats[]> {
    // Get recent messages
    const result = await this.api.listMessages('', 500);
    if (!result.messages) return [];

    const messages = await this.api.batchGetMessages(
      result.messages.map(m => m.id),
      'metadata'
    );

    const senderMap = new Map<string, SenderStats>();

    for (const msg of messages) {
      const from = this.api.getHeader(msg, 'From') || 'Unknown';
      const { email, name } = this.parseFromHeader(from);
      const unsubscribe = this.api.getHeader(msg, 'List-Unsubscribe');
      const date = new Date(parseInt(msg.internalDate));

      const existing = senderMap.get(email);
      if (existing) {
        existing.count++;
        existing.hasUnsubscribe = existing.hasUnsubscribe || !!unsubscribe;
        if (date < existing.oldestDate) existing.oldestDate = date;
        if (date > existing.newestDate) existing.newestDate = date;
      } else {
        senderMap.set(email, {
          email,
          name,
          count: 1,
          hasUnsubscribe: !!unsubscribe,
          oldestDate: date,
          newestDate: date
        });
      }
    }

    return Array.from(senderMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  async findNewsletters(): Promise<SenderStats[]> {
    // Find messages with List-Unsubscribe header
    const result = await this.api.listMessages('list:*', 500);
    if (!result.messages) return [];

    const messages = await this.api.batchGetMessages(
      result.messages.map(m => m.id),
      'metadata'
    );

    const senderMap = new Map<string, SenderStats>();

    for (const msg of messages) {
      const from = this.api.getHeader(msg, 'From') || 'Unknown';
      const { email, name } = this.parseFromHeader(from);
      const date = new Date(parseInt(msg.internalDate));

      const existing = senderMap.get(email);
      if (existing) {
        existing.count++;
        if (date < existing.oldestDate) existing.oldestDate = date;
        if (date > existing.newestDate) existing.newestDate = date;
      } else {
        senderMap.set(email, {
          email,
          name,
          count: 1,
          hasUnsubscribe: true,
          oldestDate: date,
          newestDate: date
        });
      }
    }

    return Array.from(senderMap.values())
      .sort((a, b) => b.count - a.count);
  }

  async findOldEmails(daysOld: number): Promise<Array<{ id: string; from: string; subject: string; date: Date }>> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    const result = await this.api.listMessages(`before:${this.formatDate(cutoff)}`, 500);
    if (!result.messages) return [];

    const messages = await this.api.batchGetMessages(
      result.messages.map(m => m.id),
      'metadata'
    );

    return messages.map(msg => ({
      id: msg.id,
      from: this.api.getHeader(msg, 'From') || 'Unknown',
      subject: this.api.getHeader(msg, 'Subject') || '(no subject)',
      date: new Date(parseInt(msg.internalDate))
    }));
  }

  private parseFromHeader(from: string): { email: string; name: string } {
    // Parse "Name <email@example.com>" or "email@example.com"
    const match = from.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+@[^>]+)>?$/);
    if (match) {
      return {
        name: match[1]?.trim() || match[2],
        email: match[2].toLowerCase()
      };
    }
    return { email: from.toLowerCase(), name: from };
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
