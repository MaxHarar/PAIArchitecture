---
name: MorningPrescription
description: Generate and send daily workout prescription each morning
trigger: cron (6:00 AM daily)
---

# Morning Workout Prescription Workflow

Automated workflow that runs each morning at 6:00 AM to:
1. Collect subjective wellness data (if not already completed today)
2. Generate intelligent workout prescription for today
3. Format for Telegram with human-readable message
4. Send via Telegram bot
5. Save prescription to database for tracking

## Workflow Steps

### 1. Run Wellness Questionnaire (If Not Already Completed Today)

**Phase 1.1 Enhancement**: Collect subjective wellness data before prescription generation.

Research shows HRV alone has 30% error rate. Multi-metric approach (HRV + subjective wellness) provides better readiness assessment.

**Telegram Prompt:**
```
Morning Check-In:

Rate 1-10:
- Sleep quality:
- Muscle soreness:
- Stress level:
- Mood:
```

**CLI Command:**
```bash
# Check if wellness data exists for today
bun run ~/.claude/skills/FitnessCoach/Tools/wellness-check.ts --prompt

# Submit wellness data
bun run ~/.claude/skills/FitnessCoach/Tools/wellness-check.ts \
  --sleep 7 --soreness 3 --stress 4 --mood 8

# With notes
bun run ~/.claude/skills/FitnessCoach/Tools/wellness-check.ts \
  --sleep 7 --soreness 3 --stress 4 --mood 8 \
  --notes "Feeling good after rest day"
```

**Wellness Score Calculation:**
- Sleep quality (1-10): Higher is better
- Muscle soreness (1-10): Lower is better (inverted in score)
- Stress level (1-10): Lower is better (inverted in score)
- Mood (1-10): Higher is better
- Composite score: Scaled average on 0-100 scale

**Integration with Readiness:**
- Wellness contributes 20% to overall readiness score
- Conflicts between HRV (objective) and wellness (subjective) are resolved by trusting wellness
- If HRV > 80 but wellness < 40 -> recommend rest despite good HRV
- If HRV < 60 but wellness > 75 -> allow light training despite low HRV

### 2. Check for Existing Prescription

```typescript
const db = getDatabase();
const today = new Date().toISOString().split('T')[0];

const existing = db.queryOne(
  `SELECT id FROM workout_prescriptions
   WHERE scheduled_date = ? AND status != 'skipped'`,
  [today]
);

if (existing) {
  console.log('Prescription already exists for today');
  return;
}
```

### 3. Generate Prescription

```bash
bun run ~/.claude/skills/FitnessCoach/CLI/prescribe.ts prescribe
```

This will:
- Analyze current recovery metrics (HRV, sleep, body battery)
- **Integrate wellness questionnaire data (Phase 1.1)**
- Calculate training load and ACWR
- Determine periodization phase and targets
- Select optimal workout template
- Generate specific prescription with reasoning
- **Apply HRV-wellness conflict resolution when signals disagree**

### 4. Format for Telegram

The CLI tool automatically formats the prescription using the Telegram formatter, which creates:
- Morning greeting
- **Wellness summary (Phase 1.1)**
- Workout details (name, duration, HR zones)
- Reasoning (why this workout today)
- **HRV-wellness conflict explanation if applicable**
- Load context (ACWR, weekly progress)
- Alternatives if needed

### 5. Send Notification

```bash
# Send via Telegram bot
PRESCRIPTION_ID=$(sqlite3 ~/.claude/fitness/workouts.db "SELECT id FROM workout_prescriptions WHERE scheduled_date = date('now') ORDER BY created_at DESC LIMIT 1")

# Format message
MESSAGE=$(bun run ~/.claude/skills/FitnessCoach/Notifications/prescription-formatter.ts $PRESCRIPTION_ID)

# Send (TODO: integrate with Telegram bot)
# curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
#   -d "chat_id=${CHAT_ID}" \
#   -d "text=${MESSAGE}" \
#   -d "parse_mode=HTML"
```

## Manual Usage

Generate prescription for any date:

