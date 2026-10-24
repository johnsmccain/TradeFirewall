import { NextRequest, NextResponse } from 'next/server';
import { riskEngine, TradeInput } from '@/lib/riskEngine';
import { riskExplanationGenerator } from '@/lib/riskExplanation';
import { APIConnectionError, SoSoValueHttpError, SoSoValueTimeoutError } from '@/lib/sosovalue';
import {
  isBuiltInProfile,
  isValidProfileName,
  sanitizeProfileConfig,
  PROFILE_LIMITS,
} from '@/lib/riskProfiles';

const VALID_ACTIONS = new Set(['buy', 'sell']);
const VALID_HOLDING_PERIODS = new Set(['intraday', '1day', '7days', '30days']);

export async function POST(request: NextRequest) {
  try {
    const tradeInput: TradeInput = await request.json();

    // Validate input
    if (!tradeInput.symbol || !tradeInput.amount || tradeInput.amount <= 0) {
      return NextResponse.json(
        { error: 'Invalid trade input' },
        { status: 400 }
      );
    }

    // Validate symbol format
    if (!/^[A-Z]{2,10}$/.test(tradeInput.symbol.toUpperCase())) {
      return NextResponse.json(
        { error: 'Invalid symbol format. Use uppercase letters only (e.g., BTC, ETH, SOL)' },
        { status: 400 }
      );
    }

    if (!VALID_ACTIONS.has(tradeInput.action)) {
      return NextResponse.json(
        { error: "Invalid action. Use 'buy' or 'sell'." },
        { status: 400 }
      );
    }

    if (!VALID_HOLDING_PERIODS.has(tradeInput.holdingPeriod)) {
      return NextResponse.json(
        { error: `Invalid holding period. Use one of: ${[...VALID_HOLDING_PERIODS].join(', ')}.` },
        { status: 400 }
      );
    }

    // Risk profile: a built-in name needs no config; anything else must be a well-formed
    // custom profile name accompanied by thresholds. The thresholds themselves are clamped
    // (not trusted) by sanitizeProfileConfig, so a tampered client cannot post
    // `approve: 9999` and drive the execution gate off a fabricated APPROVE.
    const isCustomProfile = !isBuiltInProfile(tradeInput.riskProfile);
    if (isCustomProfile) {
      if (!isValidProfileName(tradeInput.riskProfile)) {
        return NextResponse.json(
          { error: `Invalid risk profile name. Use 1-${PROFILE_LIMITS.nameMaxLength} letters, digits, spaces, hyphens or underscores, starting with a letter.` },
          { status: 400 }
        );
      }
      const sanitized = sanitizeProfileConfig(tradeInput.riskProfileConfig);
      if (!sanitized) {
        return NextResponse.json(
          { error: 'Custom risk profiles must supply approve, caution, reduce (0-100) and positionToleranceUsd.' },
          { status: 400 }
        );
      }
      tradeInput.riskProfileConfig = sanitized;
    } else {
      // A built-in name must not carry an override, or the reported thresholds would
      // disagree with the profile the user actually selected.
      delete tradeInput.riskProfileConfig;
    }

    // Normalize symbol to uppercase
    tradeInput.symbol = tradeInput.symbol.toUpperCase();

    // Analyze trade risk using real API data
    const riskAnalysis = await riskEngine.analyzeTradeRisk(tradeInput);
    
    // Generate risk intelligence explanation based on real risk analysis
    const riskExplanation = riskExplanationGenerator.generateExplanation(riskAnalysis, tradeInput);

    const { dataSourcesReport } = riskAnalysis;

    return NextResponse.json({
      tradeInput,
      riskAnalysis,
      riskExplanation,
      timestamp: Date.now(),
      dataSourcesReport,
      apiStatus: {
        sosoValueConnected: dataSourcesReport.sosoValue.live,
        sodexConnected: dataSourcesReport.sodex.live,
        sosoValueLabel: dataSourcesReport.sosoValue.live
          ? 'SoSoValue: Connected'
          : 'SoSoValue: Unavailable',
        sodexLabel: dataSourcesReport.sodex.live ? 'SoDEX: Connected' : 'SoDEX: Unavailable',
        lastUpdatedIso: dataSourcesReport.lastUpdatedIso,
        lastUpdatedDisplay: dataSourcesReport.lastUpdatedDisplay,
        dataSourcesUsed: riskAnalysis.dataSourcesUsed,
      },
    });

  } catch (error) {
    console.error('Trade analysis error:', error);
    
    // Handle specific API connection errors
    if (error instanceof APIConnectionError) {
      return NextResponse.json(
        { 
          error: error.message,
          errorType: 'API_CONNECTION_ERROR',
          suggestion: 'Set SOSOVALUE_API_KEY in .env.local (server-side; never commit the real key).'
        },
        { status: 503 }
      );
    }
    
    // Handle SoDEX market data errors
    if (error instanceof Error) {
      const msg = error.message;

      // A provider that never answered. Reported ahead of the generic HTTP branch below so the
      // client can say "try again" instead of implying the deployment is misconfigured.
      if (error instanceof SoSoValueTimeoutError) {
        return NextResponse.json(
          {
            error: 'A market data provider did not respond in time.',
            errorType: 'UPSTREAM_TIMEOUT',
            suggestion: 'Upstream was slow or unreachable. Re-running usually succeeds.',
          },
          { status: 504 }
        );
      }

      // A 429 must not be reported as a generic HTTP failure: the client shows a distinct
      // "wait a minute" message for it, where a generic one reads as an outage.
      if (error instanceof SoSoValueHttpError && error.status === 429) {
        return NextResponse.json(
          {
            error: 'SoSoValue rate limit reached.',
            errorType: 'RATE_LIMITED',
            suggestion: 'Wait before re-running; every analysis spends this deployment\'s quota.',
          },
          { status: 429 }
        );
      }

      if (msg.includes('SoSoValue API error')) {
        return NextResponse.json(
          {
            error: msg,
            errorType: 'SOSOVALUE_API_ERROR',
            suggestion: 'Check API key tier, rate limits, and SoSoValue status.',
          },
          { status: 502 }
        );
      }

      if (msg.includes('SoSoValue HTTP')) {
        return NextResponse.json(
          {
            error: msg,
            errorType: 'SOSOVALUE_HTTP_ERROR',
            suggestion: 'Verify SOSOVALUE_API_KEY and network access to openapi.sosovalue.com.',
          },
          { status: 502 }
        );
      }

      if (msg.includes('not found in SoSoValue') || msg.includes('Currency ') && msg.includes('not found')) {
        return NextResponse.json(
          {
            error: msg,
            errorType: 'SYMBOL_NOT_FOUND_SOSOVALUE',
            suggestion: 'Pick a symbol that appears in SoSoValue GET /currencies (often majors like BTC, ETH).',
          },
          { status: 404 }
        );
      }

      if (msg.includes('Unable to fetch SoDEX') || msg.includes('SoDEX HTTP') || msg.includes('SoDEX error')) {
        return NextResponse.json(
          {
            error: msg,
            errorType: 'SODEX_ERROR',
            suggestion: 'Check SODEX_USE_TESTNET and spot URL in .env.local',
          },
          { status: 503 }
        );
      }

      if (msg.includes('SoDEX') || msg.includes('orderbook') || msg.includes('slippage') || msg.includes('liquidity')) {
        return NextResponse.json(
          {
            error: msg,
            errorType: 'SODEX_MARKET_ERROR',
            suggestion: 'Try a smaller amount, another symbol, or confirm testnet order book has bid/ask.',
          },
          { status: 503 }
        );
      }

      if (msg.includes('Symbol') && msg.includes('not found')) {
        return NextResponse.json(
          {
            error: msg,
            errorType: 'SYMBOL_NOT_FOUND',
            suggestion: 'Verify the symbol exists on SoDEX exchange',
          },
          { status: 404 }
        );
      }

      if (msg.includes('Cannot calculate risk score')) {
        return NextResponse.json(
          {
            error: msg,
            errorType: 'INSUFFICIENT_DATA',
            suggestion: 'Both SoSoValue and SoDEX APIs are unavailable',
          },
          { status: 503 }
        );
      }

      return NextResponse.json(
        {
          error: msg,
          errorType: 'ANALYSIS_ERROR',
          suggestion: 'See server terminal for full stack trace.',
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        error: 'Risk analysis failed',
        errorType: 'ANALYSIS_ERROR',
        suggestion: 'Please try again or contact support',
      },
      { status: 500 }
    );
  }
}