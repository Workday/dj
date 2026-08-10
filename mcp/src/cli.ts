/**
 * Thin CLI over headless DJ generators — no VS Code extension required.
 *
 * Usage:
 *   dj-gen generate model --project <dbtProjectDir> --json <path.model.json> [--write]
 *   dj-gen generate source --project <dbtProjectDir> --json <path.source.json> [--write]
 *   dj-gen validate model --json <path.model.json>
 *   dj-gen validate source --json <path.source.json>
 *   dj-gen preview-artifacts --project <dbtProjectDir> --json <path.model.json>
 */
import {
  createSchemaAjv,
  generateModelArtifacts,
  generateSourceArtifacts,
  loadDbtProject,
  previewModel,
  resolveModelPaths,
  validateModelJson,
  validateSourceJson,
  writeTextFile,
} from '@services/framework/headless';
import { jsonParse } from '@shared';
import type { FrameworkModel, FrameworkSource } from '@shared/framework/types';
import * as fs from 'fs';
import * as path from 'path';

function usage(exitCode = 1): never {
  console.error(`dj-gen — headless DJ JSON → SQL/YAML (no VS Code extension)

Commands:
  generate model  --project <dir> --json <file.model.json> [--write]
  generate source --project <dir> --json <file.source.json> [--write]
  validate model  --json <file.model.json>
  validate source --json <file.source.json>
  preview-artifacts --project <dir> --json <file.model.json>

Flags:
  --project   Path to dbt project (directory with dbt_project.yml)
  --json      Path to .model.json or .source.json
  --write     Write generated .sql / .yml next to the JSON file
`);
  process.exit(exitCode);
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) return undefined;
  return argv[i + 1];
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function readJsonFile(filePath: string): Record<string, unknown> {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }
  return jsonParse(fs.readFileSync(abs, 'utf8')) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '-h' || argv[0] === '--help') {
    usage(0);
  }

  const cmd = argv[0];
  const sub = argv[1];

  if (cmd === 'generate' && (sub === 'model' || sub === 'source')) {
    const projectDir = argValue(argv, '--project');
    const jsonPath = argValue(argv, '--json');
    const write = hasFlag(argv, '--write');
    if (!projectDir || !jsonPath) {
      throw new Error('--project and --json are required');
    }
    const project = loadDbtProject(path.resolve(projectDir));
    const absJson = path.resolve(jsonPath);
    const raw = readJsonFile(absJson);

    if (sub === 'model') {
      const modelJson = raw as FrameworkModel;
      const artifacts = generateModelArtifacts(project, modelJson);
      const out = {
        ok: true,
        kind: 'model',
        sql: artifacts.sql,
        yml: artifacts.yml,
        written: [] as string[],
      };
      if (write) {
        const paths = resolveModelPaths(project, modelJson);
        writeTextFile(paths.sql, artifacts.sql);
        writeTextFile(paths.yml, artifacts.yml);
        if (!fs.existsSync(paths.modelJson)) {
          writeTextFile(paths.modelJson, `${JSON.stringify(modelJson, null, 4)}\n`);
        }
        out.written = [paths.sql, paths.yml];
      }
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    const sourceJson = raw as FrameworkSource;
    const artifacts = generateSourceArtifacts(project, sourceJson);
    const out = {
      ok: true,
      kind: 'source',
      yml: artifacts.yml,
      written: [] as string[],
    };
    if (write) {
      const base = absJson.replace(/\.source\.json$/i, '');
      const ymlPath = `${base}.yml`;
      writeTextFile(ymlPath, artifacts.yml);
      out.written = [ymlPath];
    }
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'validate' && (sub === 'model' || sub === 'source')) {
    const jsonPath = argValue(argv, '--json');
    if (!jsonPath) {
      throw new Error('--json is required');
    }
    const raw = readJsonFile(jsonPath);
    const bundle = createSchemaAjv();
    const result =
      sub === 'model'
        ? validateModelJson(bundle, raw as FrameworkModel, path.resolve(jsonPath))
        : validateSourceJson(bundle, raw as FrameworkSource);
    console.log(JSON.stringify({ ok: result.valid, ...result }, null, 2));
    process.exit(result.valid ? 0 : 1);
  }

  if (cmd === 'preview-artifacts') {
    const projectDir = argValue(argv, '--project');
    const jsonPath = argValue(argv, '--json');
    if (!projectDir || !jsonPath) {
      throw new Error('--project and --json are required');
    }
    const project = loadDbtProject(path.resolve(projectDir));
    const raw = readJsonFile(jsonPath);
    const preview = previewModel(project, raw);
    console.log(
      JSON.stringify(
        {
          ok: true,
          modelJson: preview.modelJson,
          sql: preview.sql,
          yml: preview.yml,
          columns: preview.columns,
        },
        null,
        2,
      ),
    );
    return;
  }

  usage(1);
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      ok: false,
      errors: [(err as Error).message],
    }),
  );
  process.exit(1);
});
