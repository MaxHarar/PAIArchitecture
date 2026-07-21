---
name: Greptile
description: AI-powered codebase intelligence via Greptile. USE WHEN user wants to search codebase, ask questions about code, find code references, understand code architecture, index repository, check index status, re-index repo, OR mentions greptile, code intelligence, code query, codebase search.
---

## Customization

**Before executing, check for user customizations at:**
`~/.claude/skills/CORE/USER/SKILLCUSTOMIZATIONS/Greptile/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.


## 🚨 MANDATORY: Voice Notification (REQUIRED BEFORE ANY ACTION)

**You MUST send this notification BEFORE doing anything else when this skill is invoked.**

1. **Send voice notification**:
   ```bash
   curl -s -X POST http://localhost:8888/notify \
     -H "Content-Type: application/json" \
     -d '{"message": "Running the WORKFLOWNAME workflow in the Greptile skill to ACTION"}' \
     > /dev/null 2>&1 &
   ```

2. **Output text notification**:
   ```
   Running the **WorkflowName** workflow in the **Greptile** skill to ACTION...
   ```

**This is not optional. Execute this curl command immediately upon skill invocation.**

# Greptile — AI-Powered Codebase Intelligence

Query, search, and index codebases using Greptile's AI-powered code understanding. Works via MCP tools (primary) with direct API fallback.

## Workflow Routing

| Trigger | Workflow |
|---------|----------|
| "how does X work in repo", "explain the code", "ask about codebase", "query code", "what does this do" | `Workflows/QueryCode.md` |
| "find references to", "search code for", "where is X used", "find all instances of" | `Workflows/SearchCode.md` |
| "index this repo", "re-index", "index status", "add repo to greptile", "list indexed repos" | `Workflows/IndexRepo.md` |

## Quick Reference

**MCP Tools (primary — auth handled automatically):**
- `mcp__greptile__query_repository` — Natural language codebase Q&A
- `mcp__greptile__index_repository` — Index a new repo
- `mcp__greptile__get_repository_info` — Check index status
- `mcp__greptile__greptile_help` — API help/docs

**Genius mode:** Auto-enabled for architectural and complex questions (e.g., "how does X work", "explain the flow of"). Provides deeper analysis at the cost of slightly longer response times.

**Tracked repos:** See `Repositories.md` for currently indexed repositories.

**API fallback:** If MCP is unavailable, use direct API calls with `GREPTILE_API_KEY` env var and `gh auth token` for GitHub auth. See `ApiReference.md` for endpoints.

## Examples

**Example 1: Ask about code architecture**
```
User: "How does claims validation work in example-repo?"
→ Invokes QueryCode workflow
→ Resolves repo to YOUR_USERNAME/example-repo from Repositories.md
→ Queries with genius mode (architectural question)
→ Returns answer with source file references
```

**Example 2: Find code references**
```
User: "Find all references to authentication in my codebase"
→ Invokes SearchCode workflow
→ Auto-detects repo from git remote or Repositories.md
→ Returns table of matching files sorted by relevance
```

**Example 3: Index a new repository**
```
User: "Index this repo" (from within a git project)
→ Invokes IndexRepo workflow
→ Reads git remote to detect owner/repo
→ Indexes via MCP, updates Repositories.md
→ Reports indexing status
```
