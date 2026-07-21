# Contributing

## Overview

This repository organizes an agent platform around a few stable boundaries: runtime services in `Gateway/` and `Heartbeat/`, reusable behavior in `skills/`, event-driven extensions in `hooks/`, and agent definitions in `agents/`. Contributions should preserve those boundaries, keep examples runnable with Bun, and prefer small changes that are easy to review and verify.

## Getting Started

Fork the repository, clone your fork locally, install root dependencies, and then install the service-level dependencies used by the CI workflow.

```bash
git clone <fork-url> pai-architecture
cd pai-architecture
bun install
(cd Gateway && bun install)
(cd Heartbeat && bun install)
```

Before opening a pull request, run the commands relevant to the area you changed and inspect the files you touched with `git diff`.

## Project Structure

Use this layout as the default map when deciding where a change belongs.

```text
.
├── Gateway/         # Gateway runtime, prompts, and service dependencies
├── Heartbeat/       # Background jobs, integrations, and support services
├── agents/          # Agent definitions written as markdown with frontmatter
├── hooks/           # TypeScript hooks that read input and emit structured output
├── skills/          # Skills, workflows, tools, and supporting docs
├── Observability/   # Monitoring and observability applications
├── PAI-Install/     # Installer and bootstrap flows
├── docs/            # Additional repository documentation
├── CLAUDE.md        # Repository-level Claude Code context
└── package.json     # Root workspace metadata
```

If a change spans multiple directories, keep each edit focused on the responsibility of that directory instead of moving logic into a generic catch-all location.

## Adding a Skill

Create new skills under `skills/` and keep the package small enough that another contributor can understand its routing, workflows, and tools from the directory alone.

```text
skills/SkillName/
├── SKILL.md        # Trigger conditions, routing, description
├── Workflows/      # Step-by-step workflow markdown files
├── Tools/          # Executable TypeScript tools (bun run Tool.ts)
└── README.md       # Documentation
```

Start `SKILL.md` with clear frontmatter so routing stays explicit.

```md
---
name: SkillName
description: Summarize and route repository work for a narrow task area.
triggers:
  - repository audit
  - summarize findings
---
```

Keep workflow files procedural, keep tools executable with Bun, and document the entry points you expect contributors to run. A typical tool invocation looks like this:

```bash
bun run skills/SkillName/Tools/ExampleTool.ts
```

## Adding a Hook

Hooks live in `hooks/` and should behave like small filters: read JSON from standard input, transform or validate it, and write JSON to standard output.

```ts
#!/usr/bin/env bun

type HookInput = {
  event: string;
  payload?: Record<string, unknown>;
};

type HookOutput = {
  continue: boolean;
  message?: string;
};

async function main(): Promise<void> {
  const raw = await new Response(Bun.stdin.stream()).text();
  const input = JSON.parse(raw) as HookInput;

  const output: HookOutput = {
    continue: true,
    message: `Handled ${input.event}`
  };

  process.stdout.write(`${JSON.stringify(output)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
```

For local testing, pipe a JSON fixture into the hook:

```bash
printf '{"event":"SessionStart","payload":{"repo":"PAIArchitecture"}}\n' | bun run hooks/MyHook.hook.ts
```

## Defining an Agent

Files in `agents/` are markdown documents with YAML frontmatter that declares how the agent should be selected and what it is allowed to do. Keep the frontmatter stable and make the body instructions specific to the agent's role.

The core fields are:

- `name`: the agent's display name.
- `description`: when to use the agent and what it is responsible for.
- `model`: the default model selection for that agent.
- `persona`: the behavioral framing, tone, or role description.
- `permissions`: the tool and action permissions granted to the agent.

Minimal example:

```md
---
name: CodeReviewer
description: Review repository changes for correctness, regressions, and security issues.
model: sonnet
persona:
  role: Senior reviewer
  style: Concise and evidence-based
permissions:
  allow:
    - Read(*)
    - Grep(*)
    - Bash(git status)
---
```

After the frontmatter, use the markdown body for operating instructions, review criteria, startup checks, or repository-specific constraints.

## The CLAUDE.md Context File

`CLAUDE.md` is part of the repository's agent guidance documentation and context files. Claude Code loads it automatically when sessions start in the repo, so its contents shape the default behavior, operating rules, and repository context seen by agents before they act.

Keep `CLAUDE.md` concise, durable, and repository-specific. Put stable rules there, and put narrow workflow details in the directory that owns them.

## Submitting Changes

Use a fork, create a branch for a single change, commit only the files that belong to that change, and open a pull request against `main`.

```bash
git checkout -b docs/add-contributing-guide
git status
git add CONTRIBUTING.md .github/workflows/ci.yml
git commit -m "Add CI validation and contributor guide"
git push origin docs/add-contributing-guide
```

Then open a pull request from your branch to `main`, describe what changed, list the verification you ran, and call out any follow-up work that is intentionally out of scope for the branch.
