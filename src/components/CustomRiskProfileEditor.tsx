'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { storageManager } from '@/lib/storage';
import {
  BUILT_IN_RISK_PROFILES,
  PROFILE_LIMITS,
  RiskProfileConfig,
  UserCustomRiskProfile,
} from '@/lib/riskProfiles';

interface CustomRiskProfileEditorProps {
  profiles: UserCustomRiskProfile[];
  onChange: (profiles: UserCustomRiskProfile[]) => void;
}

type FieldErrors = Partial<Record<keyof RiskProfileConfig | 'name', string>>;

const FIELDS: { key: keyof RiskProfileConfig; label: string; prefix?: string }[] = [
  { key: 'approve', label: 'Approve at or below' },
  { key: 'caution', label: 'Caution at or below' },
  { key: 'reduce', label: 'Reduce or wait at or below' },
  { key: 'positionToleranceUsd', label: 'Position tolerance', prefix: '$' },
];

/**
 * Local validation mirrors the server's sanitizeProfileConfig clamping so the user sees a
 * precise reason for a rejected profile instead of a generic 400 from /api/analyze-trade.
 */
function validate(name: string, config: RiskProfileConfig): FieldErrors {
  const errors: FieldErrors = {};

  if (!name.trim()) {
    errors.name = 'Name is required.';
  } else if (name.trim().length > PROFILE_LIMITS.nameMaxLength) {
    errors.name = `Keep the name under ${PROFILE_LIMITS.nameMaxLength} characters.`;
  } else if (!/^[A-Za-z][A-Za-z0-9 _-]*$/.test(name.trim())) {
    errors.name = 'Start with a letter; use letters, digits, spaces, hyphens or underscores.';
  } else if (Object.keys(BUILT_IN_RISK_PROFILES).includes(name.trim().toLowerCase())) {
    errors.name = `"${name.trim()}" is a built-in profile and cannot be overwritten.`;
  }

  for (const f of FIELDS) {
    const raw = config[f.key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      errors[f.key] = 'Enter a number.';
      continue;
    }
    if (f.key === 'positionToleranceUsd') {
      if (raw < PROFILE_LIMITS.toleranceUsd.min) {
        errors[f.key] = `Must be at least $${PROFILE_LIMITS.toleranceUsd.min.toLocaleString()}.`;
      } else if (raw > PROFILE_LIMITS.toleranceUsd.max) {
        errors[f.key] = `Must be at most $${PROFILE_LIMITS.toleranceUsd.max.toLocaleString()}.`;
      }
    } else if (raw < PROFILE_LIMITS.threshold.min || raw > PROFILE_LIMITS.threshold.max) {
      errors[f.key] = `Must be between ${PROFILE_LIMITS.threshold.min} and ${PROFILE_LIMITS.threshold.max}.`;
    }
  }

  if (config.approve >= config.caution) errors.caution = 'Must be above "approve".';
  if (config.caution >= config.reduce) errors.reduce = 'Must be above "caution".';

  return errors;
}

/** Human-readable explanation of the ladder, so the numbers are not a black box. */
function describe(config: RiskProfileConfig): string {
  return `Approve ≤ ${config.approve} · Caution ≤ ${config.caution} · Reduce or wait ≤ ${config.reduce} · Block above ${config.reduce} · Tolerance $${config.positionToleranceUsd.toLocaleString()}`;
}

