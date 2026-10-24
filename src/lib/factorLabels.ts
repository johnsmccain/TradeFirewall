/**
 * Display metadata for risk factors.
 *
 * Lives here rather than in a component because two places now need it: the factor breakdown and
 * the data-coverage disclosure. Two copies of a label map drift, and a factor silently showing its
 * raw key in one of them is exactly the kind of small wrongness this app is trying to avoid.
 */
export const FACTOR_LABELS: Record<string, string> = {
  volatility: 'Volatility',
  sentiment: 'Sentiment',
  volume: 'Volume',
  trend: 'Trend',
  liquidity: 'Liquidity',
  execution: 'Execution',
  sector: 'Sector',
  macro: 'Macro',
  positionSize: 'Position Size',
  holdingPeriod: 'Holding Period',
};

export const FACTOR_DESCRIPTIONS: Record<string, string> = {
  volatility: 'Price swing intensity from recent klines',
  sentiment: 'News & social mood around this asset',
  volume: 'Trading volume vs. recent averages',
  trend: 'Price momentum relative to your trade direction',
  liquidity: 'Order book depth vs. your trade size',
  execution: 'Estimated slippage, fees, and fill probability',
  sector: 'Sector performance and relative strength',
  macro: 'Broad market risk factors and contextual warnings',
  positionSize: 'Your trade size vs. your risk profile threshold',
  holdingPeriod: 'Timing risk amplified by volatility',
};

/**
 * Why a given factor is an estimate rather than a measurement, in terms a user can act on.
 *
 * Keyed by factor; the value is the explanation shown next to that factor. A factor absent from
 * this map still gets a generic explanation from `dataDisclosure` rather than being dropped.
 */
export const FACTOR_ESTIMATE_REASONS: Record<string, string> = {
  volatility: 'Not enough price history came back to measure volatility',
  sentiment: 'No recent headlines were returned for this asset',
  liquidity: 'No order book was returned for this symbol',
  execution: 'No fill or slippage preview was available',
  sector: 'This asset could not be matched to a sector',
};

/**
 * What a neutral 50 actually means, stated plainly. Without this the UI showed a confident number
 * and colour band for a factor it had no data for.
 */
export const NEUTRAL_ESTIMATE_SCORE = 50;

export function factorLabel(key: string): string {
  return FACTOR_LABELS[key] ?? key;
}

export function factorEstimateReason(key: string): string {
  return FACTOR_ESTIMATE_REASONS[key] ?? 'Upstream data was unavailable for this factor';
}
