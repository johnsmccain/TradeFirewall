'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TradeInput, HoldingPeriod } from '@/lib/riskEngine';
import { storageManager } from '@/lib/storage';
import {
  BUILT_IN_RISK_PROFILES,
  isBuiltInProfile,
  RiskProfileConfig,
  UserCustomRiskProfile,
} from '@/lib/riskProfiles';
import { CustomRiskProfileEditor } from '@/components/CustomRiskProfileEditor';

interface Currency {
  symbol: string;
  name: string;
}

interface TradeInputFormProps {
  onSubmit: (tradeInput: TradeInput) => void;
  isLoading?: boolean;
}

export function TradeInputForm({ onSubmit, isLoading = false }: TradeInputFormProps) {
  const [formData, setFormData] = useState({
    symbol: '',
    action: 'buy' as 'buy' | 'sell',
    amount: '',
    holdingPeriod: '7days' as HoldingPeriod,
    riskProfile: 'balanced' as string,
    notes: '',
  });
  const [customProfiles, setCustomProfiles] = useState<UserCustomRiskProfile[]>([]);
  const [showProfileEditor, setShowProfileEditor] = useState(false);

  // Combobox state
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  // Which option the keyboard is currently on. -1 means the input itself owns focus, which is
  // what makes the combobox follow the "no option selected until you arrow down" convention.
  const [activeIndex, setActiveIndex] = useState(-1);
  // Starts true so the first paint shows the loading placeholder; the fetch below
  // flips it to false when it settles. Initialising here rather than calling
  // setState synchronously in the effect avoids a cascading re-render on mount.
  const [loadingCurrencies, setLoadingCurrencies] = useState(true);
  const comboRef = useRef<HTMLDivElement>(null);

  // Fetch live SoDEX markets once on mount; the picker must reflect the configured network.
  useEffect(() => {
    fetch('/api/sodex/symbols')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.symbols)) {
          setCurrencies(d.symbols.map((item: { symbol: string; market: string }) => ({
            symbol: item.symbol,
            name: item.market,
          })));
        }
      })
      .catch(() => {/* manual entry still works; the analysis endpoint validates the market */})
      .finally(() => setLoadingCurrencies(false));
  }, []);

  // Custom profiles live only in localStorage, so this must run client-side after mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const load = () => {
      setCustomProfiles(storageManager.getCustomRiskProfiles());
    };
    load();
  }, []);

  // If the selected profile is deleted, fall back rather than submitting an unknown name.
  // Derived during render instead of synced in an effect so a delete never triggers a
  // cascading re-render, and the submit payload can never name a profile that is gone.
  const selectedProfileExists =
    isBuiltInProfile(formData.riskProfile) ||
    customProfiles.some((p) => p.name === formData.riskProfile);
  const activeProfileName = selectedProfileExists ? formData.riskProfile : 'balanced';
  const activeCustomProfile = customProfiles.find((p) => p.name === activeProfileName);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = query.length === 0
    ? currencies.slice(0, 50)
    : currencies
        .filter(
          (c) =>
            c.symbol.toLowerCase().includes(query.toLowerCase()) ||
            c.name.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 50);

  const selectSymbol = (symbol: string) => {
    setFormData((f) => ({ ...f, symbol }));
    setQuery(symbol);
    setOpen(false);
    setActiveIndex(-1);
  };

  const closeCombo = () => {
    setOpen(false);
    setActiveIndex(-1);
  };

  // Arrow keys move the active option, Enter commits it, Escape dismisses the list without
  // discarding what is already typed. Without this the symbol list is mouse-only, so the
  // primary flow of the app cannot be completed from the keyboard at all.
  const handleComboKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        closeCombo();
      }
      return;
    }

    if (filtered.length === 0) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((prev) => {
        const next = prev + step;
        // Wrap, so holding the arrow key cycles instead of sticking at either end.
        if (next < 0) return filtered.length - 1;
        if (next >= filtered.length) return 0;
        return next;
      });
      return;
    }

    if (e.key === 'Enter' && open && activeIndex >= 0) {
      // Only swallow Enter when an option is highlighted, so the form still submits normally
      // while the user is typing a free-form ticker.
      e.preventDefault();
      selectSymbol(filtered[activeIndex].symbol);
    }
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setQuery(val);
    setFormData((f) => ({ ...f, symbol: val }));
    setOpen(true);
    // A stale index would point at a different symbol than it did before the edit.
    setActiveIndex(-1);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.symbol || !formData.amount) {
      alert('Please fill in all required fields');
      return;
    }
    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    // The server holds no registry of custom profiles, so their thresholds travel with the
    // request. Built-ins deliberately omit the field so the API cannot apply an override to a
    // profile the user did not actually pick.
    onSubmit({
      symbol: formData.symbol.toUpperCase(),
      action: formData.action,
      amount,
      holdingPeriod: formData.holdingPeriod,
      riskProfile: activeProfileName,
      ...(activeCustomProfile ? { riskProfileConfig: activeCustomProfile.config } : {}),
      notes: formData.notes || undefined,
    });
  };

  return (
    <Card className="terminal-card w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-card-heading">Trade Risk Analysis</CardTitle>
        <p className="text-body">Enter your proposed trade details for a rule-based risk assessment</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Symbol combobox */}
            <div className="space-y-2" ref={comboRef}>
              <label htmlFor="symbol" className="text-label">Asset Symbol *</label>
              <div className="relative">
                <Input
                  id="symbol"
                  name="symbol"
                  role="combobox"
                  aria-expanded={open}
                  aria-controls="symbol-listbox"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    open && activeIndex >= 0 ? `symbol-option-${activeIndex}` : undefined
                  }
                  autoComplete="off"
                  placeholder={loadingCurrencies ? 'Loading symbols…' : 'Search BTC, ETH, SOL…'}
                  value={query}
                  onChange={handleQueryChange}
                  onFocus={() => setOpen(true)}
                  onKeyDown={handleComboKeyDown}
                  className="bg-card border-border text-text-primary placeholder:text-text-muted h-12 rounded-lg"
                />
                {open && filtered.length > 0 && (
                  <ul
                    id="symbol-listbox"
                    role="listbox"
                    aria-label="Supported assets"
                    className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-border bg-card shadow-lg"
                  >
                    {filtered.map((c, i) => (
                      <li
                        key={c.symbol}
                        id={`symbol-option-${i}`}
                        role="option"
                        aria-selected={formData.symbol === c.symbol}
                        // onMouseDown rather than onClick so the blur that closes the list cannot
                        // swallow the selection.
                        onMouseDown={() => selectSymbol(c.symbol)}
                        onMouseEnter={() => setActiveIndex(i)}
                        className={`flex items-center justify-between px-4 py-2.5 cursor-pointer text-sm ${
                          activeIndex === i ? 'bg-surface' : 'hover:bg-surface'
                        } ${
                          formData.symbol === c.symbol ? 'text-primary' : 'text-text-primary'
                        }`}
                      >
                        <span className="font-mono font-semibold">{c.symbol}</span>
                        <span className="text-text-secondary truncate ml-3 text-xs">{c.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {currencies.length > 0 && (
                <p className="text-xs text-text-secondary">{currencies.length} active SoDEX markets on this network</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="action" className="text-label">Trade Action *</label>
              <Select
                value={formData.action}
                onValueChange={(value: 'buy' | 'sell') => setFormData({ ...formData, action: value })}
              >
                <SelectTrigger id="action" className="bg-card border-border text-text-primary h-12 rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="buy" className="text-text-primary hover:bg-surface">Buy</SelectItem>
                  <SelectItem value="sell" className="text-text-primary hover:bg-surface">Sell</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label htmlFor="amount" className="text-label">Amount (USD) *</label>
              <Input
                id="amount"
                name="amount"
                type="number"
                placeholder="1000"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className="bg-card border-border text-text-primary placeholder:text-text-muted h-12 rounded-lg"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="holdingPeriod" className="text-label">Holding Period</label>
              <Select
                value={formData.holdingPeriod}
                onValueChange={(value: HoldingPeriod) => setFormData({ ...formData, holdingPeriod: value })}
              >
                <SelectTrigger id="holdingPeriod" className="bg-card border-border text-text-primary h-12 rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="intraday" className="text-text-primary hover:bg-surface">Intraday</SelectItem>
                  <SelectItem value="1day" className="text-text-primary hover:bg-surface">1 Day</SelectItem>
                  <SelectItem value="7days" className="text-text-primary hover:bg-surface">7 Days</SelectItem>
                  <SelectItem value="30days" className="text-text-primary hover:bg-surface">30 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="riskProfile" className="text-label">Risk Profile</label>
              <button
                type="button"
                onClick={() => setShowProfileEditor((v) => !v)}
                aria-expanded={showProfileEditor}
                className="text-xs text-primary hover:text-primary-hover underline underline-offset-2"
              >
                {showProfileEditor ? 'Hide profile editor' : 'Customize profiles'}
              </button>
            </div>
            <Select
              value={activeProfileName}
              onValueChange={(value: string) => setFormData({ ...formData, riskProfile: value })}
            >
              <SelectTrigger id="riskProfile" className="bg-card border-border text-text-primary h-12 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="conservative" className="text-text-primary hover:bg-surface">
                  Conservative (approve ≤ {BUILT_IN_RISK_PROFILES.conservative.approve})
                </SelectItem>
                <SelectItem value="balanced" className="text-text-primary hover:bg-surface">
                  Balanced (approve ≤ {BUILT_IN_RISK_PROFILES.balanced.approve})
                </SelectItem>
                <SelectItem value="aggressive" className="text-text-primary hover:bg-surface">
                  Aggressive (approve ≤ {BUILT_IN_RISK_PROFILES.aggressive.approve})
                </SelectItem>
                {customProfiles.length > 0 && <SelectSeparator className="bg-border" />}
                {customProfiles.map((profile) => (
                  <SelectItem
                    key={profile.name}
                    value={profile.name}
                    className="text-text-primary hover:bg-surface"
                  >
                    {profile.name} (custom)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-text-muted">
              Thresholds decide when a trade is approved, cautioned, reduced or blocked.
              {activeCustomProfile && (() => {
                const c: RiskProfileConfig = activeCustomProfile.config;
                return ` Grading as "${c.approve} / ${c.caution} / ${c.reduce}" with a $${c.positionToleranceUsd.toLocaleString()} position tolerance.`;
              })()}
            </p>
          </div>

          {showProfileEditor && (
            <CustomRiskProfileEditor profiles={customProfiles} onChange={setCustomProfiles} />
          )}

          <div className="space-y-2">
            <label htmlFor="notes" className="text-label">Notes (Optional)</label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Why do you want to take this trade?"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="bg-card border-border text-text-primary placeholder:text-text-muted rounded-lg resize-none"
            />
          </div>

          <Button
            type="submit"
            className="w-full btn-primary h-12 text-base"
            disabled={isLoading}
          >
            {isLoading ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-background/30 border-t-background rounded-full animate-spin"></div>
                <span>Analyzing Risk...</span>
              </div>
            ) : (
              'Analyze Trade Risk'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
