---
name: BitterPillEngineering
description: "Post-build audit for over-engineering, dead weight, and fragile scaffolding. Named after the discipline of forcing yourself to swallow the uncomfortable truth about code you just wrote. Runs at VERIFY phase. Checks: unnecessary abstraction, dead code paths, over-parameterized functions, speculative complexity, premature generalization, comment rot. Returns a structured verdict: LEAN (ship it), TRIM (cut these specific things), RETHINK (structural issue found). USE WHEN: after a substantial implementation, before PR, when something feels heavier than it should."
effort: medium
---

# BitterPillEngineering

**Post-build audit that forces the uncomfortable truth about the code you just wrote.**

Named after the experience of reviewing your own work and finding that half of it shouldn't exist. The bitter pill is swallowing that realization before shipping instead of after.

## What It Checks

1. **Unnecessary abstraction** — layers that add indirection without reducing duplication
2. **Dead code** — branches, parameters, or helpers that can't be reached in any real execution
3. **Speculative complexity** — "we might need this later" code that doesn't serve the current ISC
4. **Over-parameterized functions** — configuration options that exist because they were easy to add, not because they'll be used
5. **Comment rot** — comments that describe what the code does rather than why, or that no longer match what the code does
6. **Premature generalization** — the three-similar-lines-abstracted-into-a-factory-that-only-has-one-caller pattern

## Verdict Structure

```
🔬 BITTER PILL AUDIT
━━━━━━━━━━━━━━━━━━━━
VERDICT: LEAN | TRIM | RETHINK

LEAN: No material complexity debt found. Ship it.

TRIM: [specific list of what to remove, with locations]
  - [file:line] [what it is] [why it shouldn't exist]
  ESTIMATED REDUCTION: ~N lines, N abstractions

RETHINK: [structural issue found]
  ROOT: [the design decision that created the weight]
  EFFECT: [what it makes harder or more brittle]
  DIRECTION: [where to take it instead]
```

## When to Use

- After a substantial implementation at VERIFY phase
- Before opening a PR on a feature with significant new code
- When the implementation feels heavier than the problem warranted
- When a reviewer says "this feels like a lot of code for what it does"

## Gotchas

- This is a VERIFY-phase skill, not a THINK-phase skill. Don't run it before building — run it after.
- TRIM verdicts are concrete and surgical. They name specific things to remove. Vague "this could be simpler" doesn't count.
- RETHINK verdicts are rare. Most over-engineering is TRIM, not RETHINK.
- The goal is minimum viable complexity for the stated ISC, not minimum possible code. Sometimes complexity is earned.
