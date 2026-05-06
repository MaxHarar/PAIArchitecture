# PAI Skills

Skills are the self-activating capability units of PAI. Each skill is a self-contained directory under `skills/` that bundles a behavior contract (`SKILL.md`), optional step-by-step `Workflows/`, and optional executable `Tools/`. The DA routes to a skill automatically when a user message matches the trigger phrases declared in that skill's frontmatter — no explicit invocation required for routing, though invocation is supported.

This README is the index of every skill currently shipped with PAI.

---

## Overview

A skill is the smallest unit of "PAI knows how to do this." It is the answer to the question: *when the user says X, what behavior should the system reach for?*

Skills are designed around four properties:

- **Self-contained.** Everything the behavior needs lives inside `skills/<SkillName>/`. No hidden dependencies on global state.
- **Self-activating.** Each skill's `SKILL.md` declares a `description` and (optionally) `triggers`. The DA matches user intent against these and routes automatically.
- **Composable.** Skills can call other skills. A research workflow may invoke `Parser`, then `ExtractWisdom`, then `Art` for a visual.
- **Inspectable.** A skill is plain markdown plus optional TypeScript. Read `SKILL.md` to know what a skill does; read `Workflows/*.md` to know how it does it.

Skills sit one level above raw prompts and one level below agents. A prompt is a single instruction; an agent is a persistent persona; a skill is a reusable capability that any agent (including the DA) can pick up and apply.

---

## Skill Directory Structure

The canonical layout for a skill is:

```
skills/
  <SkillName>/
    SKILL.md              # Frontmatter + body. The contract for this skill.
    Workflows/            # Optional. Step-by-step workflows the skill can run.
      <Workflow>.md
      ...
    Tools/                # Optional. Executable TypeScript invoked by workflows.
      <Tool>.ts
      ...
    References/           # Optional. Background material the skill loads on demand.
      <Reference>.md
      ...
```

Only `SKILL.md` is required. Simple skills are a single `SKILL.md`. Complex skills add `Workflows/`, `Tools/`, and `References/` as needed.

Run a tool from a workflow with:

```bash
bun run skills/<SkillName>/Tools/<Tool>.ts [args...]
```

PAI uses `bun` as the TypeScript runtime — never `npm` or `npx`.

---

## SKILL.md Format

Every skill starts with YAML frontmatter, followed by a markdown body that documents the skill's behavior, gotchas, and any workflow routing logic.

Minimal frontmatter:

```yaml
---
name: SkillName
description: One-line summary of what this skill does and when to use it.
triggers:
  - trigger phrase one
  - trigger phrase two
---
```

Field reference:

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | yes | The skill's canonical name. Must match the directory name. |
| `description` | yes | One-line summary. The DA uses this for routing decisions. Include "USE WHEN ..." trigger keywords inline. |
| `triggers` | optional | Explicit trigger phrases. Supplements the routing keywords in `description`. |

The body of `SKILL.md` typically contains: a short overview, workflow routing rules, customization hooks, and any constraints the skill must respect.

---

## Invoking a Skill

Skills self-activate via the DA's routing layer, but they can also be invoked explicitly:

```typescript
Skill("SkillName")                           // run the skill's default behavior
Skill("SkillName", "optional args")          // pass freeform arguments
Skill("SkillName", "workflow-name args")     // run a specific named workflow
```

When invoked through the routing layer, the user simply types a phrase that matches the skill's triggers — for example, "extract wisdom from this video" routes to `ExtractWisdom`, "do extensive research on X" routes to `Research`, and so on.

---

## Skill Catalog

All skills, organized by category.

### AI & Thinking

Cognitive amplifiers wired into the Algorithm's OBSERVE, THINK, and PLAN phases.

