import * as fs from 'fs';
import { glob } from 'glob';
import * as path from 'path';

import type { DbtProjectManifest } from '../src/shared/dbt/types';

/**
 * Updates test fixtures from a dbt project
 *
 * Usage: npx ts-node tests/update-fixtures.ts [dbt-project-path]
 * Example: npx ts-node tests/update-fixtures.ts docs/examples/jaffle_shop
 * Default: Uses 'docs/examples/jaffle_shop' if no path provided
 *
 * This script:
 * 1. Copies all *.model.json, *.sql, *.yml files from the project
 * 2. Copies manifest.json (with macros stripped for smaller size)
 * 3. Ensures tests validate JSON → SQL & YML conversion across all models
 */
function main() {
  const EXAMPLE_PROJECT_PATH = 'docs/examples/jaffle_shop';

  const dbtProjectPath = process.argv[2] ?? EXAMPLE_PROJECT_PATH;

  if (!process.argv[2]) {
    console.warn(`Using default project path: ${EXAMPLE_PROJECT_PATH}`);
  }

  if (!fs.existsSync(dbtProjectPath)) {
    console.error(`Error: Project path does not exist: ${dbtProjectPath}`);
    process.exit(1);
  }

  console.log(`Updating test fixtures from: ${dbtProjectPath}`);
  const manifestPath = path.join(dbtProjectPath, 'target/manifest.json');
  const modelJsonFiles = glob.sync(`${dbtProjectPath}/models/**/*.model.json`);
  const fixturesDir = path.join(__dirname, 'fixtures');

  if (!fs.existsSync(manifestPath)) {
    console.error(`Error: manifest.json not found at: ${manifestPath}`);
    console.error('Run "dbt parse" or "dbt run" in the project first');
    process.exit(1);
  }

  console.info(`Cleaning existing fixtures...`);
  try {
    fs.rmSync(fixturesDir, { recursive: true });
  } catch {}
  fs.mkdirSync(fixturesDir);

  console.info(`Found ${modelJsonFiles.length} model files to copy...`);

  for (const pathJson of modelJsonFiles) {
    const pathSql = pathJson.replace(/\.model\.json$/, '.sql');
    const pathYml = pathJson.replace(/\.model\.json$/, '.yml');
    fs.writeFileSync(
      path.join(fixturesDir, path.basename(pathJson)),
      Buffer.from(fs.readFileSync(pathJson, 'utf8')),
      'utf8',
    );
    fs.writeFileSync(
      path.join(fixturesDir, path.basename(pathSql)),
      Buffer.from(fs.readFileSync(pathSql, 'utf8')),
      'utf8',
    );
    fs.writeFileSync(
      path.join(fixturesDir, path.basename(pathYml)),
      Buffer.from(fs.readFileSync(pathYml, 'utf8')),
      'utf8',
    );
  }

  // Shared fragments and templates are required to resolve composed models.
  const sharedFiles = glob.sync(
    `${dbtProjectPath}/**/*.{fragment,template}.json`,
    { ignore: ['**/target/**', '**/dbt_packages/**', '**/node_modules/**'] },
  );
  for (const pathShared of sharedFiles) {
    fs.writeFileSync(
      path.join(fixturesDir, path.basename(pathShared)),
      Buffer.from(fs.readFileSync(pathShared, 'utf8')),
      'utf8',
    );
  }
  console.info(`Found ${sharedFiles.length} shared fragment/template files...`);

  console.info(`Copying manifest.json...`);
  const { macros: _macros, ...manifest } = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8'),
  ) as DbtProjectManifest;

  // Sanitize root_path fields to remove local system paths for privacy/security
  const sanitizeRootPaths = (obj: any): any => {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(sanitizeRootPaths);
    }

    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'root_path') {
        // Replace with generic path to avoid exposing local system paths
        result[key] = '/path/to/dbt/project';
      } else {
        result[key] = sanitizeRootPaths(value);
      }
    }
    return result;
  };

  const sanitizedManifest = sanitizeRootPaths(manifest);

  fs.writeFileSync(
    path.join(fixturesDir, 'manifest.json'),
    Buffer.from(JSON.stringify(sanitizedManifest)),
    'utf8',
  );

  const totalFiles = fs.readdirSync(fixturesDir).length;
  console.info(`Fixtures updated successfully!`);
  console.info(`Total files: ${totalFiles}`);
  console.info(`Location: ${fixturesDir}`);
  console.info(`Run "npm run test" to validate`);
}

main();
