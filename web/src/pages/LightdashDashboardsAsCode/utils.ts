import type { LightdashYamlNode } from '@shared/lightdash/types';

/** Strip path/extension noise to get a chart/dashboard slug. */
export function pathToSlug(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.ya?ml$/i, '');
}

/** Recursively flatten a YAML directory tree into a flat list of file nodes. */
export function flattenFiles(nodes: LightdashYamlNode[]): LightdashYamlNode[] {
  const out: LightdashYamlNode[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      out.push(node);
    } else if (node.children) {
      out.push(...flattenFiles(node.children));
    }
  }
  return out;
}

/**
 * Partition a list of workspace-relative YAML paths into chart slugs and
 * dashboard slugs based on whether they live under a `charts/` or
 * `dashboards/` segment. Paths that match neither bucket are dropped.
 */
export function partitionLocalPaths(paths: string[]): {
  chartSlugs: string[];
  dashboardSlugs: string[];
} {
  const chartSlugs: string[] = [];
  const dashboardSlugs: string[] = [];
  for (const filePath of paths) {
    const slug = pathToSlug(filePath);
    if (filePath.includes('/dashboards/')) {
      dashboardSlugs.push(slug);
    } else if (filePath.includes('/charts/')) {
      chartSlugs.push(slug);
    }
  }
  return { chartSlugs, dashboardSlugs };
}
