/**
 * Cache Manager Module
 *
 * This module handles content hashing and caching for change detection.
 * It allows the sync engine to skip regenerating files that haven't changed,
 * significantly improving performance for large projects.
 */

import * as crypto from 'crypto';

import type { ContentHashEntry } from './types';

/**
 * Cache key for a model: its raw text, plus the fingerprint of the fragments
 * and templates it uses so editing a shared file invalidates its dependents.
 */
export function modelCacheKey(
  jsonContent: string,
  fingerprint?: string,
): string {
  return fingerprint ? `${jsonContent}\u0000${fingerprint}` : jsonContent;
}

/**
 * CacheManager handles content hashing and caching for change detection.
 *
 * It stores MD5 hashes of JSON, SQL, and YML files to detect changes
 * and skip regenerating files that haven't changed, significantly
 * improving performance for large projects.
 *
 * @example
 * ```typescript
 * const cache = new CacheManager();
 *
 * // Check if content changed before regenerating
 * if (cache.hasJsonChanged(pathJson, jsonContent)) {
 *   const { sql, yml } = generateOutput(jsonContent);
 *   cache.update(pathJson, jsonContent, sql, yml);
 * }
 * ```
 */
export class CacheManager {
  /** Internal cache storage: path -> hash entry */
  private cache: Map<string, ContentHashEntry> = new Map();

  /**
   * Computes an MD5 hash of the given content.
   * MD5 is used for speed; collision resistance is not critical here.
   *
   * @param content - String content to hash
   * @returns Hex-encoded MD5 hash
   */
  private computeHash(content: string): string {
    return crypto.createHash('md5').update(content, 'utf8').digest('hex');
  }

  /**
   * Checks if a JSON file's content has changed (without generated output).
   * Useful for early exit before generation.
   *
   * @param pathJson - Path to the JSON file
   * @param jsonContent - Current JSON file content
   * @returns true if JSON content has changed, false if unchanged
   */
  hasJsonChanged(pathJson: string, jsonContent: string): boolean {
    const currentHash = this.computeHash(jsonContent);
    const cached = this.cache.get(pathJson);

    return cached?.jsonHash !== currentHash;
  }

  /**
   * Updates the cache with new content hashes for a model.
   *
   * @param pathJson - Path to the .model.json file
   * @param jsonContent - Current JSON file content
   * @param sqlContent - Current generated SQL content
   * @param ymlContent - Current generated YML content
   */
  update(
    pathJson: string,
    jsonContent: string,
    sqlContent: string,
    ymlContent: string,
  ): void {
    this.cache.set(pathJson, {
      jsonHash: this.computeHash(jsonContent),
      sqlHash: this.computeHash(sqlContent),
      ymlHash: this.computeHash(ymlContent),
      timestamp: Date.now(),
    });
  }

  /**
   * Updates the cache for a source file (only JSON and YML, no SQL).
   *
   * @param pathJson - Path to the .source.json file
   * @param jsonContent - Current JSON file content
   * @param ymlContent - Current generated YML content
   */
  updateSource(
    pathJson: string,
    jsonContent: string,
    ymlContent: string,
  ): void {
    this.cache.set(pathJson, {
      jsonHash: this.computeHash(jsonContent),
      sqlHash: '', // Sources don't have SQL
      ymlHash: this.computeHash(ymlContent),
      timestamp: Date.now(),
    });
  }

  /**
   * Invalidates the cache entry for a specific JSON file.
   * Safe to call even if the entry doesn't exist.
   *
   * @param pathJson - Path to the .model.json or .source.json file
   */
  invalidate(pathJson: string): void {
    this.cache.delete(pathJson);
  }

  /**
   * Clears the entire cache.
   * Useful for debugging or when forcing a full regeneration.
   */
  clear(): void {
    this.cache.clear();
  }
}
