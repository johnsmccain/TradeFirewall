'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Decision, RiskAnalysis } from '@/lib/riskEngine';
import {
  RISK_BAND_LABEL,
  RISK_BAND_TEXT_CLASS,
  confidenceColor,
  decisionBadgeClass,
  decisionLabel,
  riskBand,
} from '@/lib/riskBand';

interface RiskScoreCardProps {
  riskScore: number;
  decision: Decision;
  confidence: number;
  calibration?: RiskAnalysis['calibration'];
  reliability?: RiskAnalysis['reliability'];
}

export function RiskScoreCard({ riskScore, decision, confidence, calibration, reliability }: RiskScoreCardProps) {
  const band = riskBand(riskScore);


  return (
    <Card className="terminal-card w-full">
      <CardHeader className="text-center pb-4">
        <CardTitle className="text-card-heading">Risk Assessment</CardTitle>
      </CardHeader>
      <CardContent className="text-center space-y-6">
        <div className="space-y-4">
          <div className={`text-7xl font-bold ${RISK_BAND_TEXT_CLASS[band]}`}>
            {riskScore}
          </div>
          <div className="text-label">Risk Score out of 100</div>
          <div className={`text-lg font-medium ${RISK_BAND_TEXT_CLASS[band]}`}>
            {RISK_BAND_LABEL[band]}
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-label">Decision</div>
          <Badge className={`${decisionBadgeClass(decision)} px-4 py-2 text-sm font-medium rounded-lg border-0`}>
            {decisionLabel(decision)}
          </Badge>
        </div>

        <div className="space-y-3">
          <div className="text-label">Analysis Confidence</div>
          <div className="flex items-center justify-center space-x-3">
            <div className="w-32 bg-surface rounded-full h-2 overflow-hidden">
              <div 
                className={`h-2 rounded-full transition-all duration-500 ${confidenceColor(confidence)}`}
                style={{ width: `${confidence * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium text-text-primary min-w-[3rem]">
              {Math.round(confidence * 100)}%
            </span>
          </div>
          {reliability && (
            <p className="text-xs text-text-secondary max-w-xs mx-auto leading-relaxed">{reliability.note}</p>
          )}
        </div>

        {calibration && (
          <div className="space-y-1.5 pt-2 border-t border-border text-left">
            <div className="text-label text-center">Calibration</div>
            <p className="text-xs text-text-secondary leading-relaxed">
              <span className="text-text-primary font-medium">{calibration.label}</span> band (
              {calibration.scoreRange[0]}-{calibration.scoreRange[1]}): {calibration.typicalCases}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}