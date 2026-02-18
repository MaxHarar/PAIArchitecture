#!/usr/bin/env bun
/**
 * ============================================================================
 * FETCH AI NEWS - Dynamic Daily AI News Fetching System
 * ============================================================================
 *
 * PURPOSE:
 * Fetches, scores, deduplicates, and summarizes AI news from multiple sources
 * for the Daily Briefing Bot.
 *
 * SOURCES:
 * 1. Hacker News Algolia API (primary) - Real-time tech news
 * 2. Reddit /r/MachineLearning JSON API (secondary) - ML research community
 *
 * SCORING ALGORITHM:
 * - Recency: Exponential decay (24h=1.0, 48h=0.5, 72h=0.25, 96h+=0)
 * - Authority: HN front page=1.0, Reddit upvoted=0.8
 * - Engagement: Normalized points/comments (0-1 scale)
 * - Relevance: Keyword matching ("GPT", "Claude", "Anthropic", "LLM", etc.)
 * - Final = (recency * 0.3) + (authority * 0.2) + (engagement * 0.3) + (relevance * 0.2)
 *
 * CACHING:
 * - Location: ~/.claude/dailybrief/ai-news-cache.json
 * - TTL: 12 hours (fresh overnight news for morning briefing)
 * - 4-level degradation: fresh -> cached -> stale -> "unavailable"
 *
 * USAGE:
 *   bun run Tools/FetchAINews.ts              # Standalone test
 *   bun run Tools/briefing.ts --test          # In briefing context
 *
 * ============================================================================
 */

import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { inference } from "/Users/maxharar/.claude/skills/CORE/Tools/Inference.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface NewsStory {
  title: string;
  summary: string;
  url: string;
  source: string;
  score?: number;
  publishedAt?: string;
  points?: number;
  comments?: number;
}

interface RawStory {
  title: string;
  url: string;
  source: "hackernews" | "reddit";
  publishedAt: Date;
  points: number;
  comments: number;
  authorityScore: number;
}

interface ScoredStory extends RawStory {
  recencyScore: number;
  engagementScore: number;
  relevanceScore: number;
  finalScore: number;
}

interface CacheData {
  cachedAt: string;
  stories: NewsStory[];
}

interface HNHit {
  title: string;
  url: string | null;
  objectID: string;
  created_at: string;
  points: number;
  num_comments: number;
}

interface HNResponse {
  hits: HNHit[];
}

interface RedditPost {
  data: {
    title: string;
    url: string;
    id: string;
    created_utc: number;
    score: number;
    num_comments: number;
    is_self: boolean;
    selftext?: string;
    permalink: string;
    stickied: boolean;
  };
}

interface RedditResponse {
  data: {
    children: RedditPost[];
  };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CACHE_DIR = join(homedir(), ".claude", "dailybrief");
const CACHE_FILE = join(CACHE_DIR, "ai-news-cache.json");
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const STALE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours - use stale cache as fallback

const HN_API_URL = "https://hn.algolia.com/api/v1/search_by_date";
// Note: Algolia uses space-separated terms (implicit OR), not explicit "OR" syntax
const HN_QUERY = "AI LLM Claude GPT Anthropic OpenAI";
const HN_HITS_PER_PAGE = 50;

const REDDIT_API_URL = "https://www.reddit.com/r/MachineLearning/hot.json";
const REDDIT_LIMIT = 50;

const USER_AGENT = "Mozilla/5.0 (compatible; DailyBriefingBot/1.0)";
const FETCH_TIMEOUT_MS = 30000;

const TOP_STORIES_COUNT = 5;

// Keywords for relevance scoring (normalized to lowercase for matching)
const RELEVANCE_KEYWORDS = [
  "gpt", "claude", "anthropic", "llm", "transformer", "openai", "gemini",
  "llama", "mistral", "ai safety", "alignment", "neural", "deep learning",
  "machine learning", "foundation model", "language model", "chatbot",
  "reasoning", "chain of thought", "rag", "fine-tuning", "rlhf",
  "multimodal", "vision language", "embedding", "vector database"
];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate string similarity using Jaccard index on words
 */
function calculateSimilarity(str1: string, str2: string): number {
  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 2);

  const words1 = new Set(normalize(str1));
  const words2 = new Set(normalize(str2));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Calculate recency score with exponential decay
 * 24h=1.0, 48h=0.5, 72h=0.25, 96h+=0
 */
function calculateRecencyScore(publishedAt: Date): number {
  const now = Date.now();
  const ageMs = now - publishedAt.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours <= 24) return 1.0;
  if (ageHours <= 48) return 0.5;
  if (ageHours <= 72) return 0.25;
  return 0;
}

