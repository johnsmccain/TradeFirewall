import { describe, it, expect } from 'vitest';
import { keccak256, stringToHex } from 'viem';
import {
  SODEX_TESTNET_CHAIN_ID,
  SODEX_MAINNET_CHAIN_ID,
  OrderSide,
  OrderType,
  TimeInForce,
  formatDecimalString,
  snapToStep,
  buildBatchNewOrderParams,
  computePayloadHash,
  buildExchangeActionTypedData,
  toSodexApiSign,
  generateClOrdID,
  generateNonce,
} from './sodexOrderSigning';

describe('chain ids', () => {
  it('pins the testnet and mainnet chain ids', () => {
    // A wrong chainId produces a signature the exchange cannot recover — the wallet would sign
    // for one network and SoDEX would verify against another.
    expect(SODEX_TESTNET_CHAIN_ID).toBe(138565);
    expect(SODEX_MAINNET_CHAIN_ID).toBe(286623);
    expect(SODEX_TESTNET_CHAIN_ID).not.toBe(SODEX_MAINNET_CHAIN_ID);
  });
});

describe('order enums', () => {
  it('matches the Go SDK wire values', () => {
    expect(OrderSide).toEqual({ BUY: 1, SELL: 2 });
    expect(OrderType).toEqual({ LIMIT: 1, MARKET: 2 });
    expect(TimeInForce).toEqual({ GTC: 1, FOK: 2, IOC: 3, GTX: 4 });
  });
});

describe('formatDecimalString', () => {
  it('strips trailing zeros', () => {
    expect(formatDecimalString(0.406, 4)).toBe('0.406');
    expect(formatDecimalString(1.5, 4)).toBe('1.5');
  });

  it('drops the decimal point entirely for whole numbers', () => {
    expect(formatDecimalString(2, 4)).toBe('2');
    expect(formatDecimalString(2.0, 2)).toBe('2');
  });

  it('rounds at the precision boundary (toFixed semantics)', () => {
    // toFixed rounds rather than truncating. This is safe only because every price/quantity
    // reaching it has already been snapped down by snapToStep, so the value handed to toFixed
    // is a step multiple and rounding cannot push it above what was approved.
    expect(formatDecimalString(0.40619, 3)).toBe('0.406');
    expect(formatDecimalString(1.9999, 2)).toBe('2');
    expect(formatDecimalString(1.005, 2)).toBe('1');
    expect(formatDecimalString(2.675, 2)).toBe('2.67');
  });

  it('cleans up the trailing zeros and point left by rounding', () => {
    // Rounding up into a whole number must not leave "2." or "2.00" on the wire.
    expect(formatDecimalString(1.9999, 2)).toBe('2');
    expect(formatDecimalString(0.999, 2)).toBe('1');
    expect(formatDecimalString(0.999, 4)).toBe('0.999');
  });

  it('treats a negative precision as zero instead of throwing', () => {
    expect(formatDecimalString(1.2345, -3)).toBe('1');
  });
});

describe('snapToStep', () => {
  it('snaps down to a step multiple, never up', () => {
    // Snapping up could quote a price above the best bid the user saw.
    expect(snapToStep(100.017, 0.01, 2)).toBe('100.01');
    expect(snapToStep(100.019, 0.01, 2)).toBe('100.01');
  });

  it('snaps quantity down to lot size', () => {
    expect(snapToStep(0.4059, 0.001, 3)).toBe('0.405');
  });

  it('passes the value through when step is zero or negative', () => {
    expect(snapToStep(0.40619, 0, 3)).toBe('0.406');
    expect(snapToStep(0.40619, -1, 3)).toBe('0.406');
  });

  it('handles a value already exactly on the step', () => {
    expect(snapToStep(100, 0.01, 2)).toBe('100');
  });
});

