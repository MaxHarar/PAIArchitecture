# Dynamic AI News System Architecture

**Version:** 1.0.0
**Status:** Design Complete
**Author:** PAI Architect Agent
**Date:** 2026-02-12

---

## 1. Executive Summary

Replace the static `FetchAINews.ts` with a dynamic news aggregation system that:
- Fetches fresh AI news daily from multiple sources
- Scores and ranks stories by importance
- Caches results to avoid redundant fetches
- Degrades gracefully when sources fail
- Integrates seamlessly with existing `briefing.ts`

---

## 2. Recommended News Sources and APIs

### 2.1 Primary Sources (Free, No API Key Required)

| Source | Type | Reliability | Update Freq | Implementation |
|--------|------|-------------|-------------|----------------|
| **Hacker News AI** | API | High | Real-time | `https://hn.algolia.com/api/v1/search_by_date?tags=story&query=AI+OR+LLM+OR+GPT+OR+Claude` |
| **Reddit r/MachineLearning** | RSS | High | Real-time | `https://www.reddit.com/r/MachineLearning/.rss` |
| **Reddit r/LocalLLaMA** | RSS | High | Real-time | `https://www.reddit.com/r/LocalLLaMA/.rss` |
| **Anthropic News** | RSS/Scrape | High | Weekly | `https://www.anthropic.com/news` |
| **OpenAI Blog** | RSS | High | Weekly | `https://openai.com/blog/rss.xml` |

### 2.2 Secondary Sources (API Key Optional, Free Tier)

| Source | Type | Free Tier | Rate Limit | API Key |
|--------|------|-----------|------------|---------|
| **NewsAPI.org** | API | 100/day | 1/sec | Optional |
| **The Verge AI** | RSS | Unlimited | None | None |
| **Ars Technica AI** | RSS | Unlimited | None | None |
| **TechCrunch AI** | RSS | Unlimited | None | None |

### 2.3 Source Priority Order

```
Priority 1 (Always fetch):
  - Hacker News AI (API, highest engagement signals)
  - Anthropic News (Primary vendor relevance)

Priority 2 (Fetch if Priority 1 < 5 stories):
  - Reddit r/MachineLearning (community signal)
  - OpenAI Blog (competitor news)

Priority 3 (Fallback):
  - TechCrunch AI RSS
  - Ars Technica AI RSS
  - Cached stories from previous day
```

---

## 3. Scoring/Ranking Algorithm

### 3.1 Composite Score Formula

```typescript
interface StoryScore {
  recencyScore: number;      // 0-30 points (time decay)
  sourceAuthority: number;   // 0-25 points (source reputation)
  engagementScore: number;   // 0-25 points (upvotes, comments)
  topicRelevance: number;    // 0-20 points (keyword matching)
  total: number;             // 0-100 points
}

function calculateScore(story: RawStory): number {
  return (
    calculateRecency(story.publishedAt) +
    getSourceAuthority(story.source) +
    calculateEngagement(story.upvotes, story.comments) +
    calculateRelevance(story.title, story.content)
  );
}
```

### 3.2 Recency Score (0-30 points)

```typescript
function calculateRecency(publishedAt: Date): number {
  const hoursAgo = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60);

  if (hoursAgo < 6) return 30;       // Very fresh
  if (hoursAgo < 12) return 25;      // Same morning
  if (hoursAgo < 24) return 20;      // Last 24h
  if (hoursAgo < 48) return 10;      // 2 days
  return 5;                           // Older
}
```

### 3.3 Source Authority (0-25 points)

```typescript
const SOURCE_AUTHORITY: Record<string, number> = {
  // Tier 1: Official announcements (25 pts)
  'anthropic.com': 25,
  'openai.com': 25,
  'deepmind.google': 25,
  'ai.meta.com': 25,

  // Tier 2: Quality journalism (20 pts)
  'techcrunch.com': 20,
  'theverge.com': 20,
  'arstechnica.com': 20,
  'wired.com': 20,

  // Tier 3: Community platforms (15 pts)
  'news.ycombinator.com': 15,
  'reddit.com': 15,

  // Tier 4: Aggregators (10 pts)
  'venturebeat.com': 10,
  'default': 10,
};
```

### 3.4 Engagement Score (0-25 points)

```typescript
function calculateEngagement(upvotes: number, comments: number): number {
  // Hacker News / Reddit engagement signals
  const engagementSignal = upvotes + (comments * 2);  // Comments weighted 2x

  if (engagementSignal > 500) return 25;
  if (engagementSignal > 200) return 20;
  if (engagementSignal > 100) return 15;
  if (engagementSignal > 50) return 10;
  if (engagementSignal > 20) return 5;
  return 2;  // Minimum for having any engagement
}
```

