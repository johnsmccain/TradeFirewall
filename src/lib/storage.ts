import type { DataSourcesReport } from '@/lib/riskEngine';
import {
  isBuiltInProfile,
  isValidProfileName,
  sanitizeProfileConfig,
  RiskProfileConfig,
  UserCustomRiskProfile,
} from '@/lib/riskProfiles';

export interface WatchlistItem {
  symbol: string;
  addedAt: number;
  source: 'risk-report' | 'manual';
  latestRiskScore?: number;
  latestDecision?: string;
  alertCondition?: string;
  notes?: string;
}

export interface SavedReport {
  id: string;
  symbol: string;
  action: string;
  amount: number;
  holdingPeriod: string;
  riskProfile: string;
  riskScore: number;
  decision: string;
  riskFactors: Record<string, number>;
  explanation: string;
  recommendedAction: string;
  suggestedPositionSize: string;
  dataSourcesUsed: string[];
  dataSourcesReport?: DataSourcesReport;
  /** Matches API analysis `timestamp` — replacing an existing row with the same id avoids duplicates */
  clientRunId?: number;
  createdAt: number;
  status?: 'completed' | 'cancelled';
}

export interface UserSettings {
  theme: 'light' | 'dark';
  notifications: boolean;
  defaultRiskProfile: string;
  /** User-defined grading profiles. Built-ins are not stored here — see BUILT_IN_RISK_PROFILES. */
  customRiskProfiles: UserCustomRiskProfile[];
}

class StorageManager {
  private readonly REPORTS_KEY = 'tradefirewall_reports';
  private readonly WATCHLIST_KEY = 'tradefirewall_watchlist';
  private readonly SETTINGS_KEY = 'tradefirewall_settings';