| Skill | Description |
|-------|-------------|
| `BeCreative` | Extended thinking mode for divergent ideation and corpus expansion. Use for be creative, deep thinking, extended reasoning. |
| `Council` | Multi-agent debate system with round-by-round transcripts and synthesis. Use for council, debate, perspectives, agents discuss. |
| `Evals` | Agent evaluation framework with code-based, model-based, and human graders, transcript capture, and pass@k / pass^k metrics. Use for eval, benchmark, regression test, capability test. |
| `FirstPrinciples` | First-principles analysis — decompose to fundamental truths, classify constraints, reconstruct from physics. Use for fundamental, root cause, decompose, challenge assumptions. |
| `IterativeDepth` | Multi-angle iterative exploration for deeper criteria extraction during the Algorithm's OBSERVE phase. Use for deep exploration, multi-angle analysis, multiple perspectives on problem. |
| `RedTeam` | Adversarial analysis with up to 32 parallel agents. Use for red team, attack idea, counterarguments, critique, stress test. |
| `Science` | Universal thinking and iteration engine based on the scientific method. The meta-skill that other workflows implement. Use for think about, figure out, try approaches, iterate on, optimize. |
| `WorldThreatModelHarness` | Persistent world-model harness across 11 time horizons (6 months to 50 years) for adversarial analysis of ideas, strategies, and investments. Use for threat model, world model, future analysis, test against future. |

### Research & Intelligence

Gather, verify, and synthesize information from across the web and structured sources.

| Skill | Description |
|-------|-------------|
| `BrightData` | Progressive URL scraping using tiered Bright Data endpoints. Use for Bright Data, scrape URL, web scraping tiers. |
| `OSINT` | Open-source intelligence gathering. Use for OSINT, due diligence, background check, research person, company intel. |
| `PrivateInvestigator` | Ethical people-finding and identity verification with confidence scoring. Use for find person, locate, reconnect, people search, skip trace. |
| `Recon` | Security reconnaissance and attack-surface mapping. Use for recon, reconnaissance, bug bounty, attack surface. |
| `Research` | Comprehensive research, analysis, and content extraction with quick / standard / extensive modes and verified URLs. Use for research, investigate, find information, extract alpha. |
| `WebAssessment` | Web security assessment and vulnerability testing. Use for web assessment, pentest, security testing, vulnerability scan. |

### Content & Creative

Produce written and visual artifacts from ideas, briefs, or source material.

| Skill | Description |
|-------|-------------|
| `Aphorisms` | Aphorism management — collect, refine, and surface concise sayings. Use for aphorism, quote, saying. |
| `Art` | Complete visual content system — illustrations, diagrams, mermaid charts, technical diagrams, infographics, icons. Use for art, illustration, diagram, flowchart, header image. |
| `ExtractWisdom` | Content-adaptive wisdom extraction that builds custom sections around what the source actually contains. Use for extract wisdom, analyze video, analyze podcast, key takeaways. |
| `Prompting` | Meta-prompting standard library for template-based prompt generation, optimization, and composition. Use for meta-prompting, template generation, prompt optimization. |
| `Remotion` | Programmatic video creation with React. Use for video, animation, motion graphics, video rendering. |
| `WriteStory` | Layered fiction writing system using Will Storr's storytelling science and rhetorical figures. Use for write story, fiction, novel, chapter, character arc. |

### Document Processing

Parse, extract, and transform structured and unstructured documents.

| Skill | Description |
|-------|-------------|
| `AnnualReports` | Annual security report aggregation and analysis. Use for annual reports, security reports, threat reports, vendor reports. |
| `Documents` | Top-level document processing entry point that routes to format-specific subskills. Use for document, process file. |
| `Documents/Docx` | Word document creation, editing, and analysis. Use for docx, Word document. |
| `Documents/Pdf` | PDF processing — read, extract, transform. Use for pdf, PDF file. |
| `Documents/Pptx` | PowerPoint creation, editing, and analysis. Use for pptx, PowerPoint, slides. |
| `Documents/Xlsx` | Excel spreadsheet processing and generation. Use for xlsx, Excel, spreadsheet. |
| `Parser` | Parse URLs, files, and videos to structured JSON — transcripts, entities, batch content. Use for parse, extract, URL, transcript, JSON. |
| `SECUpdates` | Security news aggregation across tldrsec, no.security, and other sources. Use for security news, security updates, breaches, security research. |

### Integrations & Automation

