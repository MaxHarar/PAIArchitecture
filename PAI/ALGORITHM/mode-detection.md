# Mode & Parameter Detection — PAI 5.0.0 / Algorithm v6.3.0

Loaded by OBSERVE when ideate, optimize, fast-path, or effort-override modes are detected.

---

## Effort Override Detection

**Triggers:** `/e1`–`/e5` or `E1`–`E5` as a standalone token in the message (case-insensitive).

**Mapping:** E1=Standard, E2=Extended, E3=Advanced, E4=Deep, E5=Comprehensive.

When detected:
1. Set effort level to the named tier — this is an override, not a hint.
2. Add `effort_source: explicit` to ISA frontmatter.
3. Skip auto-detection in OBSERVE.
4. E1 forces fast-path mode (OBSERVE→EXECUTE→VERIFY) when task structure allows.
5. Note complexity mismatch in ISA `## Decisions` if appropriate, but proceed at the specified level.

---

## Ideate Mode

**Triggers:** `ideate [problem]` | `id8 [problem]` | `generate ideas for` | `dream up solutions for`

1. Set `mode: ideate` in ISA frontmatter.
2. Load `PAI/ALGORITHM/ideate-loop.md`.
3. Map effort tier to `time_scale` per the ideate-loop file.

---

## Optimize Mode

**Trigger:** `optimize [target]`

1. Determine `eval_mode`:
   - Metric command provided or code target → `eval_mode: metric`
   - Prompt/skill/agent target or explicit `eval_mode: eval` → `eval_mode: eval`
2. Set `mode: optimize` and `eval_mode` in ISA frontmatter.

---

## Parameter Detection (Ideate & Optimize)

**Resolution order:** Preset → Focus → Individual overrides → Meta-Learner (ideate only).

1. Check for explicit **preset name** → `algorithm_config.preset`
2. Check for **focus value** (0.0–1.0) → `algorithm_config.focus`
3. Check for **individual param specs** → overrides
4. If no explicit params, infer from tone:

| Preset | Tone keywords |
|--------|---------------|
| `dream` | wild, dream, free-form, surprise me |
| `explore` | explore, broad, brainstorm |
| `directed` | focused, practical, actionable |
| `surgical` | precise, surgical, optimal |
| `cautious` (optimize) | careful, safe, production |
| `aggressive` (optimize) | bold, aggressive, fast |

---

## Fast-Path Detection (E1 only)

The fast-path is a **whitelist, not a heuristic.** A task qualifies ONLY if every condition holds — this closes the doctrine-evasion route that any heuristic bypass would open.

**Whitelist — ALL must hold:**
- Effort tier is E1 (auto-detected or explicit `/e1`).
- Task is one of: rename a symbol, fix a typo, run a command, read-and-report on a file, append a single line, format/lint, single-package install, single test run.
- Single file or single command in scope.
- No multi-step transformation.
- No new architecture, no new endpoints, no new dependencies, no migrations.
- `MODE: ALGORITHM` AND `TIER: E1` present in context (written by classifier hook).

**If ALL conditions hold:**
- Set `mode: fast-path` in ISA frontmatter.
- Inline-write minimal ISA (Goal + Criteria only — the E1 completeness floor) without invoking `Skill("ISA")`.
- Compress to: OBSERVE → EXECUTE → VERIFY (skip THINK/PLAN/BUILD).

**If ANY condition fails:**
- Fast-path does NOT apply.
- Proceed with standard 7-phase Algorithm at the resolved tier.

---

## Research-Only Archetype

For analysis, review, or investigation with no code changes:
- Set `mode: research` in ISA frontmatter.
- Skip ISA creation at E1 only, with whitelist conditions met.
- Compress to: OBSERVE → THINK → EXECUTE → VERIFY → LEARN.

---

## ISA Frontmatter Reference

```yaml
---
task: Short description of the task
slug: YYYYMMDD-HHMMSS_task-slug
effort: E1 | E2 | E3 | E4 | E5
effort_source: classifier | explicit | fail-safe
phase: observe | think | plan | build | execute | verify | learn | complete
progress: 0/N   # ISCs completed / total
mode: algorithm | fast-path | research | ideate | optimize
started: 2026-01-01T00:00:00Z
updated: 2026-01-01T00:00:00Z
---
```

Optional fields: `iteration` (for multi-run tasks), `algorithm_config` (for ideate/optimize presets), `project` (for project ISAs).
