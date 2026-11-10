import {
  findDuplicateOutputColumns,
  formatDuplicateColumnMessage,
  resolveColumnSelectBinding,
} from '../columnOutputDuplicates';

describe('findDuplicateOutputColumns', () => {
  it('returns empty when all names are unique', () => {
    const result = findDuplicateOutputColumns([
      { name: 'a', modelName: 'fragment:frag' },
      { name: 'b', modelName: 'Derived Column' },
    ]);
    expect(result.duplicateNames).toEqual([]);
  });

  it('detects fragment preview row and manual row with same name', () => {
    const result = findDuplicateOutputColumns([
      { name: 'run_status', modelName: 'fragment:dj_qa_select' },
      { name: 'run_status', modelName: 'Derived Column' },
    ]);
    expect(result.duplicateNames).toEqual(['run_status']);
    expect(result.sourcesByName.run_status).toEqual([
      'fragment:dj_qa_select',
      'Derived Column',
    ]);
  });

  it('detects two plain string passthroughs with same name', () => {
    const result = findDuplicateOutputColumns([
      { name: 'id', modelName: '' },
      { name: 'id', modelName: '' },
    ]);
    expect(result.duplicateNames).toEqual(['id']);
  });
});

describe('formatDuplicateColumnMessage', () => {
  it('formats a readable message', () => {
    expect(formatDuplicateColumnMessage(['a', 'b'])).toBe(
      'Duplicate output column names: a, b. Remove one source before continuing.',
    );
  });
});

describe('resolveColumnSelectBinding', () => {
  const isDraggable = (item: unknown) => {
    if (typeof item === 'string') return true;
    if (item && typeof item === 'object' && 'expr' in item) return true;
    return false;
  };

  it('binds fragment rows to the fragment bulk entry', () => {
    const select = [
      { fragment: 'frag', type: 'all_from_fragment' },
      { name: 'run_status', expr: 'x' },
    ];
    const binding = resolveColumnSelectBinding(
      { name: 'run_status', modelName: 'fragment:frag' },
      select,
      isDraggable,
    );
    expect(binding.selectIndex).toBe(0);
    expect(binding.canDrag).toBe(false);
  });

  it('binds derived rows to the expr entry, not the fragment', () => {
    const select = [
      { fragment: 'frag', type: 'all_from_fragment' },
      { name: 'run_status', expr: 'x' },
    ];
    const binding = resolveColumnSelectBinding(
      { name: 'run_status', modelName: 'Derived Column' },
      select,
      isDraggable,
    );
    expect(binding.selectIndex).toBe(1);
    expect(binding.canDrag).toBe(true);
  });
});
