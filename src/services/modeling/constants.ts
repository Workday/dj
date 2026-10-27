/**
 * Standard built-in Lightdash time intervals.
 */
export const STANDARD_LIGHTDASH_TIME_INTERVALS = [
  'DAY',
  'DAY_OF_WEEK_INDEX',
  'DAY_OF_WEEK_NAME',
  'DAY_OF_MONTH_NUM',
  'DAY_OF_YEAR_NUM',
  'HOUR',
  'MILLISECOND',
  'MINUTE',
  'MONTH',
  'MONTH_NAME',
  'MONTH_NUM',
  'QUARTER',
  'QUARTER_NAME',
  'QUARTER_NUM',
  'RAW',
  'SECOND',
  'WEEK',
  'WEEK_NUM',
  'YEAR',
  'YEAR_NUM',
] as const;

export type StandardLightdashTimeInterval =
  (typeof STANDARD_LIGHTDASH_TIME_INTERVALS)[number];