export function CustomRiskProfileEditor({ profiles, onChange }: CustomRiskProfileEditorProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<RiskProfileConfig>({ ...BUILT_IN_RISK_PROFILES.balanced });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const isNew = editing === null;

  const reset = () => {
    setEditing(null);
    setName('');
    setDraft({ ...BUILT_IN_RISK_PROFILES.balanced });
    setErrors({});
    setFormError(null);
  };

  const startEdit = (profile: UserCustomRiskProfile) => {
    setEditing(profile.name);
    setName(profile.name);
    setDraft({ ...profile.config });
    setErrors({});
    setFormError(null);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors = validate(name, draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormError('Fix the highlighted fields before saving.');
      return;
    }

    const result = storageManager.saveCustomRiskProfile(name, draft);
    if (!result.success) {
      setFormError(result.message);
      return;
    }
    onChange(storageManager.getCustomRiskProfiles());
    reset();
  };

  const handleDelete = (profileName: string) => {
    const result = storageManager.deleteCustomRiskProfile(profileName);
    onChange(storageManager.getCustomRiskProfiles());
    if (!result.success) setFormError(result.message);
    if (editing === profileName) reset();
  };

  const setField = (key: keyof RiskProfileConfig, raw: string) => {
    const parsed = Number(raw);
    setDraft((prev) => ({ ...prev, [key]: Number.isFinite(parsed) ? parsed : (NaN as number) }));
    setErrors((prev) => ({ ...prev, [key]: undefined, name: undefined }));
    setFormError(null);
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface/40 p-4">
      <div>
        <p className="text-label">Your Profiles ({profiles.length})</p>
        {profiles.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">
            No custom profiles yet. Save one below to grade trades against your own thresholds.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {profiles.map((profile) => (
              <li
                key={profile.name}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary">{profile.name}</p>
                  <p className="text-xs text-text-muted">{describe(profile.config)}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-text-secondary hover:text-text-primary"
                    onClick={() => (editing === profile.name ? reset() : startEdit(profile))}
                  >
                    {editing === profile.name ? 'Cancel' : 'Edit'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-text-muted hover:text-danger"
                    onClick={() => handleDelete(profile.name)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-3 border-t border-border pt-4">
        <p className="text-label">{isNew ? 'New Profile' : `Editing "${editing}"`}</p>

        <div className="space-y-1.5">
          <label htmlFor="profile-name" className="text-sm text-text-secondary">Name</label>
          <Input
            id="profile-name"
            value={name}
            maxLength={PROFILE_LIMITS.nameMaxLength}
            onChange={(e) => {
              setName(e.target.value);
              setErrors((prev) => ({ ...prev, name: undefined }));
              setFormError(null);
            }}
            placeholder="Swing trader"
            className="bg-card border-border text-text-primary h-10"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'profile-name-error' : undefined}
          />
          {errors.name && <p id="profile-name-error" className="text-xs text-danger">{errors.name}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FIELDS.map(({ key, label, prefix }) => (
            <div key={key} className="space-y-1.5">
              <label htmlFor={`profile-${key}`} className="text-sm text-text-secondary">
                {label}
              </label>
              <div className="relative">
                {prefix && (
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">
                    {prefix}
                  </span>
                )}
                <Input
                  id={`profile-${key}`}
                  type="number"
                  inputMode="numeric"
                  value={Number.isNaN(draft[key]) ? '' : draft[key]}
                  onChange={(e) => setField(key, e.target.value)}
                  className={`bg-card border-border text-text-primary h-10 ${prefix ? 'pl-7' : ''}`}
                  aria-invalid={Boolean(errors[key])}
                  aria-describedby={errors[key] ? `profile-${key}-error` : undefined}
                />
              </div>
              {errors[key] && (
                <p id={`profile-${key}-error`} className="text-xs text-danger">{errors[key]}</p>
              )}
            </div>
          ))}
        </div>

        <p className="text-xs text-text-muted">
          Scores at or below the first threshold are approved, the next band is a caution, the third
          asks you to reduce or wait, and anything above the last threshold is blocked.
        </p>

        {formError && <p className="text-xs text-danger" role="alert">{formError}</p>}

        <div className="flex gap-2">
          <Button type="submit" className="btn-primary h-10">
            {isNew ? 'Save Profile' : 'Update Profile'}
          </Button>
          {!isNew && (
            <Button type="button" variant="ghost" className="h-10 text-text-secondary" onClick={reset}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
