import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  mainFields: ['module', 'main'],
  sourcemap: true,
  alias: {
    admin: path.join(root, 'src/stubs/admin.ts'),
    '@services': path.join(root, '../src/services'),
    '@shared': path.join(root, '../src/shared'),
  },
  external: [],
};

await esbuild.build({
  ...shared,
  entryPoints: [path.join(root, 'src/server.ts')],
  outfile: path.join(root, 'dist/server.js'),
});

await esbuild.build({
  ...shared,
  entryPoints: [path.join(root, 'src/cli.ts')],
  outfile: path.join(root, 'dist/cli.js'),
  banner: {
    js: '#!/usr/bin/env node',
  },
});
