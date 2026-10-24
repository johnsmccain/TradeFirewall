import type { SavedReport } from './storage';

/**
 * A saved report as the dashboard table renders it. This is a presentation shape, not a domain
 * one: `amount` is formatted for display and `time` is pre-localised, so no component has to
 * remember which of those are raw. The mapping lived inline in three places, and the copies had
 * already drifted — one of them threaded a `recommendedAction` column the table never rendered.
 */
export interface TradeCheckRow {
  id: string;
  time: string;
  asset: string;
  action: string;
  amount: string;
  holdingPeriod: string;
  riskScore: number;
  decision: string;
  status: string;
}

export function toTradeCheckRow(report: SavedReport): TradeCheckRow {
  return {
    id: report.id,
    time: new Date(report.createdAt).toLocaleDateString(),
    asset: report.symbol,
    action: report.action,
    amount: `$${report.amount.toLocaleString()}`,
    holdingPeriod: report.holdingPeriod,
    riskScore: report.riskScore,
    decision: report.decision,
    status: report.status || 'completed',
  };
}

/** `limit` caps how many rows reach the table; reports arrive newest-first from storage. */
export function toTradeCheckRows(reports: SavedReport[], limit?: number): TradeCheckRow[] {
  const slice = typeof limit === 'number' ? reports.slice(0, limit) : reports;
  return slice.map(toTradeCheckRow);
}
