# TrainingReadiness Workflow

Assess training readiness based on daily recovery metrics (sleep, HRV, body battery, resting HR).

## Purpose

Provide data-driven training recommendations by analyzing recovery metrics from the fitness database. This ensures workouts are scheduled appropriately based on actual recovery status, not just calendar availability.

## Steps

### 1. Run Training Readiness Assessment

```bash
bun ~/.claude/skills/FitnessCoach/Tools/training-readiness.ts
```

Or with options:

```bash
# JSON output for programmatic use
bun ~/.claude/skills/FitnessCoach/Tools/training-readiness.ts --output json

# Extended trend analysis (14 days)
bun ~/.claude/skills/FitnessCoach/Tools/training-readiness.ts --days 14
```

### 2. Interpret Results

**Readiness Levels:**

| Overall Score | Status | Recommendation |
|--------------|--------|----------------|
| 75-100 | READY | Quality training (tempo, intervals, long runs, heavy lifting) |
| 50-74 | LIGHT | Easy efforts only (recovery runs, light mobility, yoga) |
| 0-49 | REST | Full rest or very light activity (walk, stretch) |

**Component Scores:**

- **Sleep (30%)**: Quality and duration of last night's sleep
- **HRV (30%)**: Heart rate variability indicates autonomic recovery
- **Body Battery (25%)**: Garmin's energy reserve metric
- **Resting HR (15%)**: Elevated RHR suggests incomplete recovery

### 3. Apply to Training Decisions

**If READY:**
- Proceed with planned quality sessions
- Good day for PR attempts or challenging workouts
- Can handle higher volume/intensity

**If LIGHT:**
- Swap quality session for easy run/recovery
- Reduce planned intensity by 20-30%
- Keep strength sessions but lower weight/volume

**If REST:**
- Skip planned workouts
- Focus on sleep, nutrition, hydration
- Light walking or stretching only
- Check if illness/overtraining symptoms present

### 4. Check for Concerning Patterns

Watch for these flags in the output:

- `poor_sleep` - Sleep score below 55
- `insufficient_sleep_duration` - Less than 6 hours
- `low_hrv` - HRV status is 'low' or 'poor'
- `hrv_below_baseline` - HRV below personal baseline
- `low_body_battery` - Body battery below 40
- `elevated_rhr` - Resting HR elevated above normal

**Multiple concerns = likely need rest regardless of overall score**

## Integration with Other Workflows

### WeeklyPlan Integration

Run TrainingReadiness **before** WeeklyPlan to adjust the upcoming plan:

```bash
# First check readiness
bun ~/.claude/skills/FitnessCoach/Tools/training-readiness.ts --output json

# Then plan week with that context
# (WeeklyPlan will use this data to adjust recommendations)
```

### Stats Integration

TrainingReadiness data is displayed as part of Stats workflow's recovery section.

## Data Sources

- **Database**: `~/.claude/fitness/workouts.db`
- **Table**: `daily_metrics`
- **Sync**: Data comes from GarminSync tool (SyncGarmin workflow)

## Example Output

```
============================================================
  TRAINING READINESS ASSESSMENT
============================================================
  Date: 2026-01-27
  Data Quality: COMPLETE
------------------------------------------------------------

  OVERALL READINESS: 94/100
  Status: READY
  Trend (7d): STABLE

  COMPONENT SCORES:
    Sleep:        80/100
    HRV:          100/100
    Body Battery: 100/100
    Resting HR:   100/100

------------------------------------------------------------
  RECOMMENDATION:
  You're well-recovered (94/100). Great day for quality training.

  SUGGESTED WORKOUTS:
    - quality session
    - tempo run
    - speed work
    - long run

------------------------------------------------------------
  RECENT METRICS (last 5 days):

  Date       | Sleep | HRV  | Battery | RHR
  ------------------------------------------------
  2026-01-27 |   80  |  93  |    99   |  41
  2026-01-26 |   98  |  85  |   100   |  40
  2026-01-25 |   57  |  54  |    36   |  48
============================================================
```
