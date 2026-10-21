import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import Ajv from 'ajv';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { STANDARD_LIGHTDASH_TIME_INTERVALS } from '../constants';
import { ModelingFrameworkService } from '../ModelingFrameworkService';
import { DbtModelingFrameworkProvider } from '../providers/DbtModelingFrameworkProvider';

describe('ModelingFrameworkService & DbtModelingFrameworkProvider', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'dj-modeling-test-'),
    );
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  test('DbtModelingFrameworkProvider parses custom_granularities and defaults from lightdash.config.yml', async () => {
    const yamlContent = `
custom_granularities:
  fiscal_quarter:
    label: "Fiscal Quarter"
    sql: "DATE_TRUNC('quarter', \${COLUMN} + INTERVAL '1 month')"
    type: date
  bi_weekly:
    label: "Bi-Weekly"

defaults:
  additional_time_intervals:
    date:
      - fiscal_quarter
    timestamp:
      - HOUR
      - fiscal_quarter
`;
    await fs.promises.writeFile(
      path.join(tmpDir, 'lightdash.config.yml'),
      yamlContent,
      'utf8',
    );

    const provider = new DbtModelingFrameworkProvider();
    const config = await provider.loadConfig(tmpDir);

    expect(config.customGranularities).toEqual(['fiscal_quarter', 'bi_weekly']);
    expect(config.additionalTimeIntervals?.date).toEqual(['fiscal_quarter']);
    expect(config.additionalTimeIntervals?.timestamp).toEqual([
      'HOUR',
      'fiscal_quarter',
    ]);
  });

  test('DbtModelingFrameworkProvider supports lightdash.config.yaml', async () => {
    const yamlContent = `
custom_granularities:
  academic_term:
    label: "Academic Term"
`;
    await fs.promises.writeFile(
      path.join(tmpDir, 'lightdash.config.yaml'),
      yamlContent,
      'utf8',
    );

    const provider = new DbtModelingFrameworkProvider();
    const config = await provider.loadConfig(tmpDir);

    expect(config.customGranularities).toEqual(['academic_term']);
  });

  test('DbtModelingFrameworkProvider handles missing and invalid files gracefully', async () => {
    const provider = new DbtModelingFrameworkProvider();
    const emptyConfig = await provider.loadConfig(tmpDir);
    expect(emptyConfig).toEqual({});

    await fs.promises.writeFile(
      path.join(tmpDir, 'lightdash.config.yml'),
      'invalid: [yaml: unclosed',
      'utf8',
    );
    const brokenConfig = await provider.loadConfig(tmpDir);
    expect(brokenConfig).toEqual({});
  });

  test('ModelingFrameworkService aggregates custom granularities across projects and includes standard intervals', async () => {
    const service = new ModelingFrameworkService();

    const projA = path.join(tmpDir, 'projA');
    const projB = path.join(tmpDir, 'projB');
    await fs.promises.mkdir(projA);
    await fs.promises.mkdir(projB);

    await fs.promises.writeFile(
      path.join(projA, 'lightdash.config.yml'),
      'custom_granularities:\n  fiscal_quarter:\n    label: FQ\n',
    );
    await fs.promises.writeFile(
      path.join(projB, 'lightdash.config.yml'),
      'custom_granularities:\n  bi_weekly:\n    label: BW\n  fiscal_quarter:\n    label: FQ\n',
    );

    await service.loadProjectConfig(projA, 'dbt');
    await service.loadProjectConfig(projB, 'dbt');

    expect(service.getCustomGranularities()).toEqual([
      'bi_weekly',
      'fiscal_quarter',
    ]);

    const allIntervals = service.getAllTimeIntervals();
    expect(allIntervals).toContain('bi_weekly');
    expect(allIntervals).toContain('fiscal_quarter');
    expect(allIntervals).toContain('DAY');
    expect(allIntervals).toContain('MINUTE');
    expect(allIntervals).toContain('SECOND');
    expect(allIntervals).toContain('MILLISECOND');
    expect(allIntervals.length).toBe(
      STANDARD_LIGHTDASH_TIME_INTERVALS.length + 2,
    );
  });

  test('ModelingFrameworkService applies updated schema and notifies callback', async () => {
    const service = new ModelingFrameworkService();
    await fs.promises.writeFile(
      path.join(tmpDir, 'lightdash.config.yml'),
      'custom_granularities:\n  retail_season:\n    label: RS\n',
    );
    await service.loadProjectConfig(tmpDir, 'dbt');

    const schemasDir = path.join(tmpDir, 'schemas');
    let notifiedIntervals: string[] | undefined;

    await service.applyTimeIntervalsSchema(schemasDir, (intervals) => {
      notifiedIntervals = intervals;
    });

    expect(notifiedIntervals).toContain('retail_season');

    const writtenFile = path.join(
      schemasDir,
      'lightdash.time_interval.schema.json',
    );
    expect(fs.existsSync(writtenFile)).toBe(true);

    const schemaObj = JSON.parse(
      await fs.promises.readFile(writtenFile, 'utf8'),
    );
    expect(schemaObj.enum).toContain('retail_season');
    expect(schemaObj.enum).toContain('DAY');
  });

  test('Ajv validates model dimensions against dynamic time_interval schema', async () => {
    const service = new ModelingFrameworkService();
    await fs.promises.writeFile(
      path.join(tmpDir, 'lightdash.config.yml'),
      'custom_granularities:\n  fiscal_quarter:\n    label: FQ\n',
    );
    await service.loadProjectConfig(tmpDir, 'dbt');

    const ajv = new Ajv({ allErrors: true });
    const initialSchema = service.buildTimeIntervalsSchema();
    ajv.addSchema(initialSchema, 'lightdash.time_interval.schema.json');

    const dimensionSchema = {
      $id: 'dimension.schema.json',
      type: 'object',
      properties: {
        time_intervals: {
          anyOf: [
            { const: 'OFF' },
            {
              type: 'array',
              items: { $ref: 'lightdash.time_interval.schema.json' },
            },
          ],
        },
      },
    };
    ajv.addSchema(dimensionSchema, 'dimension.schema.json');

    const validate = ajv.getSchema('dimension.schema.json')!;

    // Standard intervals are valid
    expect(validate({ time_intervals: ['DAY', 'MONTH'] })).toBe(true);
    // Newly added standard built-in intervals are valid
    expect(
      validate({ time_intervals: ['MINUTE', 'SECOND', 'MILLISECOND'] }),
    ).toBe(true);
    // Discovered custom granularity is valid
    expect(validate({ time_intervals: ['DAY', 'fiscal_quarter'] })).toBe(true);
    // Literal OFF is valid
    expect(validate({ time_intervals: 'OFF' })).toBe(true);
    // Unregistered custom granularity is invalid (strict enum)
    expect(validate({ time_intervals: ['unregistered_grain'] })).toBe(false);
  });
});
