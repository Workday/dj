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

  const EXPECTED_SKILLS = [
    'convert-sql-to-model',
    'dj-create-new-model',
    'dj-edit-lightdash-yaml',
    'dj-update-ai-hints',
  ];

  test('all expected skill templates are present', () => {
    const skillNames = skillDirs.map((d) => d.name).sort();
    expect(skillNames).toEqual(EXPECTED_SKILLS);
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

  test('_AGENTS.md template exists and contains expected content', () => {
    const content = fs.readFileSync(AGENTS_TEMPLATE, 'utf-8');
    expect(content).toBeTruthy();
    expect(content).toContain('DJ (Data JSON) Framework');
  });
});
