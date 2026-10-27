'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  PUBLIC_REGISTRY,
  collectDisallowedResolved,
  normalizeResolvedUrl,
  registryPrefix,
  rewriteLockfileText,
} = require('./lockfile-registry');

const MIRROR = 'https://mirror.example/artifactory/api/npm/npm-virtual/';

describe('lockfile registry', () => {
  test('registry prefix gains a trailing slash and drops a query', () => {
    expect(registryPrefix(`${MIRROR}?token=1`)).toBe(MIRROR);
    expect(registryPrefix(MIRROR.slice(0, -1))).toBe(MIRROR);
    expect(registryPrefix('https://registry.npmjs.org')).toBe(PUBLIC_REGISTRY);
    expect(registryPrefix('not a url')).toBeNull();
  });

  test('rewrites a mirror tarball URL and strips a download query', () => {
    const resolved = `${MIRROR}lodash/-/lodash-4.17.21.tgz?dl=1`;
    expect(normalizeResolvedUrl(resolved, registryPrefix(MIRROR))).toBe(
      'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'
    );
  });

  test('rewrites scoped packages', () => {
    const resolved = `${MIRROR}@scope/pkg/-/pkg-1.2.3.tgz`;
    expect(normalizeResolvedUrl(resolved, registryPrefix(MIRROR))).toBe(
      'https://registry.npmjs.org/@scope/pkg/-/pkg-1.2.3.tgz'
    );
  });

  test('leaves public, git, and workspace resolved values alone', () => {
    const prefix = registryPrefix(MIRROR);
    const pub = 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz';
    const git = 'git+https://github.com/org/repo.git#abc';
    expect(normalizeResolvedUrl(pub, prefix)).toBe(pub);
    expect(normalizeResolvedUrl(git, prefix)).toBe(git);
    expect(normalizeResolvedUrl('web', prefix)).toBe('web');
  });

  test('rewrites resolved lines in place and keeps integrity', () => {
    const sample = `{
  "packages": {
    "node_modules/lodash": {
      "version": "4.17.21",
      "resolved": "${MIRROR}lodash/-/lodash-4.17.21.tgz",
      "integrity": "sha512-abc"
    },
    "node_modules/@dj/web": {
      "resolved": "web",
      "link": true
    },
    "node_modules/left": {
      "resolved": "git+https://github.com/org/repo.git#abc",
      "integrity": "sha512-def"
    }
  }
}
`;
    const { text, rewritten } = rewriteLockfileText(sample, MIRROR);
    expect(rewritten).toBe(1);
    expect(text).toContain('"integrity": "sha512-abc"');
    expect(text).toContain('"resolved": "web"');
    expect(text).toContain('"resolved": "git+https://github.com/org/repo.git#abc"');
    expect(text).toContain(
      '"resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz"'
    );
    const parsed = JSON.parse(text);
    expect(parsed.packages['node_modules/lodash'].integrity).toBe('sha512-abc');
  });

  test('a public registry rewrites nothing', () => {
    const sample = '{"packages":{"node_modules/a":{"resolved":"https://registry.npmjs.org/a/-/a-1.0.0.tgz"}}}\n';
    const { text, rewritten } = rewriteLockfileText(sample, PUBLIC_REGISTRY);
    expect(rewritten).toBe(0);
    expect(text).toBe(sample);
  });

  test('flags http hosts other than registry.npmjs.org and allows workspace links', () => {
    const lock = {
      packages: {
        '': {},
        'node_modules/@dj/web': { resolved: 'web', link: true },
        'node_modules/ok': {
          resolved: 'https://registry.npmjs.org/ok/-/ok-1.0.0.tgz',
          integrity: 'sha512-ok',
        },
        'node_modules/mirror': {
          resolved: `${MIRROR}mirror/-/mirror-1.0.0.tgz`,
          integrity: 'sha512-mirror',
        },
      },
    };
    expect(collectDisallowedResolved(lock)).toEqual([
      {
        name: 'node_modules/mirror',
        resolved: `${MIRROR}mirror/-/mirror-1.0.0.tgz`,
      },
    ]);
  });

  test('the committed lockfile uses the public npm host', () => {
    const lock = require('../package-lock.json');
    expect(collectDisallowedResolved(lock)).toEqual([]);
  });

  test('an unset registry leaves a public lockfile unchanged', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockfile-registry-'));
    const lockPath = path.join(dir, 'package-lock.json');
    const sample =
      '{"packages":{"node_modules/a":{"resolved":"https://registry.npmjs.org/a/-/a-1.0.0.tgz"}}}\n';
    fs.writeFileSync(lockPath, sample);
    const env = { ...process.env, npm_lifecycle_event: 'postinstall' };
    delete env.npm_config_registry;
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'normalize-lockfile-registry.js')],
      { cwd: dir, env, encoding: 'utf8' }
    );
    expect(result.status).toBe(0);
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(sample);
  });

  test('an unset registry fails when the lockfile uses another host', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockfile-registry-'));
    const lockPath = path.join(dir, 'package-lock.json');
    const sample = `{"packages":{"node_modules/a":{"resolved":"${MIRROR}a/-/a-1.0.0.tgz"}}}\n`;
    fs.writeFileSync(lockPath, sample);
    const env = { ...process.env };
    delete env.npm_config_registry;
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'normalize-lockfile-registry.js')],
      { cwd: dir, env, encoding: 'utf8' }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm_config_registry is unset');
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(sample);
  });
});