### 3.5 Topic Relevance (0-20 points)

```typescript
const HIGH_RELEVANCE_KEYWORDS = [
  'claude', 'anthropic', 'gpt-5', 'gemini', 'llama',
  'benchmark', 'safety', 'alignment', 'breakthrough',
  'release', 'launch', 'announce', 'open source'
];

const MEDIUM_RELEVANCE_KEYWORDS = [
  'ai', 'llm', 'model', 'training', 'inference',
  'transformer', 'agent', 'reasoning', 'multimodal'
];

function calculateRelevance(title: string, content: string): number {
  const text = (title + ' ' + content).toLowerCase();

  let score = 0;

  // High relevance keywords: +4 each (max 12)
  for (const kw of HIGH_RELEVANCE_KEYWORDS) {
    if (text.includes(kw)) score += 4;
    if (score >= 12) break;
  }

  // Medium relevance: +2 each (max 8)
  for (const kw of MEDIUM_RELEVANCE_KEYWORDS) {
    if (text.includes(kw)) score += 2;
    if (score >= 20) break;
  }

  return Math.min(score, 20);
}
```

### 3.6 Deduplication

```typescript
function deduplicateStories(stories: ScoredStory[]): ScoredStory[] {
  const seen = new Set<string>();

  return stories.filter(story => {
    // Normalize title for comparison
    const normalized = story.title
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 50);

    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
```

---

## 4. Caching Strategy

### 4.1 Cache Architecture

```
~/.claude/skills/DailyBriefing/Cache/
  ai-news/
    current.json       # Today's fetched stories (top 5)
    raw-{date}.json    # Raw fetched stories (all sources)
    history/
      2026-02-11.json  # Previous day's cache (fallback)
      2026-02-10.json  # Older cache (cleanup after 7 days)
```

### 4.2 Cache Schema

```typescript
interface NewsCache {
  fetchedAt: string;           // ISO timestamp
  fetchDate: string;           // YYYY-MM-DD
  expiresAt: string;           // ISO timestamp (fetchedAt + 12h)
  sources: {
    [sourceName: string]: {
      success: boolean;
      fetchedAt: string;
      storyCount: number;
      error?: string;
    };
  };
  stories: NewsStory[];        // Top 5, scored and ranked
  rawStoryCount: number;       // Total before filtering
}
```

### 4.3 Cache TTL Strategy

| Scenario | TTL | Behavior |
|----------|-----|----------|
| Fresh fetch (morning) | 12 hours | Primary cache |
| Briefing regeneration | Read cache | No re-fetch if < 12h old |
| Source failure | 24 hours | Fall back to yesterday's cache |
| All sources fail | 48 hours | Fall back to oldest valid cache |

### 4.4 Cache Decision Flow

```
START
  |
  v
[Check current.json exists?]
  |
  Yes                          No
  |                            |
  v                            v
[Is it from today?]        [FETCH_NEW]
  |                            |
  Yes            No            |
  |              |             |
  v              v             v
[Is it < 12h?]  [FETCH_NEW]  [FETCH_NEW]
  |
  Yes
  |
  v
[USE_CACHE]
```

### 4.5 Cache Cleanup

```typescript
// Run daily after briefing success
async function cleanupOldCaches(): Promise<void> {
  const historyDir = `${CACHE_DIR}/history`;
  const files = await readdir(historyDir);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);  // Keep 7 days

  for (const file of files) {
    const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})\.json/);
    if (dateMatch && new Date(dateMatch[1]) < cutoff) {
      await unlink(`${historyDir}/${file}`);
    }
  }
}
```

---

## 5. Error Handling Approach

### 5.1 Error Categories

| Category | Examples | Handling |
|----------|----------|----------|
| **Network** | Timeout, DNS failure | Retry 1x, then fallback |
| **Rate Limit** | 429 Too Many Requests | Skip source, log, fallback |
| **Parse Error** | Invalid JSON, bad RSS | Log, skip source, continue |
| **Auth Error** | 401/403 | Log, skip source, continue |
| **Partial Data** | < 5 stories from all sources | Pad with cached stories |
| **Total Failure** | All sources fail | Return cached stories |

### 5.2 Retry Strategy

```typescript
async function fetchWithRetry<T>(
  fetcher: () => Promise<T>,
  options: { retries: number; delayMs: number }
): Promise<T | null> {
  for (let i = 0; i < options.retries; i++) {
    try {
      return await fetcher();
    } catch (error) {
      if (i < options.retries - 1) {
        await sleep(options.delayMs * (i + 1));  // Exponential backoff
      }
    }
  }
  return null;
}
```

