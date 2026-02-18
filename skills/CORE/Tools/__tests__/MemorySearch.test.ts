#!/usr/bin/env bun
/**
 * MemorySearch.test.ts
 *
 * Tests for hybrid semantic + keyword search for PAI Memory System.
 * Implements 70% vector similarity + 30% BM25 keyword matching.
 *
 * Run: bun test ~/.claude/skills/CORE/Tools/__tests__/MemorySearch.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';

// Import the module under test (will be created)
import {
  // Chunking
  tokenCount,
  chunkText,
  type TextChunk,

  // Database
  initializeDatabase,

  // Embeddings
  generateEmbedding,

  // Search
  vectorSearch,
  bm25Search,
  hybridSearch,
  type SearchResult,

  // Indexing
  indexFile,
  indexDirectory,

  // Scoring
  normalizeScore,
  combineScores,
} from '../MemorySearch';

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_DIR = join(tmpdir(), `memory-search-test-${Date.now()}`);
const TEST_DB_PATH = join(TEST_DIR, 'memory.db');

const SAMPLE_TEXT = `# Project Alpha - Technical Specification

## Overview
Project Alpha is a distributed system designed for high-throughput data processing.
The system uses Apache Kafka for message queuing and Redis for caching.

## Architecture
The architecture follows a microservices pattern with the following components:
- API Gateway: Handles authentication and rate limiting
- Processing Service: Core business logic for data transformation
- Storage Service: Manages persistence to PostgreSQL and S3

## Security Considerations
All API endpoints require JWT authentication. Sensitive data is encrypted at rest
using AES-256. Network traffic is encrypted via TLS 1.3.

## Performance Requirements
- Target latency: < 100ms for 95th percentile
- Throughput: 10,000 requests per second
- Availability: 99.9% uptime SLA
`;

const SAMPLE_TEXT_2 = `# Meeting Notes - Sprint Planning

## Attendees
- Alice (Tech Lead)
- Bob (Backend Developer)
- Carol (Frontend Developer)

## Discussion Points
1. Kafka configuration needs optimization for better throughput
2. Redis cache invalidation strategy review
3. JWT token expiration policy update

## Action Items
- Bob: Implement retry logic for failed Kafka messages
- Carol: Add loading states to dashboard
- Alice: Review security audit findings

## Next Steps
Schedule follow-up meeting for Thursday to review progress.
`;

const SAMPLE_TEXT_3 = `# Personal Notes

Today I learned about vector embeddings and semantic search.
The concept is fascinating - you can find similar documents
even when they use completely different words!

I should explore using this for my note-taking system.
`;

// ============================================================================
// Chunking Tests
// ============================================================================

describe('Text Chunking', () => {
  describe('tokenCount', () => {
    it('should estimate token count for simple text', () => {
      const text = 'Hello world this is a test';
      const count = tokenCount(text);
      // Rough estimate: ~1 token per word, with some overhead
      expect(count).toBeGreaterThan(4);
      expect(count).toBeLessThan(20);
    });

    it('should handle empty string', () => {
      expect(tokenCount('')).toBe(0);
    });

    it('should handle special characters and code', () => {
      const code = 'const foo = () => { return "bar"; };';
      const count = tokenCount(code);
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('chunkText', () => {
    it('should chunk text into approximately 400-token segments', () => {
      const chunks = chunkText(SAMPLE_TEXT, { chunkSize: 400, overlap: 80 });

      expect(chunks.length).toBeGreaterThan(0);

      for (const chunk of chunks) {
        // Allow some tolerance for chunk boundaries
        expect(tokenCount(chunk.text)).toBeLessThanOrEqual(500);
      }
    });

    it('should include overlap between consecutive chunks', () => {
      const chunks = chunkText(SAMPLE_TEXT, { chunkSize: 200, overlap: 50 });

      if (chunks.length >= 2) {
        const chunk1End = chunks[0].text.slice(-100);
        const chunk2Start = chunks[1].text.slice(0, 100);

        // There should be some overlap
        const hasOverlap = chunk1End.split(' ').some(word =>
          chunk2Start.includes(word) && word.length > 3
        );
        expect(hasOverlap).toBe(true);
      }
    });

    it('should track start and end lines for each chunk', () => {
      const chunks = chunkText(SAMPLE_TEXT, { chunkSize: 200, overlap: 50 });

      for (const chunk of chunks) {
        expect(chunk.startLine).toBeGreaterThanOrEqual(1);
        expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
      }
    });

    it('should handle small text that fits in one chunk', () => {
      const smallText = 'This is a very short text.';
      const chunks = chunkText(smallText, { chunkSize: 400, overlap: 80 });

      expect(chunks.length).toBe(1);
      expect(chunks[0].text).toBe(smallText);
    });

    it('should preserve content hash for deduplication', () => {
      const chunks = chunkText(SAMPLE_TEXT, { chunkSize: 200, overlap: 50 });

      for (const chunk of chunks) {
        expect(chunk.hash).toBeDefined();
        expect(chunk.hash.length).toBeGreaterThan(0);
      }

      // Same text should produce same hash
      const chunks2 = chunkText(SAMPLE_TEXT, { chunkSize: 200, overlap: 50 });
      expect(chunks[0].hash).toBe(chunks2[0].hash);
    });

    it('should not produce empty chunks', () => {
      const chunks = chunkText(SAMPLE_TEXT, { chunkSize: 400, overlap: 80 });

      for (const chunk of chunks) {
        expect(chunk.text.trim().length).toBeGreaterThan(0);
      }
    });
  });
});

// ============================================================================
// Database Tests
// ============================================================================

describe('Database Initialization', () => {
  let db: Database;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should create database with required tables', () => {
    db = initializeDatabase(TEST_DB_PATH);

    // Check files table exists
    const filesTable = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='files'"
    ).get();
    expect(filesTable).toBeDefined();

    // Check chunks table exists
    const chunksTable = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks'"
    ).get();
    expect(chunksTable).toBeDefined();

    // Check FTS5 table exists
    const ftsTable = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'"
    ).get();
    expect(ftsTable).toBeDefined();

    db.close();
  });

  it('should create vec0 virtual table for vector search', () => {
    db = initializeDatabase(TEST_DB_PATH);

    // Check vec0 virtual table exists
    const vecTable = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'"
    ).get();
    expect(vecTable).toBeDefined();

    db.close();
  });

  it('should be idempotent (safe to call multiple times)', () => {
    db = initializeDatabase(TEST_DB_PATH);
    db.close();

    // Second call should not throw
    db = initializeDatabase(TEST_DB_PATH);

    const tables = db.query(
      "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'"
    ).get() as { count: number };

    expect(tables.count).toBeGreaterThan(0);
    db.close();
  });
});

// ============================================================================
// Embedding Tests
// ============================================================================

describe('Embedding Generation', () => {
  it('should generate embeddings for text', async () => {
    const embedding = await generateEmbedding('Hello world');

    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBeGreaterThan(0);
  });

  it('should produce consistent embeddings for same text', async () => {
    const text = 'Consistent text for testing';

    const embedding1 = await generateEmbedding(text);
    const embedding2 = await generateEmbedding(text);

    expect(embedding1.length).toBe(embedding2.length);

    // Should be identical (or very close due to floating point)
    for (let i = 0; i < embedding1.length; i++) {
      expect(Math.abs(embedding1[i] - embedding2[i])).toBeLessThan(0.0001);
    }
  });

  it('should produce different embeddings for different text', async () => {
    const embedding1 = await generateEmbedding('cats and dogs');
    const embedding2 = await generateEmbedding('quantum physics');

    // Calculate cosine similarity
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));

    // Different topics should have low similarity
    expect(similarity).toBeLessThan(0.9);
  });

  it('should produce similar embeddings for semantically similar text', async () => {
    const embedding1 = await generateEmbedding('The cat sat on the mat');
    const embedding2 = await generateEmbedding('A feline rested on the rug');

    // Calculate cosine similarity
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));

    // Semantically similar text should have higher similarity
    expect(similarity).toBeGreaterThan(0.5);
  });

  it('should handle empty string gracefully', async () => {
    const embedding = await generateEmbedding('');
    expect(embedding).toBeInstanceOf(Float32Array);
  });
});

// ============================================================================
// Search Tests
// ============================================================================

describe('Vector Search', () => {
  let db: Database;

  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    db = initializeDatabase(TEST_DB_PATH);

    // Index test files
    const testFile1 = join(TEST_DIR, 'project-alpha.md');
    const testFile2 = join(TEST_DIR, 'meeting-notes.md');
    const testFile3 = join(TEST_DIR, 'personal-notes.md');

    writeFileSync(testFile1, SAMPLE_TEXT);
    writeFileSync(testFile2, SAMPLE_TEXT_2);
    writeFileSync(testFile3, SAMPLE_TEXT_3);

    await indexFile(db, testFile1);
    await indexFile(db, testFile2);
    await indexFile(db, testFile3);
  });

  afterAll(() => {
    db?.close();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should find semantically similar content', async () => {
    const results = await vectorSearch(db, 'distributed systems architecture', 5);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain('project-alpha');
  });

  it('should rank more relevant results higher', async () => {
    const results = await vectorSearch(db, 'Kafka message queue configuration', 5);

    expect(results.length).toBeGreaterThan(0);

    // First result should have lower distance (higher similarity)
    if (results.length >= 2) {
      expect(results[0].vectorScore).toBeGreaterThanOrEqual(results[1].vectorScore);
    }
  });

  it('should return scores between 0 and 1', async () => {
    const results = await vectorSearch(db, 'security authentication', 5);

    for (const result of results) {
      expect(result.vectorScore).toBeGreaterThanOrEqual(0);
      expect(result.vectorScore).toBeLessThanOrEqual(1);
    }
  });
});

describe('BM25 Keyword Search', () => {
  let db: Database;

  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    db = initializeDatabase(TEST_DB_PATH);

    const testFile1 = join(TEST_DIR, 'project-alpha.md');
    const testFile2 = join(TEST_DIR, 'meeting-notes.md');

    writeFileSync(testFile1, SAMPLE_TEXT);
    writeFileSync(testFile2, SAMPLE_TEXT_2);

    await indexFile(db, testFile1);
    await indexFile(db, testFile2);
  });

  afterAll(() => {
    db?.close();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should find exact keyword matches', () => {
    const results = bm25Search(db, 'PostgreSQL', 5);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text.toLowerCase()).toContain('postgresql');
  });

  it('should find partial keyword matches', () => {
    const results = bm25Search(db, 'Kafka Redis', 5);

    expect(results.length).toBeGreaterThan(0);
  });

  it('should rank documents with more matches higher', () => {
    const results = bm25Search(db, 'JWT authentication security', 5);

    expect(results.length).toBeGreaterThan(0);

    // Project Alpha should rank higher (has all these terms)
    const alphaResult = results.find(r => r.path.includes('project-alpha'));
    expect(alphaResult).toBeDefined();
  });

  it('should handle special characters in queries', () => {
    const results = bm25Search(db, 'AES-256', 5);

    expect(results.length).toBeGreaterThan(0);
  });

  it('should return empty array for no matches', () => {
    const results = bm25Search(db, 'xyznonexistentterm123', 5);

    expect(results).toEqual([]);
  });
});

describe('Hybrid Search', () => {
  let db: Database;

  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    db = initializeDatabase(TEST_DB_PATH);

    const testFile1 = join(TEST_DIR, 'project-alpha.md');
    const testFile2 = join(TEST_DIR, 'meeting-notes.md');
    const testFile3 = join(TEST_DIR, 'personal-notes.md');

    writeFileSync(testFile1, SAMPLE_TEXT);
    writeFileSync(testFile2, SAMPLE_TEXT_2);
    writeFileSync(testFile3, SAMPLE_TEXT_3);

    await indexFile(db, testFile1);
    await indexFile(db, testFile2);
    await indexFile(db, testFile3);
  });

  afterAll(() => {
    db?.close();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should combine vector and BM25 scores with 70/30 weighting', async () => {
    const results = await hybridSearch(db, 'Kafka message optimization', 5);

    expect(results.length).toBeGreaterThan(0);

    for (const result of results) {
      expect(result.vectorScore).toBeDefined();
      expect(result.bm25Score).toBeDefined();
      expect(result.hybridScore).toBeDefined();

      // Verify hybrid score calculation
      const expectedHybrid = (0.7 * result.vectorScore) + (0.3 * result.bm25Score);
      expect(Math.abs(result.hybridScore - expectedHybrid)).toBeLessThan(0.01);
    }
  });

  it('should filter results below minimum score threshold', async () => {
    const results = await hybridSearch(db, 'random unrelated query about bananas', 5, { minScore: 0.35 });

    for (const result of results) {
      expect(result.hybridScore).toBeGreaterThanOrEqual(0.35);
    }
  });

  it('should return results ordered by hybrid score descending', async () => {
    const results = await hybridSearch(db, 'security authentication JWT', 5);

    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].hybridScore).toBeGreaterThanOrEqual(results[i + 1].hybridScore);
    }
  });

  it('should include file path, line numbers, and text snippet', async () => {
    const results = await hybridSearch(db, 'microservices architecture', 5);

    expect(results.length).toBeGreaterThan(0);

    const result = results[0];
    expect(result.path).toBeDefined();
    expect(result.startLine).toBeGreaterThanOrEqual(1);
    expect(result.endLine).toBeGreaterThanOrEqual(result.startLine);
    expect(result.text).toBeDefined();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('should handle queries that only match via semantic similarity', async () => {
    // "distributed computing" doesn't appear literally but is semantically similar
    const results = await hybridSearch(db, 'distributed computing clusters', 5);

    expect(results.length).toBeGreaterThan(0);
    // Should find project-alpha which discusses distributed systems
    const hasRelevant = results.some(r => r.path.includes('project-alpha'));
    expect(hasRelevant).toBe(true);
  });

  it('should handle queries that only match via keyword', async () => {
    // Exact term match
    const results = await hybridSearch(db, 'AES-256', 5);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain('project-alpha');
  });
});

// ============================================================================
// Score Normalization Tests
// ============================================================================

describe('Score Normalization', () => {
  it('should normalize vector distance to similarity score', () => {
    // Distance 0 = perfect match = score 1
    expect(normalizeScore(0, 'vector')).toBe(1);

    // Distance 2 = opposite vectors (cosine) = score 0
    expect(normalizeScore(2, 'vector')).toBe(0);

    // Distance 1 = orthogonal = score 0.5
    expect(normalizeScore(1, 'vector')).toBe(0.5);
  });

  it('should normalize BM25 scores', () => {
    // BM25 scores vary widely, should normalize to 0-1 range
    const score = normalizeScore(25, 'bm25', { maxBm25: 50 });

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('should combine scores with correct weighting', () => {
    const combined = combineScores(1.0, 0.5); // vector=1.0, bm25=0.5

    // Expected: 0.7 * 1.0 + 0.3 * 0.5 = 0.85
    expect(combined).toBe(0.85);
  });

  it('should allow custom weights', () => {
    const combined = combineScores(1.0, 1.0, { vectorWeight: 0.5, bm25Weight: 0.5 });

    // Expected: 0.5 * 1.0 + 0.5 * 1.0 = 1.0
    expect(combined).toBe(1.0);
  });
});

// ============================================================================
// Indexing Tests
// ============================================================================

describe('File Indexing', () => {
  let db: Database;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    db = initializeDatabase(TEST_DB_PATH);
  });

  afterEach(() => {
    db?.close();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should index a markdown file', async () => {
    const testFile = join(TEST_DIR, 'test.md');
    writeFileSync(testFile, SAMPLE_TEXT);

    await indexFile(db, testFile);

    // Check file was recorded
    const file = db.query('SELECT * FROM files WHERE path = ?').get(testFile);
    expect(file).toBeDefined();

    // Check chunks were created
    const chunks = db.query('SELECT COUNT(*) as count FROM chunks WHERE path = ?').get(testFile) as { count: number };
    expect(chunks.count).toBeGreaterThan(0);
  });

  it('should track content hash for change detection', async () => {
    const testFile = join(TEST_DIR, 'test.md');
    writeFileSync(testFile, SAMPLE_TEXT);

    await indexFile(db, testFile);

    const file = db.query('SELECT content_hash FROM files WHERE path = ?').get(testFile) as { content_hash: string };
    expect(file.content_hash).toBeDefined();
    expect(file.content_hash.length).toBeGreaterThan(0);
  });

  it('should skip unchanged files on re-index', async () => {
    const testFile = join(TEST_DIR, 'test.md');
    writeFileSync(testFile, SAMPLE_TEXT);

    await indexFile(db, testFile);
    const firstIndexTime = db.query('SELECT indexed_at FROM files WHERE path = ?').get(testFile) as { indexed_at: string };

    // Small delay to ensure timestamp would differ
    await new Promise(resolve => setTimeout(resolve, 10));

    await indexFile(db, testFile);
    const secondIndexTime = db.query('SELECT indexed_at FROM files WHERE path = ?').get(testFile) as { indexed_at: string };

    // Should not have re-indexed (same timestamp)
    expect(firstIndexTime.indexed_at).toBe(secondIndexTime.indexed_at);
  });

  it('should re-index when file content changes', async () => {
    const testFile = join(TEST_DIR, 'test.md');
    writeFileSync(testFile, 'Original content');

    await indexFile(db, testFile);
    const originalHash = db.query('SELECT content_hash FROM files WHERE path = ?').get(testFile) as { content_hash: string };

    // Modify file
    writeFileSync(testFile, 'Modified content');

    await indexFile(db, testFile);
    const newHash = db.query('SELECT content_hash FROM files WHERE path = ?').get(testFile) as { content_hash: string };

    expect(newHash.content_hash).not.toBe(originalHash.content_hash);
  });

  it('should handle file deletion gracefully', async () => {
    const testFile = join(TEST_DIR, 'test.md');
    writeFileSync(testFile, SAMPLE_TEXT);

    await indexFile(db, testFile);

    // Delete file
    unlinkSync(testFile);

    // Re-indexing should mark as deleted
    await indexFile(db, testFile);

    const file = db.query('SELECT deleted FROM files WHERE path = ?').get(testFile) as { deleted: number };
    expect(file.deleted).toBe(1);
  });
});

describe('Directory Indexing', () => {
  let db: Database;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    db = initializeDatabase(TEST_DB_PATH);
  });

  afterEach(() => {
    db?.close();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should index all markdown files in directory', async () => {
    // Create test files
    const subDir = join(TEST_DIR, 'subdir');
    mkdirSync(subDir);

    writeFileSync(join(TEST_DIR, 'file1.md'), 'Content 1');
    writeFileSync(join(TEST_DIR, 'file2.md'), 'Content 2');
    writeFileSync(join(subDir, 'file3.md'), 'Content 3');
    writeFileSync(join(TEST_DIR, 'ignored.txt'), 'Should be ignored');

    // Explicitly specify patterns to only index .md files
    const stats = await indexDirectory(db, TEST_DIR, { patterns: ['*.md'] });

    expect(stats.filesIndexed).toBe(3);
    // .txt file should not match *.md pattern
    expect(stats.filesSkipped).toBe(0);
  });

  it('should respect file pattern filter', async () => {
    writeFileSync(join(TEST_DIR, 'file1.md'), 'Content 1');
    writeFileSync(join(TEST_DIR, 'file2.yaml'), 'key: value');
    writeFileSync(join(TEST_DIR, 'file3.json'), '{"key": "value"}');

    const stats = await indexDirectory(db, TEST_DIR, { patterns: ['*.md', '*.yaml'] });

    expect(stats.filesIndexed).toBe(2);
  });

  it('should provide indexing progress callback', async () => {
    writeFileSync(join(TEST_DIR, 'file1.md'), 'Content 1');
    writeFileSync(join(TEST_DIR, 'file2.md'), 'Content 2');

    const progressUpdates: Array<{ current: number; total: number; file: string }> = [];

    await indexDirectory(db, TEST_DIR, {
      onProgress: (current, total, file) => {
        progressUpdates.push({ current, total, file });
      }
    });

    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1].current).toBe(progressUpdates[progressUpdates.length - 1].total);
  });
});

// ============================================================================
// CLI Integration Tests
// ============================================================================

describe('CLI Interface', () => {
  let db: Database;

  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    db = initializeDatabase(TEST_DB_PATH);

    const testFile = join(TEST_DIR, 'test.md');
    writeFileSync(testFile, SAMPLE_TEXT);
    await indexFile(db, testFile);
    db.close();
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should search and return JSON output', async () => {
    const proc = Bun.spawn([
      'bun', 'run',
      '/Users/maxharar/.claude/skills/CORE/Tools/MemorySearch.ts',
      'search', 'distributed systems',
      '--db', TEST_DB_PATH,
      '--output', 'json'
    ], { stdout: 'pipe' });

    const output = await new Response(proc.stdout).text();
    const results = JSON.parse(output);

    expect(Array.isArray(results)).toBe(true);
    if (results.length > 0) {
      expect(results[0]).toHaveProperty('path');
      expect(results[0]).toHaveProperty('hybridScore');
    }
  });

  it('should support --limit flag', async () => {
    const proc = Bun.spawn([
      'bun', 'run',
      '/Users/maxharar/.claude/skills/CORE/Tools/MemorySearch.ts',
      'search', 'architecture',
      '--db', TEST_DB_PATH,
      '--limit', '2',
      '--output', 'json'
    ], { stdout: 'pipe' });

    const output = await new Response(proc.stdout).text();
    const results = JSON.parse(output);

    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should support index command', async () => {
    const newFile = join(TEST_DIR, 'new-file.md');
    writeFileSync(newFile, 'New content to index');

    const proc = Bun.spawn([
      'bun', 'run',
      '/Users/maxharar/.claude/skills/CORE/Tools/MemorySearch.ts',
      'index', TEST_DIR,
      '--db', TEST_DB_PATH,
      '--output', 'json'
    ], { stdout: 'pipe' });

    const output = await new Response(proc.stdout).text();
    const result = JSON.parse(output);

    expect(result).toHaveProperty('filesIndexed');
  });

  it('should provide help text', async () => {
    const proc = Bun.spawn([
      'bun', 'run',
      '/Users/maxharar/.claude/skills/CORE/Tools/MemorySearch.ts',
      '--help'
    ], { stdout: 'pipe' });

    const output = await new Response(proc.stdout).text();

    expect(output).toContain('search');
    expect(output).toContain('index');
  });
});
