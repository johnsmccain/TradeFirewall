import { describe, it, expect } from 'vitest';
import { buildDataDisclosure } from './dataDisclosure';

const FACTORS = {
  volatility: 70,
  sentiment: 40,
  volume: 30,
  trend: 20,
  liquidity: 45,
  execution: 25,
  sector: 50,
  macro: 35,
};

describe('buildDataDisclosure', () => {
  it('reports complete coverage when nothing was estimated', () => {
    const d = buildDataDisclosure([], FACTORS, true);
    expect(d.complete).toBe(true);
    expect(d.estimated).toEqual([]);
    expect(d.impact).toBe('');
    expect(d.summary).toMatch(/usable data for every factor/i);
  });

  it('treats an undefined estimate list as complete, not as unknown', () => {
    // A missing field must not read as "everything is degraded" or, worse, as a guarantee.
    expect(buildDataDisclosure(undefined, FACTORS, true).complete).toBe(true);
  });

  it('never claims full real-data coverage while a factor is estimated', () => {
    // The exact regression: the old copy said "every factor above is scored on real data"
    // whenever both providers responded, which is true even when they responded with nothing.
    const d = buildDataDisclosure(['sentiment'], FACTORS, true);
    expect(d.complete).toBe(false);
    expect(d.summary).not.toMatch(/every factor/i);
    expect(d.summary).not.toMatch(/usable data for every factor/i);
  });

  it('names each estimated factor and why', () => {
    const d = buildDataDisclosure(['sentiment'], FACTORS, true);
    expect(d.estimated).toEqual([
      {
        key: 'sentiment',
        label: 'Sentiment',
        reason: 'No recent headlines were returned for this asset',
        score: 40,
      },
    ]);
  });

  it('reports the actual score used as the stand-in', () => {
    expect(buildDataDisclosure(['volatility'], FACTORS, true).estimated[0].score).toBe(70);
  });

  it('falls back to a neutral 50 when the score is absent', () => {
    expect(buildDataDisclosure(['sector'], undefined, true).estimated[0].score).toBe(50);
  });

  it('distinguishes an empty response from an unreachable provider', () => {
    const empty = buildDataDisclosure(['liquidity'], FACTORS, true);
    const down = buildDataDisclosure(['liquidity'], FACTORS, false);
    expect(empty.summary).toMatch(/without usable data/i);
    expect(down.summary).toMatch(/unreachable/i);
  });

  it('deduplicates and orders factors stably', () => {
    // SoDEX down plus a degraded SoSoValue input can name the same factor twice; the disclosure
    // must not list it twice, and must not reshuffle between renders.
    const d = buildDataDisclosure(
      ['sector', 'volatility', 'sector', 'sentiment', 'volatility'],
      FACTORS,
      true
    );
    expect(d.estimated.map((f) => f.key)).toEqual(['volatility', 'sentiment', 'sector']);
  });

  it('reads naturally for one factor and for several', () => {
    expect(buildDataDisclosure(['sector'], FACTORS, true).summary).toContain('Sector was');
    const many = buildDataDisclosure(['volatility', 'sentiment', 'sector'], FACTORS, true).summary;
    expect(many).toContain('Volatility, Sentiment and Sector were');
    expect(many).not.toContain(',,');
  });

  it('ignores factor keys it does not recognise rather than rendering a raw key', () => {
    // Guards against an unknown key from a future engine change reaching the UI as "fooBar".
    const d = buildDataDisclosure(['sentiment', 'quantumEntanglement'], FACTORS, true);
    expect(d.estimated.map((f) => f.key)).toEqual(['sentiment']);
  });

  it('tells the user how to read the score when degraded', () => {
    const d = buildDataDisclosure(['volatility'], FACTORS, false);
    expect(d.impact).toMatch(/neutral placeholder/i);
    expect(d.impact).toMatch(/floor/i);
  });
});
