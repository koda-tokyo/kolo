# Cap Table & Equity Management

## Table of Contents
1. [Cap Table Basics](#cap-table-basics)
2. [Equity Types in Japan](#equity-types-in-japan)
3. [SAFE vs. J-KISS](#safe-vs-j-kiss)
4. [Dilution Modeling](#dilution-modeling)
5. [Employee Equity Pool](#employee-equity-pool)
6. [Founder Vesting](#founder-vesting)
7. [KK vs. GK Structure](#kk-vs-gk-structure)

---

## Cap Table Basics

A cap table tracks who owns what. At pre-Series A, KodaSōken's cap table should track:

- **Shareholders** (name, entity type, tax residency)
- **Share class** (common, preferred — likely only common at this stage)
- **Number of shares** and fully diluted percentage
- **Vesting schedule** for each founder/employee grant
- **Exercise price** for options
- **Issue date** and any transfer restrictions

### KodaSōken Cap Table Template Fields
```
Shareholder | Class | Shares | % Ownership | % Fully Diluted | Vesting Start | Vesting Schedule | Cliff Date | Notes
```

At pre-Series A, the cap table will be simple: 2-3 founders, maybe an advisor. But build it with the columns you'll need post-Series A.

---

## Equity Types in Japan

### Common Stock (Futsū Kabushiki / 普通株式)
- Standard shares. One share = one vote.
- What founders hold. What early employees typically receive via options.
- No liquidation preference, no anti-dilution.

### Preferred Stock (Yūsen Kabushiki / 優先株式)
- Typically issued to VCs at Series A+.
- Japanese preferred stock can carry: liquidation preference (1x is standard in Japan), anti-dilution (weighted average is normal, full ratchet is rare), conversion rights (typically 1:1 to common), board seat rights, information rights, veto rights on major decisions.
- **Japanese norm**: Class-specific preferred shares (A-shū yūsen kabushiki for Series A, B-shū for Series B, etc.).

### Stock Options (Shinkabu Yoyaku-ken / 新株予約権)
- Right to purchase shares at a fixed exercise price.
- Japanese tax treatment: Exercise is a taxable event on the spread (market value - exercise price). This can be brutal for employees.
- **Tax-qualified options (zeisei tekikaku sutokku opushon)**: Available for startups meeting conditions (KK, under ¥1B capital, unlisted >1 year, etc.). Tax deferred until sale — far better for employees. **KodaSōken should use these if eligible.**
- Vesting: Standard in Japan is 4-year with 1-year cliff, same as US.

---

## SAFE vs. J-KISS

KodaSōken is pre-Series A. The most likely pre-Series A instruments in Japan:

### J-KISS (Japanese KISS)
- Standardized convertible instrument by Carta Japan / 500 Startups Japan.
- Modeled on Y Combinator's KISS (Keep It Simple Security).
- Has both debt and equity variants. Equity variant more common for Japanese startups.
- Converts at next qualified equity round (typically Series A) with a discount (20% is market) and/or valuation cap.
- **Advantages**: Bilingual templates exist, widely understood by Japanese seed investors, no interest accruing.
- **Disadvantages**: Less flexible than SAFE for non-standard terms.

### SAFE (Simple Agreement for Future Equity)
- Y Combinator instrument. Increasingly used in Japan, especially by global-facing startups.
- No maturity date, no interest. Converts at next priced round.
- **Japan-specific considerations**: SAFEs are not well-tested in Japanese courts. Foreign VCs accept them; domestic VCs strongly prefer J-KISS. If your lead investor is Japanese, use J-KISS.

### Which to Use for KodaSōken?
- **Japanese lead investor** → J-KISS
- **Global/US lead investor** → SAFE (Post-Money SAFE, latest YC template)
- **Mixed syndicate** → J-KISS with bilingual docs; most Japanese angels are comfortable with J-KISS

Avoid convertible notes with interest and maturity dates in Japan — these create taxable events and accounting complexity that pre-Series A startups should not carry.

---

## Dilution Modeling

### Standard Dilution Path (Pre-Seed → Series A)
| Round | Instrument | Dilution | Notes |
|-------|-----------|----------|-------|
| Pre-Seed | SAFE/J-KISS | 10-15% | First external money |
| Seed | SAFE/J-KISS | 15-20% | Build toward Series A |
| Series A | Priced Preferred | 20-25% | First priced round |

At Series A close, founders typically own 50-60% on a fully diluted basis. The 20% employee option pool is created from the pre-money and dilutes all existing holders equally (unless negotiated otherwise — Japanese VCs usually insist pool comes from founders' side only).

### Dilution Calculator Logic
```
Post-money ownership = Shares owned / (Total shares + New shares issued)
New shares = Post-money valuation / Share price
```

Always calculate on **fully diluted basis**: assume all options, warrants, and convertibles are exercised. This is what VCs care about.

---

## Employee Equity Pool

### Pool Sizing
- **Pre-Series A target**: 10-15% of fully diluted.
- **Series A**: VCs will require 15-20% pool post-money. If your pre-Series A pool is too small, founders absorb the top-up dilution.

### Allocation Benchmarks (KodaSōken)
| Role | Grant (% fully diluted) | Notes |
|------|------------------------|-------|
| CTO-level engineer | 1-3% | For first 5-10 employees |
| Senior ML researcher | 0.5-2% | Adjust for PhD premium |
| Clinical advisor | 0.25-0.5% | Advisory board, not full-time |
| Junior engineer | 0.1-0.5% | Post-Series A hires |

Japanese startups tend to give lower equity than US startups. Adjust upward for global talent competition (AI market is global).

---

## Founder Vesting

### Standard Japanese Vesting
- **4-year vesting, 1-year cliff** (same as US)
- At pre-Series A, founders should already be vesting. If not, implement before any investor meeting.
- **Reverse vesting**: Founders "buy" their shares upfront at incorporation, then the company has a repurchase right that lapses over the vesting period. This is standard for KK structures in Japan.

### Founder Departure Provisions
- **Good leaver / bad leaver**: Define in the shareholders' agreement before it matters.
- Good leaver: departing founder keeps vested shares, unvested shares repurchased at fair market value.
- Bad leaver: company can repurchase vested shares at a discount (e.g., cost or 50% of FMV). Define "bad leaver" clearly (fraud, IP theft, competing, conviction).

---

## KK vs. GK Structure

### Kabushiki Kaisha (KK / 株式会社)
- **Default for startups seeking VC funding.**
- Well-understood by investors, auditors, and tax authorities.
- Can issue stock options, preferred shares, multiple share classes.
- Higher setup cost (¥150k-¥250k registration tax), more governance formalities.
- Required for tax-qualified stock options (zeisei tekikaku).

### Gōdō Kaisha (GK / 合同会社)
- LLC equivalent. Lower setup cost (¥60k).
- Simpler governance — no board, no shareholders' meeting requirements.
- **Cannot issue stock options in the standard sense.** Uses "membership interest" instead.
- Rarely used by VC-backed startups in Japan. VCs will ask you to convert to KK pre-investment.
- May be appropriate for a holding company or IP-holding entity.

### Recommendation for KodaSōken
**KK is the only realistic choice** for a VC-track startup in AI/healthcare. The ability to issue tax-qualified stock options alone is worth the extra governance overhead. If KodaSōken is currently a GK, plan the KK conversion before any institutional fundraise — budget ¥500k-¥1M in legal fees and 1-2 months timeline.
