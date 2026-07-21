#!/usr/bin/env bun
/**
 * FitnessBot - Interactive Telegram Bot Server
 *
 * A long-running bot that handles wellness questionnaires with inline buttons,
 * training readiness queries, and fitness coaching commands.
 *
 * Commands:
 *   /wellness  - Start interactive wellness questionnaire
 *   /readiness - Show current training readiness score
 *   /help      - Show available commands
 *
 * Usage:
 *   bun run fitness-bot.ts              # Start bot server
 *   bun run fitness-bot.ts --test       # Test mode (no actual Telegram connection)
 *
 * Configuration:
 *   Reads from ~/.claude/settings.json under "fitnessBot" section
 */

import { Database } from 'bun:sqlite';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';

// =============================================================================
// CONFIGURATION
// =============================================================================

const SETTINGS_PATH = `${homedir()}/.claude/settings.json`;
const DB_PATH = `${homedir()}/.claude/fitness/workouts.db`;
const LOG_PREFIX = '[FitnessBot]';

interface FitnessBotConfig {
  botToken: string;
  chatId: string;
  pollInterval?: number;
}

interface Settings {
  fitnessBot?: FitnessBotConfig;
}

function loadConfig(): FitnessBotConfig {
  if (!existsSync(SETTINGS_PATH)) {
    throw new Error(`Settings file not found: ${SETTINGS_PATH}`);
  }

  const settings: Settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));

  if (!settings.fitnessBot) {
    throw new Error('fitnessBot section not found in settings.json');
  }

  if (!settings.fitnessBot.botToken || settings.fitnessBot.botToken === 'BOT_TOKEN_PLACEHOLDER') {
    throw new Error('fitnessBot.botToken not configured in settings.json');
  }

  if (!settings.fitnessBot.chatId || settings.fitnessBot.chatId === 'CHAT_ID_PLACEHOLDER') {
    throw new Error('fitnessBot.chatId not configured in settings.json');
  }

  return settings.fitnessBot;
}

// =============================================================================
// TYPES
// =============================================================================

interface WellnessData {
  date: string;
  sleep_quality: number;
  muscle_soreness: number;
  stress_level: number;
  mood: number;
  wellness_score?: number;
  notes?: string;
}

interface UserSession {
  chatId: number;
  step: 'sleep' | 'soreness' | 'stress' | 'mood' | 'complete';
  data: Partial<WellnessData>;
  messageId?: number;
}

// Telegram API types (minimal subset for our needs)
interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
  first_name?: string;
  username?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  chat_instance: string;
  data?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

interface SendMessageOptions {
  chat_id: number | string;
  text: string;
  parse_mode?: string;
  reply_markup?: InlineKeyboardMarkup;
}

// =============================================================================
// WELLNESS LOGIC (adapted from wellness-check.ts)
// =============================================================================

const QUESTIONS = {
  sleep: {
    prompt: 'Rate your sleep quality (1-10)',
    description: '1 = poor, 10 = excellent',
    field: 'sleep_quality' as const,
  },
  soreness: {
    prompt: 'Rate your muscle soreness (1-10)',
    description: '1 = none, 10 = severe',
    field: 'muscle_soreness' as const,
  },
  stress: {
    prompt: 'Rate your stress level (1-10)',
    description: '1 = low, 10 = high',
    field: 'stress_level' as const,
  },
  mood: {
    prompt: 'Rate your mood (1-10)',
    description: '1 = poor, 10 = excellent',
    field: 'mood' as const,
  },
};

/**
 * Calculate wellness score from raw metrics (0-100 scale)
 * muscle_soreness and stress_level are INVERTED (lower is better)
 */
function calculateWellnessScore(data: WellnessData): number {
  const invertedSoreness = 11 - data.muscle_soreness;
  const invertedStress = 11 - data.stress_level;

  const average = (
    data.sleep_quality +
    invertedSoreness +
    invertedStress +
    data.mood
  ) / 4;

  const score = Math.round(((average - 1) / 9) * 100);
  return Math.max(0, Math.min(100, score));
}

/**
 * Get readiness status based on wellness score
 */
function getReadinessStatus(score: number): { emoji: string; status: string; recommendation: string } {
  if (score >= 80) {
    return {
      emoji: '🟢',
      status: 'EXCELLENT',
      recommendation: 'Great day for training! Green light for intensity.',
    };
  } else if (score >= 60) {
    return {
      emoji: '🟡',
      status: 'GOOD',
      recommendation: 'Normal training appropriate. Monitor how you feel.',
    };
  } else if (score >= 40) {
    return {
      emoji: '🟠',
      status: 'MODERATE',
      recommendation: 'Consider lighter training or active recovery.',
    };
  } else {
    return {
      emoji: '🔴',
      status: 'LOW',
      recommendation: 'Rest or very easy activity recommended.',
    };
  }
}

