import esbuild from 'esbuild';
import process from 'process';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(
          `    ${location.file}:${location.line}:${location.column}:`,
        );
      });
      console.log('[watch] build finished');
    });
  },
};

/** Shared options for every bundle. */
const common = {
  bundle: true,
  format: 'cjs',
  mainFields: ['module', 'main'],
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'node',
  target: 'es2023',
  tsconfig: 'tsconfig.json',
  logLevel: 'silent',
  plugins: [esbuildProblemMatcherPlugin],
};

/** Per-bundle configs. */
const builds = [
  {
    // The VS Code extension host bundle. `vscode` is provided by the host.
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension/extension.js',
    external: ['vscode'],
  },
  {
    // The standalone `dj` CLI, deployed to `.dj/bin/dj`. Intentionally has NO
    // `external: ['vscode']` — a stray vscode import must fail this bundle,
    // which is our guardrail that the CLI stayed vscode-free.
    ...common,
    entryPoints: ['src/bin/dj-cli.ts'],
    outfile: 'dist/cli/dj.js',
    banner: { js: '#!/usr/bin/env node' },
  },
];

async function main() {
  const contexts = await Promise.all(
    builds.map((options) => esbuild.context(options)),
  );
  if (watch) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
  } else {
    await Promise.all(contexts.map((ctx) => ctx.rebuild()));
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
