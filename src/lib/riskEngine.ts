// Risk scoring engine for trade analysis — live SoSoValue + SoDEX only (no mock payloads)
import {
  sosoValueAPI,
  APIConnectionError,
  SoSoValueHttpError,
  SoSoValueTimeoutError,
  SoSoMarketIntelligence,
} from './sosovalue';
import { sodexAPI, SodexMarketMicrostructure, SodexExecutionPreview, SodexTicker, SodexOrderbook } from './sodex';
import { getCalibrationBand, getReliabilityNote, CalibrationBandId, ReliabilityNote } from './riskCalibration';
import { resolveRiskProfile, toProfileConfig, RiskProfileConfig, RiskProfileInput } from './riskProfiles';

/** Subset of live SoSoValue data the scoring functions read — assembled in analyzeTradeRisk. */
export interface SosoAnalysisData {
  marketSummary: SoSoMarketIntelligence['marketSummary'];
  assetTrend: SoSoMarketIntelligence['assetTrend'];
  sentiment: SoSoMarketIntelligence['sentiment'];
  volumeData: SoSoMarketIntelligence['volumeData'];
  sectorData: SoSoMarketIntelligence['sectorData'];
  riskContext: SoSoMarketIntelligence['riskContext'];
}

/** Subset of live SoDEX data the scoring functions read — assembled in analyzeTradeRisk. */
export interface SodexAnalysisData {
  ticker: SodexMarketMicrostructure['ticker'];
  orderbook: SodexMarketMicrostructure['orderbook'];
  klines: SodexMarketMicrostructure['klines'];
  recentTrades: SodexMarketMicrostructure['recentTrades'];
  executionPreview: SodexMarketMicrostructure['executionPreview'];
  liquidityAnalysis: SodexMarketMicrostructure['liquidityAnalysis'];
}

export type RiskProfile = 'conservative' | 'balanced' | 'aggressive';
/** Profile name as stored on a trade: a built-in name, or a user-defined custom profile. */
export type RiskProfileName = string;
export type HoldingPeriod = 'intraday' | '1day' | '7days' | '30days';
export type TradeAction = 'buy' | 'sell';
export type Decision = 'APPROVE' | 'CAUTION' | 'REDUCE_OR_WAIT' | 'BLOCK';

export interface TradeInput {
  symbol: string;
  action: TradeAction;
  amount: number;
  holdingPeriod: HoldingPeriod;
  riskProfile: RiskProfileName;
  /**
   * Thresholds for a user-defined profile. Required when `riskProfile` is not one of the
   * built-ins — the server has no registry of custom profiles (they live in the browser), so
   * the definition travels with the request and is clamped by sanitizeProfileConfig().
   */
  riskProfileConfig?: RiskProfileConfig;
  notes?: string;
}

export interface DataSourcesReport {
  /** Human-readable lines for PDF/UI */
  lines: string[];
  lastUpdatedDisplay: string;
  lastUpdatedIso: string;
  sosoValue: {
    status: 'connected' | 'error';
    live: boolean;
    lastUpdatedIso: string;
    categories: string[];
    endpoints: string[];
    errorMessage?: string;
  };
  sodex: {
    status: 'connected' | 'error';
    live: boolean;
    lastUpdatedIso: string;
    network: 'testnet' | 'mainnet';
    categories: string[];
    endpoints: string[];
    errorMessage?: string;
  };
}

export const FACTOR_WEIGHTS: Record<string, number> = {
  volatility: 0.18,
  sentiment: 0.10,
  volume: 0.10,
  trend: 0.15,
  liquidity: 0.10,
  execution: 0.10,
  sector: 0.07,
  macro: 0.05,
  positionSize: 0.10,
  holdingPeriod: 0.05,
};

export interface RiskFactorScores {
  [key: string]: number;
  volatility: number;
  sentiment: number;
  volume: number;
  trend: number;
  liquidity: number;
  execution: number;
  sector: number;
  macro: number;
  positionSize: number;
  holdingPeriod: number;
}

