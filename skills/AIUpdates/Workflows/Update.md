# Update Workflow

Fetch and categorize AI news from configured sources.

## Process

### Step 1: Load State

```bash
read State/last-check.json
```

Get last check timestamp and previously seen items.

### Step 2: Fetch Sources (Parallel)

Use WebFetch in parallel for all sources defined in `sources.json`:

```
For each source in sources.json:
  WebFetch(source.url, "Extract recent AI news, announcements, and updates. Return: title, date, summary, URL, category (news/research/ideas)")
```

**Parallelization:** Launch up to 8 parallel fetches to minimize latency.

### Step 3: Categorize Items

Sort fetched items into three categories:

| Category | Emoji | Criteria |
|----------|-------|----------|
| **AI News** | :rocket: | Product launches, model releases, company announcements, API updates |
| **AI Research** | :test_tube: | Papers, benchmarks, technical breakthroughs, architecture innovations |
| **AI Ideas** | :bulb: | Opinion, analysis, predictions, policy, ethics |

### Step 4: Rank by Importance

Within each category, rank by:

1. **Recency** - Newer items ranked higher
2. **Impact** - Major releases over minor updates
3. **Source authority** - Primary sources over aggregators
4. **Novelty** - New information over rehashed content

### Step 5: Apply Limits

From `sources.json` limits:
- `max_total_items`: 32
- Target per category: ~10-12 for news/research, ~8 for ideas

### Step 6: Format Output

```markdown
# AI Updates - {DATE}

## :rocket: AI News
1. **{Title}** - {Summary} ([Source]({URL}))
...

## :test_tube: AI Research
1. **{Title}** - {Summary} ([Source]({URL}))
...

## :bulb: AI Ideas
1. **{Title}** - {Summary} ([Source]({URL}))
...

---
Sources checked: {count} | Items found: {count} | Last check: {timestamp}
```

### Step 7: Update State

Write new state:

```json
{
  "last_check": "{ISO_TIMESTAMP}",
  "items_seen": ["{urls_from_this_check}"],
  "last_items_count": {count}
}
```

## Error Handling

- If source fetch fails, log and continue with others
- If all sources fail, report error with last successful check time
- Rate limit awareness: space requests if hitting limits

## Deduplication

- Track URLs in `items_seen` to avoid showing same item twice
- Match by URL normalization (strip tracking params)
- Title similarity check for same story from multiple sources

---

*Execute this workflow when user asks for AI updates.*
