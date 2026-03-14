# PRD Format Specification v2.0

> Product Requirements Document format for PAI Algorithm runs.
> Every Algorithm run creates or continues a PRD. No exceptions.

## Frontmatter (8 required + optional fields)

```yaml
---
task: Short task description (plain text, no quotes needed)
slug: YYYYMMDD-HHMMSS_kebab-case-slug
effort: Standard | Extended | Advanced | Deep | Comprehensive
phase: observe | think | plan | build | execute | verify | learn | complete
progress: 0/N
mode: interactive | loop
started: ISO-8601 datetime
updated: ISO-8601 datetime
# Optional (add only when needed):
iteration: 0        # Loop mode iteration counter
parent: null        # Parent PRD slug if child
children: []        # Child PRD slugs if decomposed
---
```

### Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task` | string | Yes | 4-10 word task description |
| `slug` | string | Yes | Unique ID: `YYYYMMDD-HHMMSS_kebab-slug` (max 60 chars) |
| `effort` | enum | Yes | Effort tier: Standard, Extended, Advanced, Deep, Comprehensive |
| `phase` | enum | Yes | Current Algorithm phase (lowercase) |
| `progress` | string | Yes | `N/M` format — criteria passing / total |
| `mode` | enum | Yes | `interactive` (human-in-loop) or `loop` (autonomous) |
| `started` | datetime | Yes | ISO-8601 creation timestamp |
| `updated` | datetime | Yes | ISO-8601 last modification timestamp |
| `iteration` | number | No | Loop iteration counter (0-based) |
| `parent` | string | No | Parent PRD slug for child PRDs |
| `children` | array | No | Child PRD slugs for decomposed PRDs |

## Body Sections (4 sections)

### Context

Problem space, key files, constraints, and decisions that a fresh agent needs to resume work.

```markdown
## Context

### Problem Space
What problem is being solved and why it matters. 2-3 sentences max.

### Key Files
Files that a fresh agent must read to resume. Paths + 1-line role description each.

### Constraints
Hard constraints: backwards compatibility, performance budgets, API contracts, dependencies.

### Decisions Made
Technical decisions from previous iterations that must be preserved.
```

### Criteria

The Ideal State Criteria — verification conditions for hill-climbing.

```markdown
## Criteria

- [ ] ISC-C1: {8-12 word state criterion} | Verify: {CLI|Test|Static|Browser|Grep|Read|Custom}: {method}
- [ ] ISC-C2: {8-12 word state criterion} | Verify: {type}: {method}
- [ ] ISC-A1: {8-12 word anti-criterion} | Verify: {type}: {method}
```

**Rules:**
- Each criterion: 8-12 words, state not action, binary testable
- Each carries inline verification method via `| Verify:` suffix
- Anti-criteria prefixed `ISC-A`
- Grouped under `### Domain` headers when 17+ criteria
- `- [ ]` for pending, `- [x]` for passing

### Decisions

Non-obvious technical decisions made during BUILD/EXECUTE.

```markdown
## Decisions

- YYYY-MM-DD: {Decision statement} — {rationale}
```

### Verification

Final verification evidence from the VERIFY phase.

```markdown
## Verification

ISC-C1: PASS — {evidence}
ISC-C2: PASS — {evidence}
ISC-A1: PASS — {evidence of absence}
```

## PRD Lifecycle

```
DRAFT → observe → think → plan → build → execute → verify → complete
```

The `phase` field tracks where the Algorithm currently is. Updated at each phase transition.

## Location

- Project PRDs: `{project}/.prd/PRD-{slug}.md`
- Personal PRDs: `~/.claude/MEMORY/WORK/{slug}/PRD.md`

## Dual-Tracking

PRD criteria are tracked in TWO systems simultaneously:

| Track | System | Lifetime | Purpose |
|-------|--------|----------|---------|
| **Working Memory** | TaskCreate/TaskList | Session | Real-time verification |
| **Persistent** | PRD file on disk | Permanent | Survives sessions |

Both tracks must stay in sync. PRD on disk wins conflicts.

## Loop Mode

Loop iterations use PRD frontmatter to track state:
- `mode: loop` enables autonomous iteration
- `iteration` increments each cycle
- `phase` resets to `observe` each iteration
- `progress` updates as criteria pass

Effort level decays: iterations 1-3 at configured level, 4+ Standard if >50% passing, 8+ Fast if >80%.

## Size Tiers

| Tier | ISC Count | Structure |
|------|-----------|-----------|
| Simple | 4-16 | Flat list |
| Medium | 17-32 | Grouped by `### Domain` |
| Large | 33-99 | Child PRDs per domain |
| Massive | 100+ | Multi-level hierarchy |
