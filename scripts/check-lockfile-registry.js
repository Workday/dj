'use strict';

const fs = require('fs');
const path = require('path');
const { collectDisallowedResolved } = require('./lockfile-registry');

const lockPath = path.join(process.cwd(), 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const bad = collectDisallowedResolved(lock);

if (bad.length === 0) {
  process.exit(0);
}

console.error('package-lock.json tarball URLs must use https://registry.npmjs.org.');
for (const entry of bad) {
  console.error(`  ${entry.name}: ${entry.resolved}`);
}
console.error(
  'After installing against a private registry, run `npm run lockfile:normalize` and commit the result.'
);
process.exit(1);
