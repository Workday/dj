import { describe, expect, test } from '@jest/globals';
import {
  CompositionRegistry,
  diffAgainstTemplate,
  mapResolvedPath,
  resolveModelComposition,
  usesComposition,
} from '@shared/framework/composition';

type Json = Record<string, any>;

function registryWith(files: Record<string, Json>): CompositionRegistry {
  const registry = new CompositionRegistry();
  for (const [filePath, definition] of Object.entries(files)) {
    registry.upsert({
      filePath,
      text: JSON.stringify(definition),
      definition,
    });
  }
  return registry;
}

const costColumns = {
  kind: 'select',
  name: 'focus_cost_columns',
  select: [
    {
      name: 'billed_cost',
      type: 'fct',
      expr: 'cast(billed_cost as decimal(38,10))',
      description: 'Billed cost',
      lightdash: { metrics: ['sum'] },
    },
    {
      name: 'effective_cost',
      type: 'fct',
      expr: 'cast(effective_cost as decimal(38,10))',
    },
    { name: 'charge_period_start', type: 'dim' },
  ],
};

const billingConfig = {
  kind: 'config',
  name: 'billing_daily_incremental',
  materialization: {
    type: 'incremental',
    format: 'iceberg',
    strategy: { type: 'delete+insert' },
  },
  tags: ['billing'],
  meta: { owner: 'finops', sla: { hours: 24 } },
};

const awsModel = {
  type: 'stg_select_source',
  group: 'billing',
  topic: 'costs',
  name: 'aws',
  fragments: ['billing_daily_incremental'],
  from: { source: 'aws_billing.focus_export' },
  select: [
    {
      type: 'all_from_fragment',
      fragment: 'focus_cost_columns',
      overrides: {
        billed_cost: { expr: 'cast(billedcost as decimal(38,10))' },
      },
    },
    { name: 'provider', type: 'dim', expr: "'aws'" },
  ],
};

const monthlyTemplate = {
  name: 'focus_monthly_cost',
  params: {
    upstream: { type: 'model_ref' },
    provider: { type: 'string' },
  },
  model: {
    type: 'mart_select_model',
    fragments: ['billing_daily_incremental'],
    tags: ['mart'],
    ctes: [
      {
        name: 'monthly',
        from: { model: '${upstream}', rollup: { interval: 'month' } },
        select: [{ type: 'all_from_model', model: '${upstream}' }],
      },
    ],
    from: { cte: 'monthly' },
    select: [
      { type: 'dims_from_cte', cte: 'monthly' },
      {
        name: 'billed_cost',
        type: 'fct',
        expr: 'sum(billed_cost)',
        lightdash: { metrics: ['sum'] },
      },
      { name: 'provider', type: 'dim', expr: "'${provider}'" },
    ],
    group_by: 'dims',
  },
};

const files = {
  '/p/fragments/focus_cost_columns.fragment.json': costColumns,
  '/p/fragments/billing_daily_incremental.fragment.json': billingConfig,
  '/p/templates/focus_monthly_cost.template.json': monthlyTemplate,
};

const awsMart = {
  type: 'mart_select_model',
  group: 'billing',
  topic: 'aws',
  name: 'monthly_cost',
  extends: 'focus_monthly_cost',
  with: { upstream: 'stg__billing__costs__aws', provider: 'aws' },
  select: [{ name: 'aws_operation', type: 'dim' }],
};

describe('usesComposition', () => {
  test('detects each composition feature and nothing else', () => {
    expect(usesComposition({ type: 'x', select: ['a'] })).toBe(false);
    expect(usesComposition({ extends: 't' })).toBe(true);
    expect(usesComposition({ fragments: ['f'] })).toBe(true);
    expect(
      usesComposition({
        ctes: [{ select: [{ type: 'dims_from_fragment', fragment: 'f' }] }],
      }),
    ).toBe(true);
  });
});

