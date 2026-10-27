'use strict';

const fs = require('fs');
const path = require('path');
const {
  PUBLIC_REGISTRY,
  collectDisallowedResolved,
  registryPrefix,
  rewriteLockfileText,
} = require('./lockfile-registry');

function main() {
  // npm omits npm_config_registry when the active registry is the built-in default.
  const configured = process.env.npm_config_registry;
  const registry = configured || PUBLIC_REGISTRY;

  const prefix = registryPrefix(registry);
  if (!prefix) {
    console.error(`npm_config_registry is not an HTTP(S) URL: ${registry}`);
    process.exit(1);
  }

  const quiet = process.env.npm_lifecycle_event === 'postinstall';
  const log = (message) => {
    if (!quiet) console.log(message);
  };
  const lockPath = path.join(process.cwd(), 'package-lock.json');
  const original = fs.readFileSync(lockPath, 'utf8');
  const { text, rewritten } = rewriteLockfileText(original, registry);
  const remaining = collectDisallowedResolved(JSON.parse(text));

  if (prefix === PUBLIC_REGISTRY) {
    if (remaining.length === 0) {
      log(`Registry is ${PUBLIC_REGISTRY}. Nothing to rewrite.`);
      return;
    }
    if (!configured) {
      console.error(
        'npm_config_registry is unset, and package-lock.json has tarball URLs on another host.'
      );
      console.error('Run `npm run lockfile:normalize` so npm passes the active registry.');
    } else {
      console.error(
        `Registry is ${PUBLIC_REGISTRY}, but package-lock.json has tarball URLs on another host.`
      );
      console.error('Re-run with npm_config_registry set to the registry that produced those URLs.');
    }
    printRemaining(remaining);
    process.exit(1);
  }

  if (rewritten === 0 && remaining.length === 0) {
    log('No resolved URLs used the configured registry prefix.');
    return;
  }

  if (rewritten > 0) {
    JSON.parse(text);
    fs.writeFileSync(lockPath, text);
    console.log(`Rewrote ${rewritten} resolved URL(s) to ${PUBLIC_REGISTRY}`);
  }

  if (remaining.length > 0) {
    console.error('These resolved URLs did not match the configured registry prefix:');
    console.error(`Prefix: ${prefix}`);
    printRemaining(remaining);
    process.exit(1);
  }
}

/**
 * @param {{ name: string, resolved: string }[]} remaining
 */
function printRemaining(remaining) {
  for (const entry of remaining) {
    console.error(`  ${entry.name}: ${entry.resolved}`);
  }
}

main();
