# Stats Workflow

Pull and display comprehensive fitness statistics from Garmin, including recovery metrics.

## Steps

### 1. Pull Training Readiness

```bash
bun ~/.claude/skills/FitnessCoach/Tools/training-readiness.ts --days 7 --output json
```

Get current recovery status:
- Overall readiness score
- Component scores (sleep, HRV, body battery, RHR)
- 7-day trend
- Any concerns flagged

### 2. Pull Activity Data

```bash
python ~/.claude/skills/FitnessCoach/Tools/GarminSync.py --days 7 --output json
```

### 3. Calculate Activity Metrics

**Running Metrics:**
- Weekly mileage
- Average pace (easy vs quality)
- Average HR by run type
- Pace:HR ratio (efficiency indicator)

**Training Load:**
- Total duration
- Session count by type
- Calories burned

**Trends (if pulling 14+ days):**
- Week-over-week mileage change
- Pace improvement
- HR efficiency changes

### 4. Display Dashboard

```
================================================================
                    FITNESS DASHBOARD
================================================================
  TODAY'S READINESS: 94/100 [READY]
  ----------------------------------------------------------
  Sleep: 80  |  HRV: 100  |  Body Battery: 100  |  RHR: 100
  Trend: STABLE  |  Concerns: None
  ----------------------------------------------------------

  LAST 7 DAYS - ACTIVITIES
  ----------------------------------------------------------
  Running     |  10.5 mi  |  3 runs    |  9:15/mi avg
  Strength    |  4 sessions  |  168 min
  Recovery    |  1 session   |  25 min
  ----------------------------------------------------------
  TOTALS
  Activities: 8  |  Duration: 289 min  |  Calories: 1,847
================================================================

  RECOVERY METRICS (7 days)
  ----------------------------------------------------------
  Date       | Sleep | HRV  | Battery | RHR | Status
  ----------------------------------------------------------
  2026-01-27 |   80  |  93  |    99   |  41 | READY
  2026-01-26 |   98  |  85  |   100   |  40 | READY
  2026-01-25 |   57  |  54  |    36   |  48 | LIGHT
  2026-01-24 |   73  |  73  |    85   |  47 | READY
  2026-01-23 |   70  |  63  |    69   |  46 | LIGHT
================================================================
```

### 5. Run Analysis

**Activity Analysis:**

For each run, show:
| Date | Distance | Pace | Avg HR | Max HR | Type |
|------|----------|------|--------|--------|------|
| 01-22 | 3.4 mi | 9:38 | 136 | 169 | Easy |
| 01-21 | 4.1 mi | 8:55 | 152 | 196 | Tempo |

**Recovery Analysis:**

| Metric | 7-Day Avg | Today | Trend |
|--------|-----------|-------|-------|
| Sleep Score | 74 | 80 | UP |
| HRV (RMSSD) | 76 | 93 | UP |
| Body Battery | 78 | 99 | UP |
| Resting HR | 44 | 41 | GOOD |

### 6. Recommendations

**Training Recommendations:**
- If easy runs > 150 HR: "Slow down easy runs"
- If < 3 runs/week: "Add another easy run"
- If no speed work: "Consider adding intervals"
- If > 4 strength sessions: "Good consistency!"

**Recovery Recommendations:**
- If readiness declining: "Prioritize sleep and recovery"
- If HRV below baseline: "Reduce intensity this week"
- If body battery consistently low: "Check for overtraining"
- If RHR elevated: "Monitor for illness, reduce volume"

## Data Sources

- **Activities**: GarminSync.py -> Garmin Connect API
- **Recovery Metrics**: training-readiness.ts -> `~/.claude/fitness/workouts.db`
- **Database Table**: `daily_metrics`
