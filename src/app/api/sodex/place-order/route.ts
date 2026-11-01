import { NextRequest, NextResponse } from 'next/server';
import { sodexAPI } from '@/lib/sodex';
import {
  OrderSide,
  OrderType,
  TimeInForce,
  buildBatchNewOrderParams,
  computePayloadHash,
  buildExchangeActionTypedData,
  buildApproveBuilderFeeTypedData,
  builderFeeRateToPercent,
  estimateBuilderFeeUsd,
  generateClOrdID,
  generateNonce,
  toSodexApiSign,
  toSodexBuilderApprovalApiSign,
  snapToStep,
  BuilderFeeParams,
  BatchNewOrderParams,
  hasSufficientBuilderFeeApproval,
  isBuilderFeeApprovalRevoked,
} from '@/lib/sodexOrderSigning';
import { getSodexBuilderConfig, getSodexNetworkConfig } from '@/lib/sodexNetwork';

export async function POST(request: NextRequest) {
  try {
    const network = getSodexNetworkConfig();
    if (sodexAPI.configuredNetwork !== network.network) {
      return NextResponse.json(
        { error: 'SoDEX market data and order execution network configuration do not match.', errorType: 'NETWORK_CONFIG_MISMATCH' },
        { status: 500 }
      );
    }

    const body = await request.json();
    if (body.action === 'config') return handleConfig();
    if (!network.executionEnabled) {
      return NextResponse.json(
        { error: 'Mainnet execution requires both SODEX_USE_TESTNET=false and SODEX_ENABLE_MAINNET_TRADING=true.', errorType: 'MAINNET_DISABLED' },
        { status: 403 }
      );
    }

    if (body.action === 'prepare') return handlePrepare(body);
    if (body.action === 'approve-builder-fee') return handleApproveBuilderFee(body);
    if (body.action === 'prepare-builder-fee-revocation') return handlePrepareBuilderFeeRevocation(body);
    if (body.action === 'revoke-builder-fee') return handleRevokeBuilderFee(body);
    if (body.action === 'submit') return handleSubmit(body);
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (error) {
    console.error('SoDEX place-order error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Order placement failed', errorType: 'ORDER_ERROR' },
      { status: 500 }
    );
  }
}

function handleConfig() {
  const network = getSodexNetworkConfig();
  let builder: ReturnType<typeof getSodexBuilderConfig>;
  try {
    builder = getSodexBuilderConfig(network.network);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid SoDEX builder configuration', errorType: 'BUILDER_CONFIG_ERROR' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    network: network.network,
    chainId: network.chainId,
    rpcUrl: network.rpcUrl,
    executionEnabled: network.executionEnabled,
    builderID: builder?.id ?? null,
    maxBuilderFeeRate: builder?.maxFeeRate ?? 0,
    configuredBuilderOwnerAddress: network.network === 'testnet'
      ? process.env.SODEX_TESTNET_BUILDER_OWNER_ADDRESS || process.env.SODEX_BUILDER_OWNER_ADDRESS || null
      : process.env.SODEX_MAINNET_BUILDER_OWNER_ADDRESS || null,
  });
}

