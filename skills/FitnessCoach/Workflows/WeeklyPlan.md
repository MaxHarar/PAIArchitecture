# WeeklyPlan Workflow

Create a personalized weekly training plan based on Garmin data, recovery metrics, and user preferences.

## Steps

### 1. Check Training Readiness

```bash
bun ~/.claude/skills/FitnessCoach/Tools/training-readiness.ts --output json
```

Assess current recovery status:
- **Overall readiness score** (0-100)
- **Recommendation**: ready / light / rest
- **Trend**: improving / stable / declining
- **Concerns**: elevated RHR, low HRV, poor sleep, etc.

**Apply readiness to plan:**

| Readiness | Planning Adjustment |
|-----------|---------------------|
| READY (75+) | Normal training load, quality sessions OK |
| LIGHT (50-74) | Reduce intensity, swap quality for easy |
| REST (<50) | Recovery week, minimal volume |

### 2. Pull Garmin Activity Data

```bash
python ~/.claude/skills/FitnessCoach/Tools/GarminSync.py --days 14 --output json
```

Analyze:
- Recent mileage and training load
- Run paces and heart rates
- Strength session frequency
- Recovery patterns from activities

### 3. Check Current Calendar

```bash
gcalcli agenda --calendar "75 hard" --calendar "Runna" "today" "+7 days"
```

Identify:
- Pre-existing commitments
- Runna scheduled workouts
- Conflicts to resolve

### 3. Apply Weekly Template

**Max's Preferred Structure:**

| Day | AM Session | PM Session |
|-----|------------|------------|
| Monday | REST or Light | — |
| Tuesday | Legs | Recovery |
| Wednesday | Chest | Speed Work |
| Thursday | Easy Run | Back |
| Friday | Full Body | Recovery |
| Saturday | Long Run | — |
| Sunday | REST | — |

### 5. Adjust Based on Data

**Mileage Progression:**
- If last week < 15 miles: Keep same or +10%
- If last week 15-25 miles: Can increase by 10%
- If last week > 25 miles: Consider recovery week

**Intensity Distribution:**
- 80% easy/conversational runs
- 20% quality (tempo, intervals, long run)

**Recovery-Based Adjustments (from Training Readiness):**

| Readiness Concern | Action |
|-------------------|--------|
| `poor_sleep` | No quality sessions until sleep improves |
| `low_hrv` | Reduce intensity, favor easy runs |
| `elevated_rhr` | Check for illness, reduce volume 20% |
| `low_body_battery` | Recovery day, prioritize sleep |
| Declining trend | Back-to-back easy days, no intervals |

**Recovery Needs:**
- If readiness < 50 for 2+ days: Consider recovery week
- If multiple concerns flagged: Skip quality session
- If trend declining: Reduce weekly volume by 20%

### 6. Create Events in Calendar

Use gcalcli to add events:

```bash
gcalcli add --calendar "75 hard" \
  --title "Workout Name" \
  --when "Date Time" \
  --duration MINUTES \
  --description "Detailed workout" \
  --noprompt
```

### 7. Update Training Plan File

Save to: `~/.claude/training-plan-{start}-{end}.md`

Include:
- Daily breakdown with exercises
- Pace targets based on recent data
- Weekly totals
- Notes on focus areas

## Output

1. Calendar events created
2. Training plan markdown file
3. Summary of the week ahead
