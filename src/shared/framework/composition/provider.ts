import type { CompositionRegistry } from './registry';
import { resolveModelComposition } from './resolve';
import type { ResolveOptions, ResolveResult } from './types';

export type CompositionRegistryProvider = (
  modelFilePath: string,
) => CompositionRegistry | undefined;

let registryProvider: CompositionRegistryProvider | undefined;

/**
 * Register how analysis code finds the registry for a model file (the
 * extension host maps a path to its dbt project's registry). Without a
 * provider, models are resolved against an empty registry.
 */
export function setCompositionRegistryProvider(
  provider: CompositionRegistryProvider | undefined,
): void {
  registryProvider = provider;
}

export function compositionRegistryFor(
  modelFilePath: string | undefined,
): CompositionRegistry | undefined {
  return modelFilePath ? registryProvider?.(modelFilePath) : undefined;
}

/**
 * Resolve an already-parsed model for analysis. `modelFilePath` picks the
 * project registry; pass the path of the `.model.json` the model came from
 * (or will be written to).
 */
export function resolveModelJson<TModel = Record<string, unknown>>(
  model: unknown,
  modelFilePath: string | undefined,
  options?: ResolveOptions,
): ResolveResult<TModel> {
  return resolveModelComposition<TModel>(
    model,
    compositionRegistryFor(modelFilePath),
    options,
  );
}