describe('resolveModelComposition: fragments', () => {
  test('returns models without composition untouched', () => {
    const model = { type: 'stg_select_source', select: ['a'] };
    const result = resolveModelComposition(model, registryWith(files));
    expect(result.composed).toBe(false);
    expect(result.resolved).toBe(model);
  });

  test('expands columns, applies overrides and config fragments', () => {
    const result = resolveModelComposition<Json>(awsModel, registryWith(files));
    expect(result.issues).toEqual([]);
    expect(result.resolved.select).toEqual([
      {
        name: 'billed_cost',
        type: 'fct',
        expr: 'cast(billedcost as decimal(38,10))',
        description: 'Billed cost',
        lightdash: { metrics: ['sum'] },
      },
      costColumns.select[1],
      costColumns.select[2],
      { name: 'provider', type: 'dim', expr: "'aws'" },
    ]);
    expect(result.resolved.materialization).toEqual(
      billingConfig.materialization,
    );
    expect(result.resolved.tags).toEqual(['billing']);
    expect(result.resolved).not.toHaveProperty('fragments');
    expect(result.dependencies).toEqual({
      fragments: ['billing_daily_incremental', 'focus_cost_columns'],
      templates: [],
    });
  });

  test('model values win over config fragments; tags combine; meta merges', () => {
    const later = {
      kind: 'config',
      name: 'later',
      tags: ['later'],
      meta: { sla: { minutes: 5 } },
      exclude_date_filter: true,
    };
    const registry = registryWith({
      ...files,
      '/p/later.fragment.json': later,
    });
    const result = resolveModelComposition<Json>(
      {
        ...awsModel,
        fragments: ['billing_daily_incremental', 'later'],
        tags: ['own'],
        meta: { owner: 'me' },
        exclude_date_filter: false,
      },
      registry,
    );
    expect(result.resolved.tags).toEqual(['billing', 'later', 'own']);
    expect(result.resolved.meta).toEqual({
      owner: 'me',
      sla: { hours: 24, minutes: 5 },
    });
    expect(result.resolved.exclude_date_filter).toBe(false);
  });

  test('dims/fcts filters, include and exclude', () => {
    const registry = registryWith(files);
    const select = (item: Json) =>
      resolveModelComposition<Json>({ ...awsModel, select: [item] }, registry);
    expect(
      select({ type: 'dims_from_fragment', fragment: 'focus_cost_columns' })
        .resolved.select,
    ).toEqual([costColumns.select[2]]);
    expect(
      select({
        type: 'fcts_from_fragment',
        fragment: 'focus_cost_columns',
        exclude: ['billed_cost'],
      }).resolved.select,
    ).toEqual([costColumns.select[1]]);
    const bad = select({
      type: 'dims_from_fragment',
      fragment: 'focus_cost_columns',
      include: ['billed_cost', 'nope'],
    });
    expect(bad.issues.map((i) => [i.path, i.severity])).toEqual([
      [['select', 0, 'include', 0], 'error'],
      [['select', 0, 'include', 1], 'error'],
      [['select', 0], 'warning'],
    ]);
  });

  test('reports unknown fragments, kind mismatches and unknown overrides', () => {
    const registry = registryWith(files);
    const result = resolveModelComposition(
      {
        ...awsModel,
        fragments: ['focus_cost_columns'],
        select: [
          { type: 'all_from_fragment', fragment: 'missing' },
          { type: 'all_from_fragment', fragment: 'billing_daily_incremental' },
          {
            type: 'all_from_fragment',
            fragment: 'focus_cost_columns',
            overrides: { nope: { expr: 'x' } },
          },
        ],
      },
      registry,
    );
    expect(result.hasErrors).toBe(true);
    expect(result.issues.map((i) => i.path)).toEqual([
      ['fragments', 0],
      ['select', 0, 'fragment'],
      ['select', 1, 'fragment'],
      ['select', 2, 'overrides', 'nope'],
    ]);
    expect(result.dependencies.fragments).toContain('missing');
  });

  test('duplicate output columns are an error at the second item', () => {
    const result = resolveModelComposition(
      {
        ...awsModel,
        select: [
          { name: 'billed_cost', type: 'fct' },
          { type: 'all_from_fragment', fragment: 'focus_cost_columns' },
        ],
      },
      registryWith(files),
    );
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toEqual(['select', 1]);
    expect(result.issues[0].related).toMatchObject({
      name: 'focus_cost_columns',
      path: ['select', 0],
    });
  });

  test('strips lightdash from fragment columns expanded inside CTEs', () => {
    const result = resolveModelComposition<Json>(
      {
        type: 'int_select_model',
        group: 'g',
        topic: 't',
        name: 'n',
        ctes: [
          {
            name: 'base',
            from: { model: 'stg__a__b__c' },
            select: [
              { type: 'all_from_fragment', fragment: 'focus_cost_columns' },
            ],
          },
        ],
        from: { cte: 'base' },
        select: [{ type: 'all_from_cte', cte: 'base' }],
      },
      registryWith(files),
    );
    expect(result.issues).toEqual([]);
    expect(result.resolved.ctes[0].select[0]).not.toHaveProperty('lightdash');
    expect(result.resolved.ctes[0].select).toHaveLength(3);
  });

  test('nested fragments expand and cycles are reported', () => {
    const outer = {
      kind: 'select',
      name: 'outer',
      select: [
        { type: 'all_from_fragment', fragment: 'focus_cost_columns' },
        { name: 'extra', type: 'dim' },
      ],
    };
    const loopA = {
      kind: 'select',
      name: 'loop_a',
      select: [{ type: 'all_from_fragment', fragment: 'loop_b' }],
    };
    const loopB = {
      kind: 'select',
      name: 'loop_b',
      select: [{ type: 'all_from_fragment', fragment: 'loop_a' }],
    };
    const registry = registryWith({
      ...files,
      '/p/outer.fragment.json': outer,
      '/p/a.fragment.json': loopA,
      '/p/b.fragment.json': loopB,
    });
    const nested = resolveModelComposition<Json>(
      {
        ...awsModel,
        select: [{ type: 'all_from_fragment', fragment: 'outer' }],
      },
      registry,
    );
    expect(nested.resolved.select.map((c: Json) => c.name)).toEqual([
      'billed_cost',
      'effective_cost',
      'charge_period_start',
      'extra',
    ]);
    expect(nested.dependencies.fragments).toEqual(
      expect.arrayContaining(['outer', 'focus_cost_columns']),
    );
    const cyclic = resolveModelComposition(
      {
        ...awsModel,
        select: [{ type: 'all_from_fragment', fragment: 'loop_a' }],
      },
      registry,
    );
    expect(cyclic.issues.some((i) => i.message.includes('cycle'))).toBe(true);
  });

  test('duplicate fragment names are an error', () => {
    const registry = registryWith({
      ...files,
      '/p/other/focus_cost_columns.fragment.json': costColumns,
    });
    const result = resolveModelComposition(awsModel, registry);
    expect(
      result.issues.some((i) => i.message.includes('more than one file')),
    ).toBe(true);
  });

  test('legacy materialized alongside a fragment materialization is an error', () => {
    const result = resolveModelComposition(
      { ...awsModel, materialized: 'ephemeral' },
      registryWith(files),
    );
    expect(result.issues.map((i) => i.path)).toEqual([['materialized']]);
  });

  test('provenance maps resolved paths back to model and fragment files', () => {
    const result = resolveModelComposition(awsModel, registryWith(files));
    expect(mapResolvedPath(result.provenance, ['select', 1, 'expr'])).toEqual({
      modelPath: ['select', 0],
      shared: {
        kind: 'fragment',
        name: 'focus_cost_columns',
        filePath: '/p/fragments/focus_cost_columns.fragment.json',
        path: ['select', 1, 'expr'],
      },
    });
    expect(mapResolvedPath(result.provenance, ['select', 3, 'expr'])).toEqual({
      modelPath: ['select', 1, 'expr'],
    });
    expect(
      mapResolvedPath(result.provenance, ['materialization', 'format']),
    ).toMatchObject({
      modelPath: ['fragments', 0],
      shared: {
        name: 'billing_daily_incremental',
        path: ['materialization', 'format'],
      },
    });
  });
});

