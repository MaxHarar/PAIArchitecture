---
name: ISA
description: "Ideal State Artifact — the single document that articulates 'done' for any thing being pursued. One primitive with five identities: ideal state articulation (Deutsch hard-to-vary explanation), test harness (ISCs ARE the tests), build verification, done condition, and system of record. Owns the canonical 12-section template and six workflows: Scaffold, Interview, CheckCompleteness, Reconcile, Seed, Append. Every Algorithm run at E2+ invokes this skill. The ISC is not a checklist item — it is a description of ideal state where every detail plays a functional role."
effort: medium
---

# ISA — Ideal State Artifact

The ISA is the single document that articulates "done" for any thing whose ideal state we are pursuing. It serves five identities simultaneously: ideal state articulation, test harness, build verification, done condition, and system of record.

## The 12-Section Body (fixed order)

| # | Section | Purpose |
|---|---------|---------|
| 1 | `## Problem` | What is broken or missing right now |
| 2 | `## Vision` | Euphoric surprise — experiential intent, 1–5 sentences |
| 3 | `## Out of Scope` | Anti-vision — what is NOT included, declared in prose |
| 4 | `## Principles` | Substrate-independent truths the work must respect |
| 5 | `## Constraints` | Immovable architectural mandates |
| 6 | `## Goal` | Hard-to-vary spine — 1–3 sentences naming verifiable done |
| 7 | `## Criteria` | Atomic ISCs — one binary tool probe each |
| 8 | `## Test Strategy` | Per-ISC verification approach |
| 9 | `## Features` | Work breakdown with dependencies |
| 10 | `## Decisions` | Timestamped decision log |
| 11 | `## Changelog` | Deutsch conjecture/refuted-by/learned/criterion-now trail |
| 12 | `## Verification` | Evidence per ISC |

## Tier Completeness Gate

| Tier | Required Sections |
|------|------------------|
| E1 | Goal, Criteria |
| E2 | Problem, Goal, Criteria, Test Strategy |
| E3 | Problem, Vision, Out of Scope, Constraints, Goal, Criteria, Features, Test Strategy |
| E4 | All 12 sections |
| E5 | All 12 + active Interview workflow |

## Workflow Routing

| Verb | Workflow |
|------|---------|
| "scaffold", "create", "new ISA" | `Workflows/Scaffold.md` |
| "interview me", "fill in the ISA" | `Workflows/Interview.md` |
| "check", "audit", "is it complete?" | `Workflows/CheckCompleteness.md` |
| "reconcile", "merge feature file back" | `Workflows/Reconcile.md` |
| "seed", "bootstrap from this repo" | `Workflows/Seed.md` |
| "append decision", "append changelog" | `Workflows/Append.md` |

## ISC Quality System

**Split until each criterion is one binary tool probe.** A criterion is granular enough when a single tool call returns yes/no. If you cannot name the probe, split it.

**Two doctrinal ISC kinds:**
- `Anti:` prefix — must NOT happen. ≥1 required at all tiers.
- `Antecedent:` prefix — precondition for target experience. ≥1 required when goal is experiential.

**ID-stability rule:** ISC IDs never re-number on edit. Splits become `ISC-N.M`. Dropped ISCs become tombstones.

## Gotchas

- Empty sections never appear — the 12-section body is a capacity, not a requirement at every tier.
- Anti-criteria are derived from Out of Scope and Constraints — they are how prose guardrails become probes.
- The Changelog format is non-negotiable: conjecture, refuted-by, learned, criterion-now — all four, in order. Partial entries are Decisions, not Changelog.
- Project ISAs upgrade tier to max(declared, E3) regardless of the active task's tier.
- ID-stability is the cornerstone of Reconcile — never re-number on edit.
