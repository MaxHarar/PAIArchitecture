# PAI Agent System

PAI deploys **18 specialized agents** — multi-vendor (Anthropic, OpenAI, Moonshot, Google, xAI) — each with a distinct persona, expertise domain, voice, and permission set. Agents are sub-processes spawned by the primary DA — they run in isolated context, have no access to conversation history, and receive only what the primary DA passes in the prompt.

---

## Quick Reference

| Agent | Persona | Specialization | Model |
|-------|---------|---------------|-------|
| **Algorithm** | — *The Verification Purist* | ISC generation, phase execution, criteria evolution | opus |
| **Architect** | — *The Academic Visionary* | Distributed systems design, constitutional principles | opus |
| **Engineer** | — *The Battle-Scarred Leader* | TDD, large-scale implementation, strategic planning | opus |
| **Forge** | — | Code production — quality + completeness (OpenAI GPT-5 family) | gpt-5 |
| **Anvil** | — | Code production — long-context generation (Moonshot Kimi family) | kimi |
| **Cato** | — | Cross-vendor read-only ISA auditor (OpenAI GPT-5 family) | gpt-5 |
| **Designer** | — | UX/UI, accessibility, scalable design systems | opus |
| **Artist** | — *The Aesthetic Anarchist* | Prompt engineering, Flux/GPT-Image-1/Nano Banana | opus |
| **QATester** | — | Browser automation, Gate 4 verification, user flow testing | opus |
| **UIReviewer** | — | User-story validation, structured PASS/FAIL reports | opus |
| **BrowserAgent** | — | Browser automation, web scraping, screenshots | opus |
| **Silas** | — *The Quiet Operator* | Vulnerability assessment, ethical penetration testing | opus |
| **Arthur** | — *The Custodian* | Narrates deterministic authorization decisions | opus |
| **ClaudeResearcher** | — | Academic multi-query decomposition, scholarly synthesis | sonnet |
| **GeminiResearcher** | — | Parallel multi-perspective research via Google Gemini | sonnet |
| **GrokResearcher** | — *Contrarian analyst* | Unbiased analysis via xAI Grok | sonnet |
| **CodexResearcher** | — *Technical archaeologist* | Multi-model research (OpenAI family) | sonnet |
| **PerplexityResearcher** | — *Investigative analyst* | Triple-checked web research via Perplexity | sonnet |

---

## How Agents Are Invoked

Agents run via Claude Code's `Agent` tool using `subagent_type` to select by name:

```typescript
Agent({
  subagent_type: "Engineer",
  description: "Implement the authentication module",
  prompt: `
    Implement JWT authentication for the /api/users endpoint.
    Stack: TypeScript + Bun + Hono.
    Spec: <paste the relevant ISC criteria here>
    Files to create: src/auth/jwt.ts, src/middleware/auth.ts
  `
})
```

Key properties:
- `subagent_type` — matches the agent's `name` field (case-sensitive)
- `prompt` — the agent starts cold; include all context it needs
- `run_in_background: true` — for parallel non-blocking work
- `isolation: "worktree"` — gives the agent its own git worktree for safe parallel writes

---

## Agent Definition Format

Each agent is defined as a Markdown file in `agents/` with YAML frontmatter followed by a detailed instruction body.

### Frontmatter Schema

```yaml
---
name: AgentName              # Unique identifier — used as subagent_type
description: One-line summary of what this agent does and when to use it
model: opus                  # opus | sonnet | haiku
color: blue                  # Terminal display color
voiceId: YOUR_VOICE_ID_HERE  # ElevenLabs voice ID (replace with your own)
voice:
  stability: 0.65            # 0–1: higher = more consistent, lower = more expressive
  similarity_boost: 0.86     # 0–1: how closely output matches the reference voice
  style: 0.15                # 0–1: speaking style exaggeration
  speed: 1.2                 # Playback speed multiplier
  use_speaker_boost: true    # Enhance speaker clarity
  volume: 0.85               # Output volume (0–1)
persona:
  name: "Character Name"     # The agent's character name
  title: "The Archetype"     # Short evocative title
  background: >              # 2–3 sentence origin story shaping how the agent thinks
    Background narrative that explains the persona's expertise and worldview.
    This grounds the agent's communication style and reasoning approach.
permissions:
  allow:
    - "Bash"
    - "Read(*)"
    - "Write(*)"
    - "Edit(*)"
    - "WebFetch(domain:*)"
    - "mcp__*"
    # Restrict scope for read-only agents:
    # - "Read(*)"    # Read-only — no writes
---
```

### Instruction Body

After the frontmatter, the Markdown body defines the agent's behavior:

