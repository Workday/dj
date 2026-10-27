'use strict';

// Rewrites package-lock tarball URLs from the active registry back to the public npm host.
// Integrity hashes are left unchanged. Scheme-less values (workspace links) are not registry URLs.

const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const PUBLIC_HOST = 'registry.npmjs.org';

/**
 * @param {string | undefined} registry
 * @returns {string | null} origin + pathname, always with a trailing slash
 */
function registryPrefix(registry) {
  if (!registry || typeof registry !== 'string') return null;
  let url;
  try {
    url = new URL(registry);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${pathname}`;
}

/**
 * @param {string} resolved
 * @returns {boolean}
 */
function isHttpUrl(resolved) {
  return /^(git\+)?https?:\/\//i.test(resolved);
}

/**
 * @param {string} resolved
 * @param {string | null} prefix
 * @returns {string}
 */
function normalizeResolvedUrl(resolved, prefix) {
  if (!prefix || prefix === PUBLIC_REGISTRY) return resolved;
  if (!resolved.startsWith(prefix)) return resolved;
  const rest = resolved.slice(prefix.length).split(/[?#]/)[0];
  return `${PUBLIC_REGISTRY}${rest}`;
}

/**
 * @param {string} text
 * @param {string | undefined} registry
 * @returns {{ text: string, rewritten: number }}
 */
function rewriteLockfileText(text, registry) {
  const prefix = registryPrefix(registry);
  if (!prefix || prefix === PUBLIC_REGISTRY) {
    return { text, rewritten: 0 };
  }
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`("resolved"\\s*:\\s*")${escaped}([^"\\\\]*)`, 'g');
  let rewritten = 0;
  const next = text.replace(pattern, (_match, lead, rest) => {
    rewritten += 1;
    return `${lead}${normalizeResolvedUrl(prefix + rest, prefix)}`;
  });
  return { text: next, rewritten };
}

/**
 * @param {unknown} lock
 * @returns {{ name: string, resolved: string }[]}
 */
function collectDisallowedResolved(lock) {
  if (!lock || typeof lock !== 'object' || !('packages' in lock)) return [];
  const packages = lock.packages;
  if (!packages || typeof packages !== 'object') return [];
  const bad = [];
  for (const [name, pkg] of Object.entries(packages)) {
    if (!pkg || typeof pkg !== 'object' || !('resolved' in pkg)) continue;
    const resolved = pkg.resolved;
    if (typeof resolved !== 'string' || !isHttpUrl(resolved)) continue;
    let hostname = '';
    try {
      hostname = new URL(resolved.replace(/^git\+/, '')).hostname;
    } catch {
      hostname = '';
    }
    if (hostname !== PUBLIC_HOST) bad.push({ name, resolved });
  }
  return bad;
}

module.exports = {
  PUBLIC_HOST,
  PUBLIC_REGISTRY,
  collectDisallowedResolved,
  isHttpUrl,
  normalizeResolvedUrl,
  registryPrefix,
  rewriteLockfileText,
};