export interface RiskAnalysis {
  riskScore: number; // 0-100
  decision: Decision;
  reasons: string[];
  saferAction: string;
  suggestedPositionSize: string;
  confidence: number; // 0-1
  marketFactors: {
    volatility: number;
    sentiment: number;
    volume: number;
    trend: number;
    liquidity: number;
    execution: number;
    sector: number;
    macro: number;
    positionSize: number;
    holdingPeriod: number;
  };
  factorWeights: typeof FACTOR_WEIGHTS;
  /** Name of the profile used, built-in or custom. */
  riskProfile: string;
  riskProfileConfig: RiskProfileConfig;
  /** True when the thresholds came from a user-supplied definition rather than a built-in. */
  riskProfileIsCustom: boolean;
  dataSourcesUsed: string[];
  dataSourcesReport: DataSourcesReport;
  /**
   * Factors whose displayed score is a neutral or synthetic stand-in rather than a measurement,
   * because the upstream input was empty or the provider was unreachable.
   *
   * Every factor defaults to 50 and is overwritten when data arrives, so a "no data" factor is
   * indistinguishable from a measured 50 by inspecting `marketFactors` alone. Without this list
   * the UI asserted that every factor was scored on real data even when a factor was a default.
   */
  estimatedFactors: string[];
  /** Values shown in UI as proof of live fetches */
  liveSnapshot: {
    sosoPrice: number;
    sosoChange24hPct: number;
    sodexLast: string;
    sodexBid: string;
    sodexAsk: string;
    sodexVolume: string;
    sodexSymbol: string;
    spreadPercent: number;
  };
  /** Why this score means what it means — see src/lib/riskCalibration.ts */
  calibration: {
    band: CalibrationBandId;
    label: string;
    scoreRange: [number, number];
    whyThreshold: string;
    typicalCases: string;
    failureMode: string;
  };
  reliability: ReliabilityNote;
}

// ── Pure scoring functions ──────────────────────────────────────────────
// Extracted so src/lib/backtest.ts can reuse the exact same math the live
// engine uses instead of re-implementing it — live and backtest scoring can
// never drift apart.

export function calculateVolatilityFromKlines(klines: Array<{ close: string }>): number {
  // Fewer than 3 closes yields fewer than 2 returns, and the stdev of a single sample is 0 —
  // which would score a total collapse (e.g. [100, 0], a -100% return) as "low volatility".
  // With too little to estimate a spread, fall back to the high-risk default.
  if (!klines || klines.length < 3) return 70; // High risk if no data

  // Calculate price volatility from klines
  const prices = klines.map((k) => parseFloat(k.close));
  const returns = [];

  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] === 0) continue; // a zero close would yield an infinite return
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }

  if (returns.length < 2) return 70; // Not enough usable returns

  // True standard deviation: the mean must be subtracted before squaring. Summing the raw
  // squares gives RMS, which is sqrt(variance + mean²) — it is inflated by any nonzero drift
  // in the window, so a steadily trending series scored as more volatile than a choppy one
  // with the same spread.
  const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
  const variance = returns.reduce((sum, ret) => sum + (ret - mean) * (ret - mean), 0) / returns.length;

  // These bars are ~hourly, so multiplying by sqrt(24) puts the hourly stdev on a daily scale,
  // which is what the thresholds below are expressed in. (Annualisation would be sqrt(24 * 365)
  // and is deliberately not applied — the buckets are calibrated to daily vol.)
  const volatility = Math.sqrt(variance) * Math.sqrt(24); // Daily-scale

  // Convert to risk score
  if (volatility > 0.15) return 90; // Extreme
  if (volatility > 0.10) return 70; // High
  if (volatility > 0.05) return 40; // Medium
  return 20; // Low
}

/**
 * The amount a reduction should target, or null when the current size is already appropriate.
 *
 * Exported so the "Reduce Size & Re-analyze" action reduces to exactly the number the report
 * recommends. That action used to hardcode a halving, which disagreed with the recommendation shown
 * next to it: a score of 30 implies a 5% trim but halved the trade, and a score of 90 implies 65% but
 * only removed half, leaving the trade still blocked and needing repeated clicks.
 *
 * Callers must handle the null case — it means "no reduction is warranted", not "reduce to zero".
 */
export function saferPositionAmount(amount: number, riskScore: number): number | null {
  if (riskScore <= 25) return null;
  const reductionFactor = Math.min(0.8, (riskScore - 25) / 100);
  return amount * (1 - reductionFactor);
}

