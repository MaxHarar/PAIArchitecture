/**
 * Email Cleaner
 * Handles bulk cleanup operations: trash, archive, unsubscribe
 */

import { GmailAPI, GmailMessage } from './api';
import { EmailAnalyzer } from './analyzer';

export interface CleanupResult {
  action: string;
  success: number;
  failed: number;
  skipped: number;
  details: string[];
}

export interface CleanupOptions {
  dryRun: boolean;
  confirmThreshold: number;
  excludeLabels: string[];
}

export class EmailCleaner {
  private api: GmailAPI;
  private analyzer: EmailAnalyzer;

  constructor(api: GmailAPI) {
    this.api = api;
    this.analyzer = new EmailAnalyzer(api);
  }

  async trashFromSender(email: string, options: CleanupOptions): Promise<CleanupResult> {
    const result: CleanupResult = {
      action: `Trash emails from ${email}`,
      success: 0,
      failed: 0,
      skipped: 0,
      details: []
    };

    const messages = await this.api.listMessages(`from:${email}`, 500);
    if (!messages.messages) {
      result.details.push('No messages found');
      return result;
    }

    if (options.dryRun) {
      result.details.push(`[DRY RUN] Would trash ${messages.messages.length} emails from ${email}`);
      result.skipped = messages.messages.length;
      return result;
    }

    for (const msg of messages.messages) {
      try {
        await this.api.trashMessage(msg.id);
        result.success++;
      } catch (err) {
        result.failed++;
        result.details.push(`Failed to trash ${msg.id}: ${err}`);
      }
    }

    result.details.push(`Trashed ${result.success} emails from ${email}`);
    return result;
  }

  async trashOlderThan(days: number, options: CleanupOptions): Promise<CleanupResult> {
    const result: CleanupResult = {
      action: `Trash emails older than ${days} days`,
      success: 0,
      failed: 0,
      skipped: 0,
      details: []
    };

    const oldEmails = await this.analyzer.findOldEmails(days);

    if (oldEmails.length === 0) {
      result.details.push('No old emails found');
      return result;
    }

    // Filter out excluded labels
    const labels = await this.api.listLabels();
    const excludeIds = labels
      .filter(l => options.excludeLabels.includes(l.name))
      .map(l => l.id);

    const toTrash: string[] = [];
    for (const email of oldEmails) {
      const msg = await this.api.getMessage(email.id, 'minimal');
      const hasExcluded = msg.labelIds?.some(id => excludeIds.includes(id));
      if (hasExcluded) {
        result.skipped++;
      } else {
        toTrash.push(email.id);
      }
    }

    if (options.dryRun) {
      result.details.push(`[DRY RUN] Would trash ${toTrash.length} emails older than ${days} days`);
      result.details.push(`  Skipped ${result.skipped} (starred/important)`);
      result.skipped += toTrash.length;
      return result;
    }

    const trashResult = await this.api.batchTrash(toTrash);
    result.success = trashResult.success;
    result.failed = trashResult.failed;
    result.details.push(`Trashed ${result.success} old emails`);

    return result;
  }

  async unsubscribeFromSender(email: string, options: CleanupOptions): Promise<CleanupResult> {
    const result: CleanupResult = {
      action: `Unsubscribe from ${email}`,
      success: 0,
      failed: 0,
      skipped: 0,
      details: []
    };

    // Find a message with List-Unsubscribe header
    const messages = await this.api.listMessages(`from:${email}`, 10);
    if (!messages.messages) {
      result.details.push('No messages found from sender');
      return result;
    }

    for (const msg of messages.messages) {
      const fullMsg = await this.api.getMessage(msg.id, 'full');
      const unsubscribe = this.api.getHeader(fullMsg, 'List-Unsubscribe');

      if (unsubscribe) {
        // Extract URL or mailto link
        const urlMatch = unsubscribe.match(/<(https?:\/\/[^>]+)>/);
        const mailtoMatch = unsubscribe.match(/<(mailto:[^>]+)>/);

        if (options.dryRun) {
          result.details.push(`[DRY RUN] Would unsubscribe via: ${urlMatch?.[1] || mailtoMatch?.[1]}`);
          result.skipped = 1;
          return result;
        }

        if (urlMatch) {
          try {
            // POST to unsubscribe URL with List-Unsubscribe-Post header
            const oneClick = this.api.getHeader(fullMsg, 'List-Unsubscribe-Post');
            if (oneClick) {
              await fetch(urlMatch[1], {
                method: 'POST',
                headers: { 'List-Unsubscribe': 'One-Click' },
                body: 'List-Unsubscribe=One-Click'
              });
              result.success = 1;
              result.details.push(`Unsubscribed via one-click: ${urlMatch[1]}`);
            } else {
              result.details.push(`Manual unsubscribe needed: ${urlMatch[1]}`);
              result.skipped = 1;
            }
          } catch (err) {
            result.failed = 1;
            result.details.push(`Unsubscribe failed: ${err}`);
          }
        } else if (mailtoMatch) {
          result.details.push(`Mailto unsubscribe: ${mailtoMatch[1]}`);
          result.skipped = 1;
        }

        return result;
      }
    }

    result.details.push('No List-Unsubscribe header found');
    return result;
  }

  async autoLabel(options: CleanupOptions): Promise<CleanupResult> {
    const result: CleanupResult = {
      action: 'Auto-label emails',
      success: 0,
      failed: 0,
      skipped: 0,
      details: []
    };

    // This would implement auto-labeling based on patterns
    // For now, just report what would be done
    result.details.push('[DRY RUN] Auto-labeling not yet implemented');

    return result;
  }

  async bulkCleanup(options: CleanupOptions & {
    olderThanDays?: number;
    senders?: string[];
  }): Promise<CleanupResult[]> {
    const results: CleanupResult[] = [];

    if (options.olderThanDays) {
      results.push(await this.trashOlderThan(options.olderThanDays, options));
    }

    if (options.senders) {
      for (const sender of options.senders) {
        results.push(await this.trashFromSender(sender, options));
      }
    }

    return results;
  }
}
