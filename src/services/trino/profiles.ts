/**
 * Trino connection profile management.
 *
 * Profiles are non-secret connection metadata stored in workspace settings
 * (`dj.trino.profiles`). The active profile is picked via
 * `dj.trino.activeProfile`. Secrets are NEVER stored in settings.json — they
 * resolve at request time from one of four sources:
 *
 *  1. `secret-storage` (default) — VS Code SecretStorage (OS keychain).
 *  2. `env-var`            — process.env[profile.secretEnvVar] at request time.
 *  3. `password-file`      — read profile.passwordFilePath at request time.
 *  4. `dbt-profile`        — parse ~/.dbt/profiles.yml for password / jwt_token.
 *
 * Headless-Linux / no-libsecret hosts: SecretStorage may return null. The
 * resolver throws a typed error suggesting the user switch the profile to
 * one of the file-based / env-based tiers.
 */

import type { TrinoAuthMethod, TrinoProfile } from '@shared/trino/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { parse as yamlParse } from 'yaml';

const SETTINGS_KEY = 'dj.trino';
const SECRET_NS = 'dj.trino';

export class TrinoProfileError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NO_PROFILES'
      | 'NO_ACTIVE_PROFILE'
      | 'UNKNOWN_PROFILE'
      | 'NO_SECRET'
      | 'AUTH_SOURCE_MISCONFIGURED'
      | 'KEYCHAIN_UNAVAILABLE'
      | 'DBT_PROFILE_NOT_FOUND',
  ) {
    super(message);
    this.name = 'TrinoProfileError';
  }
}

/**
 * Read all profiles from workspace settings (`dj.trino.profiles`).
 */
export function listProfiles(): TrinoProfile[] {
  const cfg = vscode.workspace.getConfiguration();
  const profiles = cfg.get<TrinoProfile[]>(`${SETTINGS_KEY}.profiles`, []);
  return Array.isArray(profiles) ? profiles : [];
}

export function getActiveProfileName(): string | null {
  const cfg = vscode.workspace.getConfiguration();
  const name = cfg.get<string>(`${SETTINGS_KEY}.activeProfile`, '').trim();
  return name || null;
}

/**
 * Resolve the active profile, falling back to the first profile in the list
 * when `activeProfile` is unset. Returns null if no profiles are configured —
 * callers decide whether that's a hard error or fall-through to CLI mode.
 */
export function getActiveProfile(): TrinoProfile | null {
  const profiles = listProfiles();
  if (profiles.length === 0) {
    return null;
  }
  const activeName = getActiveProfileName();
  if (activeName) {
    const found = profiles.find((p) => p.name === activeName);
    if (found) {
      return found;
    }
  }
  return profiles[0];
}

export function getProfileByName(name: string): TrinoProfile | null {
  return listProfiles().find((p) => p.name === name) ?? null;
}

/**
 * Save or overwrite a profile in workspace settings. If `previousName` is
 * supplied and differs from `profile.name`, this is treated as a rename and
 * the old entry is removed (and any associated secrets are migrated).
 *
 * Does NOT touch secrets — credentials always flow through
 * `storeSecret(...)` which writes to SecretStorage.
 */
export async function upsertProfile(
  context: vscode.ExtensionContext,
  profile: TrinoProfile,
  previousName?: string,
): Promise<void> {
  validateProfile(profile);

  const cfg = vscode.workspace.getConfiguration();
  const existing = listProfiles();

  let next: TrinoProfile[];
  if (previousName && previousName !== profile.name) {
    next = existing.filter(
      (p) => p.name !== previousName && p.name !== profile.name,
    );
    next.push(profile);
    await migrateSecrets(context, previousName, profile.name);
  } else {
    next = existing.filter((p) => p.name !== profile.name);
    next.push(profile);
  }

  await cfg.update(
    `${SETTINGS_KEY}.profiles`,
    next,
    vscode.ConfigurationTarget.Workspace,
  );
}

