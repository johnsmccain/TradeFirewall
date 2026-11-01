'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TradeInput, Decision } from '@/lib/riskEngine';
import { toast } from '@/lib/toast';
import { builderFeeRateToPercent } from '@/lib/sodexOrderSigning';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

// MetaMask (and most EIP-1193 wallets) validate that eth_signTypedData_v4's
// domain.chainId matches the wallet's currently active network before signing —
// so the wallet must actually be switched to SoDEX's chain, not just informed of
// it via the typed data. Verified live: testnet.valuechain.xyz returns chainId
// 0x21d45 (138565), matching SODEX_TESTNET_CHAIN_ID.
interface SodexExecutionConfig {
  network: 'testnet' | 'mainnet';
  chainId: number;
  rpcUrl: string;
  executionEnabled: boolean;
  builderID: number | null;
  maxBuilderFeeRate: number;
  configuredBuilderOwnerAddress: string | null;
}

async function ensureSodexChain(config: Pick<SodexExecutionConfig, 'network' | 'chainId' | 'rpcUrl'>): Promise<void> {
  if (!window.ethereum) throw new Error('No injected wallet found');
  const currentChainId = (await window.ethereum.request({ method: 'eth_chainId' })) as string;
  const chainId = `0x${config.chainId.toString(16)}`;
  if (currentChainId.toLowerCase() === chainId) return;

  const chainName = config.network === 'testnet' ? 'ValueChain Testnet' : 'ValueChain';
  const chainParams = {
    chainId,
    chainName,
    nativeCurrency: { name: 'SOSO', symbol: 'SOSO', decimals: 18 },
    rpcUrls: [config.rpcUrl],
  };

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }],
    });
  } catch (switchError) {
    const code = (switchError as { code?: number })?.code;
    if (code === 4902) {
      // Chain not yet known to the wallet — add it, which also switches to it.
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [chainParams],
      });
    } else {
      throw switchError;
    }
  }
}

interface SoDEXOrderPlacementProps {
  tradeInput: TradeInput;
  riskScore: number;
  decision: Decision;
}

interface ExecutionPreviewData {
  estimatedPrice: number;
  estimatedSlippage: number;
  priceImpact: number;
  executionProbability: number;
  warnings: string[];
}

interface PreparedOrder {
  typedData?: Record<string, unknown>;
  nonce?: number;
  orderParams: Record<string, unknown>;
  approvalRequired: boolean;
  approvalNonce?: number;
  approvalTypedData?: Record<string, unknown>;
  preview: {
    symbol: string;
    side: string;
    quantity: string;
    protectionPrice: string;
    estimatedNotionalUsd: number;
    currentBid: number;
    currentAsk: number;
    slippagePct: number;
    orderType: string;
    timeInForce: string;
    network: string;
    chainId: number;
    builderID: number | null;
    builderFeeRate: number;
    builderFeePercent: number;
    estimatedBuilderFeeUsd: number;
  };
}

interface OrderResult {
  success: boolean;
  orderID: number | null;
  clOrdID: string;
  error?: string;
  network: string;
  timestamp: number;
}

type Stage = 'idle' | 'connecting' | 'connected' | 'preparing' | 'ready' | 'approving' | 'signing' | 'submitting' | 'revoking' | 'done' | 'error';