### 5.3 Graceful Degradation Levels

```
Level 0: All sources succeeded
  → Return fresh stories (ideal)

Level 1: Some sources failed
  → Return mix of fresh + fallback from failed sources

Level 2: All primary sources failed
  → Return yesterday's cached stories
  → Log warning

Level 3: Cache unavailable
  → Return hardcoded fallback stories (current FetchAINews.ts content)
  → Log error
  → Notify via stderr (visible in daemon logs)
```

### 5.4 Fallback Story Structure

```typescript
const FALLBACK_STORIES: NewsStory[] = [
  {
    title: "AI News Service Temporarily Unavailable",
    summary: "Fresh AI news could not be fetched. Check sources manually.",
    url: "https://news.ycombinator.com/news?q=AI",
    source: "System"
  },
  // ... keep 2-3 hardcoded relevant stories as absolute fallback
];
```

### 5.5 Logging and Observability

```typescript
interface FetchAttempt {
  timestamp: string;
  source: string;
  success: boolean;
  duration_ms: number;
  story_count?: number;
  error?: string;
  error_code?: string;
}

// Log to: ~/.claude/skills/DailyBriefing/State/news-fetch.log
```

---

## 6. Implementation Plan

### 6.1 File Structure

```
~/.claude/skills/DailyBriefing/
  Tools/
    FetchAINews.ts              # REPLACE (new implementation)
    news/
      fetchers/
        HackerNewsFetcher.ts    # HN Algolia API
        RedditFetcher.ts        # Reddit RSS parser
        RSSFetcher.ts           # Generic RSS fetcher
        AnthropicNewsFetcher.ts # Anthropic news scraper
      scoring/
        ScoreCalculator.ts      # Scoring algorithm
        Deduplicator.ts         # Title deduplication
      cache/
        CacheManager.ts         # Cache read/write/cleanup
        CacheTypes.ts           # TypeScript types
      types.ts                  # Shared types
      config.ts                 # Source configuration
      index.ts                  # Main entry point
  Cache/
    ai-news/
      current.json              # Today's cache
      history/                  # Historical caches
  State/
    news-fetch.log              # Fetch attempt logs
```

### 6.2 Phase 1: Core Infrastructure (Day 1)

| Task | File | Description |
|------|------|-------------|
| 1.1 | `news/types.ts` | Define RawStory, ScoredStory, NewsCache interfaces |
| 1.2 | `news/config.ts` | Source definitions, keywords, authority scores |
| 1.3 | `news/cache/CacheManager.ts` | Read, write, cleanup, TTL checking |
| 1.4 | `news/scoring/ScoreCalculator.ts` | Implement scoring algorithm |

### 6.3 Phase 2: Fetchers (Day 2)

| Task | File | Description |
|------|------|-------------|
| 2.1 | `news/fetchers/HackerNewsFetcher.ts` | HN Algolia API integration |
| 2.2 | `news/fetchers/RSSFetcher.ts` | Generic RSS parser (Reddit, blogs) |
| 2.3 | `news/fetchers/AnthropicNewsFetcher.ts` | Anthropic news page scraper |
| 2.4 | Tests | Unit tests for each fetcher |

### 6.4 Phase 3: Integration (Day 3)

| Task | File | Description |
|------|------|-------------|
| 3.1 | `news/index.ts` | Main orchestrator with fallback logic |
| 3.2 | `FetchAINews.ts` | Replace with new implementation |
| 3.3 | Integration test | End-to-end test with briefing.ts |
| 3.4 | Daemon test | Test with wake-triggered briefing |

### 6.5 Phase 4: Hardening (Day 4)

| Task | File | Description |
|------|------|-------------|
| 4.1 | Error logging | Implement news-fetch.log |
| 4.2 | Cache cleanup | Implement 7-day retention |
| 4.3 | Monitoring | Add stderr alerts for total failures |
| 4.4 | Documentation | Update SKILL.md with news system docs |

---

## 7. Integration with briefing.ts

### 7.1 Current Integration Point (lines 292-311)

```typescript
// Current implementation
function getAINews(): NewsItem[] {
  try {
    const newsScript = `${homedir()}/.claude/skills/DailyBriefing/Tools/FetchAINews.ts`;
    const result = execSync(`bun ${newsScript}`, {
      encoding: 'utf-8',
      timeout: 45000
    });
    return JSON.parse(result);
  } catch (error) {
    // Fallback
    return [{ title: 'AI news temporarily unavailable', ... }];
  }
}
```

