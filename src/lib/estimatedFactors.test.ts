import { describe, it, expect } from 'vitest';
import { buildEstimatedSodexFactors, type SodexAnalysisData } from './riskEngine';

// The fields are typed as always present, but the engine guards every one of them with a runtime
// check, so a provider response really can leave them undefined. The parameter is loosely typed on
// purpose: these fixtures are simulating partial runtime data that the declared type disallows.
const withSodex = (partial: Record<string, unknown>): SodexAnalysisData =>
  partial as unknown as SodexAnalysisData;

const klines = (n: number) => Array.from({ length: n }, () => ({ close: '100' }));

describe('buildEstimatedSodexFactors', () => {
  it('reports nothing estimated when every input is present', () => {
    expect(
      buildEstimatedSodexFactors(
        withSodex({ klines: klines(30), orderbook: {}, executionPreview: {} })
      )
    ).toEqual([]);
  });

  describe('volatility', () => {
    it('is estimated when klines are missing entirely', () => {
      const estimated = buildEstimatedSodexFactors(withSodex({ orderbook: {}, executionPreview: {} }));
      expect(estimated).toContain('volatility');
    });

    it('is estimated when only one or two klines arrive', () => {
      // The subtle case: the factor calculation does call the volatility helper with these, and
      // the helper quietly returns a neutral 50 because fewer than 3 closes means fewer than 2
      // returns to take a standard deviation of. The score looks measured and is not.
      expect(buildEstimatedSodexFactors(withSodex({ klines: klines(1) }))).toContain('volatility');
      expect(buildEstimatedSodexFactors(withSodex({ klines: klines(2) }))).toContain('volatility');
    });

    it('is measured once there are enough klines for two returns', () => {
      expect(buildEstimatedSodexFactors(withSodex({ klines: klines(3) }))).not.toContain(
        'volatility'
      );
    });
  });

  it('flags liquidity when the orderbook is missing', () => {
    expect(
      buildEstimatedSodexFactors(withSodex({ klines: klines(30), executionPreview: {} }))
    ).toEqual(['liquidity']);
  });

  it('flags execution when the execution preview is missing', () => {
    expect(buildEstimatedSodexFactors(withSodex({ klines: klines(30), orderbook: {} }))).toEqual([
      'execution',
    ]);
  });

  it('flags all three when SoDEX returned nothing usable', () => {
    expect(buildEstimatedSodexFactors(withSodex({}))).toEqual([
      'volatility',
      'liquidity',
      'execution',
    ]);
  });

  it('does not flag a factor that measured 50 for real', () => {
    // A sector or sentiment factor that legitimately lands on 50 is a measurement. Only inputs
    // that were absent count, which is why this walks the presence checks and not the scores.
    const estimated = buildEstimatedSodexFactors(
      withSodex({ klines: klines(30), orderbook: {}, executionPreview: {} })
    );
    expect(estimated).not.toContain('sector');
    expect(estimated).not.toContain('sentiment');
  });
});
