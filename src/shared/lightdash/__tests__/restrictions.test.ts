import { describe, expect, it } from '@jest/globals';
import {
  describeLightdashRestriction,
  type LightdashRestrictedProject,
  resolveLightdashUploadRestriction,
} from '@shared/lightdash/restrictions';

describe('resolveLightdashUploadRestriction', () => {
  const baseList: LightdashRestrictedProject[] = [
    { uuid: 'AAA-111', mode: 'block', label: 'production' },
    { uuid: 'bbb-222', mode: 'warn', label: 'preview' },
  ];

  it('returns allow when the input UUID is empty', () => {
    expect(resolveLightdashUploadRestriction('', baseList)).toEqual({
      status: 'allow',
    });
    expect(resolveLightdashUploadRestriction('   ', baseList)).toEqual({
      status: 'allow',
    });
  });

  it('returns allow when the list is empty or undefined', () => {
    expect(resolveLightdashUploadRestriction('any-uuid', [])).toEqual({
      status: 'allow',
    });
    expect(resolveLightdashUploadRestriction('any-uuid', undefined)).toEqual({
      status: 'allow',
    });
  });

  it('returns allow when the UUID is not in the list', () => {
    expect(resolveLightdashUploadRestriction('zzz-999', baseList)).toEqual({
      status: 'allow',
    });
  });

  it('matches case-insensitively and trims whitespace on the input', () => {
    expect(resolveLightdashUploadRestriction('  aaa-111  ', baseList)).toEqual({
      status: 'block',
      mode: 'block',
      uuid: 'AAA-111',
      label: 'production',
    });
    expect(resolveLightdashUploadRestriction('BBB-222', baseList)).toEqual({
      status: 'warn',
      mode: 'warn',
      uuid: 'bbb-222',
      label: 'preview',
    });
  });

  it('returns the first matching entry when duplicates exist', () => {
    const list: LightdashRestrictedProject[] = [
      { uuid: 'dup', mode: 'warn' },
      { uuid: 'dup', mode: 'block' },
    ];
    expect(resolveLightdashUploadRestriction('dup', list)).toEqual({
      status: 'warn',
      mode: 'warn',
      uuid: 'dup',
      label: undefined,
    });
  });

  it('skips malformed entries (missing uuid / unknown mode)', () => {
    const list = [
      // missing uuid
      { mode: 'block' },
      // unknown mode
      { uuid: 'kkk-555', mode: 'block-everything' },
      // valid
      { uuid: 'kkk-555', mode: 'warn' },
    ] as unknown as LightdashRestrictedProject[];
    expect(resolveLightdashUploadRestriction('kkk-555', list)).toEqual({
      status: 'warn',
      mode: 'warn',
      uuid: 'kkk-555',
      label: undefined,
    });
  });

  it('drops a blank label so the message helper falls back to the UUID', () => {
    const list: LightdashRestrictedProject[] = [
      { uuid: 'ccc-333', mode: 'block', label: '   ' },
    ];
    expect(resolveLightdashUploadRestriction('ccc-333', list)).toEqual({
      status: 'block',
      mode: 'block',
      uuid: 'ccc-333',
      label: undefined,
    });
  });
});

describe('describeLightdashRestriction', () => {
  it('returns undefined for allow', () => {
    expect(describeLightdashRestriction({ status: 'allow' })).toBeUndefined();
  });

  it('mentions the label and UUID for block mode', () => {
    const msg = describeLightdashRestriction({
      status: 'block',
      mode: 'block',
      uuid: 'AAA-111',
      label: 'production',
    });
    expect(msg).toMatch(/blocked/i);
    expect(msg).toContain('production');
    expect(msg).toContain('AAA-111');
    expect(msg).toContain('dj.lightdash.restrictedProjects');
  });

  it('falls back to just the UUID when no label is present', () => {
    const msg = describeLightdashRestriction({
      status: 'warn',
      mode: 'warn',
      uuid: 'bbb-222',
    });
    expect(msg).toMatch(/warn/i);
    expect(msg).toContain('bbb-222');
    expect(msg).not.toMatch(/'\s*'/); // no empty label quotes
  });
});
