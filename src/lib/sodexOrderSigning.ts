// Server-only EIP-712 payload construction for SoDEX's authenticated spot order API.
// Ported directly from SoDEX's public Go SDK (github.com/sodex-tech/sodex-go-sdk-public):
//   common/types/action_payload.go  — payloadHash = keccak256(compact JSON({type, params}))
//   common/types/eip712.go          — EIP-712 domain + ExchangeAction(bytes32,uint64)
//   spot/types/batch_new_order_request.go — exact field order for batchNewOrder
//   references/authentication.md    — headers, nonce rules, v-byte normalization
//
// No signing happens here — this only builds what the browser wallet needs to sign
// (typed data) and, after the wallet signs, what SoDEX needs to verify it (headers).
// The private key never leaves the browser.

import { keccak256, stringToHex } from 'viem';

export const SODEX_TESTNET_CHAIN_ID = 138565;
export const SODEX_MAINNET_CHAIN_ID = 286623;

export const OrderSide = { BUY: 1, SELL: 2 } as const;
export const OrderType = { LIMIT: 1, MARKET: 2 } as const;
export const TimeInForce = { GTC: 1, FOK: 2, IOC: 3, GTX: 4 } as const;

export interface BatchNewOrderItemParams {
  symbolID: number;
  clOrdID: string;
  side: number;
  type: number;
  timeInForce: number;
  price?: string;
  quantity?: string;
  funds?: string;
}

export interface BatchNewOrderParams {
  accountID: number;
  orders: BatchNewOrderItemParams[];
  builder?: BuilderFeeParams;
}

export interface BuilderFeeParams {
  id: number;
  fee: number;
}

export function hasSufficientBuilderFeeApproval(
  engines: unknown,
  builderID: number,
  requestedFeeRate: number
): boolean {
  if (!engines || typeof engines !== 'object') return false;
  const approvals = engines as { spot?: unknown; perps?: unknown };
  const coversRate = (records: unknown): boolean => Array.isArray(records)
    && records.some((record: unknown) => {
      if (!record || typeof record !== 'object') return false;
      const approval = record as { builderID?: unknown; feeRate?: unknown };
      return Number(approval.builderID) === builderID
        && Number.isFinite(Number(approval.feeRate))
        && Number(approval.feeRate) >= requestedFeeRate;
    });

  return coversRate(approvals.spot) && coversRate(approvals.perps);
}

export function isBuilderFeeApprovalRevoked(engines: unknown, builderID: number): boolean {
  if (!engines || typeof engines !== 'object') return false;
  const approvals = engines as { spot?: unknown; perps?: unknown };
  const revokedOnEngine = (records: unknown): boolean => {
    if (!Array.isArray(records)) return false;
    for (const record of records) {
      if (!record || typeof record !== 'object') return false;
      const approval = record as { builderID?: unknown; feeRate?: unknown };
      if (!Number.isFinite(Number(approval.builderID)) || !Number.isFinite(Number(approval.feeRate))) {
        return false;
      }
      if (Number(approval.builderID) === builderID && Number(approval.feeRate) > 0) return false;
    }
    return true;
  };

  return revokedOnEngine(approvals.spot) && revokedOnEngine(approvals.perps);
}

export function builderFeeRateToPercent(feeRate: number): number {
  return feeRate / 1000;
}

export function estimateBuilderFeeUsd(notionalUsd: number, feeRate: number): number {
  return notionalUsd * feeRate / 100000;
}