describe('buildBatchNewOrderParams', () => {
  const base = {
    accountID: 42,
    symbolID: 7,
    clOrdID: 'tf-1-abc123',
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    timeInForce: TimeInForce.GTC,
  };

  it('preserves the Go struct field order exactly', () => {
    // JSON.stringify emits string keys in insertion order and the exchange re-marshals to
    // recompute the payload hash, so a reordered key produces a different hash and the
    // signature fails to verify against a correctly-built payload.
    const params = buildBatchNewOrderParams({ ...base, price: '100', quantity: '2' });
    expect(Object.keys(params)).toEqual(['accountID', 'orders']);
    expect(Object.keys(params.orders[0])).toEqual([
      'symbolID',
      'clOrdID',
      'side',
      'type',
      'timeInForce',
      'price',
      'quantity',
    ]);
  });

  it('omits price and quantity when undefined rather than emitting null', () => {
    // A market order has neither; a literal null would change the JSON and thus the hash.
    const params = buildBatchNewOrderParams({ ...base, type: OrderType.MARKET });
    expect('price' in params.orders[0]).toBe(false);
    expect('quantity' in params.orders[0]).toBe(false);
    expect(JSON.stringify(params)).not.toContain('null');
  });

  it('wraps a single order in the batch array', () => {
    const params = buildBatchNewOrderParams({ ...base });
    expect(Array.isArray(params.orders)).toBe(true);
    expect(params.orders).toHaveLength(1);
  });

  it('keeps optional fields in position when only one is present', () => {
    const params = buildBatchNewOrderParams({ ...base, quantity: '2' });
    expect(Object.keys(params.orders[0])).toEqual([
      'symbolID',
      'clOrdID',
      'side',
      'type',
      'timeInForce',
      'quantity',
    ]);
  });
});

