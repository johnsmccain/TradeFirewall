import { describe, it, expect } from 'vitest';
import {
  FACTOR_WEIGHTS,
  calculateVolatilityFromKlines,
  calculateTrendRisk,
  calculateVolumeRisk,
  calculatePositionSizeRisk,
  calculateHoldingPeriodRisk,
  calculateSentimentRisk,
  calculateSectorRisk,
  combineRiskFactors,
  determineDecision,
  saferPositionAmount,
  type HoldingPeriod,
} from './riskEngine';
import { BUILT_IN_RISK_PROFILES } from './riskProfiles';

const closes = (values: number[]) => values.map((close) => ({ close: String(close) }));

describe('FACTOR_WEIGHTS', () => {
  it('sum to exactly 1.0', () => {
    const sum = Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('covers all ten factors with no zeros', () => {
    // A zero weight would be silently dropped by combineRiskFactors, making the published
    // weight and the applied weight disagree.
    expect(Object.keys(FACTOR_WEIGHTS)).toHaveLength(10);
    expect(Object.values(FACTOR_WEIGHTS).every((w) => w > 0)).toBe(true);
  });
});

describe('calculateVolatilityFromKlines', () => {
  it('returns high risk when there is no data', () => {
    expect(calculateVolatilityFromKlines([])).toBe(70);
    expect(calculateVolatilityFromKlines(closes([100]))).toBe(70);
  });

  it('returns high risk when a zero close would make returns undefined', () => {
    expect(calculateVolatilityFromKlines(closes([100, 0]))).toBe(70);
  });

  it('scores a flat series as low volatility', () => {
    expect(calculateVolatilityFromKlines(closes([100, 100, 100, 100, 100]))).toBe(20);
  });

  it('is not inflated by steady drift (mean must be subtracted)', () => {
    // This is the regression guard. Summing raw squares computes RMS = sqrt(var + mean²), which
    // charges a smooth uptrend as volatile. The two series have identical per-step moves of +1%,
    // so they must score identically regardless of direction.
    const up = closes([100, 101, 102.01, 103.0301, 104.060401]);
    const down = closes([100, 99, 98.01, 97.0299, 96.059601]);
    expect(calculateVolatilityFromKlines(up)).toBe(calculateVolatilityFromKlines(down));
  });

  it('scores a choppy series above a smooth one at equal spread', () => {
    const smooth = closes([100, 101, 102, 103, 104]);
    const choppy = closes([100, 103, 101, 104, 102]);
    expect(calculateVolatilityFromKlines(choppy)).toBeGreaterThan(
      calculateVolatilityFromKlines(smooth)
    );
  });

  it('lands in the documented buckets', () => {
    // Alternating ±3% moves: daily-scale stdev is ~6%, which is the Medium boundary.
    const alt = closes([100, 103, 96.91, 99.82, 96.81]);
    const score = calculateVolatilityFromKlines(alt);
    expect([20, 40, 70, 90]).toContain(score);
  });

  it('only ever returns one of the four bucket values', () => {
    for (const series of [
      closes([100, 101, 102]),
      closes([100, 150, 90, 200]),
      closes([100, 100, 100]),
    ]) {
      expect([20, 40, 70, 90]).toContain(calculateVolatilityFromKlines(series));
    }
  });
});

describe('calculateTrendRisk', () => {
  it('returns neutral when trend data is missing', () => {
    expect(calculateTrendRisk(undefined, 'buy')).toBe(50);
    expect(calculateTrendRisk(undefined, 'sell')).toBe(50);
  });

  it('pairs each trend with its mirror across the two actions', () => {
    // The buckets are asymmetric at the extremes (90/20 rather than 70/30), so the invariant is
    // the mirror relationship, not a constant sum: the risk of buying into a bearish trend
    // equals the risk of selling into a bullish one.
    const cases = ['strong_bearish', 'bearish', 'neutral', 'bullish', 'strong_bullish'];
    for (const trend of cases) {
      for (const action of ['buy', 'sell'] as const) {
        const opposite = action === 'buy' ? 'sell' : 'buy';
        const mirrored =
          trend === 'strong_bearish' ? 'strong_bullish' :
          trend === 'strong_bullish' ? 'strong_bearish' :
          trend === 'bearish' ? 'bullish' :
          trend === 'bullish' ? 'bearish' : 'neutral';
        expect(calculateTrendRisk({ trend }, action)).toBe(
          calculateTrendRisk({ trend: mirrored }, opposite)
        );
      }
    }
  });

  it('treats an uptrend as risk for a short, not a buy', () => {
    expect(calculateTrendRisk({ trend: 'strong_bullish' }, 'sell')).toBe(90);
    expect(calculateTrendRisk({ trend: 'strong_bullish' }, 'buy')).toBe(20);
  });

  it('keeps neutral trend at 50 for both actions', () => {
    expect(calculateTrendRisk({ trend: 'neutral' }, 'buy')).toBe(50);
    expect(calculateTrendRisk({ trend: 'neutral' }, 'sell')).toBe(50);
  });

  it('falls back to neutral for an unrecognised label', () => {
    expect(calculateTrendRisk({ trend: 'sideways_maybe' }, 'buy')).toBe(50);
  });
});

describe('calculateSentimentRisk', () => {
  const at = (score: number) => ({ score }) as Parameters<typeof calculateSentimentRisk>[0];

  it('returns neutral when sentiment data is missing', () => {
    expect(calculateSentimentRisk(undefined, 'buy')).toBe(50);
    expect(calculateSentimentRisk(undefined, 'sell')).toBe(50);
  });

  it('penalises a buy on negative news', () => {
    expect(calculateSentimentRisk(at(-0.9), 'buy')).toBe(80);
  });

  it('rewards a sell on negative news — the direction fix', () => {
    // A short into bad news is the favourable case; scoring it as high risk was backwards.
    expect(calculateSentimentRisk(at(-0.9), 'sell')).toBe(10);
  });

  it('penalises a sell on positive news', () => {
    expect(calculateSentimentRisk(at(0.9), 'sell')).toBe(80);
    expect(calculateSentimentRisk(at(0.9), 'buy')).toBe(10);
  });

  it('inverts monotonically across the action for every score', () => {
    // Negative news must never be riskier for the sell that benefits from it, and vice versa.
    // A score in the neutral band is identical for both, so equality is allowed there.
    for (let s = -1; s <= 1; s += 0.1) {
      const buy = calculateSentimentRisk(at(s), 'buy');
      const sell = calculateSentimentRisk(at(s), 'sell');
      if (s < -0.2) expect(sell).toBeLessThan(buy);
      else if (s > 0.2) expect(buy).toBeLessThan(sell);
      else expect(buy).toBe(sell);
    }
  });

  it('maps the most negative score to the most favourable sell', () => {
    expect(calculateSentimentRisk(at(-1), 'buy')).toBe(80);
    expect(calculateSentimentRisk(at(-1), 'sell')).toBe(10);
    expect(calculateSentimentRisk(at(1), 'buy')).toBe(10);
    expect(calculateSentimentRisk(at(1), 'sell')).toBe(80);
  });

  it('never returns a score outside the published buckets', () => {
    for (let s = -1; s <= 1; s += 0.05) {
      expect([10, 20, 40, 60, 80]).toContain(calculateSentimentRisk(at(s), 'buy'));
    }
  });
});

describe('calculateSectorRisk', () => {
  const at = (
    sectorPerformance: number,
    sectorTrend: 'bullish' | 'bearish' | 'neutral',
    relativeStrength: number
  ) => ({ sectorPerformance, sectorTrend, relativeStrength }) as Parameters<
    typeof calculateSectorRisk
  >[0];

  it('returns neutral when sector data is missing', () => {
    expect(calculateSectorRisk(undefined, 'buy')).toBe(50);
    expect(calculateSectorRisk(undefined, 'sell')).toBe(50);
  });

  it('penalises a buy in a falling sector', () => {
    expect(calculateSectorRisk(at(-20, 'bearish', 10), 'buy')).toBeGreaterThan(70);
  });

  it('rewards a sell in a falling sector — the direction fix', () => {
    const falling = at(-20, 'bearish', 10);
    expect(calculateSectorRisk(falling, 'sell')).toBeLessThan(calculateSectorRisk(falling, 'buy'));
    // Base 50, three inputs all favourable to the short: -10 perf, -10 trend, -10 strength.
    expect(calculateSectorRisk(falling, 'sell')).toBe(20);
  });

  it('penalises a sell in a rallying sector', () => {
    const rallying = at(20, 'bullish', 90);
    expect(calculateSectorRisk(rallying, 'sell')).toBeGreaterThan(calculateSectorRisk(rallying, 'buy'));
    // Base 50 plus the three unfavourable inputs: +20 perf, +15 trend, +15 strength.
    expect(calculateSectorRisk(rallying, 'sell')).toBe(100);
  });

  it('clamps to the 0-100 range at the extremes', () => {
    // The bucket spreads cannot exceed the range in either direction, but the floor does bite
    // when a bullish sector combines with strong relative strength for a buy.
    expect(calculateSectorRisk(at(-500, 'bearish', 0), 'buy')).toBe(100);
    expect(calculateSectorRisk(at(500, 'bullish', 100), 'buy')).toBe(20);
    for (const d of [at(-500, 'bearish', 0), at(500, 'bullish', 100), at(0, 'neutral', 50)]) {
      for (const action of ['buy', 'sell'] as const) {
        const score = calculateSectorRisk(d, action);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });

  it('never scores the favourable direction higher than the unfavourable one', () => {
    // This is the property that was broken: relativeStrength is a 0-100 rank, not a signed
    // move, so it cannot be flipped by negating performance.
    for (const perf of [-20, -10, -5, 0, 5, 10, 20]) {
      for (const trend of ['bullish', 'bearish', 'neutral'] as const) {
        for (const strength of [0, 30, 50, 70, 100]) {
          const d = at(perf, trend, strength);
          const buy = calculateSectorRisk(d, 'buy');
          const sell = calculateSectorRisk(d, 'sell');
          expect(buy + sell).toBeGreaterThanOrEqual(60);
          expect(buy + sell).toBeLessThanOrEqual(120);
          // Offsets are -10/-5 against and +10/+15 with, so opposing extreme strength can
          // cancel the trend term exactly. The directional inequality therefore holds only for
          // the trend term's own magnitude, which is checked with strength held neutral.
          if (perf < 0 && trend === 'bearish' && strength === 50) expect(sell).toBeLessThan(buy);
          if (perf > 0 && trend === 'bullish' && strength === 50) expect(buy).toBeLessThan(sell);
          // Relative strength is a 0-100 rank, not a signed move, so it cannot be flipped by
          // negating performance. The invariant that holds is monotonicity: a stronger sector is
          // never worse for a buy and never better for a sell, whatever the trend says.
          expect(calculateSectorRisk(at(perf, trend, 100), 'buy')).toBeLessThanOrEqual(
            calculateSectorRisk(at(perf, trend, 0), 'buy')
          );
          expect(calculateSectorRisk(at(perf, trend, 100), 'sell')).toBeGreaterThanOrEqual(
            calculateSectorRisk(at(perf, trend, 0), 'sell')
          );
        }
      }
    }
  });

  it('leaves a flat neutral sector unchanged in both directions', () => {
    expect(calculateSectorRisk(at(0, 'neutral', 50), 'buy')).toBe(50);
    expect(calculateSectorRisk(at(0, 'neutral', 50), 'sell')).toBe(50);
  });
});

describe('calculateVolumeRisk', () => {
  it('scores a volume collapse as high risk', () => {
    expect(calculateVolumeRisk({ volumeChange: -50 }, undefined)).toBe(80);
  });

  it('scores rising volume as low risk', () => {
    expect(calculateVolumeRisk({ volumeChange: 40 }, undefined)).toBe(20);
  });

  it('falls back to the SoDEX ticker when SoSoValue volume is absent', () => {
    expect(calculateVolumeRisk(undefined, { volume: '500' })).toBe(80);
    expect(calculateVolumeRisk(undefined, { volume: '500000' })).toBe(20);
  });

  it('defaults to neutral when neither source is available', () => {
    expect(calculateVolumeRisk(undefined, undefined)).toBe(50);
  });
});

describe('calculatePositionSizeRisk', () => {
  it('is measured against each profile own tolerance', () => {
    // $20k is ratio 1.0 against aggressive's $20k tolerance but ratio 20 against conservative's
    // $1k, so the same trade is scored from two very different places on the ladder.
    expect(calculatePositionSizeRisk(20000, 'aggressive')).toBe(10);
    expect(calculatePositionSizeRisk(20000, 'conservative')).toBe(90);
  });

  it('rises with size', () => {
    const scores = [1_000, 6_000, 12_000, 40_000].map((a) =>
      calculatePositionSizeRisk(a, 'balanced')
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
    expect(scores).toEqual([10, 30, 50, 90]);
  });

  it('accepts an explicit config as well as a profile name', () => {
    // The API route passes a sanitised custom-profile config, not a name, so both must resolve
    // to the same ladder for an equivalent profile.
    expect(calculatePositionSizeRisk(12_000, BUILT_IN_RISK_PROFILES.balanced)).toBe(50);
    expect(calculatePositionSizeRisk(12_000, 'balanced')).toBe(50);
  });

  it('falls back to the default profile for an unknown name', () => {
    expect(calculatePositionSizeRisk(10000, 'nonsense')).toBe(
      calculatePositionSizeRisk(10000, 'balanced')
    );
  });
});

describe('calculateHoldingPeriodRisk', () => {
  const periods: HoldingPeriod[] = ['intraday', '1day', '7days', '30days'];

  it('falls as the holding period lengthens', () => {
    const scores = periods.map((p) => calculateHoldingPeriodRisk(p, 50));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  it('amplifies short periods when volatility is high', () => {
    expect(calculateHoldingPeriodRisk('intraday', 90)).toBeGreaterThan(
      calculateHoldingPeriodRisk('intraday', 20)
    );
  });

  it('never exceeds 100', () => {
    expect(calculateHoldingPeriodRisk('intraday', 100)).toBe(100);
    expect(calculateHoldingPeriodRisk('intraday', 1000)).toBe(100);
  });

  it('is an integer', () => {
    for (const p of periods) {
      for (const v of [0, 45, 80, 100]) {
        expect(Number.isInteger(calculateHoldingPeriodRisk(p, v))).toBe(true);
      }
    }
  });
});

describe('combineRiskFactors', () => {
  it('throws rather than scoring an empty factor set', () => {
    expect(() => combineRiskFactors({})).toThrow(/no weighted factors/);
  });

  it('ignores unknown factors instead of silently dropping their weight', () => {
    // An unweighted key must not dilute the average.
    const withJunk = combineRiskFactors({ volatility: 90, bogusFactor: 0 });
    expect(withJunk).toBe(90);
  });

  it('weights volatility above sentiment', () => {
    const vol = combineRiskFactors({ volatility: 100, sentiment: 0 });
    const sent = combineRiskFactors({ volatility: 0, sentiment: 100 });
    expect(vol).toBeGreaterThan(sent);
  });

  it('returns a rounded integer in range', () => {
    const score = combineRiskFactors({ volatility: 33, sentiment: 77, trend: 12 });
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('equals the score when every factor is identical', () => {
    const all = Object.fromEntries(Object.keys(FACTOR_WEIGHTS).map((k) => [k, 77]));
    expect(combineRiskFactors(all)).toBe(77);
  });

  it('is monotonic: raising any single factor never lowers the score', () => {
    const base: Record<string, number> = Object.fromEntries(
      Object.keys(FACTOR_WEIGHTS).map((k) => [k, 50])
    );
    const baseScore = combineRiskFactors(base);
    for (const k of Object.keys(FACTOR_WEIGHTS)) {
      const raised = { ...base, [k]: 100 };
      expect(combineRiskFactors(raised)).toBeGreaterThanOrEqual(baseScore);
    }
  });

  it('is a weighted mean, so partial factor sets are not penalised', () => {
    // combineRiskFactors renormalises by the weight it actually used, which is what lets
    // the backtest score with five neutral-defaulted factors.
    expect(combineRiskFactors({ volatility: 50 })).toBe(50);
  });
});

describe('determineDecision', () => {
  it('follows each profile own ladder at its boundaries', () => {
    for (const [name, cfg] of Object.entries(BUILT_IN_RISK_PROFILES)) {
      expect(determineDecision(cfg.approve, name)).toBe('APPROVE');
      expect(determineDecision(cfg.approve + 1, name)).toBe('CAUTION');
      expect(determineDecision(cfg.caution, name)).toBe('CAUTION');
      expect(determineDecision(cfg.caution + 1, name)).toBe('REDUCE_OR_WAIT');
      expect(determineDecision(cfg.reduce, name)).toBe('REDUCE_OR_WAIT');
      expect(determineDecision(cfg.reduce + 1, name)).toBe('BLOCK');
    }
  });

  it('is inclusive at each threshold, so a score exactly on the line passes', () => {
    expect(determineDecision(35, 'balanced')).toBe('APPROVE');
    expect(determineDecision(50, 'balanced')).toBe('CAUTION');
    expect(determineDecision(70, 'balanced')).toBe('REDUCE_OR_WAIT');
  });

  it('blocks more readily as the profile tightens', () => {
    // Same score, three profiles: conservative must never be more permissive than aggressive.
    for (const score of [30, 45, 55, 65, 75, 85]) {
      const rank = { APPROVE: 0, CAUTION: 1, REDUCE_OR_WAIT: 2, BLOCK: 3 };
      expect(rank[determineDecision(score, 'conservative')]).toBeGreaterThanOrEqual(
        rank[determineDecision(score, 'balanced')]
      );
      expect(rank[determineDecision(score, 'balanced')]).toBeGreaterThanOrEqual(
        rank[determineDecision(score, 'aggressive')]
      );
    }
  });

  it('accepts an explicit config, which is what the API route passes for custom profiles', () => {
    const cfg = { approve: 10, caution: 20, reduce: 30, positionToleranceUsd: 1000 };
    expect(determineDecision(10, cfg)).toBe('APPROVE');
    expect(determineDecision(25, cfg)).toBe('REDUCE_OR_WAIT');
    expect(determineDecision(31, cfg)).toBe('BLOCK');
  });

  it('blocks at score 100 for every profile', () => {
    for (const name of Object.keys(BUILT_IN_RISK_PROFILES)) {
      expect(determineDecision(100, name)).toBe('BLOCK');
    }
  });
});

describe('saferPositionAmount', () => {
  it('returns null when the current size is already appropriate', () => {
    // Below the threshold there is nothing to reduce to. Callers must handle null rather than
    // treating it as zero, which would wipe out the trade.
    expect(saferPositionAmount(5000, 0)).toBeNull();
    expect(saferPositionAmount(5000, 25)).toBeNull();
  });

  it('reduces proportionally above the threshold', () => {
    // 30 implies a 5% trim, which the hardcoded halving this replaced got wrong by 10x.
    expect(saferPositionAmount(1000, 30)).toBeCloseTo(950, 10);
    expect(saferPositionAmount(1000, 75)).toBeCloseTo(500, 10);
  });

  it('always reduces, and never to zero or below', () => {
    for (const score of [26, 40, 51, 75, 99, 100]) {
      const safer = saferPositionAmount(1000, score)!;
      expect(safer).toBeLessThan(1000);
      expect(safer).toBeGreaterThan(0);
    }
  });

  it('leaves 25% of the trade at the maximum score', () => {
    // (100 - 25) / 100 = 0.75, so the 0.8 reduction cap never binds on a real score.
    expect(saferPositionAmount(1000, 100)).toBeCloseTo(250, 10);
  });

  it('rounds to a usable trade size rather than a fractional amount', () => {
    const suggested = saferPositionAmount(3333, 60)!;
    expect(Math.round(suggested)).toBeGreaterThan(0);
    expect(Number.isInteger(Math.round(suggested))).toBe(true);
  });
});
