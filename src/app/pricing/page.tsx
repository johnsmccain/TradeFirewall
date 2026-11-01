'use client';

import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function PricingPage() {
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
            Intended Pricing
          </h1>
          <p className="text-xl text-body max-w-3xl mx-auto leading-relaxed">
            This is the packaging TradeFirewall is intended to launch with. Nothing on this page is for sale: there is
            no checkout, no account, no payment processing, and no quota enforcement. Every capability listed under
            &ldquo;what works today&rdquo; is already usable by anyone, at no cost.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-6 mb-16">
          {/* Free Plan */}
          <Card className="terminal-card">
            <CardHeader className="text-center pb-4">
              <CardTitle className="text-card-heading">Free</CardTitle>
              <div className="text-4xl font-bold text-text-primary">$0</div>
              <div className="text-sm text-text-secondary">Forever</div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-3 text-sm">
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">10 trade checks/month — limit not yet enforced</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Basic risk scoring</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Risk explanations</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Web dashboard</span>
                </li>
              </ul>
              <Link href="/check-trade">
                <Button className="w-full btn-secondary mt-6">
                  Open the App
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Pro Plan */}
          <Card className="terminal-card border-primary/30 relative">
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
              <Badge className="bg-primary text-background px-3 py-1 text-xs">
                Most Popular
              </Badge>
            </div>
            <CardHeader className="text-center pb-4">
              <CardTitle className="text-card-heading">Pro</CardTitle>
              <div className="text-4xl font-bold text-text-primary">$29</div>
              <div className="text-sm text-text-secondary">per month</div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-3 text-sm">
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">500 trade checks/month — limit not yet enforced</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Advanced risk models — one weighted model ships today</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Portfolio risk tracking — not built</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Real-time alerts — not built</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Export reports</span>
                </li>
              </ul>
              <Button 
                className="w-full btn-primary mt-6"
                onClick={() => {
                  const email = 'contact@tradefirewall.com';
                  const subject = 'Pro Plan Inquiry';
                  const body = 'Hi, I am interested in the TradeFirewall Pro plan. Please provide more information about pricing and features.';
                  window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                }}
              >
                Express interest (placeholder inbox)
              </Button>
            </CardContent>
          </Card>

          {/* Advanced Trader Plan */}
          <Card className="terminal-card">
            <CardHeader className="text-center pb-4">
              <CardTitle className="text-card-heading">Advanced Trader</CardTitle>
              <div className="text-4xl font-bold text-text-primary">$99</div>
              <div className="text-sm text-text-secondary">per month</div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-3 text-sm">
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Unlimited trade checks — no quota enforced</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Custom risk profiles (beta)</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">API access (1K calls/mo) — no quota enforced</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Priority support</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Webhook integrations — not built</span>
                </li>
              </ul>
              <Button 
                className="w-full btn-secondary mt-6"
                onClick={() => {
                  const email = 'contact@tradefirewall.com';
                  const subject = 'Advanced Trader Plan Inquiry';
                  const body = 'Hi, I am interested in the TradeFirewall Advanced Trader plan. Please provide more information about pricing and features.';
                  window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                }}
              >
                Express interest (placeholder inbox)
              </Button>
            </CardContent>
          </Card>

          {/* Community Bot Plan */}
          <Card className="terminal-card">
            <CardHeader className="text-center pb-4">
              <CardTitle className="text-card-heading">Community Bot</CardTitle>
              <div className="text-4xl font-bold text-text-primary">$199</div>
              <div className="text-sm text-text-secondary">per month</div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-3 text-sm">
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">10K API calls/month — no quota enforced</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Telegram/Discord bots — not built</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Signal validation</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Community dashboard — single-user dashboard only</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">White-label options — not built</span>
                </li>
              </ul>
              <Button 
                className="w-full btn-secondary mt-6"
                onClick={() => {
                  const email = 'contact@tradefirewall.com';
                  const subject = 'Community Bot Plan Inquiry';
                  const body = 'Hi, I am interested in the TradeFirewall Community Bot plan. Please provide more information about pricing and features.';
                  window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                }}
              >
                Express interest (placeholder inbox)
              </Button>
            </CardContent>
          </Card>

          {/* API Plan */}
          <Card className="terminal-card">
            <CardHeader className="text-center pb-4">
              <CardTitle className="text-card-heading">API Enterprise</CardTitle>
              <div className="text-4xl font-bold text-text-primary">Custom</div>
              <div className="text-sm text-text-secondary">Contact us</div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-3 text-sm">
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Unlimited API calls — no quota enforced</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Custom integrations</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">On-premise deployment — not built</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Dedicated support — none committed</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-success/20 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                  </div>
                  <span className="text-text-secondary">Uptime target — none committed</span>
                </li>
              </ul>
              <Button 
                className="w-full btn-secondary mt-6"
                onClick={() => {
                  const email = 'sales@tradefirewall.com';
                  const subject = 'Enterprise API Plan Inquiry';
                  const body = 'Hi, I am interested in the TradeFirewall Enterprise API plan. Please provide more information about custom pricing and enterprise features.';
                  window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                }}
              >
                Contact (placeholder inbox)
              </Button>
            </CardContent>
          </Card>
        </div>
        {/* What actually works today */}
        <div className="mb-16">
          <h2 className="text-section-heading mb-4 text-center">What Actually Works Today</h2>
          <p className="text-body max-w-3xl mx-auto text-center mb-12 leading-relaxed">
            The table below is the honest one: what this build does and does not do. It replaces the usual per-tier
            feature grid, because there are no tiers yet — everything that exists is available to everyone, and nothing
            is gated.
          </p>

          <Card className="terminal-card">
            <CardContent className="p-0">
              <div className="terminal-table">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="text-left">Capability</th>
                      <th className="text-center">Status</th>
                      <th className="text-left">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="text-text-primary font-medium">10-factor risk scoring</td>
                      <td className="text-center text-success">Working</td>
                      <td className="text-text-secondary">Live SoSoValue + SoDEX per request, weights published with every score</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">Plain-language explanations</td>
                      <td className="text-center text-success">Working</td>
                      <td className="text-text-secondary">Rule-based, factor by factor — no language model in the path</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">Custom risk profiles</td>
                      <td className="text-center text-success">Working</td>
                      <td className="text-text-secondary">Define your own thresholds in-browser; server clamps them</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">Historical backtest</td>
                      <td className="text-center text-success">Working</td>
                      <td className="text-text-secondary">Real SoDEX daily closes replayed through the live scoring pipeline</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">PDF / clipboard export</td>
                      <td className="text-center text-success">Working</td>
                      <td className="text-text-secondary">Uses the browser print dialog</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">Dashboard &amp; watchlist</td>
                      <td className="text-center text-success">Working</td>
                      <td className="text-text-secondary">Browser-local only — nothing is uploaded or synced</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">REST endpoints</td>
                      <td className="text-center text-success">Working</td>
                      <td className="text-text-secondary">Unauthenticated and unmetered — needs auth/rate limiting before public exposure</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">Signed order placement</td>
                      <td className="text-center text-warning">Testnet default</td>
                      <td className="text-text-secondary">Mainnet requires both SODEX_USE_TESTNET=false and SODEX_ENABLE_MAINNET_TRADING=true</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">Accounts &amp; billing</td>
                      <td className="text-center text-text-muted">Not built</td>
                      <td className="text-text-secondary">No signup, no payment, no plan enforcement</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">Rate limiting &amp; per-user quotas</td>
                      <td className="text-center text-text-muted">Not built</td>
                      <td className="text-text-secondary">Every request consumes the deployment&apos;s upstream quota</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">Portfolio tracking</td>
                      <td className="text-center text-text-muted">Not built</td>
                      <td className="text-text-secondary">No position state — the engine scores one proposed trade at a time</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">Real-time alerts / webhooks</td>
                      <td className="text-center text-text-muted">Not built</td>
                      <td className="text-text-secondary">Analysis runs on demand; nothing pushes</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">Telegram / Discord bots</td>
                      <td className="text-center text-text-muted">Not built</td>
                      <td className="text-text-secondary">Callable via the REST endpoints, but no bot ships</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">White-label / on-premise</td>
                      <td className="text-center text-text-muted">Not built</td>
                      <td className="text-text-secondary">No theming layer, no deployment tooling</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Use Cases */}
        <div className="mb-16">
          <h2 className="text-section-heading mb-4 text-center">Who This Is Intended For</h2>
          <p className="text-body max-w-3xl mx-auto text-center mb-12 leading-relaxed">
            Positioning for the tiers above. Several capabilities named here — portfolio tracking, alerts, bot
            integrations, white-label, on-premise, compliance reporting — are not built yet; the status table above is
            the authoritative list of what exists.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card className="terminal-card">
              <CardHeader>
                <CardTitle className="text-card-heading">Individual Traders</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-body mb-4">
                  Perfect for retail traders who want to add risk intelligence to their personal trading.
                </p>
                <div className="text-sm text-text-secondary mb-4">
                  <strong className="text-text-primary">Recommended:</strong> Free → Pro
                </div>
                <ul className="text-sm text-text-secondary space-y-1">
                  <li>• Start with 10 free checks</li>
                  <li>• Upgrade for portfolio tracking</li>
                  <li>• Real-time market alerts</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="terminal-card">
              <CardHeader>
                <CardTitle className="text-card-heading">Professional Traders</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-body mb-4">
                  For active traders and fund managers who need unlimited analysis and custom models.
                </p>
                <div className="text-sm text-text-secondary mb-4">
                  <strong className="text-text-primary">Recommended:</strong> Advanced Trader
                </div>
                <ul className="text-sm text-text-secondary space-y-1">
                  <li>• Unlimited trade analysis</li>
                  <li>• Custom risk profiles</li>
                  <li>• API integration</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="terminal-card">
              <CardHeader>
                <CardTitle className="text-card-heading">Signal Groups & Communities</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-body mb-4">
                  Ideal for Telegram/Discord communities that share trading signals and want to add risk validation.
                </p>
                <div className="text-sm text-text-secondary mb-4">
                  <strong className="text-text-primary">Recommended:</strong> Community Bot
                </div>
                <ul className="text-sm text-text-secondary space-y-1">
                  <li>• Bot integrations</li>
                  <li>• Signal validation</li>
                  <li>• Community protection</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="terminal-card">
              <CardHeader>
                <CardTitle className="text-card-heading">Trading Platforms</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-body mb-4">
                  For exchanges, wallets, and DeFi platforms that want to integrate risk intelligence.
                </p>
                <div className="text-sm text-text-secondary mb-4">
                  <strong className="text-text-primary">Recommended:</strong> API Enterprise
                </div>
                <ul className="text-sm text-text-secondary space-y-1">
                  <li>• Unlimited API calls</li>
                  <li>• Custom integrations</li>
                  <li>• White-label solutions</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="terminal-card">
              <CardHeader>
                <CardTitle className="text-card-heading">DeFi Protocols</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-body mb-4">
                  For DeFi apps that want to protect users from high-risk swaps and leverage positions.
                </p>
                <div className="text-sm text-text-secondary mb-4">
                  <strong className="text-text-primary">Recommended:</strong> API Enterprise
                </div>
                <ul className="text-sm text-text-secondary space-y-1">
                  <li>• On-premise deployment</li>
                  <li>• Custom risk models</li>
                  <li>• Protocol integration</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="terminal-card">
              <CardHeader>
                <CardTitle className="text-card-heading">Institutional Clients</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-body mb-4">
                  For hedge funds, family offices, and institutions requiring enterprise-grade risk management.
                </p>
                <div className="text-sm text-text-secondary mb-4">
                  <strong className="text-text-primary">Recommended:</strong> API Enterprise
                </div>
                <ul className="text-sm text-text-secondary space-y-1">
                  <li>• Dedicated support</li>
                  <li>• Compliance reporting</li>
                  <li>• Custom deployment</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-16">
          <h2 className="text-section-heading mb-12 text-center">Frequently Asked Questions</h2>
          
          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div>
                <h3 className="text-card-heading mb-2">How accurate are the risk scores?</h3>
                <p className="text-body">
                  Scores come from a transparent weighted model over live market data: volatility, trend, sentiment,
                  volume, liquidity, execution, sector, macro, position size and holding period. No model is trained and
                  no output is generated by a language model — every factor and its weight is published with each
                  report, and the /validate page replays real historical prices through the same scoring pipeline so you
                  can see the false-positive rate for yourself.
                </p>
              </div>
              
              <div>
                <h3 className="text-card-heading mb-2">Can I cancel anytime? Do you offer refunds?</h3>
                <p className="text-body">
                  Not applicable yet — there is nothing to cancel. No plan is for sale and no payment is processed
                  anywhere in this app, so there is no subscription to cancel, no renewal, and no refund policy. When
                  billing is actually built out, this is where the cancellation and refund terms will be published.
                </p>
              </div>
            </div>
            
            <div className="space-y-6">
              <div>
                <h3 className="text-card-heading mb-2">What data sources do you use?</h3>
                <p className="text-body">
                  Two live providers: SoSoValue for market intelligence (price, trend, news sentiment, volume, sector,
                  macro risk context) and SoDEX for market microstructure (orderbook, liquidity, spread, slippage and
                  execution preview). Both are queried per analysis, and every report lists the exact endpoints used.
                </p>
              </div>
              
              <div>
                <h3 className="text-card-heading mb-2">Is this financial advice?</h3>
                <p className="text-body">
                  No, TradeFirewall provides risk analysis and educational information only. 
                  Our tools are designed to help you make more informed decisions, but all trading 
                  decisions remain your responsibility.
                </p>
              </div>
              
              <div>
                <h3 className="text-card-heading mb-2">How does the API work?</h3>
                <p className="text-body">
                  Our REST API allows you to submit trade proposals and receive risk analysis in real-time. 
                  Integration typically takes less than an hour with our comprehensive documentation and SDKs.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center bg-surface rounded-2xl p-12">
          <h2 className="text-section-heading mb-6">Ready to Start?</h2>
          <p className="text-xl text-body mb-8 max-w-2xl mx-auto leading-relaxed">
            TradeFirewall is a pre-launch buildathon project. The tiers below are the intended packaging, not a live
            subscription: nothing on this page is for sale, no payment is processed, and no account or billing exists
            yet. Every feature listed is usable today, without an upgrade.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/check-trade">
              <Button className="btn-primary px-8 py-3 text-base">
                Run a live analysis
              </Button>
            </Link>
            <Link href="/api">
              <Button className="btn-secondary px-8 py-3 text-base">
                Read the API reference
              </Button>
            </Link>
          </div>
        </div>

      </main>
    </div>
  );
}