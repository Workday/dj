import { describe, expect, test } from '@jest/globals';
import {
  compareVersions,
  normalizeLineEndings,
} from '@shared/framework/generated-file-header';
import {
  GENERATED_FILE_CONTENT_VERSIONS,
  getGeneratedFileContentVersion,
} from '@shared/framework/generated-file-versions';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { ETL_HELPER_BUNDLE_FILES } from '../kpo-sizes';
import {
  generatePythonModelConfigPy,
  generatePythonModelTasksPy,
  generateTrinoIoPy,
} from '../python-model-utils';

const REPO_ROOT = path.join(__dirname, '../../../../..');
const AIRFLOW_TREES = ['v2_7', 'v2_10'];

const sha256 = (text: string) =>
  createHash('sha256').update(normalizeLineEndings(text)).digest('hex');

/** `[source label, output file name, generated body]` */
const generatedBodies: [string, string, string][] = [
  ['_config.py', '_config.py', generatePythonModelConfigPy()],
  ['_trino_io.py', '_trino_io.py', generateTrinoIoPy()],
  ['_model_tasks.py', '_model_tasks.py', generatePythonModelTasksPy()],
  ...AIRFLOW_TREES.flatMap((tree) =>
    ETL_HELPER_BUNDLE_FILES.map((fileName): [string, string, string] => [
      `airflow/${tree}/${fileName}`,
      fileName,
      fs.readFileSync(path.join(REPO_ROOT, 'airflow', tree, fileName), 'utf8'),
    ]),
  ),
];

const packageVersion = (
  JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

describe('GENERATED_FILE_CONTENT_VERSIONS', () => {
  test('tracks exactly the generated runtime files', () => {
    expect(Object.keys(GENERATED_FILE_CONTENT_VERSIONS).sort()).toEqual(
      [...new Set(generatedBodies.map(([, fileName]) => fileName))].sort(),
    );
  });

  test.each(generatedBodies)(
    '%s content matches its recorded hash',
    (label, fileName, body) => {
      const actual = sha256(body);
      const entry = GENERATED_FILE_CONTENT_VERSIONS[fileName];
      if (actual !== entry.sha256) {
        throw new Error(
          `${label} content changed. In src/shared/framework/generated-file-versions.ts ` +
            `set its version to "${packageVersion}" and its sha256 to "${actual}".`,
        );
      }
    },
  );

  test.each(Object.entries(GENERATED_FILE_CONTENT_VERSIONS))(
    '%s content version does not exceed package.json',
    (_fileName, { version }) => {
      expect(compareVersions(version, packageVersion)).toBeLessThanOrEqual(0);
    },
  );

  test('looks up content versions by file name', () => {
    expect(getGeneratedFileContentVersion('_trino_io.py')).toBe(
      GENERATED_FILE_CONTENT_VERSIONS['_trino_io.py'].version,
    );
    expect(getGeneratedFileContentVersion('unknown.py')).toBeUndefined();
    expect(getGeneratedFileContentVersion('toString')).toBeUndefined();
  });
});
