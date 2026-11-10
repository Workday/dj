import { pickModelProject } from '../projectSelection';

const projects = [{ name: 'billing' }, { name: 'marketing' }];

describe('pickModelProject', () => {
  it('picks the project the model belongs to, not the first one', () => {
    expect(pickModelProject(projects, 'marketing')).toEqual({
      name: 'marketing',
    });
  });

  it('returns undefined when the model names a project that is not loaded', () => {
    expect(pickModelProject(projects, 'missing')).toBeUndefined();
  });

  it('falls back to the first project when the model has no project yet', () => {
    expect(pickModelProject(projects, '')).toEqual({ name: 'billing' });
    expect(pickModelProject(projects, undefined)).toEqual({ name: 'billing' });
  });

  it('returns undefined for an empty project list', () => {
    expect(pickModelProject([], 'billing')).toBeUndefined();
    expect(pickModelProject([], undefined)).toBeUndefined();
  });
});
