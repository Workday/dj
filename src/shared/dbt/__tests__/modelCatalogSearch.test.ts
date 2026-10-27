import {
  matchesModelSearchFilters,
  rankSimilarModels,
  summarizeModelFromPaths,
} from '@shared/dbt/modelCatalogSearch';
import type { DbtModel } from '@shared/dbt/types';

describe('modelCatalogSearch', () => {
  const baseModel: DbtModel = {
    name: 'mart__g__t__wpc_capacity',
    description: '',
    childMap: [],
    parentMap: [],
    pathRelativeDirectory: 'models/marts',
    pathSystemDirectory: '/proj/models/marts',
    pathSystemFile: '/proj/models/marts/mart__g__t__wpc_capacity.sql',
  };

  it('matches pattern and tags', () => {
    const summary = summarizeModelFromPaths(
      baseModel,
      '/proj/models/marts/mart__g__t__wpc_capacity.model.json',
      {
        type: 'mart_select_model',
        group: 'g',
        topic: 't',
        tags: ['lightdash-explore', 'privatedatacentre'],
        lightdash: { table: { label: 'WPC Capacity Review' } },
        from: { model: 'int__g__t__wpc' },
      },
    );
    expect(
      matchesModelSearchFilters(summary, {
        pattern: '*wpc*',
        requireLightdashExploreTag: true,
      }),
    ).toBe(true);
    expect(
      matchesModelSearchFilters(summary, { tags: ['lightdash-explore'] }),
    ).toBe(true);
    expect(matchesModelSearchFilters(summary, { topic: 'other' })).toBe(false);
  });

  it('ranks similar models by shared from and topic', () => {
    const summaries = [
      summarizeModelFromPaths(baseModel, '/a.model.json', {
        group: 'g',
        topic: 't',
        from: { model: 'int__up' },
        tags: ['lightdash-explore'],
      }),
      summarizeModelFromPaths(
        { ...baseModel, name: 'mart__g__other__x' },
        '/b.model.json',
        { group: 'g', topic: 'other', from: { model: 'int__up' } },
      ),
    ];
    const ranked = rankSimilarModels(
      summaries,
      {
        fromModel: 'int__up',
        topic: 't',
        tags: ['lightdash-explore'],
      },
      5,
    );
    expect(ranked[0]?.name).toBe('mart__g__t__wpc_capacity');
    expect(ranked.length).toBeGreaterThanOrEqual(1);
  });
});