  // Watchlist Management
  getWatchlist(): WatchlistItem[] {
    if (typeof window === 'undefined') return [];
    try {
      const data = localStorage.getItem(this.WATCHLIST_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error loading watchlist:', error);
      return [];
    }
  }

  addToWatchlist(item: Omit<WatchlistItem, 'addedAt'>): { success: boolean; message: string } {
    try {
      const watchlist = this.getWatchlist();
      
      // Check for duplicates
      const exists = watchlist.some(w => w.symbol === item.symbol);
      if (exists) {
        return { success: false, message: `${item.symbol} is already in your watchlist.` };
      }

      const newItem: WatchlistItem = {
        ...item,
        addedAt: Date.now()
      };

      watchlist.push(newItem);
      localStorage.setItem(this.WATCHLIST_KEY, JSON.stringify(watchlist));
      
      return { success: true, message: `${item.symbol} added to watchlist.` };
    } catch (error) {
      console.error('Error adding to watchlist:', error);
      return { success: false, message: 'Unable to add to watchlist.' };
    }
  }

  removeFromWatchlist(symbol: string): { success: boolean; message: string } {
    try {
      const watchlist = this.getWatchlist();
      const filtered = watchlist.filter(w => w.symbol !== symbol);
      
      if (filtered.length === watchlist.length) {
        return { success: false, message: `${symbol} not found in watchlist.` };
      }

      localStorage.setItem(this.WATCHLIST_KEY, JSON.stringify(filtered));
      return { success: true, message: `${symbol} removed from watchlist.` };
    } catch (error) {
      console.error('Error removing from watchlist:', error);
      return { success: false, message: 'Unable to remove from watchlist.' };
    }
  }

  updateWatchlistItem(symbol: string, updates: Partial<WatchlistItem>): void {
    try {
      const watchlist = this.getWatchlist();
      const index = watchlist.findIndex(w => w.symbol === symbol);
      
      if (index !== -1) {
        watchlist[index] = { ...watchlist[index], ...updates };
        localStorage.setItem(this.WATCHLIST_KEY, JSON.stringify(watchlist));
      }
    } catch (error) {
      console.error('Error updating watchlist item:', error);
    }
  }

  // Reports Management
  getReports(): SavedReport[] {
    // The dashboard and check-trade pages are prerendered at build time, where there is no
    // localStorage. Touching it here threw a ReferenceError that the catch below swallowed,
    // logging a spurious failure on every build.
    if (typeof window === 'undefined') return [];
    try {
      const data = localStorage.getItem(this.REPORTS_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error loading reports:', error);
      return [];
    }
  }

  saveReport(report: Omit<SavedReport, 'id' | 'createdAt'>): { success: boolean; message: string; reportId?: string } {
    try {
      let reports = this.getReports();
      const reportId = `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      if (report.clientRunId !== undefined && report.clientRunId !== null) {
        reports = reports.filter((r) => r.clientRunId !== report.clientRunId);
      }

      const newReport: SavedReport = {
        ...report,
        id: reportId,
        createdAt: Date.now(),
        status: 'completed'
      };

      reports.unshift(newReport); // Add to beginning
      localStorage.setItem(this.REPORTS_KEY, JSON.stringify(reports));

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('tradefirewall-reports-changed'));
      }

      return { success: true, message: 'Risk report saved.', reportId };
    } catch (error) {
      console.error('Error saving report:', error);
      return { success: false, message: 'Unable to save report.' };
    }
  }

  getReport(id: string): SavedReport | null {
    try {
      const reports = this.getReports();
      return reports.find(r => r.id === id) || null;
    } catch (error) {
      console.error('Error getting report:', error);
      return null;
    }
  }

  updateReportStatus(id: string, status: 'completed' | 'cancelled'): void {
    try {
      const reports = this.getReports();
      const index = reports.findIndex(r => r.id === id);
      
      if (index !== -1) {
        reports[index].status = status;
        localStorage.setItem(this.REPORTS_KEY, JSON.stringify(reports));
      }
    } catch (error) {
      console.error('Error updating report status:', error);
    }
  }

  // Settings Management
  private static readonly DEFAULT_SETTINGS: UserSettings = {
    theme: 'light',
    notifications: true,
    defaultRiskProfile: 'balanced',
    customRiskProfiles: [],
  };

  getSettings(): UserSettings {
    if (typeof window === 'undefined') return { ...StorageManager.DEFAULT_SETTINGS };
    try {
      const data = localStorage.getItem(this.SETTINGS_KEY);
      if (!data) return { ...StorageManager.DEFAULT_SETTINGS };
      const parsed = JSON.parse(data) as Partial<UserSettings>;
      return {
        ...StorageManager.DEFAULT_SETTINGS,
        ...parsed,
        // Older saved settings predate custom profiles; normalize rather than trust the shape.
        customRiskProfiles: this.sanitizeStoredProfiles(parsed.customRiskProfiles),
      };
    } catch (error) {
      console.error('Error loading settings:', error);
      return { ...StorageManager.DEFAULT_SETTINGS };
    }
  }

  private sanitizeStoredProfiles(raw: unknown): UserCustomRiskProfile[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: UserCustomRiskProfile[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const { name, config, createdAt } = entry as { name?: unknown; config?: unknown; createdAt?: unknown };
      if (!isValidProfileName(name) || isBuiltInProfile(name)) continue;
      if (seen.has(name.toLowerCase())) continue;
      const sanitized = sanitizeProfileConfig(config);
      if (!sanitized) continue;
      seen.add(name.toLowerCase());
      out.push({
        name,
        config: sanitized,
        createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : Date.now(),
      });
    }
    return out;
  }

  updateSettings(updates: Partial<UserSettings>): void {
    try {
      const settings = this.getSettings();
      const newSettings = { ...settings, ...updates };
      if (updates.customRiskProfiles) {
        newSettings.customRiskProfiles = this.sanitizeStoredProfiles(updates.customRiskProfiles);
      }
      localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(newSettings));
    } catch (error) {
      console.error('Error updating settings:', error);
    }
  }

  // Custom risk profiles
  getCustomRiskProfiles(): UserCustomRiskProfile[] {
    return this.getSettings().customRiskProfiles;
  }

  /** Returns an error message on failure, or null on success — matches the addToWatchlist shape. */
  saveCustomRiskProfile(name: string, config: RiskProfileConfig): { success: boolean; message: string } {
    const trimmed = name.trim();
    if (!isValidProfileName(trimmed)) {
      return {
        success: false,
        message: 'Profile names must start with a letter and use only letters, digits, spaces, hyphens or underscores.',
      };
    }
    if (isBuiltInProfile(trimmed.toLowerCase())) {
      return { success: false, message: `"${trimmed}" is a built-in profile and cannot be overwritten.` };
    }
    const sanitized = sanitizeProfileConfig(config);
    if (!sanitized) {
      return { success: false, message: 'Enter valid thresholds (0-100) and a position tolerance above $100.' };
    }
    try {
      const existing = this.getCustomRiskProfiles();
      const idx = existing.findIndex((p) => p.name.toLowerCase() === trimmed.toLowerCase());
      if (idx >= 0) {
        existing[idx] = { ...existing[idx], config: sanitized };
      } else {
        existing.push({ name: trimmed, config: sanitized, createdAt: Date.now() });
      }
      this.updateSettings({ customRiskProfiles: existing });
      return { success: true, message: `Profile "${trimmed}" saved.` };
    } catch (error) {
      console.error('Error saving custom risk profile:', error);
      return { success: false, message: 'Unable to save profile.' };
    }
  }

  deleteCustomRiskProfile(name: string): { success: boolean; message: string } {
    try {
      const existing = this.getCustomRiskProfiles();
      const filtered = existing.filter((p) => p.name.toLowerCase() !== name.toLowerCase());
      if (filtered.length === existing.length) {
        return { success: false, message: `Profile "${name}" not found.` };
      }
      this.updateSettings({ customRiskProfiles: filtered });
      return { success: true, message: `Profile "${name}" deleted.` };
    } catch (error) {
      console.error('Error deleting custom risk profile:', error);
      return { success: false, message: 'Unable to delete profile.' };
    }
  }

  // Utility Methods
  clearAllData(): void {
    try {
      localStorage.removeItem(this.REPORTS_KEY);
      localStorage.removeItem(this.WATCHLIST_KEY);
      localStorage.removeItem(this.SETTINGS_KEY);
    } catch (error) {
      console.error('Error clearing data:', error);
    }
  }

  exportData(): string {
    try {
      const data = {
        reports: this.getReports(),
        watchlist: this.getWatchlist(),
        settings: this.getSettings(),
        exportedAt: Date.now()
      };
      return JSON.stringify(data, null, 2);
    } catch (error) {
      console.error('Error exporting data:', error);
      return '';
    }
  }

  exportReportsToCSV(): string {
    try {
      const reports = this.getReports();
      if (reports.length === 0) return '';

      const headers = [
        'Date',
        'Symbol',
        'Action',
        'Amount (USD)',
        'Holding Period',
        'Risk Profile',
        'Risk Score',
        'Decision',
        'Recommended Action',
        'Position Size Suggestion',
        'Status'
      ];

      const rows = reports.map(report => [
        new Date(report.createdAt).toLocaleDateString(),
        report.symbol,
        report.action,
        report.amount.toLocaleString(),
        report.holdingPeriod,
        report.riskProfile,
        report.riskScore,
        report.decision,
        report.recommendedAction,
        report.suggestedPositionSize,
        report.status || 'completed'
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');

      return csvContent;
    } catch (error) {
      console.error('Error exporting reports to CSV:', error);
      return '';
    }
  }

  importData(jsonData: string): { success: boolean; message: string } {
    try {
      const data = JSON.parse(jsonData);
      
      if (data.reports) {
        localStorage.setItem(this.REPORTS_KEY, JSON.stringify(data.reports));
      }
      if (data.watchlist) {
        localStorage.setItem(this.WATCHLIST_KEY, JSON.stringify(data.watchlist));
      }
      if (data.settings) {
        localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(data.settings));
      }
      
      return { success: true, message: 'Data imported successfully.' };
    } catch (error) {
      console.error('Error importing data:', error);
      return { success: false, message: 'Invalid data format.' };
    }
  }
}

export const storageManager = new StorageManager();