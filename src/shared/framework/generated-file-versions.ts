/**
 * DJ version in which each generated runtime file's content last changed,
 * keyed by output file name. The `# dj-generated:` header stamps this version
 * rather than the running DJ version, so identical content always carries an
 * identical header no matter which DJ release writes it.
 *
 * When a file's generated body changes, set its `version` to the current
 * `package.json` version and update `sha256` (SHA-256 of the body with LF line
 * endings). A guard test fails until both are updated.
 */
export const GENERATED_FILE_CONTENT_VERSIONS: Readonly<
  Record<string, { version: string; sha256: string }>
> = {
  '_config.py': {
    version: '2.5.1',
    sha256: 'ceba239dadb73d2f73e7b088ee03b7373681259eab263f652b27849c059b48d8',
  },
  '_trino_io.py': {
    version: '2.5.1',
    sha256: '4cbd29ebc5991efa4f95dd2d67addce88709d5323e2fe84794a5866000aa84cd',
  },
  '_model_tasks.py': {
    version: '2.5.1',
    sha256: '515de738bff3a22a52171d0d110ae8b672d04d5cac112cc58124b58ca9a76941',
  },
  'etl_helper.py': {
    version: '2.5.1',
    sha256: 'b078967dc20708fe2c469820eba58818cf652d1a1f3d57d96e970868c605dca5',
  },
  'kpo_factory.py': {
    version: '2.5.1',
    sha256: 'c7ad829ce81ff87ad577698b10a1d127aad5e0688c6394a1fd03a8f15dc12ce2',
  },
  'kpo_sizes.yml': {
    version: '2.5.1',
    sha256: '420b8bb1d4ca2b147696b6503c2b567785f027e6ac18c380945d7507423cfed2',
  },
};

/** Content version for a generated file name, if DJ tracks one. */
export function getGeneratedFileContentVersion(
  fileName: string,
): string | undefined {
  return Object.hasOwn(GENERATED_FILE_CONTENT_VERSIONS, fileName)
    ? GENERATED_FILE_CONTENT_VERSIONS[fileName].version
    : undefined;
}
