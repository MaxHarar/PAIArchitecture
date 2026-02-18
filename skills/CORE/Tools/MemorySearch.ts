#!/usr/bin/env bun
/**
 * MemorySearch.ts
 *
 * Hybrid semantic + keyword search for PAI Memory System.
 * Implements 70% vector similarity + 30% BM25 keyword matching
 * following the ClawdBot/Moltbot architecture patterns.
 *
 * Features:
 * - SQLite with sqlite-vec extension for vector search
 * - FTS5 for BM25 keyword scoring
 * - 400-token chunking with 80-token overlap
 * - Local embeddings using Transformers.js (all-MiniLM-L6-v2)
 * - Zero API cost - runs entirely locally
 *
 * Usage:
 *   bun run ~/.claude/skills/CORE/Tools/MemorySearch.ts search "query" [--limit N] [--output json|text]
 *   bun run ~/.claude/skills/CORE/Tools/MemorySearch.ts index <directory> [--patterns "*.md"]
 *   bun run ~/.claude/skills/CORE/Tools/MemorySearch.ts status
 *
 * @version 1.0.0
 * @author PAI System
 */

import { Database } from 'bun:sqlite';
import { createHash } from 'crypto';
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, extname, relative } from 'path';
import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';

// ============================================================================
// Types
// ============================================================================

export interface TextChunk {
  text: string;
  startLine: number;
  endLine: number;
  hash: string;
}

export interface ChunkOptions {
  chunkSize?: number;  // Target tokens per chunk (default: 400)
  overlap?: number;    // Overlap tokens (default: 80)
}

export interface SearchResult {
  id: number;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  vectorScore: number;
  bm25Score: number;
  hybridScore: number;
}

export interface SearchOptions {
  limit?: number;      // Max results (default: 10)
  minScore?: number;   // Minimum hybrid score threshold (default: 0.35)
}

export interface IndexStats {
  filesIndexed: number;
  filesSkipped: number;
  chunksCreated: number;
  totalTokens: number;
  errors: string[];
}

export interface IndexOptions {
  patterns?: string[];
  onProgress?: (current: number, total: number, file: string) => void;
}

export interface ScoreNormalizationOptions {
  maxBm25?: number;
}

export interface CombineScoreOptions {
  vectorWeight?: number;
  bm25Weight?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CHUNK_SIZE = 400;
const DEFAULT_OVERLAP = 80;
const DEFAULT_LIMIT = 10;
const DEFAULT_MIN_SCORE = 0.35;
const VECTOR_WEIGHT = 0.7;
const BM25_WEIGHT = 0.3;

// all-MiniLM-L6-v2 produces 384-dimensional vectors
const EMBEDDING_DIMENSIONS = 384;

// Default database location
const DEFAULT_DB_PATH = join(
  process.env.HOME || '~',
  '.claude/MEMORY/.memory-index/memory.db'
);

// ============================================================================
// Embedding Model (Singleton)
// ============================================================================

let embeddingPipeline: FeatureExtractionPipeline | null = null;

async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (!embeddingPipeline) {
    // Load the all-MiniLM-L6-v2 model (384 dimensions, ~22MB)
    // This runs entirely locally - no API calls
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { progress_callback: undefined } // Suppress download progress
    );
  }
  return embeddingPipeline;
}

// ============================================================================
// Token Counting
// ============================================================================

/**
 * Estimate token count for text.
 * Uses a simple approximation: ~4 characters per token on average.
 * This is faster than running through a full tokenizer.
 */
export function tokenCount(text: string): number {
  if (!text) return 0;

  // Simple heuristic: split on whitespace and punctuation
  // Average English word is ~5 chars, tokens are ~4 chars
  const words = text.split(/\s+/).filter(w => w.length > 0);
  let count = 0;

  for (const word of words) {
    // Each word is at least 1 token
    // Long words or code may be multiple tokens
    count += Math.ceil(word.length / 4);
  }

  return count;
}

// ============================================================================
// Chunking
// ============================================================================

