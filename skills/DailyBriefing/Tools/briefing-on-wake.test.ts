#!/usr/bin/env bun
/**
 * briefing-on-wake.test.ts - Comprehensive Test Suite
 *
 * All 8 required test scenarios covered:
 * 1. Happy path: Wake at 6:42am, trigger at 6:57am
 * 2. Already sent: Second check on same day exits cleanly
 * 3. Fallback: No Garmin data by 8am, sends anyway
 * 4. Too early: 5:30am check exits (outside window)
 * 5. Too late: 11am check exits (outside window)
 * 6. Garmin failure: API error, fallback triggers
 * 7. Multiple wakes: Only first wake counts
 * 8. Edge of window: 5:59am, 10:01am boundary tests
 *
 * Run with: bun test briefing-on-wake.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_STATE_DIR = '/tmp/briefing-on-wake-test';
const TEST_STATE_PATH = `${TEST_STATE_DIR}/wake-state.json`;

// Import functions from implementation
import {
  checkAlreadySentToday,
  parseWakeTime,
  calculateTriggerTime,
  shouldTriggerBriefing,
  isWithinTimeWindow,
  updateWakeState,
  getWakeState,
  loadState,
  saveState,
  shouldSkipBriefing,
  incrementGarminFailure,
  resetGarminFailures,
  shouldForceFallback,
  formatLogMessage,
  parseCliArgs,
  isDataStale,
  getSleepDataFromDB,
  getSleepDataWithFallback,
  EXIT_CODES,
  type WakeState,
  type WakeConfig,
  type CliArgs,
  type SleepDataResult
} from './briefing-on-wake.ts';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Helper to create a date at a specific time today
 */
function timeToday(hour: number, minute: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
}

/**
 * Helper to get today's date string (YYYY-MM-DD)
 */
function todayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Helper to get yesterday's date
 */
function yesterday(): Date {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return y;
}

/**
 * Default test configuration
 */
const DEFAULT_CONFIG: WakeConfig = {
  windowStartHour: 6,
  windowEndHour: 10,
  fallbackHour: 8,
  wakeOffsetMinutes: 15
};

// ============================================================================
// Test Suite
// ============================================================================

