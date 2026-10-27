'use strict';

// Points this clone at .githooks so the lockfile pre-commit hook is installed
// without a manual git config step. Skips directories that are not a git checkout.

const { spawnSync } = require('child_process');

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

const inside = git(['rev-parse', '--is-inside-work-tree']);
if (inside.error || inside.status !== 0 || inside.stdout.trim() !== 'true') {
  process.exit(0);
}

const configured = git(['config', 'core.hooksPath', '.githooks']);
if (configured.status !== 0) {
  process.stderr.write(configured.stderr || 'Failed to set core.hooksPath\n');
  process.exit(configured.status || 1);
}
