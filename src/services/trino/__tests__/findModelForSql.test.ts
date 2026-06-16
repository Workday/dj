import { describe, expect, it } from '@jest/globals';
import { findModelForSql } from '@services/trino/findModelForSql';
import type { DbtModel } from '@shared/dbt/types';

function makeModel(name: string, pathSystemFile: string): DbtModel {
  return {
    name,
    description: '',
    childMap: [],
    parentMap: [],
    pathRelativeDirectory: '',
    pathSystemDirectory: '',
    pathSystemFile,
  } as DbtModel;
}

describe('findModelForSql', () => {
  it('returns null for empty SQL', () => {
    expect(findModelForSql('', new Map())).toBeNull();
  });

  describe('dbt query_comment (`comment`) match', () => {
    it('matches the node_id emitted by dbt-trino', () => {
      // Real-world shape of the query_comment dbt-trino prepends.
      const sql = `/* {"app": "dbt", "dbt_version": "1.7.0", "profile_name": "jaffle_shop", "target_name": "dev", "node_id": "model.my_project.int__finance__billing__daily"} */
create or replace view "hive"."analytics"."int__finance__billing__daily" as
select * from foo`;
      const models = new Map<string, DbtModel>([
        [
          'model.my_project.int__finance__billing__daily',
          makeModel(
            'int__finance__billing__daily',
            '/ws/my_project/models/int/finance/billing/int__finance__billing__daily.sql',
          ),
        ],
      ]);
      const m = findModelForSql(sql, models);
      expect(m).not.toBeNull();
      expect(m?.project).toBe('my_project');
      expect(m?.modelName).toBe('int__finance__billing__daily');
      expect(m?.matchedBy).toBe('comment');
    });

    it('tolerates single-quoted JSON keys', () => {
      const sql = `/* {'app':'dbt','node_id':'model.proj.foo'} */
select 1`;
      const m = findModelForSql(sql, new Map());
      expect(m?.project).toBe('proj');
      expect(m?.modelName).toBe('foo');
      expect(m?.matchedBy).toBe('comment');
    });

    it('returns the match even when the model is not in the manifest', () => {
      // Best-effort: surface the project/model name from the comment so
      // the UI can still display it, just without a clickable path.
      const sql = `/* {"node_id": "model.ghost_project.ghost_model"} */
select 1`;
      const m = findModelForSql(sql, new Map());
      expect(m).not.toBeNull();
      expect(m?.project).toBe('ghost_project');
      expect(m?.modelName).toBe('ghost_model');
      expect(m?.modelJsonPath).toBeUndefined();
      expect(m?.matchedBy).toBe('comment');
    });

    it('prefers the comment over the FQN when both are present', () => {
      const sql = `/* {"node_id": "model.proj.alpha"} */
create table "hive"."schema"."beta" as select 1`;
      const models = new Map<string, DbtModel>([
        ['model.proj.alpha', makeModel('alpha', '/ws/proj/models/alpha.sql')],
        ['model.proj.beta', makeModel('beta', '/ws/proj/models/beta.sql')],
      ]);
      const m = findModelForSql(sql, models);
      expect(m?.modelName).toBe('alpha');
      expect(m?.matchedBy).toBe('comment');
    });
  });

  describe('FQN (`fqn`) match', () => {
    it('matches `create table catalog.schema.name`', () => {
      const sql = `create table "hive"."analytics"."mart__sales" as
select * from foo`;
      const models = new Map<string, DbtModel>([
        [
          'model.analytics_project.mart__sales',
          makeModel(
            'mart__sales',
            '/ws/analytics_project/models/mart/mart__sales.sql',
          ),
        ],
      ]);
      const m = findModelForSql(sql, models);
      expect(m?.modelName).toBe('mart__sales');
      expect(m?.project).toBe('analytics_project');
      expect(m?.matchedBy).toBe('fqn');
    });

    it('matches `create or replace view catalog.schema.name`', () => {
      const sql = `create or replace view hive.analytics.mart__customers as
select * from foo`;
      const models = new Map<string, DbtModel>([
        [
          'model.proj.mart__customers',
          makeModel('mart__customers', '/ws/proj/models/mart__customers.sql'),
        ],
      ]);
      const m = findModelForSql(sql, models);
      expect(m?.modelName).toBe('mart__customers');
      expect(m?.matchedBy).toBe('fqn');
    });

    it('matches `insert into catalog.schema.name` (incremental)', () => {
      const sql = `insert into "hive"."analytics"."int__orders" select * from foo`;
      const models = new Map<string, DbtModel>([
        [
          'model.orders_project.int__orders',
          makeModel(
            'int__orders',
            '/ws/orders_project/models/int/int__orders.sql',
          ),
        ],
      ]);
      const m = findModelForSql(sql, models);
      expect(m?.modelName).toBe('int__orders');
      expect(m?.project).toBe('orders_project');
      expect(m?.matchedBy).toBe('fqn');
    });

    it('returns null when the FQN is present but not in the manifest', () => {
      const sql = `create table "hive"."schema"."unknown_table" as select 1`;
      const models = new Map<string, DbtModel>([
        ['model.proj.other', makeModel('other', '/ws/proj/models/other.sql')],
      ]);
      expect(findModelForSql(sql, models)).toBeNull();
    });
  });

  describe('trailing CTE (`cte`) fallback', () => {
    it('matches the trailing `SELECT * FROM <model>` in compiled SQL', () => {
      // Matches the shape of dbt-trino's `target/compiled/.../foo.sql`
      // when it isn't wrapped in a DDL.
      const sql = `
WITH __dbt__cte__stg__foo AS (select * from bar),
int__finance__billing__daily AS (
  select * from __dbt__cte__stg__foo
)
SELECT
  *
FROM
  int__finance__billing__daily
`;
      const models = new Map<string, DbtModel>([
        [
          'model.my_project.int__finance__billing__daily',
          makeModel(
            'int__finance__billing__daily',
            '/ws/my_project/models/int/int__finance__billing__daily.sql',
          ),
        ],
      ]);
      const m = findModelForSql(sql, models);
      expect(m?.modelName).toBe('int__finance__billing__daily');
      expect(m?.project).toBe('my_project');
      expect(m?.matchedBy).toBe('cte');
    });

    it('only inspects the tail (ignores intermediate `FROM <cte>`)', () => {
      // `__dbt__cte__stg__foo` appears as an intermediate FROM but the
      // matcher should land on the final `FROM int__top`.
      const sql = `WITH int__top AS (
  select * from __dbt__cte__stg__foo
)
SELECT * FROM int__top`;
      const models = new Map<string, DbtModel>([
        [
          'model.proj.int__top',
          makeModel('int__top', '/ws/proj/models/int__top.sql'),
        ],
        // `__dbt__cte__stg__foo` happens to also be a model name — but
        // because we only look at the tail, the matcher must still pick
        // `int__top`.
        [
          'model.proj.__dbt__cte__stg__foo',
          makeModel('__dbt__cte__stg__foo', '/ws/proj/models/x.sql'),
        ],
      ]);
      const m = findModelForSql(sql, models);
      expect(m?.modelName).toBe('int__top');
      expect(m?.matchedBy).toBe('cte');
    });
  });

  it('returns null when no strategy matches', () => {
    expect(findModelForSql('select 1', new Map())).toBeNull();
  });
});