Connect PAI to external systems and platforms.

| Skill | Description |
|-------|-------------|
| `Apify` | Social media scraping and business data via Apify actors — Instagram, LinkedIn, TikTok, YouTube, Facebook, Google Maps, Amazon. Use for scrape Instagram, Google Maps leads, social listening. |
| `Browser` | Debug-first browser automation with always-on console, network, and error capture. Use for browser, screenshot, debug web, verify UI. |
| `Cloudflare` | Deploy Cloudflare Workers and Pages. Use for Cloudflare, worker, deploy, Pages, MCP server. |
| `GmailManager` | Gmail inbox cleanup — mass unsubscribe, bulk delete, organize labels. Use for clean email, gmail, unsubscribe, inbox cleanup. |
| `Greptile` | AI-powered codebase intelligence via Greptile — search, ask questions about code, find references. Use for greptile, code intelligence, codebase search. |
| `TelegramClean` | Automatic clean-output formatting for Telegram bot sessions. Auto-detects Telegram context. |
| `VoiceServer` | Voice server management for TTS and prosody-aware notifications. Use for voice server, TTS server, voice notification. |

### Development & Infrastructure

Build, manage, and extend PAI itself.

| Skill | Description |
|-------|-------------|
| `CreateCLI` | Generate production-ready TypeScript CLIs across three tiers (manual / Commander.js / oclif reference). Use for create CLI, build CLI, command-line tool. |
| `CreateSkill` | Create, validate, and canonicalize skills. The canonical entry point for any skill scaffolding work. Use for create skill, new skill, skill structure. |
| `Fabric` | Intelligent prompt pattern system with 240+ specialized patterns for content analysis, extraction, and transformation. Use for use fabric, fabric pattern, run fabric. |
| `PAI` | Personal AI Infrastructure core — the authoritative reference for how PAI works. Use as the canonical PAI documentation entry point. |
| `PAIUpgrade` | Extract system improvements from content and monitor external sources for upgrade opportunities. Use for upgrade, improve system, check for new features. |

### Data & Productivity

Operational intelligence — daily summaries, fitness, financial and economic context.

| Skill | Description |
|-------|-------------|
| `AIUpdates` | AI news aggregation from leading sources across the AI ecosystem. Use for AI news, AI updates, what's new in AI, Anthropic news, OpenAI news. |
| `DailyBriefing` | Executive daily summary delivered to Telegram with wake-triggered timing. Use for daily briefing, morning summary, executive summary. |
| `FitnessCoach` | Personal fitness coaching with Garmin and Google Calendar integration. Use for workout plan, training plan, fitness, garmin data. |
| `Sales` | Sales workflows — proposals, pricing, narrative packages. Use for sales, proposal, pricing. |
| `Telos` | Life OS and project analysis — goals, beliefs, wisdom, narratives, dependencies. Use for TELOS, life goals, projects, dependencies. |
| `USMetrics` | US economic and social indicators across employment, inflation, housing, markets, and demographics. Use for GDP, inflation, unemployment, economic metrics. |

### Security

Detect, analyze, and remediate security threats.

| Skill | Description |
|-------|-------------|
| `PromptInjection` | Prompt injection testing and LLM security assessment. Use for prompt injection, jailbreak, LLM security, pentest AI application. |

### Agent System

Manage agent personas, voices, and parallel orchestration.

| Skill | Description |
|-------|-------------|
| `Agents` | Dynamic agent composition and management — personalities, voice mapping, parallel orchestration. Use for create custom agents, specialized agents, agent personalities. |

---

## Adding a Skill

To create a new skill, scaffold an existing one, or canonicalize a legacy skill, invoke the `CreateSkill` skill:

```typescript
Skill("CreateSkill", "create a new skill called <Name> for <purpose>")
```

`CreateSkill` enforces the canonical directory layout, generates the `SKILL.md` frontmatter, scaffolds the optional `Workflows/`, `Tools/`, and `References/` directories, and validates the result against the format spec. Direct hand-rolling of skill files is discouraged — the skill system is the source of truth for skill structure.
