import type { SessionState } from './types';

let session: SessionState = { mode: 'unset' };

export function getSession(): SessionState {
  return { ...session };
}

export function setCatalogSession(projectId: string): SessionState {
  session = {
    mode: 'catalog',
    activeProjectId: projectId,
    activeLocalPath: undefined,
  };
  return getSession();
}

export function setLocalSession(localPath: string): SessionState {
  session = {
    mode: 'local',
    activeProjectId: undefined,
    activeLocalPath: localPath,
  };
  return getSession();
}

export function clearSession(): SessionState {
  session = { mode: 'unset' };
  return getSession();
}
