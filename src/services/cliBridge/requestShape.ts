/**
 * Pre-flight validation for CLI payloads that map to framework APIs expecting
 * `{ projectName?, modelJson, … }` — not the flat body used by `model.create`.
 */

const PAYLOAD_DOC =
  'See templates/skills/dj-cli/references/command-catalog.md or examples/model-*.request.json';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function looksLikeFlatModelCreatePayload(
  request: Record<string, unknown>,
): boolean {
  return (
    !('modelJson' in request) &&
    typeof request.type === 'string' &&
    typeof request.group === 'string'
  );
}

function looksLikeRawModelJsonBody(request: Record<string, unknown>): boolean {
  return (
    !('modelJson' in request) &&
    !('originalModelPath' in request) &&
    (('from' in request && request.from !== undefined) ||
      ('select' in request && request.select !== undefined))
  );
}

function hintForMissingModelJson(
  op: string,
  request: Record<string, unknown>,
): string {
  if (looksLikeFlatModelCreatePayload(request)) {
    return ` Payload looks like model.create (flat type/group/…); wrap the model fields in "modelJson".`;
  }
  if (looksLikeRawModelJsonBody(request)) {
    return ` Payload looks like a raw .model.json file; use the ${op} envelope with "modelJson".`;
  }
  return '';
}

function assertModelJsonObject(
  op: string,
  request: Record<string, unknown>,
): Record<string, unknown> {
  const modelJson = request.modelJson;
  if (!isPlainObject(modelJson)) {
    const hint = hintForMissingModelJson(op, request);
    throw new Error(
      `${op}: missing or invalid "modelJson" (must be a JSON object). Expected { "modelJson": { … } }${hint} ${PAYLOAD_DOC}`,
    );
  }
  return modelJson;
}

/** `model.preview` / `model.cte-analysis` */
export function assertWrappedModelJsonPayload(
  op: string,
  request: Record<string, unknown>,
): void {
  assertModelJsonObject(op, request);
}

/**
 * If the caller sent a flat model.create body to preview/exists, wrap it.
 * Mutates nothing — returns a new request object when wrapping is needed.
 */
export function normalizeWrappedModelRequest(
  request: Record<string, unknown>,
): Record<string, unknown> {
  if (
    !('modelJson' in request) &&
    looksLikeFlatModelCreatePayload(request)
  ) {
    const { projectName, ...modelFields } = request;
    return {
      ...(typeof projectName === 'string' ? { projectName } : {}),
      modelJson: modelFields,
    };
  }
  if (
    !('modelJson' in request) &&
    looksLikeRawModelJsonBody(request)
  ) {
    const { projectName, ...modelFields } = request;
    return {
      ...(typeof projectName === 'string' ? { projectName } : {}),
      modelJson: modelFields,
    };
  }
  return request;
}

/** `framework-check-model-exists` */
export function assertModelExistsPayload(
  request: Record<string, unknown>,
): void {
  const modelJson = assertModelJsonObject('model.exists', request);
  for (const key of ['type', 'group', 'topic', 'name'] as const) {
    if (typeof modelJson[key] !== 'string' || modelJson[key] === '') {
      throw new Error(
        `model.exists: modelJson.${key} must be a non-empty string. ${PAYLOAD_DOC}`,
      );
    }
  }
}

/** `framework-model-update` */
export function assertModelUpdatePayload(
  request: Record<string, unknown>,
): void {
  if (Array.isArray(request.modelJson)) {
    throw new Error(
      `model.update: "modelJson" must be a JSON object, not an array. ${PAYLOAD_DOC}`,
    );
  }
  const path = request.originalModelPath;
  const hasPath =
    typeof path === 'string' && path.trim() !== '';
  const hasModelJson = isPlainObject(request.modelJson);
  const hasModelName =
    typeof request.modelName === 'string' && request.modelName.trim() !== '';

  if ((!hasPath && !hasModelName) || !hasModelJson) {
    let hint = '';
    if (
      typeof request.modelName === 'string' &&
      request.modelName !== '' &&
      !hasPath
    ) {
      hint =
        ' Use "originalModelPath" (absolute path to the .model.json) or "modelName" (resolved within projectName) plus "modelJson".';
    } else if (looksLikeRawModelJsonBody(request) || looksLikeFlatModelCreatePayload(request)) {
      hint =
        ' Do not pass a raw .model.json file as the whole payload; use { "originalModelPath": "<path>", "modelJson": { … } }.';
    }
    throw new Error(
      `model.update: missing originalModelPath and/or modelJson. Expected { "originalModelPath": "<abs path to .model.json>" OR "modelName": "<dbt model name>", "modelJson": { … } }.${hint} ${PAYLOAD_DOC}`,
    );
  }
}

