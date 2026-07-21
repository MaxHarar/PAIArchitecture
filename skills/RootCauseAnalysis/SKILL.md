---
name: RootCauseAnalysis
description: "Structured incident and defect investigation using 5 Whys, Fishbone (Ishikawa), Fault Tree Analysis, and IS/IS-NOT framing. Produces contributing factors (plural), not a single root cause — because complex failures are always multi-causal. USE WHEN: incident postmortem, defect investigation, 'why did this happen?', understanding a failure before fixing it."
effort: medium
---

# RootCauseAnalysis

**Structured investigation that produces contributing factors, not a scapegoat.**

A single root cause is almost always wrong. Complex systems fail through chains of contributing factors — technical, organizational, procedural — and naming one lets the rest survive to cause the next incident. This skill forces plural causal analysis.

## Methods

**5 Whys** — ask "why" repeatedly until you reach a systemic cause or a correctable condition. Stop when you hit: something outside your control, a human decision you understand, or a structural condition you can change.

**Fishbone (Ishikawa)** — map contributing factors across categories:
- People, Process, Technology, Environment, Materials, Measurement

**IS/IS-NOT (Kepner-Tregoe)** — constrain the problem space:
- IS: where it occurs, when, how much
- IS NOT: where it doesn't occur, when it doesn't happen, how much it doesn't
The boundary between IS and IS NOT is often where the cause lives.

**Fault Tree Analysis** — top-down decomposition using AND/OR gates. A failure requires X AND Y, or X OR Y. AND-gates mean all conditions must be present; OR-gates mean any one is sufficient. AND-gates are safer to address; OR-gates are more urgent.

## Output Structure

```
ROOT CAUSE ANALYSIS — [Incident/Defect]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROBLEM STATEMENT: [precise description of what failed]
IS/IS-NOT BOUNDARY: [where/when it happens vs. doesn't]

CONTRIBUTING FACTORS (plural):
  CF-1: [technical factor] — [how it contributed]
  CF-2: [process factor] — [how it contributed]
  CF-3: [organizational factor] — [how it contributed]

5-WHY CHAIN (primary thread):
  Why 1: [symptom] → Why 2: [mechanism] → Why 3: [condition] → Why 4: [process gap] → Why 5: [structural cause]

CORRECTIVE ACTIONS (mapped to factors):
  CF-1: [specific action, owner]
  CF-2: [specific action, owner]
  CF-3: [specific action, owner]

SYSTEMIC RECOMMENDATION:
  [what structural change prevents this class of failure]
```

## Blameless Postmortem Principles

- People made the best decisions they could with the information they had at the time
- The goal is systemic improvement, not individual accountability
- Focus: what conditions allowed this to happen?
- The "human error" root cause is always wrong — it names the last link in a chain, not the chain

## When to Use

- Incident postmortem (after a system failure)
- Defect investigation (before fixing a recurring bug)
- "Why did this happen?" (before making a structural change)
- Pre-mortems (imagine it failed — what caused it?)
