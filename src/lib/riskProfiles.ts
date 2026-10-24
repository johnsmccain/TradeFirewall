// Risk profile definitions — the decision thresholds and position-size tolerance that
// define how strictly a trade is graded. Extracted from riskEngine.ts so they are data
// rather than hardcoded maps, which is what makes *custom* profiles possible.
//
// Built-in values are byte-identical to the previously hardcoded maps, so backtest and
// /validate numbers are unchanged.

export interface RiskProfileConfig {
  /** riskScore <= approve → APPROVE */
  approve: number;
  /** riskScore <= caution → CAUTION */
  caution: number;
  /** riskScore <= reduce → REDUCE_OR_WAIT */
  reduce: number;
  /** Reference notional (USD) that scores position-size risk 30/100; multiples of this drive 50/70/90. */
  positionToleranceUsd: number;
}

export type BuiltInRiskProfile = 'conservative' | 'balanced' | 'aggressive';

/** A user-defined profile as persisted in the browser. The server has no registry of these —
 *  the definition travels with each request and is re-clamped by sanitizeProfileConfig(). */
export interface UserCustomRiskProfile {
  name: string;
  config: RiskProfileConfig;
  createdAt: number;
}

export const BUILT_IN_RISK_PROFILES: Record<BuiltInRiskProfile, RiskProfileConfig> = {
  conservative: { approve: 25, caution: 40, reduce: 60, positionToleranceUsd: 1_000 },
  balanced: { approve: 35, caution: 50, reduce: 70, positionToleranceUsd: 5_000 },
  aggressive: { approve: 45, caution: 60, reduce: 80, positionToleranceUsd: 20_000 },
};

export const DEFAULT_RISK_PROFILE: BuiltInRiskProfile = 'balanced';

/** Guardrails for client-supplied profiles. The API route is public, so thresholds are clamped
 *  rather than trusted — otherwise a POST with `approve: 9999` would APPROVE anything and
 *  drive the execution gate off a fabricated decision. */
export const PROFILE_LIMITS = {
  threshold: { min: 0, max: 100 },
  toleranceUsd: { min: 100, max: 1_000_000 },
  nameMaxLength: 24,
} as const;

export const RISK_PROFILE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9 _-]*$/;

export function isValidProfileName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= PROFILE_LIMITS.nameMaxLength &&
    RISK_PROFILE_NAME_PATTERN.test(name)
  );
}

export function isBuiltInProfile(name: string): name is BuiltInRiskProfile {
  return Object.prototype.hasOwnProperty.call(BUILT_IN_RISK_PROFILES, name);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number): number {
  return Math.round(value);
}

/**
 * Validates and clamps a client-supplied profile.
 * Returns null when the input is unusable — callers decide whether that is a 400 or a fallback.
 *
 * Ordering is enforced rather than rejected: a profile with caution < approve is coerced into a
 * monotonic ladder instead of failing, because the client's intent is unambiguous (looser at the
 * bottom) and silently producing an unreachable band would be worse than nudging the numbers.
 */
export function sanitizeProfileConfig(raw: unknown): RiskProfileConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const nums = (key: keyof RiskProfileConfig): number | null => {
    const v = r[key];
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    return n;
  };

  const tolerance = nums('positionToleranceUsd');
  if (tolerance === null) return null;

  const rawApprove = nums('approve');
  const rawCaution = nums('caution');
  const rawReduce = nums('reduce');
  if (rawApprove === null || rawCaution === null || rawReduce === null) return null;

  const { threshold } = PROFILE_LIMITS;
  const approve = roundScore(clamp(rawApprove, threshold.min, threshold.max));
  let caution = roundScore(clamp(rawCaution, threshold.min, threshold.max));
  let reduce = roundScore(clamp(rawReduce, threshold.min, threshold.max));

  // Enforce approve <= caution <= reduce by widening later bands, never narrowing earlier ones,
  // so a caller who asks for approve=60 cannot accidentally end up blocking more trades.
  if (caution < approve) caution = approve;
  if (reduce < caution) reduce = caution;

  return {
    approve,
    caution,
    reduce,
    positionToleranceUsd: Math.round(
      clamp(tolerance, PROFILE_LIMITS.toleranceUsd.min, PROFILE_LIMITS.toleranceUsd.max)
    ),
  };
}

/**
 * Resolves a profile name (plus optional client override) to a usable config.
 * Unknown name with no override falls back to the default profile — this is the safe
 * direction for a grading function: an unrecognised profile grades like "balanced"
 * rather than throwing mid-analysis.
 */
export function resolveRiskProfile(
  name: string,
  override?: unknown
): { config: RiskProfileConfig; isCustom: boolean } {
  const sanitized = sanitizeProfileConfig(override);
  if (sanitized) return { config: sanitized, isCustom: true };
  if (isBuiltInProfile(name)) return { config: BUILT_IN_RISK_PROFILES[name], isCustom: false };
  return { config: BUILT_IN_RISK_PROFILES[DEFAULT_RISK_PROFILE], isCustom: true };
}

/** Accepts either a built-in profile name or an explicit config, so call sites that only
 *  have a name (`determineDecision(score, 'balanced')`) keep working unchanged. */
export type RiskProfileInput = string | RiskProfileConfig;

export function toProfileConfig(profile: RiskProfileInput): RiskProfileConfig {
  if (typeof profile !== 'string') return profile;
  return resolveRiskProfile(profile).config;
}
