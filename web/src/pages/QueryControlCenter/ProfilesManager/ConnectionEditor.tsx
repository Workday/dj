import type {
  TrinoAuthMethod,
  TrinoAuthSource,
  TrinoProfile,
} from '@shared/trino/types';
import { useApp } from '@web/context';
import {
  Alert,
  Button,
  Checkbox,
  InputText,
  SelectSingle,
} from '@web/elements';
import { useError } from '@web/hooks';
import { useState } from 'react';

import { SectionHeader } from './SectionHeader';

export type ConnectionEditorProps = {
  initial: TrinoProfile | null;
  /** Called after a successful save/delete so the parent can refresh. */
  onClose: (changed: boolean) => void;
};

const AUTH_METHODS: TrinoAuthMethod[] = [
  'none',
  'basic',
  'bearer',
  'password-file',
];

const AUTH_SOURCES: { value: TrinoAuthSource; label: string; help: string }[] =
  [
    {
      value: 'secret-storage',
      label: 'VS Code Secret Storage (OS keychain)',
      help: 'Default. Backed by macOS Keychain / libsecret / Windows Credential Manager. Never written to settings.json or synced via Settings Sync.',
    },
    {
      value: 'env-var',
      label: 'Environment variable',
      help: 'Resolved from process.env at request time. Best for CI runners or 1Password CLI / aws-vault wrappers.',
    },
    {
      value: 'password-file',
      label: 'Password file on disk',
      help: 'A file path holding the secret. You own the file permissions (chmod 600) and any decryption pipeline (gpg, age, pass).',
    },
    {
      value: 'dbt-profile',
      label: 'Reuse from ~/.dbt/profiles.yml',
      help: 'Zero extra config — borrow the password / jwt_token already configured for dbt itself. Pick a profile and target.',
    },
  ];

function emptyProfile(): TrinoProfile {
  return {
    name: '',
    coordinatorUrl: '',
    user: '',
    authMethod: 'basic',
    authSource: 'secret-storage',
    verifyTls: true,
  };
}

