import { describe, it, expect } from 'vitest';
import { mapAnalyzeError, type AnalyzeErrorKind } from './analyzeErrors';
import { SoSoValueHttpError, SoSoValueTimeoutError } from './sosovalue';

/**
 * Regression coverage for a bug that shipped: a user who mistyped a ticker was told to add
 * SOSOVALUE_API_KEY to .env.local and restart the dev server. The client matched on substrings, and
 * "Currency FOO not found in SoSoValue currency list" contains "SoSoValue", so it fell into the
 * API-key branch. The server has been sending `errorType` the whole time; these tests pin the
 * mapping off that field so message text can no longer decide the outcome.
 */

describe('mapAnalyzeError', () => {
  describe('the reported misroute', () => {
    const body = {
      error: 'Currency FOO not found in SoSoValue currency list',
      errorType: 'SYMBOL_NOT_FOUND_SOSOVALUE',
      suggestion: 'Pick a symbol that appears in SoSoValue GET /currencies (often majors like BTC, ETH).',
    };

    it('treats an unknown ticker as the user\'s input, not a deployment fault', () => {
      const info = mapAnalyzeError(body, { symbol: 'FOO' });
      expect(info.kind).toBe('symbol-not-found');
    });

    it('never tells the user to edit an environment file for their own typo', () => {
      const info = mapAnalyzeError(body, { symbol: 'FOO' });
      expect(info.message).not.toMatch(/API_KEY/);
      expect(info.message).not.toMatch(/\.env/);
      expect(info.message).not.toMatch(/restart/i);
    });

    it('names the submitted symbol so the fix is obvious', () => {
      expect(mapAnalyzeError(body, { symbol: 'FOO' }).message).toContain('"FOO"');
    });

    it('keeps the raw upstream text out of the primary message', () => {
      // The raw message is what leaked the provider name into a user-facing error before.
      expect(mapAnalyzeError(body, { symbol: 'FOO' }).message).not.toContain('currency list');
    });

    it('is not retryable — resubmitting the same symbol cannot help', () => {
      expect(mapAnalyzeError(body, { symbol: 'FOO' }).retryable).toBe(false);
    });
  });

  describe('errorType routing', () => {
    const cases: Array<[string, AnalyzeErrorKind]> = [
      ['API_CONNECTION_ERROR', 'config'],
      ['SOSOVALUE_KEY_MISSING', 'config'],
      ['SYMBOL_NOT_FOUND_SOSOVALUE', 'symbol-not-found'],
      ['SYMBOL_NOT_FOUND', 'symbol-not-found'],
      ['RATE_LIMITED', 'rate-limited'],
      ['UPSTREAM_TIMEOUT', 'upstream-timeout'],
      ['SOSOVALUE_HTTP_ERROR', 'upstream-unavailable'],
      ['SOSOVALUE_API_ERROR', 'upstream-unavailable'],
      ['SODEX_ERROR', 'upstream-unavailable'],
      ['SODEX_MARKET_ERROR', 'upstream-unavailable'],
      ['INSUFFICIENT_DATA', 'data-unavailable'],
      ['INVALID_TRADE_INPUT', 'invalid-input'],
      ['ANALYSIS_ERROR', 'unknown'],
    ];

    it.each(cases)('routes %s to kind %s', (errorType, expected) => {
      expect(mapAnalyzeError({ error: 'boom', errorType }).kind).toBe(expected);
    });

    it('does not let an unknown errorType fall through to a provider-name guess', () => {
      // A new server-side type must degrade to 'unknown', never be re-derived from the message.
      const info = mapAnalyzeError({
        error: 'Something involving SoSoValue failed',
        errorType: 'SOME_FUTURE_TYPE',
      });
      expect(info.kind).toBe('unknown');
    });
  });

  describe('configuration vs upstream failures stay distinct', () => {
    it('blames the deployment only for a missing key', () => {
      const info = mapAnalyzeError({ error: 'no key', errorType: 'API_CONNECTION_ERROR' });
      expect(info.kind).toBe('config');
      expect(info.retryable).toBe(false);
    });

    it.each([
      'RATE_LIMITED',
      'UPSTREAM_TIMEOUT',
      'SOSOVALUE_HTTP_ERROR',
      'SODEX_ERROR',
      'INSUFFICIENT_DATA',
    ])('treats %s as transient and retryable', (errorType) => {
      expect(mapAnalyzeError({ error: 'x', errorType }).retryable).toBe(true);
    });

    it('offers a wait-and-retry instruction for a rate limit', () => {
      expect(mapAnalyzeError({ error: 'x', errorType: 'RATE_LIMITED' }).message).toMatch(/wait/i);
    });
  });

  describe('client-side outcomes win over the payload', () => {
    it('reports a user-initiated cancel as cancelled, not as an error', () => {
      const info = mapAnalyzeError(
        { error: 'The operation was aborted', errorType: 'UPSTREAM_TIMEOUT' },
        { cancelled: true }
      );
      expect(info.kind).toBe('cancelled');
    });

    it('reports the client deadline as a retryable timeout', () => {
      const info = mapAnalyzeError({ error: 'aborted' }, { timedOut: true });
      expect(info.kind).toBe('upstream-timeout');
      expect(info.retryable).toBe(true);
    });
  });

  describe('validation and fallbacks', () => {
    it('treats a bodyless 400 as invalid input the user can fix', () => {
      const info = mapAnalyzeError({ error: 'Invalid symbol format', status: 400 });
      expect(info.kind).toBe('invalid-input');
      expect(info.message).toBe('Invalid symbol format');
    });

    it('falls back to unknown for an empty payload', () => {
      expect(mapAnalyzeError({}).kind).toBe('unknown');
    });

    it('survives non-string error fields without throwing', () => {
      const info = mapAnalyzeError({
        error: { nested: true },
        errorType: 42,
        suggestion: null,
      });
      expect(info.kind).toBe('unknown');
      expect(info.detail).toBeUndefined();
    });

    it('does not render an absurdly long symbol into the message', () => {
      const info = mapAnalyzeError({ errorType: 'SYMBOL_NOT_FOUND' }, { symbol: 'A'.repeat(500) });
      expect(info.message.length).toBeLessThan(200);
    });

    it('degrades gracefully when no symbol is available', () => {
      const info = mapAnalyzeError({ errorType: 'SYMBOL_NOT_FOUND' }, {});
      expect(info.message).toContain('that symbol');
      expect(info.message).not.toContain('undefined');
    });

    it('does not leak the server suggestion into the primary message', () => {
      const info = mapAnalyzeError({
        error: 'x',
        errorType: 'API_CONNECTION_ERROR',
        suggestion: 'Set SOSOVALUE_API_KEY in .env.local',
      });
      expect(info.message).not.toMatch(/API_KEY/);
      expect(info.detail).toMatch(/API_KEY/);
    });
  });
});

/**
 * The provider error taxonomy. These classes are what lets the route classify a failure without
 * parsing message text, and `riskEngine` used to re-wrap them as a plain `Error`, which stripped
 * the type and silently defeated the whole scheme. The `instanceof` assertions below are the
 * guard for that.
 */
describe('provider error taxonomy', () => {
  it('keeps a SoSoValue timeout distinguishable from a generic failure', () => {
    const err = new SoSoValueTimeoutError(8000);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SoSoValueTimeoutError);
    expect(err.name).toBe('SoSoValueTimeoutError');
    expect(err.message).toContain('8000ms');
  });

  it('carries the HTTP status so a 429 need not be re-parsed from text', () => {
    const err = new SoSoValueHttpError(429, 'Too Many Requests');
    expect(err).toBeInstanceOf(SoSoValueHttpError);
    expect(err.status).toBe(429);
    expect(err.message).toContain('429');
  });

  it('does not let a timeout masquerade as a missing API key', () => {
    // The original bug was a substring match on "SoSoValue". Guard the taxonomy against a future
    // timeout message that would re-enter that path.
    expect(new SoSoValueTimeoutError(8000).message).not.toMatch(/API_KEY/);
  });
});
