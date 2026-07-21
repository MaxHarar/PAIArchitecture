#!/usr/bin/env python3
"""
GarminSync - Pull data from Garmin Connect

Usage:
    python GarminSync.py [--days N] [--output json|text]

Examples:
    python GarminSync.py                    # Last 7 days, text output
    python GarminSync.py --days 14          # Last 14 days
    python GarminSync.py --output json      # JSON output for parsing
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta

try:
    from garminconnect import Garmin
except ImportError:
    print("ERROR: garminconnect not installed. Run: pip install garminconnect")
    sys.exit(1)

# Configuration
# DEPRECATED: This Python script is replaced by the TypeScript Garmin sync service.
# Credentials are now stored in macOS Keychain (account: garmin-fitness-sync, service: com.pai.fitness)
# Use: cd ~/.claude/fitness && bun run garmin:sync
GARMIN_EMAIL = os.environ.get("GARMIN_EMAIL", "")
GARMIN_PASSWORD = os.environ.get("GARMIN_PASSWORD", "")
TOKEN_DIR = os.path.expanduser("~/.claude/garmin-tokens")


def get_client():
    """Authenticate with Garmin Connect."""
    client = Garmin(GARMIN_EMAIL, GARMIN_PASSWORD)
    client.login()

    # Save tokens
    os.makedirs(TOKEN_DIR, exist_ok=True)
    client.garth.dump(TOKEN_DIR)

    return client


def get_activities(client, days=7):
    """Get activities for the past N days."""
    today = datetime.now()
    start_date = (today - timedelta(days=days)).strftime("%Y-%m-%d")
    end_date = today.strftime("%Y-%m-%d")

    return client.get_activities_by_date(start_date, end_date)


def get_sleep_data(client, days=7):
    """Get sleep data for the past N days.

    Searches back up to N days to find the most recent night with
    actual recorded sleep data (some nights may have no data if
    the watch wasn't worn).
    """
    sleep_records = []

    # Search back through days to find nights with actual sleep data
    # Start from i=0 (today) because last night's sleep is recorded under today's date
    for i in range(0, days):
        target_date = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
        try:
            sleep_data = client.get_sleep_data(target_date)
            if sleep_data:
                # Check if there's actual sleep data (not just empty record)
                daily_sleep = sleep_data.get('dailySleepDTO', {})
                if daily_sleep.get('sleepTimeSeconds'):
                    sleep_records.append({
                        'date': target_date,
                        'raw': sleep_data
                    })
        except Exception:
            # Silently skip dates with no sleep data
            pass

    return sleep_records


def format_sleep(sleep_records):
    """Format sleep data for output.

    Returns the most recent sleep record with actual data.
    """
    if not sleep_records:
        return None

    # Get the most recent sleep record with actual data
    latest = sleep_records[0].get('raw', {})

    # Extract dailySleepDTO (Garmin wraps data in this)
    daily_sleep = latest.get('dailySleepDTO', latest)

    return {
        'date': sleep_records[0].get('date'),
        'sleepTimeSeconds': daily_sleep.get('sleepTimeSeconds'),
        'deepSleepSeconds': daily_sleep.get('deepSleepSeconds'),
        'lightSleepSeconds': daily_sleep.get('lightSleepSeconds'),
        'remSleepSeconds': daily_sleep.get('remSleepSeconds'),
        'awakeSleepSeconds': daily_sleep.get('awakeSleepSeconds'),
        'sleepStartTimestampLocal': daily_sleep.get('sleepStartTimestampLocal'),
        'sleepEndTimestampLocal': daily_sleep.get('sleepEndTimestampLocal'),
    }


def format_activity(act):
    """Format a single activity for display."""
    name = act.get('activityName', 'Unknown')
    act_type = act.get('activityType', {}).get('typeKey', 'unknown')
    date = act.get('startTimeLocal', '')[:10]
    distance = act.get('distance', 0) / 1609.34  # meters to miles
    duration = act.get('duration', 0) / 60  # seconds to minutes
    avg_hr = act.get('averageHR', 0)
    max_hr = act.get('maxHR', 0)
    calories = act.get('calories', 0)

    # Calculate pace for running activities
    pace_str = ""
    if 'running' in act_type and distance > 0:
        pace = duration / distance
        pace_min = int(pace)
        pace_sec = int((pace - pace_min) * 60)
        pace_str = f" | {pace_min}:{pace_sec:02d}/mi"

    return {
        'date': date,
        'type': act_type,
        'name': name,
        'distance_mi': round(distance, 2),
        'duration_min': round(duration, 1),
        'avg_hr': int(avg_hr) if avg_hr else None,
        'max_hr': int(max_hr) if max_hr else None,
        'calories': int(calories) if calories else None,
        'pace': pace_str.strip(' |') if pace_str else None
    }


def get_hrv_data(client, days=7):
    """Fetch HRV data from Garmin Connect.

    Searches back up to N days to find the most recent night with HRV data.
    Returns dict with weeklyAvg, lastNightAvg, status, and baseline info.
    Status comes directly from Garmin API (BALANCED, LOW, POOR, etc).
    """
    try:
        # Search back through days to find the most recent HRV data
        for i in range(days):
            target_date = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
            hrv_response = client.get_hrv_data(target_date)

            if hrv_response and hrv_response.get('hrvSummary'):
                hrv_summary = hrv_response['hrvSummary']

                weekly_avg = hrv_summary.get('weeklyAvg')
                last_night_avg = hrv_summary.get('lastNightAvg')
                baseline = hrv_summary.get('baseline', {})

                # Use Garmin's native status (BALANCED, LOW, POOR, etc)
                # and format it nicely (Title Case)
                raw_status = hrv_summary.get('status', 'Unknown')
                status = raw_status.replace('_', ' ').title()

                return {
                    'date': target_date,
                    'weeklyAvg': round(weekly_avg) if weekly_avg else None,
                    'lastNightAvg': round(last_night_avg) if last_night_avg else None,
                    'status': status,
                    'baseline': {
                        'balancedLow': round(baseline.get('balancedLow')) if baseline.get('balancedLow') else None,
                        'balancedUpper': round(baseline.get('balancedUpper')) if baseline.get('balancedUpper') else None
                    } if baseline else None
                }

        # No HRV data found in the search period
        return None

    except Exception as e:
        # Log error but don't fail the whole script
        print(f"Warning: Could not fetch HRV data: {e}", file=sys.stderr)
        return None


def get_recovery_data(client):
    """Get recovery data including body battery, training readiness, and resting HR.

    Tries today first, falls back to recent days if no data available.
    Returns tuple of (recovery_dict, resting_hr).
    """
    today = datetime.now()

    recovery = {
        'score': None,
        'level': None,
        'bodyBattery': None,
        'sleepScore': None,
        'hrvWeeklyAverage': None
    }
    resting_hr = None

    # Try recent days to find data (today might not have data yet)
    for days_ago in range(0, 7):
        date = (today - timedelta(days=days_ago)).strftime('%Y-%m-%d')

        # Get user summary for body battery and resting HR
        try:
            summary = client.get_user_summary(date)
            if summary:
                # Resting HR
                if resting_hr is None and summary.get('restingHeartRate'):
                    resting_hr = summary.get('restingHeartRate')

                # Body battery
                if recovery['bodyBattery'] is None:
                    bb = summary.get('bodyBatteryMostRecentValue')
                    if bb is not None:
                        recovery['bodyBattery'] = bb
        except Exception:
            pass

        # Get training readiness for recovery score
        try:
            if recovery['score'] is None:
                tr = client.get_morning_training_readiness(date)
                if tr and isinstance(tr, dict):
                    recovery['score'] = tr.get('score')
                    recovery['level'] = tr.get('level')
                    recovery['sleepScore'] = tr.get('sleepScore')
                    recovery['hrvWeeklyAverage'] = tr.get('hrvWeeklyAverage')
        except Exception:
            pass

        # If we have both key pieces of data, stop searching
        if recovery['score'] is not None and resting_hr is not None:
            break

    return recovery, resting_hr


def get_stats(activities):
    """Calculate summary statistics."""
    running_miles = 0
    running_time = 0
    strength_sessions = 0
    yoga_sessions = 0
    total_calories = 0
    total_duration = 0

    for act in activities:
        act_type = act.get('activityType', {}).get('typeKey', '')
        distance = act.get('distance', 0) / 1609.34
        duration = act.get('duration', 0) / 60
        calories = act.get('calories', 0)

        total_duration += duration
        total_calories += calories

        if 'running' in act_type:
            running_miles += distance
            running_time += duration
        if 'strength' in act_type:
            strength_sessions += 1
        if 'yoga' in act_type:
            yoga_sessions += 1

    return {
        'running_miles': round(running_miles, 1),
        'running_time_min': round(running_time, 0),
        'strength_sessions': strength_sessions,
        'yoga_sessions': yoga_sessions,
        'total_activities': len(activities),
        'total_duration_min': round(total_duration, 0),
        'total_calories': int(total_calories)
    }


def main():
    parser = argparse.ArgumentParser(description='Sync Garmin Connect data')
    parser.add_argument('--days', type=int, default=7, help='Number of days to pull (default: 7)')
    parser.add_argument('--output', choices=['json', 'text'], default='text', help='Output format')
    args = parser.parse_args()

    try:
        client = get_client()
        activities = get_activities(client, args.days)
        sleep_records = get_sleep_data(client, args.days)
        hrv = get_hrv_data(client)
        recovery, resting_hr = get_recovery_data(client)

        formatted = [format_activity(a) for a in activities]
        stats = get_stats(activities)
        sleep = format_sleep(sleep_records)

        result = {
            'user': client.get_full_name(),
            'period_days': args.days,
            'recovery': recovery,
            'restingHR': resting_hr,
            'hrv': hrv,
            'sleep': sleep,
            'stats': stats,
            'activities': formatted
        }

        if args.output == 'json':
            print(json.dumps(result, indent=2))
        else:
            # Text output
            print("=" * 60)
            print(f"GARMIN DATA: {result['user']} (Last {args.days} days)")
            print("=" * 60)

            # Sleep summary
            if sleep:
                print(f"\nSLEEP (last night):")
                total_hrs = (sleep.get('sleepTimeSeconds') or 0) / 3600
                deep_hrs = (sleep.get('deepSleepSeconds') or 0) / 3600
                rem_hrs = (sleep.get('remSleepSeconds') or 0) / 3600
                light_hrs = (sleep.get('lightSleepSeconds') or 0) / 3600
                print(f"  Total: {total_hrs:.1f} hrs")
                print(f"  Deep: {deep_hrs:.1f} hrs | REM: {rem_hrs:.1f} hrs | Light: {light_hrs:.1f} hrs")

            # Recovery summary
            if recovery.get('score') is not None or resting_hr is not None:
                print(f"\nRECOVERY:")
                if recovery.get('score') is not None:
                    print(f"  Training Readiness: {recovery['score']}/100 ({recovery.get('level', 'Unknown')})")
                if recovery.get('bodyBattery') is not None:
                    print(f"  Body Battery: {recovery['bodyBattery']}/100")
                if resting_hr is not None:
                    print(f"  Resting HR: {resting_hr} bpm")
                if recovery.get('sleepScore') is not None:
                    print(f"  Sleep Score: {recovery['sleepScore']}/100")

            # HRV summary
            if hrv:
                print(f"\nHRV STATUS:")
                print(f"  Weekly Average: {hrv.get('weeklyAvg', 'N/A')} ms")
                print(f"  Last Night: {hrv.get('lastNightAvg', 'N/A')} ms")
                print(f"  Status: {hrv.get('status', 'Unknown')}")
                if hrv.get('baseline'):
                    baseline = hrv['baseline']
                    if baseline.get('balancedLow') and baseline.get('balancedUpper'):
                        print(f"  Baseline Range: {baseline['balancedLow']}-{baseline['balancedUpper']} ms")

            print(f"\nACTIVITY SUMMARY:")
            print(f"  Running: {stats['running_miles']} miles in {stats['running_time_min']:.0f} min")
            print(f"  Strength: {stats['strength_sessions']} sessions")
            print(f"  Yoga: {stats['yoga_sessions']} sessions")
            print(f"  Total: {stats['total_activities']} activities, {stats['total_duration_min']:.0f} min, {stats['total_calories']} cal")

            print(f"\nACTIVITIES:")
            for act in formatted:
                hr_str = f"HR:{act['avg_hr']}/{act['max_hr']}" if act['avg_hr'] else ""
                dist_str = f"{act['distance_mi']}mi" if act['distance_mi'] > 0 else ""
                pace_str = act['pace'] if act['pace'] else ""

                parts = [act['date'], act['type'][:12].ljust(12), dist_str, f"{act['duration_min']:.0f}min", pace_str, hr_str]
                print(f"  {' | '.join(p for p in parts if p)}")

            print("=" * 60)

    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
