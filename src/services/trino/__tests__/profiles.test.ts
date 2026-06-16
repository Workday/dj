import { afterEach, describe, expect, it, jest } from '@jest/globals';

// Mock vscode before importing anything that pulls it in transitively.
// The profiles module only relies on `vscode.workspace.getConfiguration` for
// the (settings-bound) profile list + active-profile pointer, and
// `vscode.ConfigurationTarget.Workspace` as an enum constant. Stubbing those
// is enough for the pure-logic tests below.
jest.mock(
  'vscode',
  () => ({
    workspace: {
      getConfiguration: () => ({
        get: <T>(_key: string, fallback: T) => fallback,
        update: jest.fn(),
      }),
    },
    ConfigurationTarget: { Workspace: 2 },
  }),
  { virtual: true },
);

import {
  resolveProfileSecret,
  TrinoProfileError,
  validateProfile,
} from '@services/trino/profiles';
import type { TrinoProfile } from '@shared/trino/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function fakeContext(secret?: string): {
  secrets: { get: jest.Mock; store: jest.Mock; delete: jest.Mock };
} {
  return {
    secrets: {
      get: jest.fn(async () => secret),
      store: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
    },
  };
}

describe('validateProfile', () => {
  it('throws when the name is missing', () => {
    const p: TrinoProfile = {
      name: '',
      coordinatorUrl: 'https://x',
      user: 'u',
      authMethod: 'basic',
      authSource: 'secret-storage',
    };
    expect(() => validateProfile(p)).toThrow(TrinoProfileError);
  });

  it('throws when the coordinator URL is missing', () => {
    const p: TrinoProfile = {
      name: 'dev',
      coordinatorUrl: '',
      user: 'u',
      authMethod: 'basic',
      authSource: 'secret-storage',
    };
    expect(() => validateProfile(p)).toThrow(TrinoProfileError);
  });

  it('throws when the auth method is unknown', () => {
    const p = {
      name: 'dev',
      coordinatorUrl: 'https://x',
      user: 'u',
      authMethod: 'oauth-magic' as unknown as TrinoProfile['authMethod'],
      authSource: 'secret-storage' as const,
    } satisfies TrinoProfile;
    expect(() => validateProfile(p)).toThrow(TrinoProfileError);
  });

  it('accepts a well-formed profile', () => {
    const p: TrinoProfile = {
      name: 'dev',
      coordinatorUrl: 'https://x',
      user: 'u',
      authMethod: 'basic',
      authSource: 'secret-storage',
    };
    expect(() => validateProfile(p)).not.toThrow();
  });
});

describe('resolveProfileSecret', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns null for authMethod: "none"', async () => {
    const profile: TrinoProfile = {
      name: 'dev',
      coordinatorUrl: 'https://x',
      user: 'u',
      authMethod: 'none',
      authSource: 'secret-storage',
    };
    const ctx = fakeContext('ignored');
    const out = await resolveProfileSecret(ctx as never, profile);
    expect(out).toBeNull();
    expect(ctx.secrets.get).not.toHaveBeenCalled();
  });

  it('reads the secret from the OS keychain for secret-storage profiles', async () => {
    const profile: TrinoProfile = {
      name: 'dev',
      coordinatorUrl: 'https://x',
      user: 'u',
      authMethod: 'basic',
      authSource: 'secret-storage',
    };
    const ctx = fakeContext('top-secret');
    const out = await resolveProfileSecret(ctx as never, profile);
    expect(out).toBe('top-secret');
  });

  it('throws NO_SECRET when secret-storage profile has no stored value', async () => {
    const profile: TrinoProfile = {
      name: 'dev',
      coordinatorUrl: 'https://x',
      user: 'u',
      authMethod: 'basic',
      authSource: 'secret-storage',
    };
    const ctx = fakeContext(undefined);
    await expect(resolveProfileSecret(ctx as never, profile)).rejects.toThrow(
      TrinoProfileError,
    );
  });

  it('reads from process.env for env-var profiles', async () => {
    process.env.MY_TRINO_PROD_BEARER = 'abc-token';
    const profile: TrinoProfile = {
      name: 'prod',
      coordinatorUrl: 'https://x',
      user: 'u',
      authMethod: 'bearer',
      authSource: 'env-var',
      secretEnvVar: 'MY_TRINO_PROD_BEARER',
    };
    const out = await resolveProfileSecret(fakeContext() as never, profile);
    expect(out).toBe('abc-token');
  });

  it('throws AUTH_SOURCE_MISCONFIGURED when env-var profile is missing secretEnvVar', async () => {
    const profile: TrinoProfile = {
      name: 'prod',
      coordinatorUrl: 'https://x',
      user: 'u',
      authMethod: 'bearer',
      authSource: 'env-var',
    };
    await expect(
      resolveProfileSecret(fakeContext() as never, profile),
    ).rejects.toThrow(TrinoProfileError);
  });

  it('reads password-file content (trimmed of trailing newlines)', async () => {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dj-pw-'));
    const file = path.join(tmp, 'p.txt');
    try {
      await fs.promises.writeFile(file, 'file-secret\n', 'utf8');
      const profile: TrinoProfile = {
        name: 'staging',
        coordinatorUrl: 'https://x',
        user: 'u',
        authMethod: 'basic',
        authSource: 'password-file',
        passwordFilePath: file,
      };
      const out = await resolveProfileSecret(fakeContext() as never, profile);
      expect(out).toBe('file-secret');
    } finally {
      await fs.promises.rm(tmp, { recursive: true, force: true });
    }
  });

  it('throws NO_SECRET when password-file does not exist', async () => {
    const profile: TrinoProfile = {
      name: 'staging',
      coordinatorUrl: 'https://x',
      user: 'u',
      authMethod: 'basic',
      authSource: 'password-file',
      passwordFilePath: '/definitely/does/not/exist/dj-test.pw',
    };
    await expect(
      resolveProfileSecret(fakeContext() as never, profile),
    ).rejects.toThrow(TrinoProfileError);
  });
});