/**
 * Which SoDEX-derived factors are standing in with a default rather than a measurement.
 *
 * This mirrors the SoDEX half of the factor calculation exactly. If the two ever drift, this
 * list silently becomes wrong, so the checks are deliberately written against the same guards the
 * calculation uses rather than against the resulting scores — a factor that legitimately measured
 * 50 is not an estimate, and a factor left at its 50 default is.
 */
export function buildEstimatedSodexFactors(sodexData: SodexAnalysisData): string[] {
  const estimated: string[] = [];
  // The factor calculation calls the volatility helper with as few as one close, and that helper
  // returns a neutral 50 when it has fewer than 3 closes (fewer than 2 returns). One or two
  // klines therefore reach the score as a stand-in, not a measurement.
  if (!sodexData.klines || sodexData.klines.length < 3) estimated.push('volatility');
  if (!sodexData.orderbook) estimated.push('liquidity');
  if (!sodexData.executionPreview) estimated.push('execution');
  return estimated;
}

/**
 * Sector risk, oriented to the trade direction.
 *
 * A falling sector is a headwind for a long and a tailwind for a short, so each sector input is
 * signed by the action before it is bucketed. As with sentiment, scoring this direction-blind
 * penalised sellers for sector weakness that was working in their favour.
 */
export function calculateSectorRisk(
  sectorData: SosoAnalysisData['sectorData'] | undefined,
  action: TradeAction
): number {
  if (!sectorData) return 50; // Neutral if no data

  const sign = action === 'buy' ? 1 : -1;
  let risk = 50;

  // Sector performance risk, oriented so a negative figure always means "against this trade"
  const performance = sectorData.sectorPerformance * sign;
  if (performance < -10) risk += 20;
  else if (performance < -5) risk += 10;
  else if (performance > 10) risk -= 10;
  else if (performance > 5) risk -= 5;

  // Sector trend risk
  const against = action === 'buy' ? 'bearish' : 'bullish';
  const with_ = action === 'buy' ? 'bullish' : 'bearish';
  if (sectorData.sectorTrend === against) risk += 15;
  else if (sectorData.sectorTrend === with_) risk -= 10;

  // Relative strength. This input is a 0-100 rank rather than a signed move, so it cannot be
  // flipped by negation — a strong sector helps a sell, so the low-strength bucket becomes the
  // risky one instead.
  if (action === 'buy') {
    if (sectorData.relativeStrength < 30) risk += 15;
    else if (sectorData.relativeStrength > 70) risk -= 10;
  } else {
    if (sectorData.relativeStrength > 70) risk += 15;
    else if (sectorData.relativeStrength < 30) risk -= 10;
  }

  return Math.max(0, Math.min(100, risk));
}

/**
 * Sentiment risk, oriented to the trade direction.
 *
 * The raw SoSoValue score runs -1 (negative) to +1 (positive). For a buy, negative news is
 * dangerous; for a sell the same news is tailwind, so the score is inverted rather than
 * discarded. Direction-blind sentiment scored a short into a bad-news week as higher risk than
 * the same short into a quiet one, which is backwards.
 */
export function calculateSentimentRisk(
  sentiment: SosoAnalysisData['sentiment'] | undefined,
  action: TradeAction
): number {
  if (!sentiment) return 50; // Neutral if no data

  const oriented = action === 'buy' ? sentiment.score : -sentiment.score;

  // Convert oriented sentiment score (-1 to 1) to risk score (0-100)
  if (oriented < -0.5) return 80;
  if (oriented < -0.2) return 60;
  if (oriented < 0.2) return 40;
  if (oriented < 0.5) return 20;
  return 10;
}

export function calculateTrendRisk(assetTrend: { trend: string } | undefined, action: TradeAction): number {
  if (!assetTrend) return 50; // Neutral if no data

  const trendRiskMap = {
    strong_bearish: action === 'buy' ? 90 : 20,
    bearish: action === 'buy' ? 70 : 30,
    neutral: 50,
    bullish: action === 'buy' ? 30 : 70,
    strong_bullish: action === 'buy' ? 20 : 90,
  };

  return trendRiskMap[assetTrend.trend as keyof typeof trendRiskMap] || 50;
}

