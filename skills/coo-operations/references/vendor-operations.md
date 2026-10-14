# Vendor Operations — KodaSōken

## Philosophy

Vendors at KodaSōken are an extension of the team. For a 5-15 person firm, every vendor relationship is visible — there's no procurement department insulating decisions from outcomes. Choose vendors you'd recommend to a friend. Manage them like you'd want to be managed as a consultant: clear expectations, fair feedback, and prompt payment.

## Vendor Lifecycle

### 1. Sourcing

**When to look for a vendor:**
- Skill gap that's not worth hiring for (≤6 month need)
- Capacity overflow that hiring can't solve fast enough
- Specialized service better bought than built (payroll, tax accounting, IT infrastructure)
- Legal/regulatory requirement for external provider (audit, certain certifications)

**Sourcing approach at KodaSōken scale:**
- **First source:** Personal network and referrals. In Japan, introductions (shōkai) carry weight and quality signals.
- **Second source:** Industry directories, trade associations.
- **Last source:** Cold search. Use only when network fails — vetting cost is higher.

### 2. Evaluation

Score 3-5 candidates on a simple matrix. See `assets/coo-toolkit.json` → `vendor_scorecard`.

**Minimum evaluation criteria:**
- Domain expertise (can they do the work?)
- Cultural fit (do they understand how we work?)
- Price within budget
- References check out (call at least one, ask: "What went wrong and how did they handle it?")
- For Japanese vendors: confirm corporate registration (tōki tōhon if needed), tax payment status, and any necessary licenses

**Red flags that override all other criteria:**
- Can't/won't provide references
- Price too good to be true (30%+ below next lowest bid)
- Unclear about who specifically will do the work
- Won't sign a simple NDA before discussing project details
- Payment terms that don't match Japanese norms (e.g., demands 100% upfront for first engagement)

### 3. Onboarding

