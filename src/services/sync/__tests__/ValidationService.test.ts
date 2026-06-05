import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { AutoGenerateTestsConfig } from '@services/framework/utils';
import type { FrameworkModel } from '@shared/framework/types';
import type { Ajv } from 'ajv';

import { ValidationService } from '../ValidationService';

describe('ValidationService - targetFolders', () => {
  let mockAjv: Ajv | null;
  let mockLogger: any;
  let service: ValidationService;

  beforeEach(() => {
    mockAjv = null;
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    service = new ValidationService(mockAjv, undefined, mockLogger);
  });

  describe('isInTargetFolders (private method test via enhanceModelWithTests)', () => {
    const createJoinModel = (name: string): FrameworkModel =>
      ({
        type: 'int_join_models',
        name,
        group: 'test',
        topic: 'test',
        from: {
          model: 'base_model',
          join: [{ model: 'joined_model', type: 'left', on: { and: ['id'] } }],
        },
        select: [{ expr: '*', name: 'all', type: 'dim' }],
      }) as unknown as FrameworkModel;

    const createConfig = (
      targetFolders?: string[],
    ): AutoGenerateTestsConfig => ({
      tests: {
        equalRowCount: {
          enabled: true,
          applyTo: ['left'],
          ...(targetFolders !== undefined && { targetFolders }),
        },
      },
    });

    const testPath = (relativePath: string) =>
      `/project/dags/dbt/${relativePath}/test_model.model.json`;

    test.each([
      {
        name: 'should add tests when model is in targetFolder',
        targetFolders: ['models/intermediate/analytics'],
        modelPath: 'models/intermediate/analytics',
        expectedTests: 1,
      },
      {
        name: 'should NOT add tests when model is outside targetFolder',
        targetFolders: ['models/intermediate/analytics'],
        modelPath: 'models/intermediate/other',
        expectedTests: 0,
      },
      {
        name: 'should NOT add tests when targetFolders is empty (disabled)',
        targetFolders: [],
        modelPath: 'models/anywhere',
        expectedTests: 0,
      },
      {
        name: 'should match nested paths within targetFolder',
        targetFolders: ['models/intermediate'],
        modelPath: 'models/intermediate/analytics/subdir',
        expectedTests: 1,
      },
      {
        name: 'should NOT match sibling folders with similar names',
        targetFolders: ['models/intermediate/analytics'],
        modelPath: 'models/intermediate/analytics_v2',
        expectedTests: 0,
      },
    ])('$name', ({ targetFolders, modelPath, expectedTests }) => {
      const result = service.enhanceModelWithTests({
        modelJson: createJoinModel('test_model'),
        config: createConfig(targetFolders),
        pathJson: testPath(modelPath),
        projectPath: '/project/dags/dbt',
      });

      expect(result.testsAdded).toBe(expectedTests);
      if (expectedTests > 0) {
        expect((result.modelJson as any).data_tests).toHaveLength(
          expectedTests,
        );
      } else {
        expect((result.modelJson as any).data_tests).toBeUndefined();
      }
    });

    test('should NOT add tests when targetFolders is not configured (disabled)', () => {
      const result = service.enhanceModelWithTests({
        modelJson: createJoinModel('test_model'),
        config: createConfig(),
        pathJson: testPath('models/anywhere'),
        projectPath: '/project/dags/dbt',
      });

      expect(result.testsAdded).toBe(0);
      expect((result.modelJson as any).data_tests).toBeUndefined();
    });

    test('should handle multiple targetFolders correctly', () => {
      const config = createConfig([
        'models/intermediate/analytics',
        'models/marts/finance',
      ]);

      const cases = [
        { path: 'models/intermediate/analytics', expected: 1 },
        { path: 'models/marts/finance', expected: 1 },
        { path: 'models/staging', expected: 0 },
      ];

      cases.forEach(({ path, expected }) => {
        const result = service.enhanceModelWithTests({
          modelJson: createJoinModel('test_model'),
          config,
          pathJson: testPath(path),
          projectPath: '/project/dags/dbt',
        });
        expect(result.testsAdded).toBe(expected);
      });
    });

    test('should combine targetFolders from multiple test types', () => {
      const model = createJoinModel('test_model');
      const config: AutoGenerateTestsConfig = {
        tests: {
          equalRowCount: {
            enabled: true,
            applyTo: ['left'],
            targetFolders: ['models/intermediate/analytics'],
          },
          equalOrLowerRowCount: {
            enabled: true,
            applyTo: ['inner'],
            targetFolders: ['models/marts/finance'],
          },
        },
      };

      // Should match equalRowCount targetFolder
      const result1 = service.enhanceModelWithTests({
        modelJson: model,
        config,
        pathJson:
          '/project/dags/dbt/models/intermediate/analytics/test_model.model.json',
        projectPath: '/project/dags/dbt',
      });

      expect(result1.testsAdded).toBe(1);

      // Should match equalOrLowerRowCount targetFolder
      const result2 = service.enhanceModelWithTests({
        modelJson: createJoinModel('test_model_2'),
        config,
        pathJson:
          '/project/dags/dbt/models/marts/finance/test_model.model.json',
        projectPath: '/project/dags/dbt',
      });

      expect(result2.testsAdded).toBe(1);
    });
  });

  describe('enhanceModelWithTests - existing behavior', () => {
    test('should NOT add tests for non-join models', () => {
      const model: FrameworkModel = {
        type: 'int_select_model',
        name: 'test_model',
        group: 'test',
        topic: 'test',
        from: { model: 'base_model' },
        select: [{ expr: '*' }],
      } as unknown as FrameworkModel;

      const config: AutoGenerateTestsConfig = {
        tests: {
          equalRowCount: {
            enabled: true,
            applyTo: ['left'],
          },
        },
      };

      const result = service.enhanceModelWithTests({
        modelJson: model,
        config,
      });

      expect(result.testsAdded).toBe(0);
      expect((result.modelJson as any).data_tests).toBeUndefined();
    });

    test('should NOT add tests if model already has tests', () => {
      const model: FrameworkModel = {
        type: 'int_join_models',
        name: 'test_model',
        group: 'test',
        topic: 'test',
        from: {
          model: 'base_model',
          join: [
            {
              model: 'joined_model',
              type: 'left',
              on: { and: ['id'] },
            },
          ],
        },
        select: [{ expr: '*' }],
        data_tests: [
          {
            type: 'equal_row_count',
            compare_model: "ref('base_model')",
            join_type: 'left',
          },
        ],
      } as unknown as FrameworkModel;

      const config: AutoGenerateTestsConfig = {
        tests: {
          equalRowCount: {
            enabled: true,
            applyTo: ['left'],
          },
        },
      };

      const result = service.enhanceModelWithTests({
        modelJson: model,
        config,
      });

      expect(result.testsAdded).toBe(0);
      expect((result.modelJson as any).data_tests).toHaveLength(1);
    });

    test('should NOT add tests if no matching join type', () => {
      const model: FrameworkModel = {
        type: 'int_join_models',
        name: 'test_model',
        group: 'test',
        topic: 'test',
        from: {
          model: 'base_model',
          join: [
            {
              model: 'joined_model',
              type: 'inner',
              on: { and: ['id'] },
            },
          ],
        },
        select: [{ expr: '*' }],
      } as unknown as FrameworkModel;

      const config: AutoGenerateTestsConfig = {
        tests: {
          equalRowCount: {
            enabled: true,
            applyTo: ['left'],
          },
        },
      };

      const result = service.enhanceModelWithTests({
        modelJson: model,
        config,
      });

      expect(result.testsAdded).toBe(0);
      expect((result.modelJson as any).data_tests).toBeUndefined();
    });
  });
});
