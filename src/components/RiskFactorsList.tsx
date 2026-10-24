'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  FACTOR_BAND_BADGE_CLASS,
  FACTOR_BAND_BAR_CLASS,
  FACTOR_BAND_LABEL,
  factorBand,
} from '@/lib/riskBand';

interface RiskFactorsListProps {
  reasons: string[];
  marketFactors: Record<string, number>;
  factorWeights?: Record<string, number>;
  decision?: string;
}

import { FACTOR_LABELS, FACTOR_DESCRIPTIONS } from '@/lib/factorLabels';

export function RiskFactorsList({ reasons, marketFactors, factorWeights, decision }: RiskFactorsListProps) {

  // Top contributors = factors with score >= 60, sorted descending by weighted impact
  const topContributors = Object.entries(marketFactors)
    .filter(([, v]) => v >= 60)
    .map(([k, v]) => ({ key: k, score: v, weight: factorWeights?.[k] ?? 0, impact: v * (factorWeights?.[k] ?? 0) }))
    .sort((a, b) => b.impact - a.impact);

  const isBlocked = decision === 'BLOCK' || decision === 'REDUCE_OR_WAIT';

  return (
    <TooltipProvider>
      <div className="space-y-6">
      {/* Why this trade was blocked / reduced callout */}
      {isBlocked && topContributors.length > 0 && (
        <Card className="terminal-card border-danger/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-danger flex items-center gap-2">
              <span className="text-lg">⛔</span>
              {decision === 'BLOCK' ? 'Why this trade is blocked' : 'Why this trade needs reduction'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-text-secondary">
              These factors are driving the decision, ranked by their weighted impact on the score:
            </p>
            <div className="space-y-2">
              {topContributors.slice(0, 4).map(({ key, score, weight }) => (
                <div key={key} className="flex items-center justify-between p-3 bg-danger/5 border border-danger/20 rounded-lg">
                  <div>
                    <span className="text-sm font-medium text-text-primary">{FACTOR_LABELS[key] ?? key}</span>
                    <p className="text-xs text-text-secondary mt-0.5">{FACTOR_DESCRIPTIONS[key]}</p>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <div className="text-sm font-bold text-danger">{score}/100</div>
                    <div className="text-xs text-text-secondary">{Math.round(weight * 100)}% weight</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key risk reasons */}
      <Card className="terminal-card">
        <CardHeader>
          <CardTitle className="text-card-heading">Key Risk Factors</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {reasons.map((reason, index) => (
              <li key={index} className="flex items-start space-x-3">
                <div className="w-2 h-2 bg-orange-risk rounded-full mt-2 flex-shrink-0"></div>
                <span className="text-body">{reason}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Full factor breakdown with weights and bars */}
      <Card className="terminal-card">
        <CardHeader>
          <CardTitle className="text-card-heading">Risk Factor Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Object.entries(marketFactors)
              .sort((a, b) => {
                const wa = factorWeights?.[a[0]] ?? 0;
                const wb = factorWeights?.[b[0]] ?? 0;
                return wb * b[1] - wa * a[1];
              })
              .map(([factor, value]) => {
                const band = factorBand(value);
                const cls = FACTOR_BAND_BADGE_CLASS[band];
                const label = FACTOR_BAND_LABEL[band];
                const weight = factorWeights?.[factor];
                return (
                  <div key={factor} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="font-medium text-text-primary cursor-help border-b border-dotted border-text-secondary">{FACTOR_LABELS[factor] ?? factor}</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">{FACTOR_DESCRIPTIONS[factor]}</p>
                          </TooltipContent>
                        </Tooltip>
                        {weight !== undefined && (
                          <span className="text-xs text-text-secondary bg-surface px-1.5 py-0.5 rounded">
                            {Math.round(weight * 100)}% weight
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-text-primary font-mono text-xs">{value}/100</span>
                        <Badge className={`${cls} px-2 py-0.5 text-xs rounded`}>{label}</Badge>
                      </div>
                    </div>
                    <div className="w-full bg-surface rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full transition-all duration-500 ${FACTOR_BAND_BAR_CLASS[band]}`}
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>
    </div>
    </TooltipProvider>
  );
}
