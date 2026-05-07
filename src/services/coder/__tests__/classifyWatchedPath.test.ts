import { describe, expect, it } from '@jest/globals';
import { classifyWatchedPath } from '@services/coder/classifyWatchedPath';

const ROOT = '/repo';

describe('classifyWatchedPath', () => {
  it('detects .git/logs/HEAD as git-log even though HEAD has no extension', () => {
    // This is the regression: an extension-only regex would reject `HEAD`
    // and silently break git checkout/pull detection in the watcher.
    expect(classifyWatchedPath(`${ROOT}/.git/logs/HEAD`, ROOT)).toEqual({
      kind: 'git-log',
    });
  });

  it('classifies .model.json files as regular with the multi-dot extension', () => {
    expect(
      classifyWatchedPath(
        `${ROOT}/dbt/models/intermediate/foo/bar.model.json`,
        ROOT,
      ),
    ).toEqual({
      kind: 'regular',
      name: 'bar',
      extension: 'model.json',
      workspacePath: '/dbt/models/intermediate/foo/bar.model.json',
    });
  });

  it('classifies .source.json files as regular with the multi-dot extension', () => {
    expect(
      classifyWatchedPath(`${ROOT}/dbt/sources/baz.source.json`, ROOT),
    ).toEqual({
      kind: 'regular',
      name: 'baz',
      extension: 'source.json',
      workspacePath: '/dbt/sources/baz.source.json',
    });
  });

  it('classifies .sql files as regular', () => {
    const result = classifyWatchedPath(`${ROOT}/dbt/models/foo/bar.sql`, ROOT);
    expect(result).toEqual({
      kind: 'regular',
      name: 'bar',
      extension: 'sql',
      workspacePath: '/dbt/models/foo/bar.sql',
    });
  });

  it('classifies .yml files as regular', () => {
    const result = classifyWatchedPath(`${ROOT}/dbt/sources/x.yml`, ROOT);
    expect(result).toEqual({
      kind: 'regular',
      name: 'x',
      extension: 'yml',
      workspacePath: '/dbt/sources/x.yml',
    });
  });

  it('classifies plain .json (e.g. manifest) as regular', () => {
    const result = classifyWatchedPath(
      `${ROOT}/dbt/target/manifest.json`,
      ROOT,
    );
    expect(result).toEqual({
      kind: 'regular',
      name: 'manifest',
      extension: 'json',
      workspacePath: '/dbt/target/manifest.json',
    });
  });

  it('marks unsupported extensions as unsupported', () => {
    expect(classifyWatchedPath(`${ROOT}/notes/baz.txt`, ROOT)).toEqual({
      kind: 'unsupported',
    });
    expect(classifyWatchedPath(`${ROOT}/.cache/blob.bin`, ROOT)).toEqual({
      kind: 'unsupported',
    });
  });

  it('does not treat a stray HEAD outside .git/logs/ as git-log', () => {
    // An extension-less file at a different location should not be confused
    // with the git-log file. It lacks the `.git/logs/` prefix and has no
    // extension, so the regex bails out and we mark it unsupported.
    expect(classifyWatchedPath(`${ROOT}/some/dir/HEAD`, ROOT)).toEqual({
      kind: 'unsupported',
    });
  });

  it('returns unsupported for empty path', () => {
    expect(classifyWatchedPath('', ROOT)).toEqual({ kind: 'unsupported' });
  });

  it('handles paths outside the workspace root by leaving them unclassified-as-system', () => {
    // A HEAD-like path that is not under the configured workspace root must
    // not accidentally be treated as the project's git-log.
    expect(classifyWatchedPath('/other-root/.git/logs/HEAD', ROOT)).not.toEqual(
      { kind: 'git-log' },
    );
  });
});
