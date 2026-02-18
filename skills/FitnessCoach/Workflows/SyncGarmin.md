# SyncGarmin Workflow

Pull latest data from Garmin Connect and provide analysis.

## Steps

### 1. Authenticate and Pull Data

```bash
python ~/.claude/skills/FitnessCoach/Tools/GarminSync.py --days 7
```

For longer analysis:
```bash
python ~/.claude/skills/FitnessCoach/Tools/GarminSync.py --days 14 --output json
```

### 2. Analyze Training Load

**Weekly Running Volume:**
- Target: 15-30 miles (based on current fitness)
- Progressive overload: +10% max per week

**Run Metrics to Check:**
- Easy runs: HR should be < 150 bpm, pace 9:30-10:30/mi
- Quality runs: HR in zones 3-4, pace 8:00-9:00/mi
- Long runs: Start easy, finish moderate

**Strength Training:**
- Target: 3-4 sessions/week
- Track: consistency and duration

### 3. Identify Patterns

Look for:
- Overtraining signs (high HR on easy runs)
- Under-recovery (multiple hard days in a row)
- Missing workout types
- Schedule gaps

### 4. Provide Insights

Report should include:
- Weekly totals vs targets
- Pace trends
- HR zone distribution
- Recommendations for next week

## JSON Output Schema

```json
{
  "user": "Name",
  "period_days": 7,
  "stats": {
    "running_miles": 10.5,
    "running_time_min": 100,
    "strength_sessions": 4,
    "yoga_sessions": 1,
    "total_activities": 8,
    "total_duration_min": 289,
    "total_calories": 1500
  },
  "activities": [
    {
      "date": "2026-01-22",
      "type": "running",
      "name": "Easy Run",
      "distance_mi": 3.4,
      "duration_min": 33,
      "avg_hr": 136,
      "max_hr": 169,
      "pace": "9:38/mi"
    }
  ]
}
```