/**
 * Calculate engagement score from points/comments
 * Normalize to 0-1 scale using logarithmic scaling
 */
function calculateEngagementScore(points: number, comments: number): number {
  // Log scale to handle viral outliers
  // HN: 100 points is good, 1000 is exceptional
  // Reddit: Similar scaling
  const pointsScore = Math.min(1, Math.log10(Math.max(1, points)) / 3);
  const commentsScore = Math.min(1, Math.log10(Math.max(1, comments)) / 2.5);

  return (pointsScore * 0.6) + (commentsScore * 0.4);
}

/**
 * Calculate relevance score based on keyword matching
 */
function calculateRelevanceScore(title: string): number {
  const titleLower = title.toLowerCase();
  let matchCount = 0;

  for (const keyword of RELEVANCE_KEYWORDS) {
    if (titleLower.includes(keyword)) {
      matchCount++;
    }
  }

  // Diminishing returns for multiple matches
  return Math.min(1, matchCount * 0.25);
}

/**
 * Calculate final score using weighted formula
 */
function calculateFinalScore(story: RawStory): ScoredStory {
  const recencyScore = calculateRecencyScore(story.publishedAt);
  const engagementScore = calculateEngagementScore(story.points, story.comments);
  const relevanceScore = calculateRelevanceScore(story.title);

  const finalScore =
    (recencyScore * 0.3) +
    (story.authorityScore * 0.2) +
    (engagementScore * 0.3) +
    (relevanceScore * 0.2);

  return {
    ...story,
    recencyScore,
    engagementScore,
    relevanceScore,
    finalScore
  };
}

// ============================================================================
// FETCHING FUNCTIONS
// ============================================================================

/**
 * Fetch stories from Hacker News Algolia API
 */
async function fetchHackerNews(): Promise<RawStory[]> {
  const stories: RawStory[] = [];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const url = `${HN_API_URL}?tags=story&query=${encodeURIComponent(HN_QUERY)}&hitsPerPage=${HN_HITS_PER_PAGE}`;

    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`HN API error: ${response.status} ${response.statusText}`);
      return stories;
    }

    const data = await response.json() as HNResponse;

    for (const hit of data.hits) {
      // Skip stories without URLs (Show HN text posts, etc.)
      const storyUrl = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;

      stories.push({
        title: hit.title,
        url: storyUrl,
        source: "hackernews",
        publishedAt: new Date(hit.created_at),
        points: hit.points || 0,
        comments: hit.num_comments || 0,
        authorityScore: 1.0 // HN is primary source
      });
    }

    console.log(`[HN] Fetched ${stories.length} stories`);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error("[HN] Request timed out");
    } else {
      console.error("[HN] Fetch error:", error);
    }
  }

  return stories;
}

/**
 * Fetch stories from Reddit /r/MachineLearning JSON API
 */
async function fetchReddit(): Promise<RawStory[]> {
  const stories: RawStory[] = [];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const url = `${REDDIT_API_URL}?limit=${REDDIT_LIMIT}`;

    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`Reddit API error: ${response.status} ${response.statusText}`);
      return stories;
    }

    const data = await response.json() as RedditResponse;

    for (const post of data.data.children) {
      const postData = post.data;

      // Skip stickied posts (usually meta/weekly threads)
      if (postData.stickied) continue;

      // Use permalink for self posts, url for links
      const storyUrl = postData.is_self
        ? `https://www.reddit.com${postData.permalink}`
        : postData.url;

      stories.push({
        title: postData.title,
        url: storyUrl,
        source: "reddit",
        publishedAt: new Date(postData.created_utc * 1000),
        points: postData.score || 0,
        comments: postData.num_comments || 0,
        authorityScore: 0.8 // Reddit is secondary source
      });
    }

    console.log(`[Reddit] Fetched ${stories.length} stories`);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error("[Reddit] Request timed out");
    } else {
      console.error("[Reddit] Fetch error:", error);
    }
  }

  return stories;
}

// ============================================================================
// DEDUPLICATION
// ============================================================================

/**
 * Deduplicate stories across sources
 * Keep highest-scored version when similarity > 80%
 */
