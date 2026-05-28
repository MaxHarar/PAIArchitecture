<p align="center">
  <img src="images/pai-hero-banner.png" alt="PAI — Personal AI Infrastructure" width="100%">
</p>

<h1 align="center">PAI — Personal AI Infrastructure</h1>

<p align="center">
  <em>An autonomous AI agent system built on <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a> that runs 24/7, solves problems systematically, and keeps you in control.</em>
</p>

<p align="center">
  <a href="#the-algorithm">The Algorithm</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#skills">Skills</a> •
  <a href="#agents">Agents</a> •
  <a href="#hooks">Hooks</a> •
  <a href="#quick-start">Quick Start</a>
</p>

---

PAI transforms [Claude Code](https://docs.anthropic.com/en/docs/claude-code) from a code assistant into an **autonomous AI agent** with its own workspace, integrations, persistent memory, and a 24/7 heartbeat loop. It monitors, acts, and grows independently while keeping you informed via Telegram.

**Foundation: [PAI](https://github.com/danielmiessler/PAI)** by [Daniel Miessler](https://danielmiessler.com), built on his [The Algorithm](https://github.com/danielmiessler/TheAlgorithm). This repo is an evolved fork of [`danielmiessler/PAI`](https://github.com/danielmiessler/PAI) shipping **PAI 5.0.0** with **Algorithm v6.3.0** — adding the ISA (Ideal State Artifact), effort-tier thinking floors with a closed capability enumeration, and deliberate multi-vendor agent architecture. See [`PAI/ALGORITHM/v6.3.0.md`](PAI/ALGORITHM/v6.3.0.md) for the full spec.

> **Why PAI?** Most AI tools are reactive — you ask, they answer. PAI is proactive. It checks your email, monitors your deployments, generates daily briefings, reviews PRs, and proposes automations — all while you sleep. Every task goes through a 7-phase reasoning algorithm with verifiable criteria, so nothing gets marked "done" without evidence.

---

## What Makes PAI Different

| Feature | Traditional AI Assistant | PAI |
|---------|------------------------|-----|
| **Execution** | Responds when asked | Runs autonomously on a 15-minute heartbeat |
| **Reasoning** | Single-shot response | 7-phase Algorithm with Ideal State Criteria |
| **Memory** | Forgets between sessions | Persistent memory system across conversations |
| **Verification** | Claims "done" | Requires evidence — tests, screenshots, diffs |
| **Agents** | Single model | 18 specialized agents — multi-vendor (Anthropic, OpenAI, Moonshot) |
| **Skills** | Generic capabilities | 60+ domain-specific skills |
| **MCP Servers** | No integrations | Custom MCP servers — Telegram ask_user, context bridges |
| **Voice** | Text only | Local TTS with spoken phase announcements |
| **Integration** | API calls | Gmail, Telegram, Vercel, Google Calendar, X/Twitter |

---

## The Algorithm

<p align="center">
  <img src="images/pai-algorithm-phases.png" alt="The Algorithm — 7 Phase Execution" width="100%">
</p>

Every task — from fixing a bug to designing a system — goes through the same 7-phase execution cycle. This isn't optional; it's the core of how PAI thinks.

### The 7 Phases

| Phase | Purpose | Key Actions |
|-------|---------|-------------|
| **👁️ OBSERVE** | Understand the request | Reverse-engineer explicit/implicit wants, set effort level, generate Ideal State Criteria |
| **🧠 THINK** | Pressure-test the approach | Identify riskiest assumptions, run premortem, check prerequisites |
| **📋 PLAN** | Design the solution | Validate prerequisites, select capabilities, create execution plan |
| **🔨 BUILD** | Prepare for execution | Invoke selected capabilities, make architectural decisions |
| **⚡ EXECUTE** | Do the work | Implement changes, check off criteria as they're satisfied |
| **✅ VERIFY** | Prove it works | Test every criterion with evidence — no "Done!" without proof |
| **📚 LEARN** | Improve the system | Reflect on what worked, what didn't, and what to do differently |

### Ideal State Criteria (ISC)

The secret sauce. Every task gets decomposed into **atomic, testable criteria** before any work begins:

```markdown
- [ ] ISC-1: Login form renders on /auth page
- [ ] ISC-2: Email field validates format on blur
- [ ] ISC-3: Password field requires 8+ characters
- [ ] ISC-4: Submit button disabled until both fields valid
- [ ] ISC-5: Successful login redirects to /dashboard
- [ ] ISC-6: Failed login shows error message below form
```

Each criterion is:
- **Atomic** — One verifiable thing per criterion
- **Binary** — Pass or fail, no ambiguity
- **Independent** — Can be tested in isolation
- **Evidence-backed** — Requires proof (test output, screenshot, diff)

### Effort Tiers

| Tier | Budget | ISC Range | When |
|------|--------|-----------|------|
| **Standard** | <2 min | 8–16 | Normal requests |
| **Extended** | <8 min | 16–32 | Quality must be extraordinary |
| **Advanced** | <16 min | 24–48 | Substantial multi-file work |
| **Deep** | <32 min | 40–80 | Complex system design |
| **Comprehensive** | <120 min | 64–150 | No time pressure, maximum depth |

### PRD System

Every Algorithm execution creates a **Product Requirements Document** (PRD) — a living document that tracks:

- Task description and context
- All ISC criteria with checkbox status
- Architectural decisions and rationale
- Verification evidence

PRDs are stored in `MEMORY/WORK/` and serve as the single source of truth for each task.

---

## Architecture

<p align="center">
  <img src="images/pai-architecture-diagram.png" alt="PAI Architecture" width="100%">
</p>

```mermaid
flowchart LR
    subgraph User["User"]
        CLI["Claude Code CLI"]
    end

    subgraph Runtime["Runtime"]
        GW["Gateway<br/>(main process)"]
        HB["Heartbeat<br/>(background jobs)"]
    end

    subgraph Capabilities["Capabilities"]
        SK["Skills<br/>self-activating"]
        HK["Hooks<br/>lifecycle interceptors"]
        AG["Agents<br/>specialized sub-processes"]
    end

    subgraph Persistence["Persistence"]
        MEM["Memory<br/>WORK · LEARN · KNOW"]
        PLS["Pulse<br/>life dashboard"]
    end

    CLI -->|"prompt"| GW
    HK -->|"intercepts tool calls"| GW
    GW -->|"routes to"| SK
    GW -->|"spawns"| AG
    GW -->|"writes"| MEM
    HB -->|"heartbeat channel"| GW
    MEM -->|"read by"| PLS
    PLS -.->|"browser"| CLI
```

### Core Components

| Component | Purpose | Implementation |
|-----------|---------|---------------|
| **Algorithm Engine** | 7-phase systematic reasoning | `skills/PAI/SKILL.md` + `Components/Algorithm/` |
| **Skill System** | Domain-specific capabilities | `skills/` — 55+ skill directories |
| **Hook System** | Lifecycle event handlers | `hooks/` — 23 TypeScript hooks |
| **Agent System** | Specialized AI workers | `agents/` — 13 agent definitions |
| **Memory System** | Persistent cross-session context | `MEMORY/` — WORK, STATE, LEARNING |
| **Gateway** | HTTP/WebSocket server | `Gateway/gateway.ts` — Bun.serve |
| **Heartbeat** | Autonomous execution loop | `Heartbeat/heartbeat.ts` — launchd |
| **Voice Server** | Local text-to-speech | `VoiceServer/` — Kokoro TTS |
| **Telegram Bot** | Primary communication channel | `claude-telegram-bot/` |

---

## Best-of-N Agents

PAI implements a **Best-of-N parallelization pattern** for complex tasks where correctness matters most. Instead of relying on a single attempt, PAI spawns 2–4 independent agents on the same task and selects the best result.

### How It Works

```
                    ┌─────────────┐
                    │  TASK INPUT  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
         │ Agent A │  │ Agent B │  │ Agent C │
         │(worktree│  │(worktree│  │(worktree│
         │   #1)   │  │   #2)   │  │   #3)   │
         └────┬────┘  └────┬────┘  └────┬────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────▼──────┐
                    │  VERIFIER   │
                    │ Select Best │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ BEST RESULT │
                    └─────────────┘
```

### Key Features

- **Isolated Worktrees** — Each agent works in its own git worktree, preventing interference
- **Parallel Execution** — All agents run simultaneously for maximum speed
- **Verifier Selection** — A separate verifier agent (or human) compares outputs and selects the best
- **15–40% Improvement** — Research shows Best-of-N consistently improves correctness over single-shot

### When to Use Best-of-N

| Scenario | N Value | Why |
|----------|---------|-----|
| Complex refactors | 2–3 | Multiple valid approaches, pick the cleanest |
| Debugging hard bugs | 3–4 | Different hypotheses tested in parallel |
| Architecture decisions | 2 | Compare competing designs |
| Critical security code | 3 | Maximize correctness for high-stakes code |

---

## Skills

PAI has **55+ domain-specific skills** — each a self-contained capability with its own tools, workflows, and documentation.

### Skill Categories

#### Core System
| Skill | Description |
|-------|-------------|
| **PAI** | The Algorithm — core reasoning engine, ISC generation, PRD management |
| **CORE** | System architecture, documentation, identity, banners |
| **Agents** | Dynamic agent composition, personality assignment, voice mapping |
| **Fabric** | 240+ prompt patterns for content analysis and transformation |

#### Research & Analysis
| Skill | Description |
|-------|-------------|
| **Research** | Multi-mode research system (quick/standard/extensive) with 5 researcher agents |
| **ExtractWisdom** | Content-adaptive extraction of insights from any media |
| **FirstPrinciples** | Root cause analysis and fundamental decomposition |
| **IterativeDepth** | Multi-angle iterative exploration for deeper analysis |
| **Council** | Multi-agent debate with diverse perspectives |
| **RedTeam** | Adversarial analysis with 32 attack agents |
| **Science** | Hypothesis-test-analyze cycles for structured problem-solving |
| **BeCreative** | Extended thinking mode for deep creative reasoning |

#### Security
| Skill | Description |
|-------|-------------|
| **WebAssessment** | Web application penetration testing |
| **Recon** | Attack surface reconnaissance and enumeration |
| **OSINT** | Open source intelligence gathering |
| **PromptInjection** | LLM security testing and jailbreak analysis |
| **PrivateInvestigator** | Ethical people-finding and skip tracing |
| **SECUpdates** | Security news aggregation from industry sources |
| **AnnualReports** | Security report analysis and trend extraction |
| **WorldThreatModelHarness** | Multi-horizon adversarial future analysis (6mo–50yr) |

#### Content & Media
| Skill | Description |
|-------|-------------|
| **Art** | Image generation with multiple models (Flux, GPT-image-1, Gemini) |
| **Remotion** | Programmatic video creation with React |
| **WriteStory** | Fiction writing using Will Storr's storytelling science |
| **Prompting** | Meta-prompting and dynamic prompt generation |
| **Aphorisms** | Quote and saying management |

#### Document Processing
| Skill | Description |
|-------|-------------|
| **pdf** | Full PDF operations — read, merge, split, encrypt, OCR |
| **docx** | Word document creation, editing, and formatting |
| **pptx** | PowerPoint presentation management |
| **xlsx** | Spreadsheet operations with formulas and charts |
| **Documents** | General document processing |
| **google-docs** | Google Docs and Drive integration |
| **Parser** | Universal URL/file/video parsing to structured JSON |

#### Infrastructure & DevOps
| Skill | Description |
|-------|-------------|
| **deploy-to-vercel** | Vercel deployment automation |
| **Cloudflare** | Workers/Pages deployment |
| **CreateCLI** | TypeScript CLI generation |
| **CreateSkill** | Skill creation and validation |
| **Browser** | Debug-first Playwright browser automation |
| **Greptile** | AI-powered codebase intelligence |
| **Evals** | Agent evaluation framework with graders and metrics |

#### Data & Intelligence
| Skill | Description |
|-------|-------------|
| **BrightData** | Progressive URL scraping across tiers |
| **Apify** | Social media and e-commerce scraping via Apify actors |
| **USMetrics** | Real-time US economic indicators |
| **AIUpdates** | AI industry news monitoring |
| **PAIUpgrade** | System improvement extraction from content |

#### Personal
| Skill | Description |
|-------|-------------|
| **DailyBriefing** | Executive daily summary to Telegram |
| **FitnessCoach** | Personal fitness with Garmin + Calendar integration |
| **Telos** | Life OS — goals, projects, dependencies |
| **GmailManager** | Inbox cleanup — mass unsubscribe, bulk delete, organize |
| **Sales** | Sales workflows, proposals, and pricing |
| **TelegramClean** | Automatic clean output formatting for Telegram |
| **VoiceServer** | Voice server management and TTS configuration |

#### Best Practices
| Skill | Description |
|-------|-------------|
| **vercel-react-best-practices** | React/Next.js performance optimization |
| **vercel-composition-patterns** | Scalable React composition patterns |
| **vercel-react-native-skills** | React Native and Expo best practices |
| **web-design-guidelines** | Web Interface Guidelines compliance |

### Skill Structure

Every skill follows a consistent structure:

```
skills/SkillName/
├── SKILL.md              # Skill definition, triggers, routing
├── README.md             # Documentation
├── Tools/                # Executable TypeScript tools
│   ├── ToolName.ts       #   bun run Tool.ts --args
│   └── package.json      #   Dependencies
├── Workflows/            # Step-by-step procedures
│   └── WorkflowName.md   #   Markdown workflow definitions
├── Components/           # Reusable sub-components
├── Data/                 # Static data files
└── State/                # Runtime state (gitignored)
```

---

## Agents

PAI deploys **13 specialized agents**, each with distinct expertise, personality, and tools. Agents are spawned as sub-processes with isolated context.

| Agent | Role | Specialization |
|-------|------|---------------|
| **Algorithm** | Core reasoning | ISC generation, phase execution, criteria evolution |
| **Architect** | System design | PhD-level distributed systems, constitutional principles |
| **Engineer** | Implementation | TDD, Fortune 10 experience, strategic planning |
| **Designer** | UX/UI | Design school pedigree, accessibility, scalable solutions |
| **Artist** | Visual content | Prompt engineering, model selection, editorial standards |
| **QATester** | Quality assurance | Browser automation, Gate 4 verification |
| **Pentester** | Offensive security | Vulnerability assessment, ethical penetration testing |
| **Intern** | General purpose | 176 IQ polymath, high-agency problem solving |
| **ClaudeResearcher** | Academic research | Multi-query decomposition, scholarly synthesis |
| **GeminiResearcher** | Multi-perspective research | Parallel investigations via Google Gemini |
| **GrokResearcher** | Contrarian research | Unbiased analysis via xAI Grok |
| **CodexResearcher** | Technical archaeology | Multi-model consultation (O3, GPT-5, GPT-4) |
| **PerplexityResearcher** | Investigative analysis | Triple-checked sources, evidence-based findings |

### Agent Capabilities

- **Parallel Spawning** — Multiple agents run simultaneously on independent tasks
- **Worktree Isolation** — Each agent gets its own git worktree for safe parallel development
- **Background Execution** — Non-blocking research and exploration
- **Team Coordination** — Agent teams with shared task boards and message passing
- **Best-of-N Selection** — Spawn N agents on the same task, pick the best result

---

## MCP Servers

PAI includes custom MCP (Model Context Protocol) servers that connect Claude Code agents to external systems and interactive interfaces. These are built with the official `@modelcontextprotocol/sdk` and run as stdio-transport servers.

### ask_user — Telegram Interactive Decisions

Bridges Claude's decision points to Telegram inline keyboard buttons, enabling human-in-the-loop confirmation without breaking the agent's execution flow. Built with the official `@modelcontextprotocol/sdk` using stdio transport.

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server(
  { name: "ask-user", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Claude calls ask_user() → server writes request file →
// Telegram bot renders inline buttons → user taps →
// choice is injected back as Claude's next input
```

**How it works:**
1. Claude's agent calls `ask_user({ question, options })` during autonomous execution
2. The MCP server writes a request file to a monitored directory
3. The Telegram bot picks up the request and renders inline keyboard buttons
4. The user taps a choice on their phone
5. The button response is routed back to Claude as input — no polling, no blocking

**Why this matters:** Most autonomous agents either run fully unattended (risky) or require you to be at a terminal (defeats the purpose). The `ask_user` MCP server creates a middle path — the agent runs autonomously and only surfaces decisions that genuinely need human input, delivered wherever you are.

---

## Hooks

PAI's **23 lifecycle hooks** fire on specific events, providing automatic behavior without explicit invocation.

| Hook | Event | Purpose |
|------|-------|---------|
| **StartupGreeting** | Session start | Display banner, load context, announce identity |
| **LoadContext** | Session start | Load PAI system context and active work |
| **SessionAutoName** | Session start | Auto-generate session names |
| **AlgorithmTracker** | Task creation | Track ISC criteria and progress |
| **AutoWorkCreation** | Task start | Create WORK directories and PRD stubs |
| **PRDSync** | PRD write/edit | Sync PRD state for dashboard visibility |
| **AgentExecutionGuard** | Agent spawn | Validate agent permissions and scope |
| **SecurityValidator** | Tool execution | Block dangerous commands, scan for secrets |
| **SkillGuard** | Skill invocation | Validate skill access and parameters |
| **VoiceGate** | Voice output | Route voice announcements to TTS server |
| **IntegrityCheck** | System check | Validate system configuration integrity |
| **CheckVersion** | Session start | Check for PAI system updates |
| **RatingCapture** | User feedback | Capture satisfaction ratings (1–10) |
| **RelationshipMemory** | Interaction | Track interaction patterns and preferences |
| **SessionSummary** | Session end | Generate session summary for continuity |
| **WorkCompletionLearning** | Task complete | Extract lessons and update learning system |
| **LastResponseCache** | Response | Cache last response for quick reference |
| **QuestionAnswered** | Q&A | Track answered questions for future reference |
| **SetQuestionTab** | Tab focus | Set terminal tab context for questions |
| **UpdateTabTitle** | Phase change | Update terminal tab title with current phase |
| **UpdateCounts** | Stats change | Update system statistics |
| **StopOrchestrator** | Stop signal | Graceful shutdown of background processes |
| **TelegramClean** | Telegram output | Format output for Telegram readability |

---

## Memory System

PAI's memory persists across conversations, enabling continuity and learning.

```
MEMORY/
├── WORK/                    # Active task PRDs
│   └── 20260313-task-slug/  #   Each task gets a timestamped directory
│       └── PRD.md           #   Product Requirements Document
├── STATE/                   # System state
│   ├── settings.json        #   Current configuration
│   └── active-sessions.json #   Running sessions
└── LEARNING/                # Accumulated knowledge
    └── REFLECTIONS/         #   Algorithm execution reflections
        └── algorithm-reflections.jsonl
```

### Memory Types

| Type | Purpose | Example |
|------|---------|---------|
| **User** | Who you are, preferences, expertise | "Senior engineer, prefers TypeScript + Bun" |
| **Feedback** | Corrections and behavioral guidance | "Don't mock the database — use real integration tests" |
| **Project** | Ongoing work context and decisions | "Auth rewrite driven by compliance, not tech debt" |
| **Reference** | Pointers to external resources | "Pipeline bugs tracked in Linear project INGEST" |

---

## Autonomous Loop

### Heartbeat

The Heartbeat is PAI's autonomous pulse — a launchd-scheduled loop that runs independently.

| Cycle | Schedule | Actions |
|-------|----------|---------|
| **Regular** | Every 15 min | Check integrations, run pending jobs, log activity |
| **Morning Review** | 6:00 AM | Metrics, open items, active projects, today's focus |
| **Nightly Reflection** | 11:00 PM | Review day, identify patterns, propose automations |

### Gateway

The Gateway (`localhost:18800`) provides a persistent HTTP/WebSocket server for:

- **Message Ingestion** — Receive messages from Telegram and other sources
- **Outbound Messaging** — Send proactive messages to Telegram (text + voice)
- **Background Tasks** — Submit and manage long-running tasks
- **Scheduling** — Schedule future outbound messages
- **Health Monitoring** — System status and health checks

### Autonomy Framework

| Level | Examples | Behavior |
|-------|----------|----------|
| **AUTONOMOUS** | Read email, check mentions, monitor sites, generate reports | Do it, log it |
| **ASK_FIRST** | Deploy, send external email, post to X, spend money | Ask via Telegram first |
| **NEVER** | Delete data, force push, financial transactions | Hard block, always escalate |

---

## Voice System

PAI has a local text-to-speech system for spoken phase announcements and notifications.

- **Engine:** [Kokoro TTS](https://github.com/remsky/Kokoro-FastAPI) running locally on port 8000
- **Voice Server:** Custom Bun.serve proxy on port 8888
- **Trigger:** Automatic at every Algorithm phase transition
- **Format:** `"Entering the [PHASE] phase."` spoken aloud

---

## Directory Structure

```
~/.claude/                        # PAI System Root
├── CLAUDE.md                     # Boot instructions (always loaded)
├── README.md                     # This file
├── .gitignore                    # Public/private boundary
│
├── skills/                       # 55+ domain skills
│   ├── PAI/                      #   The Algorithm — core reasoning
│   │   ├── SKILL.md              #     Algorithm definition
│   │   ├── Components/           #     Algorithm versions
│   │   │   └── Algorithm/        #       v3.7.0 (latest)
│   │   ├── Tools/                #     RebuildPAI, AutoMemory, Banner
│   │   └── USER/                 #     Personal data (gitignored)
│   ├── CORE/                     #   System architecture & docs
│   │   ├── SYSTEM/               #     Architecture, memory, hooks docs
│   │   └── USER/                 #     Identity, contacts (gitignored)
│   ├── Research/                 #   Multi-mode research system
│   ├── Art/                      #   Image generation
│   ├── Browser/                  #   Playwright automation
│   └── ...                       #   50+ more skills
│
├── hooks/                        # 23 lifecycle event handlers
│   ├── SecurityValidator.hook.ts #   Block dangerous commands
│   ├── AlgorithmTracker.hook.ts  #   Track ISC criteria
│   ├── VoiceGate.hook.ts         #   Route voice to TTS
│   ├── PRDSync.hook.ts           #   Sync PRD state
│   └── ...                       #   19 more hooks
│
├── agents/                       # 13 specialized agent definitions
│   ├── Algorithm.md              #   Core reasoning agent
│   ├── Architect.md              #   System design specialist
│   ├── Engineer.md               #   Implementation specialist
│   └── ...                       #   10 more agents
│
├── Gateway/                      # HTTP/WebSocket server
│   ├── gateway.ts                #   Main entry point
│   ├── brain.ts                  #   AI reasoning engine
│   ├── memory-extractor.ts       #   Auto-memory extraction
│   ├── rate-limiter.ts           #   Request rate limiting
│   ├── scheduler.ts              #   Message scheduling
│   └── secrets.ts                #   Secret management
│
├── Heartbeat/                    # Autonomous execution loop
│   ├── heartbeat.ts              #   Main heartbeat script
│   ├── autonomy.ts               #   3-tier escalation framework
│   ├── logger.ts                 #   Activity logging (JSONL)
│   ├── telegram.ts               #   Telegram integration
│   └── integrations/             #   Gmail, X, Vercel modules
│
├── VoiceServer/                  # Local TTS (Kokoro)
│   ├── server.ts                 #   Voice notification server
│   ├── start-kokoro.sh           #   Start Kokoro TTS engine
│   └── transcribe.py             #   Speech-to-text (Whisper)
│
├── claude-telegram-bot/          # Telegram bot
│   └── ...                       #   Bot source code
│
├── plugins/                      # Plugin management
│   └── blocklist.json            #   Blocked plugin list
│
├── images/                       # README images
│
├── Tools/                        # Utility scripts
│
├── MEMORY/                       # Persistent memory (gitignored)
│   ├── WORK/                     #   Task PRDs
│   ├── STATE/                    #   System state
│   └── LEARNING/                 #   Reflections & lessons
│
├── settings.json                 # Configuration (gitignored)
└── .env                          # API keys & secrets (gitignored)
```

---

## Quick Start

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- [Bun](https://bun.sh) runtime (`curl -fsSL https://bun.sh/install | bash`)
- macOS (launchd for heartbeat scheduling)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/MaxHarar/PAIArchitecture.git ~/.claude

# 2. Install dependencies
cd ~/.claude && bun install
cd ~/.claude/Gateway && bun install
cd ~/.claude/Heartbeat && bun install

# 3. Configure your identity
cp settings.json.template settings.json
cp .env.template .env
# Edit settings.json — set your name, assistant name, timezone
# Edit .env — add API keys (Telegram, Gmail, OpenAI, Anthropic, etc.)

# 4. Create personal data directories
mkdir -p skills/CORE/USER skills/PAI/USER MEMORY/{WORK,STATE,LEARNING/REFLECTIONS}

# 5. Start the heartbeat (autonomous loop)
launchctl load ~/Library/LaunchAgents/com.pai.heartbeat.plist
launchctl load ~/Library/LaunchAgents/com.pai.heartbeat-daily.plist
launchctl load ~/Library/LaunchAgents/com.pai.heartbeat-nightly.plist

# 6. Start the Gateway
bun run ~/.claude/Gateway/gateway.ts &

# 7. Start the Voice Server (optional)
bash ~/.claude/VoiceServer/start-kokoro.sh &
bun run ~/.claude/VoiceServer/server.ts &

# 8. Launch Claude Code
claude
```

### Integration Setup

Add API keys to `~/.claude/.env`:

```bash
# Telegram (required — primary communication channel)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# AI Models
ANTHROPIC_API_KEY=your_key        # Claude API (for inference tool)
OPENAI_API_KEY=your_key           # GPT-image-1, GPT-4 (art, research)
GOOGLE_AI_API_KEY=your_key        # Gemini (art, research)
REPLICATE_API_TOKEN=your_key      # Flux, Nano Banana (art)

# Gmail (optional)
GMAIL_CLIENT_ID=your_client_id
GMAIL_CLIENT_SECRET=your_client_secret

# X/Twitter (optional)
X_API_KEY=your_api_key
X_API_SECRET=your_api_secret

# Vercel (optional)
VERCEL_TOKEN=your_vercel_token

# Greptile (optional — codebase intelligence)
GREPTILE_API_KEY=your_key
```

### Verify Setup

```bash
# Test heartbeat configuration
bun run ~/.claude/Heartbeat/heartbeat.ts --test

# Dry run (log without acting)
bun run ~/.claude/Heartbeat/heartbeat.ts --dry-run

# Check Gateway health
curl http://localhost:18800/health

# Test voice
curl -X POST http://localhost:8888/notify \
  -H "Content-Type: application/json" \
  -d '{"message": "PAI is online", "voice_enabled": true}'
```

---

## How It Works Together

### The Daily Loop

```
6:00 AM   ─── Morning Review ──────────────────────────────────
              │ Metrics, open items, active projects
              │ Sent to Telegram as executive summary
              └─────────────────────────────────────────────────

Throughout  ─── Heartbeat (every 15 min) ──────────────────────
the day       │ Check Gmail, monitor deployments
              │ Run pending background tasks
              │ Escalate to Telegram if action needed
              └─────────────────────────────────────────────────

As needed   ─── Interactive Sessions ──────────────────────────
              │ You launch `claude` in terminal
              │ Full Algorithm execution for complex tasks
              │ Voice announcements at each phase
              └─────────────────────────────────────────────────

11:00 PM   ─── Nightly Reflection ─────────────────────────────
              │ Review day's activity
              │ Identify recurring patterns
              │ Propose new automations
              │ Update learning system
              └─────────────────────────────────────────────────
```

### Communication Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| **Telegram Bot** | Bidirectional | Primary async communication |
| **Daily Briefing Bot** | One-way (to you) | Morning executive summaries |
| **Terminal (Claude Code)** | Interactive | Complex tasks, deep thinking |
| **Voice Server** | One-way (to you) | Spoken phase announcements |
| **Gateway WebSocket** | Bidirectional | Real-time system events |

---

## Customization

PAI is designed to be personalized. Key customization points:

| What | Where | Purpose |
|------|-------|---------|
| **Identity** | `settings.json` | Your name, assistant name, timezone, voice |
| **AI Steering Rules** | `skills/CORE/USER/AISTEERINGRULES.md` | Behavioral rules and preferences |
| **Skill Customizations** | `skills/*/USER/` | Per-skill preferences and data |
| **Personal Context** | `skills/CORE/USER/` | Identity, contacts, projects |
| **Art Preferences** | `skills/PAI/USER/SKILLCUSTOMIZATIONS/Art/` | Default model, aesthetic |
| **Life Goals** | `skills/CORE/USER/TELOS/` | Goals, challenges, predictions |

---

## Security

PAI takes security seriously:

- **SecurityValidator Hook** — Blocks dangerous commands (`rm -rf /`, `DROP DATABASE`, force pushes)
- **Secret Scanning** — Self-contained credential scanner checks all staged files before commit
- **Autonomy Framework** — Three-tier escalation prevents unauthorized destructive actions
- **Gateway Auth** — Localhost-only binding with authentication tokens
- **Gitignore Boundary** — Strict `.gitignore` separates public architecture from private data
- **Agent Execution Guard** — Validates agent permissions and scope before spawning

---

## Inspiration & Credits

- **[PAI](https://github.com/danielmiessler/PAI)** by [Daniel Miessler](https://danielmiessler.com) — The upstream Personal AI Infrastructure this repo is forked from
- **[The Algorithm](https://github.com/danielmiessler/TheAlgorithm)** by [Daniel Miessler](https://danielmiessler.com) — The systematic reasoning framework at the core of PAI
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** by [Anthropic](https://anthropic.com) — The AI platform PAI extends
- **[Fabric](https://github.com/danielmiessler/fabric)** by Daniel Miessler — 240+ prompt patterns integrated as a PAI skill
- **[Kokoro TTS](https://github.com/remsky/Kokoro-FastAPI)** — Local text-to-speech engine for voice announcements

---

## License

This project shares the PAI architecture for educational and personal use. The Algorithm is by [Daniel Miessler](https://danielmiessler.com).

MIT License — see individual component licenses for specifics.

---

<p align="center">
  <em>PAI — An autonomous AI that thinks systematically, acts independently, and keeps you in control.</em>
</p>
