# QueryCode Workflow

**Natural language Q&A against indexed codebases using Greptile's AI.**

## Voice Notification

```bash
curl -s -X POST http://localhost:8888/notify \
  -H "Content-Type: application/json" \
  -d '{"message": "Running the QueryCode workflow in the Greptile skill to query the codebase"}' \
  > /dev/null 2>&1 &
```

Running **QueryCode** in **Greptile**...

---

## When to Use

- User asks a question about how code works
- User wants to understand code architecture or flow
- User says "ask greptile", "query codebase", "how does X work in repo"
- User wants explanation of code behavior across files
- Any natural language question that requires understanding code relationships

## Workflow

### Step 1: Resolve Repository

Follow this cascade — stop at the first match:

1. **Explicit mention:** User names a repo (e.g., "in suitlog", "in my-project")
   → Match against entries in `~/.claude/skills/Greptile/Repositories.md`

2. **Auto-detect from cwd:** Run `git remote get-url origin` in the current working directory
   → Parse owner/repo, match against Repositories.md
   → Also get branch from `git branch --show-current`

3. **User customization default:** Check `~/.claude/skills/CORE/USER/SKILLCUSTOMIZATIONS/Greptile/PREFERENCES.md` for a `default_repository` setting

4. **Single tracked repo:** If Repositories.md has exactly one entry, use it

5. **Multiple tracked repos:** Ask the user which repo to query using AskUserQuestion

6. **No repos indexed:** Suggest running the IndexRepo workflow first

### Step 2: Determine Genius Mode

Auto-enable genius mode for deeper analysis on architectural questions:

| Question Type | Genius | Examples |
|--------------|--------|---------|
| Architecture / flow | ✅ Yes | "How does X work?", "Explain the flow of Y", "What's the architecture of Z?" |
| Relationships | ✅ Yes | "How do A and B interact?", "What depends on X?" |
| Quick lookup | ❌ No | "Where is X defined?", "What type is Y?", "What does this function return?" |

User can override: "use genius mode" forces on, "quick query" forces off.

### Step 3: Query via MCP (Primary)

Use `mcp__greptile__query_repository` with:
- `query`: The user's question (pass through naturally)
- `repository`: `owner/repo` from Step 1
- `branch`: Branch name from Step 1
- `genius`: Boolean from Step 2

### Step 3b: Query via API (Fallback)

If MCP is unavailable:

```bash
curl -s -X POST "https://api.greptile.com/v2/query" \
  -H "Authorization: Bearer $GREPTILE_API_KEY" \
  -H "X-Github-Token: $(gh auth token)" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"id":"q1","content":"USER_QUESTION","role":"user"}],
    "repositories": [{"remote":"REMOTE","repository":"OWNER/REPO","branch":"BRANCH"}],
    "genius": GENIUS_BOOL,
    "stream": false
  }'
```

### Step 4: Format Response

Present the answer followed by a sources table:

```markdown
**Answer:**
[Greptile's response — present as-is, do not summarize or rewrite]

**Sources:**
| File | Lines | Summary |
|------|-------|---------|
| `src/auth/handler.ts` | 15-42 | Main authentication handler |
| `src/middleware/jwt.ts` | 1-28 | JWT validation middleware |
```

If the response includes code snippets, preserve them with proper syntax highlighting.

### Step 5: Suggest Follow-ups

Based on the answer, suggest 1-2 natural follow-up questions:

```
💡 **Follow-ups:**
- "How is [related concept] implemented?"
- "What calls [function mentioned in answer]?"
```

## Speed Target

~5-15 seconds depending on genius mode (genius takes longer)
