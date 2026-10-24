'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TradeInputForm } from '@/components/TradeInputForm';
import { RiskScoreCard } from '@/components/RiskScoreCard';
import { RiskFactorsList } from '@/components/RiskFactorsList';
import { RiskExplanationBox } from '@/components/RiskExplanationBox';
import { ConfirmationGate } from '@/components/ConfirmationGate';
import { SoDEXOrderPlacement } from '@/components/SoDEXOrderPlacement';
import { TradeInput, RiskAnalysis, saferPositionAmount } from '@/lib/riskEngine';
import { RiskExplanation } from '@/lib/riskExplanation';
import { storageManager, WatchlistItem, SavedReport } from '@/lib/storage';
import { pdfGenerator, RiskReportData } from '@/lib/pdfGenerator';
import { toast } from '@/lib/toast';
import { toTradeCheckRows, type TradeCheckRow } from '@/lib/tradeCheckRow';
import { mapAnalyzeError } from '@/lib/analyzeErrors';
import { buildDataDisclosure } from '@/lib/dataDisclosure';
import {
  DECISION_HEADLINE,
  DECISION_PANEL_CLASS,
  DECISION_TEXT_CLASS,
  decisionLabel,
  decisionTint,
} from '@/lib/riskBand';

/** How many stored reports the "Recent Risk Checks" table shows. */
const RECENT_REPORT_LIMIT = 5;

function savedReportFieldsFromApiResult(result: {
  tradeInput: TradeInput;
  riskAnalysis: RiskAnalysis;
  riskExplanation: RiskExplanation;
  timestamp: number;
}): Omit<SavedReport, 'id' | 'createdAt'> {
  return {
    symbol: result.tradeInput.symbol,
    action: result.tradeInput.action,
    amount: result.tradeInput.amount,
    holdingPeriod: result.tradeInput.holdingPeriod,
    riskProfile: result.tradeInput.riskProfile,
    riskScore: result.riskAnalysis.riskScore,
    decision: result.riskAnalysis.decision,
    riskFactors: result.riskAnalysis.marketFactors,
    explanation: result.riskExplanation.summary,
    recommendedAction: result.riskAnalysis.saferAction,
    suggestedPositionSize: result.riskAnalysis.suggestedPositionSize,
    dataSourcesUsed: result.riskAnalysis.dataSourcesUsed,
    dataSourcesReport: result.riskAnalysis.dataSourcesReport,
    clientRunId: result.timestamp,
  };
}

interface AnalysisResult {
  tradeInput: TradeInput;
  riskAnalysis: RiskAnalysis;
  riskExplanation: RiskExplanation;
  timestamp: number;
  apiStatus?: {
    sosoValueConnected: boolean;
    sodexConnected: boolean;
    sosoValueLabel: string;
    sodexLabel: string;
    lastUpdatedIso: string;
    lastUpdatedDisplay: string;
    dataSourcesUsed: string[];
  };
  dataSourcesReport?: RiskAnalysis['dataSourcesReport'];
}

/**
 * Overall client-side budget for one analysis. The server can spend up to 8s on each SoSoValue
 * request and 8s on each SoDEX request, so this is deliberately generous — its job is to guarantee
 * the spinner always terminates, not to be the primary timeout.
 */
const CLIENT_ANALYSIS_TIMEOUT_MS = 30_000;

/** Ticks once a second while a request is in flight, purely to show real elapsed time. */
const ELAPSED_TICK_MS = 1000;

