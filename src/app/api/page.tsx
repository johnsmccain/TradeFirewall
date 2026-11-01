'use client';

import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const ANALYZE_RESPONSE = `{
  "tradeInput": { "symbol": "BTC", "action": "buy", ... },
  "riskAnalysis": {
    "riskScore": 45,
    "decision": "CAUTION",
    "confidence": 0.72,
    "reasons": ["High market volatility increases potential losses"],
    "saferAction": "Consider reducing position size by 25-50% or wait for better entry",
    "suggestedPositionSize": "Consider reducing to $3,271 (tolerance $5,000)",
    "marketFactors": {
      "volatility": 70, "sentiment": 40, "volume": 20, "trend": 30,
      "liquidity": 10, "execution": 10, "sector": 50, "macro": 50,
      "positionSize": 10, "holdingPeriod": 60
    },
    "factorWeights": { "volatility": 0.18, "sentiment": 0.10, ... },
    "riskProfile": "balanced",
    "riskProfileConfig": {
      "approve": 35, "caution": 50, "reduce": 70,
      "positionToleranceUsd": 5000
    },
    "riskProfileIsCustom": false,
    "calibration": { "band": "elevated", "scoreRange": [36, 50], ... },
    "reliability": { ... },
    "dataSourcesUsed": ["SoSoValue: ...", "SoDEX: ..."],
    "dataSourcesReport": {
      "lines": ["SoSoValue: market intelligence (...)", ...],
      "sosoValue": { "status": "connected", "live": true, ... },
      "sodex": { "status": "connected", "live": true, "network": "testnet", ... }
    },
    "liveSnapshot": {
      "sosoPrice": 45000, "sosoChange24hPct": 1.2,
      "sodexLast": "45000.00", "sodexBid": "44999.90",
      "sodexAsk": "45000.10", "spreadPercent": 0.0004
    }
  },
  "riskExplanation": { "summary": "...", "factors": [...] },
  "timestamp": 1640995200000,
  "apiStatus": {
    "sosoValueConnected": true, "sodexConnected": true,
    "sosoValueLabel": "SoSoValue: Connected", "sodexLabel": "SoDEX: Connected",
    "lastUpdatedIso": "...", "lastUpdatedDisplay": "..."
  }
}`;

