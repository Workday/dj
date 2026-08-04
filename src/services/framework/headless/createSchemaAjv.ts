import { BASE_SCHEMAS_PATH } from '@services/constants';
import type { Ajv, ValidateFunction } from 'ajv';
import { Ajv as AjvConstructor } from 'ajv';
import * as fs from 'fs';
import { glob } from 'glob';
import * as path from 'path';

export interface SchemaAjvBundle {
  ajv: Ajv;
  sourceValidator: ValidateFunction;
}

let cachedBundle: SchemaAjvBundle | null = null;

/**
 * Build an Ajv instance pre-populated with every schema file in `schemas/`.
 * Mirrors the runtime Framework service registration so validators can resolve $refs.
 */
export function createSchemaAjv(): SchemaAjvBundle {
  if (cachedBundle) {
    return cachedBundle;
  }

  const ajv = new AjvConstructor({
    allErrors: true,
    strictSchema: 'log',
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  const schemaFiles = glob.sync('*.schema.json', { cwd: BASE_SCHEMAS_PATH });
  for (const file of schemaFiles) {
    const content = fs.readFileSync(path.join(BASE_SCHEMAS_PATH, file), 'utf8');
    ajv.addSchema(JSON.parse(content), file);
  }

  const sourceValidator = ajv.getSchema('source.schema.json');
  if (!sourceValidator) {
    throw new Error('source.schema.json failed to register');
  }

  cachedBundle = { ajv, sourceValidator };
  return cachedBundle;
}

/** Reset cached Ajv bundle (for tests). */
export function resetSchemaAjvCache(): void {
  cachedBundle = null;
}
