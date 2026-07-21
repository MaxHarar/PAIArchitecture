# UpdateCalendar Workflow

Add, modify, or delete workout events in Google Calendar.

## Prerequisites

gcalcli must be authenticated. Test with:
```bash
gcalcli list
```

## Calendars

| Calendar | Purpose |
|----------|---------|
| 75 hard | All workouts (strength, recovery, runs) |
| Runna | Running workouts only (for Runna app sync) |

## Add Event

```bash
gcalcli add --calendar "75 hard" \
  --title "Workout Title" \
  --when "Jan 27 2026 6:45am" \
  --duration 60 \
  --description "Workout details here" \
  --noprompt
```

**For running workouts, also add to Runna:**
```bash
gcalcli add --calendar "Runna" \
  --title "Run Title" \
  --when "Jan 27 2026 6:45am" \
  --duration 45 \
  --description "Run details" \
  --noprompt
```

## Delete Event

Delete requires interactive confirmation. Use expect:

```bash
expect << 'EOF'
set timeout 30
spawn gcalcli delete --calendar "75 hard" "Event Name"
expect "Delete?"
send "y\r"
expect eof
EOF
```

**To skip specific events (keep first, delete second):**
```bash
expect << 'EOF'
set timeout 30
spawn gcalcli delete --calendar "75 hard" "Event Name"
expect "Delete?"
send "n\r"
expect "Delete?"
send "y\r"
expect eof
EOF
```

## View Agenda

```bash
gcalcli agenda --calendar "75 hard" --calendar "Runna" "today" "+7 days"
```

With specific date range:
```bash
gcalcli agenda --calendar "75 hard" "Jan 26 2026" "Feb 2 2026"
```

## Workout Templates

### Strength Sessions

**Leg Day (60 min)**
```
Goblet Squat - 3x10
RDL - 3x8
Reverse Lunge - 3x8/side
Leg Press - 3x12
Calf Raises - 4x15
Tibialis Raises - 3x20
```

**Chest Day (60 min)**
```
Bench Press - 4x6
Incline DB Press - 3x10
Cable Flyes - 3x12
Dips - 3x10
Lateral Raise + Face Pull - 3x15
```

**Back Day (45 min)**
```
Pull-Ups - 4x8
Lat Pulldown - 3x10
One-Arm DB Row - 3x10/side
Chest-Supported Row - 3x10
Face Pulls - 3x15
EZ-Bar Curl - 3x10
```

**Full Body (60 min)**
```
DB Bench - 3x12
Seated Row - 3x12
Leg Press (light) - 3x12
Lateral Raises - 3x15
Triceps Pushdowns - 3x15
Core work
```

### Recovery Sessions

**Mobility + Sauna (60 min)**
```
30-40 min mobility (hips, calves, ankles, T-spine)
Sauna if available
Hydrate and stretch
```

### Run Sessions

**Easy Run**
- Pace: 9:30-10:30/mi
- HR: < 150 bpm
- Conversational effort

**Speed Work - 400m Repeats**
```
1mi warm up (easy)
6x400m at 7:30-7:45/mi
90s recovery between
0.5mi cool down
```

**Long Run - Progressive**
```
First 1/3: Conversational pace
Middle 1/3: 9:30/mi
Final 1/3: 9:00/mi
Last mile: Easy cool down
```