export function calculateVolumeRisk(
  sosoVolumeData: { volumeChange: number } | undefined,
  sodexTicker: { volume: string } | undefined
): number {
  let volumeRisk = 50; // Default

  if (sosoVolumeData) {
    // Use SoSoValue volume analysis
    if (sosoVolumeData.volumeChange < -30) volumeRisk = 80;
    else if (sosoVolumeData.volumeChange < -15) volumeRisk = 60;
    else if (sosoVolumeData.volumeChange < 0) volumeRisk = 40;
    else volumeRisk = 20;
  } else if (sodexTicker) {
    // Fallback to SoDEX volume data
    const volume = parseFloat(sodexTicker.volume);
    if (volume < 1000) volumeRisk = 80; // Very low volume
    else if (volume < 10000) volumeRisk = 60;
    else if (volume < 100000) volumeRisk = 40;
    else volumeRisk = 20;
  }

  return volumeRisk;
}

export function calculatePositionSizeRisk(amount: number, riskProfile: RiskProfileInput): number {
  const tolerance = toProfileConfig(riskProfile).positionToleranceUsd;
  const ratio = amount / tolerance;

  if (ratio > 5) return 90;
  if (ratio > 3) return 70;
  if (ratio > 2) return 50;
  if (ratio > 1) return 30;
  return 10;
}

export function calculateHoldingPeriodRisk(holdingPeriod: HoldingPeriod, volatilityRiskScore: number): number {
  const periodRiskMap: Record<HoldingPeriod, number> = {
    intraday: 80,
    '1day': 60,
    '7days': 40,
    '30days': 20,
  };

  const baseRisk = periodRiskMap[holdingPeriod];
  const volatilityMultiplier =
    volatilityRiskScore > 75 ? 1.45 : volatilityRiskScore > 55 ? 1.2 : volatilityRiskScore > 40 ? 1.0 : 0.85;

  return Math.min(100, Math.round(baseRisk * volatilityMultiplier));
}

export function combineRiskFactors(factors: Record<string, number>): number {
  let weightedSum = 0;
  let totalWeight = 0;

  Object.entries(factors).forEach(([factor, value]) => {
    const weight = FACTOR_WEIGHTS[factor] ?? 0;
    if (weight <= 0) return;
    weightedSum += value * weight;
    totalWeight += weight;
  });

  if (totalWeight <= 0) {
    throw new Error('Risk engine has no weighted factors to combine');
  }

  return Math.round(weightedSum / totalWeight);
}

export function determineDecision(riskScore: number, riskProfile: RiskProfileInput): Decision {
  // Adjust thresholds based on risk profile
  const { approve, caution, reduce } = toProfileConfig(riskProfile);

  if (riskScore <= approve) return 'APPROVE';
  if (riskScore <= caution) return 'CAUTION';
  if (riskScore <= reduce) return 'REDUCE_OR_WAIT';
  return 'BLOCK';
}

/** Neutral SoDEX fallback used when the exchange is unreachable. */
function buildNullSodexData(): SodexAnalysisData {
  const nullTicker: SodexTicker = {
    symbol: '', priceChange: '0', priceChangePercent: '0', weightedAvgPrice: '0',
    prevClosePrice: '0', lastPrice: '0', lastQty: '0', bidPrice: '0', bidQty: '0',
    askPrice: '0', askQty: '0', openPrice: '0', highPrice: '0', lowPrice: '0',
    volume: '0', quoteVolume: '0', openTime: 0, closeTime: 0,
    firstId: 0, lastId: 0, count: 0,
  };
  const nullOrderbook: SodexOrderbook = { lastUpdateId: 0, bids: [], asks: [] };
  const nullExecution: SodexExecutionPreview = {
    symbol: '', side: 'BUY', amount: 0, estimatedPrice: 0,
    estimatedSlippage: 0, estimatedFees: 0, priceImpact: 0,
    executionProbability: 0, warnings: [], canExecute: false, mode: 'preview',
    liquidityAnalysis: { totalBidLiquidity: 0, totalAskLiquidity: 0, spreadPercent: 0, marketDepth: 0 },
  };
  return {
    ticker: nullTicker,
    orderbook: nullOrderbook,
    klines: [],
    recentTrades: [],
    executionPreview: nullExecution,
    liquidityAnalysis: { totalBidLiquidity: 0, totalAskLiquidity: 0, spreadPercent: 0, marketDepth: 0, bidLevels: 0, askLevels: 0 },
  };
}

