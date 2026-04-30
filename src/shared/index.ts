import * as _ from 'lodash';
import * as yaml from 'yaml';

import type { DefaultIncrementalStrategy } from './framework/types';
import type {
  AppError,
  DateIso,
  DistributiveOmit,
  LogLevel,
  RecursivePartial,
} from './types/common';

/**
 * Minimal DJ context for shared utilities.
 * Shared utilities only access a subset of config.
 * Extension uses the full CoderConfig from @services/types.
 */
export type DJ = {
  config: {
    aiHintTag?: string;
    lightdashDefaultPartitionColumnCaseSensitive?: boolean;
    materializationDefaultIncrementalStrategy?: DefaultIncrementalStrategy;
  };
};

const yamlParse = yaml.parse;
const yamlStringify = (obj: object) =>
  yaml.stringify(obj, { aliasDuplicateObjects: false });
export { yamlParse, yamlStringify };

export {
  applyEdits as jsoncApplyEdits,
  modify as jsoncModify,
  parse as jsonParse,
} from 'jsonc-parser';

/** Utility function to ensure we're handling all cases in switch statements */
export function assertExhaustive<T>(x: never, fallback?: any) {
  if (fallback !== undefined) {
    return fallback as T;
  }
  throw new Error(`Unexpected object: ${JSON.stringify(x)}`);
}

export function convertTemplate(
  template: string | undefined = '',
  values: Record<string, string | undefined>,
): string {
  let converted = template;
  const matches = template.matchAll(/{{ (\S+) }}/g);
  for (const match of matches) {
    const variable = match[1];
    const value = values[variable] ?? '';
    converted = converted.replace(`{{ ${variable} }}`, value);
  }
  return converted;
}

export function dateAddDays(date: Date, days: number): Date {
  const _date = new Date(date);
  _date.setDate(_date.getDate() + days);
  return _date;
}

export function dateAddDaysIso(dateIso: DateIso, days: number): DateIso {
  return dateToIso(dateAddDays(new Date(dateIso), days));
}

export function dateDiffDays(
  start: Date | DateIso,
  end: Date | DateIso,
): number {
  const days = Math.round(
    (new Date(end).getTime() - new Date(start).getTime()) /
      (1000 * 60 * 60 * 24),
  );
  return days;
}

export function dateToIso(date: Date): DateIso {
  const dateIso = date.toISOString().split('T')[0] as DateIso;
  return dateIso;
}

export function datetimeIso(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

export function isObject(item: any) {
  return (
    item && typeof item === 'object' && !Array.isArray(item) && item !== null
  );
}

export function mergeDeep<T extends Record<string, any>>(
  obj: T | null | undefined,
  add: RecursivePartial<T> | null | undefined,
): T {
  if (!obj && !add) {
    return {} as T;
  }
  if (obj && !add) {
    return { ...obj };
  }
  if (!obj && add) {
    return { ...add } as T;
  }
  let _obj = { ...obj } as T;
  for (const key in add) {
    const v = add[key] as T[keyof T];
    if (isObject(v)) {
      if (!_obj[key]) {
        _obj = { ..._obj, [key]: {} } as T;
      }
      _obj[key] = mergeDeep(_obj[key], v);
    } else {
      _obj = { ..._obj, [key]: v } as T;
    }
  }
  return _obj;
}

// Utility function to order keys within an object
export function orderKeys<T extends Record<string, any>>(
  obj?: T,
  order?: (keyof T)[],
): T {
  order = order ?? [];
  const remaining = _.difference(Object.keys(obj ?? {}), order).sort();
  order = [...order, ...remaining];
  let ordered: Record<string, any> = {};
  for (const key of order) {
    if (obj && key in obj) {
      ordered = { ...ordered, [key]: obj[key] };
    }
  }
  return ordered as T;
}

// Utility function to remove empty keys from an object
export function removeEmpty<T extends Record<string, any>>(_obj?: T): T {
  if (!isObject(_obj)) {
    return {} as T;
  }
  const obj = { ..._obj };
  for (const [k, v] of Object.entries(obj)) {
    if (
      (typeof v === 'object' && _.isEmpty(v)) ||
      _.isNil(v) ||
      v === '' ||
      v === false
    ) {
      if (obj) {
        delete obj[k];
      }
    }
  }
  return obj as T;
}

export function textToStartCase(text: string): string {
  return _.chain(text)
    .split('_')
    .map((s) => _.upperFirst(s))
    .join(' ')
    .trim()
    .value();
}

// Re-export types for convenience
export type { AppError, DateIso, DistributiveOmit, LogLevel, RecursivePartial };