const DBT_COMPILE_ALLOWED_KEYS = new Set([
  'projectName',
  'modelName',
  'select',
  'modelNames',
]);

export type NormalizedDbtCompileRequest = {
  projectName?: string;
  modelName?: string;
  select?: string;
};

export function assertNonEmptyModelName(
  op: string,
  request: Record<string, unknown>,
  example = 'examples/model-lineage.request.json',
): void {
  const modelName = request.modelName;
  if (typeof modelName !== 'string' || modelName.trim() === '') {
    throw new Error(
      `${op}: requires non-empty "modelName". Use --file ${example} or --modelName <name>. ${PAYLOAD_DOC}`,
    );
  }
}

export function assertQueryExecutePayload(
  request: Record<string, unknown> | null,
): void {
  if (!request || typeof request !== 'object') {
    throw new Error(
      `query.execute: requires a JSON payload with "sql". Use --file examples/query-execute.request.json or --sql 'SELECT …'. ${PAYLOAD_DOC}`,
    );
  }
  const sql = request.sql;
  if (typeof sql !== 'string' || sql.trim() === '') {
    throw new Error(
      `query.execute: requires non-empty "sql". Use --file examples/query-execute.request.json or --sql 'SELECT …'. ${PAYLOAD_DOC}`,
    );
  }
}

/**
 * Validates and normalizes `dbt.compile` / `dbt.compile-logs` payloads.
 * Requires `modelName` or `select` (dbt selector string). Rejects unknown keys.
 */
export function normalizeDbtCompileRequest(
  op: string,
  request: Record<string, unknown>,
): NormalizedDbtCompileRequest {
  const working = { ...request };

  if ('modelNames' in working && working.modelNames !== undefined) {
    const mn = working.modelNames;
    if (Array.isArray(mn)) {
      const names = mn.filter((n) => typeof n === 'string' && n.trim() !== '');
      if (names.length === 1) {
        working.modelName = names[0];
      } else if (names.length > 1) {
        throw new Error(
          `${op}: use "select": "${names.join(' ')}" for multiple models, not a modelNames array. Or pass one modelName. ${PAYLOAD_DOC}`,
        );
      }
    } else if (typeof mn === 'string' && mn.trim() !== '') {
      working.select = mn.trim();
    }
    delete working.modelNames;
  }

  const allowedAfterNormalize = new Set([
    'projectName',
    'modelName',
    'select',
  ]);
  const unknown = Object.keys(working).filter(
    (k) => !allowedAfterNormalize.has(k),
  );
  if (unknown.length > 0) {
    throw new Error(
      `${op}: unknown key(s): ${unknown.join(', ')}. Allowed: projectName, modelName, select. Use "select" for a raw dbt selector (e.g. "mart__a mart__b"); use "modelName" for a single model. ${PAYLOAD_DOC}`,
    );
  }

  const modelName =
    typeof working.modelName === 'string' && working.modelName.trim() !== ''
      ? working.modelName.trim()
      : undefined;
  const select =
    typeof working.select === 'string' && working.select.trim() !== ''
      ? working.select.trim()
      : undefined;

  if (!modelName && !select) {
    throw new Error(
      `${op}: requires non-empty "modelName" or "select". ${PAYLOAD_DOC}`,
    );
  }

  const projectName =
    typeof working.projectName === 'string' &&
    working.projectName.trim() !== ''
      ? working.projectName.trim()
      : undefined;

  return {
    ...(projectName ? { projectName } : {}),
    ...(modelName ? { modelName } : {}),
    ...(select ? { select } : {}),
  };
}

/** Human-readable label for compile success messages. */
export function dbtCompileTargetLabel(
  request: NormalizedDbtCompileRequest,
): string {
  if (request.select) {
    return `selector "${request.select}"`;
  }
  return `model ${request.modelName}`;
}
