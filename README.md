# PAI — Personal AI Infrastructure

> A general problem-solving system for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that magnifies human capabilities through structured reasoning, agent orchestration, and persistent memory.

PAI transforms Claude Code from a code assistant into a full personal AI operating system. It adds 45+ skills, 21 hooks, 13 specialized agents, voice interaction, a web dashboard, and a systematic reasoning algorithm that turns every request into verifiable, hill-climbable work.

**Built on [The Algorithm](https://github.com/danielmiessler/TheAlgorithm)** by Daniel Miessler — a framework for transitioning from current state to ideal state through discrete, testable criteria.

---

## What PAI Does

- **Structured Reasoning** — Every task goes through OBSERVE → THINK → PLAN → BUILD → EXECUTE → VERIFY → LEARN with Ideal State Criteria that serve as both definition and verification
- **45+ Skills** — Domain-specific capabilities: security assessment, research, writing, fitness coaching, browser automation, art generation, daily briefings, and more
- **21 Hooks** — Lifecycle event handlers: session startup, security validation, algorithm tracking, voice gating, rating capture, relationship memory
- **13 Agents** — Specialized workers: Algorithm, Architect, Engineer, Designer, Researcher (5 variants), Pentester, QA Tester, Artist, Intern
- **Voice System** — Local TTS via Kokoro with phase-by-phase spoken updates
- **Web Dashboard** — Real-time visibility into algorithm execution, criteria progress, and session state
- **Telegram Integration** — Chat with your AI via Telegram, receive daily briefings
- **Persistent Memory** — Work sessions, learning, and relationship context survive across conversations
- **PRD System** — Every task creates a Product Requirements Document with verifiable criteria that persists to disk

---

## Directory Structure

```
~/.claude/
├── skills/              # 45+ domain skills (the core capability layer)
│   ├── PAI/             #   The Algorithm — core reasoning engine
│   ├── CORE/            #   System architecture, docs, steering rules
│   │   ├── SYSTEM/      #     Universal system documentation
│   │   └── USER/        #     YOUR personal data (git-ignored)
│   ├── Browser/         #   Playwright-based browser automation
│   ├── Research/        #   Multi-model parallel research
│   ├── RedTeam/         #   32-agent adversarial analysis
│   ├── Council/         #   Multi-agent structured debate
│   ├── WriteStory/      #   Fiction writing with storytelling science
│   ├── Art/             #   Visual content generation
│   ├── FitnessCoach/    #   Garmin + calendar fitness coaching
│   ├── WebAssessment/   #   Security penetration testing
│   └── ...              #   40+ more skills
├── hooks/               # 21 lifecycle event handlers
│   ├── handlers/        #   Shared hook handler logic
│   └── lib/             #   Hook utility libraries
├── agents/              # 13 specialized agent definitions
├── VoiceServer/         # Local TTS (Kokoro) + voice notification server
├── Observability/       # MenuBar status app + observability tools
├── PAI-Install/         # Installation wizard
├── pai-web-ui/          # Web dashboard (Next.js)
├── claude-telegram-bot/ # Telegram bot for mobile AI chat
├── Tools/               # Standalone utility scripts
├── lib/                 # Shared libraries
├── CLAUDE.md            # Entry point (loads PAI skill)
├── settings.json        # YOUR config (git-ignored, see template)
├── .env                 # YOUR secrets (git-ignored, see template)
└── package.json         # Dependencies
```

---

## Quick Start

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- [Bun](https://bun.sh) runtime (`curl -fsSL https://bun.sh/install | bash`)
- macOS or Linux (Windows via WSL)

### Installation

```bash
# 1. Clone into ~/.claude
git clone https://github.com/maxharar/PAIArchitecture.git ~/.claude

# 2. Install dependencies
cd ~/.claude && bun install

# 3. Set up your configuration
cp settings.json.template settings.json
cp .env.template .env
# Edit settings.json — set your name, DA name, API keys
# Edit .env — add your API keys

# 4. Create your personal data directories
mkdir -p skills/CORE/USER skills/PAI/USER MEMORY

# 5. Launch Claude Code
claude
```

### First Run

On your first `claude` session, PAI will:
1. Load the Algorithm from `skills/PAI/SKILL.md`
2. Execute startup hooks (greeting, context loading)
3. Be ready to process any request through the 7-phase Algorithm

---

## Architecture Overview

### The Algorithm (v1.5.0)

The core reasoning loop that processes every request:

```
OBSERVE → THINK → PLAN → BUILD → EXECUTE → VERIFY → LEARN
   │         │       │       │        │         │        │
   │         │       │       │        │         │        └─ Capture learnings
   │         │       │       │        │         └─ Verify ALL criteria pass
   │         │       │       │        └─ Run the work
   │         │       │       └─ Create artifacts
   │         │       └─ Strategy + PRD creation
   │         └─ Pressure test criteria
   └─ Reverse engineer → Ideal State Criteria
```

**Ideal State Criteria (ISC)** are the centerpiece — discrete, 8-12 word, binary-testable conditions that define success. They serve as both the definition of done AND the verification checklist. The Algorithm hill-climbs toward all criteria passing.

### Skills System

Each skill is a self-contained capability with:
- `SKILL.md` — Trigger conditions, instructions, workflows
- `SYSTEM/` — Universal documentation and templates
- `USER/` — Your personal data (git-ignored)
- `Tools/` — TypeScript utilities
- `Components/` — Reusable prompt components

### Hooks System

Event-driven handlers that fire on Claude Code lifecycle events:

| Event | Example Hooks |
|-------|--------------|
| `SessionStart` | Load context, startup greeting, version check |
| `UserPromptSubmit` | Rating capture, auto work creation, tab title |
| `PreToolUse` | Security validation, voice gating, skill guard |
| `PostToolUse` | Algorithm tracking, question handling |
| `SessionEnd` | Learning capture, session summary, relationship memory |
| `Stop` | Stop orchestration |

### Agent System

Specialized agents spawned via Claude Code's Task tool:

| Agent | Role |
|-------|------|
| Algorithm | ISC-specialized reasoning |
| Architect | System design and structure |
| Engineer | Implementation with TDD |
| Designer | UX/UI with accessibility |
| Artist | Visual content creation |
| Pentester | Security testing |
| QATester | Quality assurance validation |
| Researcher (5x) | Multi-model parallel research (Claude, Gemini, Grok, Codex, Perplexity) |
| Intern | High-agency generalist problem solver |

---

## Customization

### Personal Data (`USER/` directories)

PAI separates architecture from personal data:

- **`skills/CORE/USER/`** — Your identity, contacts, projects, health goals, finances
- **`skills/PAI/USER/`** — Your AI steering rules and DA identity customization
- **`MEMORY/`** — Work sessions, learning history, signals, research

These directories are git-ignored. Create them and add your personal context.

### Settings

Edit `settings.json` to configure:
- **`principal`** — Your name, timezone
- **`daidentity`** — Your AI's name, voice, personality
- **`env`** — API keys (Greptile, etc.)
- **`hooks`** — Which hooks run on which events
- **`permissions`** — Tool allow/deny/ask lists

### Adding Skills

Skills live in `skills/`. Each skill directory contains at minimum a `SKILL.md` with trigger conditions and instructions. See existing skills for the pattern.

### Adding Hooks

Hooks are TypeScript files in `hooks/`. They receive event context via stdin and return JSON responses. See `hooks/README.md` for the handler pattern.

---

## Voice System

PAI includes a local voice server for spoken phase announcements:

```bash
# Start voice server (Kokoro TTS, no API keys needed)
~/.claude/VoiceServer/start.sh
```

- **Kokoro** — Local, free, high-quality TTS (80MB model)
- Phase announcements during Algorithm execution
- Configurable voice and prosody

---

## Links

- **[The Algorithm](https://github.com/danielmiessler/TheAlgorithm)** — The reasoning framework PAI implements
- **[Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code)** — The platform PAI extends
- **[Daniel Miessler](https://danielmiessler.com)** — Creator of The Algorithm and PAI concept

---

## License

This project shares the PAI architecture for educational and personal use. The Algorithm is by Daniel Miessler.

---

*PAI — Because the best AI assistant is one that thinks systematically, remembers persistently, and verifies rigorously.*