export function SoDEXOrderPlacement({ tradeInput, riskScore, decision }: SoDEXOrderPlacementProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [networkConfig, setNetworkConfig] = useState<SodexExecutionConfig | null>(null);
  const [includeBuilderFee, setIncludeBuilderFee] = useState(false);
  const [builderFeeRate, setBuilderFeeRate] = useState('50');
  const [executionPreview, setExecutionPreview] = useState<ExecutionPreviewData | null>(null);
  const [prepared, setPrepared] = useState<PreparedOrder | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string | null>(null);
  const [maxSlippagePct, setMaxSlippagePct] = useState(1);
  const currentTrade = JSON.stringify({ symbol: tradeInput.symbol, action: tradeInput.action, amount: tradeInput.amount, riskScore, decision });
  const [previousTrade, setPreviousTrade] = useState(currentTrade);

  const canExecute = decision === 'APPROVE' || decision === 'CAUTION';

  if (previousTrade !== currentTrade) {
    setPreviousTrade(currentTrade);
    setPrepared(null);
    setResult(null);
    setErrorMessage(null);
    setErrorType(null);
    setIncludeBuilderFee(false);
    if (walletAddress) setStage('connected');
  }

  const connectWallet = async () => {
    if (!window.ethereum) {
      toast.error('No injected wallet found. Install MetaMask or another EIP-1193 wallet to place a testnet order.');
      return;
    }
    setStage('connecting');
    try {
      const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
      const address = accounts?.[0];
      if (!address) throw new Error('No wallet account returned');

      const configResponse = await fetch('/api/sodex/place-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'config' }),
      });
      const configJson = await configResponse.json();
      if (!configResponse.ok) throw new Error(configJson.error || 'Unable to load SoDEX execution configuration');
      const config = configJson as SodexExecutionConfig;
      setNetworkConfig(config);
      if (!config.executionEnabled) {
        throw new Error('Mainnet execution is disabled. Configure both SODEX_USE_TESTNET=false and SODEX_ENABLE_MAINNET_TRADING=true to enable it.');
      }
      if (config.builderID !== null) setBuilderFeeRate(String(config.maxBuilderFeeRate));
      await ensureSodexChain(config);

      setWalletAddress(address);
      setStage('connected');

      const previewRes = await fetch('/api/execution-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: tradeInput.symbol, action: tradeInput.action, amount: tradeInput.amount }),
      });
      const previewJson = await previewRes.json();
      if (previewRes.ok) {
        setExecutionPreview(previewJson);
      }
    } catch (error) {
      setStage('idle');
      toast.error(error instanceof Error ? error.message : 'Wallet connection failed');
    }
  };

  const prepareOrder = async () => {
    if (!walletAddress) return;
    const feeRate = Number(builderFeeRate);
    if (
      includeBuilderFee
      && (!Number.isSafeInteger(feeRate) || feeRate <= 0 || feeRate > (networkConfig?.maxBuilderFeeRate ?? 0))
    ) {
      setErrorMessage(`Enter a whole-number Builder Fee rate from 1 to ${networkConfig?.maxBuilderFeeRate ?? 0}.`);
      return;
    }
    setStage('preparing');
    setErrorMessage(null);
    setErrorType(null);
    try {
      const res = await fetch('/api/sodex/place-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare',
          symbol: tradeInput.symbol,
          side: tradeInput.action,
          amountUsd: tradeInput.amount,
          walletAddress,
          maxSlippagePct: maxSlippagePct / 100,
          decision,
          includeBuilderFee,
          builderFeeRate: feeRate,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorType(json.errorType ?? null);
        throw new Error(json.error || 'Failed to prepare order');
      }
      setPrepared(json);
      setStage('ready');
    } catch (error) {
      setStage('connected');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to prepare order');
    }
  };

  const updateBuilderFeeConsent = (consent: boolean) => {
    setIncludeBuilderFee(consent);
    if (prepared) {
      setPrepared(null);
      setResult(null);
      setErrorMessage(null);
      setStage('connected');
    }
  };

  const updateBuilderFeeRate = (rate: string) => {
    setBuilderFeeRate(rate);
    if (prepared) {
      setPrepared(null);
      setResult(null);
      setErrorMessage(null);
      setStage('connected');
    }
  };

  const builderFeeControls = () => {
    if (tradeInput.action.toLowerCase() !== 'sell') {
      return <p className="text-xs text-text-secondary">Builder fees do not apply to spot buy orders.</p>;
    }
    if (!networkConfig?.builderID || networkConfig.maxBuilderFeeRate <= 0) {
      return <p className="text-xs text-text-secondary">No Builder ID and non-zero maximum fee rate are configured for this network.</p>;
    }

    const feeRate = Number(builderFeeRate);
    const validFeeRate = Number.isSafeInteger(feeRate) && feeRate > 0 && feeRate <= networkConfig.maxBuilderFeeRate;

    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <label className="flex items-start gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={includeBuilderFee}
            onChange={(event) => updateBuilderFeeConsent(event.target.checked)}
            disabled={stage !== 'connected' && stage !== 'ready'}
            className="mt-0.5 accent-primary"
          />
          <span>
            Include Builder Fee for builder account {networkConfig.builderID}. The fee is charged only on eligible fills.
          </span>
        </label>
        {includeBuilderFee && (
          <div className="space-y-1">
            <label htmlFor="builder-fee-rate" className="text-xs text-text-secondary">
              Requested rate (max {builderFeeRateToPercent(networkConfig.maxBuilderFeeRate).toFixed(3)}%)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="builder-fee-rate"
                type="number"
                min={1}
                max={networkConfig.maxBuilderFeeRate}
                step={1}
                value={builderFeeRate}
                onChange={(event) => updateBuilderFeeRate(event.target.value)}
                disabled={stage !== 'connected' && stage !== 'ready'}
                className="w-28 rounded border border-border bg-background px-2 py-1 text-xs text-text-primary"
              />
              <span className="text-xs text-text-secondary">
                tenths of a bp {validFeeRate ? `(${builderFeeRateToPercent(feeRate).toFixed(3)}%)` : ''}
              </span>
            </div>
          </div>
        )}
        {networkConfig.configuredBuilderOwnerAddress && (
          <div className="break-all font-mono text-[10px] text-text-secondary">
            Configured builder owner: {networkConfig.configuredBuilderOwnerAddress}
          </div>
        )}
      </div>
    );
  };

  const revokeBuilderFee = async () => {
    if (
      !walletAddress
      || !window.ethereum
      || !networkConfig
      || networkConfig.builderID === null
    ) return;
    setStage('revoking');
    setErrorMessage(null);
    setErrorType(null);
    try {
      await ensureSodexChain(networkConfig);
      const prepareResponse = await fetch('/api/sodex/place-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prepare-builder-fee-revocation', walletAddress }),
      });
      const request = await prepareResponse.json();
      if (!prepareResponse.ok) throw new Error(request.error || 'Unable to prepare Builder Fee revocation');

      const signature = await window.ethereum.request({
        method: 'eth_signTypedData_v4',
        params: [walletAddress, JSON.stringify(request.typedData)],
      }) as string;
      const revokeResponse = await fetch('/api/sodex/place-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'revoke-builder-fee',
          nonce: request.nonce,
          signature,
          walletAddress,
        }),
      });
      const result = await revokeResponse.json();
      if (!revokeResponse.ok) throw new Error(result.error || 'Builder Fee revocation could not be verified');

      setPrepared(null);
      setResult(null);
      setIncludeBuilderFee(false);
      setStage('connected');
      setErrorMessage(`Builder Fee approval for account ${result.builderID} was revoked and confirmed on Spot and Perps.`);
    } catch (error) {
      setPrepared(null);
      setStage('connected');
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      setErrorMessage(
        code === 4001
          ? 'Builder Fee revocation was declined in your wallet.'
          : error instanceof Error ? error.message : 'Builder Fee revocation failed'
      );
    }
  };

  const signAndSubmit = async () => {
    if (!prepared || !walletAddress || !window.ethereum || !networkConfig) return;
    setStage(prepared.approvalRequired ? 'approving' : 'signing');
    setErrorMessage(null);
    setErrorType(null);
    let approvalCompleted = false;
    let approvalRequestSent = false;
    try {
      // Defensive re-check — the user may have switched networks in their wallet
      // since connecting, and a stale chain would make the signature invalid.
      await ensureSodexChain(networkConfig);

      let typedData = prepared.typedData;
      let nonce = prepared.nonce;
      if (prepared.approvalRequired) {
        if (!prepared.approvalTypedData || prepared.approvalNonce === undefined) {
          throw new Error('The builder fee approval request is incomplete. Review the order again.');
        }

        const approvalSignature = (await window.ethereum.request({
          method: 'eth_signTypedData_v4',
          params: [walletAddress, JSON.stringify(prepared.approvalTypedData)],
        })) as string;
        approvalRequestSent = true;
        const approvalRes = await fetch('/api/sodex/place-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'approve-builder-fee',
            orderParams: prepared.orderParams,
            approvalNonce: prepared.approvalNonce,
            signature: approvalSignature,
            walletAddress,
          }),
        });
        const approvalJson = await approvalRes.json();
        if (!approvalRes.ok) {
          throw new Error(approvalJson.error || 'SoDEX builder fee approval failed');
        }
        if (!approvalJson.typedData || !Number.isSafeInteger(approvalJson.nonce)) {
          throw new Error('SoDEX approved the builder fee but did not return order-signing data.');
        }

        typedData = approvalJson.typedData;
        nonce = approvalJson.nonce;
        approvalCompleted = true;
        setPrepared({ ...prepared, approvalRequired: false, approvalTypedData: undefined, typedData, nonce });
        setStage('signing');
      }

      if (!typedData || nonce === undefined) {
        throw new Error('The order-signing request is incomplete. Review the order again.');
      }

      const signature = (await window.ethereum.request({
        method: 'eth_signTypedData_v4',
        params: [walletAddress, JSON.stringify(typedData)],
      })) as string;

      setStage('submitting');
      const res = await fetch('/api/sodex/place-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          orderParams: prepared.orderParams,
          nonce,
          signature,
          walletAddress,
        }),
      });
      const json = await res.json();
      if (['BUILDER_APPROVAL_REQUIRED', 'BUILDER_CONFIG_MISMATCH', 'NETWORK_CONFIG_MISMATCH'].includes(json.errorType)) {
        setPrepared(null);
        setErrorType(json.errorType);
        setErrorMessage(json.error);
        setStage('connected');
        return;
      }
      setResult(json);
      setStage(json.success ? 'done' : 'error');
      if (!json.success) setErrorMessage(json.error || 'Order rejected by SoDEX');
    } catch (error) {
      setStage(approvalRequestSent && !approvalCompleted ? 'connected' : 'ready');
      if (approvalRequestSent && !approvalCompleted) setPrepared(null);
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code === 4001) {
        setErrorMessage(
          approvalCompleted
            ? 'Order signing was declined. Your Builder Fee approval remains active; no order was placed.'
            : prepared.approvalRequired
              ? 'Builder Fee approval was declined; no order was placed.'
              : 'Order signing was declined; no order was placed.'
        );
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'Signing was cancelled or failed');
      }
    }
  };

  if (!canExecute) {
    return (
      <Card className="terminal-card border-border">
        <CardContent className="pt-6 text-sm text-text-secondary">
          Execution is not available for {decision.replace('_', ' / ')} trades. {decision === 'BLOCK' ? 'This trade cannot proceed to execution.' : 'Reduce the position size and re-run analysis to unlock execution.'}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="terminal-card border-primary/20">
      <CardHeader>
        <CardTitle className="text-card-heading flex items-center justify-between">
          <span>SoDEX {networkConfig?.network === 'mainnet' ? 'Mainnet' : 'Testnet'} Execution</span>
          <Badge variant="outline" className="text-xs border-primary/40 text-primary">
            {networkConfig?.network === 'mainnet' ? 'Mainnet — real funds' : 'Testnet — no real funds'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {stage === 'idle' && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Connect a wallet to place a signed order on the selected SoDEX network (Testnet by default). Mainnet orders use real funds. No wallet is required to analyze risk — only to execute.
            </p>
            <Button onClick={connectWallet} className="btn-primary w-full">Connect Wallet</Button>
          </div>
        )}

        {stage === 'connecting' && (
          <p className="text-sm text-text-secondary">
            Requesting wallet connection… Your wallet may ask to add or switch to the selected ValueChain network before signing.
          </p>
        )}

        {(stage === 'connected' || stage === 'preparing') && walletAddress && (
          <div className="space-y-4">
            <div className="text-xs text-text-secondary font-mono">Connected: {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}</div>
            <div className="text-xs text-text-secondary">
              Selected execution network: <span className="font-medium text-text-primary">{networkConfig?.network === 'mainnet' ? 'SoDEX Mainnet' : 'SoDEX Testnet'}</span>
            </div>

            {executionPreview && (
              <div className="p-3 bg-surface rounded-lg text-xs text-text-secondary space-y-1">
                <div className="text-text-primary font-medium mb-1">Execution Preview (SoDEX {networkConfig?.network ?? 'testnet'}, live)</div>
                <div>Estimated price: ${executionPreview.estimatedPrice.toLocaleString()}</div>
                <div>Estimated slippage: {(executionPreview.estimatedSlippage * 100).toFixed(2)}%</div>
                <div>Price impact: {(executionPreview.priceImpact * 100).toFixed(2)}%</div>
                <div>Execution probability: {Math.round(executionPreview.executionProbability * 100)}%</div>
                {executionPreview.warnings.length > 0 && (
                  <div className="text-warning">{executionPreview.warnings.join(' · ')}</div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="max-slippage" className="text-xs text-text-secondary">Max slippage protection: {maxSlippagePct.toFixed(1)}%</label>
              <input
                id="max-slippage"
                type="range"
                min={0.1}
                max={5}
                step={0.1}
                value={maxSlippagePct}
                onChange={(e) => setMaxSlippagePct(parseFloat(e.target.value))}
                className="w-full accent-primary"
              />
            </div>

            {builderFeeControls()}
            {networkConfig?.builderID !== null && networkConfig?.builderID !== undefined && (
              <Button onClick={revokeBuilderFee} disabled={stage !== 'connected'} variant="outline" className="w-full">
                Revoke existing Builder Fee approval
              </Button>
            )}

            {errorMessage && (
              <div className="text-xs text-danger space-y-1">
                <p>{errorMessage}</p>
                {errorType === 'NOT_ONBOARDED' && networkConfig?.network === 'testnet' && (
                  <a
                    href="https://testnet.sodex.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-2 hover:underline inline-block"
                  >
                    Open SoDEX Testnet to connect this wallet and claim faucet funds →
                  </a>
                )}
              </div>
            )}

            <Button
              onClick={prepareOrder}
              disabled={
                stage === 'preparing'
                || (includeBuilderFee && (
                  !Number.isSafeInteger(Number(builderFeeRate))
                  || Number(builderFeeRate) <= 0
                  || Number(builderFeeRate) > (networkConfig?.maxBuilderFeeRate ?? 0)
                ))
              }
              className="btn-primary w-full"
            >
              {stage === 'preparing' ? 'Preparing order…' : 'Review Order'}
            </Button>
          </div>
        )}

        {(stage === 'ready' || stage === 'approving' || stage === 'signing' || stage === 'submitting') && prepared && (
          <div className="space-y-4">
            <div className="p-4 bg-surface rounded-lg space-y-2 text-sm">
              <div className="text-text-primary font-medium mb-1">Order Ticket — review before signing</div>
              <Row label="Symbol" value={prepared.preview.symbol} />
              <Row label="Side" value={prepared.preview.side} />
              <Row label="Order Type / TIF" value={`${prepared.preview.orderType} / ${prepared.preview.timeInForce}`} />
              <Row label="Quantity" value={prepared.preview.quantity} />
              <Row label="Protection Price" value={`$${prepared.preview.protectionPrice}`} />
              <Row label="Max Slippage" value={`${(prepared.preview.slippagePct * 100).toFixed(1)}%`} />
              <Row label="Estimated Notional" value={`$${prepared.preview.estimatedNotionalUsd.toLocaleString()}`} />
              {builderFeeControls()}
              {prepared.preview.builderID !== null ? (
                <>
                  <Row label="Builder Account ID" value={String(prepared.preview.builderID)} />
                  <Row
                    label="Builder Fee"
                    value={`${prepared.preview.builderFeePercent.toFixed(3)}% max (about $${prepared.preview.estimatedBuilderFeeUsd.toFixed(2)})`}
                  />
                </>
              ) : (
                <Row
                  label="Builder Fee"
                  value={prepared.preview.side === 'BUY' ? 'Not charged on spot buys' : 'Not configured'}
                />
              )}
              <Row label="Network" value={prepared.preview.network === 'mainnet' ? 'SoDEX Mainnet' : 'SoDEX Testnet'} />
              <Row label="Risk Score / Decision" value={`${riskScore}/100 — ${decision}`} />
            </div>

            {prepared.approvalRequired && (
              <p className="text-xs text-text-secondary">
                Your wallet must approve a maximum Builder Fee of {prepared.preview.builderFeePercent.toFixed(3)}% for this builder before the order can be signed. This is a separate approval; declining it will not place the order.
              </p>
            )}
            {prepared.preview.builderID !== null && !prepared.approvalRequired && (
              <p className="text-xs text-text-secondary">
                The current SoDEX approval covers this Builder Fee. Approval status is checked again whenever you review an order.
              </p>
            )}

            {errorMessage && <p className="text-xs text-danger">{errorMessage}</p>}

            <Button onClick={signAndSubmit} disabled={stage !== 'ready'} className="btn-primary w-full">
              {stage === 'approving'
                ? 'Waiting for Builder Fee approval…'
                : stage === 'signing'
                  ? 'Waiting for order signature…'
                  : stage === 'submitting'
                    ? `Submitting to SoDEX ${prepared.preview.network}…`
                    : prepared.approvalRequired
                      ? 'Approve Fee & Sign Order'
                      : 'Sign & Place Order'}
            </Button>
            {prepared.preview.builderID !== null && !prepared.approvalRequired && (
              <Button onClick={revokeBuilderFee} disabled={stage !== 'ready'} variant="outline" className="w-full">
                Revoke Builder Fee approval
              </Button>
            )}
          </div>
        )}

        {(stage === 'done' || stage === 'error') && result && (
          <div className={`p-4 rounded-lg space-y-2 text-sm ${result.success ? 'bg-success/5 border border-success/30' : 'bg-danger/5 border border-danger/30'}`}>
            <div className={`font-medium ${result.success ? 'text-success' : 'text-danger'}`}>
              {result.success ? `Order placed on SoDEX ${result.network === 'mainnet' ? 'Mainnet' : 'Testnet'}` : 'Order failed'}
            </div>
            <Row label="Order ID" value={result.orderID ? String(result.orderID) : '—'} />
            <Row label="Client Order ID" value={result.clOrdID} />
            <Row label="Submitted size" value={prepared?.preview.quantity ?? '—'} />
            <Row label="Protection price" value={prepared ? `$${prepared.preview.protectionPrice}` : '—'} />
            <Row label="Risk score at execution" value={`${riskScore}/100 — ${decision}`} />
            <Row label="Timestamp" value={new Date(result.timestamp).toLocaleString()} />
            <Row label="Network" value={result.network === 'mainnet' ? 'SoDEX Mainnet' : 'SoDEX Testnet'} />
            {!result.success && result.error && <p className="text-xs text-danger">{result.error}</p>}
            {prepared?.preview.builderID !== null && prepared?.preview.builderID !== undefined && !prepared.approvalRequired && (
              <Button onClick={revokeBuilderFee} variant="outline" className="w-full">
                Revoke Builder Fee approval
              </Button>
            )}
          </div>
        )}

        {stage === 'revoking' && (
          <p className="text-sm text-text-secondary">Waiting for wallet signature and verifying revocation on Spot and Perps…</p>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-primary font-mono text-xs">{value}</span>
    </div>
  );
}
