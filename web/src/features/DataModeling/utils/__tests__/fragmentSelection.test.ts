import { upsertFragmentSelect } from '../fragmentSelection';

describe('upsertFragmentSelect', () => {
  it('appends a new entry when the fragment is not selected yet', () => {
    const select = ['plain_col', { name: 'x', expr: 'x' }];
    expect(
      upsertFragmentSelect(select, 'frag', 'all_from_fragment', {}),
    ).toEqual([
      'plain_col',
      { name: 'x', expr: 'x' },
      { fragment: 'frag', type: 'all_from_fragment' },
    ]);
  });

  it('replaces an existing entry in place and keeps its overrides', () => {
    const select = [
      { fragment: 'other', type: 'all_from_fragment' },
      {
        fragment: 'frag',
        type: 'all_from_fragment',
        overrides: { billed_cost: { description: 'Billed' } },
      },
      'tail',
    ];
    const next = upsertFragmentSelect(select, 'frag', 'dims_from_fragment', {
      exclude: ['billed_cost'],
    });
    expect(next).toEqual([
      { fragment: 'other', type: 'all_from_fragment' },
      {
        fragment: 'frag',
        type: 'dims_from_fragment',
        overrides: { billed_cost: { description: 'Billed' } },
        exclude: ['billed_cost'],
      },
      'tail',
    ]);
  });

  it('writes include or exclude from the result and drops empty ones', () => {
    const select = [
      { fragment: 'frag', type: 'all_from_fragment', exclude: ['a'] },
    ];
    expect(
      upsertFragmentSelect(select, 'frag', 'all_from_fragment', {
        include: ['b', 'c'],
        exclude: [],
      }),
    ).toEqual([
      { fragment: 'frag', type: 'all_from_fragment', include: ['b', 'c'] },
    ]);
  });

  it('removes the fragment entry when asked, and keeps the rest', () => {
    const select = ['a', { fragment: 'frag', type: 'all_from_fragment' }, 'b'];
    expect(
      upsertFragmentSelect(select, 'frag', 'all_from_fragment', {}, true),
    ).toEqual(['a', 'b']);
  });

  it('leaves the list unchanged when removing a fragment that is absent', () => {
    const select = ['a'];
    expect(
      upsertFragmentSelect(select, 'frag', 'all_from_fragment', {}, true),
    ).toEqual(['a']);
  });

  it('does not mutate the input list', () => {
    const select = [{ fragment: 'frag', type: 'all_from_fragment' }];
    upsertFragmentSelect(select, 'frag', 'dims_from_fragment', {
      exclude: ['a'],
    });
    expect(select).toEqual([{ fragment: 'frag', type: 'all_from_fragment' }]);
  });
});
