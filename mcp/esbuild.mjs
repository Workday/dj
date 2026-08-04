import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(root, 'src/server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: path.join(root, 'dist/server.js'),
  format: 'cjs',
  // jsonc-parser's `main` is a UMD bundle whose inner require() can't be
  // statically resolved; prefer the ESM build like the extension bundle does.
  mainFields: ['module', 'main'],
  sourcemap: true,
  alias: {
    admin: path.join(root, 'src/stubs/admin.ts'),
    '@services': path.join(root, '../src/services'),
    '@shared': path.join(root, '../src/shared'),
  },
  external: [],
});