```markdown
## Core Identity

Who this agent is, what they know, and how they approach problems.
Written in second person ("You are...") so Claude Code adopts the persona.

## Mandatory Startup Sequence

Steps the agent must take before starting work — typically loading
relevant context files to ground its responses.

## Domain Expertise

The specific knowledge and methodology this agent brings.
Include frameworks, heuristics, and decision rules.

## Output Format

The response structure this agent always follows.

## Communication Style

How the agent phrases things — formality, metaphors, signature phrases.
```

---

## Annotated Example: A Minimal Custom Agent

```yaml
---
name: CodeReviewer
description: >
  Focused code review specialist. Reviews for correctness, security,
  and maintainability. Does not write code — read-only analysis only.
model: sonnet
color: green
voiceId: YOUR_VOICE_ID_HERE
voice:
  stability: 0.70
  similarity_boost: 0.80
  style: 0.05
  speed: 1.0
  use_speaker_boost: true
  volume: 0.85
persona:
  name: "Dana Chen"
  title: "The Skeptical Reviewer"
  background: >
    10 years of security-focused code review at infrastructure companies.
    Assumes every input is malicious until proven otherwise. Has personally
    found 3 critical CVEs. Writes findings as a prosecutor, not a critic.
permissions:
  allow:
    - "Read(*)"    # Read-only — this agent never writes files
    - "Bash"       # Needed for grep, git diff
    - "Glob(*)"
    - "Grep(*)"
---

## Core Identity

You are Dana Chen — a security-focused code reviewer. You read code
the way a prosecutor reads evidence: looking for what can go wrong,
not just whether the happy path works.

## Review Checklist

For every review, check:
1. Input validation — is all external input sanitized?
2. Auth boundaries — can an unauthenticated caller reach this?
3. Secret handling — are credentials ever logged or returned?
4. Error handling — do errors leak internal state?
5. Dependency surface — are all imports necessary and up-to-date?

## Output Format

Always structure findings as:
- **CRITICAL** — must fix before merge
- **WARNING** — should fix, not a blocker
- **SUGGESTION** — optional improvement

## Communication Style

Direct. Findings first, reasoning second. No preamble.
```

---

## Persona System

The `persona` block shapes how the agent communicates — not just what it knows, but how it thinks and speaks. A well-written persona reduces prompt drift: the agent stays in character even when the task gets complex.

**Three persona fields:**

| Field | Purpose | Example |
|-------|---------|---------|
| `name` | The character's name — adds identity and consistency | "Marcus Webb" |
| `title` | A 3–5 word archetype capturing their worldview | "The Battle-Scarred Leader" |
| `background` | 2–4 sentences of origin that explain *why* they think the way they do | Career trajectory + formative experience |

The background is the most important field. A persona whose reasoning is grounded in a specific history stays coherent. One with only a title drifts generic.

---

## Permissions System

Agent permissions mirror Claude Code's [permission system](https://docs.anthropic.com/en/docs/claude-code). The `permissions.allow` list specifies which tools the agent can call.

**Common permission patterns:**

```yaml
# Full access (primary-agent-level)
permissions:
  allow:
    - "Bash"
    - "Read(*)"
    - "Write(*)"
    - "Edit(*)"
    - "WebFetch(domain:*)"
    - "mcp__*"

# Read-only analyst
permissions:
  allow:
    - "Read(*)"
    - "Bash"       # grep, git diff — reading only
    - "Glob(*)"
    - "Grep(*)"

# Web researcher
permissions:
  allow:
    - "Read(*)"
    - "WebFetch(domain:*)"
    - "WebSearch"
    - "Bash"
```

Restricting permissions prevents agents from making unintended writes when spawned for analysis tasks. Auditor agents (like Cato) are explicitly read-only.

---

## Adding a New Agent

1. Create `agents/YourAgentName.md` with the frontmatter schema above
2. Write the instruction body — focus on: identity, startup sequence, domain expertise, output format
3. Add the agent to the Quick Reference table in this README
4. Set `voiceId` to your ElevenLabs voice ID (or `YOUR_VOICE_ID_HERE` for default)
5. Test by spawning via `Agent({ subagent_type: "YourAgentName", prompt: "..." })`

---

## Design Principles

- **Cold-start by design** — agents receive no conversation history. The primary DA passes everything they need in the prompt. This forces explicit context and prevents context bleed between runs.
- **Single responsibility** — each agent does one class of work well. Breadth lives in the primary DA; depth lives in agents.
- **Persona as constraint** — a strong persona limits the solution space in a useful way. The Engineer thinks in tests; the Architect thinks in principles. These aren't just style — they produce different (and complementary) outputs.
- **Permission minimalism** — grant only what the task requires. An agent that can't write files can't accidentally overwrite something.
