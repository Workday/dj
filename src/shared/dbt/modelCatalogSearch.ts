import type { DbtModel } from '@shared/dbt/types';
import * as fs from 'fs';

export type DbtModelSummary = {
  name: string;
  path: string;
  type?: string;
  group?: string;
  topic?: string;
  tags?: string[];
  materialization?: string;
  lightdashTableLabel?: string;
  hasLightdashExplore?: boolean;
  fromModel?: string;
};

export type ModelSearchFilters = {
  pattern?: string;
  topic?: string;
  group?: string;
  tags?: string[];
  fromModel?: string;
  requireLightdashExploreTag?: boolean;
};

type ParsedModelJson = {
  type?: string;
  group?: string;
  topic?: string;
  name?: string;
  tags?: string[];
  materialization?: string | { type?: string };
  materialized?: string;
  from?: { model?: string; source?: string; union?: unknown };
  lightdash?: { table?: { label?: string } };
};

function globPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexBody = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(regexBody, 'i');
}

function matchesPattern(text: string, pattern?: string): boolean {
  if (!pattern || pattern.trim() === '') {
    return true;
  }
  const p = pattern.trim();
  if (p.includes('*') || p.includes('?')) {
    return globPatternToRegExp(p).test(text);
  }
  return text.toLowerCase().includes(p.toLowerCase());
}

function resolveMaterialization(json: ParsedModelJson): string | undefined {
  if (typeof json.materialization === 'string') {
    return json.materialization;
  }
  if (
    json.materialization &&
    typeof json.materialization === 'object' &&
    typeof json.materialization.type === 'string'
  ) {
    return json.materialization.type;
  }
  return json.materialized;
}

function readModelJsonSummary(modelJsonPath: string): ParsedModelJson | null {
  try {
    const raw = fs.readFileSync(modelJsonPath, 'utf-8');
    return JSON.parse(raw) as ParsedModelJson;
  } catch {
    return null;
  }
}

function extractFromModel(json: ParsedModelJson): string | undefined {
  if (json.from && typeof json.from.model === 'string') {
    return json.from.model;
  }
  return undefined;
}

function modelTags(json: ParsedModelJson): string[] {
  return Array.isArray(json.tags) ? json.tags.map(String) : [];
}

export function summarizeModelFromPaths(
  model: DbtModel,
  modelJsonPath: string,
  parsed: ParsedModelJson | null,
): DbtModelSummary {
  const json = parsed ?? {};
  const tags = modelTags(json);
  const exploreTag = tags.some(
    (t) => t === 'lightdash-explore' || t === 'lightdash',
  );
  return {
    name: model.name,
    path: modelJsonPath,
    type: json.type,
    group: json.group,
    topic: json.topic,
    tags: tags.length ? tags : model.tags,
    materialization:
      resolveMaterialization(json) ??
      (model as { config?: { materialized?: string } }).config?.materialized,
    lightdashTableLabel: json.lightdash?.table?.label,
    hasLightdashExplore: exploreTag,
    fromModel: extractFromModel(json),
  };
}

export function matchesModelSearchFilters(
  summary: DbtModelSummary,
  filters: ModelSearchFilters,
): boolean {
  if (filters.topic && summary.topic !== filters.topic) {
    return false;
  }
  if (filters.group && summary.group !== filters.group) {
    return false;
  }
  if (filters.fromModel && summary.fromModel !== filters.fromModel) {
    return false;
  }
  if (
    filters.requireLightdashExploreTag &&
    !summary.hasLightdashExplore
  ) {
    return false;
  }
  if (filters.tags?.length) {
    const tagSet = new Set(summary.tags ?? []);
    if (!filters.tags.every((t) => tagSet.has(t))) {
      return false;
    }
  }
  if (
    filters.pattern &&
    !matchesPattern(summary.name, filters.pattern) &&
    !(summary.lightdashTableLabel &&
      matchesPattern(summary.lightdashTableLabel, filters.pattern))
  ) {
    return false;
  }
  return true;
}

export function buildModelSummariesForProject(
  models: Iterable<DbtModel>,
  projectPathPrefix: string,
): DbtModelSummary[] {
  const summaries: DbtModelSummary[] = [];
  for (const model of models) {
    if (!model.pathSystemDirectory.startsWith(projectPathPrefix)) {
      continue;
    }
    const modelJsonPath = model.pathSystemFile.replace(/\.sql$/, '.model.json');
    const parsed = fs.existsSync(modelJsonPath)
      ? readModelJsonSummary(modelJsonPath)
      : null;
    summaries.push(summarizeModelFromPaths(model, modelJsonPath, parsed));
  }
  return summaries;
}

export type SimilarModelScore = DbtModelSummary & { score: number };

export function rankSimilarModels(
  summaries: DbtModelSummary[],
  anchor: {
    fromModel?: string;
    group?: string;
    topic?: string;
    tags?: string[];
    excludeName?: string;
  },
  limit = 20,
): SimilarModelScore[] {
  const anchorTags = new Set(anchor.tags ?? []);
  const scored: SimilarModelScore[] = [];

  for (const summary of summaries) {
    if (anchor.excludeName && summary.name === anchor.excludeName) {
      continue;
    }
    let score = 0;
    if (anchor.fromModel && summary.fromModel === anchor.fromModel) {
      score += 10;
    }
    if (anchor.topic && summary.topic === anchor.topic) {
      score += 5;
    }
    if (anchor.group && summary.group === anchor.group) {
      score += 3;
    }
    for (const tag of summary.tags ?? []) {
      if (anchorTags.has(tag)) {
        score += 1;
      }
    }
    if (score > 0) {
      scored.push({ ...summary, score });
    }
  }

  scored.sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );
  return scored.slice(0, limit);
}
