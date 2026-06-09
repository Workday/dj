import { describe, expect, jest, test } from '@jest/globals';
import type { DbtProjectManifest } from '@shared/dbt/types';

jest.mock(
  'vscode',
  () => ({
    workspace: { fs: {} },
    Uri: { file: (p: string) => ({ fsPath: p }) },
  }),
  { virtual: true },
);

import { ManifestManager } from '../ManifestManager';

function makeManifest(generatedAt?: string): DbtProjectManifest {
  return {
    metadata: { generated_at: generatedAt },
    nodes: {},
    sources: {},
    child_map: {},
    parent_map: {},
  } as unknown as DbtProjectManifest;
}

describe('ManifestManager.checkFreshness', () => {
  const manager = new ManifestManager();

  test('small targeted sync is always fresh', () => {
    const result = manager.checkFreshness({
      manifest: makeManifest(),
      lastFileChange: new Date(),
      hasRoots: true,
      rootCount: 3,
    });
    expect(result.isFresh).toBe(true);
  });

  test('bulk targeted sync falls through to timestamp check', () => {
    const now = Date.now();
    const recentChange = new Date(now - 1000); // 1s ago
    const oldManifest = makeManifest(new Date(now - 60_000).toISOString());

    const result = manager.checkFreshness({
      manifest: oldManifest,
      lastFileChange: recentChange,
      hasRoots: true,
      rootCount: ManifestManager.BULK_ROOT_THRESHOLD + 1,
    });
    expect(result.isFresh).toBe(false);
  });

  test('bulk targeted sync with fresh manifest is still fresh', () => {
    const now = Date.now();
    const oldChange = new Date(now - 60_000); // 60s ago
    const freshManifest = makeManifest(new Date(now - 10_000).toISOString());

    const result = manager.checkFreshness({
      manifest: freshManifest,
      lastFileChange: oldChange,
      hasRoots: true,
      rootCount: ManifestManager.BULK_ROOT_THRESHOLD + 1,
    });
    expect(result.isFresh).toBe(true);
  });

  test('no manifest is never fresh', () => {
    const result = manager.checkFreshness({
      manifest: null,
      lastFileChange: null,
      hasRoots: false,
    });
    expect(result.isFresh).toBe(false);
  });

  test('forceReparse overrides everything', () => {
    const result = manager.checkFreshness({
      manifest: makeManifest(new Date().toISOString()),
      lastFileChange: null,
      hasRoots: true,
      rootCount: 1,
      forceReparse: true,
    });
    expect(result.isFresh).toBe(false);
  });

  test('rootCount at exactly threshold is still treated as small sync', () => {
    const result = manager.checkFreshness({
      manifest: makeManifest(),
      lastFileChange: new Date(),
      hasRoots: true,
      rootCount: ManifestManager.BULK_ROOT_THRESHOLD,
    });
    expect(result.isFresh).toBe(true);
  });

  test('rootCount undefined with hasRoots true is treated as small sync', () => {
    const result = manager.checkFreshness({
      manifest: makeManifest(),
      lastFileChange: new Date(),
      hasRoots: true,
    });
    expect(result.isFresh).toBe(true);
  });
});