/** Strips trailing zeros — SoDEX rejects "0.4060", requires "0.406". */
export function formatDecimalString(value: number, precision: number): string {
  const fixed = value.toFixed(Math.max(0, precision));
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/** Snaps a raw value down to the nearest step/tick multiple, then formats. */
export function snapToStep(value: number, step: number, precision: number): string {
  if (step <= 0) return formatDecimalString(value, precision);
  const snapped = Math.floor(value / step) * step;
  return formatDecimalString(snapped, precision);
}

/**
 * Builds the exact params object for a single-order batchNewOrder request, in the
 * Go struct's declared field order (symbolID, clOrdID, side, type, timeInForce,
 * price, quantity), then batch fields accountID, orders, builder — object key order
 * matters because the server re-marshals to verify the signature.
 */
export function buildBatchNewOrderParams(input: {
  accountID: number;
  symbolID: number;
  clOrdID: string;
  side: number;
  type: number;
  timeInForce: number;
  price?: string;
  quantity?: string;
  builder?: BuilderFeeParams;
}): BatchNewOrderParams {
  const item: BatchNewOrderItemParams = {
    symbolID: input.symbolID,
    clOrdID: input.clOrdID,
    side: input.side,
    type: input.type,
    timeInForce: input.timeInForce,
  };
  if (input.price !== undefined) item.price = input.price;
  if (input.quantity !== undefined) item.quantity = input.quantity;
  const params: BatchNewOrderParams = { accountID: input.accountID, orders: [item] };
  if (input.builder !== undefined) {
    params.builder = { id: input.builder.id, fee: input.builder.fee };
  }
  return params;
}

const BATCH_NEW_ORDER_ACTION_NAME = 'batchNewOrder';

/** payloadHash = keccak256(compact_json({type, params})) — must be byte-identical to Go's json.Marshal. */
export function computePayloadHash(params: BatchNewOrderParams): `0x${string}` {
  const compactJson = JSON.stringify({ type: BATCH_NEW_ORDER_ACTION_NAME, params });
  return keccak256(stringToHex(compactJson));
}

export function generateClOrdID(): string {
  return `tf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Millisecond nonce, incremented locally so consecutive signed actions stay strictly increasing. */
let lastGeneratedNonce = 0;

export function generateNonce(): number {
  lastGeneratedNonce = Math.max(Date.now(), lastGeneratedNonce + 1);
  return lastGeneratedNonce;
}

export interface ExchangeActionTypedData {
  domain: {
    name: 'spot';
    version: '1';
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: {
    EIP712Domain: Array<{ name: string; type: string }>;
    ExchangeAction: Array<{ name: string; type: string }>;
  };
  primaryType: 'ExchangeAction';
  message: { payloadHash: `0x${string}`; nonce: number };
}

const ZERO_ADDRESS: `0x${string}` = '0x0000000000000000000000000000000000000000';

/** Builds the EIP-712 typed-data object for the browser wallet's eth_signTypedData_v4. */
export function buildExchangeActionTypedData(payloadHash: `0x${string}`, nonce: number, chainId: number): ExchangeActionTypedData {
  return {
    domain: { name: 'spot', version: '1', chainId, verifyingContract: ZERO_ADDRESS },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      ExchangeAction: [
        { name: 'payloadHash', type: 'bytes32' },
        { name: 'nonce', type: 'uint64' },
      ],
    },
    primaryType: 'ExchangeAction',
    message: { payloadHash, nonce },
  };
}

export interface ApproveBuilderFeeTypedData {
  domain: {
    name: 'universal';
    version: '1';
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: {
    EIP712Domain: Array<{ name: string; type: string }>;
    ApproveBuilderFeeAction: Array<{ name: string; type: string }>;
  };
  primaryType: 'ApproveBuilderFeeAction';
  message: {
    chainID: number;
    nonce: number;
    accountID: number;
    builderID: number;
    maxFeeRate: number;
  };
}

/** Builds SoDEX's universal-domain master-wallet builder-fee approval action. */
export function buildApproveBuilderFeeTypedData(input: {
  accountID: number;
  builderID: number;
  maxFeeRate: number;
  nonce: number;
  chainId: number;
}): ApproveBuilderFeeTypedData {
  return {
    domain: { name: 'universal', version: '1', chainId: input.chainId, verifyingContract: ZERO_ADDRESS },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      ApproveBuilderFeeAction: [
        { name: 'chainID', type: 'uint64' },
        { name: 'nonce', type: 'uint64' },
        { name: 'accountID', type: 'uint64' },
        { name: 'builderID', type: 'uint64' },
        { name: 'maxFeeRate', type: 'uint64' },
      ],
    },
    primaryType: 'ApproveBuilderFeeAction',
    message: {
      chainID: input.chainId,
      nonce: input.nonce,
      accountID: input.accountID,
      builderID: input.builderID,
      maxFeeRate: input.maxFeeRate,
    },
  };
}

/**
 * Converts a wallet-produced 65-byte ECDSA signature (r ‖ s ‖ v, v=27/28) into
 * SoDEX's 66-byte wire format (0x01 ‖ r ‖ s ‖ v', v'=0/1).
 */
function toSodexApiSignWithPrefix(walletSignatureHex: string, prefix: '01' | '02'): string {
  const hex = walletSignatureHex.startsWith('0x') ? walletSignatureHex.slice(2) : walletSignatureHex;
  if (hex.length !== 130) {
    throw new Error(`Expected a 65-byte (130 hex char) wallet signature, got ${hex.length} hex chars`);
  }
  const rs = hex.slice(0, 128);
  let v = parseInt(hex.slice(128, 130), 16);
  if (v === 27 || v === 28) v -= 27;
  if (v !== 0 && v !== 1) {
    throw new Error(`Unexpected signature recovery byte: ${v}`);
  }
  const vHex = v.toString(16).padStart(2, '0');
  return `0x${prefix}${rs}${vHex}`;
}

export function toSodexApiSign(walletSignatureHex: string): string {
  return toSodexApiSignWithPrefix(walletSignatureHex, '01');
}

/** Converts a wallet signature to SoDEX's universal-action wire format (0x02 prefix). */
export function toSodexBuilderApprovalApiSign(walletSignatureHex: string): string {
  return toSodexApiSignWithPrefix(walletSignatureHex, '02');
}