function deduplicateStories(stories: ScoredStory[]): ScoredStory[] {
  const deduplicated: ScoredStory[] = [];
  const seen = new Set<number>();

  // Sort by score descending first
  const sorted = [...stories].sort((a, b) => b.finalScore - a.finalScore);

  for (let i = 0; i < sorted.length; i++) {
    if (seen.has(i)) continue;

    const story = sorted[i];
    deduplicated.push(story);

    // Mark similar stories as seen
    for (let j = i + 1; j < sorted.length; j++) {
      if (seen.has(j)) continue;

      const otherStory = sorted[j];
      const similarity = calculateSimilarity(story.title, otherStory.title);

      if (similarity > 0.8) {
        seen.add(j);
        console.log(`[Dedup] Removed duplicate: "${otherStory.title.substring(0, 50)}..."`);
      }
    }
  }

  return deduplicated;
}

// ============================================================================
// AI SUMMARIZATION
// ============================================================================

/**
 * Check if we're running inside a Claude session (can't use Inference in nested context)
 */
function isNestedClaudeSession(): boolean {
  return !!process.env.CLAUDECODE;
}

/**
 * Generate AI summary for a story using Inference.ts
 * Falls back to title-based summary if Inference unavailable (e.g., nested Claude session)
 */
async function summarizeStory(story: ScoredStory): Promise<string> {
  // Skip AI summarization if running inside Claude (can't nest Claude sessions)
  if (isNestedClaudeSession()) {
    return generateFallbackSummary(story);
  }

  const systemPrompt = `You are a technical AI news summarizer. Create a 1-2 sentence summary focused on what's new and why it matters. Be concise and factual. Do not use phrases like "this article discusses" - just state the key information.`;

  const userPrompt = `Summarize this AI news story title for a morning briefing:

Title: ${story.title}
Source: ${story.source === "hackernews" ? "Hacker News" : "Reddit r/MachineLearning"}
Points: ${story.points}
Comments: ${story.comments}

Provide a brief, informative summary (1-2 sentences).`;

  try {
    const result = await inference({
      systemPrompt,
      userPrompt,
      level: "fast", // Use Haiku for speed/cost
      timeout: 15000
    });

    if (result.success && result.output) {
      const summary = result.output.trim();
      // Validate that we got a real summary (not just the title echoed back)
      if (summary.length > 20 && summary !== story.title) {
        return summary;
      }
    }

    // Fallback if inference returns empty or just the title
    return generateFallbackSummary(story);
  } catch (error) {
    console.error(`[Summary] Error summarizing story: ${error}`);
    return generateFallbackSummary(story);
  }
}

/**
 * Generate a basic summary from story metadata when AI summarization unavailable
 */
function generateFallbackSummary(story: ScoredStory): string {
  const sourceName = story.source === "hackernews" ? "Hacker News" : "Reddit ML";
  const engagementInfo = story.points > 50
    ? `Trending with ${story.points} points.`
    : story.comments > 10
      ? `Active discussion with ${story.comments} comments.`
      : "";

  // Clean up Reddit-style prefixes like [D], [R], [P]
  const cleanTitle = story.title.replace(/^\[[A-Z]\]\s*/, "");

  return engagementInfo ? `${cleanTitle} ${engagementInfo}` : cleanTitle;
}

/**
 * Summarize top stories (cost control - only top 5)
 */
async function summarizeTopStories(stories: ScoredStory[]): Promise<NewsStory[]> {
  const topStories = stories.slice(0, TOP_STORIES_COUNT);
  const summarized: NewsStory[] = [];

  console.log(`[Summary] Generating summaries for ${topStories.length} stories...`);

  for (const story of topStories) {
    const summary = await summarizeStory(story);

    summarized.push({
      title: story.title,
      summary,
      url: story.url,
      source: story.source === "hackernews" ? "Hacker News" : "Reddit",
      score: Math.round(story.finalScore * 100) / 100,
      publishedAt: story.publishedAt.toISOString(),
      points: story.points,
      comments: story.comments
    });
  }

  return summarized;
}

// ============================================================================
// CACHING
// ============================================================================

/**
 * Ensure cache directory exists
 */
function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Read cache from disk
 */
function readCache(): CacheData | null {
  try {
    if (!existsSync(CACHE_FILE)) {
      return null;
    }

    const data = readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(data) as CacheData;
  } catch (error) {
    console.error("[Cache] Error reading cache:", error);
    return null;
  }
}

/**
 * Write cache to disk
 */
function writeCache(stories: NewsStory[]): void {
  try {
    ensureCacheDir();

    const cacheData: CacheData = {
      cachedAt: new Date().toISOString(),
      stories
    };

    writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
    console.log(`[Cache] Wrote ${stories.length} stories to cache`);
  } catch (error) {
    console.error("[Cache] Error writing cache:", error);
  }
}

/**
 * Check cache freshness
 * Returns: "fresh" | "stale" | "expired" | "missing"
 */