export default function APIPage() {
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      console.log(`${label} copied to clipboard`);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <SiteNav
        actions={
          <Link href="/check-trade">
            <Button className="btn-primary px-4 py-2 text-sm">Go to App</Button>
          </Link>
        }
      />

      <main className="max-w-7xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-section-heading mb-6">
            API Reference
          </h1>
          <p className="text-xl text-body max-w-3xl mx-auto leading-relaxed">
            TradeFirewall exposes four HTTP endpoints from this same Next.js deployment. They are the ones the
            app itself calls — there is no separate hosted API, no API keys, and no SDK packages.
          </p>
        </div>

        {/* Status honesty banner */}
        <Card className="terminal-card border-warning/30 mb-16">
          <CardContent className="pt-6 space-y-2 text-sm text-text-secondary leading-relaxed">
            <p>
              <span className="text-text-primary font-medium">Before you integrate:</span> these routes are
              <span className="text-text-primary font-medium"> unauthenticated and unmetered</span>. There is no API key,
              no rate limiting, no quota, and no per-caller isolation — every request spends this deployment&apos;s
              SoSoValue and SoDEX quota. They are built for the web UI and for local/trusted-network use. Adding auth and
              rate limiting is required work before exposing this to the public internet.
            </p>
            <p>
              Upstream failures are surfaced honestly rather than hidden: if SoSoValue cannot be reached the request
              fails with <span className="font-mono text-xs">503</span> and no score is returned, while a SoDEX outage
              degrades to SoSoValue-only scoring with the affected factors set to a neutral 50 and the degradation
              recorded in <span className="font-mono text-xs">apiStatus</span> and{' '}
              <span className="font-mono text-xs">dataSourcesReport</span>. Always check{' '}
              <span className="font-mono text-xs">apiStatus.sodexConnected</span> before trusting a score.
            </p>
          </CardContent>
        </Card>

        {/* Endpoints */}
        <div className="mb-16">
          <h2 className="text-section-heading mb-8">Endpoints</h2>

          <div className="space-y-8">
            {/* Analyze Trade */}
            <Card className="terminal-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-card-heading">Analyze Trade</CardTitle>
                  <Badge className="bg-primary text-background">POST</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h4 className="text-label mb-2">Endpoint</h4>
                  <div className="bg-surface p-3 rounded-lg font-mono text-sm">
                    POST /api/analyze-trade
                  </div>
                </div>

                <div>
                  <h4 className="text-label mb-2">Request Body</h4>
                  <div className="bg-surface p-4 rounded-lg">
                    <pre className="text-sm text-text-primary overflow-x-auto">
{`{
  "symbol": "BTC",
  "action": "buy",
  "amount": 5000,
  "holdingPeriod": "1day",
  "riskProfile": "balanced"
}`}
                    </pre>
                  </div>
                  <div className="mt-2 text-xs text-text-secondary space-y-1">
                    <div><span className="font-mono">symbol</span> — required, 2&ndash;10 letters, uppercased server-side.</div>
                    <div><span className="font-mono">action</span> — required, <span className="font-mono">buy</span> or <span className="font-mono">sell</span>. Threaded into the trend, sentiment and sector factors.</div>
                    <div><span className="font-mono">amount</span> — required, positive USD notional.</div>
                    <div><span className="font-mono">holdingPeriod</span> — required, one of <span className="font-mono">intraday</span>, <span className="font-mono">1day</span>, <span className="font-mono">7days</span>, <span className="font-mono">30days</span>.</div>
                    <div>
                      <span className="font-mono">riskProfile</span> — required. A built-in name (<span className="font-mono">conservative</span>, <span className="font-mono">balanced</span>, <span className="font-mono">aggressive</span>)
                      takes no config. Any other name must be accompanied by <span className="font-mono">riskProfileConfig</span>.
                    </div>
                    <div>
                      <span className="font-mono">riskProfileConfig</span> — optional, for custom profiles only:{' '}
                      <span className="font-mono">{'{ approve, caution, reduce, positionToleranceUsd }'}</span>.
                      Server-clamped to 0&ndash;100 (thresholds), $100&ndash;$1,000,000 (tolerance) and forced monotonic, so a
                      client cannot post <span className="font-mono">approve: 9999</span> to force an APPROVE.
                    </div>
                  </div>
                  <Button
                    className="btn-secondary text-xs mt-3"
                    onClick={() => copyToClipboard(`{
  "symbol": "BTC",
  "action": "buy",
  "amount": 5000,
  "holdingPeriod": "1day",
  "riskProfile": "balanced"
}`, 'Request example')}
                  >
                    Copy Request
                  </Button>
                </div>

                <div>
                  <h4 className="text-label mb-2">Response (abridged)</h4>
                  <div className="bg-surface p-4 rounded-lg">
                    <pre className="text-xs text-text-primary overflow-x-auto">
{ANALYZE_RESPONSE}
                    </pre>
                  </div>
                  <Button
                    className="btn-secondary text-xs mt-2"
                    onClick={() => copyToClipboard(ANALYZE_RESPONSE, 'Response example')}
                  >
                    Copy Response
                  </Button>
                  <p className="text-xs text-text-secondary mt-2">
                    Abridged for reading. <span className="font-mono">marketFactors</span> always carries all ten
                    factors; the ellipses stand for further fields, not for absent ones. No field here is a language-model
                    output — every score is computed by the weighted model in{' '}
                    <span className="font-mono">src/lib/riskEngine.ts</span> and published with its own weight.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Execution Preview */}
            <Card className="terminal-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-card-heading">Execution Preview</CardTitle>
                  <Badge className="bg-primary text-background">POST</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h4 className="text-label mb-2">Endpoint</h4>
                  <div className="bg-surface p-3 rounded-lg font-mono text-sm">
                    POST /api/execution-preview
                  </div>
                </div>

                <div>
                  <h4 className="text-label mb-2">Request Body</h4>
                  <div className="bg-surface p-4 rounded-lg">
                    <pre className="text-sm text-text-primary overflow-x-auto">
{`{
  "symbol": "BTC",
  "action": "buy",
  "amount": 5000
}`}
                    </pre>
                  </div>
                </div>

                <div>
                  <h4 className="text-label mb-2">Response</h4>
                  <div className="bg-surface p-4 rounded-lg">
                    <pre className="text-sm text-text-primary overflow-x-auto">
{`{
  "symbol": "BTC",
  "side": "BUY",
  "amount": 5000,
  "estimatedPrice": 45000.05,
  "estimatedSlippage": 0.0012,
  "estimatedFees": 0.045,
  "priceImpact": 0.0008,
  "executionProbability": 0.9,
  "warnings": [],
  "canExecute": false,
  "mode": "preview",
  "timestamp": 1640995200000,
  "disclaimer": "This is a preview only. No real trades will be executed."
}`}
                    </pre>
                  </div>
                  <p className="text-xs text-text-secondary mt-2">
                    <span className="font-mono">canExecute</span> is hardcoded <span className="font-mono">false</span> and{' '}
                    <span className="font-mono">mode</span> is always <span className="font-mono">preview</span> on this
                    route. It walks the live SoDEX book to estimate fill cost and never places anything.
                  </p>
                </div>
            </CardContent>
            </Card>

            {/* Place Order */}
            <Card className="terminal-card border-primary/20">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-card-heading">Place Signed Order (testnet by default)</CardTitle>
                  <Badge className="bg-primary text-background">POST</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-text-secondary leading-relaxed">
                <div className="bg-surface p-3 rounded-lg font-mono text-sm text-text-primary">
                  POST /api/sodex/place-order
                </div>
                <p>
                  Submits a client-signed order to the selected SoDEX spot API. Testnet is the default. Mainnet is
                  available only when both <span className="font-mono">SODEX_USE_TESTNET=false</span> and{' '}
                  <span className="font-mono">SODEX_ENABLE_MAINNET_TRADING=true</span> are explicitly set; otherwise
                  signing and submission return <span className="font-mono">403 MAINNET_DISABLED</span>. Each network
                  uses its own chain ID, endpoint, and builder configuration.
                </p>
                <p>
                  The order and any builder approval are signed by the user&apos;s wallet in the browser. Mainnet orders
                  can use real funds and require a separate deployment-level opt-in.
                </p>
              </CardContent>
            </Card>

            {/* Currencies */}
            <Card className="terminal-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-card-heading">Supported Symbols</CardTitle>
                  <Badge className="bg-primary text-background">GET</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-text-secondary leading-relaxed">
                <div className="bg-surface p-3 rounded-lg font-mono text-sm text-text-primary">
                  GET /api/sosovalue/currencies
                </div>
                <p>
                  Proxies the SoSoValue currency list so the symbol combobox can be populated without exposing the
                  server-side API key to the browser. Returns{' '}
                  <span className="font-mono">{'{ currencies: [{ symbol, name }] }'}</span>. Symbols are validated
                  against this list at analysis time, so a symbol that SoSoValue does not carry fails with a{' '}
                  <span className="font-mono">404</span> rather than being silently scored.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Error Codes */}
        <div className="mb-16">
          <h2 className="text-section-heading mb-8">Error Codes</h2>

          <Card className="terminal-card">
            <CardContent className="pt-6">
              <div className="terminal-table">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="text-left">Code</th>
                      <th className="text-left">errorType</th>
                      <th className="text-left">Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="text-text-primary font-mono">400</td>
                      <td className="text-text-secondary font-mono text-xs">—</td>
                      <td className="text-text-secondary">Missing/invalid field: bad symbol format, action, holding period, or a custom profile without thresholds</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-mono">403</td>
                      <td className="text-text-secondary font-mono text-xs">MAINNET_DISABLED</td>
                      <td className="text-text-secondary">Mainnet selected without both explicit execution opt-ins</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-mono">404</td>
                      <td className="text-text-secondary font-mono text-xs">SYMBOL_NOT_FOUND, SYMBOL_NOT_FOUND_SOSOVALUE</td>
                      <td className="text-text-secondary">Symbol is not carried by SoSoValue or not listed on SoDEX</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-mono">500</td>
                      <td className="text-text-secondary font-mono text-xs">ANALYSIS_ERROR</td>
                      <td className="text-text-secondary">Unhandled failure — stack trace is server-side only</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-mono">502</td>
                      <td className="text-text-secondary font-mono text-xs">SOSOVALUE_API_ERROR, SOSOVALUE_HTTP_ERROR</td>
                      <td className="text-text-secondary">SoSoValue rejected the request or was unreachable — required, so no score is returned</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-mono">503</td>
                      <td className="text-text-secondary font-mono text-xs">API_CONNECTION_ERROR, SODEX_ERROR, SODEX_MARKET_ERROR, INSUFFICIENT_DATA</td>
                      <td className="text-text-secondary">Upstream market data unavailable. A SoDEX 503 is the one case that still returns a score — neutral-factor degraded, flagged in apiStatus</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-text-secondary mt-4">
                There is no <span className="font-mono">401</span>, <span className="font-mono">429</span> or any
                quota response, because this build has no authentication and no rate limiter.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Client libraries */}
        <div className="mb-16">
          <h2 className="text-section-heading mb-8">Client Libraries</h2>
          <Card className="terminal-card">
            <CardContent className="pt-6 text-sm text-text-secondary leading-relaxed">
              There are none. No <span className="font-mono">tradefirewall</span> package is published to npm, PyPI,
              crates.io or any Go module proxy — those install commands would fail. Both endpoints are plain JSON over
              HTTP, so a caller needs about ten lines:
              <pre className="text-xs text-text-primary bg-surface p-3 rounded-lg mt-3 overflow-x-auto">
{`const res = await fetch('/api/analyze-trade', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    symbol: 'BTC', action: 'buy', amount: 5000,
    holdingPeriod: '1day', riskProfile: 'balanced',
  }),
});
if (!res.ok) throw new Error((await res.json()).error);
const { riskAnalysis, apiStatus } = await res.json();
if (!apiStatus.sodexConnected) {
  // degraded score: volatility/liquidity/execution were neutral-defaulted
}`}
              </pre>
            </CardContent>
          </Card>
        </div>

        {/* CTA */}
        <div className="text-center bg-surface rounded-2xl p-12">
          <h2 className="text-section-heading mb-6">See It Against Real Market Data</h2>
          <p className="text-xl text-body mb-8 max-w-2xl mx-auto leading-relaxed">
            Every endpoint above runs live per request, against SoSoValue and SoDEX.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/check-trade">
              <Button className="btn-primary px-8 py-3 text-base">Run an Analysis</Button>
            </Link>
            <Link href="/validate">
              <Button className="btn-secondary px-8 py-3 text-base">Read the Backtest</Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
