# Budgeting & Financial Operations

## Table of Contents
1. [Annual Budgeting Process](#annual-budgeting-process)
2. [Department-Level P&L](#department-level-pl)
3. [Expense Approval Workflows](#expense-approval-workflows)
4. [Financial Controls for Startups](#financial-controls-for-startups)
5. [Tax Compliance](#tax-compliance)
6. [Japanese Startup Tax Incentives](#japanese-startup-tax-incentives)

---

## Annual Budgeting Process

### Timeline (Pre-Series A Startup)
```
Month 1: Department heads submit budget requests
Month 2: CEO/CFO consolidate, scenario model, identify gaps
Month 3: Board/advisors review (if applicable)
Month 4: Budget approved, loaded into accounting system
Monthly: Budget vs. actuals review, reforecast if burn deviates >10%
```

For KodaSōken's size, skip the formal department-head process. CEO + lead researcher build the budget together in 2-3 working sessions.

### Zero-Based Budgeting (Recommended Pre-Series A)
Don't use last year's numbers + 10%. Justify every line item from scratch each year. This is especially important for:
- **GPU costs**: Past usage may not predict future. Model refresh cycles and dev vs. production split.
- **Research headcount**: Only budget for roles with signed offer letters or active recruiting.
- **Grant-funded projects**: Budget grant-specific costs separately with clear grant attribution.

### Budget Template Sections
1. **Revenue** (grants, consulting, other income) — by grant/project, by expected quarter
2. **Personnel** — by person (name, role, salary, benefits, start date). No "TBD" headcount budget.
3. **Infrastructure** — GPU cloud, SaaS tools, office, IT equipment
4. **R&D** — clinical validation, data acquisition, model training runs
5. **Business Development** — travel, conferences, partnership development
6. **G&A** — legal, accounting (zeirishi), insurance, misc.

---

## Department-Level P&L

At KodaSōken's current size, departments are:

```
1. R&D (KODA KENKŌ Core) — Researchers, ML engineers, GPU costs, data costs
2. Clinical Operations — Clinician liaisons, hospital onboarding, validation studies
3. Business Development — Partnerships, grant writing, investor relations
4. G&A — CEO, legal, accounting, office
```

### Monthly P&L Template
| Line Item | R&D | Clinical | BD | G&A | Total |
|----------|-----|----------|-----|-----|-------|
| Personnel | | | | | |
| GPU/Infrastructure | | | | | |
| SaaS & Tools | | | | | |
| Travel & Events | | | | | |
| Professional Services | | | | | |
| Office & Facilities | | | | | |
| Other | | | | | |
| **Total OPEX** | | | | | |
| **Grant Revenue** | | | | | |

### Allocating Shared Costs
- **GPU costs**: Allocate by project, not by department. Tag cloud resources with project labels.
- **CEO salary**: 50% BD, 50% G&A (time-based allocation, document your methodology).
- **Office**: Allocate by headcount per department.

---

## Expense Approval Workflows

### Pre-Series A Controls (Lightweight)
| Expense Amount | Approval Required | Documentation |
|---------------|-------------------|---------------|
| < ¥50,000 | Self-approve | Receipt, brief description |
| ¥50,000 - ¥300,000 | CEO approval | Receipt, business justification |
| > ¥300,000 | CEO approval + documented in board minutes | Quote comparison, contract review |
| Recurring (any amount) | CEO approval at setup | Annual contract, auto-approved monthly |

### Expense Policy for KodaSōken
- **Travel**: Economy class domestic, premium economy international. Meals: ¥5,000/day cap.
- **Equipment**: Laptops < ¥300,000, monitors < ¥100,000. Above threshold → CEO approval.
- **Software**: Use free/startup tiers where available. Paid tools need CEO sign-off.
- **GPU usage**: All researchers must tag experiments. No untagged GPU instance running > 24 hours.

### Reimbursement Process
1. Employee submits expense via [tool/email/spreadsheet] with receipt attached
2. CEO reviews and approves within 3 business days
3. Reimbursed via furikomi on next payroll run (bi-weekly)
4. Receipts stored digitally (scan/photo), originals kept for 7 years (Japanese tax requirement)

---

## Financial Controls for Startups

### Minimum Controls (Even at 5 People)
1. **Dual bank authorization**: Two signatures required for transfers > ¥500,000. This is standard in Japanese corporate banking.
2. **Separate accounts**: Operating account, grant-specific account (if grant requires), savings account for excess cash.
3. **Monthly bank reconciliation**: CEO or zeirishi reconciles all accounts within 7 days of month-end.
4. **No corporate credit card debt**: Pay in full monthly. Interest rates on Japanese corporate cards are high (12-15%).
5. **Payroll**: Use a payroll service (freee, MoneyForward, SmartHR). Do not process payroll manually.

### Fraud Prevention for Small Teams
- CEO never approves own expenses without a second person (spouse, co-founder, external accountant)
- All contracts > ¥1M reviewed by lawyer
- Grant funds tracked separately; do not commingle with operating funds without clear accounting
- Quarterly review of all recurring charges — cancel unused SaaS subscriptions

### Cash Management
- **Operating cash**: 2-3 months of burn in main account
- **Reserve cash**: Remaining cash in separate savings account (better interest, less accessible = less temptation)
- **Grant cash**: Separate tracking per grant, even if in same bank account
- **FX**: If holding USD/EUR (e.g., from international grants or investors), monitor FX risk. The yen has been volatile. Consider forward contracts if holding > $100k equivalent.

---

## Tax Compliance

### Key Japanese Corporate Taxes

#### Corporate Tax (Hōjinzei / 法人税)
- **Effective rate**: ~25-35% combined (national + local), but startups with losses pay minimum tax only.
- **Minimum tax (kin'itsu hōjinzei)**: ¥70,000/year for KK regardless of profit/loss. This is the "you exist" tax.
- **Filing deadline**: 2 months after fiscal year end (can extend by 1 month with application).
- **Loss carryforward**: NOLs (Net Operating Losses) can be carried forward 10 years (for SMEs). This is valuable — document losses properly.

#### Consumption Tax (Shōhizei / 消費税)
- **Rate**: 10% (8% for some food items, not relevant for KodaSōken)
- **Exemption**: Taxable sales < ¥10M in the base period (2 years prior) → exempt from collecting and remitting consumption tax.
- **Election to become taxable**: Startups may voluntarily elect to become a consumption tax taxpayer to receive input tax credits (refund on consumption tax paid on expenses). If you spend heavily on taxable inputs (GPU cloud from AWS Japan, SaaS tools), this can generate refunds.
- **Qualified Invoice System (invoice system / インボイス制度)**: As of October 2023, you need a registration number to issue qualified invoices. Register even if exempt — hospitals will require it for their own tax compliance.

#### Withholding Tax (Gensen Chōshū / 源泉徴収)
- **Employees**: Withhold income tax from salaries monthly, remit to tax office. Annual year-end adjustment (nenmatsu chōsei) for employees.
- **Directors (yakuin)**: Different withholding tables than employees. Directors' bonus payments have special withholding treatment.
- **Contractors**: 10.21% withholding on payments to individual contractors (lawyers, zeirishi, designers, freelancers) over ¥50,000 per payment.
- **Foreign contractors**: May be exempt under tax treaties. Japan has treaties with US, UK, most EU countries, Singapore, etc.

---

## Japanese Startup Tax Incentives

### Angel Tax System (Enzeru Zeisei / エンゼル税制)
- **Tax incentive for individual angel investors** in unlisted startups.
- Investors can deduct investment amount from taxable income (up to ¥8M) OR carry forward losses on the investment.
- **Eligibility requirements** for the startup:
  - KK, less than 10 years old
  - Not a subsidiary of a large company
  - Not listed
  - Must file an application with the tax office
- **For KodaSōken**: Register for this. It makes angel investments more attractive. Angels will ask about it.

### R&D Tax Credit (Kenkyū Kaihatsu Zeisei / 研究開発税制)
- **Credit**: A percentage of R&D expenditure can be credited against corporate tax.
- **Rate**: 2-14% of qualifying R&D expenses, varying by company size and R&D intensity.
- **Qualifying R&D**: AI model development, clinical validation studies, and novel software engineering clearly qualify. Document research activities thoroughly.
- **SME bonus**: Small companies (capital < ¥100M, not a large company subsidiary) get higher credit rates (up to 12% + 10% special for increased R&D spend).
- **Carryforward**: Unused credits can be carried forward up to 3 years.
- **Cash-out option**: SMEs can receive a cash refund for unused R&D credits (up to a cap). This is extremely valuable for pre-revenue startups.

### Other Incentives
- **Open Innovation Tax Incentive**: Additional deduction for investments in startups by large corporations. Make KodaSōken visible to corporate VC arms — this makes the investment cheaper for them.
- **Regional startup incentives**: If KodaSōken establishes a presence outside Tokyo (e.g., Kansai, Fukuoka, Hokkaido), additional local subsidies and tax breaks may apply.

### Action Items for KodaSōken
1. Confirm R&D tax credit eligibility with zeirishi — this is likely the single largest tax benefit.
2. Register for Angel Tax System (enhances angel fundraising).
3. Document all R&D activities with time tracking and project attribution.
4. Evaluate consumption tax election (taxable or exempt) — run the numbers.
5. If holding cash reserves in JPY, consider the savings account strategy for better interest. Japanese bank interest is near zero; consider government bonds (JGB) for reserves > 6 months of runway.
