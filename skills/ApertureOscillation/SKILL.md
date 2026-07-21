---
name: ApertureOscillation
description: "3-pass scope oscillation. Holds a question constant while shifting the scope envelope — narrow/tactical, wide/strategic, then synthesis — to surface design tensions invisible at any single zoom level. Requires two distinct inputs: the tactical target (what you're building) and strategic context (the larger system it serves). Pass 1 captures the component's own internal logic. Pass 2 reveals what the system needs it to be. Pass 3 finds where those views diverge — that delta is the output. NOT a lens rotation (that's IterativeDepth). NOT idea generation (that's BeCreative). USE WHEN: architecture decisions, feature-fits-system checks, design reviews, scope negotiation, tactical vs strategic framing."
effort: medium
---

# ApertureOscillation

**3-pass scope oscillation that surfaces design tensions invisible at any single zoom level.**

Grounded in the observation that LLMs (and humans) produce fundamentally different outputs depending on the scope of the framing context. A component designed in isolation has its own logic. The same component designed within a stated system vision inherits different constraints. The delta between these two framings is where the real insight lives.

## The Three Passes

**Pass 1 — Narrow Aperture (Tactical-first)**
The specific thing is primary. Big-picture context is background. What does the component naturally want to be, given its own internal logic?

**Pass 2 — Wide Aperture (Strategic-first)**
The vision/system goal is primary. The specific thing is derived from it. What does the system need the component to be for the whole to cohere?

**Pass 3 — Synthesis**
Feed both outputs. Where do the tactical and strategic views diverge? The tensions, gaps, and surprises between the two framings are the output — the things neither pass alone would surface.

## How It Differs From IterativeDepth

| Dimension | IterativeDepth | ApertureOscillation |
|-----------|---------------|---------------------|
| What varies | Analytical lens | Scope/zoom level |
| Pass count | 2–8 | 3 (fixed) |
| Input | Single problem statement | Two inputs: tactical target + strategic context |
| Output | Richer requirements from multiple angles | Design tensions between local and system views |
| Best for | Requirement discovery, blind spot elimination | Architecture decisions, feature-system coherence |

## When to Use

- **Architecture decisions** — "Should this be a service, a library, or inline?" changes depending on whether you're zoomed into the component or zoomed out to the system.
- **Feature design** — The feature a user asks for vs. the feature the product needs are often subtly different. Oscillation surfaces the gap.
- **System coherence checks** — When adding to existing infrastructure, the new piece must serve both its own purpose and the system's.
- **Design reviews** — Before committing to an approach, oscillate scope to check that the tactical plan and the strategic vision agree.

## Gotchas

- Requires two distinct inputs. If the tactical target and strategic context are the same thing, use IterativeDepth instead.
- The synthesis pass is where the value lives. Passes 1 and 2 are setup. If synthesis finds no divergence, that's a valid (and valuable) finding — the tactical and strategic views are already aligned.
- BPE-fragile: quarterly test recommended to verify smarter models don't naturally oscillate scope without prompting.