// =============================================================================
// DATABASE OPERATIONS
// =============================================================================

function getDatabase(): Database {
  if (!existsSync(DB_PATH)) {
    throw new Error(`Database not found: ${DB_PATH}`);
  }
  return new Database(DB_PATH);
}

function saveWellnessData(data: WellnessData): { success: boolean; wellness_score: number; error?: string } {
  try {
    const db = getDatabase();
    const wellness_score = calculateWellnessScore(data);

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO daily_wellness
      (date, sleep_quality, muscle_soreness, stress_level, mood, wellness_score, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      data.date,
      data.sleep_quality,
      data.muscle_soreness,
      data.stress_level,
      data.mood,
      wellness_score,
      data.notes || null
    );

    db.close();

    return { success: true, wellness_score };
  } catch (error) {
    return {
      success: false,
      wellness_score: 0,
      error: `Database error: ${error}`,
    };
  }
}

function getTodayWellness(): WellnessData | null {
  try {
    const db = getDatabase();
    const today = new Date().toISOString().split('T')[0];

    const stmt = db.prepare(`
      SELECT date, sleep_quality, muscle_soreness, stress_level, mood, wellness_score, notes
      FROM daily_wellness
      WHERE date = ?
    `);

    const result = stmt.get(today) as WellnessData | undefined;
    db.close();

    return result || null;
  } catch (error) {
    console.error(`${LOG_PREFIX} Error fetching wellness data:`, error);
    return null;
  }
}

// =============================================================================
// TELEGRAM API CLIENT
// =============================================================================

class TelegramClient {
  private baseUrl: string;
  private offset: number = 0;

