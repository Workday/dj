/**
 * Asserts the SyncEngine refreshes the manifest before generating output for
 * a root that the manifest doesn't know about yet (e.g. a model just added by
 * branch switch, scaffold, or file copy).
 *
 * When a sync targets a specific root that is missing from the manifest, the
 * engine must force one `parseManifest` and retry `buildOrderedResources`
 * before falling back to the temp-resource path. Without this, generation
 * runs against a stale manifest and downstream lookups (column inheritance,
 * dependency-driven defaults, etc.) silently produce wrong output.
 */

import { describe, expect, it, jest } from '@jest/globals';

// Minimal vscode mock — just enough surface area for SyncEngine.execute() to
// run with empty roots/jsonUris. The SyncEngine touches `vscode.Uri.file` and
// `vscode.workspace.fs.readFile` only when it actually has files to process,
// which our test deliberately avoids.
jest.mock(
  'vscode',
  () => ({
    Uri: {
      file: (p: string) => ({ fsPath: p, toString: () => p }),
    },
    workspace: {
      fs: {
        readFile: jest.fn(() => Promise.resolve(Buffer.from(''))),
      },
      findFiles: jest.fn(() => Promise.resolve([])),
    },
  }),
  { virtual: true },
);

import type { DbtProject, DbtProjectManifest } from '@shared/dbt/types';

import { CacheManager } from '../cacheManager';
import { SyncEngine } from '../SyncEngine';
import type { SyncConfig, SyncLogger } from '../types';

const PROJECT_NAME = 'testproj';

function makeManifest(
  overrides: Partial<DbtProjectManifest> = {},
): DbtProjectManifest {
  return {
    child_map: {},
    parent_map: {},
    nodes: {},
    sources: {},
    macros: {},
    groups: {},
    metrics: {},
    metadata: { generated_at: new Date().toISOString() },
    disabled: {},
    docs: {},
    exposures: {},
    group_map: {},
    saved_queries: {},
    selectors: {},
    semantic_models: {},
    ...overrides,
  } as DbtProjectManifest;
}

function makeProject(manifest: DbtProjectManifest): DbtProject {
  return {
    name: PROJECT_NAME,
    pathRelative: 'dbt',
    pathSystem: '/repo/dbt',
    targetPath: 'target',
    macroPaths: ['macros'],
    modelPaths: ['models'],
    properties: {},
    manifest,
  } as DbtProject;
}

function makeLogger(): SyncLogger {
  return {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };
}

function makeConfig(logger: SyncLogger): SyncConfig {
  return {
    extensionConfig: {
      logLevel: 'info',
      autoGenerateTests: { enabled: false },
    } as SyncConfig['extensionConfig'],
    logger,
    enableChangeDetection: false,
    parallelBatchSize: 1,
    enableValidation: false,
  };
}

describe('SyncEngine forced reparse when root is missing from manifest', () => {
  it('calls parseManifest exactly once when buildOrderedResources returns 0 for a root sync', async () => {
    const logger = makeLogger();
    const engine = new SyncEngine(makeConfig(logger));
    const project = makeProject(makeManifest());

    const fetchManifest = jest.fn(() => Promise.resolve(makeManifest()));
    // The reparse should be visible via this stub being called once.
    const parseManifest = jest.fn(() => Promise.resolve(makeManifest()));

    await engine.execute({
      project,
      jsonUris: [],
      cacheManager: new CacheManager(),
      // Root is intentionally NOT in the manifest. No pathJson on purpose so
      // the eventual createResourcesForNewRoots fallback is a no-op.
      roots: [{ id: `model.${PROJECT_NAME}.brand_new_model` }],
      // No file change recorded: shouldReparse returns isFresh=true via the
      // hasRoots branch, so the initial reparse does NOT fire. Only the new
      // forced reparse should.
      lastFileChange: null,
      forceReparse: false,
      parseManifest,
      fetchManifest,
    });

    expect(fetchManifest).toHaveBeenCalledTimes(1);
    expect(parseManifest).toHaveBeenCalledTimes(1);
  });

  it('does not force a reparse when the initial shouldReparse already triggered one', async () => {
    const logger = makeLogger();
    const engine = new SyncEngine(makeConfig(logger));
    const project = makeProject(makeManifest());

    const fetchManifest = jest.fn(() => Promise.resolve(makeManifest()));
    const parseManifest = jest.fn(() => Promise.resolve(makeManifest()));

    await engine.execute({
      project,
      jsonUris: [],
      cacheManager: new CacheManager(),
      roots: [{ id: `model.${PROJECT_NAME}.brand_new_model` }],
      lastFileChange: null,
      // forceReparse=true triggers the initial reparse, so our defense-in-depth
      // path must not run a second time.
      forceReparse: true,
      parseManifest,
      fetchManifest,
    });

    expect(parseManifest).toHaveBeenCalledTimes(1);
  });

  it('does not force a reparse when there are no roots (full sync path)', async () => {
    const logger = makeLogger();
    const engine = new SyncEngine(makeConfig(logger));
    const project = makeProject(makeManifest());

    const fetchManifest = jest.fn(() => Promise.resolve(makeManifest()));
    const parseManifest = jest.fn(() => Promise.resolve(makeManifest()));

    await engine.execute({
      project,
      jsonUris: [],
      cacheManager: new CacheManager(),
      // No roots → full sync. shouldReparse goes through the timestamp path
      // and we want to assert that our `roots-not-in-manifest` path stays out
      // of the way.
      roots: undefined,
      lastFileChange: null,
      forceReparse: false,
      parseManifest,
      fetchManifest,
    });

    // The defense-in-depth branch never fires for a full sync, regardless of
    // whether the initial shouldReparse path did or didn't run.
    expect(parseManifest.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('does not force a reparse when the root is already present in the manifest', async () => {
    const logger = makeLogger();
    const engine = new SyncEngine(makeConfig(logger));

    const modelId = `model.${PROJECT_NAME}.existing_model`;
    const manifest = makeManifest({
      nodes: {
        [modelId]: {
          resource_type: 'model',
          original_file_path: 'models/existing_model.sql',
          unique_id: modelId,
          name: 'existing_model',
        } as never,
      },
      child_map: { [modelId]: [] },
      parent_map: { [modelId]: [] },
    });
    const project = makeProject(manifest);

    const fetchManifest = jest.fn(() => Promise.resolve(manifest));
    const parseManifest = jest.fn(() => Promise.resolve(manifest));

    await engine.execute({
      project,
      jsonUris: [],
      cacheManager: new CacheManager(),
      roots: [{ id: modelId }],
      lastFileChange: null,
      forceReparse: false,
      parseManifest,
      fetchManifest,
    });

    // Root was already in the manifest, so buildOrderedResources returns >0
    // resources and the forced reparse must not trigger.
    expect(parseManifest).not.toHaveBeenCalled();
  });
});