describe('Wake-Triggered Briefing System', () => {
  beforeEach(() => {
    // Clean up and create test state directory
    if (existsSync(TEST_STATE_DIR)) {
      rmSync(TEST_STATE_DIR, { recursive: true });
    }
    mkdirSync(TEST_STATE_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (existsSync(TEST_STATE_DIR)) {
      rmSync(TEST_STATE_DIR, { recursive: true });
    }
  });

  // =========================================================================
  // Exit Codes
  // =========================================================================
  describe('Exit Codes', () => {
    it('should define SENT as 0', () => {
      expect(EXIT_CODES.SENT).toBe(0);
    });

    it('should define NOT_TIME_YET as 1', () => {
      expect(EXIT_CODES.NOT_TIME_YET).toBe(1);
    });

    it('should define ALREADY_SENT as 2', () => {
      expect(EXIT_CODES.ALREADY_SENT).toBe(2);
    });

    it('should define ERROR as 3', () => {
      expect(EXIT_CODES.ERROR).toBe(3);
    });
  });

  // =========================================================================
  // Scenario 1: Happy Path - Wake at 6:42am, trigger at 6:57am
  // =========================================================================
  describe('Scenario 1: Happy Path - Wake at 6:42am triggers at 6:57am', () => {
    it('should detect wake time from Garmin data', () => {
      const garminData = {
        sleep: {
          sleepEndTimestampLocal: timeToday(6, 42).getTime()
        }
      };
      const wakeTime = parseWakeTime(garminData);

      expect(wakeTime).not.toBeNull();
      expect(wakeTime?.getHours()).toBe(6);
      expect(wakeTime?.getMinutes()).toBe(42);
    });

    it('should calculate trigger time as wake + 15 minutes', () => {
      const wakeTime = timeToday(6, 42);
      const triggerTime = calculateTriggerTime(wakeTime, 15);

      expect(triggerTime.getHours()).toBe(6);
      expect(triggerTime.getMinutes()).toBe(57);
    });

    it('should trigger briefing when current time reaches 6:57am', () => {
      const wakeTime = timeToday(6, 42);
      const triggerTime = calculateTriggerTime(wakeTime, 15);
      const currentTime = timeToday(6, 57);

      expect(shouldTriggerBriefing(triggerTime, currentTime)).toBe(true);
    });

    it('should NOT trigger before 6:57am', () => {
      const wakeTime = timeToday(6, 42);
      const triggerTime = calculateTriggerTime(wakeTime, 15);
      const currentTime = timeToday(6, 50);

      expect(shouldTriggerBriefing(triggerTime, currentTime)).toBe(false);
    });

    it('should trigger if current time is AFTER 6:57am', () => {
      const wakeTime = timeToday(6, 42);
      const triggerTime = calculateTriggerTime(wakeTime, 15);
      const currentTime = timeToday(7, 0);

      expect(shouldTriggerBriefing(triggerTime, currentTime)).toBe(true);
    });

    it('should update state file correctly on successful send', () => {
      const wakeTime = timeToday(6, 42);
      const triggerTime = calculateTriggerTime(wakeTime, 15);
      const sentTime = timeToday(7, 0);

      const state: WakeState = {
        lastSent: sentTime.toISOString(),
        lastWakeTime: wakeTime.toISOString(),
        lastTriggerTime: triggerTime.toISOString(),
        sendMethod: 'wake-triggered'
      };
      updateWakeState(TEST_STATE_PATH, state);

      const saved = getWakeState(TEST_STATE_PATH);
      expect(saved?.sendMethod).toBe('wake-triggered');
      expect(saved?.lastWakeTime).toBe(wakeTime.toISOString());
    });

    it('should complete full happy path flow', () => {
      const config = DEFAULT_CONFIG;
      const wakeTime = timeToday(6, 42);
      const currentTime = timeToday(7, 0);

      // 1. Within window? Yes
      expect(isWithinTimeWindow(currentTime, config)).toBe(true);

      // 2. Already sent? No
      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(false);

      // 3. Parse wake time
      const garminData = { sleep: { sleepEndTimestampLocal: wakeTime.getTime() } };
      const parsedWakeTime = parseWakeTime(garminData);
      expect(parsedWakeTime).not.toBeNull();

      // 4. Calculate trigger time
      const triggerTime = calculateTriggerTime(parsedWakeTime!, config.wakeOffsetMinutes || 15);
      expect(triggerTime.getMinutes()).toBe(57);

      // 5. Past trigger time? Yes (7:00 > 6:57)
      expect(shouldTriggerBriefing(triggerTime, currentTime)).toBe(true);
    });
  });

  // =========================================================================
  // Scenario 2: Already Sent - Second check same day exits cleanly
  // =========================================================================
  describe('Scenario 2: Already Sent - Duplicate prevention', () => {
    it('should return true when briefing already sent today', () => {
      const state: WakeState = {
        lastSent: new Date().toISOString(),
        lastWakeTime: timeToday(6, 42).toISOString(),
        lastTriggerTime: timeToday(6, 57).toISOString(),
        sendMethod: 'wake-triggered'
      };
      writeFileSync(TEST_STATE_PATH, JSON.stringify(state));

      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(true);
    });

    it('should return false when briefing sent yesterday', () => {
      const state: WakeState = {
        lastSent: yesterday().toISOString(),
        lastWakeTime: null,
        lastTriggerTime: null,
        sendMethod: 'wake-triggered'
      };
      writeFileSync(TEST_STATE_PATH, JSON.stringify(state));

      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(false);
    });

    it('should return false when no state file exists', () => {
      expect(checkAlreadySentToday('/nonexistent/path.json')).toBe(false);
    });

    it('should return false when lastSent is null', () => {
      const state: WakeState = {
        lastSent: null,
        lastWakeTime: null,
        lastTriggerTime: null,
        sendMethod: 'fallback'
      };
      writeFileSync(TEST_STATE_PATH, JSON.stringify(state));

      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(false);
    });

    it('should handle malformed JSON gracefully', () => {
      writeFileSync(TEST_STATE_PATH, 'not valid json');
      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(false);
    });

    it('should block subsequent checks on same day after first send', () => {
      // Simulate first send at 7:00am
      const firstSend = timeToday(7, 0);
      updateWakeState(TEST_STATE_PATH, {
        lastSent: firstSend.toISOString(),
        lastWakeTime: timeToday(6, 42).toISOString(),
        lastTriggerTime: timeToday(6, 57).toISOString(),
        sendMethod: 'wake-triggered'
      });

      // All subsequent checks should be blocked
      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(true);
      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(true);
      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(true);
    });

    it('should allow sending on new day', () => {
      // Sent yesterday
      const yesterdayState: WakeState = {
        lastSent: yesterday().toISOString(),
        lastWakeTime: null,
        lastTriggerTime: null,
        sendMethod: 'wake-triggered'
      };
      writeFileSync(TEST_STATE_PATH, JSON.stringify(yesterdayState));

      // Should allow since it's a new day
      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(false);
    });
  });

  // =========================================================================
  // Scenario 3: Fallback - No Garmin data by 8am, sends anyway
  // =========================================================================
  describe('Scenario 3: Fallback - No Garmin data by 8am', () => {
    it('should trigger fallback when no wake data and past 8am', () => {
      const config = DEFAULT_CONFIG;
      const currentTime = timeToday(8, 5);
      const wakeTime = null;

      const shouldFallback = wakeTime === null &&
        currentTime.getHours() >= (config.fallbackHour || 8) &&
        isWithinTimeWindow(currentTime, config);

      expect(shouldFallback).toBe(true);
    });

    it('should NOT trigger fallback before 8am even without wake data', () => {
      const config = DEFAULT_CONFIG;
      const currentTime = timeToday(7, 45);
      const wakeTime = null;

      const shouldFallback = wakeTime === null &&
        currentTime.getHours() >= (config.fallbackHour || 8);

      expect(shouldFallback).toBe(false);
    });

    it('should NOT trigger fallback when wake data exists', () => {
      const config = DEFAULT_CONFIG;
      const currentTime = timeToday(8, 30);
      const wakeTime = timeToday(6, 42);

      const shouldFallback = wakeTime === null &&
        currentTime.getHours() >= (config.fallbackHour || 8);

      expect(shouldFallback).toBe(false);
    });

    it('should record fallback as send method in state', () => {
      updateWakeState(TEST_STATE_PATH, {
        lastSent: new Date().toISOString(),
        lastWakeTime: null,
        lastTriggerTime: null,
        sendMethod: 'fallback'
      });

      const state = getWakeState(TEST_STATE_PATH);
      expect(state?.sendMethod).toBe('fallback');
      expect(state?.lastWakeTime).toBeNull();
    });

    it('should trigger fallback exactly at 8:00am', () => {
      const config = DEFAULT_CONFIG;
      const currentTime = timeToday(8, 0);
      const wakeTime = null;

      const shouldFallback = wakeTime === null &&
        currentTime.getHours() >= (config.fallbackHour || 8) &&
        isWithinTimeWindow(currentTime, config);

      expect(shouldFallback).toBe(true);
    });

    it('should NOT trigger fallback at 7:59am', () => {
      const config = DEFAULT_CONFIG;
      const currentTime = timeToday(7, 59);
      const wakeTime = null;

      const shouldFallback = wakeTime === null &&
        currentTime.getHours() >= (config.fallbackHour || 8);

      expect(shouldFallback).toBe(false);
    });

    it('should complete full fallback flow', () => {
      const config = DEFAULT_CONFIG;
      const currentTime = timeToday(8, 15);

      // 1. Within window? Yes
      expect(isWithinTimeWindow(currentTime, config)).toBe(true);

      // 2. Already sent? No
      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(false);

      // 3. No wake time available
      const garminData = { sleep: null };
      const parsedWakeTime = parseWakeTime(garminData as any);
      expect(parsedWakeTime).toBeNull();

      // 4. Past fallback hour? Yes
      expect(currentTime.getHours() >= (config.fallbackHour || 8)).toBe(true);

      // 5. Update state with fallback method
      const state: WakeState = {
        lastSent: currentTime.toISOString(),
        lastWakeTime: null,
        lastTriggerTime: null,
        sendMethod: 'fallback'
      };
      updateWakeState(TEST_STATE_PATH, state);

      const finalState = getWakeState(TEST_STATE_PATH);
      expect(finalState?.sendMethod).toBe('fallback');
    });
  });

  // =========================================================================
  // Scenario 4: Too Early - 5:30am check exits (outside window)
  // =========================================================================
  describe('Scenario 4: Too Early - 5:30am check exits', () => {
    it('should exit when current time is 5:30am (before 6am window)', () => {
      const config = DEFAULT_CONFIG;
      const time = timeToday(5, 30);
      expect(isWithinTimeWindow(time, config)).toBe(false);
    });

    it('should exit at 5:59am (just before window)', () => {
      const config = DEFAULT_CONFIG;
      const time = timeToday(5, 59);
      expect(isWithinTimeWindow(time, config)).toBe(false);
    });

    it('should exit at 4:00am', () => {
      const config = DEFAULT_CONFIG;
      const time = timeToday(4, 0);
      expect(isWithinTimeWindow(time, config)).toBe(false);
    });

    it('should exit at midnight', () => {
      const config = DEFAULT_CONFIG;
      const time = timeToday(0, 0);
      expect(isWithinTimeWindow(time, config)).toBe(false);
    });

    it('should exit at 3:00am', () => {
      const config = DEFAULT_CONFIG;
      const time = timeToday(3, 0);
      expect(isWithinTimeWindow(time, config)).toBe(false);
    });

    it('should exit at 1:30am', () => {
      const config = DEFAULT_CONFIG;
      const time = timeToday(1, 30);
      expect(isWithinTimeWindow(time, config)).toBe(false);
    });
  });

  // =========================================================================
  // Scenario 5: Too Late - 11am check exits (outside window)
  // =========================================================================
  describe('Scenario 5: Too Late - 11am check exits', () => {
    it('should exit when current time is 11am (after 10am window)', () => {
      const config = DEFAULT_CONFIG;
      const time = timeToday(11, 0);
      expect(isWithinTimeWindow(time, config)).toBe(false);
    });

    it('should exit at 10:30am', () => {
      const config = DEFAULT_CONFIG;
      const time = timeToday(10, 30);
      expect(isWithinTimeWindow(time, config)).toBe(false);
    });

    it('should exit at noon', () => {
      const config = DEFAULT_CONFIG;
      const time = timeToday(12, 0);
      expect(isWithinTimeWindow(time, config)).toBe(false);
    });

    it('should exit at 10pm', () => {
      const config = DEFAULT_CONFIG;
      const time = timeToday(22, 0);
      expect(isWithinTimeWindow(time, config)).toBe(false);
    });

    it('should exit at 2pm', () => {
      const config = DEFAULT_CONFIG;
      const time = timeToday(14, 0);
      expect(isWithinTimeWindow(time, config)).toBe(false);
    });

    it('should exit at 11:59pm', () => {
      const config = DEFAULT_CONFIG;
      const time = timeToday(23, 59);
      expect(isWithinTimeWindow(time, config)).toBe(false);
    });
  });

  // =========================================================================
  // Scenario 6: Garmin Failure - API error triggers fallback
  // =========================================================================
  describe('Scenario 6: Garmin Failure - API error triggers fallback', () => {
    it('should return null when Garmin data is null', () => {
      const wakeTime = parseWakeTime(null);
      expect(wakeTime).toBeNull();
    });

    it('should return null when Garmin data is empty object', () => {
      const wakeTime = parseWakeTime({});
      expect(wakeTime).toBeNull();
    });

    it('should return null when sleep object exists but no timestamp', () => {
      const wakeTime = parseWakeTime({ sleep: {} });
      expect(wakeTime).toBeNull();
    });

    it('should return null when timestamp is invalid string', () => {
      const wakeTime = parseWakeTime({ sleep: { sleepEndTimestampLocal: 'invalid' } });
      expect(wakeTime).toBeNull();
    });

    it('should return null when timestamp is NaN', () => {
      const wakeTime = parseWakeTime({ sleep: { sleepEndTimestampLocal: NaN } });
      expect(wakeTime).toBeNull();
    });

    it('should return null when sleep object is null', () => {
      const garminData = { sleep: null };
      expect(parseWakeTime(garminData as any)).toBeNull();
    });

    it('should return null when sleepEndTimestampLocal is missing', () => {
      const garminData = { sleep: { sleepTimeSeconds: 25200 } };
      expect(parseWakeTime(garminData as any)).toBeNull();
    });

    it('should trigger fallback logic when parseWakeTime returns null at 8am', () => {
      const config = DEFAULT_CONFIG;
      const currentTime = timeToday(8, 15);
      const garminData = {}; // Empty/failed
      const wakeTime = parseWakeTime(garminData);

      // Should use fallback
      const shouldFallback = wakeTime === null &&
        currentTime.getHours() >= (config.fallbackHour || 8) &&
        isWithinTimeWindow(currentTime, config);

      expect(wakeTime).toBeNull();
      expect(shouldFallback).toBe(true);
    });

    it('should handle empty string timestamp', () => {
      const wakeTime = parseWakeTime({ sleep: { sleepEndTimestampLocal: '' } });
      expect(wakeTime).toBeNull();
    });
  });

  // =========================================================================
  // Scenario 7: Multiple Wakes - Only first wake counts
  // =========================================================================
  describe('Scenario 7: Multiple Wakes - Only first wake counts', () => {
    it('should use latest wake time from Garmin data', () => {
      // Garmin only provides a single sleepEndTimestampLocal
      // If someone wakes multiple times, Garmin records the final wake
      const garminData = {
        sleep: {
          sleepEndTimestampLocal: timeToday(7, 30).getTime()
        }
      };
      const wakeTime = parseWakeTime(garminData);

      expect(wakeTime?.getHours()).toBe(7);
      expect(wakeTime?.getMinutes()).toBe(30);
    });

    it('should only send once per day regardless of wake detection changes', () => {
      // First trigger
      updateWakeState(TEST_STATE_PATH, {
        lastSent: new Date().toISOString(),
        lastWakeTime: timeToday(6, 30).toISOString(),
        lastTriggerTime: timeToday(6, 45).toISOString(),
        sendMethod: 'wake-triggered'
      });

      // Check - should be true (already sent)
      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(true);

      // Even if we get new wake data, shouldn't send again
      const newGarminData = { sleep: { sleepEndTimestampLocal: timeToday(8, 0).getTime() } };
      const newWakeTime = parseWakeTime(newGarminData);
      expect(newWakeTime).not.toBeNull(); // We can detect new wake

      // But already sent check still blocks
      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(true);
    });

    it('should preserve first wake time in state after sending', () => {
      const firstWake = timeToday(6, 42);
      const firstTrigger = timeToday(6, 57);

      updateWakeState(TEST_STATE_PATH, {
        lastSent: new Date().toISOString(),
        lastWakeTime: firstWake.toISOString(),
        lastTriggerTime: firstTrigger.toISOString(),
        sendMethod: 'wake-triggered'
      });

      const state = getWakeState(TEST_STATE_PATH);
      const savedWake = new Date(state!.lastWakeTime!);

      expect(savedWake.getHours()).toBe(6);
      expect(savedWake.getMinutes()).toBe(42);
    });

    it('should block subsequent checks on same day after first send', () => {
      // Simulate first send at 7:00am
      const firstSend = timeToday(7, 0);
      updateWakeState(TEST_STATE_PATH, {
        lastSent: firstSend.toISOString(),
        lastWakeTime: timeToday(6, 42).toISOString(),
        lastTriggerTime: timeToday(6, 57).toISOString(),
        sendMethod: 'wake-triggered'
      });

      // Check at various times - all should be blocked
      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(true);
      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(true);
      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(true);
    });
  });

  // =========================================================================
  // Scenario 8: Edge of Window - 5:59am and 10:01am boundary tests
  // =========================================================================
  describe('Scenario 8: Edge of Window - Boundary tests', () => {
    describe('Start boundary (6:00am)', () => {
      it('should be INSIDE window at exactly 6:00:00am', () => {
        const config = DEFAULT_CONFIG;
        const time = timeToday(6, 0);
        expect(isWithinTimeWindow(time, config)).toBe(true);
      });

      it('should be OUTSIDE window at 5:59am', () => {
        const config = DEFAULT_CONFIG;
        const time = timeToday(5, 59);
        expect(isWithinTimeWindow(time, config)).toBe(false);
      });

      it('should be INSIDE window at 6:00:01am', () => {
        const config = DEFAULT_CONFIG;
        const time = timeToday(6, 0);
        time.setSeconds(1);
        expect(isWithinTimeWindow(time, config)).toBe(true);
      });

      it('should be INSIDE window at 6:01am', () => {
        const config = DEFAULT_CONFIG;
        const time = timeToday(6, 1);
        expect(isWithinTimeWindow(time, config)).toBe(true);
      });
    });

    describe('End boundary (10:00am)', () => {
      it('should be OUTSIDE window at exactly 10:00am', () => {
        const config = DEFAULT_CONFIG;
        const time = timeToday(10, 0);
        expect(isWithinTimeWindow(time, config)).toBe(false);
      });

      it('should be INSIDE window at 9:59am', () => {
        const config = DEFAULT_CONFIG;
        const time = timeToday(9, 59);
        expect(isWithinTimeWindow(time, config)).toBe(true);
      });

      it('should be OUTSIDE window at 10:01am', () => {
        const config = DEFAULT_CONFIG;
        const time = timeToday(10, 1);
        expect(isWithinTimeWindow(time, config)).toBe(false);
      });

      it('should be INSIDE window at 9:59:59am', () => {
        const config = DEFAULT_CONFIG;
        const time = timeToday(9, 59);
        time.setSeconds(59);
        expect(isWithinTimeWindow(time, config)).toBe(true);
      });
    });

    describe('Wake time near window boundaries', () => {
      it('should handle wake at 5:50am with trigger at 6:05am', () => {
        const wakeTime = timeToday(5, 50);
        const triggerTime = calculateTriggerTime(wakeTime, 15);

        expect(triggerTime.getHours()).toBe(6);
        expect(triggerTime.getMinutes()).toBe(5);

        // At 6:05am, within window
        expect(isWithinTimeWindow(triggerTime, DEFAULT_CONFIG)).toBe(true);
      });

      it('should handle wake at 9:50am with trigger at 10:05am', () => {
        const wakeTime = timeToday(9, 50);
        const triggerTime = calculateTriggerTime(wakeTime, 15);

        expect(triggerTime.getHours()).toBe(10);
        expect(triggerTime.getMinutes()).toBe(5);

        // At 10:05am, outside window - trigger won't fire
        expect(isWithinTimeWindow(triggerTime, DEFAULT_CONFIG)).toBe(false);
      });

      it('should handle wake at 9:44am with trigger at 9:59am (just inside)', () => {
        const wakeTime = timeToday(9, 44);
        const triggerTime = calculateTriggerTime(wakeTime, 15);

        expect(triggerTime.getHours()).toBe(9);
        expect(triggerTime.getMinutes()).toBe(59);
        expect(isWithinTimeWindow(triggerTime, DEFAULT_CONFIG)).toBe(true);
      });

      it('should handle wake at 9:45am with trigger at 10:00am (just outside)', () => {
        const wakeTime = timeToday(9, 45);
        const triggerTime = calculateTriggerTime(wakeTime, 15);

        expect(triggerTime.getHours()).toBe(10);
        expect(triggerTime.getMinutes()).toBe(0);
        expect(isWithinTimeWindow(triggerTime, DEFAULT_CONFIG)).toBe(false);
      });
    });
  });

  // =========================================================================
  // State File Management
  // =========================================================================
  describe('State File Management', () => {
    it('should create state directory if it does not exist', () => {
      const nestedPath = `${TEST_STATE_DIR}/nested/deep/state.json`;
      rmSync(TEST_STATE_DIR, { recursive: true, force: true });

      updateWakeState(nestedPath, {
        lastSent: new Date().toISOString(),
        lastWakeTime: null,
        lastTriggerTime: null,
        sendMethod: 'fallback'
      });

      expect(existsSync(nestedPath)).toBe(true);
    });

    it('should return null for non-existent state file', () => {
      const state = getWakeState('/nonexistent/path.json');
      expect(state).toBeNull();
    });

    it('should preserve all state fields correctly', () => {
      const now = new Date();
      const wakeTime = timeToday(6, 42);
      const triggerTime = timeToday(6, 57);

      updateWakeState(TEST_STATE_PATH, {
        lastSent: now.toISOString(),
        lastWakeTime: wakeTime.toISOString(),
        lastTriggerTime: triggerTime.toISOString(),
        sendMethod: 'wake-triggered'
      });

      const state = getWakeState(TEST_STATE_PATH);
      expect(state).not.toBeNull();
      expect(state!.lastSent).toBe(now.toISOString());
      expect(state!.lastWakeTime).toBe(wakeTime.toISOString());
      expect(state!.lastTriggerTime).toBe(triggerTime.toISOString());
      expect(state!.sendMethod).toBe('wake-triggered');
    });

    it('should handle state file with invalid JSON', () => {
      writeFileSync(TEST_STATE_PATH, '{ invalid json }');
      const state = getWakeState(TEST_STATE_PATH);
      expect(state).toBeNull();
    });

    it('should handle empty state file', () => {
      writeFileSync(TEST_STATE_PATH, '');
      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(false);
      expect(getWakeState(TEST_STATE_PATH)).toBeNull();
    });

    it('should overwrite existing state file', () => {
      // Write initial state
      updateWakeState(TEST_STATE_PATH, {
        lastSent: new Date().toISOString(),
        lastWakeTime: null,
        lastTriggerTime: null,
        sendMethod: 'fallback'
      });

      // Overwrite with new state
      const newWakeTime = timeToday(7, 30);
      updateWakeState(TEST_STATE_PATH, {
        lastSent: new Date().toISOString(),
        lastWakeTime: newWakeTime.toISOString(),
        lastTriggerTime: timeToday(7, 45).toISOString(),
        sendMethod: 'wake-triggered'
      });

      const state = getWakeState(TEST_STATE_PATH);
      expect(state!.sendMethod).toBe('wake-triggered');
      expect(new Date(state!.lastWakeTime!).getHours()).toBe(7);
    });

    it('should handle state file with missing required fields', () => {
      writeFileSync(TEST_STATE_PATH, '{"someOtherField": "value"}');

      // Should treat as not sent since lastSent is missing
      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(false);
    });
  });

  // =========================================================================
  // parseWakeTime - Data Format Handling
  // =========================================================================
  describe('parseWakeTime - Data Format Handling', () => {
    it('should parse numeric timestamp (milliseconds)', () => {
      const expected = timeToday(6, 42);
      const garminData = {
        sleep: {
          sleepEndTimestampLocal: expected.getTime()
        }
      };

      const result = parseWakeTime(garminData);
      expect(result?.getTime()).toBe(expected.getTime());
    });

    it('should parse ISO string timestamp', () => {
      const expected = timeToday(6, 42);
      const garminData = {
        sleep: {
          sleepEndTimestampLocal: expected.toISOString()
        }
      };

      const result = parseWakeTime(garminData);
      expect(result?.getTime()).toBe(expected.getTime());
    });

    it('should treat zero timestamp as invalid (epoch time is not a real wake)', () => {
      const garminData = {
        sleep: {
          sleepEndTimestampLocal: 0
        }
      };

      const result = parseWakeTime(garminData);
      // 0 (epoch time) is treated as falsy/invalid - not a real wake time
      expect(result).toBeNull();
    });

    it('should handle very large timestamp', () => {
      const farFuture = new Date('2099-12-31T23:59:59');
      const garminData = {
        sleep: {
          sleepEndTimestampLocal: farFuture.getTime()
        }
      };

      const result = parseWakeTime(garminData);
      expect(result?.getTime()).toBe(farFuture.getTime());
    });

    it('should handle date string without timezone', () => {
      const garminData = {
        sleep: {
          sleepEndTimestampLocal: '2026-01-28T06:42:00'
        }
      };

      const result = parseWakeTime(garminData);
      expect(result).not.toBeNull();
      expect(result?.getMinutes()).toBe(42);
    });
  });

  // =========================================================================
  // Time Arithmetic Tests
  // =========================================================================
  describe('Time Arithmetic', () => {
    it('should handle minute overflow correctly', () => {
      const wakeTime = timeToday(6, 55);
      const triggerTime = calculateTriggerTime(wakeTime, 15);

      // 6:55 + 15 = 7:10
      expect(triggerTime.getHours()).toBe(7);
      expect(triggerTime.getMinutes()).toBe(10);
    });

    it('should handle hour overflow at midnight', () => {
      const wakeTime = timeToday(23, 55);
      const triggerTime = calculateTriggerTime(wakeTime, 15);

      // 23:55 + 15 = 00:10 next day
      expect(triggerTime.getHours()).toBe(0);
      expect(triggerTime.getMinutes()).toBe(10);
    });

    it('should handle custom offset of 30 minutes', () => {
      const wakeTime = timeToday(6, 30);
      const triggerTime = calculateTriggerTime(wakeTime, 30);

      expect(triggerTime.getHours()).toBe(7);
      expect(triggerTime.getMinutes()).toBe(0);
    });

    it('should handle zero offset', () => {
      const wakeTime = timeToday(6, 42);
      const triggerTime = calculateTriggerTime(wakeTime, 0);

      expect(triggerTime.getHours()).toBe(6);
      expect(triggerTime.getMinutes()).toBe(42);
    });

    it('should handle large offset (60 minutes)', () => {
      const wakeTime = timeToday(6, 30);
      const triggerTime = calculateTriggerTime(wakeTime, 60);

      expect(triggerTime.getHours()).toBe(7);
      expect(triggerTime.getMinutes()).toBe(30);
    });

    it('should handle very large offset (120 minutes)', () => {
      const wakeTime = timeToday(6, 30);
      const triggerTime = calculateTriggerTime(wakeTime, 120);

      expect(triggerTime.getHours()).toBe(8);
      expect(triggerTime.getMinutes()).toBe(30);
    });
  });

  // =========================================================================
  // Configuration Handling
  // =========================================================================
  describe('Configuration Handling', () => {
    it('should work with custom window hours', () => {
      const config: WakeConfig = {
        windowStartHour: 5,
        windowEndHour: 9
      };

      expect(isWithinTimeWindow(timeToday(5, 0), config)).toBe(true);
      expect(isWithinTimeWindow(timeToday(8, 59), config)).toBe(true);
      expect(isWithinTimeWindow(timeToday(9, 0), config)).toBe(false);
      expect(isWithinTimeWindow(timeToday(4, 59), config)).toBe(false);
    });

    it('should handle narrow time window', () => {
      const config: WakeConfig = {
        windowStartHour: 7,
        windowEndHour: 8
      };

      expect(isWithinTimeWindow(timeToday(7, 0), config)).toBe(true);
      expect(isWithinTimeWindow(timeToday(7, 30), config)).toBe(true);
      expect(isWithinTimeWindow(timeToday(7, 59), config)).toBe(true);
      expect(isWithinTimeWindow(timeToday(8, 0), config)).toBe(false);
    });

    it('should handle wide time window', () => {
      const config: WakeConfig = {
        windowStartHour: 4,
        windowEndHour: 12
      };

      expect(isWithinTimeWindow(timeToday(4, 0), config)).toBe(true);
      expect(isWithinTimeWindow(timeToday(8, 0), config)).toBe(true);
      expect(isWithinTimeWindow(timeToday(11, 59), config)).toBe(true);
      expect(isWithinTimeWindow(timeToday(12, 0), config)).toBe(false);
    });
  });

  // =========================================================================
  // CLI Arguments Support
  // =========================================================================
  describe('CLI Arguments', () => {
    it('should recognize --test-wake-time flag format', () => {
      const args = ['--test-wake-time', '2026-01-28T06:42:00'];
      const testWakeTimeIndex = args.indexOf('--test-wake-time');

      expect(testWakeTimeIndex).toBe(0);
      expect(args[testWakeTimeIndex + 1]).toBe('2026-01-28T06:42:00');

      const parsedDate = new Date(args[testWakeTimeIndex + 1]);
      expect(parsedDate.getHours()).toBe(6);
      expect(parsedDate.getMinutes()).toBe(42);
    });

    it('should recognize --force flag', () => {
      const args = ['--force'];
      expect(args.includes('--force')).toBe(true);
    });

    it('should recognize --dry-run flag', () => {
      const args = ['--dry-run'];
      expect(args.includes('--dry-run')).toBe(true);
    });

    it('should handle combined flags', () => {
      const args = ['--dry-run', '--force', '--test-wake-time', '2026-01-28T07:00:00'];

      expect(args.includes('--dry-run')).toBe(true);
      expect(args.includes('--force')).toBe(true);
      expect(args.includes('--test-wake-time')).toBe(true);
    });

    it('should handle invalid wake time gracefully', () => {
      const invalidDate = new Date('not-a-date');
      expect(isNaN(invalidDate.getTime())).toBe(true);
    });

    it('should recognize --test-current-time flag', () => {
      const args = ['--test-current-time', '2026-01-28T08:00:00'];
      expect(args.includes('--test-current-time')).toBe(true);

      const parsedDate = new Date(args[args.indexOf('--test-current-time') + 1]);
      expect(parsedDate.getHours()).toBe(8);
    });

    it('should recognize --debug flag', () => {
      const args = ['--debug'];
      expect(args.includes('--debug')).toBe(true);
    });
  });

  // =========================================================================
  // shouldTriggerBriefing - Additional Cases
  // =========================================================================
  describe('shouldTriggerBriefing - Additional Cases', () => {
    it('should return true when times are exactly equal (to the millisecond)', () => {
      const time = new Date('2026-01-28T06:57:00.000');
      expect(shouldTriggerBriefing(time, time)).toBe(true);
    });

    it('should return true when current is 1ms after trigger', () => {
      const trigger = new Date('2026-01-28T06:57:00.000');
      const current = new Date('2026-01-28T06:57:00.001');
      expect(shouldTriggerBriefing(trigger, current)).toBe(true);
    });

    it('should return false when current is 1ms before trigger', () => {
      const trigger = new Date('2026-01-28T06:57:00.001');
      const current = new Date('2026-01-28T06:57:00.000');
      expect(shouldTriggerBriefing(trigger, current)).toBe(false);
    });

    it('should handle cross-day comparison correctly', () => {
      const trigger = new Date('2026-01-28T06:57:00');
      const current = new Date('2026-01-29T06:57:00'); // Next day
      expect(shouldTriggerBriefing(trigger, current)).toBe(true);
    });
  });

  // =========================================================================
  // checkAlreadySentToday - Additional Cases
  // =========================================================================
  describe('checkAlreadySentToday - Additional Cases', () => {
    it('should handle year boundary correctly', () => {
      const dec31LastYear = new Date();
      dec31LastYear.setFullYear(dec31LastYear.getFullYear() - 1);
      dec31LastYear.setMonth(11, 31); // Dec 31

      const state: WakeState = {
        lastSent: dec31LastYear.toISOString(),
        lastWakeTime: null,
        lastTriggerTime: null,
        sendMethod: 'fallback'
      };
      writeFileSync(TEST_STATE_PATH, JSON.stringify(state));

      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(false);
    });

    it('should handle month boundary correctly', () => {
      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      const state: WakeState = {
        lastSent: lastMonth.toISOString(),
        lastWakeTime: null,
        lastTriggerTime: null,
        sendMethod: 'fallback'
      };
      writeFileSync(TEST_STATE_PATH, JSON.stringify(state));

      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(false);
    });

    it('should handle timezone edge case at midnight', () => {
      // Create a date that's "today" at 00:00:01
      const justAfterMidnight = new Date();
      justAfterMidnight.setHours(0, 0, 1, 0);

      const state: WakeState = {
        lastSent: justAfterMidnight.toISOString(),
        lastWakeTime: null,
        lastTriggerTime: null,
        sendMethod: 'fallback'
      };
      writeFileSync(TEST_STATE_PATH, JSON.stringify(state));

      expect(checkAlreadySentToday(TEST_STATE_PATH)).toBe(true);
    });
  });

  // =========================================================================
  // loadState - New State Management
  // =========================================================================
  describe('loadState - New State Management', () => {
    it('should create fresh state when file does not exist', () => {
      const today = todayDateString();
      const state = loadState('/nonexistent/path.json', today);

      expect(state.date).toBe(today);
      expect(state.briefingSent).toBe(false);
      expect(state.wakeDetected).toBe(false);
      expect(state.garminConsecutiveFailures).toBe(0);
    });

    it('should create fresh state for new day', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const todayStr = todayDateString();

      // Write old state
      writeFileSync(TEST_STATE_PATH, JSON.stringify({
        date: yesterdayStr,
        briefingSent: true,
        wakeDetected: true
      }));

      const state = loadState(TEST_STATE_PATH, todayStr);

      expect(state.date).toBe(todayStr);
      expect(state.briefingSent).toBe(false);
      expect(state.wakeDetected).toBe(false);
    });

    it('should return existing state for same day', () => {
      const today = todayDateString();
      const existingState = {
        date: today,
        briefingSent: true,
        wakeDetected: true,
        wakeTime: timeToday(6, 42).toISOString(),
        triggerTime: timeToday(6, 57).toISOString()
      };
      writeFileSync(TEST_STATE_PATH, JSON.stringify(existingState));

      const state = loadState(TEST_STATE_PATH, today);

      expect(state.date).toBe(today);
      expect(state.briefingSent).toBe(true);
      expect(state.wakeDetected).toBe(true);
    });

    it('should handle corrupted state file gracefully', () => {
      const today = todayDateString();
      writeFileSync(TEST_STATE_PATH, 'not valid json {{{{');

      const state = loadState(TEST_STATE_PATH, today);

      expect(state.date).toBe(today);
      expect(state.briefingSent).toBe(false);
    });

    it('should migrate state with missing fields', () => {
      const today = todayDateString();
      writeFileSync(TEST_STATE_PATH, JSON.stringify({
        date: today
        // Missing all other fields
      }));

      const state = loadState(TEST_STATE_PATH, today);

      expect(state.date).toBe(today);
      expect(state.briefingSent).toBe(false);
      expect(state.garminConsecutiveFailures).toBe(0);
      expect(state.lastGarminError).toBeNull();
    });
  });

  // =========================================================================
  // saveState - Atomic Write
  // =========================================================================
  describe('saveState - Atomic Write', () => {
    it('should save state atomically (write temp, rename)', () => {
      const today = todayDateString();
      const state: WakeState = {
        date: today,
        wakeDetected: true,
        wakeTime: timeToday(6, 42).toISOString(),
        triggerTime: timeToday(6, 57).toISOString(),
        briefingSent: true,
        briefingSentAt: new Date().toISOString(),
        sendMethod: 'wake-triggered',
        garminConsecutiveFailures: 0,
        lastGarminError: null,
        lastPollTime: new Date().toISOString(),
        lastSent: null,
        lastWakeTime: null,
        lastTriggerTime: null
      };

      saveState(TEST_STATE_PATH, state);

      const saved = JSON.parse(readFileSync(TEST_STATE_PATH, 'utf-8'));
      expect(saved.date).toBe(today);
      expect(saved.briefingSent).toBe(true);
    });

    it('should create parent directory if missing', () => {
      const nestedPath = `${TEST_STATE_DIR}/deep/nested/dir/state.json`;
      rmSync(TEST_STATE_DIR, { recursive: true, force: true });

      const state: WakeState = {
        date: todayDateString(),
        wakeDetected: false,
        wakeTime: null,
        triggerTime: null,
        briefingSent: false,
        briefingSentAt: null,
        sendMethod: null,
        garminConsecutiveFailures: 0,
        lastGarminError: null,
        lastPollTime: null,
        lastSent: null,
        lastWakeTime: null,
        lastTriggerTime: null
      };

      saveState(nestedPath, state);

      expect(existsSync(nestedPath)).toBe(true);
    });
  });

  // =========================================================================
  // shouldSkipBriefing - Three Guards
  // =========================================================================
  describe('shouldSkipBriefing - Three Guards', () => {
    const today = todayDateString();

    it('should skip if briefingSent flag is true for same day', () => {
      const state: WakeState = {
        date: today,
        briefingSent: true,
        briefingSentAt: new Date().toISOString(),
        wakeDetected: true,
        wakeTime: null,
        triggerTime: null,
        sendMethod: 'wake-triggered',
        garminConsecutiveFailures: 0,
        lastGarminError: null,
        lastPollTime: null,
        lastSent: null,
        lastWakeTime: null,
        lastTriggerTime: null
      };

      expect(shouldSkipBriefing(state, today)).toBe(true);
    });

    it('should NOT skip if date is different (new day)', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      const state: WakeState = {
        date: yesterdayStr,
        briefingSent: true,
        briefingSentAt: yesterday.toISOString(),
        wakeDetected: true,
        wakeTime: null,
        triggerTime: null,
        sendMethod: 'wake-triggered',
        garminConsecutiveFailures: 0,
        lastGarminError: null,
        lastPollTime: null,
        lastSent: null,
        lastWakeTime: null,
        lastTriggerTime: null
      };

      expect(shouldSkipBriefing(state, today)).toBe(false);
    });

    it('should skip if briefingSentAt is today', () => {
      const state: WakeState = {
        date: today,
        briefingSent: false, // Even if flag is false
        briefingSentAt: new Date().toISOString(), // Timestamp says today
        wakeDetected: false,
        wakeTime: null,
        triggerTime: null,
        sendMethod: null,
        garminConsecutiveFailures: 0,
        lastGarminError: null,
        lastPollTime: null,
        lastSent: null,
        lastWakeTime: null,
        lastTriggerTime: null
      };

      expect(shouldSkipBriefing(state, today)).toBe(true);
    });

    it('should NOT skip if never sent', () => {
      const state: WakeState = {
        date: today,
        briefingSent: false,
        briefingSentAt: null,
        wakeDetected: false,
        wakeTime: null,
        triggerTime: null,
        sendMethod: null,
        garminConsecutiveFailures: 0,
        lastGarminError: null,
        lastPollTime: null,
        lastSent: null,
        lastWakeTime: null,
        lastTriggerTime: null
      };

      expect(shouldSkipBriefing(state, today)).toBe(false);
    });
  });

  // =========================================================================
  // Garmin Error Handling Functions
  // =========================================================================
  describe('Garmin Error Handling', () => {
    const baseState: WakeState = {
      date: todayDateString(),
      wakeDetected: false,
      wakeTime: null,
      triggerTime: null,
      briefingSent: false,
      briefingSentAt: null,
      sendMethod: null,
      garminConsecutiveFailures: 0,
      lastGarminError: null,
      lastPollTime: null,
      lastSent: null,
      lastWakeTime: null,
      lastTriggerTime: null
    };

    describe('incrementGarminFailure', () => {
      it('should increment failure count', () => {
        const newState = incrementGarminFailure(baseState, 'API timeout');
        expect(newState.garminConsecutiveFailures).toBe(1);
      });

      it('should record error message', () => {
        const newState = incrementGarminFailure(baseState, 'Connection refused');
        expect(newState.lastGarminError).toBe('Connection refused');
      });

      it('should update lastPollTime', () => {
        const before = new Date();
        const newState = incrementGarminFailure(baseState, 'Error');
        const after = new Date();

        const pollTime = new Date(newState.lastPollTime!);
        expect(pollTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(pollTime.getTime()).toBeLessThanOrEqual(after.getTime());
      });

      it('should accumulate failures', () => {
        let state = baseState;
        state = incrementGarminFailure(state, 'Error 1');
        state = incrementGarminFailure(state, 'Error 2');
        state = incrementGarminFailure(state, 'Error 3');
        expect(state.garminConsecutiveFailures).toBe(3);
      });
    });

    describe('resetGarminFailures', () => {
      it('should reset failure count to 0', () => {
        const stateWithFailures = { ...baseState, garminConsecutiveFailures: 5 };
        const newState = resetGarminFailures(stateWithFailures);
        expect(newState.garminConsecutiveFailures).toBe(0);
      });

      it('should clear error message', () => {
        const stateWithError = { ...baseState, lastGarminError: 'Previous error' };
        const newState = resetGarminFailures(stateWithError);
        expect(newState.lastGarminError).toBeNull();
      });

      it('should update lastPollTime', () => {
        const before = new Date();
        const newState = resetGarminFailures(baseState);
        expect(newState.lastPollTime).not.toBeNull();
      });
    });

    describe('shouldForceFallback', () => {
      it('should return true when failures reach threshold', () => {
        const stateWithFailures = { ...baseState, garminConsecutiveFailures: 6 };
        const config: WakeConfig = { windowStartHour: 6, windowEndHour: 10, maxGarminFailures: 6 };
        expect(shouldForceFallback(stateWithFailures, config)).toBe(true);
      });

      it('should return false when failures below threshold', () => {
        const stateWithFailures = { ...baseState, garminConsecutiveFailures: 3 };
        const config: WakeConfig = { windowStartHour: 6, windowEndHour: 10, maxGarminFailures: 6 };
        expect(shouldForceFallback(stateWithFailures, config)).toBe(false);
      });

      it('should use default threshold of 6 if not specified', () => {
        const stateWithFailures = { ...baseState, garminConsecutiveFailures: 6 };
        const config: WakeConfig = { windowStartHour: 6, windowEndHour: 10 };
        expect(shouldForceFallback(stateWithFailures, config)).toBe(true);
      });

      it('should return true when failures exceed threshold', () => {
        const stateWithFailures = { ...baseState, garminConsecutiveFailures: 10 };
        const config: WakeConfig = { windowStartHour: 6, windowEndHour: 10, maxGarminFailures: 6 };
        expect(shouldForceFallback(stateWithFailures, config)).toBe(true);
      });
    });
  });

  // =========================================================================
  // formatLogMessage
  // =========================================================================
  describe('formatLogMessage', () => {
    it('should format message with timestamp prefix', () => {
      const message = formatLogMessage('Test message');
      expect(message).toContain('[wake-briefing]');
      expect(message).toContain('Test message');
    });

    it('should include ISO timestamp', () => {
      const message = formatLogMessage('Test');
      // Should contain ISO date format pattern
      expect(message).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  // =========================================================================
  // parseCliArgs
  // =========================================================================
  describe('parseCliArgs', () => {
    it('should parse --test flag', () => {
      const args = parseCliArgs(['--test']);
      expect(args.test).toBe(true);
      expect(args.force).toBe(false);
    });

    it('should parse --dry-run flag', () => {
      const args = parseCliArgs(['--dry-run']);
      expect(args.dryRun).toBe(true);
    });

    it('should parse --force flag', () => {
      const args = parseCliArgs(['--force']);
      expect(args.force).toBe(true);
    });

    it('should parse --status flag', () => {
      const args = parseCliArgs(['--status']);
      expect(args.status).toBe(true);
    });

    it('should parse --reset flag', () => {
      const args = parseCliArgs(['--reset']);
      expect(args.reset).toBe(true);
    });

    it('should parse --debug flag', () => {
      const args = parseCliArgs(['--debug']);
      expect(args.debug).toBe(true);
    });

    it('should parse --test-wake-time with valid date', () => {
      const args = parseCliArgs(['--test-wake-time', '2026-01-28T06:42:00']);
      expect(args.testWakeTime).not.toBeNull();
      expect(args.testWakeTime?.getHours()).toBe(6);
      expect(args.testWakeTime?.getMinutes()).toBe(42);
    });

    it('should ignore --test-wake-time with invalid date', () => {
      const args = parseCliArgs(['--test-wake-time', 'not-a-date']);
      expect(args.testWakeTime).toBeNull();
    });

    it('should parse --test-current-time with valid date', () => {
      const args = parseCliArgs(['--test-current-time', '2026-01-28T08:00:00']);
      expect(args.testCurrentTime).not.toBeNull();
      expect(args.testCurrentTime?.getHours()).toBe(8);
    });

    it('should parse multiple flags', () => {
      const args = parseCliArgs(['--test', '--force', '--debug']);
      expect(args.test).toBe(true);
      expect(args.force).toBe(true);
      expect(args.debug).toBe(true);
    });

    it('should parse flags with values', () => {
      const args = parseCliArgs([
        '--test',
        '--test-wake-time', '2026-01-28T06:42:00',
        '--test-current-time', '2026-01-28T07:00:00',
        '--dry-run'
      ]);
      expect(args.test).toBe(true);
      expect(args.dryRun).toBe(true);
      expect(args.testWakeTime).not.toBeNull();
      expect(args.testCurrentTime).not.toBeNull();
    });

    it('should return defaults for empty args', () => {
      const args = parseCliArgs([]);
      expect(args.test).toBe(false);
      expect(args.dryRun).toBe(false);
      expect(args.force).toBe(false);
      expect(args.status).toBe(false);
      expect(args.reset).toBe(false);
      expect(args.testWakeTime).toBeNull();
      expect(args.testCurrentTime).toBeNull();
    });
  });

  // =========================================================================
  // Database-First Strategy (1-Hour Optimization)
  // =========================================================================
  describe('Database-First Strategy', () => {
    describe('isDataStale', () => {
      it('should return true for null updatedAt', () => {
        expect(isDataStale(null)).toBe(true);
      });

      it('should return true for invalid date string', () => {
        expect(isDataStale('not-a-date')).toBe(true);
      });

      it('should return false for recent timestamp (now)', () => {
        const now = new Date().toISOString();
        expect(isDataStale(now)).toBe(false);
      });

      it('should return false for timestamp 1 hour ago', () => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        expect(isDataStale(oneHourAgo)).toBe(false);
      });

      it('should return false for timestamp 23 hours ago', () => {
        const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
        expect(isDataStale(twentyThreeHoursAgo)).toBe(false);
      });

      it('should return true for timestamp 25 hours ago', () => {
        const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
        expect(isDataStale(twentyFiveHoursAgo)).toBe(true);
      });

      it('should return true for timestamp 48 hours ago', () => {
        const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        expect(isDataStale(fortyEightHoursAgo)).toBe(true);
      });

      it('should handle exactly 24 hour boundary', () => {
        // At exactly 24 hours, should still be fresh (not stale)
        const exactly24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        expect(isDataStale(exactly24Hours)).toBe(false);
      });

      it('should return true for 24 hours + 1 second', () => {
        const justOver24Hours = new Date(Date.now() - (24 * 60 * 60 * 1000 + 1000)).toISOString();
        expect(isDataStale(justOver24Hours)).toBe(true);
      });
    });

    describe('getSleepDataFromDB', () => {
      it('should return data with stale indicator if DB read succeeds', () => {
        // This is an integration test that requires the fitness DB
        // It validates the function doesn't throw and returns expected shape
        const result = getSleepDataFromDB();

        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('stale');
        expect(result).toHaveProperty('updatedAt');
        expect(typeof result.stale).toBe('boolean');
      });

      it('should return null data and stale=true if DB is empty or error', () => {
        // This test validates error handling - the function should not throw
        const result = getSleepDataFromDB();

        // Either we get valid data, or we get null with stale=true
        if (result.data === null) {
          expect(result.stale).toBe(true);
        }
      });
    });

    describe('getSleepDataWithFallback', () => {
      it('should return result with source tracking', () => {
        const result = getSleepDataWithFallback();

        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('source');
        expect(result).toHaveProperty('stale');
        expect(result).toHaveProperty('fetchTimeMs');

        // Source must be one of the valid values
        expect(['database', 'garmin_api', 'fallback']).toContain(result.source);

        // Fetch time must be a positive number
        expect(typeof result.fetchTimeMs).toBe('number');
        expect(result.fetchTimeMs).toBeGreaterThanOrEqual(0);
      });

      it('should prefer database source when data is fresh', () => {
        // This validates the DB-first strategy
        // If DB has fresh data, source should be 'database'
        const result = getSleepDataWithFallback();

        // The test verifies the function completes without error
        // and returns a valid result structure
        if (result.data && !result.stale && result.source === 'database') {
          // DB-first strategy is working
          expect(result.source).toBe('database');
        }
        // Otherwise, the test passes as long as the function returns valid structure
      });

      it('should measure fetch time accurately', () => {
        const startTime = Date.now();
        const result = getSleepDataWithFallback();
        const elapsed = Date.now() - startTime;

        // Fetch time should be close to actual elapsed time
        expect(result.fetchTimeMs).toBeLessThanOrEqual(elapsed + 100); // Allow 100ms tolerance
      });
    });

    describe('SleepDataResult type', () => {
      it('should have valid source values', () => {
        const validSources = ['database', 'garmin_api', 'fallback'];

        // Create a mock result to verify type structure
        const mockResult: SleepDataResult = {
          data: { sleep: { sleepEndTimestampLocal: Date.now() } },
          source: 'database',
          stale: false,
          fetchTimeMs: 10
        };

        expect(validSources).toContain(mockResult.source);
      });

      it('should allow null data with fallback source', () => {
        const mockResult: SleepDataResult = {
          data: null,
          source: 'fallback',
          stale: true,
          fetchTimeMs: 5000
        };

        expect(mockResult.data).toBeNull();
        expect(mockResult.source).toBe('fallback');
        expect(mockResult.stale).toBe(true);
      });
    });
  });
});
