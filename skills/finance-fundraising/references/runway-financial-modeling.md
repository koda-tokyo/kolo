# Runway & Financial Modeling

## Table of Contents
1. [Runway Calculation](#runway-calculation)
2. [Burn Rate Analysis](#burn-rate-analysis)
3. [Cash-Out Date Projection](#cash-out-date-projection)
4. [Scenario Modeling](#scenario-modeling)
5. [Revenue Forecasting (Pre-Revenue)](#revenue-forecasting-pre-revenue)
6. [Cost Structure Optimization](#cost-structure-optimization)
7. [Japanese Startup Accounting (J-GAAP)](#japanese-startup-accounting-j-gaap)

---

## Runway Calculation

**Core formula:**
```
Runway (months) = Cash Balance / Net Burn Rate
```

**Cash balance** = Cash + cash equivalents (deposits < 3mo maturity). Exclude restricted cash, deposits held as collateral, unvested grant funds.

**Net burn rate** = Total monthly cash outflows - Total monthly cash inflows. For pre-revenue KodaSōken: inflows are primarily grants (NEDO, METI) and occasional consulting fees. Treat grant inflows as lumpy, not recurring — model them as discrete events, not monthly smoothing.

**Gross burn rate** = Total monthly operating expenses (OPEX). Useful for understanding total cost footprint. Banks and Japanese VCs often ask for gross burn, not net.

### KodaSōken-Specific Runway Factors
- **GPU compute burn**: The largest variable cost. Inference vs. training — separate line items. Track per-model GPU hours.
- **Research personnel**: Full-time researchers above market for AI talent. Budget 30% above standard Tokyo tech salaries for senior ML roles.
- **Grant timing**: NEDO disbursements are milestone-based, not monthly. A "6 month runway" on paper can become 2 months if a milestone review is delayed.
- **Clinical validation costs**: KODA KENKŌ pilots with hospitals carry costs (data integration, clinician onboarding) that don't scale linearly.

---

## Burn Rate Analysis

### Gross vs. Net Burn
| Metric | What it tells you | KodaSōken benchmark (pre-Series A) |
|--------|------------------|-------------------------------------|
| Gross burn | Total OPEX footprint | ¥8-15M/month (small team + GPU) |
| Net burn | Cash depletion rate | ¥6-12M/month (with grant offsets) |

### Burn Composition (target allocation)
- **Personnel**: 55-65% (researchers, engineers, clinical liaisons)
- **Infrastructure**: 20-30% (GPU cloud, SaaS tools, office)
- **Business development**: 5-10% (hospital partnerships, conference travel)
- **G&A**: 5-10% (legal, accounting, admin)

Red flag: infrastructure > 35% of burn → over-provisioned compute. Consolidate or move to spot instances before fundraise.

---

## Cash-Out Date Projection

Track weekly, not monthly. At pre-Series A with lumpy grant inflows, monthly granularity masks 2-3 week cash crunches.

**Waterfall model:**
1. Start with current cash balance
2. Subtract fixed commitments (salaries, office lease, SaaS annual contracts)
3. Subtract variable costs (GPU usage est. ±20% band)
4. Add expected inflows with probability weights:
   - Confirmed grant disbursements: 95% weight
   - Pending grant milestone reviews: 50-70% weight
   - Consulting/other revenue: 30-50% weight
5. Identify earliest date when balance < 1 month of burn → **cash-out date**

**Japanese banking note**: Furikomi (bank transfers) take 1-2 business days. Factor this into your cash-out timeline. A grant disbursed on Friday may not clear until Tuesday.

---

## Scenario Modeling

Use three scenarios, not two. "Best / Base / Worst" is standard in Japanese startup decks.

### Base Case
- Current burn rate + 5% monthly growth (headcount additions)
- 2 grant milestones achieved on schedule
- No revenue from KODA KENKŌ (pre-commercial)
- Runway: ~12-15 months from current date

### Best Case
- Burn stays flat (GPU optimization offsets new hires)
- 3+ grant milestones achieved, including one accelerated
- Early design partner payment from a hospital consortium
- Runway: 18-24 months

### Worst Case
- Burn grows 15% due to GPU price spikes + emergency hiring
- 1 grant milestone delayed by 2+ months
- Runway: 6-9 months → triggers Series A preparation immediately

---

## Revenue Forecasting (Pre-Revenue Startups)

KodaSōken is pre-revenue for KODA KENKŌ. Until commercial launch, model:

1. **Grant revenue**: Map each grant to its milestone schedule. Do not forecast grants you haven't applied for yet.
2. **Consulting/PoC revenue**: If hospitals pay for pilot integrations, treat as "other income" not "recurring revenue."
3. **Phantom ARR**: Run parallel revenue projections for investor decks showing what ARR looks like if KODA KENKŌ was live today, based on LOI pipeline × pricing × conservative conversion (10-15%).

### Japanese Healthcare Revenue Cycles
- Hospital procurement cycles: April-September is budget season. Contract signatures peak in March and September.
- NHI (National Health Insurance) reimbursement: If KODA KENKŌ ever becomes reimbursable, payment cycles are 2-3 months post-claim. Factor this into working capital.

---

## Cost Structure Optimization

### Pre-Series A Optimization Levers
1. **GPU costs**: Use reserved instances for baseline, spot for burst. Mix of cloud providers avoids lock-in. Target < 25% of burn.
2. **Research talent**: Consider university joint appointments for senior researchers (Tokyo University, Keio, Kyoto). University pays base salary; KodaSōken tops up. This is common in Japanese AI startups.
3. **Office**: Sublease or co-working (WeWork Marunouchi, etc.). Do not sign a direct lease pre-Series A.
4. **SaaS tools**: Use startup credits aggressively (AWS Activate, Google for Startups, Microsoft for Startups). Typically $25k-$100k in credits available.
5. **Clinical advisors**: Compensate with advisory equity, not cash retainers.

---

## Japanese Startup Accounting (J-GAAP)

### Key Differences from IFRS/US GAAP
- **Revenue recognition**: J-GAAP is more conservative on SaaS. Milestone-based recognition is stricter.
- **R&D expensing**: All R&D can be expensed immediately (no capitalization required). This is advantageous — keeps balance sheet clean.
- **Consumption tax (shōhizei)**: 10%. Startups under ¥10M in taxable sales for the base period are exempt for the first two fiscal years. KodaSōken is likely still in the exemption period but verify with accountant.
- **Fixed asset threshold**: Assets < ¥100,000 can be expensed immediately. ¥100,000-¥200,000: 3-year equal depreciation. > ¥200,000: standard useful life.

### Monthly Close Checklist (pre-Series A)
1. Reconcile all bank accounts and credit cards
2. Classify expenses by department (R&D, G&A, BD)
3. Update grant revenue schedule (milestones achieved, billed, collected)
4. Calculate burn rate and update runway projection
5. Review GPU spending vs. budget
6. File consumption tax return if above threshold

**Accountant**: Must be a zeirishi (税理士) registered in Japan. Not a regular bookkeeper. Investor DD will check this.
