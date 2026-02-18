# SearchCode Workflow

**Find specific code references across indexed repositories.**

## Voice Notification

```bash
curl -s -X POST http://localhost:8888/notify \
  -H "Content-Type: application/json" \
  -d '{"message": "Running the SearchCode workflow in the Greptile skill to search the codebase"}' \
  > /dev/null 2>&1 &
```

Running **SearchCode** in **Greptile**...

---

## When to Use

- User wants to find where something is used or defined
- User says "find references to", "search code for", "where is X used"
- User says "find all instances of", "search my codebase for"
- User wants a list of matching files, not an explanation

**Key distinction:** SearchCode returns a **list of file references**. For understanding or explanation, use QueryCode instead.

## Workflow

### Step 1: Resolve Repository

Same cascade as QueryCode — see `Workflows/QueryCode.md` Step 1:

1. Explicit mention → match Repositories.md
2. Auto-detect from `git remote get-url origin`
3. User customization default
4. Single tracked repo → use it
5. Multiple → ask user
6. None → suggest IndexRepo

### Step 2: Search via API

The MCP does not expose a dedicated search tool, so use the direct API:

```bash
curl -s -X POST "https://api.greptile.com/v2/search" \
  -H "Authorization: Bearer $GREPTILE_API_KEY" \
  -H "X-Github-Token: $(gh auth token)" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "USER_SEARCH_QUERY",
    "repositories": [{"remote":"REMOTE","repository":"OWNER/REPO","branch":"BRANCH"}],
    "stream": false
  }'
```

**If `GREPTILE_API_KEY` is not set**, fall back to using `mcp__greptile__query_repository` with the search query prefixed by "Find all references to: " — this gives search-like results from the query endpoint.

### Step 3: Format Results

Present results as a table sorted by relevance:

```markdown
**Search results for:** `search query`
**Repository:** owner/repo (branch)

| # | File | Lines | Summary |
|---|------|-------|---------|
| 1 | `src/auth/handler.ts` | 15-42 | JWT token validation logic |
| 2 | `src/middleware/auth.ts` | 1-35 | Auth middleware setup |
| 3 | `tests/auth.test.ts` | 10-28 | Authentication test suite |
```

If no results found:
```
No results found for "query" in owner/repo.
💡 Try broadening your search terms, or use QueryCode for natural language questions.
```

### Step 4: Suggest Next Steps

```
💡 **Next:** Use QueryCode for deeper analysis of any result — e.g., "How does authentication work in src/auth/handler.ts?"
```

## Speed Target

~3-8 seconds for results