describe('computePayloadHash', () => {
  it('hashes the compact JSON of {type, params}', () => {
    const params = buildBatchNewOrderParams({
      accountID: 1,
      symbolID: 2,
      clOrdID: 'tf-1-abc123',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      timeInForce: TimeInForce.GTC,
      price: '100',
      quantity: '2',
    });
    const expected = keccak256(
      stringToHex(JSON.stringify({ type: 'batchNewOrder', params }))
    );
    expect(computePayloadHash(params)).toBe(expected);
  });

  it('is deterministic across calls', () => {
    const params = buildBatchNewOrderParams({
      accountID: 1, symbolID: 2, clOrdID: 'x',
      side: OrderSide.SELL, type: OrderType.MARKET, timeInForce: TimeInForce.GTC,
    });
    expect(computePayloadHash(params)).toBe(computePayloadHash(params));
  });

  it('changes when any field changes', () => {
    const mk = (over: Partial<Parameters<typeof buildBatchNewOrderParams>[0]>) =>
      buildBatchNewOrderParams({
        accountID: 1, symbolID: 2, clOrdID: 'x',
        side: OrderSide.BUY, type: OrderType.LIMIT, timeInForce: TimeInForce.GTC,
        price: '100', quantity: '2', ...over,
      });
    const base = computePayloadHash(mk({}));

    expect(computePayloadHash(mk({ quantity: '3' }))).not.toBe(base);
    expect(computePayloadHash(mk({ price: '101' }))).not.toBe(base);
    expect(computePayloadHash(mk({ side: OrderSide.SELL }))).not.toBe(base);
    expect(computePayloadHash(mk({ accountID: 2 }))).not.toBe(base);
    expect(computePayloadHash(mk({ clOrdID: 'y' }))).not.toBe(base);
  });

  it('returns a 32-byte hex string', () => {
    const params = buildBatchNewOrderParams({
      accountID: 1, symbolID: 2, clOrdID: 'x',
      side: OrderSide.BUY, type: OrderType.LIMIT, timeInForce: TimeInForce.GTC,
    });
    expect(computePayloadHash(params)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("has no whitespace, matching Go json.Marshal", () => {
    const params = buildBatchNewOrderParams({
      accountID: 1, symbolID: 2, clOrdID: 'x',
      side: OrderSide.BUY, type: OrderType.LIMIT, timeInForce: TimeInForce.GTC,
    });
    const compact = JSON.stringify({ type: 'batchNewOrder', params });
    expect(compact).not.toMatch(/\s/);
    expect(compact).toBe(
      '{"type":"batchNewOrder","params":{"accountID":1,"orders":[{"symbolID":2,"clOrdID":"x","side":1,"type":1,"timeInForce":1}]}}'
    );
  });
});

describe('buildExchangeActionTypedData', () => {
  const hash = `0x${'ab'.repeat(32)}` as const;

  it('uses the spot domain and zero verifying contract', () => {
    const td = buildExchangeActionTypedData(hash, 1700000000000, SODEX_TESTNET_CHAIN_ID);
    expect(td.domain.name).toBe('spot');
    expect(td.domain.version).toBe('1');
    expect(td.domain.chainId).toBe(SODEX_TESTNET_CHAIN_ID);
    expect(td.domain.verifyingContract).toBe('0x0000000000000000000000000000000000000000');
  });

  it('declares ExchangeAction as the primary type with the right fields', () => {
    const td = buildExchangeActionTypedData(hash, 1, SODEX_TESTNET_CHAIN_ID);
    expect(td.primaryType).toBe('ExchangeAction');
    expect(td.types.ExchangeAction).toEqual([
      { name: 'payloadHash', type: 'bytes32' },
      { name: 'nonce', type: 'uint64' },
    ]);
    expect(td.message.payloadHash).toBe(hash);
    expect(td.message.nonce).toBe(1);
  });

  it('carries the requested chainId, so mainnet and testnet cannot be confused', () => {
    const testnet = buildExchangeActionTypedData(hash, 1, SODEX_TESTNET_CHAIN_ID);
    const mainnet = buildExchangeActionTypedData(hash, 1, SODEX_MAINNET_CHAIN_ID);
    expect(testnet.domain.chainId).not.toBe(mainnet.domain.chainId);
  });
});

describe('toSodexApiSign', () => {
  // 65-byte wallet signature: r ‖ s ‖ v
  const rs = 'a'.repeat(128);

  it("converts v=27 to the 0x01 prefix with v'=0x00", () => {
    const sig = toSodexApiSign(`0x${rs}1b`); // 1b = 27
    expect(sig).toBe(`0x01${rs}00`);
    expect(sig).toHaveLength(2 + 2 + 128 + 2);
  });

  it("converts v=28 to the 0x01 prefix with v'=0x01", () => {
    expect(toSodexApiSign(`0x${rs}1c`)).toBe(`0x01${rs}01`); // 1c = 28
  });

  it('passes through an already-normalized v of 0 or 1', () => {
    expect(toSodexApiSign(`0x${rs}00`)).toBe(`0x01${rs}00`);
    expect(toSodexApiSign(`0x${rs}01`)).toBe(`0x01${rs}01`);
  });

  it('accepts a signature with no 0x prefix', () => {
    expect(toSodexApiSign(`${rs}1b`)).toBe(`0x01${rs}00`);
  });

  it('preserves r and s byte-for-byte', () => {
    const mixed = 'f'.repeat(64) + '0'.repeat(64);
    expect(toSodexApiSign(`0x${mixed}1c`)).toBe(`0x01${mixed}01`);
  });

  it('rejects a short signature rather than silently truncating', () => {
    // Truncating would produce a well-formed-looking signature that fails verification
    // server-side with no clue why.
    expect(() => toSodexApiSign(`0x${rs.slice(0, 120)}1b`)).toThrow(/130 hex char/);
  });

  it('rejects a long signature rather than truncating', () => {
    expect(() => toSodexApiSign(`0x${rs}1b1c`)).toThrow(/130 hex char/);
  });

  it('names the actual length it received, so a bad signature is diagnosable', () => {
    expect(() => toSodexApiSign(`0x${rs.slice(0, 120)}1b`)).toThrow(/122 hex chars/);
    expect(() => toSodexApiSign(`0x${rs}1b1c`)).toThrow(/132 hex chars/);
  });

  it('rejects an out-of-range recovery byte', () => {
    // Wallets occasionally return v as 00/01 or 29/30 depending on implementation; anything
    // that is not 27/28/0/1 is not a signature we can normalize.
    expect(() => toSodexApiSign(`0x${rs}05`)).toThrow(/recovery byte/);
    expect(() => toSodexApiSign(`0x${rs}1d`)).toThrow(/recovery byte/); // 29
  });

  it('always emits the 0x01 recovery prefix', () => {
    expect(toSodexApiSign(`0x${rs}1b`).slice(0, 4)).toBe('0x01');
    expect(toSodexApiSign(`0x${rs}1c`).slice(0, 4)).toBe('0x01');
  });
});

describe('generateClOrdID', () => {
  it('is prefixed and unique across rapid calls', () => {
    const a = generateClOrdID();
    const b = generateClOrdID();
    expect(a.startsWith('tf-')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('generateNonce', () => {
  it("is a millisecond timestamp inside SoDEX's accepted window", () => {
    const before = Date.now();
    const nonce = generateNonce();
    const after = Date.now();
    expect(nonce).toBeGreaterThanOrEqual(before);
    expect(nonce).toBeLessThanOrEqual(after);
    // SoDEX rejects nonces more than 2 days old or over 1 day in the future.
    expect(nonce).toBeLessThan(after + 24 * 60 * 60 * 1000);
  });

  it("is monotonically non-decreasing across calls", () => {
    expect(generateNonce()).toBeLessThanOrEqual(generateNonce());
  });
});