describe('resolveModelComposition: templates', () => {
  test('substitutes params, merges select by identity, applies precedence', () => {
    const result = resolveModelComposition<Json>(
      { ...awsMart, tags: ['own'] },
      registryWith(files),
      { modelExists: () => true },
    );
    expect(result.issues).toEqual([]);
    const resolved = result.resolved;
    expect(resolved).toMatchObject({
      type: 'mart_select_model',
      group: 'billing',
      topic: 'aws',
      name: 'monthly_cost',
      from: { cte: 'monthly' },
      group_by: 'dims',
      materialization: billingConfig.materialization,
    });
    expect(resolved.tags).toEqual(['billing', 'mart', 'own']);
    expect(resolved.ctes[0].from.model).toBe('stg__billing__costs__aws');
    expect(resolved.select.map((s: Json) => s.name ?? s.type)).toEqual([
      'dims_from_cte',
      'billed_cost',
      'provider',
      'aws_operation',
    ]);
    expect(resolved.select[2].expr).toBe("'aws'");
    for (const key of ['extends', 'with', 'fragments']) {
      expect(resolved).not.toHaveProperty(key);
    }
    expect(result.dependencies).toEqual({
      fragments: ['billing_daily_incremental'],
      templates: ['focus_monthly_cost'],
    });
  });

  test('child items replace inherited ones in place; excludes and replace mode', () => {
    const registry = registryWith(files);
    const replaced = resolveModelComposition<Json>(
      {
        ...awsMart,
        select: [
          { name: 'billed_cost', type: 'fct', expr: 'max(billed_cost)' },
        ],
        select_exclude: ['dims_from_cte:monthly'],
      },
      registry,
    );
    expect(replaced.issues).toEqual([]);
    expect(replaced.resolved.select.map((s: Json) => s.expr ?? s.type)).toEqual(
      ['max(billed_cost)', "'aws'"],
    );
    const full = resolveModelComposition<Json>(
      { ...awsMart, select_mode: 'replace' },
      registry,
    );
    expect(full.resolved.select).toEqual(awsMart.select);
  });

  test('ctes merge by name and ctes_exclude removes inherited CTEs', () => {
    const registry = registryWith(files);
    const result = resolveModelComposition<Json>(
      {
        ...awsMart,
        ctes: [
          {
            name: 'monthly',
            from: { model: 'stg__other' },
            select: ['a'],
          },
          { name: 'extra', from: { cte: 'monthly' }, select: ['a'] },
        ],
      },
      registry,
    );
    expect(result.resolved.ctes.map((c: Json) => c.from)).toEqual([
      { model: 'stg__other' },
      { cte: 'monthly' },
    ]);
    const excluded = resolveModelComposition<Json>(
      { ...awsMart, ctes_exclude: ['monthly', 'nope'] },
      registry,
    );
    expect(excluded.resolved.ctes).toEqual([]);
    expect(excluded.issues.map((i) => i.path)).toEqual([['ctes_exclude', 1]]);
  });

  test('reports type mismatch, unknown/missing params and missing models', () => {
    const registry = registryWith(files);
    const mismatch = resolveModelComposition(
      { ...awsMart, type: 'int_select_model' },
      registry,
    );
    expect(mismatch.issues.map((i) => i.path)).toEqual([['type']]);
    const params = resolveModelComposition(
      { ...awsMart, with: { upstream: 'stg__nope', bogus: 'x' } },
      registry,
      { modelExists: (name) => name !== 'stg__nope' },
    );
    expect(params.issues.map((i) => i.path)).toEqual([
      ['with', 'bogus'],
      ['with', 'upstream'],
      ['extends'],
    ]);
    const unknown = resolveModelComposition(
      { ...awsMart, extends: 'nope' },
      registry,
    );
    expect(unknown.issues[0].message).toContain('Unknown template');
  });

  test('templates can extend templates; cycles and identity keys are reported', () => {
    const base = {
      name: 'base_mart',
      params: { upstream: { type: 'model_ref' } },
      model: {
        type: 'mart_select_model',
        from: { model: '${upstream}' },
        select: [{ type: 'all_from_model', model: '${upstream}' }],
      },
    };
    const derived = {
      name: 'derived_mart',
      params: { src: { type: 'model_ref' } },
      model: {
        type: 'mart_select_model',
        extends: 'base_mart',
        with: { upstream: '${src}' },
        name: 'not_allowed',
        where: 'x > 0',
      },
    };
    const loop = {
      name: 'loop_mart',
      model: { type: 'mart_select_model', extends: 'loop_mart' },
    };
    const registry = registryWith({
      '/p/base.template.json': base,
      '/p/derived.template.json': derived,
      '/p/loop.template.json': loop,
    });
    const result = resolveModelComposition<Json>(
      {
        type: 'mart_select_model',
        group: 'g',
        topic: 't',
        name: 'n',
        extends: 'derived_mart',
        with: { src: 'stg__a' },
      },
      registry,
    );
    expect(result.resolved.from).toEqual({ model: 'stg__a' });
    expect(result.resolved.where).toBe('x > 0');
    expect(result.resolved.name).toBe('n');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      path: ['extends'],
      related: { name: 'derived_mart', path: ['model', 'name'] },
    });
    const cyclic = resolveModelComposition(
      {
        type: 'mart_select_model',
        group: 'g',
        topic: 't',
        name: 'n',
        extends: 'loop_mart',
      },
      registry,
    );
    expect(cyclic.issues.some((i) => i.message.includes('cycle'))).toBe(true);
  });

  test('$${ escapes a literal ${ and undeclared params are reported', () => {
    const template = {
      name: 'escaped',
      model: {
        type: 'mart_select_model',
        from: { model: 'stg__a' },
        select: [
          { name: 'a', type: 'dim', expr: "'$${not_a_param}'" },
          { name: 'b', type: 'dim', expr: '${missing}' },
        ],
      },
    };
    const result = resolveModelComposition<Json>(
      {
        type: 'mart_select_model',
        group: 'g',
        topic: 't',
        name: 'n',
        extends: 'escaped',
      },
      registryWith({ '/p/e.template.json': template }),
    );
    expect(result.resolved.select[0].expr).toBe("'${not_a_param}'");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].related?.path).toEqual([
      'model',
      'select',
      1,
      'expr',
    ]);
  });

  test('provenance maps template values to the extends line', () => {
    const result = resolveModelComposition(awsMart, registryWith(files));
    expect(mapResolvedPath(result.provenance, ['group_by'])).toEqual({
      modelPath: ['extends'],
      shared: {
        kind: 'template',
        name: 'focus_monthly_cost',
        filePath: '/p/templates/focus_monthly_cost.template.json',
        path: ['model', 'group_by'],
      },
    });
    expect(mapResolvedPath(result.provenance, ['select', 3, 'name'])).toEqual({
      modelPath: ['select', 0, 'name'],
    });
  });

  test('with, select_exclude and friends require extends', () => {
    const result = resolveModelComposition(
      { ...awsModel, with: { a: 'b' }, select_exclude: ['x'] },
      registryWith(files),
    );
    expect(result.issues.map((i) => i.path)).toEqual([
      ['with'],
      ['select_exclude'],
    ]);
  });
});