export async function deleteProfile(
  context: vscode.ExtensionContext,
  name: string,
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  const remaining = listProfiles().filter((p) => p.name !== name);
  await cfg.update(
    `${SETTINGS_KEY}.profiles`,
    remaining,
    vscode.ConfigurationTarget.Workspace,
  );
  // Clear any secrets associated with the deleted profile.
  for (const kind of ['password', 'bearerToken'] as const) {
    await context.secrets.delete(secretKey(name, kind));
  }
  // If the deleted profile was the active one, clear the pointer.
  if (getActiveProfileName() === name) {
    await cfg.update(
      `${SETTINGS_KEY}.activeProfile`,
      '',
      vscode.ConfigurationTarget.Workspace,
    );
  }
}

export async function setActiveProfile(name: string): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  await cfg.update(
    `${SETTINGS_KEY}.activeProfile`,
    name,
    vscode.ConfigurationTarget.Workspace,
  );
}

/**
 * Store a secret in VS Code SecretStorage, keyed per-profile. Callers pass
 * the secret in via the API message bus; this helper never reads from
 * settings.json.
 */
export async function storeSecret(
  context: vscode.ExtensionContext,
  profileName: string,
  kind: 'password' | 'bearerToken',
  value: string,
): Promise<void> {
  await context.secrets.store(secretKey(profileName, kind), value);
}

/**
 * Resolve the secret string for a profile based on its `authSource` tier.
 * Returns `null` for `authMethod: 'none'`. Throws TrinoProfileError on any
 * fixable misconfiguration (e.g. missing env var, unreadable password file).
 */
export async function resolveProfileSecret(
  context: vscode.ExtensionContext,
  profile: TrinoProfile,
): Promise<string | null> {
  if (profile.authMethod === 'none') {
    return null;
  }

  switch (profile.authSource) {
    case 'secret-storage': {
      const kind: 'password' | 'bearerToken' =
        profile.authMethod === 'bearer' ? 'bearerToken' : 'password';
      let secret: string | undefined;
      try {
        secret = await context.secrets.get(secretKey(profile.name, kind));
      } catch (err: unknown) {
        // libsecret/keyring not installed (Linux headless). Surface a
        // helpful error pointing the user at the env-var / password-file
        // tiers instead of bubbling the cryptic underlying error.
        throw new TrinoProfileError(
          `Could not access OS keychain for profile "${profile.name}". On headless Linux hosts, switch the profile authSource to "env-var" or "password-file". Underlying error: ${formatErr(err)}`,
          'KEYCHAIN_UNAVAILABLE',
        );
      }
      if (!secret) {
        throw new TrinoProfileError(
          `No saved credential for profile "${profile.name}". Run "DJ: Set Trino Credentials" to store a password or bearer token in SecretStorage.`,
          'NO_SECRET',
        );
      }
      return secret;
    }
    case 'env-var': {
      if (!profile.secretEnvVar) {
        throw new TrinoProfileError(
          `Profile "${profile.name}" has authSource="env-var" but no secretEnvVar configured.`,
          'AUTH_SOURCE_MISCONFIGURED',
        );
      }
      const value = process.env[profile.secretEnvVar];
      if (!value) {
        throw new TrinoProfileError(
          `Environment variable "${profile.secretEnvVar}" is unset for profile "${profile.name}".`,
          'NO_SECRET',
        );
      }
      return value;
    }
    case 'password-file': {
      if (!profile.passwordFilePath) {
        throw new TrinoProfileError(
          `Profile "${profile.name}" has authSource="password-file" but no passwordFilePath configured.`,
          'AUTH_SOURCE_MISCONFIGURED',
        );
      }
      const expanded = expandTilde(profile.passwordFilePath);
      try {
        const raw = await fs.promises.readFile(expanded, 'utf8');
        // Trim trailing newlines that file editors love to append.
        return raw.replace(/\r?\n$/, '');
      } catch (err: unknown) {
        throw new TrinoProfileError(
          `Failed to read password file "${expanded}" for profile "${profile.name}": ${formatErr(err)}`,
          'NO_SECRET',
        );
      }
    }
    case 'dbt-profile': {
      if (!profile.dbtProfile) {
        throw new TrinoProfileError(
          `Profile "${profile.name}" has authSource="dbt-profile" but no dbtProfile configured.`,
          'AUTH_SOURCE_MISCONFIGURED',
        );
      }
      return resolveDbtProfileSecret(profile);
    }
    default: {
      throw new TrinoProfileError(
        `Unknown authSource for profile "${profile.name}".`,
        'AUTH_SOURCE_MISCONFIGURED',
      );
    }
  }
}

