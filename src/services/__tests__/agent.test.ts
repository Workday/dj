import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const SKILLS_DIR = path.resolve(__dirname, '../../../templates/skills');
const AGENTS_TEMPLATE = path.resolve(
  __dirname,
  '../../../templates/_AGENTS.md',
);

describe('Skills', () => {
  const skillDirs = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory());

  test('templates/skills contains at least one skill directory', () => {
    expect(skillDirs.length).toBeGreaterThanOrEqual(1);
  });

  test.each(skillDirs.map((d) => d.name))(
    '%s has a _SKILL.md with valid frontmatter',
    (dirName) => {
      const skillMdPath = path.join(SKILLS_DIR, dirName, '_SKILL.md');
      expect(fs.existsSync(skillMdPath)).toBe(true);

      const content = fs.readFileSync(skillMdPath, 'utf-8');

      // Must start with YAML frontmatter
      expect(content).toMatch(/^---\n/);
      expect(content).toMatch(/\n---\n/);

      // Must have required frontmatter fields
      expect(content).toMatch(/^name:\s*.+/m);
      expect(content).toMatch(/^description:\s*.+/m);

      // Must have a markdown body after frontmatter
      const body = content.split(/\n---\n/)[1];
      expect(body?.trim().length).toBeGreaterThan(0);
    },
  );

  test.each(skillDirs.map((d) => d.name))(
    '%s relative markdown links resolve to bundled files',
    (dirName) => {
      const skillDir = path.join(SKILLS_DIR, dirName);
      const mdFiles: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.name.endsWith('.md')) {
            mdFiles.push(full);
          }
        }
      };
      walk(skillDir);

      for (const mdFile of mdFiles) {
        const content = fs.readFileSync(mdFile, 'utf-8');
        const links = [...content.matchAll(/\]\(([^)\s]+)\)/g)].map(
          (m) => m[1],
        );
        for (const target of links) {
          // Skip external URLs (scheme prefix) and in-page anchors.
          if (/^[a-z][a-z+.-]*:/i.test(target) || target.startsWith('#')) {
            continue;
          }
          const resolved = path.resolve(
            path.dirname(mdFile),
            target.split('#')[0],
          );
          const link = { in: path.relative(SKILLS_DIR, mdFile), target };
          expect({ ...link, exists: fs.existsSync(resolved) }).toEqual({
            ...link,
            exists: true,
          });
        }
      }
    },
  );

  test('_AGENTS.md template exists and contains expected content', () => {
    const content = fs.readFileSync(AGENTS_TEMPLATE, 'utf-8');
    expect(content).toBeTruthy();
    expect(content).toContain('DJ (Data JSON) Framework');
  });
});
