#!/usr/bin/env bun
/**
 * Gmail Manager CLI
 *
 * Usage:
 *   gmail analyze              - Show inbox statistics
 *   gmail top-senders          - List top senders by email count
 *   gmail newsletters          - Find newsletters (with unsubscribe)
 *   gmail cleanup              - Run cleanup (--dry-run default)
 *   gmail unsubscribe          - Unsubscribe from sender
 *   gmail labels               - List all labels
 */

import { GmailAPI } from './lib/api';
import { EmailAnalyzer } from './lib/analyzer';
import { EmailCleaner } from './lib/cleaner';
import { readFileSync } from 'fs';
import { homedir } from 'os';

const CONFIG_PATH = `${homedir()}/.claude/skills/GmailManager/Config/settings.json`;

function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

function parseArgs(args: string[]): { command: string; flags: Record<string, string | boolean> } {
  const command = args[0] || 'help';
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }

  return { command, flags };
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  if (command === 'help') {
    console.log(`
Gmail Manager CLI

Commands:
  analyze              Show inbox statistics
  top-senders          List top senders (--limit N)
  newsletters          Find newsletters with unsubscribe option
  cleanup              Cleanup emails (--older-than Nd, --from email)
  unsubscribe          Unsubscribe from sender (--from email)
  labels               List all labels

Flags:
  --dry-run            Preview changes without executing (default)
  --execute            Actually perform the changes
  --limit N            Limit results (default: 20)
  --older-than Nd      Filter emails older than N days (e.g., 365d)
  --from email         Filter by sender email
`);
    return;
  }

  const api = new GmailAPI();
  const analyzer = new EmailAnalyzer(api);
  const cleaner = new EmailCleaner(api);

  const dryRun = !flags.execute;
  const limit = parseInt(String(flags.limit)) || 20;

  try {
    switch (command) {
      case 'analyze': {
        console.log('Analyzing inbox...\n');
        const stats = await analyzer.getInboxStats();

        console.log('📊 INBOX STATISTICS');
        console.log('═══════════════════════════════════');
        console.log(`Total emails:     ${stats.total.toLocaleString()}`);
        console.log(`Unread:           ${stats.unread.toLocaleString()}`);
        console.log(`Starred:          ${stats.starred.toLocaleString()}`);
        console.log(`Spam:             ${stats.spam.toLocaleString()}`);
        console.log(`Trash:            ${stats.trash.toLocaleString()}`);
        console.log(`Newsletters:      ${stats.newsletters.toLocaleString()}`);
        console.log('');
        console.log('📅 BY AGE');
        console.log('───────────────────────────────────');
        console.log(`Last week:        ${stats.byAge.lastWeek.toLocaleString()}`);
        console.log(`Last month:       ${stats.byAge.lastMonth.toLocaleString()}`);
        console.log(`Last year:        ${stats.byAge.lastYear.toLocaleString()}`);
        console.log(`Older:            ${stats.byAge.older.toLocaleString()}`);
        break;
      }

      case 'top-senders': {
        console.log(`Finding top ${limit} senders...\n`);
        const senders = await analyzer.getTopSenders(limit);

        console.log('📧 TOP SENDERS');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('Count  Unsub  Sender');
        console.log('───────────────────────────────────────────────────────────');
        for (const s of senders) {
          const unsub = s.hasUnsubscribe ? '✓' : ' ';
          console.log(`${String(s.count).padStart(5)}  ${unsub.padStart(5)}  ${s.name} <${s.email}>`);
        }
        break;
      }

      case 'newsletters': {
        console.log('Finding newsletters...\n');
        const newsletters = await analyzer.findNewsletters();

        console.log('📰 NEWSLETTERS (with unsubscribe option)');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('Count  Sender');
        console.log('───────────────────────────────────────────────────────────');
        for (const n of newsletters.slice(0, limit)) {
          console.log(`${String(n.count).padStart(5)}  ${n.name} <${n.email}>`);
        }
        console.log('');
        console.log(`Total: ${newsletters.length} newsletter senders found`);
        console.log('');
        console.log('To unsubscribe: gmail unsubscribe --from "email@example.com"');
        break;
      }

      case 'cleanup': {
        const olderThan = flags['older-than'];
        const from = flags.from;

        if (!olderThan && !from) {
          console.log('Error: Specify --older-than Nd or --from email');
          console.log('Example: gmail cleanup --older-than 365d --dry-run');
          return;
        }

        const options = {
          dryRun,
          confirmThreshold: config.cleanup.confirmThreshold,
          excludeLabels: config.safety.excludeLabels
        };

        if (dryRun) {
          console.log('🔍 DRY RUN MODE (use --execute to apply changes)\n');
        } else {
          console.log('⚠️  EXECUTING CHANGES\n');
        }

        if (olderThan) {
          const days = parseInt(String(olderThan).replace('d', ''));
          console.log(`Cleaning emails older than ${days} days...`);
          const result = await cleaner.trashOlderThan(days, options);
          console.log('');
          for (const detail of result.details) {
            console.log(`  ${detail}`);
          }
        }

        if (from) {
          console.log(`Cleaning emails from ${from}...`);
          const result = await cleaner.trashFromSender(String(from), options);
          console.log('');
          for (const detail of result.details) {
            console.log(`  ${detail}`);
          }
        }
        break;
      }

      case 'unsubscribe': {
        const from = flags.from;

        if (!from) {
          console.log('Error: Specify --from email');
          console.log('Example: gmail unsubscribe --from "newsletter@example.com"');
          return;
        }

        const options = {
          dryRun,
          confirmThreshold: 1,
          excludeLabels: []
        };

        if (dryRun) {
          console.log('🔍 DRY RUN MODE (use --execute to apply)\n');
        }

        console.log(`Unsubscribing from ${from}...`);
        const result = await cleaner.unsubscribeFromSender(String(from), options);
        console.log('');
        for (const detail of result.details) {
          console.log(`  ${detail}`);
        }
        break;
      }

      case 'labels': {
        console.log('Fetching labels...\n');
        const labels = await api.listLabels();

        console.log('🏷️  LABELS');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('Total    Unread  Name');
        console.log('───────────────────────────────────────────────────────────');
        for (const label of labels.sort((a, b) => a.name.localeCompare(b.name))) {
          const total = label.messagesTotal?.toString() || '-';
          const unread = label.messagesUnread?.toString() || '-';
          console.log(`${total.padStart(7)}  ${unread.padStart(6)}  ${label.name}`);
        }
        break;
      }

      default:
        console.log(`Unknown command: ${command}`);
        console.log('Run "gmail help" for usage');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Not authenticated')) {
      console.error('❌ Not authenticated. Run gmail-auth.ts first:');
      console.error('   bun run ~/.claude/skills/GmailManager/Tools/gmail-auth.ts');
    } else {
      console.error('Error:', err);
    }
    process.exit(1);
  }
}

main().catch(console.error);