export function ConnectionEditor({ initial, onClose }: ConnectionEditorProps) {
  const { api } = useApp();
  const { error, handleError, clearError } = useError();
  const [profile, setProfile] = useState<TrinoProfile>(
    initial ?? emptyProfile(),
  );
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const isEditing = !!initial;

  const sourceMeta = AUTH_SOURCES.find((s) => s.value === profile.authSource);

  async function handleSave() {
    if (!profile.name.trim() || !profile.coordinatorUrl.trim()) {
      handleError(new Error('Profile name and coordinator URL are required.'));
      return;
    }
    try {
      setSaving(true);
      clearError();
      await api.post({
        type: 'trino-save-profile',
        request: {
          profile,
          previousName: isEditing ? initial.name : undefined,
        },
      });
      // Only save secret when secret-storage is selected and the user entered one.
      if (
        profile.authSource === 'secret-storage' &&
        profile.authMethod !== 'none' &&
        secret.trim().length > 0
      ) {
        await api.post({
          type: 'trino-set-credentials',
          request: {
            profile: profile.name,
            kind: profile.authMethod === 'bearer' ? 'bearerToken' : 'password',
            secret,
          },
        });
      }
      onClose(true);
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!isEditing) {
      onClose(false);
      return;
    }
    try {
      setSaving(true);
      clearError();
      await api.post({
        type: 'trino-delete-profile',
        request: { name: initial.name },
      });
      onClose(true);
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-neutral rounded-md bg-background text-background-contrast flex flex-col gap-4 p-4">
      {error && <Alert label={error.message} variant="error" />}

      <SectionHeader title="GENERAL" />
      <InputText
        label="Name"
        value={profile.name}
        onChange={(e) => setProfile({ ...profile, name: e.target.value })}
        placeholder="e.g. dev, staging, prod"
        disabled={isEditing /* rename via Save with previousName */}
      />
      <InputText
        label="Coordinator URL"
        value={profile.coordinatorUrl}
        onChange={(e) =>
          setProfile({ ...profile, coordinatorUrl: e.target.value })
        }
        placeholder="https://trino.example.com"
      />

      <SectionHeader title="AUTHENTICATION" />
      <InputText
        label="User (X-Trino-User)"
        value={profile.user}
        onChange={(e) => setProfile({ ...profile, user: e.target.value })}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SelectSingle
          label="Auth Method"
          options={AUTH_METHODS.map((m) => ({ value: m, label: m }))}
          value={{ value: profile.authMethod, label: profile.authMethod }}
          onChange={(o) =>
            o &&
            setProfile({
              ...profile,
              authMethod: o.value as TrinoAuthMethod,
            })
          }
          onBlur={() => {}}
          showClearButton={false}
        />
        <SelectSingle
          label="Auth Source"
          options={AUTH_SOURCES.map((s) => ({
            value: s.value,
            label: s.label,
          }))}
          value={
            AUTH_SOURCES.map((s) => ({
              value: s.value,
              label: s.label,
            })).find((o) => o.value === profile.authSource) ?? null
          }
          onChange={(o) =>
            o &&
            setProfile({
              ...profile,
              authSource: o.value as TrinoAuthSource,
            })
          }
          onBlur={() => {}}
          showClearButton={false}
        />
      </div>
      {sourceMeta && <p className="text-xs opacity-70">{sourceMeta.help}</p>}

      {profile.authSource === 'secret-storage' &&
        profile.authMethod !== 'none' && (
          <InputText
            label={
              profile.authMethod === 'bearer'
                ? 'Bearer token (stored in OS keychain)'
                : 'Password (stored in OS keychain)'
            }
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            type="password"
            placeholder={
              isEditing
                ? 'Leave blank to keep existing secret'
                : 'Required for new profile'
            }
          />
        )}

      {profile.authSource === 'env-var' && (
        <InputText
          label="Environment variable name"
          value={profile.secretEnvVar ?? ''}
          onChange={(e) =>
            setProfile({ ...profile, secretEnvVar: e.target.value })
          }
          placeholder="e.g. TRINO_PROD_BEARER"
        />
      )}

      {profile.authSource === 'password-file' && (
        <InputText
          label="Password file path"
          value={profile.passwordFilePath ?? ''}
          onChange={(e) =>
            setProfile({ ...profile, passwordFilePath: e.target.value })
          }
          placeholder="~/.trino/prod-password"
        />
      )}

      {profile.authSource === 'dbt-profile' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <InputText
            label="dbt profile name"
            value={profile.dbtProfile ?? ''}
            onChange={(e) =>
              setProfile({ ...profile, dbtProfile: e.target.value })
            }
            placeholder="e.g. analytics"
          />
          <InputText
            label="dbt target"
            value={profile.dbtTarget ?? ''}
            onChange={(e) =>
              setProfile({ ...profile, dbtTarget: e.target.value })
            }
            placeholder="e.g. prod"
          />
        </div>
      )}

      <SectionHeader title="SECURITY" />
      <Checkbox
        label="Verify TLS certificate"
        checked={profile.verifyTls !== false}
        onChange={(checked) =>
          setProfile({
            ...profile,
            verifyTls:
              typeof checked === 'boolean' ? checked : checked.target.checked,
          })
        }
      />

      <div className="flex items-center justify-between mt-2 pt-3 border-t border-neutral">
        <Button
          variant="error"
          onClick={() => void handleDelete()}
          label="Delete profile"
          disabled={!isEditing}
        />
        <div className="flex gap-2">
          <Button
            variant="outlineIconButton"
            className="text-sm"
            onClick={() => onClose(false)}
            label="Cancel"
          />
          <Button
            variant="primary"
            loading={saving}
            onClick={() => void handleSave()}
            label="Save profile"
          />
        </div>
      </div>
    </div>
  );
}