  constructor(private botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  private async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/${method}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: params ? JSON.stringify(params) : undefined,
    });

    const result = await response.json() as { ok: boolean; result?: T; description?: string };

    if (!result.ok) {
      throw new Error(`Telegram API error: ${result.description || 'Unknown error'}`);
    }

    return result.result as T;
  }

  async getUpdates(timeout: number = 30): Promise<TelegramUpdate[]> {
    const updates = await this.request<TelegramUpdate[]>('getUpdates', {
      offset: this.offset,
      timeout,
      allowed_updates: ['message', 'callback_query'],
    });

    if (updates.length > 0) {
      this.offset = updates[updates.length - 1].update_id + 1;
    }

    return updates;
  }

  async sendMessage(options: SendMessageOptions): Promise<TelegramMessage> {
    return this.request<TelegramMessage>('sendMessage', options);
  }

  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    parseMode?: string,
    replyMarkup?: InlineKeyboardMarkup
  ): Promise<TelegramMessage | boolean> {
    return this.request<TelegramMessage | boolean>('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: parseMode,
      reply_markup: replyMarkup,
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    return this.request<boolean>('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  async deleteMessage(chatId: number | string, messageId: number): Promise<boolean> {
    try {
      return await this.request<boolean>('deleteMessage', {
        chat_id: chatId,
        message_id: messageId,
      });
    } catch {
      // Ignore delete errors (message may already be deleted)
      return false;
    }
  }
}

// =============================================================================
// BOT SERVER
// =============================================================================

class FitnessBot {
  private client: TelegramClient;
  private sessions: Map<number, UserSession> = new Map();
  private isRunning: boolean = false;
  private authorizedChatId: string;

  constructor(config: FitnessBotConfig) {
    this.client = new TelegramClient(config.botToken);
    this.authorizedChatId = config.chatId;
  }

  private isAuthorized(chatId: number): boolean {
    return chatId.toString() === this.authorizedChatId;
  }

  private createRatingKeyboard(): InlineKeyboardMarkup {
    // Create 2 rows: 1-5 and 6-10
    const row1: InlineKeyboardButton[] = [];
    const row2: InlineKeyboardButton[] = [];

    for (let i = 1; i <= 5; i++) {
      row1.push({ text: i.toString(), callback_data: `rating_${i}` });
    }
    for (let i = 6; i <= 10; i++) {
      row2.push({ text: i.toString(), callback_data: `rating_${i}` });
    }

    return { inline_keyboard: [row1, row2] };
  }

  private getNextStep(currentStep: UserSession['step']): UserSession['step'] {
    const steps: UserSession['step'][] = ['sleep', 'soreness', 'stress', 'mood', 'complete'];
    const currentIndex = steps.indexOf(currentStep);
    return steps[currentIndex + 1] || 'complete';
  }

  private getQuestionText(step: UserSession['step']): string {
    if (step === 'complete') return '';

    const question = QUESTIONS[step];
    return `<b>${question.prompt}</b>\n<i>${question.description}</i>`;
  }

  async handleCommand(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id;
    const text = message.text || '';

    if (!this.isAuthorized(chatId)) {
      console.log(`${LOG_PREFIX} Unauthorized access attempt from chat ${chatId}`);
      return;
    }

    const command = text.split(' ')[0].toLowerCase();

    switch (command) {
      case '/wellness':
      case '/start':
        await this.startWellnessCheck(chatId);
        break;

      case '/readiness':
        await this.showReadiness(chatId);
        break;

      case '/help':
        await this.showHelp(chatId);
        break;

      default:
        // Ignore unknown commands
        break;
    }
  }

  async startWellnessCheck(chatId: number): Promise<void> {
    // Check if wellness already recorded today
    const existing = getTodayWellness();
    if (existing) {
      const status = getReadinessStatus(existing.wellness_score || 0);
      await this.client.sendMessage({
        chat_id: chatId,
        text: `<b>Wellness Already Recorded Today</b>\n\n` +
          `${status.emoji} Score: <b>${existing.wellness_score}/100</b>\n` +
          `Status: ${status.status}\n\n` +
          `Sleep: ${existing.sleep_quality}/10\n` +
          `Soreness: ${existing.muscle_soreness}/10\n` +
          `Stress: ${existing.stress_level}/10\n` +
          `Mood: ${existing.mood}/10\n\n` +
          `<i>Use /readiness to see your training readiness.</i>`,
        parse_mode: 'HTML',
      });
      return;
    }

    // Start new session
    const session: UserSession = {
      chatId,
      step: 'sleep',
      data: {
        date: new Date().toISOString().split('T')[0],
      },
    };

    const response = await this.client.sendMessage({
      chat_id: chatId,
      text: `<b>Morning Wellness Check</b>\n\n${this.getQuestionText('sleep')}`,
      parse_mode: 'HTML',
      reply_markup: this.createRatingKeyboard(),
    });

    session.messageId = response.message_id;
    this.sessions.set(chatId, session);
  }

  async handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id;
    const data = query.data;

    if (!chatId || !data) {
      await this.client.answerCallbackQuery(query.id);
      return;
    }

    if (!this.isAuthorized(chatId)) {
      await this.client.answerCallbackQuery(query.id, 'Unauthorized');
      return;
    }

    // Handle rating callback
    if (data.startsWith('rating_')) {
      const rating = parseInt(data.replace('rating_', ''), 10);
      await this.handleRating(chatId, rating, query);
    }

    await this.client.answerCallbackQuery(query.id);
  }

  async handleRating(chatId: number, rating: number, query: TelegramCallbackQuery): Promise<void> {
    const session = this.sessions.get(chatId);

    if (!session || session.step === 'complete') {
      return;
    }

    // Store the rating
    const field = QUESTIONS[session.step].field;
    session.data[field] = rating;

    // Move to next step
    session.step = this.getNextStep(session.step);

    if (session.step === 'complete') {
      // All questions answered - save and show results
      await this.completeWellnessCheck(chatId, session, query.message?.message_id);
    } else {
      // Show next question by editing the message
      const nextQuestion = this.getQuestionText(session.step);

      if (query.message?.message_id) {
        await this.client.editMessageText(
          chatId,
          query.message.message_id,
          `<b>Morning Wellness Check</b>\n\n${nextQuestion}`,
          'HTML',
          this.createRatingKeyboard()
        );
      }
    }
  }

  async completeWellnessCheck(chatId: number, session: UserSession, messageId?: number): Promise<void> {
    const data = session.data as WellnessData;

    // Save to database
    const result = saveWellnessData(data);

    // Clean up session
    this.sessions.delete(chatId);

    if (result.success) {
      const status = getReadinessStatus(result.wellness_score);

      const summaryText = `<b>Wellness Check Complete!</b>\n\n` +
        `${status.emoji} <b>Score: ${result.wellness_score}/100</b>\n` +
        `Status: ${status.status}\n\n` +
        `<b>Your Responses:</b>\n` +
        `  Sleep: ${data.sleep_quality}/10\n` +
        `  Soreness: ${data.muscle_soreness}/10\n` +
        `  Stress: ${data.stress_level}/10\n` +
        `  Mood: ${data.mood}/10\n\n` +
        `<b>Recommendation:</b>\n${status.recommendation}`;

      if (messageId) {
        await this.client.editMessageText(chatId, messageId, summaryText, 'HTML');
      } else {
        await this.client.sendMessage({
          chat_id: chatId,
          text: summaryText,
          parse_mode: 'HTML',
        });
      }
    } else {
      await this.client.sendMessage({
        chat_id: chatId,
        text: `Failed to save wellness data: ${result.error}`,
        parse_mode: 'HTML',
      });
    }
  }

  async showReadiness(chatId: number): Promise<void> {
    const wellness = getTodayWellness();

    if (!wellness) {
      await this.client.sendMessage({
        chat_id: chatId,
        text: `<b>No Wellness Data Today</b>\n\nUse /wellness to complete your morning check-in.`,
        parse_mode: 'HTML',
      });
      return;
    }

    const status = getReadinessStatus(wellness.wellness_score || 0);

    await this.client.sendMessage({
      chat_id: chatId,
      text: `<b>Training Readiness</b>\n\n` +
        `${status.emoji} <b>Score: ${wellness.wellness_score}/100</b>\n` +
        `Status: ${status.status}\n\n` +
        `<b>Today's Metrics:</b>\n` +
        `  Sleep: ${wellness.sleep_quality}/10\n` +
        `  Soreness: ${wellness.muscle_soreness}/10\n` +
        `  Stress: ${wellness.stress_level}/10\n` +
        `  Mood: ${wellness.mood}/10\n\n` +
        `<b>Recommendation:</b>\n${status.recommendation}`,
      parse_mode: 'HTML',
    });
  }

  async showHelp(chatId: number): Promise<void> {
    await this.client.sendMessage({
      chat_id: chatId,
      text: `<b>FitnessBot Commands</b>\n\n` +
        `/wellness - Start morning wellness questionnaire\n` +
        `/readiness - Show current training readiness\n` +
        `/help - Show this help message\n\n` +
        `<i>The wellness check asks 4 questions (sleep, soreness, stress, mood) ` +
        `and calculates your training readiness score.</i>`,
      parse_mode: 'HTML',
    });
  }

  async processUpdate(update: TelegramUpdate): Promise<void> {
    try {
      if (update.message?.text?.startsWith('/')) {
        await this.handleCommand(update.message);
      } else if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Error processing update:`, error);
    }
  }

  async start(): Promise<void> {
    this.isRunning = true;
    console.log(`${LOG_PREFIX} Bot started. Listening for updates...`);

    while (this.isRunning) {
      try {
        const updates = await this.client.getUpdates(30);

        for (const update of updates) {
          await this.processUpdate(update);
        }
      } catch (error) {
        console.error(`${LOG_PREFIX} Error fetching updates:`, error);
        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    console.log(`${LOG_PREFIX} Bot stopped.`);
  }

  stop(): void {
    this.isRunning = false;
    console.log(`${LOG_PREFIX} Stopping bot...`);
  }
}

// =============================================================================
// MAIN ENTRYPOINT
// =============================================================================

async function main(): Promise<void> {
  const isTest = process.argv.includes('--test');

  if (isTest) {
    console.log(`${LOG_PREFIX} Test mode - validating configuration...`);

    try {
      const config = loadConfig();
      console.log(`${LOG_PREFIX} Configuration valid.`);
      console.log(`${LOG_PREFIX} Bot token: ${config.botToken.slice(0, 10)}...`);
      console.log(`${LOG_PREFIX} Chat ID: ${config.chatId}`);

      // Test database connection
      const db = getDatabase();
      db.close();
      console.log(`${LOG_PREFIX} Database connection successful.`);

      console.log(`${LOG_PREFIX} All checks passed!`);
    } catch (error) {
      console.error(`${LOG_PREFIX} Configuration error:`, error);
      process.exit(1);
    }

    return;
  }

  // Production mode
  console.log(`${LOG_PREFIX} Starting FitnessBot...`);

  try {
    const config = loadConfig();
    const bot = new FitnessBot(config);

    // Graceful shutdown handlers
    process.on('SIGTERM', () => {
      console.log(`${LOG_PREFIX} Received SIGTERM signal.`);
      bot.stop();
    });

    process.on('SIGINT', () => {
      console.log(`${LOG_PREFIX} Received SIGINT signal.`);
      bot.stop();
    });

    await bot.start();
  } catch (error) {
    console.error(`${LOG_PREFIX} Fatal error:`, error);
    process.exit(1);
  }
}

main();
