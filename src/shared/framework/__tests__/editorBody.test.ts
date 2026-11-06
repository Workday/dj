import { describe, expect, test } from '@jest/globals';
import { buildEditorBody } from '@shared/framework/composition';

describe('buildEditorBody', () => {
  test('keeps extends, with and fragments from the raw file', () => {
    const raw = {
      type: 'mart_select_model',
      name: 'monthly_cost',
      extends: 'focus_monthly_cost',
      with: { upstream: 'aws_billing' },
      fragments: ['billing_daily_incremental'],
    };
    const resolved = {
      type: 'mart_select_model',
      name: 'monthly_cost',
      from: { model: 'aws_billing' },
      select: [{ name: 'billed_cost', type: 'fct' }],
      extends: 'focus_monthly_cost',
      with: { upstream: 'aws_billing' },
      fragments: ['billing_daily_incremental'],
    };
    expect(buildEditorBody(raw, resolved)).toEqual(resolved);
  });

  test('drops the select and CTE authoring keys even if the resolved body has them', () => {
    const raw = { type: 'int_select_model', name: 'm', extends: 't' };
    const resolved = {
      type: 'int_select_model',
      name: 'm',
      extends: 't',
      select_exclude: ['x'],
      ctes_exclude: ['c'],
      select_mode: 'replace',
      ctes_mode: 'replace',
    };
    const body = buildEditorBody(raw, resolved);
    expect(body).not.toHaveProperty('select_exclude');
    expect(body).not.toHaveProperty('ctes_exclude');
    expect(body).not.toHaveProperty('select_mode');
    expect(body).not.toHaveProperty('ctes_mode');
    expect(body.extends).toBe('t');
  });

  test('removes fragments the raw file does not declare', () => {
    const raw = { type: 'int_select_model', name: 'm' };
    const resolved = { type: 'int_select_model', name: 'm', fragments: ['f'] };
    expect(buildEditorBody(raw, resolved)).not.toHaveProperty('fragments');
  });

  test('returns a copy that does not alias the inputs', () => {
    const raw = { type: 'int_select_model', name: 'm', fragments: ['f'] };
    const resolved = {
      type: 'int_select_model',
      name: 'm',
      fragments: ['f'],
      select: [{ name: 'a' }],
    };
    const body = buildEditorBody(raw, resolved);
    (body.select as { name: string }[])[0].name = 'changed';
    (body.fragments as string[]).push('g');
    expect(resolved.select[0].name).toBe('a');
    expect(resolved.fragments).toEqual(['f']);
    expect(raw.fragments).toEqual(['f']);
  });

  test('falls back to the resolved body when the raw model is not an object', () => {
    expect(buildEditorBody(undefined, { type: 'x' })).toEqual({ type: 'x' });
  });
});
