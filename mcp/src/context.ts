import { createSchemaAjv, type SchemaAjvBundle } from '@services/framework/headless';

let bundle: SchemaAjvBundle | null = null;

export function getSchemaBundle(): SchemaAjvBundle {
  if (!bundle) {
    bundle = createSchemaAjv();
  }
  return bundle;
}
