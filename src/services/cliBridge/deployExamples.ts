import * as fs from 'fs';
import * as path from 'path';

/**
 * Copy the bundled CLI request examples (`*.request.json`) into a workspace
 * directory. Replaces the destination contents so removed examples don't linger.
 * Returns the number of files copied.
 */
export function deployCliExamples(srcDir: string, destDir: string): number {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  let copied = 0;
  for (const file of fs.readdirSync(srcDir)) {
    if (!file.endsWith('.request.json')) {
      continue;
    }
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    copied++;
  }
  return copied;
}
