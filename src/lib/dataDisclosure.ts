import {
  factorLabel,
  factorEstimateReason,
  NEUTRAL_ESTIMATE_SCORE,
} from './factorLabels';

export interface EstimatedFactorDetail {
  key: string;
  label: string;
  reason: string;
  /** The neutral stand-in score that was used in its place. */
  score: number;
}

export interface DataDisclosure {
  /** True only when every factor in the score was measured from real input. */
  complete: boolean;
  /** One-line summary for the data-sources card. */
  summary: string;
  /** Estimated factors with their reasons, in a stable order. Never empty when incomplete. */
  estimated: EstimatedFactorDetail[];
  /** Sentence describing the effect on the overall score, for the disclosure callout. */
  impact: string;
}

/** Display order for estimated factors, so the disclosure does not reshuffle between runs. */
const FACTOR_ORDER = [
  'volatility',
  'sentiment',
  'volume',
  'trend',
  'liquidity',
  'execution',
  'sector',
  'macro',
] as const;

/**
 * Describes how much of a score rests on measured data.
 *
 * The app previously asserted that "every factor above is scored on real data" whenever both
 * providers returned a payload. That conflated a provider responding with a provider having sent
 * usable input: SoDEX returns a payload with no klines and SoSoValue returns an empty news list,
 * and both cases silently score a neutral 50 that looks identical to a real measurement.
 */
export function buildDataDisclosure(
  estimatedFactors: string[] | undefined,
  marketFactors: Record<string, number> | undefined,
  sodexConnected: boolean
): DataDisclosure {
  const keys = Array.from(new Set(estimatedFactors ?? [])).filter((k) =>
    (FACTOR_ORDER as readonly string[]).includes(k)
  );
  keys.sort((a, b) => FACTOR_ORDER.indexOf(a as never) - FACTOR_ORDER.indexOf(b as never));

  if (keys.length === 0) {
    return {
      complete: true,
      summary: 'Both providers returned usable data for every factor in this score.',
      estimated: [],
      impact: '',
    };
  }

  const estimated: EstimatedFactorDetail[] = keys.map((key) => ({
    key,
    label: factorLabel(key),
    reason: factorEstimateReason(key),
    score: marketFactors?.[key] ?? NEUTRAL_ESTIMATE_SCORE,
  }));

  const names = estimated.map((f) => f.label);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  const providerNote = sodexConnected
    ? 'the provider responded without usable data for it'
    : 'SoDEX was unreachable';

  return {
    complete: false,
    summary: `${list} ${names.length === 1 ? 'was' : 'were'} estimated rather than measured: ${providerNote}. Each shows a neutral ${NEUTRAL_ESTIMATE_SCORE} in the breakdown.`,
    estimated,
    impact: `${list} ${
      names.length === 1 ? 'is' : 'are'
    } a neutral placeholder, so treat this score as a floor rather than a full reading of the market.`,
  };
}
