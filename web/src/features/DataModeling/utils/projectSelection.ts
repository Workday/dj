/**
 * Pick the dbt project a model belongs to. Without a project name (a model
 * still being created) the first project is used; with one, only the project
 * of that name matches, so a multi-project workspace never reads another
 * project's manifest.
 */
export function pickModelProject<T extends { name: string }>(
  projects: T[],
  projectName: string | null | undefined,
): T | undefined {
  if (!projectName) {
    return projects[0];
  }
  return projects.find((project) => project.name === projectName);
}