```bash
# Today
bun run ~/.claude/skills/FitnessCoach/CLI/prescribe.ts prescribe

# Specific date
bun run ~/.claude/skills/FitnessCoach/CLI/prescribe.ts prescribe --date 2026-01-28

# With Telegram notification
bun run ~/.claude/skills/FitnessCoach/CLI/prescribe.ts prescribe --notify

# View upcoming prescriptions
bun run ~/.claude/skills/FitnessCoach/CLI/prescribe.ts upcoming 7
```

## User Interaction

After receiving the prescription, users can interact:

**Mark as completed:**
```bash
bun run ~/.claude/skills/FitnessCoach/CLI/prescribe.ts complete <workout_id>
```

**Provide feedback:**
```bash
bun run ~/.claude/skills/FitnessCoach/CLI/prescribe.ts feedback <workout_id> perfect
bun run ~/.claude/skills/FitnessCoach/CLI/prescribe.ts feedback <workout_id> too_hard "Legs felt heavy"
bun run ~/.claude/skills/FitnessCoach/CLI/prescribe.ts feedback <workout_id> too_easy
```

**Via Telegram (reply to workout message):**
- "done" → marks completed
- "skip" → marks skipped
- "hard" → feedback: too hard
- "easy" → feedback: too easy
- "perfect" → feedback: just right

## Integration Points

### Garmin Sync Integration

After Garmin sync completes, automatically:
1. Link new workout to prescription if date matches
2. Calculate compliance score (actual vs prescribed)
3. Update training load tables
4. Recalculate ACWR
5. Adjust future prescriptions based on actual execution

### Recovery Metrics Integration

Daily metrics (HRV, sleep, body battery) flow into prescription:
1. Morning: Metrics synced from Garmin
2. Prescription engine reads latest metrics
3. Readiness score calculated
4. Prescription adapted based on recovery state

### Goal Integration

Active goals drive periodization:
1. Goal defines timeline (e.g., half marathon in 12 weeks)
2. Periodization engine calculates current phase
3. Phase determines workout type priorities
4. Weekly load targets set based on phase

## Feedback Loop

The system learns from your behavior:

**Preference Learning:**
- Which templates you complete vs skip
- Difficulty ratings (too hard/easy/perfect)
- Day/time preferences based on completion rates
- Recovery impact tracking

**Adaptive Adjustments:**
- If multiple "too hard" ratings → reduce intensity
- If consistently skipping a template → lower priority
- If completing beyond targets → increase challenge
- If poor recovery after certain workouts → add recovery days

## Safety Mechanisms

**Hard Stops:**
- HRV < 85% baseline → rest or easy only
- ACWR > 1.5 → rest or easy only
- Body battery < 30 → rest day prescribed
- Sleep score < 60 + Body battery < 50 → easy maximum
- **Wellness score < 40 → rest day prescribed (Phase 1.1)**

**Progressive Checks:**
- Recovery score < 75 → no intensity work
- ACWR > 1.3 → easy workouts only
- < 2 days since last hard workout → no intensity
- **HRV-wellness conflict (>20 point difference) → trust wellness (Phase 1.1)**

**Phase 1.1 Conflict Resolution:**
- If HRV > 80 but wellness < 40: Trust wellness, recommend rest
- If HRV < 60 but wellness > 75: Trust wellness, allow light training
- Research shows HRV has ~30% error rate; subjective feel is often more accurate

## Testing

Run test suite to verify all components:

```bash
cd ~/.claude/skills/FitnessCoach
bun test Tests/load-calculator.test.ts
bun test Tests/periodization-engine.test.ts
bun test Tests/prescription-engine.test.ts
```

## Maintenance

**Weekly:**
- Review compliance rate
- Check ACWR trends
- Verify prescription quality

**Monthly:**
- Analyze preference learning accuracy
- Review goal progress
- Adjust templates if needed

**Quarterly:**
- Update workout template library
- Refine periodization parameters
- Review injury prevention effectiveness

## Future Enhancements

1. **Multi-sport support** - cycling, swimming, etc.
2. **Race day strategy** - pacing, nutrition, warmup
3. **Weather integration** - adjust for heat, cold, wind
4. **Calendar integration** - avoid conflicts with meetings
5. **Group training** - coordinate with training partners
6. **Equipment tracking** - shoe mileage, bike maintenance
7. **Nutrition recommendations** - fuel for workout type
8. **Sleep recommendations** - optimize recovery
