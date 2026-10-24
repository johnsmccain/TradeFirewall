import { describe, it, expect } from 'vitest';
import {
  FACTOR_BAND_LABEL,
  RISK_BAND_LABEL,
  RISK_BAND_TEXT_CLASS,
  confidenceColor,
  decisionLabel,
  decisionTint,
  factorBand,
  isHighRisk,
  riskBand,
  type RiskBand,
} from './riskBand';
import { BUILT_IN_RISK_PROFILES } from './riskProfiles';

describe('riskBand', () => {
  it('classifies every score into exactly one band', () => {
    const seen = new Set<RiskBand>();
    for (let s = 0; s <= 100; s++) seen.add(riskBand(s));
    expect(seen).toEqual(new Set(['low', 'moderate', 'high', 'critical']));
  });

  it('treats each cut-off as the first score of its band', () => {
    expect(riskBand(25)).toBe('low');
    expect(riskBand(26)).toBe('moderate');
    expect(riskBand(50)).toBe('moderate');
    expect(riskBand(51)).toBe('high');
    expect(riskBand(75)).toBe('high');
    expect(riskBand(76)).toBe('critical');
    expect(riskBand(100)).toBe('critical');
  });

  it('is monotonic: a higher score never gets a calmer band', () => {
    const rank: Record<RiskBand, number> = { low: 0, moderate: 1, high: 2, critical: 3 };
    for (let s = 1; s <= 100; s++) {
      expect(rank[riskBand(s)]).toBeGreaterThanOrEqual(rank[riskBand(s - 1)]);
    }
  });

  it('agrees with the confirmation gate threshold that shows on every high-risk trade', () => {
    // check-trade opens the gate at >= 51, so that must be exactly the bottom of the `high`
    // band — otherwise the gate appears on a score the UI still calls "Moderate Risk".
    expect(riskBand(51)).toBe('high');
    expect(riskBand(50)).toBe('moderate');
  });

  it('has a label and a colour for every band', () => {
    for (const band of ['low', 'moderate', 'high', 'critical'] as const) {
      expect(RISK_BAND_LABEL[band]).toBeTruthy();
      expect(RISK_BAND_TEXT_CLASS[band]).toBeTruthy();
    }
  });

  it('has a distinct colour per band', () => {
    const classes = Object.values(RISK_BAND_TEXT_CLASS);
    expect(new Set(classes).size).toBe(classes.length);
  });
});

describe('isHighRisk', () => {
  it('is the inverse of the low and moderate bands', () => {
    for (let s = 0; s <= 100; s++) {
      const band = riskBand(s);
      expect(isHighRisk(s)).toBe(band === 'high' || band === 'critical');
    }
  });

  it('switches on at the bottom of the high band', () => {
    expect(isHighRisk(50)).toBe(false);
    expect(isHighRisk(51)).toBe(true);
  });
});

describe('factorBand', () => {
  it('uses tighter cut-offs than the composite score', () => {
    // 70 is `high` for a single factor but only `high`, not `critical`, for a total score.
    expect(factorBand(70)).toBe('high');
    expect(riskBand(70)).toBe('high');
    expect(riskBand(80)).toBe('critical');
    expect(factorBand(80)).toBe('high');
  });

  it('treats each cut-off as the first value of its band', () => {
    expect(factorBand(29)).toBe('minimal');
    expect(factorBand(30)).toBe('low');
    expect(factorBand(49)).toBe('low');
    expect(factorBand(50)).toBe('medium');
    expect(factorBand(69)).toBe('medium');
    expect(factorBand(70)).toBe('high');
  });

  it('labels every band', () => {
    for (const b of ['minimal', 'low', 'medium', 'high'] as const) {
      expect(FACTOR_BAND_LABEL[b]).toBeTruthy();
    }
  });
});

describe('decisionLabel', () => {
  it('reads REDUCE_OR_WAIT as an instruction, not the raw enum', () => {
    expect(decisionLabel('REDUCE_OR_WAIT')).toBe('REDUCE / WAIT');
  });

  it('passes the single-word decisions through', () => {
    expect(decisionLabel('APPROVE')).toBe('APPROVE');
    expect(decisionLabel('BLOCK')).toBe('BLOCK');
  });

  it('does not throw on an unrecognised value from localStorage', () => {
    expect(decisionLabel('NONSENSE')).toBe('NONSENSE');
  });
});

describe('decisionTint', () => {
  it('falls back to neutral for an unknown decision rather than crashing', () => {
    expect(decisionTint('corrupted')).toBe(
      'bg-surface text-text-primary border-border'
    );
  });

  it('gives a distinct tint per decision', () => {
    const tints = ['APPROVE', 'CAUTION', 'REDUCE_OR_WAIT', 'BLOCK'].map(decisionTint);
    expect(new Set(tints).size).toBe(4);
  });
});

describe('confidenceColor', () => {
  it('treats confidence as a fraction, not a score out of 100', () => {
    expect(confidenceColor(0.9)).toBe('bg-success');
    expect(confidenceColor(0.8)).toBe('bg-success');
    expect(confidenceColor(0.7)).toBe('bg-primary');
    expect(confidenceColor(0.5)).toBe('bg-warning');
    expect(confidenceColor(0.1)).toBe('bg-danger');
  });
});

describe('band agreement with the decision ladder', () => {
  it('flags a trade as high risk at the point a conservative profile blocks it', () => {
    // conservative blocks above 60; the UI must already be calling that range high risk.
    const { reduce } = BUILT_IN_RISK_PROFILES.conservative;
    expect(isHighRisk(reduce + 1)).toBe(true);
    expect(isHighRisk(reduce)).toBe(true);
  });
});
