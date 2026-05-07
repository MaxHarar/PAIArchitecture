# Algorithm Capabilities Reference — PAI 5.0.0

Loaded by OBSERVE during capability selection. Select from this list only — inventing labels at runtime is a PHANTOM capability and counts as a CRITICAL FAILURE.

---

## Thinking & Analysis Capabilities

Use before or during ISC writing to enrich understanding. The thinking-capability floor is HARD at E2+: at E2 select ≥2, at E3 ≥4, at E4 ≥6, at E5 ≥8.

**The closed list — copy verbatim into `🏹 CAPABILITIES SELECTED`:**

| Capability | Phases | Trigger Signal | Invoke | Typical Cost |
|------------|--------|----------------|--------|-------------|
| **IterativeDepth** | OBSERVE | Default at E2+ when time budget allows; important task where multi-angle ISC improves outcome; ambiguous scope, hidden assumptions | `Skill("IterativeDepth")` | E2+ |
| **ApertureOscillation** | OBSERVE, THINK | Building something inside a larger system; architecture decisions where scope framing changes the answer; feature design where tactical and strategic views diverge | `Skill("ApertureOscillation")` | E3+ |
| **FeedbackMemoryConsult** | PLAN | **First step of PLAN at E2+.** Grep prior work memory by task keywords — prevents repeating documented mistakes | `Bash('rg -l "KEYWORDS" ${PAI_DIR}/projects/*/memory/feedback_*.md')` | E2+ |
| **Advisor** | VERIFY | At commitment boundaries; before approach commitment; when stuck; once after durable deliverable before declaring done | `bun PAI/TOOLS/Inference.ts --mode advisor <task> <state> <question>` | E3+ |
| **ReReadCheck** | VERIFY→LEARN | **Final gate before emitting response. Re-read user's last message verbatim; enumerate every explicit ask against what shipped; block `phase: complete` on any miss. MANDATORY at every tier.** | *(inline doctrine step)* | E1+ |
| **FirstPrinciples** | THINK | Architecture decisions; inherited assumptions; stuck on approach | `Skill("FirstPrinciples")` | E2+ |
| **SystemsThinking** | OBSERVE, THINK | Recurring problems; structural causes; feedback loops; "why does this keep happening?" Iceberg model, causal loops, Meadows leverage points | `Skill("SystemsThinking")` | E3+ |
| **RootCauseAnalysis** | THINK, VERIFY | Incident postmortems; defect investigation; "why did this happen?" 5 Whys, Fishbone, Fault Tree, blameless postmortems | `Skill("RootCauseAnalysis")` | E3+ |
| **Council** | THINK, PLAN | Multi-perspective decision; trade-offs; controversial direction | `Skill("Council")` | E4+ |
| **RedTeam** | THINK, VERIFY | Strategy validation; stress-test plan; attack assumptions | `Skill("RedTeam")` | E4+ |
| **Science** | THINK→EXECUTE | Debugging hypothesis; systematic investigation; optimization | `Skill("Science")` | E3+ |
| **BeCreative** | OBSERVE, BUILD | Novel approaches; brainstorming; divergent thinking | `Skill("BeCreative")` | E2+ |
| **Ideate** | BUILD, EXECUTE | Multi-cycle idea generation; evolutionary ideation | `Skill("Ideate")` | E4+ |
| **BitterPillEngineering** | VERIFY | Audit for over-engineering; dead weight; fragile scaffolding | `Skill("BitterPillEngineering")` | E3+ |
| **Evals** | VERIFY | Objective measurement; prompt comparison; quality scoring | `Skill("Evals")` | E4+ |
| **WorldThreatModel** | THINK | Long-term strategy stress-test; future-proofing | `Skill("WorldThreatModel")` | E5 |
| **Fabric patterns** | any | Targeted transform via a specific Fabric pattern (extract_wisdom, summarize, etc.) | `Skill("Fabric", "<pattern>")` | E1+ |
| **ContextSearch** | OBSERVE | Prior work; session recovery; cold-start | `Skill("ContextSearch")` | E1+ |
| **ISA** | OBSERVE, PLAN, EXECUTE, VERIFY, LEARN | **MANDATORY at E2+ for ISA scaffolding, completeness checks, ephemeral extraction, Decisions/Changelog/Verification entries, and Reconcile.** E1 may inline-write minimal Goal+Criteria ISA. | `Skill("ISA", "<verb> <args>")` | E1+ |

> **Phantom check:** before printing `🏹 CAPABILITIES SELECTED`, verify each name appears verbatim in the table above. Any name not in this list is a phantom — split, replace, or remove it. The output line MUST start with the literal name in bold. Example correct: `🏹 **FirstPrinciples** → THINK | …`. Example rejected: `🏹 First-principles decomposition → THINK | …`

---

## Code Quality Capabilities

Use after code changes or before PR creation.

| Capability | When | Invoke |
|------------|------|--------|
| **Forge** | **MANDATORY at E3/E4/E5 for any coding task (implement, refactor, debug, build, fix).** OpenAI-family coder via `codex exec`. Quality + completeness focus. Also invoke when user names "Forge" at any tier. | `Agent(subagent_type="Forge", prompt="...")` |
| **Anvil** | E3/E4/E5 whole-project or cross-file work where context breadth matters. Moonshot Kimi K2.6, 256K context, long-range reasoning. Also invoke when user names "Anvil". | `Agent(subagent_type="Anvil", prompt="...")` |
| **Cato** | **ONLY at E4/E5, end of VERIFY.** Cross-vendor ISA audit — surfaces Anthropic-family blind spots. Read-only. Returns structured JSON. | `Agent(subagent_type="Cato", prompt="...")` |

### Forge vs Anvil decision guide

- **Forge (GPT-5.4):** localized completion, quality/completeness focus. Default at E3/E4/E5. Pick when the change is bounded and "every branch is real" is the verification bar.
- **Anvil (Kimi K2.6):** long-context breadth. Pick when correctness depends on the surrounding architecture — "does this fit" is the dominant question.
- **Both in parallel:** at E4/E5 on the hardest work, spawn Forge AND Anvil in isolated worktrees, then pick the stronger diff in VERIFY.

---

## Delegation & Infrastructure Capabilities

| Capability | When | Invoke |
|------------|------|--------|
| Agent Teams | Default for parallel work. 2+ agents on related work, task dependencies. | `Agent` with `team_name` |
| Worktree Isolation | Parallel write-agents on overlapping files | `Agent` with `isolation: "worktree"` |
| Background Agents | Non-blocking research or verification | `Agent` with `run_in_background: true` |
| Monitor | Event-driven waiting: logs, deploys, CI, file changes | `Monitor` tool |

---

## Research Capabilities

| Capability | When | Invoke |
|------------|------|--------|
| Research | External context; multi-source investigation | `Skill("Research")` |
| ContextSearch | Prior PAI work; session recovery | `Skill("ContextSearch")` |

---

## Output Format

```
🏹 CAPABILITIES SELECTED:
 🏹 **[CapabilityName]** → [PHASE] | [8-word reason]
 🏹 **[CapabilityName]** → [PHASE] | [8-word reason]
🏹 [12–24 words on selection rationale]
```

Selecting a capability = binding commitment to invoke it via tool. If mid-execution it proves unneeded, remove it from the list with a reason.
