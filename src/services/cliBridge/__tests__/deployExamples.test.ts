import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { deployCliExamples } from '../deployExamples';

describe('deployCliExamples', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-examples-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('copies every *.request.json and skips other files', () => {
    const src = path.join(root, 'src');
    const dest = path.join(root, '.dj', 'examples');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'model-create.request.json'), '{}');
    fs.writeFileSync(path.join(src, 'trino-schemas.request.json'), '{}');
    fs.writeFileSync(path.join(src, 'README.md'), '# docs');

    const count = deployCliExamples(src, dest);

    expect(count).toBe(2);
    expect(fs.readdirSync(dest).sort()).toEqual([
      'model-create.request.json',
      'trino-schemas.request.json',
    ]);
  });

  it('replaces stale files from a previous deploy', () => {
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    fs.mkdirSync(src);
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'removed.request.json'), '{}');
    fs.writeFileSync(path.join(src, 'kept.request.json'), '{}');

    deployCliExamples(src, dest);

    expect(fs.readdirSync(dest)).toEqual(['kept.request.json']);
  });
});