/**
 * Parse `~/.dbt/profiles.yml` looking for `outputs.<target>.password` or
 * `password_file` or `jwt_token` for the configured dbt profile name.
 */
async function resolveDbtProfileSecret(profile: TrinoProfile): Promise<string> {
  const profilesPath = path.join(os.homedir(), '.dbt', 'profiles.yml');
  let raw: string;
  try {
    raw = await fs.promises.readFile(profilesPath, 'utf8');
  } catch (err: unknown) {
    throw new TrinoProfileError(
      `Could not read dbt profiles file at "${profilesPath}": ${formatErr(err)}`,
      'DBT_PROFILE_NOT_FOUND',
    );
  }
  let parsed: any;
  try {
    parsed = yamlParse(raw);
  } catch (err: unknown) {
    throw new TrinoProfileError(
      `Failed to parse "${profilesPath}": ${formatErr(err)}`,
      'DBT_PROFILE_NOT_FOUND',
    );
  }

  const dbtProfileName = profile.dbtProfile!;
  const dbtTargetName =
    profile.dbtTarget ?? parsed?.[dbtProfileName]?.target ?? 'default';
  const output =
    parsed?.[dbtProfileName]?.outputs?.[dbtTargetName] ?? undefined;

  if (!output) {
    throw new TrinoProfileError(
      `dbt profile "${dbtProfileName}.${dbtTargetName}" not found in "${profilesPath}".`,
      'DBT_PROFILE_NOT_FOUND',
    );
  }

  if (profile.authMethod === 'bearer') {
    const token = output.jwt_token ?? output.bearer_token ?? output.token;
    if (token) {
      return String(token);
    }
  }
  if (output.password) {
    return String(output.password);
  }
  if (output.password_file) {
    const expanded = expandTilde(String(output.password_file));
    try {
      return (await fs.promises.readFile(expanded, 'utf8')).replace(
        /\r?\n$/,
        '',
      );
    } catch (err: unknown) {
      throw new TrinoProfileError(
        `Failed to read dbt password_file "${expanded}": ${formatErr(err)}`,
        'NO_SECRET',
      );
    }
  }

  throw new TrinoProfileError(
    `dbt profile "${dbtProfileName}.${dbtTargetName}" does not define a password / password_file / jwt_token.`,
    'NO_SECRET',
  );
}

function secretKey(profileName: string, kind: 'password' | 'bearerToken') {
  return `${SECRET_NS}.${profileName}.${kind}`;
}

async function migrateSecrets(
  context: vscode.ExtensionContext,
  oldName: string,
  newName: string,
): Promise<void> {
  for (const kind of ['password', 'bearerToken'] as const) {
    const value = await context.secrets.get(secretKey(oldName, kind));
    if (value) {
      await context.secrets.store(secretKey(newName, kind), value);
      await context.secrets.delete(secretKey(oldName, kind));
    }
  }
}

function expandTilde(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

function formatErr(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export function validateProfile(profile: TrinoProfile): void {
  if (!profile.name?.trim()) {
    throw new TrinoProfileError(
      'Profile name is required.',
      'AUTH_SOURCE_MISCONFIGURED',
    );
  }
  if (!profile.coordinatorUrl?.trim()) {
    throw new TrinoProfileError(
      `Profile "${profile.name}" is missing coordinatorUrl.`,
      'AUTH_SOURCE_MISCONFIGURED',
    );
  }
  if (!profile.user?.trim()) {
    throw new TrinoProfileError(
      `Profile "${profile.name}" is missing user.`,
      'AUTH_SOURCE_MISCONFIGURED',
    );
  }
  const validMethods: TrinoAuthMethod[] = [
    'none',
    'basic',
    'bearer',
    'password-file',
  ];
  if (!validMethods.includes(profile.authMethod)) {
    throw new TrinoProfileError(
      `Profile "${profile.name}" has invalid authMethod "${profile.authMethod}".`,
      'AUTH_SOURCE_MISCONFIGURED',
    );
  }
}