async function handlePrepare(body: {
  symbol?: string;
  side?: 'buy' | 'sell';
  amountUsd?: number;
  walletAddress?: string;
  maxSlippagePct?: number;
  decision?: string;
  includeBuilderFee?: boolean;
  builderFeeRate?: number;
}) {
  const { symbol, side, amountUsd, walletAddress, decision } = body;

  if (!symbol || (side !== 'buy' && side !== 'sell') || !amountUsd || amountUsd <= 0 || !walletAddress) {
    return NextResponse.json({ error: 'Invalid order parameters' }, { status: 400 });
  }

  // Server-side backstop — mirrors the UI gating in ConfirmationGate/check-trade,
  // but enforced here too so a tampered client can't bypass it.
  if (decision === 'BLOCK') {
    return NextResponse.json(
      { error: 'This trade is BLOCKed by the risk engine. Execution is not available for BLOCK decisions.', errorType: 'BLOCKED' },
      { status: 403 }
    );
  }
  if (decision === 'REDUCE_OR_WAIT') {
    return NextResponse.json(
      { error: 'REDUCE_OR_WAIT trades must be resized and re-analyzed before execution is available.', errorType: 'REDUCE_REQUIRED' },
      { status: 403 }
    );
  }

  let accountState: Awaited<ReturnType<typeof sodexAPI.getAccountState>>;
  let rules: Awaited<ReturnType<typeof sodexAPI.getSpotSymbolRules>>;
  try {
    [accountState, rules] = await Promise.all([
      sodexAPI.getAccountState(walletAddress),
      sodexAPI.getSpotSymbolRules(symbol),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to resolve account or symbol';
    const network = getSodexNetworkConfig();
    const notOnboarded = message.includes(`no SoDEX ${network.network} account`);
    return NextResponse.json(
      { error: message, errorType: notOnboarded ? 'NOT_ONBOARDED' : 'ACCOUNT_RESOLUTION_ERROR' },
      { status: notOnboarded ? 404 : 502 }
    );
  }

  // Uses the same bookTicker → orderbook → last-trade fallback chain as the
  // execution preview, so a one-sided book still resolves to a usable reference price
  // instead of failing outright.
  let bid: number;
  let ask: number;
  try {
    ({ bidPrice: bid, askPrice: ask } = await sodexAPI.getExecutionReferencePrices(symbol));
  } catch {
    const network = getSodexNetworkConfig();
    return NextResponse.json({ error: `SoDEX ${network.network} has no usable bid/ask for this symbol right now.`, errorType: 'NO_LIQUIDITY' }, { status: 503 });
  }

  const slippage = Math.min(Math.max(body.maxSlippagePct ?? 0.01, 0.001), 0.05);
  const isBuy = side === 'buy';
  // Marketable limit + IOC: fills immediately like a market order, but never worse
  // than this protection price — the slippage-protection mechanism.
  const protectionPriceRaw = isBuy ? ask * (1 + slippage) : bid * (1 - slippage);
  const protectionPrice = snapToStep(protectionPriceRaw, rules.tickSize, rules.pricePrecision);
  const refPrice = parseFloat(protectionPrice);
  const quantity = snapToStep(amountUsd / refPrice, rules.stepSize, rules.quantityPrecision);
  const notional = parseFloat(quantity) * refPrice;

  if (!(parseFloat(quantity) > 0)) {
    return NextResponse.json({ error: 'Order size rounds to zero at this symbol\'s minimum step size.', errorType: 'SIZE_TOO_SMALL' }, { status: 400 });
  }
  if (notional < rules.minNotional) {
    return NextResponse.json(
      { error: `Order notional $${notional.toFixed(2)} is below SoDEX's minimum of $${rules.minNotional} for this symbol.`, errorType: 'BELOW_MIN_NOTIONAL' },
      { status: 400 }
    );
  }

  let builder: BuilderFeeParams | undefined;
  const network = getSodexNetworkConfig();
  if (body.includeBuilderFee) {
    if (side !== 'sell') {
      return NextResponse.json(
        { error: 'Builder Fee consent is only available for eligible spot sell orders.', errorType: 'INELIGIBLE_BUILDER_ORDER' },
        { status: 400 }
      );
    }
    try {
      const configuredBuilder = getSodexBuilderConfig(network.network);
      if (!configuredBuilder) {
        return NextResponse.json(
          { error: `No ${network.network} Builder ID and non-zero maximum Builder Fee rate are configured.`, errorType: 'BUILDER_NOT_CONFIGURED' },
          { status: 400 }
        );
      }
      const requestedFeeRate = body.builderFeeRate ?? configuredBuilder.maxFeeRate;
      if (
        !Number.isSafeInteger(requestedFeeRate)
        || requestedFeeRate <= 0
        || requestedFeeRate > configuredBuilder.maxFeeRate
      ) {
        return NextResponse.json(
          { error: `Builder Fee rate must be a positive integer no greater than the configured maximum (${configuredBuilder.maxFeeRate}).`, errorType: 'INVALID_BUILDER_FEE_RATE' },
          { status: 400 }
        );
      }
      builder = { id: configuredBuilder.id, fee: requestedFeeRate };
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid SoDEX builder configuration', errorType: 'BUILDER_CONFIG_ERROR' },
        { status: 500 }
      );
    }
  }

  const clOrdID = generateClOrdID();
  const orderParams = buildBatchNewOrderParams({
    accountID: accountState.accountID,
    symbolID: rules.symbolID,
    clOrdID,
    side: isBuy ? OrderSide.BUY : OrderSide.SELL,
    type: OrderType.LIMIT,
    timeInForce: TimeInForce.IOC,
    price: protectionPrice,
    quantity,
    builder,
  });

  let approvalRequired = false;
  let approvalNonce: number | undefined;
  if (builder) {
    try {
      const alreadyApproved = await hasBuilderFeeApproval(network.network, walletAddress, builder.id, builder.fee);
      approvalRequired = !alreadyApproved;
      if (approvalRequired) approvalNonce = generateNonce();
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to verify builder fee approval', errorType: 'BUILDER_APPROVAL_CHECK_FAILED' },
        { status: 502 }
      );
    }
  }

  let typedData;
  let nonce: number | undefined;
  if (!approvalRequired) {
    nonce = generateNonce();
    typedData = buildExchangeActionTypedData(computePayloadHash(orderParams), nonce, network.chainId);
  }

  const approvalTypedData = builder && approvalRequired && approvalNonce !== undefined
    ? buildApproveBuilderFeeTypedData({
        accountID: accountState.accountID,
        builderID: builder.id,
        maxFeeRate: builder.fee,
        nonce: approvalNonce,
        chainId: network.chainId,
      })
    : undefined;

  return NextResponse.json({
    typedData,
    nonce,
    orderParams,
    approvalRequired,
    approvalNonce,
    approvalTypedData,
    preview: {
      symbol,
      side: isBuy ? 'BUY' : 'SELL',
      accountID: accountState.accountID,
      clOrdID,
      quantity,
      protectionPrice,
      estimatedNotionalUsd: Math.round(notional),
      currentBid: bid,
      currentAsk: ask,
      slippagePct: slippage,
      orderType: 'LIMIT',
      timeInForce: 'IOC',
      network: network.network,
      chainId: network.chainId,
      builderID: builder?.id ?? null,
      builderFeeRate: builder?.fee ?? 0,
      builderFeePercent: builder ? builderFeeRateToPercent(builder.fee) : 0,
      estimatedBuilderFeeUsd: builder ? estimateBuilderFeeUsd(notional, builder.fee) : 0,
    },
  });
}