describe('diffAgainstTemplate', () => {
  const registry = registryWith(files);
  const merged = (child: Json) =>
    resolveModelComposition<Json>(child, registry, { mode: 'merged' }).resolved;
  const strip = (model: Json) => {
    const out = { ...model };
    for (const key of [
      'extends',
      'with',
      'fragments',
      'select_exclude',
      'ctes_exclude',
      'select_mode',
      'ctes_mode',
    ]) {
      delete out[key];
    }
    return out;
  };
  const roundTrips = (edited: Json) => {
    const { child, exact } = diffAgainstTemplate(edited, registry);
    expect(exact).toBe(true);
    expect(strip(merged(child))).toEqual(strip(edited));
    return child;
  };

  test('an unedited child diffs to identity + extends + with', () => {
    const child = roundTrips(merged(awsMart));
    expect(child).toEqual({
      type: 'mart_select_model',
      group: 'billing',
      topic: 'aws',
      name: 'monthly_cost',
      extends: 'focus_monthly_cost',
      with: awsMart.with,
      select: awsMart.select,
    });
  });

  test('changed, removed and appended select items', () => {
    const edited = merged(awsMart);
    edited.select = edited.select
      .filter((s: Json) => s.name !== 'provider')
      .map((s: Json) =>
        s.name === 'billed_cost' ? { ...s, expr: 'max(billed_cost)' } : s,
      );
    edited.select.push({ name: 'new_col', type: 'dim' });
    const child = roundTrips(edited);
    expect(child.select_exclude).toEqual(['provider']);
    expect(child.select).toHaveLength(3);
    expect(child).not.toHaveProperty('select_mode');
  });

  test('reordering inherited items falls back to replace mode', () => {
    const edited = merged(awsMart);
    edited.select = [...edited.select].reverse();
    const child = roundTrips(edited);
    expect(child.select_mode).toBe('replace');
  });

  test('scalar, tag and meta changes', () => {
    const edited = merged(awsMart);
    edited.where = 'billed_cost > 0';
    edited.tags = [...edited.tags, 'extra'];
    edited.meta = { ...edited.meta, sla: { hours: 12 } };
    const child = roundTrips(edited);
    expect(child.where).toBe('billed_cost > 0');
    expect(child.tags).toEqual(['extra']);
    expect(child.meta).toEqual({ sla: { hours: 12 } });
  });

  test('removing inherited scalars or tags is reported as a warning', () => {
    const edited = merged(awsMart);
    delete edited.group_by;
    edited.tags = [];
    const { warnings, exact } = diffAgainstTemplate(edited, registry);
    expect(exact).toBe(false);
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('composition registry usage', () => {
  test('clearAllUsage resets the reverse index', () => {
    const registry = new CompositionRegistry();
    registry.recordUsage('/models/m.model.json', {
      fragments: ['focus_cost_columns'],
      templates: [],
    });
    expect(registry.usedBy('fragment', 'focus_cost_columns')).toHaveLength(1);
    registry.clearAllUsage();
    expect(registry.usedBy('fragment', 'focus_cost_columns')).toHaveLength(0);
  });

  test('recordUsage and usedBy track fragment dependencies', () => {
    const registry = registryWith({
      '/p/cols.fragment.json': costColumns,
    });
    registry.recordUsage('/models/m.model.json', {
      fragments: ['focus_cost_columns'],
      templates: [],
    });
    expect(registry.usedBy('fragment', 'focus_cost_columns')).toEqual([
      '/models/m.model.json',
    ]);
  });

  test('usesComposition detects fragment select on a CTE', () => {
    expect(
      usesComposition({
        type: 'int_select_model',
        group: 'g',
        topic: 't',
        name: 'n',
        ctes: [
          {
            name: 'c',
            from: { model: 'upstream' },
            select: [
              { type: 'all_from_fragment', fragment: 'focus_cost_columns' },
            ],
          },
        ],
      }),
    ).toBe(true);
  });
});