class RiskEngine {
  async analyzeTradeRisk(input: TradeInput): Promise<RiskAnalysis> {
    // Fetch SoSoValue (required) and SoDEX (optional — degrade gracefully if unreachable)
    const finishedAt = Date.now();

    let sosoMI: Awaited<ReturnType<typeof sosoValueAPI.fetchMarketIntelligence>>;
    try {
      sosoMI = await sosoValueAPI.fetchMarketIntelligence(input.symbol);
    } catch (error) {
      if (error instanceof APIConnectionError) throw error;
      // Typed provider errors must survive. Re-wrapping them into a plain Error stripped the type,
      // so the route could no longer tell a timeout from a 429 from a generic failure and fell
      // back to guessing from the message text.
      if (error instanceof SoSoValueTimeoutError || error instanceof SoSoValueHttpError) throw error;
      throw new Error(error instanceof Error ? error.message : 'SoSoValue fetch failed');
    }

    let sodexMS: Awaited<ReturnType<typeof sodexAPI.fetchMarketMicrostructure>> | null = null;
    let sodexError: string | null = null;
    try {
      sodexMS = await sodexAPI.fetchMarketMicrostructure(input.symbol, input);
    } catch (err) {
      sodexError = err instanceof Error ? err.message : 'SoDEX unavailable';
      console.warn(`SoDEX unavailable — continuing with SoSoValue-only scoring: ${sodexError}`);
    }

    const sodexAvailable = sodexMS !== null;
    const sosoData: SosoAnalysisData = {
      marketSummary: sosoMI.marketSummary,
      assetTrend: sosoMI.assetTrend,
      sentiment: sosoMI.sentiment,
      volumeData: sosoMI.volumeData,
      sectorData: sosoMI.sectorData,
      riskContext: sosoMI.riskContext,
    };
    const sodexData: SodexAnalysisData = sodexAvailable
      ? {
          ticker: sodexMS!.ticker,
          orderbook: sodexMS!.orderbook,
          klines: sodexMS!.klines,
          recentTrades: sodexMS!.recentTrades,
          executionPreview: sodexMS!.executionPreview,
          liquidityAnalysis: sodexMS!.liquidityAnalysis,
        }
      : buildNullSodexData();

    const lastUpdatedIso = new Date(finishedAt).toISOString();
    const lastUpdatedDisplay = new Date(finishedAt).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    });

    const dataSourcesUsed: string[] = [
      'SoSoValue: market snapshot, daily klines, sector spotlight, news search, risk context',
      sodexAvailable
        ? 'SoDEX: ticker, orderbook, klines, trades, liquidity, execution preview (public REST)'
        : `SoDEX: unavailable (${sodexError ?? 'network error'}) — SoSoValue-only scoring used`,
    ];

    const dataSourcesReport: DataSourcesReport = {
      lines: [
        'SoSoValue: market intelligence (snapshot, trend/volume from daily klines), sentiment (news search), sector, risk context',
        sodexAvailable
          ? 'SoDEX: ticker, orderbook, klines, recent trades, liquidity/spread, execution preview'
          : `SoDEX unavailable — execution/liquidity factors set to neutral (${sodexError ?? 'network error'})`,
        `Last updated: ${lastUpdatedDisplay}`,
      ],
      lastUpdatedDisplay,
      lastUpdatedIso,
      sosoValue: {
        status: 'connected',
        live: true,
        lastUpdatedIso,
        categories: ['Market snapshot', 'Trend & momentum (1d klines)', 'Volume context', 'News sentiment', 'Sector', 'Risk context'],
        endpoints: sosoMI.meta.endpoints,
      },
      sodex: {
        status: sodexAvailable ? 'connected' : 'error',
        live: sodexAvailable,
        lastUpdatedIso,
        network: sodexMS?.meta.network ?? 'testnet',
        categories: sodexAvailable ? ['Ticker', 'Orderbook', 'Klines', 'Trades', 'Liquidity', 'Execution preview'] : [],
        endpoints: sodexMS?.meta.endpoints ?? [],
        errorMessage: sodexError ?? undefined,
      },
    };

    // Resolve the grading profile once and reuse it, so the decision, the position-size
    // factor and the reported thresholds can never disagree.
    const { config: profileConfig, isCustom } = resolveRiskProfile(
      input.riskProfile,
      input.riskProfileConfig
    );

    const riskFactors = this.calculateRiskFactors(input, sosoData, sodexData, sodexAvailable, profileConfig);
    const riskScore = combineRiskFactors(riskFactors);
    const decision = determineDecision(riskScore, profileConfig);
    const reasons = this.generateReasons(riskFactors, input, sosoData, sodexAvailable ? sodexData : undefined);
    const saferAction = this.generateSaferAction(decision);
    const suggestedPositionSize = this.calculateSaferPositionSize(input.amount, riskScore, profileConfig);
    const confidence = this.calculateConfidence(dataSourcesUsed, sosoData, sodexAvailable ? sodexData : undefined);
    const calibrationBand = getCalibrationBand(riskScore);
    const reliability = getReliabilityNote(confidence, sosoData, sodexAvailable ? sodexData : undefined);

    const bid = sodexAvailable ? parseFloat(sodexMS!.ticker.bidPrice) : 0;
    const ask = sodexAvailable ? parseFloat(sodexMS!.ticker.askPrice) : 0;
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
    const spreadPercent = mid > 0 && ask >= bid ? ((ask - bid) / mid) * 100 : 0;

    // Union of the SoSoValue-side empty inputs and the SoDEX-side ones. positionSize and
    // holdingPeriod are never estimated: they derive from the user's own inputs, not market data.
    const estimatedFactors = Array.from(
      new Set([
        ...sosoMI.meta.degradedInputs,
        ...(sodexAvailable
          ? buildEstimatedSodexFactors(sodexData)
          : (['volatility', 'liquidity', 'execution'] as string[])),
      ])
    );

    return {
      riskScore,
      decision,
      reasons,
      saferAction,
      suggestedPositionSize,
      confidence,
      marketFactors: riskFactors,
      factorWeights: FACTOR_WEIGHTS,
      /** The exact thresholds this score was graded against — shown so a custom profile is auditable. */
      riskProfile: input.riskProfile,
      riskProfileConfig: profileConfig,
      riskProfileIsCustom: isCustom,
      dataSourcesUsed,
      dataSourcesReport,
      estimatedFactors,
      calibration: {
        band: calibrationBand.id,
        label: calibrationBand.label,
        scoreRange: calibrationBand.scoreRange,
        whyThreshold: calibrationBand.whyThreshold,
        typicalCases: calibrationBand.typicalCases,
        failureMode: calibrationBand.failureMode,
      },
      reliability,
      liveSnapshot: {
        sosoPrice: sosoMI.marketSummary.price,
        sosoChange24hPct: sosoMI.marketSummary.change24h,
        sodexLast: sodexMS?.ticker.lastPrice ?? '—',
        sodexBid: sodexMS?.ticker.bidPrice ?? '—',
        sodexAsk: sodexMS?.ticker.askPrice ?? '—',
        sodexVolume: sodexMS?.ticker.volume ?? '—',
        sodexSymbol: sodexMS?.ticker.symbol ?? '—',
        spreadPercent,
      },
    };
  }

  private calculateRiskFactors(
    input: TradeInput,
    sosoData: SosoAnalysisData,
    sodexData: SodexAnalysisData,
    sodexAvailable = true,
    profileConfig?: RiskProfileConfig,
  ): RiskFactorScores {
    const factors: RiskFactorScores = {
      volatility: 50,
      sentiment: 50,
      volume: 50,
      trend: 50,
      liquidity: 50,
      execution: 50,
      sector: 50,
      macro: 50,
      positionSize: 50,
      holdingPeriod: 50,
    };

    // SoSoValue-derived factors (always available)
    if (sosoData.sentiment) {
      factors.sentiment = calculateSentimentRisk(sosoData.sentiment, input.action);
    }
    if (sosoData.volumeData) {
      factors.volume = calculateVolumeRisk(sosoData.volumeData, undefined);
    }
    if (sosoData.assetTrend) {
      factors.trend = calculateTrendRisk(sosoData.assetTrend, input.action);
    }
    if (sosoData.sectorData) {
      factors.sector = calculateSectorRisk(sosoData.sectorData, input.action);
    }
    if (sosoData.riskContext) {
      factors.macro = this.calculateMacroRisk(sosoData.riskContext);
    }

    // SoDEX-derived factors — use real data when available, neutral 50 when not
    if (sodexAvailable) {
      if (sodexData.klines && sodexData.klines.length > 0) {
        factors.volatility = calculateVolatilityFromKlines(sodexData.klines);
      }
      if (sodexData.orderbook) {
        factors.liquidity = this.calculateLiquidityRisk(sodexData.orderbook, input.amount);
      }
      if (sodexData.executionPreview) {
        factors.execution = this.calculateExecutionRisk(sodexData.executionPreview);
      }
    }

    factors.positionSize = calculatePositionSizeRisk(input.amount, profileConfig ?? input.riskProfile);
    factors.holdingPeriod = calculateHoldingPeriodRisk(input.holdingPeriod, factors.volatility);

    return factors;
  }

  private calculateLiquidityRisk(orderbook: SodexAnalysisData['orderbook'] | undefined, amount: number): number {
    if (!orderbook) return 70; // High risk if no orderbook data
    
    // Calculate total liquidity within 2% of mid price
    const bids = orderbook.bids || [];
    const asks = orderbook.asks || [];
    
    if (bids.length === 0 || asks.length === 0) return 90;
    
    const bestBid = parseFloat(bids[0].price);
    const bestAsk = parseFloat(asks[0].price);
    const midPrice = (bestBid + bestAsk) / 2;
    
    let totalLiquidity = 0;
    const threshold = midPrice * 0.02; // 2% from mid
    
    // Sum liquidity within threshold
    for (const bid of bids) {
      if (midPrice - parseFloat(bid.price) <= threshold) {
        totalLiquidity += parseFloat(bid.quantity) * parseFloat(bid.price);
      }
    }
    
    for (const ask of asks) {
      if (parseFloat(ask.price) - midPrice <= threshold) {
        totalLiquidity += parseFloat(ask.quantity) * parseFloat(ask.price);
      }
    }
    
    // Compare to trade size
    const liquidityRatio = totalLiquidity / amount;
    
    if (liquidityRatio < 2) return 90; // Very low liquidity
    if (liquidityRatio < 5) return 70;
    if (liquidityRatio < 10) return 50;
    if (liquidityRatio < 20) return 30;
    return 10;
  }

  private calculateExecutionRisk(executionPreview: SodexExecutionPreview | undefined): number {
    if (!executionPreview) return 70; // High risk if no execution data
    
    let risk = 0;
    
    // Slippage risk
    if (executionPreview.estimatedSlippage > 0.05) risk += 30;
    else if (executionPreview.estimatedSlippage > 0.02) risk += 20;
    else if (executionPreview.estimatedSlippage > 0.01) risk += 10;
    
    // Price impact risk
    if (executionPreview.priceImpact > 0.03) risk += 25;
    else if (executionPreview.priceImpact > 0.01) risk += 15;
    else if (executionPreview.priceImpact > 0.005) risk += 5;
    
    // Execution probability risk
    if (executionPreview.executionProbability < 0.7) risk += 30;
    else if (executionPreview.executionProbability < 0.8) risk += 20;
    else if (executionPreview.executionProbability < 0.9) risk += 10;
    
    // Warnings
    risk += executionPreview.warnings.length * 10;
    
    return Math.min(risk, 100);
  }

  private calculateMacroRisk(riskContext: SosoAnalysisData['riskContext'] | undefined): number {
    if (!riskContext) return 50; // Neutral if no data
    
    let risk = 50;
    
    // Risk level adjustment
    const riskLevelMap = {
      'low': -20,
      'medium': 0,
      'high': 20,
      'extreme': 40
    };
    
    risk += riskLevelMap[riskContext.riskLevel as keyof typeof riskLevelMap] || 0;
    
    // Risk factors count
    risk += riskContext.riskFactors.length * 5;
    
    // Contextual warnings
    risk += riskContext.contextualWarnings.length * 10;
    
    return Math.max(0, Math.min(100, risk));
  }

  private generateReasons(
    risks: Record<string, number>,
    input: TradeInput,
    sosoData?: SosoAnalysisData,
    sodexData?: SodexAnalysisData
  ): string[] {
    const reasons: string[] = [];

    if (risks.volatility > 60) {
      reasons.push('High market volatility increases potential losses');
    }
    if (risks.sentiment > 60) {
      reasons.push(
        input.action === 'buy'
          ? 'Negative market sentiment suggests bearish pressure'
          : 'Positive market sentiment suggests bounce risk against your short'
      );
    }
    if (risks.volume > 60) {
      reasons.push('Declining trading volume indicates weak market interest');
    }
    if (risks.trend > 60) {
      reasons.push(`Current trend works against your ${input.action} position`);
    }
    if (risks.liquidity > 60) {
      reasons.push('Low liquidity may cause execution difficulties');
    }
    if (risks.execution > 60) {
      reasons.push('High execution risk due to market conditions');
    }
    if (risks.sector > 60) {
      reasons.push(
        input.action === 'buy'
          ? 'Sector weakness adds to overall risk'
          : 'Sector strength adds to overall risk on a short'
      );
    }
    if (risks.macro > 60) {
      reasons.push('Macro market conditions are unfavorable');
    }
    if (risks.positionSize > 60) {
      reasons.push('Position size is too large for your risk profile');
    }
    if (risks.holdingPeriod > 60) {
      reasons.push('Short holding period increases timing risk');
    }

    // Add specific warnings from SoDEX execution preview
    if (sodexData?.executionPreview?.warnings) {
      reasons.push(...sodexData.executionPreview.warnings.map((w: string) => `Execution warning: ${w}`));
    }

    // Add specific warnings from SoSoValue risk context
    if (sosoData?.riskContext?.contextualWarnings) {
      reasons.push(...sosoData.riskContext.contextualWarnings.map((w: string) => `Market warning: ${w}`));
    }

    if (reasons.length === 0) {
      reasons.push('Market conditions appear favorable for this trade');
    }

    return reasons;
  }

  private generateSaferAction(decision: Decision): string {
    switch (decision) {
      case 'APPROVE':
        return 'Proceed with the trade as planned';
      case 'CAUTION':
        return 'Consider reducing position size by 25-50% or wait for better entry';
      case 'REDUCE_OR_WAIT':
        return 'Reduce position size by 50-75% or wait for market confirmation';
      case 'BLOCK':
        return 'Avoid this trade - wait for better market conditions';
      default:
        return 'Review market conditions before proceeding';
    }
  }

  /** Formats the engine's recommended reduction for display. */
  private calculateSaferPositionSize(
    amount: number,
    riskScore: number,
    profile: RiskProfileInput
  ): string {
    const saferAmount = saferPositionAmount(amount, riskScore);
    if (saferAmount === null) return 'Current size is appropriate';

    // Scale the floor to the profile's tolerance so a conservative profile's suggestion is
    // expressed against its own $1k reference rather than an arbitrary global constant.
    const tolerance = toProfileConfig(profile).positionToleranceUsd;

    return `Consider reducing to $${Math.round(saferAmount).toLocaleString()} (tolerance $${tolerance.toLocaleString()})`;
  }

  private calculateConfidence(_dataSourcesUsed: string[], sosoData?: SosoAnalysisData, sodexData?: SodexAnalysisData): number {
    let confidence = 0.55;

    if ((sodexData?.liquidityAnalysis?.marketDepth ?? 0) > 0) {
      confidence += 0.12;
    }

    if (sosoData?.sentiment && sosoData.sentiment.newsCount > 0) {
      confidence += 0.08;
    }

    if (sodexData?.ticker?.volume && parseFloat(sodexData.ticker.volume) > 0) {
      confidence += 0.05;
    }

    const warningCount = sodexData?.executionPreview?.warnings?.length ?? 0;
    if (warningCount > 0) {
      confidence -= warningCount * 0.04;
    }

    return Math.max(0.35, Math.min(1.0, confidence));
  }
}

export const riskEngine = new RiskEngine();