/**
 * Chunk text into segments of approximately `chunkSize` tokens with `overlap` tokens overlap.
 * Tries to break at sentence/paragraph boundaries when possible.
 */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;

  if (!text || text.trim().length === 0) {
    return [];
  }

  const lines = text.split('\n');
  const chunks: TextChunk[] = [];

  let currentChunk: string[] = [];
  let currentTokens = 0;
  let chunkStartLine = 1;
  let currentLine = 1;

  for (const line of lines) {
    const lineTokens = tokenCount(line);

    // If adding this line exceeds chunk size, finalize current chunk
    if (currentTokens + lineTokens > chunkSize && currentChunk.length > 0) {
      const chunkText = currentChunk.join('\n');
      chunks.push({
        text: chunkText,
        startLine: chunkStartLine,
        endLine: currentLine - 1,
        hash: createHash('sha256').update(chunkText).digest('hex').slice(0, 16),
      });

      // Calculate overlap - keep last N tokens worth of lines
      let overlapTokens = 0;
      let overlapLines: string[] = [];
      for (let i = currentChunk.length - 1; i >= 0 && overlapTokens < overlap; i--) {
        overlapLines.unshift(currentChunk[i]);
        overlapTokens += tokenCount(currentChunk[i]);
      }

      currentChunk = overlapLines;
      currentTokens = overlapTokens;
      chunkStartLine = currentLine - overlapLines.length;
    }

    currentChunk.push(line);
    currentTokens += lineTokens;
    currentLine++;
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    const chunkText = currentChunk.join('\n');
    if (chunkText.trim().length > 0) {
      chunks.push({
        text: chunkText,
        startLine: chunkStartLine,
        endLine: currentLine - 1,
        hash: createHash('sha256').update(chunkText).digest('hex').slice(0, 16),
      });
    }
  }

  return chunks;
}

// ============================================================================
// Database
// ============================================================================

/**
 * Initialize the SQLite database with required schema.
 * Creates tables for files, chunks, FTS5 index, and vec0 vector index.
 */
export function initializeDatabase(dbPath: string = DEFAULT_DB_PATH): Database {
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.run('PRAGMA journal_mode = WAL');

  // Load sqlite-vec extension
  try {
    // The sqlite-vec npm package provides a load() function
    // We'll try to load it dynamically
    const sqliteVec = require('sqlite-vec');
    sqliteVec.load(db);
  } catch (e) {
    // If sqlite-vec isn't installed or can't load, we'll use a fallback
    // approach with a regular table and manual distance calculation
    console.warn('Warning: sqlite-vec extension not loaded. Using fallback vector storage.');
  }

  // Create files table - tracks indexed files
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      content_hash TEXT NOT NULL,
      mtime INTEGER,
      size INTEGER,
      indexed_at TEXT DEFAULT (datetime('now')),
      deleted INTEGER DEFAULT 0
    )
  `);

  // Create chunks table - stores text chunks with embeddings
  db.run(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      text TEXT NOT NULL,
      hash TEXT NOT NULL,
      embedding BLOB,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(path, hash)
    )
  `);

  // Create index on path for fast lookups
  db.run('CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path)');

  // Create FTS5 table for BM25 keyword search
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text,
      content='chunks',
      content_rowid='id'
    )
  `);

  // Create triggers to keep FTS5 in sync
  db.run(`
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
    END
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
    END
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
      INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
    END
  `);

  // Try to create vec0 virtual table for vector search
  // This will only work if sqlite-vec is properly loaded
  try {
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        embedding float[${EMBEDDING_DIMENSIONS}] distance_metric=cosine
      )
    `);
  } catch (e) {
    // vec0 not available - we'll use fallback approach
    // Create a regular table to store vectors as blobs
    db.run(`
      CREATE TABLE IF NOT EXISTS chunks_vec_fallback (
        chunk_id INTEGER PRIMARY KEY,
        embedding BLOB,
        FOREIGN KEY (chunk_id) REFERENCES chunks(id)
      )
    `);
  }

  return db;
}

// ============================================================================
// Embeddings
// ============================================================================

/**
 * Generate embedding vector for text using local Transformers.js model.
 * Returns a Float32Array of 384 dimensions.
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  if (!text || text.trim().length === 0) {
    return new Float32Array(EMBEDDING_DIMENSIONS);
  }

  const extractor = await getEmbeddingPipeline();

  // Generate embedding with mean pooling and normalization
  const output = await extractor(text, {
    pooling: 'mean',
    normalize: true,
  });

  // Convert to Float32Array
  return new Float32Array(output.data);
}

// ============================================================================
// Search Functions
// ============================================================================

/**
 * Perform vector similarity search using embeddings.
 * Returns results ordered by similarity (highest first).
 */