### 7.2 New Integration (No Changes to briefing.ts)

The new `FetchAINews.ts` maintains the same interface:
- Takes no arguments
- Returns `NewsStory[]` via stdout (JSON)
- Handles all caching internally
- Returns fallback on failure

**Key:** briefing.ts does NOT need modification. The new FetchAINews.ts is a drop-in replacement.

### 7.3 Enhanced Timeout

Consider increasing timeout from 45s to 60s to allow for multi-source fetching:

```typescript
// Optional enhancement in briefing.ts
const result = execSync(`bun ${newsScript}`, {
  encoding: 'utf-8',
  timeout: 60000  // 60s for multi-source fetch
});
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

| Test Suite | Coverage |
|------------|----------|
| `ScoreCalculator.test.ts` | Recency, authority, engagement, relevance |
| `CacheManager.test.ts` | Read, write, TTL, cleanup |
| `HackerNewsFetcher.test.ts` | API parsing, error handling |
| `RSSFetcher.test.ts` | RSS parsing, various formats |
| `Deduplicator.test.ts` | Title normalization, dedup |

### 8.2 Integration Tests

| Test | Description |
|------|-------------|
| Fresh fetch | All sources succeed |
| Partial failure | Some sources fail, fallback works |
| Total failure | All sources fail, cache used |
| Cache expired | Forces new fetch |
| Rate limit simulation | Handles 429 gracefully |

### 8.3 End-to-End Test

```bash
# Test the new system
bun run ~/.claude/skills/DailyBriefing/Tools/FetchAINews.ts

# Test with briefing
bun run ~/.claude/skills/DailyBriefing/Tools/briefing.ts --test
```

---

## 9. Cost Analysis

### 9.1 API Costs

| Source | Cost | Daily Calls | Monthly Cost |
|--------|------|-------------|--------------|
| Hacker News Algolia | Free | 1-2 | $0 |
| Reddit RSS | Free | 2-3 | $0 |
| OpenAI Blog RSS | Free | 1 | $0 |
| NewsAPI (optional) | Free tier | 1 | $0 |

**Total Monthly Cost: $0** (using only free sources)

### 9.2 Resource Usage

| Resource | Usage |
|----------|-------|
| Network | ~500KB/day (RSS + API responses) |
| Disk (cache) | ~50KB/day, 350KB/week retained |
| CPU | < 1s fetch time |
| Memory | < 50MB during fetch |

---

## 10. Future Enhancements

### 10.1 Short-term (Optional)

- [ ] Add NewsAPI.org as secondary source
- [ ] Implement ML-based relevance scoring
- [ ] Add user preference learning (click tracking)

### 10.2 Long-term (Nice to Have)

- [ ] Personalized topic filtering
- [ ] Sentiment analysis of stories
- [ ] Trend detection across days
- [ ] Integration with Research skill for deep dives

---

## 11. Decision Log

| Decision | Rationale |
|----------|-----------|
| Use Hacker News Algolia API | Free, real-time, high engagement signals |
| No paid APIs required | Daily use must be sustainable |
| 12-hour cache TTL | Balance freshness vs. redundant fetches |
| Scoring algorithm with 4 factors | Comprehensive ranking without over-engineering |
| Maintain same interface | Drop-in replacement, no briefing.ts changes |
| 7-day cache retention | Sufficient fallback without disk bloat |

---

## Appendix A: Source URLs

```typescript
const SOURCES = {
  hackerNews: {
    api: 'https://hn.algolia.com/api/v1/search_by_date',
    params: { tags: 'story', query: 'AI OR LLM OR GPT OR Claude OR Anthropic' }
  },
  reddit: {
    machineLearning: 'https://www.reddit.com/r/MachineLearning/.rss',
    localLLaMA: 'https://www.reddit.com/r/LocalLLaMA/.rss'
  },
  rss: {
    openai: 'https://openai.com/blog/rss.xml',
    techcrunch: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    verge: 'https://www.theverge.com/ai-artificial-intelligence/rss/index.xml'
  },
  scrape: {
    anthropic: 'https://www.anthropic.com/news'
  }
};
```

---

## Appendix B: NewsStory Interface (Unchanged)

```typescript
// Maintains backward compatibility with existing system
interface NewsStory {
  title: string;
  summary: string;
  url: string;
  source: string;
}
```

---

*Architecture Version: 1.0.0*
*Last Updated: 2026-02-12*
*Author: PAI Architect Agent*
