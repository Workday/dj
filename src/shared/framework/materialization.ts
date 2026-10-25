import type {
  IncrementalStrategy,
  SchemaModelMaterialization,
} from '@shared/schema/types/model.materialization.schema';
import type { SchemaModelMaterialized } from '@shared/schema/types/model.materialized.schema';
import type { SchemaModelPartitionedBy } from '@shared/schema/types/model.partitioned_by.schema';

export type MaterializationTypeShorthand = SchemaModelMaterialized;

export const DEPRECATED_MATERIALIZATION_TOP_LEVEL_KEYS = [
  'materialized',
  'incremental_strategy',
  'partitioned_by',
] as const;

export type MaterializationExtras = Partial<
  Pick<
    Extract<SchemaModelMaterialization, { type: 'incremental' }>,
    'format' | 'database' | 'bucket' | 'sorted_by'
  >
>;

type MaterializationInput = {
  materialized?: MaterializationTypeShorthand;
  materialization?: SchemaModelMaterialization;
  incremental_strategy?: IncrementalStrategy;
  partitioned_by?: SchemaModelPartitionedBy;
};

export function getMaterializationType(
  model: MaterializationInput,
): MaterializationTypeShorthand | undefined {
  if (model.materialized) {
    return model.materialized;
  }
  const mat = model.materialization;
  if (!mat) {
    return undefined;
  }
  if (typeof mat === 'string') {
    return mat;
  }
  if (mat.type === 'incremental' || mat.type === 'ephemeral') {
    return mat.type;
  }
  return undefined;
}

export function getIncrementalStrategy(
  model: MaterializationInput,
): IncrementalStrategy | undefined {
  const mat = model.materialization;
  if (mat && typeof mat === 'object' && mat.type === 'incremental') {
    return mat.strategy;
  }
  return model.incremental_strategy;
}

export function getPartitions(
  model: MaterializationInput,
): SchemaModelPartitionedBy | undefined {
  const mat = model.materialization;
  if (mat && typeof mat === 'object' && mat.type === 'incremental') {
    return mat.partitions as SchemaModelPartitionedBy | undefined;
  }
  return model.partitioned_by;
}

export function pickMaterializationExtras(
  materialization: SchemaModelMaterialization | undefined,
): MaterializationExtras {
  if (!materialization || typeof materialization !== 'object') {
    return {};
  }
  if (materialization.type !== 'incremental') {
    return {};
  }
  const extras: MaterializationExtras = {};
  if (materialization.format !== undefined) {
    extras.format = materialization.format;
  }
  if (materialization.database !== undefined) {
    extras.database = materialization.database;
  }
  if (materialization.bucket !== undefined) {
    extras.bucket = materialization.bucket;
  }
  if (materialization.sorted_by !== undefined) {
    extras.sorted_by = materialization.sorted_by;
  }
  return extras;
}

function hasMaterializationExtras(extras: MaterializationExtras): boolean {
  return Object.keys(extras).length > 0;
}

function hasStrategy(strategy: IncrementalStrategy | undefined): boolean {
  return strategy !== undefined && strategy !== null;
}

function hasPartitions(
  partitions: SchemaModelPartitionedBy | undefined,
): boolean {
  return (
    partitions !== undefined &&
    Array.isArray(partitions) &&
    partitions.length > 0
  );
}

export function buildMaterializationForWizardOutput({
  type,
  strategy,
  partitions,
  extras = {},
}: {
  type?: MaterializationTypeShorthand;
  strategy?: IncrementalStrategy;
  partitions?: SchemaModelPartitionedBy;
  extras?: MaterializationExtras;
}): SchemaModelMaterialization | undefined {
  if (!type) {
    return undefined;
  }

  if (type === 'ephemeral') {
    if (hasMaterializationExtras(extras)) {
      return { type: 'ephemeral' };
    }
    return 'ephemeral';
  }

  const strategyPresent = hasStrategy(strategy);
  const partitionsPresent = hasPartitions(partitions);
  const extrasPresent = hasMaterializationExtras(extras);

  if (!strategyPresent && !partitionsPresent && !extrasPresent) {
    return 'incremental';
  }

  const incremental: Extract<
    SchemaModelMaterialization,
    { type: 'incremental' }
  > = {
    type: 'incremental',
    ...extras,
  };
  if (strategyPresent) {
    incremental.strategy = strategy;
  }
  if (partitionsPresent) {
    incremental.partitions = partitions;
  }
  return incremental;
}

/**
 * Normalize a create/preview request that may still carry legacy top-level fields.
 */
export function normalizeMaterializationFromLegacyRequest(
  request: MaterializationInput & {
    type?: MaterializationTypeShorthand;
    strategy?: IncrementalStrategy;
    partitions?: SchemaModelPartitionedBy;
    extras?: MaterializationExtras;
  },
): SchemaModelMaterialization | undefined {
  if (request.materialization) {
    const type = getMaterializationType(request);
    if (!type) {
      return request.materialization;
    }
    return buildMaterializationForWizardOutput({
      type,
      strategy: getIncrementalStrategy(request),
      partitions: getPartitions(request),
      extras: {
        ...pickMaterializationExtras(request.materialization),
        ...request.extras,
      },
    });
  }

  const type = request.type ?? getMaterializationType(request);
  if (!type) {
    return undefined;
  }

  return buildMaterializationForWizardOutput({
    type,
    strategy: request.strategy ?? getIncrementalStrategy(request),
    partitions: request.partitions ?? getPartitions(request),
    extras: request.extras ?? {},
  });
}

/**
 * Index at which a new `materialization` property should be inserted when
 * replacing a legacy `materialized` key. Falls back to appending.
 */
export function materializationInsertionIndex(properties: string[]): number {
  const idx = properties.indexOf('materialized');
  return idx >= 0 ? idx : properties.length;
}

export function deprecatedMaterializationNullSentinels(): Record<string, null> {
  return Object.fromEntries(
    DEPRECATED_MATERIALIZATION_TOP_LEVEL_KEYS.map((key) => [key, null]),
  );
}
