export {
  type CompositionDetail,
  compositionHeader,
  compositionIssuesToDetails,
  mapDetailsToModelFile,
} from './diagnostics';
export { diffAgainstTemplate } from './diff';
export {
  cloneJson,
  hashText,
  instancePathToJsonPath,
  jsonEqual,
  jsonPathToInstancePath,
} from './json';
export {
  compositionRegistryFor,
  type CompositionRegistryProvider,
  resolveModelJson,
  setCompositionRegistryProvider,
} from './provider';
export {
  CompositionRegistry,
  FRAGMENT_FILE_SUFFIX,
  type LookupResult,
  sharedFileKindForPath,
  TEMPLATE_FILE_SUFFIX,
} from './registry';
export {
  COMPOSITION_AUTHORING_KEYS,
  cteIdentity,
  FRAGMENT_SELECT_TYPES,
  isFragmentSelect,
  mapResolvedPath,
  resolveModelComposition,
  selectItemIdentity,
  usesComposition,
} from './resolve';
export type * from './types';
