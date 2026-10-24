# Demo Cheatsheet - Quick Reference

## 🎯 Demo Script (2-3 minutes)

### Setup (Do Before Demo)
1. Clear browser localStorage
2. Open /check-trade in fullscreen
3. Have /validate open in background tab
4. Test all 3 scenarios beforehand

---

### Scenario 1: BLOCK (High Risk) - 45 seconds
**Input:**
- Symbol: BTC
- Action: BUY
- Amount: 25000
- Holding Period: Intraday
- Risk Profile: Conservative

**What to Say:**
- "I'm entering a large BTC buy—$25,000, intraday, conservative profile"
- "Watch: we're fetching live data from SoSoValue and SoDEX right now"
- "Score: 91/100. Decision: BLOCK."
- "Why? Volatility is extreme (90/100), position size is way over conservative tolerance (~$1k), trend is bearish."
- **Key Point:** "Without TradeFirewall, this $25,000 trade executes. With us, it's blocked."

---

### Scenario 2: CAUTION (Moderate Risk) - 45 seconds
**Input:**
- Symbol: SOL
- Action: BUY
- Amount: 5000
- Holding Period: 1 Day
- Risk Profile: Balanced

**What to Say:**
- "Now a more realistic trade: SOL, $5,000, 1-day hold, balanced profile"
- "Score: 44/100. Decision: CAUTION."
- "Why? Volatility elevated from recent 30% run-up (75/100), liquidity thin on ask side (62/100)."
- "Engine recommends: reduce size by 25-50%."
- **Action:** Click "Reduce Size" button
- "Watch: re-analyzing with reduced amount..."
- "New score: 32/100. Decision: APPROVE."
- **Key Point:** "We're not blocking everything—we guide to safer trades."

---

### Scenario 3: APPROVE (Low Risk) - 30 seconds
**Input:**
- Symbol: ETH
- Action: BUY
- Amount: 3000
- Holding Period: 7 Days
- Risk Profile: Balanced

**What to Say:**
- "Now a safe trade: ETH, $3,000, 7-day hold, balanced profile"
- "Score: 28/100. Decision: APPROVE."
- "Why? Low volatility (30/100), bullish trend (25/100), deep liquidity (15/100)."
- **Key Point:** "TradeFirewall approves when conditions genuinely align—we're not a block-all tool."

---

### Scenario 4: Validation (Quick) - 30 seconds
**Action:** Navigate to /validate

**What to Say:**
- "You don't have to trust my claims—here's our validation page."
- "This replays real SoDEX mainnet daily candles through the same scoring pipeline."
- "Real statistics: false positive rate, confusion matrix, real examples."
- "No demo data, no fabricated scenarios—honest validation."
- **Key Point:** "Transparency is our core value."

---

## 💬 Common Questions & Quick Answers

### "How is this different from signal bots?"
**A:** "They're offensive (find trades). We're defensive (avoid bad trades). We're complementary, not competitive."

### "How do you make money?"
**A:** "Free tier for adoption. Paid tiers with auth/billing coming next. Pricing page shows roadmap."

### "What if your score is wrong?"
**A:** "We publish our accuracy: backtest page shows real false positive/negative rates. No model is perfect, but ours is honest."

### "Data sources?"
**A:** "SoSoValue (market intelligence) + SoDEX (orderbook). Both live per request. Graceful degradation if down."

### "Privacy?"
**A:** "Browser-local storage by default. No account required. Nothing uploaded unless you opt in."

### "Can this be integrated?"
**A:** "Yes—REST API documented at /api. Planning white-label for exchanges/wallets."

---

## 🚨 Backup Plans

### If API is slow:
**Say:** "Notice the loading? That's live data fetching—real-time accuracy requires real-time data. Production would add caching."

### If API is down:
**Say:** "This shows our graceful degradation—we fall back to neutral factors and flag the issue. In production, we'd have cached data."

### If score seems off:
**Say:** "Risk is probabilistic, not deterministic. That's why we backtest—we show accuracy over many trades, not just one."

### If browser crashes:
**Have ready:** Screenshots or 30-second video recording of successful demo

---

## 🎯 Key Phrases to Use

- "Live data from SoSoValue and SoDEX"
- "Real-time, not cached"
- "Explainable scoring—all factors visible"
- "No dummy data, no fabricated scenarios"
- "Pre-trade, not post-trade"
- "Defensive layer, not offensive"
- "We don't block everything—we guide to safer trades"
- "Transparency is our core value"

---

## 📊 Numbers to Reference

- **Risk score range:** 0-100
- **Decision thresholds:** APPROVE (0-35), CAUTION (36-50), REDUCE (51-70), BLOCK (71-100) for balanced profile
- **Factors:** 10 total (volatility, sentiment, volume, trend, liquidity, execution, sector, macro, position size, holding period)
- **Data sources:** 2 (SoSoValue, SoDEX)
- **Backtest data:** SoDEX mainnet daily candles

---

## ⚡ Technical Details (If Asked)

- **Stack:** Next.js, TypeScript, React
- **Storage:** Browser localStorage (privacy-first)
- **APIs:** SoSoValue OpenAPI, SoDEX public REST
- **Deployment:** Vercel (or your platform)
- **Auth:** Not built yet (next milestone)
- **Billing:** Not built yet (next milestone)

---

## 🎪 Demo Flow Summary

1. **BLOCK** (45s) - Show problem, show solution
2. **CAUTION → APPROVE** (45s) - Show guidance, show reduction
3. **APPROVE** (30s) - Show balance, not block-all
4. **VALIDATION** (30s) - Show credibility, show honesty

**Total: ~2.5 minutes**

---

## 🏆 Winning Moment

**After the APPROVE scenario, say:**
"In 2 minutes, I showed you: a dangerous trade blocked, a risky trade corrected, and a safe trade approved. TradeFirewall catches mistakes before money is lost. That's the value proposition."

**Then show validation page:**
"And you don't have to trust me—here's our backtest with real statistics. We prove it works."

---

**Good luck. You've got this.** 🚀