function checkCacheFreshness(): "fresh" | "stale" | "expired" | "missing" {
  const cache = readCache();

  if (!cache) {
    return "missing";
  }

  const cacheAge = Date.now() - new Date(cache.cachedAt).getTime();

  if (cacheAge < CACHE_TTL_MS) {
    return "fresh";
  }

  if (cacheAge < STALE_TTL_MS) {
    return "stale";
  }

  return "expired";
}

// ============================================================================
// MAIN FETCH FUNCTION
// ============================================================================

/**
 * Fetch AI news with 4-level degradation:
 * 1. Fresh cache (< 12h) - return immediately
 * 2. Fetch fresh data - score, dedupe, summarize, cache
 * 3. Stale cache (< 48h) - return if fetch fails
 * 4. Unavailable - return error state
 */
export async function fetchAINews(): Promise<NewsStory[]> {
  console.log("[FetchAINews] Starting AI news fetch...");

  // Check cache freshness
  const freshness = checkCacheFreshness();
  console.log(`[Cache] Freshness: ${freshness}`);

  // Level 1: Fresh cache
  if (freshness === "fresh") {
    const cache = readCache();
    if (cache && cache.stories.length > 0) {
      console.log(`[Cache] Returning ${cache.stories.length} fresh cached stories`);
      return cache.stories;
    }
  }

  // Level 2: Fetch fresh data
  try {
    console.log("[Fetch] Fetching from sources...");

    // Fetch from both sources in parallel
    const [hnStories, redditStories] = await Promise.all([
      fetchHackerNews(),
      fetchReddit()
    ]);

    const allStories = [...hnStories, ...redditStories];
    console.log(`[Fetch] Total raw stories: ${allStories.length}`);

    if (allStories.length === 0) {
      throw new Error("No stories fetched from any source");
    }

    // Score all stories
    const scoredStories = allStories.map(calculateFinalScore);

    // Filter out zero-recency stories (> 96h old)
    const recentStories = scoredStories.filter(s => s.recencyScore > 0);
    console.log(`[Filter] Recent stories (< 96h): ${recentStories.length}`);

    // Sort by score and deduplicate
    const sortedStories = recentStories.sort((a, b) => b.finalScore - a.finalScore);
    const dedupedStories = deduplicateStories(sortedStories);
    console.log(`[Dedup] After deduplication: ${dedupedStories.length}`);

    // Summarize top stories
    const summarizedStories = await summarizeTopStories(dedupedStories);

    // Cache the results
    writeCache(summarizedStories);

    return summarizedStories;
  } catch (error) {
    console.error("[Fetch] Error fetching fresh data:", error);

    // Level 3: Stale cache fallback
    if (freshness === "stale") {
      const cache = readCache();
      if (cache && cache.stories.length > 0) {
        console.log(`[Cache] Returning ${cache.stories.length} stale cached stories (fallback)`);
        return cache.stories;
      }
    }

    // Level 4: Unavailable
    console.error("[FetchAINews] All sources unavailable, no cache available");
    return [{
      title: "AI News Currently Unavailable",
      summary: "Unable to fetch AI news from any source. Please check your network connection.",
      url: "https://news.ycombinator.com",
      source: "System"
    }];
  }
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

if (import.meta.main) {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose") || args.includes("-v");

  // Suppress console logs when called from briefing.ts (expects JSON only)
  // Enable verbose mode for debugging
  const originalLog = console.log;
  const originalError = console.error;

  if (!verbose) {
    // Suppress all logs when running in JSON mode (default)
    console.log = () => {};
    console.error = () => {};
  }

  const stories = await fetchAINews();

  // Restore console for output
  console.log = originalLog;
  console.error = originalError;

  if (verbose) {
    // Verbose mode: human-readable output
    console.log("=".repeat(70));
    console.log("FETCH AI NEWS - Dynamic Daily AI News System");
    console.log("=".repeat(70));
    console.log();

    for (let i = 0; i < stories.length; i++) {
      const story = stories[i];
      console.log(`${i + 1}. ${story.title}`);
      console.log(`   Source: ${story.source} | Score: ${story.score ?? "N/A"}`);
      console.log(`   URL: ${story.url}`);
      console.log(`   Summary: ${story.summary}`);
      console.log();
    }

    console.log("=".repeat(70));
    console.log(`Total: ${stories.length} stories`);
    console.log("=".repeat(70));
  } else {
    // Default: JSON output for briefing.ts integration
    console.log(JSON.stringify(stories, null, 2));
  }
}

export type { NewsStory };
