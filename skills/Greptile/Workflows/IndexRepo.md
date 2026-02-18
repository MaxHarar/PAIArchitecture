# IndexRepo Workflow

**Index, re-index, or check status of repositories in Greptile.**

## Voice Notification

```bash
curl -s -X POST http://localhost:8888/notify \
  -H "Content-Type: application/json" \
  -d '{"message": "Running the IndexRepo workflow in the Greptile skill to manage repository indexing"}' \
  > /dev/null 2>&1 &
```

Running **IndexRepo** in **Greptile**...

---

## When to Use

- User says "index this repo", "index my repo", "add repo to greptile"
- User says "re-index", "reload index", "refresh index"
- User says "index status", "is my repo indexed", "check indexing"
- User says "list indexed repos", "what repos are indexed"

## Workflow

### Step 1: Determine Action

Parse user intent into one of four actions:

| Intent | Action |
|--------|--------|
| "index this repo", "add repo" | **Index new** |
| "re-index", "reload", "refresh" | **Re-index** (reload=true) |
| "index status", "is it indexed" | **Check status** |
| "list repos", "what's indexed" | **List tracked** |

### Step 2: Resolve Repository (for index/re-index/status)

If user specifies a repo explicitly (e.g., "index maxharar/suitlog"), use that.

Otherwise, auto-detect from current working directory:

```bash
git remote get-url origin 2>/dev/null
```

Parse the output to extract `owner/repo` and detect remote (github/gitlab). Also detect the current branch:

```bash
git branch --show-current 2>/dev/null
```

If neither explicit nor auto-detected, ask the user.

### Step 3: Execute Action

**Index new repo — MCP (primary):**

Use `mcp__greptile__index_repository` with:
- `remote`: "github" or "gitlab"
- `repository`: "owner/repo"
- `branch`: branch name

**Index new repo — API fallback:**

```bash
curl -s -X POST "https://api.greptile.com/v2/repositories" \
  -H "Authorization: Bearer $GREPTILE_API_KEY" \
  -H "X-Github-Token: $(gh auth token)" \
  -H "Content-Type: application/json" \
  -d '{"remote":"github","repository":"owner/repo","branch":"main","reload":false}'
```

**Re-index — same as above but with `reload: true`.**

**Check status — MCP (primary):**

Use `mcp__greptile__get_repository_info` with:
- `remote`: "github" or "gitlab"
- `repository`: "owner/repo"
- `branch`: branch name

**Check status — API fallback:**

```bash
curl -s "https://api.greptile.com/v2/repositories/github%3Abranch%3Aowner%2Frepo" \
  -H "Authorization: Bearer $GREPTILE_API_KEY" \
  -H "X-Github-Token: $(gh auth token)"
```

**List tracked repos:**

Read `~/.claude/skills/Greptile/Repositories.md` and display the table.

### Step 4: Update Repositories.md

After a successful index or re-index, update `~/.claude/skills/Greptile/Repositories.md`:

- **New repo:** Add a row to the table with status from the API response
- **Re-index:** Update the "Last Indexed" date and status for the existing entry
- **Status check:** Update status if it has changed (e.g., `processing` → `completed`)

Use today's date for "Last Indexed" in format `YYYY-MM-DD`.

### Step 5: Report Results

**Index submitted:**
```
✅ Repository `owner/repo` (branch) submitted for indexing.
Status: submitted — indexing typically completes in 1-5 minutes.
Use "check index status" to monitor progress.
```

**Status check:**
```
📊 Repository: owner/repo (branch)
Status: completed
Files processed: 42/42
```

**List tracked:**
Display the Repositories.md table directly.

## Speed Target

~5-10 seconds for index submission, ~3 seconds for status checks