**Minimum viable onboarding checklist:**
1. Signed contract/agreement (see contract essentials below)
2. NDA on file (mutual, unless client confidentiality dictates one-way)
3. Scope of work / statement of work clear and signed
4. Payment terms and invoicing procedure agreed
5. Primary contact on both sides named
6. Access granted: only what's needed, with expiry dates. (No vendor should have permanent access to anything.)
7. Introduction to relevant team members (15-min call, not an email thread)
8. Compliance check: is this vendor processing personal data? (If yes, confirm data handling meets Japan's Act on the Protection of Personal Information requirements.)

### 4. Management

**Ongoing vendor management (lightweight):**
- **Single owner:** Every vendor has one named owner at KodaSōken. That person is responsible for the relationship, not "the company."
- **Check-in cadence:** For active vendors: monthly 15-min call. For retained but inactive: quarterly email.
- **Payment tracking:** One person (finance/operations) tracks all vendor payments. See payment tracking below.
- **Issue resolution:** Vendor owner handles directly. Escalate to operations lead only if the vendor owner and vendor can't resolve.

### 5. Offboarding

**Offboarding triggers:**
- Contract end / project completion
- Non-renewal decision from quarterly review
- Performance failure (SLA breach repeated 2+ times without remediation)
- Strategic change (service no longer needed)

**Offboarding checklist:**
1. Written notice per contract terms (in Japan, 30 days is typical minimum; check the contract)
2. All deliverables received and accepted
3. Access revoked (do this first — before the final conversation, if the relationship is adversarial)
4. Final invoice received and reconciled
5. Knowledge transfer documented (if the vendor held institutional knowledge)
6. Contract closed in records, retained per compliance schedule
7. If applicable: transition plan for replacement vendor

## Contract Essentials

### What every KodaSōken vendor contract should have:
- **Parties:** Legal names and registered addresses (match the tōki or commercial registry)
- **Scope:** What exactly is being delivered. Vague scope = disputes.
- **Term:** Start date, end date, and renewal terms (auto-renewal? notice period?)
- **Compensation:** Amount, currency, payment schedule, invoicing procedure
- **Termination:** Notice period (30 days standard in Japan), termination for cause, consequences of termination
- **Confidentiality:** Mutual NDA embedded or referenced
- **IP ownership:** Who owns the work product? Default: KodaSōken owns deliverables created for KodaSōken.
- **Limitation of liability:** Typical language. Cap at fees paid unless negotiated otherwise.
- **Governing law:** Japan, with jurisdiction in Tokyo District Court (or KodaSōken's registered address jurisdiction)
- **Language:** Japanese if the vendor is Japanese (legally safer). Bilingual if both parties are comfortable — specify which version governs.

### Contract approval:
- Standard template contracts (using benrishi/vetted template): Operations lead signs
- Non-standard terms or custom contracts: CEO reviews and signs
- Any contract with liability cap >¥50M: CEO and external counsel review

### Japan-specific contract types:
- **Uriage keiyaku (sales contract):** For buying goods or standard services
- **Gyōmu itaku keiyaku (service agreement):** For outsourced work — very common
- **Junbi kin (down payment):** Common in Japan, typically 20-30% upfront for project work
- **Hanken (stamp/seal):** For contracts with Japanese counterparties, the registered seal (jitsuin) or company seal (kaishain) is typically required. Electronic contracts are increasingly accepted.

## Payment Tracking

### Monthly process:
1. By the 5th: All vendor invoices received and entered into the payment tracker
2. By the 10th: Approved invoices batched for payment
3. By the 25th: Payments executed (Japan standard: shimebi on 20th, payment on 25th of following month is common — confirm what was agreed per vendor)

### Payment tracker fields:
- Vendor name
- Contract/SOW reference
- Invoice number, date, amount (with tax)
- Payment due date
- Payment status (pending approval / approved / paid)
- Notes (discrepancies, disputes)

### Late payment:
- In Japan, statutory interest on late commercial payments is 6% per annum (Civil Code default) unless contract specifies otherwise. The Act on Prevention of Delay in Payment of Subcontracting Proceeds may apply if the vendor is significantly smaller.
- Don't be the client who pays late. It damages reputation disproportionately for a small firm.

## SLA Monitoring

For vendors with service-level agreements (IT services, cloud platforms, outsourced operations):

### If the SLA is in the vendor's standard terms:
- Note the critical SLAs (uptime, response time, resolution time)
- Check SLA reports if the vendor provides them quarterly
- Track SLA breaches: date, description, vendor response, credit received

### If KodaSōken is defining the SLA:
- Keep it simple: 2-3 metrics that actually matter. For a small firm, "responds within 4 business hours" and "resolves critical issues within 24 hours" may be sufficient.
- Define measurement method. "Uptime of 99.9%" is meaningless without "measured how, by whom, with what consequences."
- Remedies: service credits are standard for IT vendors. Escalation to termination for repeated breaches.

## Vendor Risk Management

### Risk categories:
1. **Concentration risk:** One vendor is the sole source for a critical service. Mitigation: identify a backup, even if not contracted.
2. **Financial risk:** Vendor may become insolvent. Mitigation: check financial health annually for critical vendors (at minimum, confirm they're still in business and filing taxes).
3. **Data risk:** Vendor handles KodaSōken or client confidential data. Mitigation: verify data handling practices, access controls, and breach notification procedures.
4. **Key-person risk:** One person at the vendor does all of KodaSōken's work, and they might leave. Mitigation: ask "if [name] left, who would handle our account?"
5. **Compliance risk:** Vendor's failure to comply (with tax, labor, data laws) creates liability for KodaSōken. Mitigation: for high-risk vendors, request proof of compliance (tax payment certificate, relevant licenses).

### Quarterly vendor review:
Rate each active vendor on a 1-5 scale:
- Quality of work
- Timeliness
- Communication
- Value for money
- Would we recommend them?

Average score <3.0 → discuss: improve, replace, or accept limitations.

## Vendor Scorecard

See `assets/coo-toolkit.json` → `vendor_scorecard` for the template. Use it for evaluation during sourcing AND for quarterly reviews of active vendors.
