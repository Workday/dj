import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  createSchemaAjv,
  findDbtProjectDirs,
  loadDbtProject,
  previewModel,
  resetSchemaAjvCache,
} from '../index';

describe('loadDbtProject', () => {
  test('loads project from docs example when present', () => {
    const exampleRoot = path.join(__dirname, '../../../../../docs/examples');
    const dirs = findDbtProjectDirs(exampleRoot);
    expect(dirs.length).toBeGreaterThan(0);
    const project = loadDbtProject(dirs[0], { workspaceRoot: exampleRoot });
    expect(project.name).toBeTruthy();
    expect(project.pathSystem).toBe(dirs[0]);
    expect(project.modelPaths.length).toBeGreaterThan(0);
  });

  test('throws when dbt_project.yml is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-headless-'));
    expect(() => loadDbtProject(tmp)).toThrow(/dbt_project\.yml not found/);
  });
});

describe('createSchemaAjv', () => {
  test('registers model and source validators', () => {
    resetSchemaAjvCache();
    const { ajv, sourceValidator } = createSchemaAjv();
    expect(ajv.getSchema('model.schema.json')).toBeTruthy();
    expect(sourceValidator).toBeTruthy();
  });
});

describe('previewModel', () => {
  test('generates sql and yml from fixture model', () => {
    const fixtureDir = path.join(__dirname, '../../../../../tests/fixtures');
    const modelPath = path.join(
      fixtureDir,
      'stg__customers__profiles__clean.model.json',
    );
    const manifestPath = path.join(fixtureDir, 'manifest.json');
    const modelJson = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    const project = {
      name: manifest.metadata.project_name,
      macroPaths: ['macros'],
      manifest,
      modelPaths: ['models'],
      packagePath: 'dbt_packages',
      pathRelative: 'tests/fixtures',
      pathSystem: fixtureDir,
      properties: { vars: { event_dates: '2024-01-01' } },
      targetPath: 'target',
      variables: {},
    };

    const preview = previewModel(project, modelJson);
    expect(preview.sql.toLowerCase()).toContain('select');
    expect(preview.yml).toContain('version');
    expect(preview.columns.length).toBeGreaterThan(0);
  });
});