export async function vectorSearch(
  db: Database,
  query: string,
  limit: number = DEFAULT_LIMIT
): Promise<SearchResult[]> {
  const queryEmbedding = await generateEmbedding(query);

  // Try vec0 virtual table first
  try {
    const results = db.query(`
      SELECT
        c.id,
        c.path,
        c.start_line,
        c.end_line,
        c.text,
        v.distance as vector_distance
      FROM chunks_vec v
      JOIN chunks c ON c.id = v.chunk_id
      WHERE v.embedding MATCH ?
      AND k = ?
      ORDER BY v.distance ASC
    `).all(queryEmbedding.buffer, limit) as Array<{
      id: number;
      path: string;
      start_line: number;
      end_line: number;
      text: string;
      vector_distance: number;
    }>;

    return results.map(r => ({
      id: r.id,
      path: r.path,
      startLine: r.start_line,
      endLine: r.end_line,
      text: r.text,
      vectorScore: normalizeScore(r.vector_distance, 'vector'),
      bm25Score: 0,
      hybridScore: 0,
    }));
  } catch (e) {
    // Fallback: manual cosine similarity calculation
    const allChunks = db.query(`
      SELECT c.id, c.path, c.start_line, c.end_line, c.text, f.embedding
      FROM chunks c
      JOIN chunks_vec_fallback f ON f.chunk_id = c.id
    `).all() as Array<{
      id: number;
      path: string;
      start_line: number;
      end_line: number;
      text: string;
      embedding: Buffer;
    }>;

    const results = allChunks.map(chunk => {
      const chunkEmbedding = new Float32Array(chunk.embedding.buffer);
      const distance = cosineDistance(queryEmbedding, chunkEmbedding);

      return {
        id: chunk.id,
        path: chunk.path,
        startLine: chunk.start_line,
        endLine: chunk.end_line,
        text: chunk.text,
        vectorScore: normalizeScore(distance, 'vector'),
        bm25Score: 0,
        hybridScore: 0,
      };
    });

    // Sort by score descending and limit
    return results
      .sort((a, b) => b.vectorScore - a.vectorScore)
      .slice(0, limit);
  }
}

/**
 * Calculate cosine distance between two vectors.
 * Distance = 1 - cosine_similarity (range: 0 to 2)
 */
function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  return 1 - similarity; // Convert similarity to distance
}

/**
 * Perform BM25 keyword search using FTS5.
 * Returns results ordered by BM25 score (highest first).
 */