export default function CheckTradePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [beginnerMode, setBeginnerMode] = useState(false);
  const [beginnerSymbol, setBeginnerSymbol] = useState('');
  const [beginnerQuery, setBeginnerQuery] = useState('');
  const [beginnerDropdownOpen, setBeginnerDropdownOpen] = useState(false);
  const [beginnerAmount, setBeginnerAmount] = useState('');
  const [currencies, setCurrencies] = useState<{ symbol: string; name: string }[]>([]);
  const beginnerComboRef = useRef<HTMLDivElement>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [currentTrade, setCurrentTrade] = useState<TradeInput | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [recentReports, setRecentReports] = useState<TradeCheckRow[]>([]);
  /** Aborts the in-flight request. Also drives the Cancel button. */
  const abortRef = useRef<AbortController | null>(null);

  // Which factors in the displayed score are neutral placeholders rather than measurements.
  // Derived, so it can never disagree with the analysis it describes.
  const dataDisclosure = buildDataDisclosure(
    analysisResult?.riskAnalysis.estimatedFactors,
    analysisResult?.riskAnalysis.marketFactors,
    !!analysisResult?.apiStatus?.sodexConnected
  );

  // Load saved data on component mount. Must run in an effect (not a lazy useState
  // initializer) since localStorage isn't available during SSR — reading it eagerly
  // would mismatch the server-rendered HTML.
  // One place decides what "recent" means and how a stored report becomes a table row.
  const refreshRecentReports = () =>
    setRecentReports(toTradeCheckRows(storageManager.getReports(), RECENT_REPORT_LIMIT));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe localStorage hydration, not derived state
    setWatchlist(storageManager.getWatchlist());
    refreshRecentReports();
  }, []);

  // Fetch supported currencies for symbol combobox
  useEffect(() => {
    fetch('/api/sosovalue/currencies')
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.currencies)) setCurrencies(d.currencies); })
      .catch(() => {});
  }, []);

  // Close beginner combobox on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (beginnerComboRef.current && !beginnerComboRef.current.contains(e.target as Node)) {
        setBeginnerDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Refresh data when window gains focus (in case data was changed in another tab)
  useEffect(() => {
    const handleFocus = () => {
      setWatchlist(storageManager.getWatchlist());
      refreshRecentReports();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const handleBeginnerSubmit = () => {
    const sym = beginnerSymbol.trim().toUpperCase();
    const amt = parseFloat(beginnerAmount);    if (!sym || !/^[A-Z]{2,10}$/.test(sym)) {
      toast.error('Enter a valid symbol (e.g. BTC, ETH, SOL).');
      return;
    }
    if (!amt || amt <= 0) {
      toast.error('Enter a valid trade amount in USD.');
      return;
    }
    handleTradeSubmit({ symbol: sym, action: 'buy', amount: amt, holdingPeriod: '1day', riskProfile: 'balanced' });
  };

  const handleTradeSubmit = async (tradeInput: TradeInput) => {
    // A previous run may still be in flight (the reduce-and-re-analyze path, or a double submit).
    // Abort it so two responses can't race to set state.
    abortRef.current?.abort();

    setIsLoading(true);
    setElapsedSeconds(0);
    // The previous result is deliberately NOT cleared here. If this run fails, the user keeps
    // the analysis they were reading instead of being dropped back to an empty page.
    setShowConfirmation(false);
    setCurrentTrade(tradeInput);

    const controller = new AbortController();
    abortRef.current = controller;
    const timedOut = { value: false };
    const deadline = setTimeout(() => {
      timedOut.value = true;
      controller.abort();
    }, CLIENT_ANALYSIS_TIMEOUT_MS);

    // Real elapsed time, unlike the previous fixed 1.8s-step timer that advanced regardless of
    // what the server was doing and so never reflected reality.
    const elapsedTimer = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, ELAPSED_TICK_MS);

    try {
      const response = await fetch('/api/analyze-trade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tradeInput),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Kept as a structured failure rather than an Error carrying only a message, so the
        // mapping below can key off the server's errorType instead of guessing from text.
        throw await response
          .json()
          .catch(() => ({ error: `Request failed with status ${response.status}` }))
          .then((body) => Object.assign(body, { status: response.status }));
      }

      const result = await response.json();
      setAnalysisResult(result);

      try {
        storageManager.saveReport(savedReportFieldsFromApiResult(result));
        refreshRecentReports();
      } catch (e) {
        console.error('Failed to persist analysis to localStorage', e);
      }

      // Show confirmation gate for high-risk trades
      if (result.riskAnalysis.riskScore >= 51) {
        setShowConfirmation(true);
      }

    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError' && !timedOut.value;
      if (!cancelled) {
        console.error('Analysis error:', error);
      }

      const payload =
        error && typeof error === 'object' && 'errorType' in error
          ? (error as Record<string, unknown>)
          : { error: error instanceof Error ? error.message : undefined };

      const info = mapAnalyzeError(payload, {
        symbol: tradeInput.symbol,
        cancelled,
        timedOut: timedOut.value,
      });

      // Errors are actionable, so they need longer than the 4s default to read and act on.
      toast.error(info.message, 8000);
      if (info.detail && !cancelled) {
        toast.show('info', info.detail, 9000);
      }
    } finally {
      clearTimeout(deadline);
      clearInterval(elapsedTimer);
      abortRef.current = null;
      setIsLoading(false);
    }
  };

  const handleCancelAnalysis = () => {
    abortRef.current?.abort();
  };

  const handleReduceSize = () => {
    if (!analysisResult) return;

    // Reduce to the amount the report recommends rather than a hardcoded halving, so the number
    // the user is moved to is the one shown next to the recommendation. The gate only appears above
    // a score of 50, so the engine always has a number here; the fallback only guards a future
    // threshold change, and picks the more conservative of the two.
    const suggested = saferPositionAmount(
      analysisResult.tradeInput.amount,
      analysisResult.riskAnalysis.riskScore
    );
    const reducedAmount = Math.round(suggested ?? analysisResult.tradeInput.amount * 0.5);
    const reducedInput = {
      ...analysisResult.tradeInput,
      amount: reducedAmount,
    };
    
    toast.info(`Trade amount reduced to ${reducedAmount.toLocaleString()} based on risk recommendation.`);
    handleTradeSubmit(reducedInput);
  };

  const handleCancelTrade = () => {
    setShowConfirmation(false);
    toast.info('Trade cancelled.');
    
    // Mark report as cancelled if it was saved
    if (analysisResult) {
      const reports = storageManager.getReports();
      const match =
        reports.find((r) => r.clientRunId === analysisResult.timestamp) ??
        (reports[0]?.symbol === analysisResult.tradeInput.symbol ? reports[0] : null);
      if (match) {
        storageManager.updateReportStatus(match.id, 'cancelled');
        refreshRecentReports();
      }
    }
  };

  // Button functionality implementations
  const handleAddToWatchlist = () => {
    if (!analysisResult) {
      toast.error('Analyze a trade before adding to watchlist.');
      return;
    }
    
    const result = storageManager.addToWatchlist({
      symbol: analysisResult.tradeInput.symbol,
      source: 'risk-report',
      latestRiskScore: analysisResult.riskAnalysis.riskScore,
      latestDecision: analysisResult.riskAnalysis.decision
    });
    
    if (result.success) {
      toast.success(result.message);
      setWatchlist(storageManager.getWatchlist());
    } else {
      toast.info(result.message);
    }
  };

  const handleSaveReport = () => {
    if (!analysisResult) {
      toast.error('Analyze a trade before saving a report.');
      return;
    }
    
    const result = storageManager.saveReport(savedReportFieldsFromApiResult(analysisResult));
    
    if (result.success) {
      toast.success(result.message);
      // Refresh recent reports state immediately after saving
      refreshRecentReports();
    } else {
      toast.error(result.message);
    }
  };

  const handleNewAnalysis = () => {
    setAnalysisResult(null);
    setShowConfirmation(false);
    setCurrentTrade(null);
    toast.info('New analysis started.');
    
    // Focus on the symbol input field
    setTimeout(() => {
      const symbolInput = document.querySelector('input[name="symbol"]') as HTMLInputElement;
      if (symbolInput) {
        symbolInput.focus();
      }
    }, 100);
  };

  const handleViewPreviousReports = () => {
    const reports = storageManager.getReports();
    if (reports.length === 0) {
      toast.info('No saved reports yet. Analyze and save your first trade report.');
    } else {
      router.push('/dashboard#reports');
    }
  };

  const handleDownloadPDF = () => {
    if (!analysisResult) {
      toast.error('Analyze a trade before downloading a PDF.');
      return;
    }
    
    try {
      const reportData: RiskReportData = {
        symbol: analysisResult.tradeInput.symbol,
        action: analysisResult.tradeInput.action,
        amount: analysisResult.tradeInput.amount,
        holdingPeriod: analysisResult.tradeInput.holdingPeriod,
        riskProfile: analysisResult.riskAnalysis.riskProfile || analysisResult.tradeInput.riskProfile,
        riskProfileConfig: analysisResult.riskAnalysis.riskProfileConfig,
        riskProfileIsCustom: analysisResult.riskAnalysis.riskProfileIsCustom,
        riskScore: analysisResult.riskAnalysis.riskScore,
        decision: analysisResult.riskAnalysis.decision,
        riskFactors: analysisResult.riskAnalysis.marketFactors,
        explanation: analysisResult.riskExplanation.summary,
        recommendedAction: analysisResult.riskAnalysis.saferAction,
        suggestedPositionSize: analysisResult.riskAnalysis.suggestedPositionSize,
        dataSourcesUsed: analysisResult.riskAnalysis.dataSourcesUsed,
        dataSourcesReport: analysisResult.riskAnalysis.dataSourcesReport,
        timestamp: analysisResult.timestamp
      };
      
      pdfGenerator.generateRiskReportPDF(reportData);
      toast.success('PDF report generated. Check your browser for the print dialog.');
    } catch (error) {
      console.error('PDF generation error:', error);
      toast.error('Unable to generate PDF. Please try again.');
    }
  };

  const handleCopySummary = async () => {
    if (!analysisResult) {
      toast.error('Analyze a trade before copying summary.');
      return;
    }
    
    try {
      const reportData: RiskReportData = {
        symbol: analysisResult.tradeInput.symbol,
        action: analysisResult.tradeInput.action,
        amount: analysisResult.tradeInput.amount,
        holdingPeriod: analysisResult.tradeInput.holdingPeriod,
        riskProfile: analysisResult.riskAnalysis.riskProfile || analysisResult.tradeInput.riskProfile,
        riskProfileConfig: analysisResult.riskAnalysis.riskProfileConfig,
        riskProfileIsCustom: analysisResult.riskAnalysis.riskProfileIsCustom,
        riskScore: analysisResult.riskAnalysis.riskScore,
        decision: analysisResult.riskAnalysis.decision,
        riskFactors: analysisResult.riskAnalysis.marketFactors,
        explanation: analysisResult.riskExplanation.summary,
        recommendedAction: analysisResult.riskAnalysis.saferAction,
        suggestedPositionSize: analysisResult.riskAnalysis.suggestedPositionSize,
        dataSourcesUsed: analysisResult.riskAnalysis.dataSourcesUsed,
        dataSourcesReport: analysisResult.riskAnalysis.dataSourcesReport,
        timestamp: analysisResult.timestamp
      };
      
      const summaryText = pdfGenerator.generateSummaryText(reportData);
      const result = await pdfGenerator.copyToClipboard(summaryText);
      
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      console.error('Copy error:', error);
      toast.error('Unable to copy summary. Please try again.');
    }
  };

  const handleAddAssetToWatchlist = () => {
    const symbol = prompt('Enter asset symbol (e.g., BTC, ETH, SOL):');
    if (symbol && symbol.trim()) {
      const upperSymbol = symbol.trim().toUpperCase();
      
      // Validate symbol format
      if (!/^[A-Z]{2,10}$/.test(upperSymbol)) {
        toast.error('Invalid symbol format. Use uppercase letters only (e.g., BTC, ETH, SOL).');
        return;
      }
      
      const result = storageManager.addToWatchlist({
        symbol: upperSymbol,
        source: 'manual'
      });
      
      if (result.success) {
        toast.success(result.message);
        setWatchlist(storageManager.getWatchlist());
      } else {
        toast.info(result.message);
      }
    }
  };

  const handleRemoveFromWatchlist = (symbolToRemove: string) => {
    const result = storageManager.removeFromWatchlist(symbolToRemove);
    
    if (result.success) {
      toast.success(result.message);
      setWatchlist(storageManager.getWatchlist());
    } else {
      toast.error(result.message);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <SiteNav
        actions={
          <Link href="/dashboard">
            <Button className="btn-secondary px-4 py-2 text-sm">Dashboard</Button>
          </Link>
        }
      />

      {/* Main Grid Layout */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-12 gap-6">
          
          {/* Page Header - Full Width */}
          <div className="col-span-12">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-6">
              <div>
                <h1 className="text-3xl font-bold text-text-primary mb-2">Trade Risk Engine</h1>
                <p className="text-text-secondary max-w-2xl">
                  Analyze any proposed crypto trade before execution using live market data, risk intelligence scoring, and pre-trade safety controls.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button onClick={handleNewAnalysis} className="btn-primary px-6 py-2">
                  New Analysis
                </Button>
                <Button onClick={handleViewPreviousReports} className="btn-secondary px-6 py-2">View Previous Reports</Button>
              </div>
            </div>

            {/* Mode toggle */}
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => { setBeginnerMode(false); setShowAdvanced(false); }}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${!beginnerMode ? 'bg-primary text-background border-primary' : 'border-border text-text-secondary hover:text-text-primary'}`}
              >
                Advanced
              </button>
              <button
                onClick={() => setBeginnerMode(true)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${beginnerMode ? 'bg-primary text-background border-primary' : 'border-border text-text-secondary hover:text-text-primary'}`}
              >
                Simple Mode
              </button>
              {beginnerMode && (
                <span className="text-xs text-text-secondary">New to crypto? Start here — just enter a token and amount.</span>
              )}
            </div>
          </div>

          {/* Beginner mode form */}
          {beginnerMode && (
            <div className="col-span-12 lg:col-span-7">
              <Card className="terminal-card">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">Quick Risk Check</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-1">
                    <label htmlFor="beginner-symbol" className="text-sm font-medium text-text-secondary">Step 1 — Which token?</label>
                    <div className="relative" ref={beginnerComboRef}>
                      <input
                        id="beginner-symbol"
                        type="text"
                        autoComplete="off"
                        placeholder="Search BTC, ETH, SOL…"
                        value={beginnerQuery}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase();
                          setBeginnerQuery(val);
                          setBeginnerSymbol(val);
                          setBeginnerDropdownOpen(true);
                        }}
                        onFocus={() => setBeginnerDropdownOpen(true)}
                        className="w-full px-4 py-3 bg-surface border border-border rounded-lg text-text-primary text-lg font-mono focus:outline-none focus:border-primary"
                      />
                      {beginnerDropdownOpen && currencies.length > 0 && (
                        <ul className="absolute z-50 mt-1 w-full max-h-52 overflow-auto rounded-lg border border-border bg-card shadow-lg">
                          {currencies
                            .filter((c) =>
                              beginnerQuery.length === 0 ||
                              c.symbol.toLowerCase().includes(beginnerQuery.toLowerCase()) ||
                              c.name.toLowerCase().includes(beginnerQuery.toLowerCase())
                            )
                            .slice(0, 50)
                            .map((c) => (
                              <li
                                key={c.symbol}
                                onMouseDown={() => {
                                  setBeginnerSymbol(c.symbol);
                                  setBeginnerQuery(c.symbol);
                                  setBeginnerDropdownOpen(false);
                                }}
                                className="flex items-center justify-between px-4 py-2.5 cursor-pointer text-sm hover:bg-surface text-text-primary"
                              >
                                <span className="font-mono font-semibold">{c.symbol}</span>
                                <span className="text-text-secondary truncate ml-3 text-xs">{c.name}</span>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="beginner-amount" className="text-sm font-medium text-text-secondary">Step 2 — How much? (USD)</label>
                    <input
                      id="beginner-amount"
                      type="number"
                      placeholder="e.g. 1000"
                      value={beginnerAmount}
                      onChange={e => setBeginnerAmount(e.target.value)}
                      className="w-full px-4 py-3 bg-surface border border-border rounded-lg text-text-primary text-lg font-mono focus:outline-none focus:border-primary"
                    />
                    <p className="text-xs text-text-secondary">We will check a standard buy for 1 day, balanced profile. Use Advanced mode to customize.</p>
                  </div>
                  <Button
                    onClick={handleBeginnerSubmit}
                    disabled={isLoading}
                    className="w-full btn-primary py-3 text-base"
                  >
                    {isLoading ? 'Analyzing…' : 'Analyze Risk →'}
                  </Button>
                  <button
                    onClick={() => setBeginnerMode(false)}
                    className="w-full text-xs text-text-secondary hover:text-primary underline-offset-2 hover:underline"
                  >
                    Switch to Advanced mode for full controls
                  </button>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Advanced input form */}
          {!beginnerMode && (
          <div className="col-span-12 lg:col-span-7">
            <TradeInputForm onSubmit={handleTradeSubmit} isLoading={isLoading} />
          </div>
          )}

          {/* Live Trade Preview - Right Column */}
          <div className="col-span-12 lg:col-span-5 space-y-6">
            {currentTrade && (
              <Card className="terminal-card">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">Proposed Trade</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-text-secondary">Asset</div>
                      <div className="text-text-primary font-medium">{currentTrade.symbol}</div>
                    </div>
                    <div>
                      <div className="text-text-secondary">Action</div>
                      <div className="text-text-primary font-medium capitalize">{currentTrade.action}</div>
                    </div>
                    <div>
                      <div className="text-text-secondary">Amount</div>
                      <div className="text-text-primary font-medium">${currentTrade.amount.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-text-secondary">Period</div>
                      <div className="text-text-primary font-medium">{currentTrade.holdingPeriod}</div>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-border">
                    <div className="text-text-secondary">Risk Profile</div>
                    <div className="text-text-primary font-medium capitalize">{currentTrade.riskProfile}</div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Live integrations proof */}
          {analysisResult && !isLoading && (
            <div className="col-span-12 grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="terminal-card border-primary/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">API status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      className={
                        analysisResult.apiStatus?.sosoValueConnected
                          ? 'bg-success/15 text-success border border-success/30'
                          : 'bg-danger/15 text-danger border border-danger/30'
                      }
                    >
                      {analysisResult.apiStatus?.sosoValueLabel || 'SoSoValue'}
                    </Badge>
                    <Badge
                      className={
                        analysisResult.apiStatus?.sodexConnected
                          ? 'bg-success/15 text-success border border-success/30'
                          : 'bg-danger/15 text-danger border border-danger/30'
                      }
                    >
                      {analysisResult.apiStatus?.sodexLabel || 'SoDEX'}
                    </Badge>
                  </div>
                  <div className="text-text-secondary">
                    Last updated:{' '}
                    <span className="text-text-primary font-medium">
                      {analysisResult.apiStatus?.lastUpdatedDisplay ||
                        analysisResult.riskAnalysis.dataSourcesReport.lastUpdatedDisplay}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary">
                    {buildDataDisclosure(
                      analysisResult.riskAnalysis.estimatedFactors,
                      analysisResult.riskAnalysis.marketFactors,
                      !!analysisResult.apiStatus?.sodexConnected
                    ).summary}
                  </p>
                </CardContent>
              </Card>

              <Card className="terminal-card lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">Live market snapshot</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <div className="text-text-secondary text-xs uppercase tracking-wide">SoSoValue price</div>
                      <div className="text-text-primary font-mono text-lg">
                        ${Number(analysisResult.riskAnalysis.liveSnapshot.sosoPrice).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                      </div>
                      <div className="text-xs text-text-secondary">
                        24h: {Number(analysisResult.riskAnalysis.liveSnapshot.sosoChange24hPct).toFixed(2)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-text-secondary text-xs uppercase tracking-wide">SoDEX last</div>
                      <div className="text-text-primary font-mono text-lg">
                        {analysisResult.riskAnalysis.liveSnapshot.sodexLast}
                      </div>
                      <div className="text-xs text-text-secondary">{analysisResult.riskAnalysis.liveSnapshot.sodexSymbol}</div>
                    </div>
                    <div>
                      <div className="text-text-secondary text-xs uppercase tracking-wide">Bid / Ask</div>
                      <div className="text-text-primary font-mono">
                        {analysisResult.riskAnalysis.liveSnapshot.sodexBid} / {analysisResult.riskAnalysis.liveSnapshot.sodexAsk}
                      </div>
                      <div className="text-xs text-text-secondary">
                        Spread: {analysisResult.riskAnalysis.liveSnapshot.spreadPercent.toFixed(3)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-text-secondary text-xs uppercase tracking-wide">24h volume (base)</div>
                      <div className="text-text-primary font-mono">{analysisResult.riskAnalysis.liveSnapshot.sodexVolume}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="col-span-1 lg:col-span-3 terminal-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">Data sources used</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-text-secondary">
                  <ul className="list-disc pl-5 space-y-1">
                    {analysisResult.riskAnalysis.dataSourcesReport.lines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                  <div className="grid md:grid-cols-2 gap-4 text-xs font-mono bg-surface/50 p-3 rounded-lg border border-border">
                    <div>
                      <div className="text-text-primary font-sans font-semibold mb-1">SoSoValue endpoints</div>
                      {analysisResult.riskAnalysis.dataSourcesReport.sosoValue.endpoints.map((e) => (
                        <div key={e}>{e}</div>
                      ))}
                    </div>
                    <div>
                      <div className="text-text-primary font-sans font-semibold mb-1">SoDEX endpoints ({analysisResult.riskAnalysis.dataSourcesReport.sodex.network})</div>
                      {analysisResult.riskAnalysis.dataSourcesReport.sodex.endpoints.map((e) => (
                        <div key={e}>{e}</div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Loading State - Full Width */}
          {isLoading && (
            <div className="col-span-12">
              <Card className="terminal-card border-primary/20">
                <CardContent className="py-12">
                  <div
                    className="max-w-sm mx-auto space-y-6"
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                  >
                    <div className="text-center">
                      <div
                        className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-4"
                        aria-hidden="true"
                      ></div>
                      <p className="text-text-primary font-medium">
                        Analysing {currentTrade?.symbol ?? 'trade'}…
                      </p>
                      <p className="text-xs text-text-secondary mt-1">
                        Fetching live market data from SoSoValue and SoDEX
                      </p>
                      {/* Real elapsed time. The previous four-step list advanced on a fixed
                          1.8s timer no matter what the server was doing, so the stage names
                          never meant anything. */}
                      <p className="text-xs text-text-muted mt-1 tabular-nums">
                        {elapsedSeconds}s elapsed
                      </p>
                    </div>

                    {/* Indeterminate, because the progress genuinely is unknown until the
                        response arrives. */}
                    <div
                      className="h-1 w-full bg-surface rounded-full overflow-hidden"
                      aria-hidden="true"
                    >
                      <div className="h-full w-1/3 bg-primary rounded-full animate-pulse"></div>
                    </div>

                    <div className="text-center">
                      <Button
                        variant="secondary"
                        onClick={handleCancelAnalysis}
                        className="text-sm"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Risk Score Card - Left */}
          {analysisResult && !isLoading && (!beginnerMode || showAdvanced) && (
            <div className="col-span-12 lg:col-span-4">
              <RiskScoreCard
                riskScore={analysisResult.riskAnalysis.riskScore}
                decision={analysisResult.riskAnalysis.decision}
                confidence={analysisResult.riskAnalysis.confidence}
                calibration={analysisResult.riskAnalysis.calibration}
                reliability={analysisResult.riskAnalysis.reliability}
              />
            </div>
          )}

          {/* Data coverage disclosure - spans full width directly under the score, because a
              score built partly on neutral placeholders should not read like a confident reading
              of the market. */}
          {analysisResult && !isLoading && !dataDisclosure.complete && (
            <div className="col-span-12">
              <div
                role="note"
                className="p-4 rounded-lg border border-warning/30 bg-warning/5 flex gap-3"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-5 h-5 flex-shrink-0 text-warning mt-0.5"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.166-.168 2.625-1.515 2.625H3.72c-1.347 0-2.188-1.459-1.515-2.625l6.28-10.875zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                    clipRule="evenodd"
                  />
                </svg>
                <div className="text-sm">
                  <p className="font-medium text-text-primary mb-1">
                    Part of this score is estimated, not measured
                  </p>
                  <p className="text-text-secondary">{dataDisclosure.impact}</p>
                  <ul className="mt-2 space-y-1 text-text-secondary">
                    {dataDisclosure.estimated.map((f) => (
                      <li key={f.key}>
                        <span className="text-text-primary font-medium">{f.label}</span> — {f.reason}
                        , shown as a neutral {f.score}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Recommended Action - Right */}
          {analysisResult && !isLoading && (!beginnerMode || showAdvanced) && (
            <div className="col-span-12 lg:col-span-8">
              <Card className="terminal-card">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">Recommended Action</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 bg-surface rounded-lg">
                    <div className="text-sm font-medium text-text-primary mb-2">
                      {analysisResult.riskAnalysis.saferAction}
                    </div>
                    <div className="text-xs text-text-secondary">
                      {analysisResult.riskAnalysis.suggestedPositionSize}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={handleAddToWatchlist} className="btn-secondary text-sm">Add to Watchlist</Button>
                    <Button onClick={handleSaveReport} className="btn-secondary text-sm">Save Report</Button>
                  </div>
                  <p className="text-xs text-text-secondary">
                    Successful analyses are saved to this browser automatically and appear on the{' '}
                    <Link href="/dashboard" className="text-primary underline-offset-2 hover:underline">
                      Dashboard
                    </Link>
                    . Use Save Report to refresh the stored copy of this same run (e.g. after re-reading the page).
                  </p>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={handleDownloadPDF} className="btn-secondary text-sm">Download PDF</Button>
                    <Button onClick={handleCopySummary} className="btn-secondary text-sm">Copy Summary</Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* SoDEX Testnet Execution - Full Width */}
          {analysisResult && !isLoading && !showConfirmation && (!beginnerMode || showAdvanced) && (
            <div className="col-span-12">
              <SoDEXOrderPlacement
                tradeInput={analysisResult.tradeInput}
                riskScore={analysisResult.riskAnalysis.riskScore}
                decision={analysisResult.riskAnalysis.decision}
              />
            </div>
          )}

          {/* Beginner simple result card */}
          {analysisResult && !isLoading && beginnerMode && (
            <div className="col-span-12">
              {(() => {
                const { decision, riskScore, saferAction } = analysisResult.riskAnalysis;
                return (
                  <Card className={`terminal-card ${DECISION_PANEL_CLASS[decision]}`}>
                    <CardContent className="py-8 text-center space-y-4">
                      <div className={`text-5xl font-bold ${DECISION_TEXT_CLASS[decision]}`}>
                        {riskScore}/100
                      </div>
                      <div className={`text-2xl font-semibold ${DECISION_TEXT_CLASS[decision]}`}>
                        {DECISION_HEADLINE[decision]}
                      </div>
                      <p className="text-body max-w-lg mx-auto">{saferAction}</p>
                      <button
                        onClick={() => setShowAdvanced((v) => !v)}
                        className="text-sm text-primary underline-offset-2 hover:underline mt-2"
                      >
                        {showAdvanced ? 'Hide full breakdown ▲' : 'See full breakdown ▼'}
                      </button>
                    </CardContent>
                  </Card>
                );
              })()}
            </div>
          )}

          {/* Risk Breakdown - Full Width */}
          {analysisResult && !isLoading && (!beginnerMode || showAdvanced) && (
            <div className="col-span-12">
              <RiskFactorsList
                reasons={analysisResult.riskAnalysis.reasons}
                marketFactors={analysisResult.riskAnalysis.marketFactors}
                factorWeights={analysisResult.riskAnalysis.factorWeights}
                decision={analysisResult.riskAnalysis.decision}
              />
            </div>
          )}

          {/* Risk Intelligence Explanation - Full Width */}
          {analysisResult && !isLoading && (!beginnerMode || showAdvanced) && (
            <div className="col-span-12">
              <RiskExplanationBox explanation={analysisResult.riskExplanation} riskAnalysis={analysisResult.riskAnalysis} />
            </div>
          )}

          {/* Confirmation Gate - Full Width */}
          {showConfirmation && analysisResult && !isLoading && (
            <div className="col-span-12">
              <ConfirmationGate
                tradeInput={analysisResult.tradeInput}
                riskScore={analysisResult.riskAnalysis.riskScore}
                decision={analysisResult.riskAnalysis.decision}
                onCancel={handleCancelTrade}
                onReduceSize={handleReduceSize}
              />
            </div>
          )}

          {/* Watchlist */}
          {watchlist.length > 0 && (
            <div className="col-span-12 lg:col-span-6">
              <Card className="terminal-card">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">Watchlist</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {watchlist.map((item) => (
                    <div key={item.symbol} className="flex items-center justify-between p-3 bg-surface rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
                          <span className="text-xs font-medium text-primary">{item.symbol}</span>
                        </div>
                        <div>
                          <span className="text-text-primary font-medium">{item.symbol}</span>
                          {item.latestRiskScore && (
                            <div className="text-xs text-text-secondary">Risk: {item.latestRiskScore}/100</div>
                          )}
                        </div>
                      </div>
                      <Button 
                        onClick={() => handleRemoveFromWatchlist(item.symbol)}
                        className="text-xs px-2 py-1 bg-danger/10 text-danger hover:bg-danger/20 border border-danger/30"
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button onClick={handleAddAssetToWatchlist} className="w-full btn-secondary text-sm">Add Asset</Button>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Recent Reports */}
          {recentReports.length > 0 ? (
            <div className="col-span-12">
              <Card className="terminal-card">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg font-semibold">Recent Risk Checks</CardTitle>
                    <span className="text-sm text-text-secondary">
                      {recentReports.length} of {storageManager.getReports().length} reports
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2">Asset</th>
                          <th className="text-left py-2">Action</th>
                          <th className="text-left py-2">Amount</th>
                          <th className="text-left py-2">Risk Score</th>
                          <th className="text-left py-2">Decision</th>
                          <th className="text-left py-2">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentReports.map((row) => (
                          <tr key={row.id} className="border-b border-border">
                            <td className="py-2 font-medium">{row.asset}</td>
                            <td className="py-2 capitalize">{row.action}</td>
                            <td className="py-2">{row.amount}</td>
                            <td className="py-2">{row.riskScore}/100</td>
                            <td className="py-2">
                              <Badge className={`${decisionTint(row.decision)} px-2 py-1 text-xs rounded border`}>
                                {decisionLabel(row.decision)}
                              </Badge>
                            </td>
                            <td className="py-2 text-text-secondary">{row.time}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : storageManager.getReports().length > 0 ? (
            <div className="col-span-12">
              <Card className="terminal-card">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">Recent Risk Checks</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-text-secondary text-center py-4">
                    You have {storageManager.getReports().length} saved reports. 
                    <Button 
                      onClick={refreshRecentReports}
                      className="ml-2 btn-secondary text-sm px-3 py-1"
                    >
                      Refresh
                    </Button>
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : null}

          {/* Methodology Note */}
          <div className="col-span-12">
            <Card className="terminal-card">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Methodology</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-text-secondary">
                  TradeFirewall scores proposed trades using market trend, volatility, sentiment, volume, liquidity, 
                  sector strength, position size, holding period, and user risk profile. The score is designed to help 
                  users understand risk before execution. This analysis is for informational purposes only and is not financial advice.
                </p>
              </CardContent>
            </Card>
          </div>

        </div>
      </main>
    </div>
  );
}