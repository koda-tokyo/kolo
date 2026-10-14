# Investor Relations & Fundraising

## Table of Contents
1. [Fundraising Process](#fundraising-process)
2. [Investor Pipeline Management](#investor-pipeline-management)
3. [Pitch Deck Financial Slides](#pitch-deck-financial-slides)
4. [Term Sheet Negotiation](#term-sheet-negotiation)
5. [Japanese vs. International Investors](#japanese-vs-international-investors)
6. [Grant Applications](#grant-applications)

---

## Fundraising Process

### Phase 1: Prepare (4-6 weeks)
- Update cap table, vesting schedules, corporate documents
- Build data room (see checklist in assets/finance-toolkit.json)
- Prepare financial model (base/best/worst cases)
- Draft pitch deck, practice with friendly angels/advisors first
- Legal review of all existing SAFEs/J-KISS, employment agreements

### Phase 2: Target (2-3 weeks)
- Build investor pipeline (see pipeline management below)
- Research each investor: check size, stage, sector, portfolio for conflicts
- Japanese VCs: identify the decision-maker (usually a partner, not an associate). Cold intros rarely work — get a warm introduction through your network, a lawyer, or an accountant.
- International VCs: check if they have a Japan office or partner. Many don't invest in Japan directly.

### Phase 3: Pitch (6-10 weeks)
- First meeting: vision, team, problem, initial traction — not detailed financials
- Second meeting: product demo, TAM, competitive landscape, unit economics
- Third meeting: deep dive on financials, cap table, term sheet discussion
- Expect 15-30 first meetings to generate 5-8 second meetings to get 1-2 term sheets
- **Japan-specific**: The process is slower. Decisions require nemawashi (根回し — consensus building). A "yes" in the room may be walked back after internal consultation. Build in 30% extra timeline buffer vs. US norms.

### Phase 4: Diligence (4-8 weeks)
- Financial DD: clean books, tax compliance, grant accounting
- Legal DD: corporate formation, IP assignment from founders, employment contracts
- Technical DD (especially for KodaSōken): model architecture review, data rights, clinical validation methodology
- **Japan-specific**: DD is thorough and document-heavy. Expect questions about your zeirishi, your hanko (corporate seal) usage, and whether board minutes exist for every decision.

### Phase 5: Close (2-4 weeks)
- Final term sheet negotiation
- Definitive agreements (shareholders' agreement, investment agreement)
- Board consent, shareholder resolution
- Funds transfer (domestic: furikomi 1-2 days; international: wire 3-7 days)

---

## Investor Pipeline Management

### Pipeline Stages
```
Research → Warm Intro Scheduled → First Meeting → Second Meeting → Partner Meeting → Term Sheet → DD → Closed / Passed
```

### CRM Fields for Each Investor
- Name, firm, fund size, typical check size
- Stage preference (seed, Series A, growth)
- Sector focus (AI, healthcare, enterprise — or agnostic)
- Japan presence (office, local partner, remote)
- Portfolio conflicts (any competing AI healthcare cos?)
- Contact: who gave the warm intro? What's the relationship?
- Status: last contact date, next step, current stage
- Notes: investment thesis, concerns raised, decision timeline

### Target Investor Types for KodaSōken (Pre-Series A)
| Type | Examples (Japan) | Typical Check | Fit for KodaSōken |
|------|-----------------|---------------|-------------------|
| Seed/early-stage VC | ANRI, CyberAgent Capital, Coral Capital, DNX Ventures, Genesia Ventures | ¥30-100M | High — AI/healthcare focus |
| Corporate VC | M3 Inc, NTT Docomo Ventures, Sony Innovation Fund | ¥50-200M | Medium — strategic fit potential |
| University funds | UTEC (University of Tokyo), Kyoto University Innovation Capital, Osaka University VC | ¥30-100M | High — deep tech alignment |
| Government-affiliated | INCJ, JIC, NEDO (grant, not equity) | ¥100M+ (grants) / ¥500M+ (equity) | Medium — slow, bureaucratic |
| Angel syndicates | Z Venture Capital, individual angels via ANOBAKA | ¥5-30M | High for bridge rounds |
| International VCs | Sequoia (rare in Japan), 500 Global, East Ventures | Variable | Low at pre-Series A — prefer domestic first |

---

## Pitch Deck Financial Slides

### The 3 Financial Slides That Matter

1. **The Ask Slide**: How much are you raising? What instrument (SAFE/J-KISS/priced)? What milestones will this round fund? Show: "This ¥XXX million gets us to [specific milestone] in [timeframe]."

2. **The TAM Slide**: Bottom-up, not top-down. "There are X hospitals in Japan with Y clinicians. Our initial target is Z hospitals of type A. At ¥B/month per hospital, the initial addressable market is ¥C billion."
   - Japanese investors are skeptical of top-down TAM. Show the math from first principles.

3. **The Unit Economics Slide**: One slide with: CAC, LTV, payback period, gross margin per customer. If pre-revenue, show projected unit economics with conservative assumptions clearly labeled. See unit-economics.md.

### What NOT to Put in the Pitch Deck
- Revenue projections 5 years out with hockey-stick curves (instant credibility loss with Japanese VCs)
- "Conservative" projections that show 300% YoY growth
- TAM that includes "global healthcare AI market" without segmenting to your actual beachhead

---

## Term Sheet Negotiation

### Key Terms for Pre-Series A (J-KISS / SAFE)
- **Valuation cap**: The maximum valuation at which the instrument converts. Lower cap = better for investors. Pre-revenue AI startups in Japan: ¥300-800M cap range for seed J-KISS.
- **Discount rate**: 20% is market. 25% is founder-friendly. 15% is investor-friendly.
- **MFN (Most Favored Nation)**: If you issue a subsequent SAFE/J-KISS with better terms before Series A, earlier investors get the better terms. Standard to include.
- **Pro-rata rights**: Investor can maintain % ownership in future rounds. Standard for lead investors, not for small checks.

### Terms to Resist (Pre-Series A)
- Board seat for a seed investor writing < ¥50M
- Full ratchet anti-dilution (insist on weighted average)
- Redemption rights (allows investor to force company to buy back shares — dangerous for pre-revenue cos)
- Dividends (pre-revenue startups should not pay dividends on preferred stock)
- Excessive information rights (monthly detailed financials are reasonable; weekly updates are not)

---

## Japanese vs. International Investors

### Japanese Investor Psychology
- **Trust-first**: Relationship matters. Multiple meetings to build comfort. Don't rush to the ask.
- **Risk-averse for AI**: "Show me the clinical validation" matters more than "this model scores X on a benchmark."
- **Consortium approach**: Japanese VCs often syndicate and want co-investors. A solo VC leading a round is less common than in the US.
- **Documentation expectations**: Full set of Japanese corporate documents (tōki, teikan, torishimariyaku ketteiroku). Have your judicial scrivener (shihō shoshi) ready.

### International Investor Psychology
- **Speed**: Faster decisions, fewer meetings.
- **Scale narrative**: "Japan first, then Asia, then global" resonates. Japan-only play will not.
- **English docs**: All materials must be in English. Japanese-language-only docs are a non-starter.
- **Legal framework**: Expect Delaware-style docs. International VCs may not understand or accept J-KISS — have English translations ready.

---

## Grant Applications

### Key Japanese Grant Programs for AI/Healthcare Startups

#### NEDO (New Energy and Industrial Technology Development Organization)
- **Programs**: AI-related R&D grants, healthcare DX, medical device development
- **Typical size**: ¥10M-500M per project
- **Process**: Kagai katsudō keikaku (business plan) → application → review → grant decision → milestone payments
- **Timeline**: 3-6 months from application to first disbursement
- **Key**: Show technological novelty AND commercialization path. Pure research without business plan fails.

#### METI (Ministry of Economy, Trade and Industry)
- **Programs**: IT Introduction Subsidy (IT Dōnyū Hojo-kin), Service Robot Development, Healthcare IT
- **Typical size**: ¥5M-100M
- **Process**: Typically through local SME support centers (Yorozu Shien Kyoten)

#### MEXT (Ministry of Education, Culture, Sports, Science and Technology)
- **Programs**: KAKENHI (Grants-in-Aid for Scientific Research), university collaboration grants
- **Typical size**: ¥5M-50M for early-stage research
- **Key**: Academic partnership required. KodaSōken's university connections (Tokyo University, Keio, Kyoto) are leverage here.

### Grant Application Checklist
1. Company registration completed (KK with proper articles of incorporation)
2. Tax filings current (no delinquencies — grant agencies check)
3. Research plan in Japanese (academic style, with citations)
4. Budget breakdown with justification for each line item
5. Commercialization timeline (even for R&D grants)
6. Team CVs (highlight academic credentials for MEXT/NEDO)
7. Letters of intent or support from hospital partners (critical for healthcare grants)
8. Prior grant track record (if any — list all, even small ones)

### Grant Accounting Note
Grants are taxable revenue in Japan unless structured as a specific R&D subsidy with separate accounting. Consult your zeirishi before accepting any grant to understand the tax treatment. Some grants require separate bank accounts and auditable expense tracking.