async function hasBuilderFeeApproval(
  network: 'testnet' | 'mainnet',
  walletAddress: string,
  builderID: number,
  requestedFeeRate: number
): Promise<boolean> {
  const approvals = await getBuilderFeeApprovalData(network, walletAddress);
  return hasSufficientBuilderFeeApproval(approvals, builderID, requestedFeeRate);
}

async function getBuilderFeeApprovalData(network: 'testnet' | 'mainnet', walletAddress: string): Promise<unknown> {
  const { apiUrl } = getSodexNetworkConfig();
  const url = `${apiUrl}/user/${encodeURIComponent(walletAddress)}/builders`;
  const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const raw = await readJson(response);
  const result = raw as { code?: unknown; message?: unknown; data?: unknown } | null;
  if (!response.ok || !result || result.code !== 0) {
    const message = typeof result?.message === 'string' ? result.message : `HTTP ${response.status}`;
    throw new Error(`Could not check the SoDEX builder approval: ${message}`);
  }
  if (sodexAPI.configuredNetwork !== network) {
    throw new Error('SoDEX builder approval query used a different network than the selected execution network.');
  }
  return result.data;
}

async function handleApproveBuilderFee(body: {
  orderParams?: BatchNewOrderParams;
  approvalNonce?: number;
  signature?: string;
  walletAddress?: string;
}) {
  const { orderParams, approvalNonce, signature, walletAddress } = body;
  if (
    !orderParams
    || !Array.isArray(orderParams.orders)
    || typeof approvalNonce !== 'number'
    || !Number.isSafeInteger(approvalNonce)
    || approvalNonce <= 0
    || !signature
    || !walletAddress
  ) {
    return NextResponse.json({ error: 'Missing signed builder approval fields', errorType: 'BAD_BUILDER_APPROVAL' }, { status: 400 });
  }

  const network = getSodexNetworkConfig();
  let configuredBuilder: ReturnType<typeof getSodexBuilderConfig>;
  try {
    configuredBuilder = getSodexBuilderConfig(network.network);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid SoDEX builder configuration', errorType: 'BUILDER_CONFIG_ERROR' },
      { status: 500 }
    );
  }
  if (
    !configuredBuilder
    || orderParams.builder?.id !== configuredBuilder.id
    || !Number.isSafeInteger(orderParams.builder.fee)
    || orderParams.builder.fee <= 0
    || orderParams.builder.fee > configuredBuilder.maxFeeRate
  ) {
    return NextResponse.json(
      { error: 'The prepared order does not match the configured builder fee.', errorType: 'BUILDER_CONFIG_MISMATCH' },
      { status: 400 }
    );
  }
  if (orderParams.orders.length !== 1 || orderParams.orders[0]?.side !== OrderSide.SELL) {
    return NextResponse.json(
      { error: 'Builder fees are only supported on eligible spot sell orders.', errorType: 'INELIGIBLE_BUILDER_ORDER' },
      { status: 400 }
    );
  }

  let accountState: Awaited<ReturnType<typeof sodexAPI.getAccountState>>;
  try {
    accountState = await sodexAPI.getAccountState(walletAddress);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to resolve the trader account', errorType: 'ACCOUNT_RESOLUTION_ERROR' },
      { status: 502 }
    );
  }
  if (orderParams.accountID !== accountState.accountID) {
    return NextResponse.json(
      { error: "Builder fee approval must use the trader's primary SoDEX account ID.", errorType: 'ACCOUNT_MISMATCH' },
      { status: 400 }
    );
  }

  let apiSign: string;
  try {
    apiSign = toSodexBuilderApprovalApiSign(signature);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid wallet signature', errorType: 'BAD_SIGNATURE' },
      { status: 400 }
    );
  }

  const approvalParams = {
    accountID: accountState.accountID,
    builderID: configuredBuilder.id,
    maxFeeRate: orderParams.builder.fee,
  };
  const response = await fetch(`${network.apiUrl}/user/${encodeURIComponent(walletAddress)}/builders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-Sign': apiSign,
      'X-API-Nonce': String(approvalNonce),
      'X-API-Chain': String(network.chainId),
    },
    body: JSON.stringify(approvalParams),
  });

  const raw = await readJson(response);
  const result = raw as { code?: unknown; message?: unknown } | null;
  if (!response.ok || !result || result.code !== 0) {
    const message = typeof result?.message === 'string' ? result.message : `HTTP ${response.status}`;
    return NextResponse.json(
      { error: `SoDEX builder fee approval failed: ${message}`, errorType: 'BUILDER_APPROVAL_FAILED', raw },
      { status: 502 }
    );
  }

  const nonce = generateNonce();
  const typedData = buildExchangeActionTypedData(computePayloadHash(orderParams), nonce, network.chainId);
  return NextResponse.json({ success: true, typedData, nonce });
}

async function handlePrepareBuilderFeeRevocation(body: { walletAddress?: string }) {
  const { walletAddress } = body;
  if (!walletAddress) {
    return NextResponse.json({ error: 'Missing wallet address', errorType: 'BAD_BUILDER_REVOCATION' }, { status: 400 });
  }
  const network = getSodexNetworkConfig();
  let builder: ReturnType<typeof getSodexBuilderConfig>;
  try {
    builder = getSodexBuilderConfig(network.network);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid SoDEX builder configuration', errorType: 'BUILDER_CONFIG_ERROR' },
      { status: 500 }
    );
  }
  if (!builder) {
    return NextResponse.json(
      { error: `No ${network.network} Builder ID is configured for revocation.`, errorType: 'BUILDER_NOT_CONFIGURED' },
      { status: 400 }
    );
  }

  try {
    const accountState = await sodexAPI.getAccountState(walletAddress);
    const nonce = generateNonce();
    const typedData = buildApproveBuilderFeeTypedData({
      accountID: accountState.accountID,
      builderID: builder.id,
      maxFeeRate: 0,
      nonce,
      chainId: network.chainId,
    });
    return NextResponse.json({ typedData, nonce, builderID: builder.id, network: network.network });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to prepare Builder Fee revocation', errorType: 'BUILDER_REVOCATION_PREPARE_FAILED' },
      { status: 502 }
    );
  }
}

async function handleRevokeBuilderFee(body: {
  nonce?: number;
  signature?: string;
  walletAddress?: string;
}) {
  const { nonce, signature, walletAddress } = body;
  if (typeof nonce !== 'number' || !Number.isSafeInteger(nonce) || nonce <= 0 || !signature || !walletAddress) {
    return NextResponse.json({ error: 'Missing signed Builder Fee revocation fields', errorType: 'BAD_BUILDER_REVOCATION' }, { status: 400 });
  }

  const network = getSodexNetworkConfig();
  let builder: ReturnType<typeof getSodexBuilderConfig>;
  try {
    builder = getSodexBuilderConfig(network.network);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid SoDEX builder configuration', errorType: 'BUILDER_CONFIG_ERROR' },
      { status: 500 }
    );
  }
  if (!builder) {
    return NextResponse.json(
      { error: `No ${network.network} Builder ID is configured for revocation.`, errorType: 'BUILDER_NOT_CONFIGURED' },
      { status: 400 }
    );
  }

  let accountID: number;
  try {
    accountID = (await sodexAPI.getAccountState(walletAddress)).accountID;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to resolve the trader account', errorType: 'ACCOUNT_RESOLUTION_ERROR' },
      { status: 502 }
    );
  }

  let apiSign: string;
  try {
    apiSign = toSodexBuilderApprovalApiSign(signature);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid wallet signature', errorType: 'BAD_SIGNATURE' },
      { status: 400 }
    );
  }

  const response = await fetch(`${network.apiUrl}/user/${encodeURIComponent(walletAddress)}/builders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-Sign': apiSign,
      'X-API-Nonce': String(nonce),
      'X-API-Chain': String(network.chainId),
    },
    body: JSON.stringify({ accountID, builderID: builder.id, maxFeeRate: 0 }),
  });
  const raw = await readJson(response);
  const result = raw as { code?: unknown; message?: unknown } | null;
  if (!response.ok || !result || result.code !== 0) {
    const message = typeof result?.message === 'string' ? result.message : `HTTP ${response.status}`;
    return NextResponse.json(
      { error: `SoDEX Builder Fee revocation failed: ${message}`, errorType: 'BUILDER_REVOCATION_FAILED', raw },
      { status: 502 }
    );
  }

  try {
    const approvals = await getBuilderFeeApprovalData(network.network, walletAddress);
    if (!isBuilderFeeApprovalRevoked(approvals, builder.id)) {
      return NextResponse.json(
        {
          error: 'SoDEX accepted the revocation request, but both engine approval lists do not yet confirm removal. Check again before relying on revocation.',
          errorType: 'BUILDER_REVOCATION_UNCONFIRMED',
        },
        { status: 502 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: `SoDEX accepted the revocation request, but approval removal could not be verified: ${error instanceof Error ? error.message : 'unknown verification error'}`,
        errorType: 'BUILDER_REVOCATION_UNCONFIRMED',
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, revoked: true, builderID: builder.id, network: network.network });
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function handleSubmit(body: {
  orderParams?: BatchNewOrderParams;
  nonce?: number;
  signature?: string;
  walletAddress?: string;
}) {
  const { orderParams, nonce, signature, walletAddress } = body;
  if (!orderParams || !Array.isArray(orderParams.orders) || !nonce || !signature || !walletAddress) {
    return NextResponse.json({ error: 'Missing signed order fields' }, { status: 400 });
  }

  const network = getSodexNetworkConfig();
  if (orderParams.builder) {
    let configuredBuilder: ReturnType<typeof getSodexBuilderConfig>;
    try {
      configuredBuilder = getSodexBuilderConfig(network.network);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid SoDEX builder configuration', errorType: 'BUILDER_CONFIG_ERROR' },
        { status: 500 }
      );
    }

    if (
      !configuredBuilder
      || orderParams.builder.id !== configuredBuilder.id
      || !Number.isSafeInteger(orderParams.builder.fee)
      || orderParams.builder.fee <= 0
      || orderParams.builder.fee > configuredBuilder.maxFeeRate
      || orderParams.orders.length !== 1
      || orderParams.orders[0]?.side !== OrderSide.SELL
    ) {
      return NextResponse.json(
        { error: 'The signed order does not match an eligible configured builder fee.', errorType: 'BUILDER_CONFIG_MISMATCH' },
        { status: 400 }
      );
    }

    let accountState: Awaited<ReturnType<typeof sodexAPI.getAccountState>>;
    try {
      accountState = await sodexAPI.getAccountState(walletAddress);
      if (accountState.accountID !== orderParams.accountID) {
        return NextResponse.json(
          { error: "Builder fee orders must use the trader's primary SoDEX account ID.", errorType: 'ACCOUNT_MISMATCH' },
          { status: 400 }
        );
      }

      const approvalStillActive = await hasBuilderFeeApproval(
        network.network,
        walletAddress,
        configuredBuilder.id,
        orderParams.builder.fee
      );
      if (!approvalStillActive) {
        return NextResponse.json(
          {
            error: 'The Builder Fee approval is missing, revoked, or no longer covers this order. Review the order again to approve it.',
            errorType: 'BUILDER_APPROVAL_REQUIRED',
          },
          { status: 409 }
        );
      }
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to verify builder fee approval', errorType: 'BUILDER_APPROVAL_CHECK_FAILED' },
        { status: 502 }
      );
    }
  }

  let apiSign: string;
  try {
    apiSign = toSodexApiSign(signature);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid wallet signature', errorType: 'BAD_SIGNATURE' }, { status: 400 });
  }

  const url = `${network.spotUrl}/trade/orders/batch`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-Sign': apiSign,
      'X-API-Nonce': String(nonce),
      'X-API-Chain': String(network.chainId),
    },
    body: JSON.stringify(orderParams),
  });

  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok || raw === null) {
    return NextResponse.json(
      { error: `SoDEX order submission failed (HTTP ${response.status})`, errorType: 'SODEX_SUBMIT_ERROR', raw },
      { status: 502 }
    );
  }

  const container = raw as { code?: number; message?: string; data?: unknown };
  const results = Array.isArray(raw) ? raw : Array.isArray(container.data) ? container.data : [raw];
  const result = results[0] as { code?: number; clOrdID?: string; orderID?: number; error?: string } | undefined;
  const success = !!result && result.code === 0;

  return NextResponse.json(
    {
      success,
      orderID: result?.orderID ?? null,
      clOrdID: result?.clOrdID ?? orderParams.orders[0]?.clOrdID,
      error: success ? undefined : result?.error || container.message || 'Order rejected by SoDEX',
      network: network.network,
      timestamp: Date.now(),
      raw,
    },
    { status: success ? 200 : 502 }
  );
}
