import type { Decision } from './riskEngine';

/**
 * The score bands are the app's primary risk vocabulary. They were previously written out as
 * inline `if (score >= N)` chains in four places, which had already drifted: the risk score card
 * and the confirmation gate agreed on 26/51/76, the validation page used a third set for its
 * score text, and the dashboard counted trades with a fourth set. Keeping the cut-offs here
 * means a band can only be changed in one place.
 */
export type RiskBand = 'low' | 'moderate' | 'high' | 'critical';

/** Inclusive lower bound of each band. Bands are evaluated from the top down. */
const RISK_BAND_MINIMUMS: ReadonlyArray<readonly [RiskBand, number]> = [
  ['critical', 76],
  ['high', 51],
  ['moderate', 26],
];

export function riskBand(score: number): RiskBand {
  for (const [band, minimum] of RISK_BAND_MINIMUMS) {
    if (score >= minimum) return band;
  }
  return 'low';
}

export const RISK_BAND_LABEL: Record<RiskBand, string> = {
  low: 'Low Risk',
  moderate: 'Moderate Risk',
  high: 'High Risk',
  critical: 'Critical Risk',
};

/** Text colour, from the `.risk-*` utilities in globals.css. */
export const RISK_BAND_TEXT_CLASS: Record<RiskBand, string> = {
  low: 'risk-low',
  moderate: 'risk-medium',
  high: 'risk-high',
  critical: 'risk-critical',
};

/**
 * The same four bands expressed as Tailwind text utilities, for pages that do not load the
 * `.risk-*` classes. Kept as its own map rather than string-rewriting the one above so the
 * colour a page renders is declared once and cannot be mangled by a rename.
 */
export const RISK_BAND_TAILWIND_TEXT_CLASS: Record<RiskBand, string> = {
  low: 'text-success',
  moderate: 'text-warning',
  high: 'text-orange-risk',
  critical: 'text-danger',
};

/** Filled badge, for use on a `Badge` where the text needs to stay legible. */
export const RISK_BAND_BADGE_CLASS: Record<RiskBand, string> = {
  low: 'bg-success text-background',
  moderate: 'bg-warning text-background',
  high: 'bg-orange-risk text-white',
  critical: 'bg-danger text-white',
};

/**
 * Band thresholds for a single market factor. These are deliberately tighter than the composite
 * score bands above: a factor at 70 is genuinely alarming on its own, whereas a *weighted
 * total* of 70 is already caught by the `high` composite band. Conflating the two previously
 * let the same 70 render as "High Risk" in one place and "Critical Risk" in another.
 */
export type FactorBand = 'minimal' | 'low' | 'medium' | 'high';

const FACTOR_BAND_MINIMUMS: ReadonlyArray<readonly [FactorBand, number]> = [
  ['high', 70],
  ['medium', 50],
  ['low', 30],
];

export function factorBand(value: number): FactorBand {
  for (const [band, minimum] of FACTOR_BAND_MINIMUMS) {
    if (value >= minimum) return band;
  }
  return 'minimal';
}

export const FACTOR_BAND_LABEL: Record<FactorBand, string> = {
  minimal: 'Minimal',
  low: 'Low Risk',
  medium: 'Medium Risk',
  high: 'High Risk',
};

export const FACTOR_BAND_BAR_CLASS: Record<FactorBand, string> = {
  minimal: 'bg-success',
  low: 'bg-warning',
  medium: 'bg-orange-risk',
  high: 'bg-danger',
};

export const FACTOR_BAND_BADGE_CLASS: Record<FactorBand, string> = {
  minimal: 'bg-success text-background',
  low: 'bg-warning text-background',
  medium: 'bg-orange-risk text-white',
  high: 'bg-danger text-white',
};

/**
 * Presentation for each decision. `label` is what the user reads, which is not always the raw
 * enum value: `REDUCE_OR_WAIT` reads as "REDUCE / WAIT". `tint` is the translucent panel style
 * and `badge` the filled one; they are separate because the same decision appears both as a
 * result panel and as a badge on the score card.
 */
export const DECISION_STYLES: Record<
  Decision,
  { label: string; tint: string; badge: string }
> = {
  APPROVE: {
    label: 'APPROVE',
    tint: 'bg-success/10 text-success border-success/30',
    badge: 'bg-success text-background',
  },
  CAUTION: {
    label: 'CAUTION',
    tint: 'bg-warning/10 text-warning border-warning/30',
    badge: 'bg-warning text-background',
  },
  REDUCE_OR_WAIT: {
    label: 'REDUCE / WAIT',
    tint: 'bg-orange-risk/10 text-orange-risk border-orange-risk/30',
    badge: 'bg-orange-risk text-white',
  },
  BLOCK: {
    label: 'BLOCK',
    tint: 'bg-danger/10 text-danger border-danger/30',
    badge: 'bg-danger text-white',
  },
};

/**
 * Persisted decisions are read back from localStorage as plain strings, and a hand-edited or
 * stale record can hold a value this build does not know. Display falls back to a neutral grey
 * rather than guessing a colour, and never throws mid-render.
 */
const NEUTRAL_TINT = 'bg-surface text-text-primary border-border';

export function decisionLabel(decision: Decision | string): string {
  return DECISION_STYLES[decision as Decision]?.label ?? String(decision);
}

export function decisionTint(decision: Decision | string): string {
  return DECISION_STYLES[decision as Decision]?.tint ?? NEUTRAL_TINT;
}

export function decisionBadgeClass(decision: Decision | string): string {
  return DECISION_STYLES[decision as Decision]?.badge ?? 'bg-surface text-text-primary';
}

/** Card border/tint for a result panel. */
export const DECISION_PANEL_CLASS: Record<Decision, string> = {
  APPROVE: 'border-success/40 bg-success/5',
  CAUTION: 'border-warning/40 bg-warning/5',
  REDUCE_OR_WAIT: 'border-orange-risk/40 bg-orange-risk/5',
  BLOCK: 'border-danger/40 bg-danger/5',
};

/** Text colour for a decision, used on the score and headline of a result panel. */
export const DECISION_TEXT_CLASS: Record<Decision, string> = {
  APPROVE: 'text-success',
  CAUTION: 'text-warning',
  REDUCE_OR_WAIT: 'text-orange-risk',
  BLOCK: 'text-danger',
};

/**
 * Headline wording for the beginner view. Deliberately more directive than the raw decision:
 * "APPROVE" alone does not tell a first-time trader what to actually do.
 */
export const DECISION_HEADLINE: Record<Decision, string> = {
  APPROVE: '✅ Safe to Proceed',
  CAUTION: '⚠️ Proceed with Caution',
  REDUCE_OR_WAIT: '🔻 Reduce Size or Wait',
  BLOCK: '🚫 Avoid This Trade',
};

/** True for anything in the `high` or `critical` bands, i.e. the composite score at 51 and up. */
export function isHighRisk(score: number): boolean {
  const band = riskBand(score);
  return band === 'high' || band === 'critical';
}

/** Confidence is a 0-1 fraction, not a score out of 100, so it gets its own cut-offs. */
export function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'bg-success';
  if (confidence >= 0.6) return 'bg-primary';
  if (confidence >= 0.4) return 'bg-warning';
  return 'bg-danger';
}
