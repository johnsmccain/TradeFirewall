'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TradeInput, Decision } from '@/lib/riskEngine';
import { RISK_BAND_BADGE_CLASS, RISK_BAND_LABEL, riskBand } from '@/lib/riskBand';
import { gateActions } from '@/lib/confirmationGate';

interface ConfirmationGateProps {
  tradeInput: TradeInput;
  riskScore: number;
  decision: Decision;
  onCancel: () => void;
  onReduceSize: () => void;
}

const REDUCE_HINT_ID = 'confirmation-gate-reduce-hint';

/**
 * Safety rule: BLOCK never reaches execution — no override exists, not even behind
 * checkboxes. REDUCE_OR_WAIT can only proceed by actually reducing size and
 * re-running analysis (onReduceSize), never by confirming through on the same
 * oversized trade. Neither path calls an "execute" callback — this component only
 * ever cancels or redirects into a fresh, smaller analysis.
 *
 * This card is deliberately rendered *alongside* the score, the risk factors and the
 * explanation rather than in place of them. It used to be the only thing on screen at
 * scores >= 51, which meant the user was asked to tick "I understand the risk factors
 * identified" with every risk factor unmounted.
 */
export function ConfirmationGate({
  tradeInput,
  riskScore,
  decision,
  onCancel,
  onReduceSize
}: ConfirmationGateProps) {
  const [confirmations, setConfirmations] = useState({
    notAdvice: false,
    understandRisk: false,
    acceptLoss: false,
  });

  // The gate appears mid-page, after the user has already read past the score card.
  // Without this, nothing tells a screen-reader user that the page changed underneath them.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const allConfirmed = Object.values(confirmations).every(Boolean);
  const isBlocked = decision === 'BLOCK';

  const handleCheckboxChange = (key: keyof typeof confirmations) => {
    setConfirmations(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const band = riskBand(riskScore);
  const actions = gateActions(decision, allConfirmed);

  return (
    <Card className="terminal-card w-full max-w-2xl mx-auto border-danger/30">
      <CardHeader className="bg-danger/5">
        <CardTitle className="flex items-center justify-between">
          <span ref={headingRef} tabIndex={-1} className="text-card-heading">
            {isBlocked ? 'Trade Blocked' : 'High-Risk Trade Confirmation'}
          </span>
          <Badge className={RISK_BAND_BADGE_CLASS[band]}>{RISK_BAND_LABEL[band]}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4">
          <h3 className="font-medium text-danger mb-2">{isBlocked ? 'This trade cannot proceed to execution' : 'High Risk Trade Detected'}</h3>
          <p className="text-body">
            Your proposed {tradeInput.action} of ${tradeInput.amount.toLocaleString()} worth of {tradeInput.symbol}{' '}
            has been flagged as high risk (Score: {riskScore}/100).{' '}
            {isBlocked
              ? 'BLOCK decisions have no execution override — reduce the position size significantly or wait for market conditions to change, then re-run analysis.'
              : 'This trade cannot execute at its current size. Reduce the position size and re-run analysis to get a fresh decision — there is no way to execute the current oversized trade directly.'}
          </p>
        </div>

        {/* Points at the evidence the confirmations refer to. */}
        <p className="text-xs text-text-secondary">
          Review the score breakdown and the factors driving this decision before confirming —
          in Simple Mode, expand the full breakdown above.
        </p>

        {actions.requiresConfirmations && (
          <div className="space-y-4">
            <h4 className="text-card-heading">Please confirm you understand, before reducing size:</h4>

            <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg hover:bg-surface transition-colors">
              <input
                type="checkbox"
                checked={confirmations.notAdvice}
                onChange={() => handleCheckboxChange('notAdvice')}
                className="mt-1 accent-primary"
              />
              <span className="text-body">
                I understand this analysis is not financial advice and is for informational purposes only.
              </span>
            </label>

            <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg hover:bg-surface transition-colors">
              <input
                type="checkbox"
                checked={confirmations.understandRisk}
                onChange={() => handleCheckboxChange('understandRisk')}
                className="mt-1 accent-primary"
              />
              <span className="text-body">
                I understand the risk factors identified and their potential impact on my trade.
              </span>
            </label>

            <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg hover:bg-surface transition-colors">
              <input
                type="checkbox"
                checked={confirmations.acceptLoss}
                onChange={() => handleCheckboxChange('acceptLoss')}
                className="mt-1 accent-primary"
              />
              <span className="text-body">
                I understand this trade may result in significant losses and I can afford to lose this amount.
              </span>
            </label>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={onCancel}
            className="flex-1 btn-secondary"
          >
            Cancel Trade
          </Button>

          {/* Offered for BLOCK as well. The BLOCK copy above tells the user to reduce the size
              and re-run, but only "Cancel Trade" was offered — a dead end. Moving to a smaller
              position cannot weaken safety: the engine re-scores it and BLOCK still has no
              execution override. */}
          {actions.canReduce && (
            <Button
              onClick={onReduceSize}
              disabled={!actions.canReduceNow}
              aria-describedby={!actions.canReduceNow ? REDUCE_HINT_ID : undefined}
              className="flex-1 btn-primary"
            >
              Reduce Size &amp; Re-analyze
            </Button>
          )}
        </div>

        {!actions.canReduceNow && (
          <p id={REDUCE_HINT_ID} className="text-xs text-text-secondary">
            Tick all three confirmations above to enable re-analysis at a reduced size.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