export function bm25Search(
  db: Database,
  query: string,
  limit: number = DEFAULT_LIMIT
): SearchResult[] {
  // Escape special FTS5 characters
  const escapedQuery = query
    .replace(/['"]/g, '')
    .split(/\s+/)
    .filter(term => term.length > 0)
    .map(term => `"${term}"`)
    .join(' OR ');

  if (!escapedQuery) {
    return [];
  }

  try {
    const results = db.query(`
      SELECT
        c.id,
        c.path,
        c.start_line,
        c.end_line,
        c.text,
        bm25(chunks_fts) as bm25_score
      FROM chunks_fts f
      JOIN chunks c ON c.id = f.rowid
      WHERE chunks_fts MATCH ?
      ORDER BY bm25_score
      LIMIT ?
    `).all(escapedQuery, limit) as Array<{
      id: number;
      path: string;
      start_line: number;
      end_line: number;
      text: string;
      bm25_score: number;
    }>;

    // Find max BM25 score for normalization
    const maxBm25 = results.length > 0
      ? Math.max(...results.map(r => Math.abs(r.bm25_score)))
      : 1;

    return results.map(r => ({
      id: r.id,
      path: r.path,
      startLine: r.start_line,
      endLine: r.end_line,
      text: r.text,
      vectorScore: 0,
      bm25Score: normalizeScore(Math.abs(r.bm25_score), 'bm25', { maxBm25 }),
      hybridScore: 0,
    }));
  } catch (e) {
    // FTS query failed - return empty
    return [];
  }
}

/**
 * Perform hybrid search combining vector similarity and BM25 keyword matching.
 * Uses 70% vector weight + 30% BM25 weight by default.
 */
export async function hybridSearch(
  db: Database,
  query: string,
  limit: number = DEFAULT_LIMIT,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;

  // Get results from both search methods
  // Fetch more than needed to allow for merging and filtering
  const fetchLimit = limit * 3;

  const [vectorResults, bm25Results] = await Promise.all([
    vectorSearch(db, query, fetchLimit),
    Promise.resolve(bm25Search(db, query, fetchLimit)),
  ]);

  // Merge results by chunk ID
  const resultMap = new Map<number, SearchResult>();

  // Add vector results
  for (const result of vectorResults) {
    resultMap.set(result.id, result);
  }

  // Merge BM25 results
  for (const bm25Result of bm25Results) {
    const existing = resultMap.get(bm25Result.id);
    if (existing) {
      existing.bm25Score = bm25Result.bm25Score;
    } else {
      resultMap.set(bm25Result.id, bm25Result);
    }
  }

  // Calculate hybrid scores
  const results = Array.from(resultMap.values()).map(result => ({
    ...result,
    hybridScore: combineScores(result.vectorScore, result.bm25Score),
  }));

  // Filter by minimum score and sort by hybrid score
  return results
    .filter(r => r.hybridScore >= minScore)
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, limit);
}

// ============================================================================
// Score Normalization
// ============================================================================

/**
 * Normalize a raw score to 0-1 range.
 * - Vector: cosine distance 0-2 -> similarity 1-0
 * - BM25: raw score -> normalized by max score
 */
export function normalizeScore(
  rawScore: number,
  type: 'vector' | 'bm25',
  options: ScoreNormalizationOptions = {}
): number {
  if (type === 'vector') {
    // Cosine distance: 0 = identical, 2 = opposite
    // Convert to similarity: 1 = identical, 0 = opposite
    return Math.max(0, Math.min(1, 1 - (rawScore / 2)));
  }

  if (type === 'bm25') {
    const maxBm25 = options.maxBm25 ?? 50;
    if (maxBm25 === 0) return 0;
    return Math.max(0, Math.min(1, rawScore / maxBm25));
  }

  return rawScore;
}

/**
 * Combine vector and BM25 scores with configurable weights.
 * Default: 70% vector + 30% BM25
 */
export function combineScores(
  vectorScore: number,
  bm25Score: number,
  options: CombineScoreOptions = {}
): number {
  const vectorWeight = options.vectorWeight ?? VECTOR_WEIGHT;
  const bm25Weight = options.bm25Weight ?? BM25_WEIGHT;

  return (vectorWeight * vectorScore) + (bm25Weight * bm25Score);
}

// ============================================================================
// Indexing
// ============================================================================

/**
 * Index a single file into the database.
 * Handles chunking, embedding generation, and storage.
 */
export async function indexFile(
  db: Database,
  filePath: string,
  options: { force?: boolean } = {}
): Promise<{ chunks: number; skipped: boolean }> {
  // Check if file exists
  if (!existsSync(filePath)) {
    // Mark as deleted if previously indexed
    db.run('UPDATE files SET deleted = 1 WHERE path = ?', [filePath]);
    return { chunks: 0, skipped: true };
  }

  const stats = statSync(filePath);
  const content = readFileSync(filePath, 'utf-8');
  const contentHash = createHash('sha256').update(content).digest('hex');

  // Check if file is already indexed with same content
  if (!options.force) {
    const existing = db.query(
      'SELECT content_hash FROM files WHERE path = ? AND deleted = 0'
    ).get(filePath) as { content_hash: string } | undefined;

    if (existing && existing.content_hash === contentHash) {
      return { chunks: 0, skipped: true };
    }
  }

  // Delete existing chunks for this file
  db.run('DELETE FROM chunks WHERE path = ?', [filePath]);

  // Try to delete from vec table (may not exist)
  try {
    db.run(`
      DELETE FROM chunks_vec WHERE chunk_id IN (
        SELECT id FROM chunks WHERE path = ?
      )
    `, [filePath]);
  } catch (e) {
    // Fallback table
    try {
      db.run(`
        DELETE FROM chunks_vec_fallback WHERE chunk_id IN (
          SELECT id FROM chunks WHERE path = ?
        )
      `, [filePath]);
    } catch (e2) {
      // Ignore
    }
  }

  // Chunk the content
  const chunks = chunkText(content);

  // Insert chunks and generate embeddings
  const insertChunk = db.prepare(`
    INSERT INTO chunks (path, start_line, end_line, text, hash, embedding)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let insertVec: ReturnType<Database['prepare']>;
  let usingFallback = false;

  try {
    insertVec = db.prepare(`
      INSERT INTO chunks_vec (chunk_id, embedding)
      VALUES (?, ?)
    `);
  } catch (e) {
    insertVec = db.prepare(`
      INSERT INTO chunks_vec_fallback (chunk_id, embedding)
      VALUES (?, ?)
    `);
    usingFallback = true;
  }

  for (const chunk of chunks) {
    // Generate embedding
    const embedding = await generateEmbedding(chunk.text);
    const embeddingBuffer = Buffer.from(embedding.buffer);

    // Insert chunk
    const result = insertChunk.run(
      filePath,
      chunk.startLine,
      chunk.endLine,
      chunk.text,
      chunk.hash,
      embeddingBuffer
    );

    // Insert into vector index
    const chunkId = result.lastInsertRowid;
    if (usingFallback) {
      insertVec.run(chunkId, embeddingBuffer);
    } else {
      insertVec.run(chunkId, embedding.buffer);
    }
  }

  // Update or insert file record
  db.run(`
    INSERT INTO files (path, content_hash, mtime, size, deleted)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(path) DO UPDATE SET
      content_hash = excluded.content_hash,
      mtime = excluded.mtime,
      size = excluded.size,
      indexed_at = datetime('now'),
      deleted = 0
  `, [filePath, contentHash, stats.mtimeMs, stats.size]);

  return { chunks: chunks.length, skipped: false };
}

/**
 * Index all matching files in a directory recursively.
 */
export async function indexDirectory(
  db: Database,
  dirPath: string,
  options: IndexOptions = {}
): Promise<IndexStats> {
  const patterns = options.patterns ?? ['*.md', '*.yaml', '*.json', '*.txt'];

  const stats: IndexStats = {
    filesIndexed: 0,
    filesSkipped: 0,
    chunksCreated: 0,
    totalTokens: 0,
    errors: [],
  };

  // Find all matching files
  const files = findFiles(dirPath, patterns);

  // Index each file
  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (options.onProgress) {
      options.onProgress(i + 1, files.length, file);
    }

    try {
      const result = await indexFile(db, file);

      if (result.skipped) {
        stats.filesSkipped++;
      } else {
        stats.filesIndexed++;
        stats.chunksCreated += result.chunks;
      }
    } catch (e) {
      stats.errors.push(`${file}: ${e}`);
    }
  }

  return stats;
}

/**
 * Find all files matching patterns in a directory.
 */
function findFiles(dir: string, patterns: string[]): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    const entries = readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories
        if (!entry.name.startsWith('.')) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        // Check if file matches any pattern
        const ext = extname(entry.name);
        const matches = patterns.some(pattern => {
          if (pattern.startsWith('*.')) {
            return ext === pattern.slice(1);
          }
          return entry.name === pattern;
        });

        if (matches) {
          files.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return files;
}

// ============================================================================
// CLI Interface
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const command = args[0];
  const dbPath = getArgValue(args, '--db') ?? DEFAULT_DB_PATH;
  const outputFormat = getArgValue(args, '--output') ?? 'text';

  const db = initializeDatabase(dbPath);

  try {
    switch (command) {
      case 'search': {
        const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
        const limit = parseInt(getArgValue(args, '--limit') ?? '10', 10);
        const minScore = parseFloat(getArgValue(args, '--min-score') ?? '0.35');

        if (!query) {
          console.error('Error: Search query required');
          process.exit(1);
        }

        const results = await hybridSearch(db, query, limit, { minScore });

        if (outputFormat === 'json') {
          console.log(JSON.stringify(results, null, 2));
        } else {
          printSearchResults(results);
        }
        break;
      }

      case 'index': {
        const targetPath = args[1];

        if (!targetPath) {
          console.error('Error: Directory or file path required');
          process.exit(1);
        }

        const patterns = getArgValue(args, '--patterns')?.split(',') ?? ['*.md'];

        if (outputFormat !== 'json') {
          console.log(`Indexing ${targetPath}...`);
        }

        const stats = await indexDirectory(db, targetPath, {
          patterns,
          onProgress: (current, total, file) => {
            if (outputFormat !== 'json') {
              process.stdout.write(`\r[${current}/${total}] ${relative(targetPath, file).slice(0, 50)}`);
            }
          },
        });

        if (outputFormat !== 'json') {
          console.log('\n');
        }

        if (outputFormat === 'json') {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log(`\nIndexing complete:`);
          console.log(`  Files indexed: ${stats.filesIndexed}`);
          console.log(`  Files skipped (unchanged): ${stats.filesSkipped}`);
          console.log(`  Chunks created: ${stats.chunksCreated}`);
          if (stats.errors.length > 0) {
            console.log(`  Errors: ${stats.errors.length}`);
            for (const error of stats.errors) {
              console.log(`    - ${error}`);
            }
          }
        }
        break;
      }

      case 'status': {
        const fileCount = db.query('SELECT COUNT(*) as count FROM files WHERE deleted = 0').get() as { count: number };
        const chunkCount = db.query('SELECT COUNT(*) as count FROM chunks').get() as { count: number };

        const status = {
          database: dbPath,
          files: fileCount.count,
          chunks: chunkCount.count,
          embeddingModel: 'Xenova/all-MiniLM-L6-v2',
          embeddingDimensions: EMBEDDING_DIMENSIONS,
          vectorWeight: VECTOR_WEIGHT,
          bm25Weight: BM25_WEIGHT,
        };

        if (outputFormat === 'json') {
          console.log(JSON.stringify(status, null, 2));
        } else {
          console.log('\nMemorySearch Status:');
          console.log(`  Database: ${status.database}`);
          console.log(`  Indexed files: ${status.files}`);
          console.log(`  Total chunks: ${status.chunks}`);
          console.log(`  Embedding model: ${status.embeddingModel}`);
          console.log(`  Vector dimensions: ${status.embeddingDimensions}`);
          console.log(`  Hybrid weights: ${status.vectorWeight * 100}% vector + ${status.bm25Weight * 100}% BM25`);
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } finally {
    db.close();
  }
}

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 && index < args.length - 1 ? args[index + 1] : undefined;
}

function printHelp() {
  console.log(`
MemorySearch - Hybrid semantic + keyword search for PAI Memory

Usage:
  bun run MemorySearch.ts <command> [options]

Commands:
  search <query>     Search indexed memories
  index <path>       Index files in directory
  status             Show index status

Options:
  --db <path>        Database path (default: ~/.claude/MEMORY/.memory-index/memory.db)
  --output <format>  Output format: json | text (default: text)
  --limit <n>        Max results for search (default: 10)
  --min-score <n>    Minimum hybrid score threshold (default: 0.35)
  --patterns <list>  File patterns for indexing, comma-separated (default: *.md)

Examples:
  bun run MemorySearch.ts search "distributed systems architecture"
  bun run MemorySearch.ts search "Kafka" --limit 5 --output json
  bun run MemorySearch.ts index ~/.claude/MEMORY/WORK
  bun run MemorySearch.ts index ~/.claude/skills --patterns "*.md,*.ts"
  bun run MemorySearch.ts status

Hybrid Search:
  Combines 70% vector similarity (semantic) + 30% BM25 (keyword) scoring.
  Vector search finds conceptually similar content.
  BM25 search finds exact term matches.
  Results are ranked by combined hybrid score.
`);
}

function printSearchResults(results: SearchResult[]) {
  if (results.length === 0) {
    console.log('\nNo results found.');
    return;
  }

  console.log(`\nFound ${results.length} results:\n`);

  for (const result of results) {
    console.log(`${'='.repeat(60)}`);
    console.log(`File: ${result.path}`);
    console.log(`Lines: ${result.startLine}-${result.endLine}`);
    console.log(`Score: ${result.hybridScore.toFixed(3)} (vector: ${result.vectorScore.toFixed(3)}, bm25: ${result.bm25Score.toFixed(3)})`);
    console.log(`${'─'.repeat(60)}`);
    console.log(result.text.slice(0, 500) + (result.text.length > 500 ? '...' : ''));
    console.log();
  }
}

// Run CLI if executed directly
if (import.meta.main) {
  main().catch(console.error);
}
